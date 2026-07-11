import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Integration: socket-diagnostics × diagnostics-store.
 *
 * Verifies the local-first contract end to end: events land in IndexedDB
 * BEFORE/regardless of server delivery, server acks flip serverReceived
 * (without deleting), failed delivery leaves serverReceived:false, and a
 * broken diagnostics store never blocks or throws into the send path.
 * Real timers (fake-indexeddb needs a live event loop).
 */

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

interface CapturedBatch {
  batch: { events: { seq: number; pageInstanceId: string }[] };
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let diag: typeof import('./socket-diagnostics');
let store: typeof import('./diagnostics-store');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('window', { sessionStorage: makeStorage(), addEventListener: vi.fn() });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('location', { pathname: '/admin/conversations/c1' });
  diag = await import('./socket-diagnostics');
  store = await import('./diagnostics-store');
  diag.__resetDiagnosticsForTests();
  await store.__resetDiagnosticsDbForTests();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local-first persistence', () => {
  it('persists events locally while the socket/API is completely unavailable', async () => {
    const socket = new FakeSocket(); // never connects
    diag.attachSocketDiagnostics(socket as never);

    diag.lifecycle('socket_disconnect', 'transport close');
    diag.chatSendPhase({
      clientMessageId: 'cm_abcdefgh',
      conversationId: 'conv-1',
      sendOrigin: 'new-message',
      phase: 'enter-awaiting-reconnect',
      deliveryState: 'awaiting-reconnect',
    });
    await sleep(60);

    expect(socket.batches).toHaveLength(0); // nothing ever reached a server
    const persisted = await store.readAllDiagEvents();
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(persisted.every((e) => e.serverReceived === false)).toBe(true);
    const phases = persisted.map((e) => e.event ?? e.phase);
    expect(phases).toContain('socket_disconnect');
    expect(phases).toContain('enter-awaiting-reconnect');
  });

  it('marks events serverReceived on server ack — and keeps them locally', async () => {
    const socket = new FakeSocket();
    diag.attachSocketDiagnostics(socket as never);
    diag.lifecycle('reconnect_attempt', 'attempt-1');

    socket.simulateConnect();
    await sleep(60);
    expect(socket.batches).toHaveLength(1);
    const confirmedCount = socket.batches[0]!.batch.events.length;
    socket.batches[0]!.cb({ ok: true });
    await sleep(60);

    const persisted = await store.readAllDiagEvents();
    expect(persisted.length).toBeGreaterThanOrEqual(confirmedCount); // NOT deleted after ack
    const confirmedSeqs = new Set(socket.batches[0]!.batch.events.map((e) => e.seq));
    for (const rec of persisted) {
      expect(rec.serverReceived).toBe(confirmedSeqs.has(rec.seq));
    }
  });

  it('failed server delivery leaves events locally with serverReceived: false', async () => {
    const socket = new FakeSocket();
    diag.attachSocketDiagnostics(socket as never);
    diag.lifecycle('reconnect_error', 'websocket error');

    socket.simulateConnect();
    await sleep(60);
    expect(socket.batches).toHaveLength(1);
    socket.batches[0]!.cb({ ok: false }); // e.g. rate-limited / rejected
    await sleep(60);

    const persisted = await store.readAllDiagEvents();
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((e) => e.serverReceived === false)).toBe(true);
  });

  it('a broken diagnostics store never blocks or throws into the send path', async () => {
    vi.stubGlobal('indexedDB', undefined); // IndexedDB gone entirely
    vi.resetModules();
    diag = await import('./socket-diagnostics');
    diag.__resetDiagnosticsForTests();

    expect(() => {
      diag.chatSendPhase({
        clientMessageId: 'cm_abcdefgh',
        conversationId: 'conv-1',
        sendOrigin: 'new-message',
        phase: 'send-emitted',
      });
      diag.lifecycle('socket_disconnect', 'transport close');
    }).not.toThrow();
    await sleep(60);

    // Events are still recorded in memory + console, and exactly one safe
    // local_diag_error marks the storage failure — no recursion, no spam.
    const buffer = diag.__getDiagnosticsBufferForTests();
    expect(buffer.some((e) => e.phase === 'send-emitted')).toBe(true);
    expect(buffer.filter((e) => e.event === 'local_diag_error')).toHaveLength(1);
  });
});
