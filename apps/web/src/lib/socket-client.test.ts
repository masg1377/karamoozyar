import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Socket-facade tests: the hard-rebuild contract (single-flight, fresh
 * Manager, old socket fully retired, generation bump, session-abort safety)
 * that `outbox.ts` relies on to recover from a "zombie" socket — one that
 * reports `connected: true` but can no longer deliver events.
 */

let socketSeq = 0;
const createdSockets: FakeIoSocket[] = [];

class FakeIoSocket extends EventEmitter {
  id: string;
  connected = false;
  io: { reconnection: ReturnType<typeof vi.fn> };
  opts: Record<string, unknown>;

  constructor(opts: Record<string, unknown>) {
    super();
    socketSeq += 1;
    this.id = `sock-${socketSeq}`;
    this.io = { reconnection: vi.fn() };
    this.opts = opts;
    createdSockets.push(this);
  }

  connect = vi.fn((): this => this);
  disconnect = vi.fn((): this => {
    this.connected = false;
    return this;
  });

  simulateConnect(): void {
    this.connected = true;
    this.emit('connect');
  }
}

const ioMock = vi.fn((_url: string, opts: Record<string, unknown>) => new FakeIoSocket(opts));

vi.mock('socket.io-client', () => ({
  io: (url: string, opts: Record<string, unknown>) => ioMock(url, opts),
}));

