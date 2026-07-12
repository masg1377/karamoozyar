/**
 * Startup recovery for locally persisted diagnostics.
 *
 * After every fresh JS boot (including a page refresh), IndexedDB may hold
 * diagnostic events that the server never acknowledged (the socket, API,
 * DNS, or VPN route was down when they were recorded, or the tab was closed
 * mid-flush). This module re-delivers them through the EXISTING authenticated
 * `chat:client-diagnostics` event, treating IndexedDB — never the in-memory
 * or sessionStorage buffers — as the authoritative source of unsent events.
 *
 * Scope guarantees:
 *   - No new store, no new event, no change to chat/outbox/retry behavior.
 *   - Events are resent EXACTLY as persisted: original diagnosticEventId
 *     (pageInstanceId:seq), original ts/pageInstanceId/browserSessionId/
 *     socketId/phase fields. The new boot's identity is used only as the
 *     batch envelope (who is sending), never to rewrite event identities.
 *   - Single-flight: startup / `connect` / `online` / auth triggers all
 *     funnel into one guarded scheduler — concurrent flushes are impossible.
 *   - Never runs during module init; never blocks rendering, socket
 *     connection, or chat sending; never throws; produces NO diagnostics
 *     events about itself (no recursive telemetry).
 *   - Respects the server's one-batch-per-10s rate limit: the startup check
 *     is delayed past the connect-time ring-buffer flush, batches are spaced
 *     ≥11s apart, and failures back off exponentially (never a tight loop,
 *     never a forced reconnect).
 */

import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import { useAuthStore } from '@/store/auth.store';
import {
  readUnsentDiagEvents,
  markDiagEventsServerReceived,
  type StoredDiagEvent,
} from './diagnostics-store';
import { pageInstanceId, getBrowserSessionId } from './socket-diagnostics';

const MAX_BATCH = 100;
const ACK_TIMEOUT_MS = 5_000;

// Production timings (overridable in tests). Startup waits past the
// connect-time ring-buffer flush; batch spacing respects the server's
// 10s/socket rate limit with margin.
let timing = {
  startupDelayMs: 15_000,
  interBatchDelayMs: 11_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 10 * 60_000,
};

let socketRef: Socket | null = null;
let initialized = false;
let flushInFlight = false;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let backoffLevel = 0;

// ─── Readiness ─────────────────────────────────────────────────────────────────

function authReady(): boolean {
  try {
    const s = useAuthStore.getState();
    // _hasHydrated = client-side init finished; isAuthenticated = session ready.
    return s._hasHydrated === true && s.isAuthenticated === true;
  } catch {
    return false;
  }
}

function ready(): boolean {
  try {
    if (!authReady()) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    return socketRef !== null && socketRef.connected === true;
  } catch {
    return false;
  }
}

// ─── Wire shape ────────────────────────────────────────────────────────────────

/** Strip local bookkeeping fields — the wire format is exactly the shape the
 *  server validator already accepts. Event identities are NOT touched. */
function toWireEvent(rec: StoredDiagEvent): Record<string, unknown> {
  const { diagnosticEventId: _id, serverReceived: _sr, serverReceivedAt: _sra, ...wire } = rec;
  return wire;
}

// ─── Flush (single-flight, sequential batches) ─────────────────────────────────

type BatchResult = 'acked-more' | 'acked-done' | 'failed' | 'not-ready' | 'idle';

function sendOneBatch(): Promise<BatchResult> {
  return new Promise((resolve) => {
    void (async () => {
      try {
        if (!ready()) {
          resolve('not-ready');
          return;
        }
        const unsent = await readUnsentDiagEvents(MAX_BATCH);
        if (unsent.length === 0) {
          resolve('idle');
          return;
        }
        const socket = socketRef;
        if (!socket || !socket.connected) {
          resolve('not-ready');
          return;
        }

        const ids = unsent.map((e) => e.diagnosticEventId);
        let settled = false;
        const finish = (r: BatchResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };
        const timer = setTimeout(() => finish('failed'), ACK_TIMEOUT_MS);

        socket.emit(
          SOCKET_EVENTS.CHAT_CLIENT_DIAGNOSTICS,
          {
            // Envelope identity = this (new) boot; each event inside keeps
            // its ORIGINAL pageInstanceId/browserSessionId/seq/ts untouched.
            pageInstanceId,
            browserSessionId: getBrowserSessionId(),
            events: unsent.map(toWireEvent),
          },
          (ack: { ok?: boolean; acceptedIds?: string[] } | undefined) => {
            void (async () => {
              try {
                if (ack && ack.ok === true) {
                  const accepted = Array.isArray(ack.acceptedIds)
                    ? ack.acceptedIds.filter((id): id is string => typeof id === 'string')
                    : ids; // older API build: whole batch was accepted
                  await markDiagEventsServerReceived(accepted);
                  finish(unsent.length >= MAX_BATCH ? 'acked-more' : 'acked-done');
                } else {
                  // Rejected / rate-limited: records stay serverReceived:false.
                  finish('failed');
                }
              } catch {
                finish('failed');
              }
            })();
          },
        );
      } catch {
        resolve('failed');
      }
    })();
  });
}

