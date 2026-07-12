import { io, type Socket } from 'socket.io-client';
import { tokenStore, refreshAccessToken } from './api-client';
import { attachSocketDiagnostics, socketRebuildPhase } from './socket-diagnostics';
import { initDiagnosticsRecovery } from './diagnostics-recovery';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:3001';

let socket: Socket | null = null;
let visibilityHooked = false;

// ─── Socket generation / health facade ──────────────────────────────────────
//
// Production evidence showed `socket.connected === true` is not sufficient
// proof that the CURRENT transport can deliver outgoing events (a "zombie"
// socket: Engine.IO readyState "open", transport "websocket", yet no
// CHAT_SEND ack ever arrives). Recovery from that state requires actually
// replacing the Socket.IO client — not merely calling `.connect()` on a
// socket that already reports connected.
//
// `socketGeneration` increments on every hard rebuild (and on the very first
// socket). Callers record which generation an attempt used; a message that
// timed out on generation N must never retry on generation N.

export type SocketHealth = 'healthy' | 'unhealthy' | 'rebuilding';

let socketGeneration = 0;
let socketHealth: SocketHealth = 'healthy';
let unhealthySocketId: string | null = null;
let rebuildPromise: Promise<Socket> | null = null;
// Bumped by disconnectSocket() (logout / explicit teardown). A rebuild that
// started before a bump must never resurrect and hand out a socket after it —
// see hardRebuildSocket().
let disposeEpoch = 0;

type SocketListener = (socket: Socket, generation: number) => void;
const socketListeners = new Set<SocketListener>();

function notifySocketListeners(): void {
  if (!socket) return;
  for (const cb of Array.from(socketListeners)) {
    try {
      cb(socket, socketGeneration);
    } catch {
      /* a subscriber must never break socket lifecycle */
    }
  }
}

/**
 * Subscribe to "the live socket changed" (hard rebuild, or the existing
 * logout/login `disconnectSocket`+`getSocket` swap). Fires once immediately
 * with the current socket (if one exists), then again on every replacement.
 *
 * This is the smallest safe facade for consumers that keep a socket
 * reference across renders/effects (e.g. `useMessages`) so they don't keep
 * listening on a disconnected, replaced socket after a rebuild.
 */
export function subscribeSocket(cb: SocketListener): () => void {
  socketListeners.add(cb);
  if (socket) {
    try {
      cb(socket, socketGeneration);
    } catch {
      /* never throw from a subscribe call */
    }
  }
  return () => {
    socketListeners.delete(cb);
  };
}

export function getSocketGeneration(): number {
  return socketGeneration;
}

export function getSocketHealth(): SocketHealth {
  return socketHealth;
}

export function getUnhealthySocketId(): string | null {
  return unhealthySocketId;
}

/**
 * Mark the socket that a CHAT_SEND attempt used as unhealthy — but only if
 * it's still the live socket at the same generation the caller observed.
 * A stale/late caller (e.g. a second message's ack-timeout firing after a
 * rebuild triggered by a first message already completed) can never regress
 * a fresh, healthy socket back to unhealthy.
 */
export function markSocketUnhealthy(socketId: string | undefined, generation: number, reason: string): void {
  if (generation !== socketGeneration) return; // a rebuild already superseded this generation
  if (socket && socketId && socket.id !== socketId) return; // socket already replaced
  if (socketHealth !== 'healthy') return; // already unhealthy/rebuilding — no-op
  socketHealth = 'unhealthy';
  unhealthySocketId = socketId ?? null;
  socketRebuildPhase({
    phase: 'socket-marked-unhealthy',
    oldSocketId: socketId,
    oldSocketGeneration: generation,
    rebuildReason: reason,
  });
}

function wireSocket(s: Socket): void {
  // Observation only (lifecycle ring buffer + [karamooz-chat-diag] console +
  // batched server telemetry). Never alters connect/reconnect behavior.
  attachSocketDiagnostics(s);
  // Startup recovery: re-deliver IndexedDB events the server never acked.
  // Fully async, delayed, single-flight — never touches chat or connect behavior.
  initDiagnosticsRecovery(s);

  s.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      // سرور قطع کرد — تقریباً همیشه یعنی access token منقضی شده:
      // رفرش کن و با توکن تازه دوباره وصل شو (listener ها حفظ می‌شوند)
      void refreshAccessToken().then((token) => {
        if (token) {
          s.connect();
        } else {
          // رفرش هم نامعتبر است — کاربر باید دوباره لاگین کند
          s.removeAllListeners();
          if (socket === s) socket = null;
        }
      });
    }
  });

  // برگشت از پس‌زمینه (iOS سوکت‌ها را suspend می‌کند) → اتصال فوری با توکن تازه
  if (!visibilityHooked && typeof document !== 'undefined') {
    visibilityHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (socket && !socket.connected) {
        void refreshAccessToken().finally(() => socket?.connect());
      }
    });
  }
}

