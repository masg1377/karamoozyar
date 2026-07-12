import 'fake-indexeddb/auto'; // local-first persistence target (diagnostics-store)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Diagnostics-core tests: identity semantics (refresh vs background reconnect),
 * buffered delivery (hold while disconnected, flush after confirmed connect,
 * clear only confirmed events), console sanitization, and the hard guarantee
 * that telemetry failure never throws into the chat path.
 *
 * Runs in the node environment with stubbed browser globals (no jsdom dep).
 */

const ALLOWED_KEYS = new Set([
  'seq', 'ts', 'kind', 'pageInstanceId', 'browserSessionId',
  'event', 'phase', 'sendOrigin', 'clientMessageId', 'conversationId',
  'deliveryState', 'attempt', 'reason',
  'socketId', 'connected', 'active', 'reconnecting', 'readyState',
  'transport', 'visibility', 'online', 'path',
  // zombie-socket recovery metadata (chat_send + socket_rebuild events)
  'oldSocketId', 'newSocketId', 'oldSocketGeneration', 'newSocketGeneration',
  'rebuildReason', 'elapsedMs', 'failureReason',
]);

const FORBIDDEN_KEYS = ['body', 'text', 'fileName', 'fileUrl', 'url', 'token', 'phone', 'firstName', 'lastName'];

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

interface CapturedBatch {
  event: string;
  batch: { pageInstanceId: string; browserSessionId: string; events: Record<string, unknown>[] };
  cb: (ack: { ok?: boolean } | undefined) => void;
}

class FakeSocket extends EventEmitter {
  connected = false;
  active = true;
  id: string | undefined = 'sock_a';
  io = Object.assign(new EventEmitter(), {
    _reconnecting: false,
    engine: { readyState: 'open', transport: { name: 'websocket' } },
  });
  batches: CapturedBatch[] = [];
  throwOnEmit = false;

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'chat:client-diagnostics') {
      if (this.throwOnEmit) throw new Error('transport dead');
      const [batch, cb] = args as [CapturedBatch['batch'], CapturedBatch['cb']];
      this.batches.push({ event, batch, cb });
      return true;
    }
    return super.emit(event, ...args);
  }

  simulateConnect(): void {
    this.connected = true;
    super.emit('connect');
  }
}

function stubBrowserGlobals(storage: Storage): void {
  vi.stubGlobal('window', {
    sessionStorage: storage,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { pathname: '/admin/conversations/c1' });
}

async function freshModule() {
  vi.resetModules();
  return import('./socket-diagnostics');
}

let storage: Storage;

beforeEach(() => {
  vi.useFakeTimers();
  storage = makeStorage();
  stubBrowserGlobals(storage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('diagnostics identity', () => {
  it('pageInstanceId changes after a simulated app reload while browserSessionId stays stable', async () => {
    const mod1 = await freshModule();
    const pid1 = mod1.pageInstanceId;
    const bsid1 = mod1.getBrowserSessionId();

    // Simulated reload: new module graph (new JS boot), same sessionStorage.
    const mod2 = await freshModule();

    expect(mod2.pageInstanceId).not.toBe(pid1);
    expect(mod2.getBrowserSessionId()).toBe(bsid1);
  });

  it('every recorded event carries both ids', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();
    mod.lifecycle('browser_offline');
    const evt = mod.__getDiagnosticsBufferForTests()[0]!;
    expect(evt.pageInstanceId).toBe(mod.pageInstanceId);
    expect(evt.browserSessionId).toBe(mod.getBrowserSessionId());
  });
});

describe('buffered delivery', () => {
  it('buffers while disconnected and flushes as one batch after a confirmed connect; clears only confirmed events', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();
    const socket = new FakeSocket();
    mod.attachSocketDiagnostics(socket as never);

    mod.lifecycle('socket_disconnect', 'transport close');
    mod.lifecycle('reconnect_attempt', 'attempt-1');
    mod.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'new-message',
      phase: 'enter-awaiting-reconnect',
      deliveryState: 'awaiting-reconnect',
    });

    // Disconnected: nothing may be sent.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(socket.batches).toHaveLength(0);
    expect(mod.__getDiagnosticsBufferForTests().length).toBe(3);

    // Confirmed connect → one batch with everything buffered so far.
    socket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.batches).toHaveLength(1);
    const { batch, cb } = socket.batches[0]!;
    expect(batch.pageInstanceId).toBe(mod.pageInstanceId);
    const phases = batch.events.map((e) => e['event'] ?? e['phase']);
    expect(phases).toContain('socket_disconnect');
    expect(phases).toContain('enter-awaiting-reconnect');
    expect(phases).toContain('socket_connect');

    // Events recorded during the in-flight batch are NOT cleared by its ack.
    mod.lifecycle('visibilitychange', 'hidden');
    cb({ ok: true });
    const remaining = mod.__getDiagnosticsBufferForTests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.event).toBe('visibilitychange');
  });

  it('keeps events when the server does not confirm (no ack / ok:false) and retries on a later flush', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();
    const socket = new FakeSocket();
    mod.attachSocketDiagnostics(socket as never);

    socket.simulateConnect(); // records socket_connect and flushes it
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.batches).toHaveLength(1);
    socket.batches[0]!.cb({ ok: false }); // e.g. rate-limited — must retain

    expect(mod.__getDiagnosticsBufferForTests().length).toBeGreaterThan(0);

    // A later connect flushes the retained events again.
    await vi.advanceTimersByTimeAsync(10_000);
    socket.simulateConnect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.batches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('console diagnostics + sanitization', () => {
  it('logs every event to console with the [karamooz-chat-diag] prefix', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();

    mod.lifecycle('socket_disconnect', 'ping timeout');
    mod.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'manual-retry',
      phase: 'manual-retry-start',
    });

    const labels = info.mock.calls.map((c) => c[0]);
    expect(labels).toContain('[karamooz-chat-diag] socket_disconnect');
    expect(labels).toContain('[karamooz-chat-diag] chat_send_phase');
  });

  it('no diagnostic event contains content-like or sensitive keys — allowlisted fields only', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();

    mod.lifecycle('connect_error', 'websocket error');
    mod.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'auto-reconnect-retry',
      phase: 'auto-retry-start',
      attempt: 2,
      reason: 'x'.repeat(500), // must be truncated
    });

    for (const evt of mod.__getDiagnosticsBufferForTests()) {
      for (const key of Object.keys(evt)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
      for (const forbidden of FORBIDDEN_KEYS) {
        expect(forbidden in evt).toBe(false);
      }
    }
    const chatEvt = mod.__getDiagnosticsBufferForTests()[1]!;
    expect(chatEvt.reason!.length).toBeLessThanOrEqual(160);
  });
});

