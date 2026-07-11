import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { StoredDiagEvent } from './diagnostics-store';
import { persistDiagEvents, __resetDiagnosticsDbForTests } from './diagnostics-store';
import type { DiagEvent } from './socket-diagnostics';
import {
  buildDiagnosticsJsonl,
  summarizeDiagEvents,
  formatDiagSummaryFa,
  exportDiagnosticsJsonl,
  diagFileTimestamp,
} from './diagnostics-export';

/**
 * Export contract: JSONL with metadata line first and ts-sorted sanitized
 * events, fully offline operation, and a summary containing counts only.
 */

const ALLOWED_KEYS = new Set([
  'seq', 'ts', 'kind', 'pageInstanceId', 'browserSessionId',
  'event', 'phase', 'sendOrigin', 'clientMessageId', 'conversationId',
  'deliveryState', 'attempt', 'reason',
  'socketId', 'connected', 'active', 'reconnecting', 'readyState',
  'transport', 'visibility', 'online', 'path',
  // local bookkeeping added by diagnostics-store:
  'diagnosticEventId', 'serverReceived',
]);

function stored(seq: number, overrides: Partial<StoredDiagEvent> = {}): StoredDiagEvent {
  return {
    seq,
    ts: 1_770_000_000_000 + seq,
    kind: 'lifecycle',
    event: 'socket_disconnect',
    reason: 'ping timeout',
    pageInstanceId: 'pi_a',
    browserSessionId: 'bs_a',
    diagnosticEventId: `pi_a:${seq}`,
    serverReceived: false,
    ...overrides,
  } as StoredDiagEvent;
}

const META = {
  exportedAt: '2026-07-12T10:00:00.000Z',
  appVersion: '1752300000000',
  pageInstanceId: 'pi_a',
  browserSessionId: 'bs_a',
};

describe('buildDiagnosticsJsonl', () => {
  it('emits a metadata first line and one ts-sorted JSON object per event', () => {
    const events = [stored(3), stored(1), stored(2)];
    const jsonl = buildDiagnosticsJsonl(events, META);
    const lines = jsonl.trimEnd().split('\n');
    expect(lines).toHaveLength(4);

    const meta = JSON.parse(lines[0]!);
    expect(meta).toEqual({
      type: 'meta',
      ...META,
      eventCount: 3,
      earliestTs: 1_770_000_000_001,
      latestTs: 1_770_000_000_003,
    });

    const seqs = lines.slice(1).map((l) => JSON.parse(l).seq);
    expect(seqs).toEqual([1, 2, 3]); // sorted by client timestamp
  });

  it('exported lines contain only sanitized allowlisted fields', () => {
    const events = [
      stored(1),
      stored(2, {
        kind: 'chat_send',
        event: undefined,
        phase: 'ack-timeout',
        sendOrigin: 'new-message',
        clientMessageId: 'cm_abcdefgh',
        conversationId: 'conv-1',
      } as Partial<StoredDiagEvent>),
    ];
    const lines = buildDiagnosticsJsonl(events, META).trimEnd().split('\n').slice(1);
    for (const line of lines) {
      const obj = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
      for (const forbidden of ['body', 'fileName', 'fileUrl', 'token', 'phone', 'firstName']) {
        expect(forbidden in obj).toBe(false);
      }
    }
  });
});

