import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DiagEvent } from './socket-diagnostics';
import {
  persistDiagEvents,
  markDiagEventsServerReceived,
  readAllDiagEvents,
  clearDiagnosticsEvents,
  pruneDiagEvents,
  getDiagMeta,
  setDiagMeta,
  diagnosticEventIdOf,
  countUnacknowledged,
  DIAG_RETENTION_MAX_EVENTS,
  DIAG_RETENTION_MAX_AGE_MS,
  __resetDiagnosticsDbForTests,
} from './diagnostics-store';

/**
 * Local diagnostics persistence contract: local-first storage, stable
 * diagnosticEventId dedup, serverReceived marking without deletion,
 * retention pruning, events-only clearing, and total failure tolerance.
 * Runs against fake-indexeddb (real timers).
 */

function evt(seq: number, overrides: Partial<DiagEvent> = {}): DiagEvent {
  return {
    seq,
    ts: Date.now(),
    kind: 'lifecycle',
    event: 'socket_disconnect',
    reason: 'transport close',
    pageInstanceId: 'pi_test',
    browserSessionId: 'bs_test',
    ...overrides,
  } as DiagEvent;
}

beforeEach(async () => {
  await __resetDiagnosticsDbForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('diagnostics-store — persistence + dedup', () => {
  it('persists sanitized events locally (serverReceived: false) regardless of socket/API availability', async () => {
    // No socket, no network mocked at all — persistence is purely local.
    const ok = await persistDiagEvents([evt(1), evt(2)]);
    expect(ok).toBe(true);
    const all = await readAllDiagEvents();
    expect(all).toHaveLength(2);
    expect(all.every((e) => e.serverReceived === false)).toBe(true);
    expect(all[0]!.diagnosticEventId).toBe('pi_test:1');
  });

  it('re-persisting the same event (server retry / session restore) never duplicates it', async () => {
    const e = evt(1);
    await persistDiagEvents([e]);
    await persistDiagEvents([e]); // retry with the SAME diagnosticEventId
    await persistDiagEvents([e, evt(2)]);
    const all = await readAllDiagEvents();
    expect(all).toHaveLength(2);
  });

  it('marks acknowledged events serverReceived without deleting them, and a later re-persist does not regress the flag', async () => {
    const e = evt(1);
    await persistDiagEvents([e, evt(2)]);
    await markDiagEventsServerReceived([diagnosticEventIdOf(e)]);

    let all = await readAllDiagEvents();
    expect(all).toHaveLength(2); // acked events are NOT deleted
    expect(all.find((r) => r.seq === 1)!.serverReceived).toBe(true);
    expect(all.find((r) => r.seq === 2)!.serverReceived).toBe(false);
    expect(await countUnacknowledged()).toBe(1);

    await persistDiagEvents([e]); // duplicate retry after ack
    all = await readAllDiagEvents();
    expect(all.find((r) => r.seq === 1)!.serverReceived).toBe(true); // flag preserved
  });
});

describe('diagnostics-store — retention pruning', () => {
  it('drops events older than 48h', async () => {
    const old = evt(1, { ts: Date.now() - DIAG_RETENTION_MAX_AGE_MS - 60_000 });
    const fresh = evt(2);
    await persistDiagEvents([old, fresh]);
    await pruneDiagEvents();
    const all = await readAllDiagEvents();
    expect(all).toHaveLength(1);
    expect(all[0]!.seq).toBe(2);
  });

  it('keeps only the latest 2,000 events by timestamp', async () => {
    const base = Date.now() - 1_000_000;
    const events: DiagEvent[] = [];
    for (let i = 0; i < DIAG_RETENTION_MAX_EVENTS + 25; i++) {
      events.push(evt(i, { ts: base + i }));
    }
    await persistDiagEvents(events);
    await pruneDiagEvents();
    const all = await readAllDiagEvents();
    expect(all).toHaveLength(DIAG_RETENTION_MAX_EVENTS);
    // The OLDEST 25 were dropped.
    expect(all[0]!.seq).toBe(25);
    expect(all[all.length - 1]!.seq).toBe(DIAG_RETENTION_MAX_EVENTS + 24);
  }, 30_000);
});

describe('diagnostics-store — clear scope', () => {
  it('clear removes only diagnostics event records (meta/live-log handle survives)', async () => {
    await persistDiagEvents([evt(1), evt(2)]);
    await setDiagMeta('liveLogHandle', { marker: 'handle' });

    const ok = await clearDiagnosticsEvents();
    expect(ok).toBe(true);
    expect(await readAllDiagEvents()).toHaveLength(0);
    // The meta store — and by construction every other IndexedDB database
    // (messages, auth, …) — is untouched.
    expect(await getDiagMeta<{ marker: string }>('liveLogHandle')).toEqual({ marker: 'handle' });
  });
});

describe('diagnostics-store — failure tolerance', () => {
  it('never throws and never blocks when IndexedDB is entirely unavailable', async () => {
    await __resetDiagnosticsDbForTests();
    vi.stubGlobal('indexedDB', undefined);

    // All of these must resolve normally (chat send path awaits none of them,
    // but even direct awaiting must be safe).
    await expect(persistDiagEvents([evt(1)])).resolves.toBe(false);
    await expect(readAllDiagEvents()).resolves.toEqual([]);
    await expect(markDiagEventsServerReceived(['pi_test:1'])).resolves.toBeUndefined();
    await expect(clearDiagnosticsEvents()).resolves.toBe(false);
    await expect(pruneDiagEvents()).resolves.toBeUndefined();
  });
});