const getAccessMock = vi.fn(() => 'tok');
const refreshAccessTokenMock = vi.fn(async () => 'new-tok');
vi.mock('./api-client', () => ({
  tokenStore: {
    getAccess: () => getAccessMock(),
    getRefresh: () => 'ref',
    setAccess: vi.fn(),
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  refreshAccessToken: (...args: unknown[]) => refreshAccessTokenMock(...args),
}));

vi.mock('./socket-diagnostics', () => ({
  attachSocketDiagnostics: vi.fn(),
  socketRebuildPhase: vi.fn(),
}));

vi.mock('./diagnostics-recovery', () => ({
  initDiagnosticsRecovery: vi.fn(),
}));

const {
  getSocket,
  disconnectSocket,
  reconnectSocket,
  hardRebuildSocket,
  markSocketUnhealthy,
  getSocketGeneration,
  getSocketHealth,
  getUnhealthySocketId,
  subscribeSocket,
  __resetSocketClientForTests,
} = await import('./socket-client');
const { socketRebuildPhase } = await import('./socket-diagnostics');

function lastSocket(): FakeIoSocket {
  return createdSockets[createdSockets.length - 1]!;
}

beforeEach(() => {
  vi.useFakeTimers();
  createdSockets.length = 0;
  socketSeq = 0;
  ioMock.mockClear();
  vi.mocked(socketRebuildPhase).mockClear();
  getAccessMock.mockReset();
  getAccessMock.mockReturnValue('tok');
  refreshAccessTokenMock.mockClear();
  __resetSocketClientForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getSocket', () => {
  it('lazily creates exactly one socket and starts generation at 1', () => {
    expect(getSocketGeneration()).toBe(0);
    const s1 = getSocket();
    expect(getSocketGeneration()).toBe(1);
    const s2 = getSocket();
    expect(s2).toBe(s1);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it('does not force a new Manager for the very first socket', () => {
    getSocket();
    const opts = ioMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts['forceNew']).toBeUndefined();
  });
});

describe('hardRebuildSocket', () => {
  it('creates a fresh, independent Manager (forceNew) and retires the old socket', async () => {
    const old = getSocket();
    old.simulateConnect();

    const promise = hardRebuildSocket('ack-timeout', 5_000);
    const fresh = lastSocket();
    expect(fresh).not.toBe(old);
    const opts = ioMock.mock.calls[1]![1] as Record<string, unknown>;
    expect(opts['forceNew']).toBe(true);

    // Old socket must stop reconnecting and dispatching application events.
    expect(old.io.reconnection).toHaveBeenCalledWith(false);
    expect(old.disconnect).toHaveBeenCalled();
    expect(old.listenerCount('connect')).toBe(0); // removeAllListeners() ran

    fresh.simulateConnect();
    const result = await promise;

    expect(result).toBe(fresh);
    expect(result.id).not.toBe(old.id);
    expect(getSocketGeneration()).toBe(2);
    expect(getSocket()).toBe(fresh);
    expect(getSocketHealth()).toBe('healthy');
  });

  it('is single-flight: concurrent callers share one rebuild and get one fresh socket', async () => {
    getSocket();
    const p1 = hardRebuildSocket('ack-timeout', 5_000);
    const p2 = hardRebuildSocket('ack-timeout', 5_000);
    expect(ioMock).toHaveBeenCalledTimes(2); // 1 initial + exactly 1 rebuild, not 2

    lastSocket().simulateConnect();
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(s1).toBe(s2);
  });

  it('fails after the fresh-connect timeout if `connect` never fires, and marks unhealthy', async () => {
    getSocket();
    const promise = hardRebuildSocket('ack-timeout', 5_000);
    // Attach the rejection assertion synchronously, before advancing timers,
    // so the rejection is never observably "unhandled" between the timer
    // firing and this test asserting on it.
    const assertion = expect(promise).rejects.toThrow('fresh-socket-connect-timeout');
    const fresh = lastSocket();
    const disconnectSpy = fresh.disconnect;

    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(disconnectSpy).toHaveBeenCalled(); // the failed fresh socket is also cleaned up
    expect(getSocketHealth()).toBe('unhealthy');
  });

  it('clears the shared rebuild promise after success so a later rebuild can run again', async () => {
    getSocket();
    const p1 = hardRebuildSocket('ack-timeout', 5_000);
    lastSocket().simulateConnect();
    const s1 = await p1;

    const beforeCount = ioMock.mock.calls.length;
    const p2 = hardRebuildSocket('ack-timeout', 5_000);
    expect(ioMock.mock.calls.length).toBe(beforeCount + 1); // a genuinely new rebuild started, not reused
    lastSocket().simulateConnect();
    const s2 = await p2;
    expect(s2).not.toBe(s1);
    expect(s2.id).not.toBe(s1.id);
    expect(getSocket()).toBe(s2);
  });

  it('(Gate 3 §17) the auth callback reads the CURRENT token at connect-time, not a value captured when the socket was created — a rebuild after a token change uses the new token, and the rebuild itself never triggers its own token refresh', async () => {
    const old = getSocket();
    const oldOpts = ioMock.mock.calls[0]![1] as Record<string, unknown>;
    const oldAuthFn = oldOpts['auth'] as (cb: (a: { token: string }) => void) => void;
    let capturedOld = '';
    oldAuthFn((a) => {
      capturedOld = a.token;
    });
    expect(capturedOld).toBe('Bearer tok');

    // Token refreshed elsewhere (e.g. a 401-triggered HTTP refresh) BEFORE the rebuild connects.
    getAccessMock.mockReturnValue('tok-2');
    old.simulateConnect();

    const promise = hardRebuildSocket('ack-timeout', 5_000);
    const fresh = lastSocket();
    const freshOpts = ioMock.mock.calls[1]![1] as Record<string, unknown>;
    const freshAuthFn = freshOpts['auth'] as (cb: (a: { token: string }) => void) => void;
    let capturedFresh = '';
    freshAuthFn((a) => {
      capturedFresh = a.token;
    });
    expect(capturedFresh).toBe('Bearer tok-2'); // fresh connection reads the NEW token, not the stale cached one

    fresh.simulateConnect();
    await promise;

    // hardRebuildSocket() itself never calls refreshAccessToken() — it only
    // ever reads whatever token is currently stored via the auth callback.
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  it('aborts safely if the session is torn down (disconnectSocket) while rebuilding — never resurrects a socket after logout', async () => {
    getSocket();
    const promise = hardRebuildSocket('ack-timeout', 5_000);
    const fresh = lastSocket();

    disconnectSocket(); // simulates logout mid-rebuild
    fresh.simulateConnect();

    await expect(promise).rejects.toThrow('session-changed');
    expect(fresh.disconnect).toHaveBeenCalled(); // the orphaned fresh socket is torn down too
    expect(getSocket()).not.toBe(fresh); // logout's getSocket() builds an entirely new one
  });
});

describe('markSocketUnhealthy', () => {
  it('marks the current socket/generation unhealthy', () => {
    const s = getSocket();
    markSocketUnhealthy(s.id, getSocketGeneration(), 'ack-timeout');
    expect(getSocketHealth()).toBe('unhealthy');
    expect(getUnhealthySocketId()).toBe(s.id);
  });

  it('is a no-op for a stale generation (a rebuild already superseded it)', async () => {
    const s = getSocket();
    const staleGeneration = getSocketGeneration();
    const promise = hardRebuildSocket('ack-timeout', 5_000);
    lastSocket().simulateConnect();
    await promise;

    markSocketUnhealthy(s.id, staleGeneration, 'ack-timeout');
    expect(getSocketHealth()).toBe('healthy'); // never regressed the fresh, healthy socket
  });
});

describe('Gate 9 §7 — token refresh fails on an `io server disconnect`', () => {
  it('when the server disconnects the socket (expired token) and refreshAccessToken resolves null, the dead socket is retired without an exception; a later getSocket() builds a fresh one that can connect normally', async () => {
    const s = getSocket();
    refreshAccessTokenMock.mockResolvedValueOnce(null); // refresh genuinely failed — user must re-auth

    s.emit('disconnect', 'io server disconnect');
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve(); // flush the refreshAccessToken().then(...) microtask

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(s.connect).not.toHaveBeenCalled(); // never reconnects with a token that failed to refresh
    expect(s.listenerCount('connect')).toBe(0); // dead socket's listeners were torn down

    // A later call to get a socket must not throw and must build a working one.
    const next = getSocket();
    expect(next).not.toBe(s);
    next.simulateConnect();
    expect(next.connected).toBe(true);
  });

  it('when the server disconnects the socket and refreshAccessToken succeeds, the SAME socket reconnects with the new token (listeners preserved, no rebuild)', async () => {
    const s = getSocket();
    refreshAccessTokenMock.mockResolvedValueOnce('fresh-tok');
    getAccessMock.mockReturnValue('fresh-tok');

    s.emit('disconnect', 'io server disconnect');
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(s.connect).toHaveBeenCalledTimes(1); // reconnects the SAME Manager/socket, no hard rebuild
    expect(getSocket()).toBe(s); // still the same instance — listeners were never torn down
    expect(ioMock).toHaveBeenCalledTimes(1); // no second socket/Manager was created
  });
});

describe('subscribeSocket', () => {
  it('fires immediately with the current socket, then again on every replacement', async () => {
    const seen: string[] = [];
    const s0 = getSocket();
    const unsubscribe = subscribeSocket((s) => seen.push(s.id));
    expect(seen).toEqual([s0.id]);

    const promise = hardRebuildSocket('ack-timeout', 5_000);
    lastSocket().simulateConnect();
    const fresh = await promise;

    expect(seen).toEqual([s0.id, fresh.id]);
    unsubscribe();
  });
});

describe('disconnectSocket / reconnectSocket', () => {
  it('disconnectSocket tears down listeners and stops reconnection', () => {
    const s = getSocket();
    disconnectSocket();
    expect(s.io.reconnection).toHaveBeenCalledWith(false);
    expect(s.disconnect).toHaveBeenCalled();
    expect(s.listenerCount('connect')).toBe(0);
  });

  it('reconnectSocket builds a brand-new socket instance', () => {
    const s1 = getSocket();
    reconnectSocket();
    const s2 = getSocket();
    expect(s2).not.toBe(s1);
  });
});