async function runFlush(): Promise<void> {
  if (flushInFlight) return; // single-flight — concurrent triggers are no-ops
  flushInFlight = true;
  try {
    const result = await sendOneBatch();
    switch (result) {
      case 'acked-more':
        // One acked batch resets the backoff; next batch after the rate-limit gap.
        backoffLevel = 0;
        schedule(timing.interBatchDelayMs);
        break;
      case 'acked-done':
        backoffLevel = 0;
        break; // nothing unsent remains — stop until a later trigger
      case 'idle':
        backoffLevel = 0;
        break;
      case 'failed': {
        // Bounded exponential backoff — never a continuous retry loop.
        const delay = Math.min(
          timing.backoffBaseMs * 2 ** backoffLevel,
          timing.backoffMaxMs,
        );
        backoffLevel = Math.min(backoffLevel + 1, 10);
        schedule(delay);
        break;
      }
      case 'not-ready':
        break; // wait for the next connect/online/auth trigger — no timer spin
      default:
        break;
    }
  } catch {
    /* recovery must never throw */
  } finally {
    flushInFlight = false;
  }
}

function schedule(delayMs: number): void {
  try {
    if (pendingTimer !== null) return; // one scheduled attempt at a time
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void runFlush();
    }, delayMs);
  } catch {
    /* never throw */
  }
}

/** Trigger entry point — safe to call from anywhere, any number of times. */
export function triggerDiagnosticsRecovery(): void {
  schedule(0);
}

// ─── Init (called from socket-client after the socket exists) ──────────────────

// Sockets that already have the per-socket 'connect' recovery trigger
// attached — mirrors the WeakSet-guarded pattern in attachSocketDiagnostics
// so a hard rebuild (a genuinely NEW Socket.IO client instance — see
// socket-client.ts) gets this trigger re-attached exactly once, instead of
// silently losing it forever after the first rebuild.
const connectTriggerAttached = new WeakSet<Socket>();

/**
 * Attach recovery triggers. Called from getSocket() — i.e. after client-side
 * init, and (re)called with any fresh socket instance (including after a
 * hard rebuild). The per-socket `connect` trigger is idempotent PER SOCKET
 * (WeakSet-guarded); the window/auth hooks attach once per JS boot.
 */
export function initDiagnosticsRecovery(socket: Socket): void {
  try {
    socketRef = socket;

    // Trigger: successful socket connect (covers reconnects AND hard
    // rebuilds — each fresh socket instance gets its own listener).
    if (!connectTriggerAttached.has(socket)) {
      connectTriggerAttached.add(socket);
      socket.on('connect', () => schedule(timing.interBatchDelayMs));
    }

    if (initialized) return;
    initialized = true;

    // Trigger: browser back online.
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => schedule(timing.interBatchDelayMs));
    }

    // Trigger: authentication/session becoming ready.
    try {
      useAuthStore.subscribe((state, prev) => {
        if (state.isAuthenticated && !prev.isAuthenticated) {
          schedule(timing.interBatchDelayMs);
        }
      });
    } catch {
      /* store unavailable — remaining triggers still work */
    }

    // Trigger: initial authenticated startup (fresh boot / after refresh).
    // Delayed so it never runs during init and never races the connect-time
    // ring-buffer flush for the server's per-socket rate-limit budget.
    schedule(timing.startupDelayMs);
  } catch {
    /* recovery wiring must never break socket creation */
  }
}

// ─── Test-only helpers ─────────────────────────────────────────────────────────

/** Test-only: shrink delays so tests run with real timers. */
export function __setRecoveryTimingForTests(overrides: Partial<typeof timing>): void {
  timing = { ...timing, ...overrides };
}

/** Test-only: run one flush cycle immediately (bypasses scheduling). */
export async function __runRecoveryFlushForTests(): Promise<void> {
  await runFlush();
}

/** Test-only: reset module state. */
export function __resetRecoveryForTests(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  socketRef = null;
  initialized = false;
  flushInFlight = false;
  backoffLevel = 0;
  timing = {
    startupDelayMs: 15_000,
    interBatchDelayMs: 11_000,
    backoffBaseMs: 30_000,
    backoffMaxMs: 10 * 60_000,
  };
}