function createSocket(forceNew: boolean): Socket {
  const s = io(WS_URL, {
    // تابع (نه آبجکت) — توکن در «هر» تلاش اتصال تازه خوانده می‌شود.
    // باگ قبلی موبایل: توکن فقط بار اول گرفته می‌شد؛ بعد از suspend شدن اپ در iOS
    // یا انقضای ۱۵ دقیقه‌ای access token، reconnect با توکن مرده انجام می‌شد
    // و سرور قطع می‌کرد → realtime تا رفرش کامل صفحه می‌مُرد.
    auth: (cb) => cb({ token: `Bearer ${tokenStore.getAccess() ?? ''}` }),
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity, // گوشی ممکن است مدت طولانی آفلاین/قفل باشد
    // A hard rebuild must never reuse the zombied Manager/Engine — force an
    // entirely independent Manager so the old one can be fully retired.
    ...(forceNew ? { forceNew: true } : {}),
  });
  wireSocket(s);
  return s;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = createSocket(false);
    socketGeneration += 1;
    socketHealth = 'healthy';
    unhealthySocketId = null;
    notifySocketListeners();
  }
  return socket;
}

export function disconnectSocket(): void {
  disposeEpoch += 1; // aborts any in-flight hardRebuildSocket() from completing
  if (socket) {
    try {
      socket.io.reconnection(false);
    } catch {
      /* best-effort */
    }
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socketHealth = 'healthy';
  unhealthySocketId = null;
  rebuildPromise = null;
}

export function reconnectSocket(): void {
  disconnectSocket();
  getSocket();
}

/**
 * Hard rebuild: replace the current Socket.IO client with a fresh one.
 *
 * Single-flight — concurrent callers (e.g. two messages timing out close
 * together) await the SAME promise; only one rebuild, one fresh Manager, is
 * ever created. Bounded by `timeoutMs` for the fresh `connect`.
 *
 * Steps (per the hard-rebuild contract): stop the old Manager from
 * reconnecting, strip its application listeners, disconnect+close it, build
 * a fresh client through this same central module (reusing the existing
 * auth-callback/diagnostics/recovery wiring), wait for `connect`, verify the
 * new socket.id differs from the old one, bump the generation, and publish
 * the new socket to subscribers.
 */
export function hardRebuildSocket(reason: string, timeoutMs: number): Promise<Socket> {
  if (rebuildPromise) return rebuildPromise;

  const old = socket;
  const oldId = old?.id;
  const oldGeneration = socketGeneration;
  const myEpoch = disposeEpoch;
  const startedAt = Date.now();

  socketHealth = 'rebuilding';
  socketRebuildPhase({
    phase: 'socket-rebuild-start',
    oldSocketId: oldId,
    oldSocketGeneration: oldGeneration,
    rebuildReason: reason,
  });

  const run = async (): Promise<Socket> => {
    if (old) {
      try {
        old.io.reconnection(false);
      } catch {
        /* best-effort */
      }
      try {
        old.removeAllListeners();
      } catch {
        /* best-effort */
      }
      try {
        old.disconnect();
      } catch {
        /* best-effort */
      }
    }

    const fresh = createSocket(true);
    socketRebuildPhase({
      phase: 'socket-rebuild-connect-wait',
      oldSocketId: oldId,
      oldSocketGeneration: oldGeneration,
      rebuildReason: reason,
    });

    const connected = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fresh.off('connect', onConnect);
        resolve(ok);
      };
      const onConnect = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      fresh.once('connect', onConnect);
    });

    // Logout (or another explicit teardown) happened while we were waiting —
    // never hand out or activate a socket for a session that already ended.
    if (myEpoch !== disposeEpoch) {
      try {
        fresh.removeAllListeners();
        fresh.disconnect();
      } catch {
        /* best-effort */
      }
      socketRebuildPhase({
        phase: 'socket-rebuild-failed',
        oldSocketId: oldId,
        oldSocketGeneration: oldGeneration,
        rebuildReason: reason,
        elapsedMs: Date.now() - startedAt,
        failureReason: 'session-changed',
      });
      throw new Error('session-changed');
    }

    if (!connected || fresh.id === oldId) {
      const failureReason = connected ? 'same-socket-id' : 'fresh-socket-connect-timeout';
      socketRebuildPhase({
        phase: 'socket-rebuild-failed',
        oldSocketId: oldId,
        oldSocketGeneration: oldGeneration,
        rebuildReason: reason,
        elapsedMs: Date.now() - startedAt,
        failureReason,
      });
      try {
        fresh.removeAllListeners();
        fresh.disconnect();
      } catch {
        /* best-effort */
      }
      socketHealth = 'unhealthy';
      throw new Error(failureReason);
    }

    socket = fresh;
    socketGeneration = oldGeneration + 1;
    socketHealth = 'healthy';
    unhealthySocketId = null;
    socketRebuildPhase({
      phase: 'socket-rebuild-success',
      oldSocketId: oldId,
      newSocketId: fresh.id,
      oldSocketGeneration: oldGeneration,
      newSocketGeneration: socketGeneration,
      rebuildReason: reason,
      elapsedMs: Date.now() - startedAt,
    });
    notifySocketListeners();
    return fresh;
  };

  rebuildPromise = run().finally(() => {
    rebuildPromise = null;
  });
  return rebuildPromise;
}

// ─── Test-only helpers ───────────────────────────────────────────────────────

/** Test-only: reset all module-scoped socket-facade state between test cases. */
export function __resetSocketClientForTests(): void {
  socket = null;
  socketGeneration = 0;
  socketHealth = 'healthy';
  unhealthySocketId = null;
  rebuildPromise = null;
  disposeEpoch = 0;
  socketListeners.clear();
}
