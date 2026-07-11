import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { DiagEvent } from './socket-diagnostics';

/**
 * Startup recovery contract (diagnostics-recovery.ts):
 *   - IndexedDB (not memory/sessionStorage) is the source of unsent events,
 *   - recovery waits for auth + online + socket connect,
 *   - original event identities survive a refresh,
 *   - acks flip serverReceived per acceptedId, failures keep records queued,
 *   - single-flight batching (max 100, sequential), no duplicates,
 *   - no recursive telemetry about the resend itself.
 *
 * "Refresh" is simulated with vi.resetModules(): new module graph (new
 * pageInstanceId, empty memory buffers) over the SAME fake-indexeddb data.
 */

// Controllable auth store fake (recovery only needs getState + subscribe).
const { auth } = vi.hoisted(() => ({
  auth: {
    state: { isAuthenticated: true, _hasHydrated: true },
    listeners: new Set<(s: unknown, p: unknown) => void>(),
    set(isAuthenticated: boolean) {
      const prev = { ...this.state };
      this.state = { ...this.state, isAuthenticated };
      for (const l of this.listeners) l(this.state, prev);
    },
  },
}));
vi.mock('@/store/auth.store', () => ({
  useAuthStore: {
    getState: () => auth.state,
    subscribe: (fn: (s: unknown, p: unknown) => void) => {
      auth.listeners.add(fn);
      return () => auth.listeners.delete(fn);
    },
  },
}));

interface CapturedBatch {
  batch: {
    pageInstanceId: string;
    browserSessionId: string;
    events: Record<string, unknown>[];
  };
  cb: (ack: { ok?: boolean; acceptedIds?: string[] } | undefined) => void;
}