describe('socket-rebuild diagnostics (zombie-socket recovery)', () => {
  it('records a socket_rebuild event with sanitized rebuild metadata only', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();

    mod.socketRebuildPhase({
      phase: 'socket-rebuild-success',
      oldSocketId: 'sock_old',
      newSocketId: 'sock_new',
      oldSocketGeneration: 1,
      newSocketGeneration: 2,
      rebuildReason: 'ack-timeout',
      elapsedMs: 1234,
    });

    const evt = mod.__getDiagnosticsBufferForTests()[0]!;
    expect(evt.kind).toBe('socket_rebuild');
    expect(evt.phase).toBe('socket-rebuild-success');
    expect(evt.oldSocketId).toBe('sock_old');
    expect(evt.newSocketId).toBe('sock_new');
    expect(evt.oldSocketGeneration).toBe(1);
    expect(evt.newSocketGeneration).toBe(2);
    expect(evt.rebuildReason).toBe('ack-timeout');
    expect(evt.elapsedMs).toBe(1234);
    for (const key of Object.keys(evt)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });

  it('logs the socket_rebuild console label distinctly from chat_send/lifecycle', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();

    mod.socketRebuildPhase({ phase: 'socket-rebuild-start', rebuildReason: 'ack-timeout' });

    const labels = info.mock.calls.map((c) => c[0]);
    expect(labels).toContain('[karamooz-chat-diag] socket_rebuild_phase');
  });

  it('a chatSendPhase call carrying rebuild metadata stays within the allowlist', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();

    mod.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'new-message',
      phase: 'fresh-socket-ack-timeout',
      attempt: 2,
      failureReason: 'fresh-socket-ack-timeout',
    });

    const evt = mod.__getDiagnosticsBufferForTests()[0]!;
    expect(evt.failureReason).toBe('fresh-socket-ack-timeout');
    for (const key of Object.keys(evt)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
  });
});

describe('telemetry must never break the chat path', () => {
  it('never throws even when console, storage, and the socket transport all fail', async () => {
    const mod = await freshModule();
    mod.__resetDiagnosticsForTests();
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console blocked');
    });
    Object.assign(storage, {
      setItem: () => {
        throw new Error('quota');
      },
    });
    const socket = new FakeSocket();
    socket.throwOnEmit = true;
    mod.attachSocketDiagnostics(socket as never);
    socket.simulateConnect();

    expect(() => {
      mod.chatSendPhase({
        clientMessageId: 'cm_abcdefgh',
        conversationId: 'conv-1',
        sendOrigin: 'new-message',
        phase: 'send-emitted',
      });
      mod.lifecycle('socket_disconnect', 'transport error');
    }).not.toThrow();

    expect(() => vi.advanceTimersByTime(20_000)).not.toThrow(); // flush attempt swallows the emit error
  });
});