describe('summarizeDiagEvents + formatDiagSummaryFa', () => {
  it('aggregates the required counters', () => {
    const events: StoredDiagEvent[] = [
      stored(1, { event: 'socket_disconnect', reason: 'ping timeout' }),
      stored(2, { event: 'socket_disconnect', reason: 'ping timeout' }),
      stored(3, { event: 'socket_disconnect', reason: 'transport close' }),
      stored(4, { event: 'reconnect_attempt' }),
      stored(5, { event: 'reconnect_success' }),
      stored(6, { event: 'browser_offline' }),
      stored(7, { event: 'browser_online' }),
      stored(8, { pageInstanceId: 'pi_b', diagnosticEventId: 'pi_b:8' }), // refresh boundary
      stored(9, { kind: 'chat_send', event: undefined, phase: 'optimistic-inserted', sendOrigin: 'new-message' } as Partial<StoredDiagEvent>),
      stored(10, { kind: 'chat_send', event: undefined, phase: 'manual-retry-start', sendOrigin: 'manual-retry' } as Partial<StoredDiagEvent>),
      stored(11, { kind: 'chat_send', event: undefined, phase: 'auto-retry-start', sendOrigin: 'auto-reconnect-retry' } as Partial<StoredDiagEvent>),
      stored(12, { kind: 'chat_send', event: undefined, phase: 'ack-timeout' } as Partial<StoredDiagEvent>),
      stored(13, { kind: 'chat_send', event: undefined, phase: 'server-rejection' } as Partial<StoredDiagEvent>),
      stored(14, { kind: 'chat_send', event: undefined, phase: 'force-failed' } as Partial<StoredDiagEvent>),
      stored(15, { serverReceived: true }),
    ];
    const s = summarizeDiagEvents(events);
    expect(s).toMatchObject({
      eventCount: 15,
      socketDisconnects: 5, // seq 1,2,3 plus seq 8 and 15 (default event is socket_disconnect)
      disconnectReasons: { 'ping timeout': 4, 'transport close': 1 },
      reconnectAttempts: 1,
      reconnectSuccesses: 1,
      reconnectFailures: 0,
      browserOffline: 1,
      browserOnline: 1,
      newMessageSends: 1,
      manualRetries: 1,
      autoReconnectRetries: 1,
      ackTimeouts: 1,
      serverRejections: 1,
      forceFailed: 1,
      notServerReceived: 14,
    });
    // pi_a → pi_b at seq 8, then pi_b → pi_a at seq 9: two boundary changes.
    expect(s.pageInstanceChanges).toBe(2);

    const text = formatDiagSummaryFa(s, new Date('2026-07-12T10:00:00Z'));
    expect(text).toContain('قطع اتصال سوکت');
    expect(text).toContain('ping timeout: 4');
    expect(text).toContain('تلاش مجدد دستی: 1');
    expect(text).toContain('بدون تایید دریافت سرور: 14');
  });
});

describe('exportDiagnosticsJsonl — offline', () => {
  beforeEach(async () => {
    await __resetDiagnosticsDbForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (URL as unknown as Record<string, unknown>)['createObjectURL'];
    delete (URL as unknown as Record<string, unknown>)['revokeObjectURL'];
  });

  it('downloads the JSONL entirely client-side even when every network request fails', async () => {
    const e: DiagEvent = {
      seq: 1,
      ts: Date.now(),
      kind: 'lifecycle',
      event: 'socket_disconnect',
      reason: 'transport close',
      pageInstanceId: 'pi_x',
      browserSessionId: 'bs_x',
    } as DiagEvent;
    await persistDiagEvents([e]);

    // Total network outage: fetch (version.json) rejects.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    let capturedBlob: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        capturedBlob = b;
        return 'blob:diag';
      }),
      revokeObjectURL: vi.fn(),
    });
    const anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    });

    const count = await exportDiagnosticsJsonl();
    expect(count).toBe(1);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toMatch(/^karamooz-chat-diagnostics-\d{8}-\d{6}\.jsonl$/);

    const text = await (capturedBlob as unknown as Blob).text();
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    const meta = JSON.parse(lines[0]!);
    expect(meta.type).toBe('meta');
    expect(meta.appVersion).toBe('unknown'); // offline → safe fallback
    expect(meta.eventCount).toBe(1);
    expect(JSON.parse(lines[1]!).diagnosticEventId).toBe('pi_x:1');
  });

  it('filename timestamp helper matches YYYYMMDD-HHmmss', () => {
    expect(diagFileTimestamp(new Date(2026, 6, 12, 9, 5, 3))).toBe('20260712-090503');
  });
});