class FakeSocket extends EventEmitter {
  connected = false;
  active = true;
  id: string | undefined = 'sock_new';
  io = Object.assign(new EventEmitter(), {
    _reconnecting: false,
    engine: { readyState: 'open', transport: { name: 'websocket' } },
  });
  batches: CapturedBatch[] = [];

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'chat:client-diagnostics') {
      const [batch, cb] = args as [CapturedBatch['batch'], CapturedBatch['cb']];
      this.batches.push({ batch, cb });
      return true;
    }
    return super.emit(event, ...args);
  }

  simulateConnect(): void {
    this.connected = true;
    super.emit('connect');
  }
}

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function oldEvent(seq: number, overrides: Partial<DiagEvent> = {}): DiagEvent {
  return {
    seq,
    ts: Date.now() - 60_000 + seq,
    kind: 'lifecycle',
    event: 'socket_disconnect',
    reason: 'transport close',
    pageInstanceId: 'pi_old_boot',
    browserSessionId: 'bs_same_tab',
    socketId: 'sock_old',
    connected: false,
    ...overrides,
  } as DiagEvent;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let onlineHandlers: Array<() => void>;
let diag: typeof import('./socket-diagnostics');
let store: typeof import('./diagnostics-store');
let recovery: typeof import('./diagnostics-recovery');

async function bootModules(): Promise<void> {
  vi.resetModules();
  onlineHandlers = [];
  vi.stubGlobal('window', {
    sessionStorage: makeStorage(),
    addEventListener: vi.fn((name: string, fn: () => void) => {
      if (name === 'online') onlineHandlers.push(fn);
    }),
  });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { pathname: '/admin/conversations/c1' });

  diag = await import('./socket-diagnostics');
  store = await import('./diagnostics-store');
  recovery = await import('./diagnostics-recovery');
  diag.__resetDiagnosticsForTests();
  recovery.__resetRecoveryForTests();
  recovery.__setRecoveryTimingForTests({
    startupDelayMs: 5,
    interBatchDelayMs: 5,
    backoffBaseMs: 5,
    backoffMaxMs: 20,
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
}

beforeEach(async () => {
  auth.state = { isAuthenticated: true, _hasHydrated: true };
  auth.listeners.clear();
  await bootModules();
  await store.__resetDiagnosticsDbForTests();
});

afterEach(() => {
  recovery.__resetRecoveryForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refresh recovery — discovery and identity preservation', () => {
  it('finds unsent records after a simulated refresh and resends them with ORIGINAL ids, then marks them received', async () => {
    // "Previous boot": events persisted while server was unreachable.
    await store.persistDiagEvents([oldEvent(1), oldEvent(2)]);
    const before = await store.readAllDiagEvents();
    expect(before.every((e) => e.serverReceived === false)).toBe(true);

    // Refresh: old JS memory is gone, new pageInstanceId, same IndexedDB.
    await bootModules();
    expect(diag.pageInstanceId).not.toBe('pi_old_boot');

    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    await sleep(60); // startup trigger (5ms) + flush

    expect(socket.batches).toHaveLength(1);
    const { batch, cb } = socket.batches[0]!;
    // Envelope = the NEW boot's identity…
    expect(batch.pageInstanceId).toBe(diag.pageInstanceId);
    // …but events keep their ORIGINAL identities, untouched by the new boot.
    expect(batch.events).toHaveLength(2);
    for (const e of batch.events) {
      expect(e['pageInstanceId']).toBe('pi_old_boot');
      expect(e['browserSessionId']).toBe('bs_same_tab');
      expect(e['socketId']).toBe('sock_old');
      // Local bookkeeping never leaks onto the wire.
      expect('diagnosticEventId' in e).toBe(false);
      expect('serverReceived' in e).toBe(false);
      expect('serverReceivedAt' in e).toBe(false);
    }

    cb({ ok: true, acceptedIds: ['pi_old_boot:1', 'pi_old_boot:2'] });
    await sleep(60);

    const after = await store.readAllDiagEvents();
    expect(after).toHaveLength(2); // resend created NO new records
    expect(after.every((e) => e.serverReceived === true)).toBe(true);
    expect(after.every((e) => typeof e.serverReceivedAt === 'number')).toBe(true);
    expect(after.map((e) => e.diagnosticEventId).sort()).toEqual([
      'pi_old_boot:1',
      'pi_old_boot:2',
    ]);
  });
});

describe('readiness gates', () => {
  it('waits for authentication before flushing, then flushes when auth becomes ready', async () => {
    await store.persistDiagEvents([oldEvent(1)]);
    auth.state = { isAuthenticated: false, _hasHydrated: true };

    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    recovery.triggerDiagnosticsRecovery();
    await sleep(60);
    expect(socket.batches).toHaveLength(0); // gated on auth

    auth.set(true); // session becomes ready → subscribe trigger
    await sleep(60);
    expect(socket.batches).toHaveLength(1);
  });

  it('waits for socket connection before flushing, then flushes on connect', async () => {
    await store.persistDiagEvents([oldEvent(1)]);

    const socket = new FakeSocket(); // disconnected
    recovery.initDiagnosticsRecovery(socket as never);
    recovery.triggerDiagnosticsRecovery();
    await sleep(60);
    expect(socket.batches).toHaveLength(0); // gated on socket

    socket.simulateConnect();
    await sleep(60);
    expect(socket.batches).toHaveLength(1);
  });

  it('browser online event starts recovery', async () => {
    await store.persistDiagEvents([oldEvent(1)]);
    (globalThis as { navigator: { onLine: boolean } }).navigator.onLine = false;

    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    recovery.triggerDiagnosticsRecovery();
    await sleep(60);
    expect(socket.batches).toHaveLength(0); // gated on navigator.onLine

    (globalThis as { navigator: { onLine: boolean } }).navigator.onLine = true;
    expect(onlineHandlers.length).toBeGreaterThan(0);
    for (const fn of onlineHandlers) fn();
    await sleep(60);
    expect(socket.batches).toHaveLength(1);
  });
});

describe('acknowledgement + failure handling', () => {
  it('marks only acknowledged ids serverReceived; the rest stay queued and are resent later', async () => {
    await store.persistDiagEvents([oldEvent(1), oldEvent(2)]);
    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    await sleep(60);

    expect(socket.batches).toHaveLength(1);
    socket.batches[0]!.cb({ ok: true, acceptedIds: ['pi_old_boot:1'] }); // partial ack
    await sleep(60);

    let all = await store.readAllDiagEvents();
    expect(all.find((e) => e.seq === 1)!.serverReceived).toBe(true);
    expect(all.find((e) => e.seq === 2)!.serverReceived).toBe(false);

    // A later trigger resends ONLY the unacknowledged record.
    recovery.triggerDiagnosticsRecovery();
    await sleep(60);
    expect(socket.batches).toHaveLength(2);
    expect(socket.batches[1]!.batch.events).toHaveLength(1);
    expect(socket.batches[1]!.batch.events[0]!['seq']).toBe(2);
    socket.batches[1]!.cb({ ok: true, acceptedIds: ['pi_old_boot:2'] });
    await sleep(60);

    all = await store.readAllDiagEvents();
    expect(all).toHaveLength(2); // still no duplicates
    expect(all.every((e) => e.serverReceived === true)).toBe(true);
  });

  it('failed delivery keeps records queued and retries later with backoff — no tight loop', async () => {
    await store.persistDiagEvents([oldEvent(1)]);
    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    await sleep(60);

    expect(socket.batches).toHaveLength(1);
    socket.batches[0]!.cb({ ok: false }); // e.g. rate-limited
    await sleep(10);

    const all = await store.readAllDiagEvents();
    expect(all[0]!.serverReceived).toBe(false); // still queued

    await sleep(80); // backoff timer (5ms base in tests) fires a bounded retry
    expect(socket.batches.length).toBeGreaterThanOrEqual(2);
    socket.batches[socket.batches.length - 1]!.cb({ ok: true, acceptedIds: ['pi_old_boot:1'] });
    await sleep(60);
    expect((await store.readAllDiagEvents())[0]!.serverReceived).toBe(true);
  });
});

describe('batching + concurrency', () => {
  it('two simultaneous triggers produce exactly one batch', async () => {
    await store.persistDiagEvents([oldEvent(1)]);
    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);

    recovery.triggerDiagnosticsRecovery();
    recovery.triggerDiagnosticsRecovery();
    socket.simulateConnect(); // third trigger via connect listener
    await sleep(80);

    expect(socket.batches).toHaveLength(1); // single-flight + single scheduled timer
  });

  it('continues across multiple batches of 100, oldest first, until done', async () => {
    const events: DiagEvent[] = [];
    for (let i = 0; i < 150; i++) events.push(oldEvent(i, { ts: Date.now() - 300_000 + i }));
    await store.persistDiagEvents(events);

    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    await sleep(60);

    expect(socket.batches).toHaveLength(1);
    expect(socket.batches[0]!.batch.events).toHaveLength(100);
    expect(socket.batches[0]!.batch.events[0]!['seq']).toBe(0); // oldest first
    socket.batches[0]!.cb({
      ok: true,
      acceptedIds: socket.batches[0]!.batch.events.map((e) => `pi_old_boot:${String(e['seq'])}`),
    });

    await sleep(120); // inter-batch delay (5ms in tests) → second batch
    expect(socket.batches).toHaveLength(2);
    expect(socket.batches[1]!.batch.events).toHaveLength(50);
    socket.batches[1]!.cb({
      ok: true,
      acceptedIds: socket.batches[1]!.batch.events.map((e) => `pi_old_boot:${String(e['seq'])}`),
    });
    await sleep(120);

    const all = await store.readAllDiagEvents();
    expect(all.filter((e) => e.serverReceived === true)).toHaveLength(150);
    expect(socket.batches).toHaveLength(2); // stops when nothing unsent remains
  }, 15_000);
});

describe('safety', () => {
  it('recovery produces no recursive telemetry and creates no new local records', async () => {
    await store.persistDiagEvents([oldEvent(1)]);
    const bufferBefore = diag.__getDiagnosticsBufferForTests().length;
    const socket = new FakeSocket();
    socket.connected = true;
    recovery.initDiagnosticsRecovery(socket as never);
    await sleep(60);
    socket.batches[0]!.cb({ ok: true, acceptedIds: ['pi_old_boot:1'] });
    await sleep(60);

    // No diagnostics events about the resend itself, in memory or in IDB.
    expect(diag.__getDiagnosticsBufferForTests().length).toBe(bufferBefore);
    const all = await store.readAllDiagEvents();
    expect(all).toHaveLength(1);
    expect(all.some((e) => e.event === 'local_diag_error')).toBe(false);
  });

  it('never throws or blocks even when IndexedDB and the socket are broken', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await bootModules(); // fresh graph with no IndexedDB at all

    const socket = new FakeSocket();
    socket.connected = true;
    expect(() => {
      recovery.initDiagnosticsRecovery(socket as never);
      recovery.triggerDiagnosticsRecovery();
      recovery.triggerDiagnosticsRecovery();
    }).not.toThrow(); // trigger entry points are synchronous no-throw
    await sleep(60);
    expect(socket.batches).toHaveLength(0); // nothing to send, nothing crashed

    // Chat-path recording still works alongside.
    expect(() => diag.lifecycle('socket_disconnect', 'transport close')).not.toThrow();
  });
});
