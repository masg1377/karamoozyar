/**
 * Minimal, production-safe Socket.IO / chat-send diagnostics.
 *
 * Purpose (and ONLY purpose): make it possible to distinguish, from PM2/API
 * logs and the browser console, why an ADMIN reconnects frequently and why a
 * message can sit in pending/sending/awaiting-reconnect for up to 60s:
 *   - page refresh / new JS boot  → pageInstanceId changes, browserSessionId stable
 *   - background reconnect        → same pageInstanceId, socketId changes
 *   - manual retry vs automatic resend after reconnect → sendOrigin
 *   - message reached backend vs stayed in browser     → send-emitted + server chat:send log
 *
 * Hard guarantees:
 *   - NEVER logs message text, file names, attachment URLs, tokens, phone
 *     numbers, or profile fields. Events are built field-by-field from a
 *     fixed allowlist; free-text inputs (reasons) are truncated.
 *   - NEVER throws and NEVER blocks/delays chat sending, reconnecting, or
 *     retrying. Every entry point is wrapped in try/catch; delivery to the
 *     server is fire-and-forget with its own bounded buffer.
 *   - No database persistence. Server side only logs through Nest Logger.
 *
 * Kill switch: set NEXT_PUBLIC_CHAT_DIAG=0 (or 'false'/'off') at build time.
 * Enabled by default — this exists specifically for production debugging.
 */

import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import {
  persistDiagEvents,
  markDiagEventsServerReceived,
  diagnosticEventIdOf,
} from './diagnostics-store';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SendOrigin = 'new-message' | 'manual-retry' | 'auto-reconnect-retry';

export type ChatSendPhase =
  | 'optimistic-inserted'
  | 'upload-start'
  | 'upload-success'
  | 'upload-error'
  | 'connect-wait-start'
  | 'connect-wait-success'
  | 'connect-wait-timeout'
  | 'send-emitted'
  | 'ack-success'
  | 'ack-timeout'
  | 'server-rejection'
  | 'enter-awaiting-reconnect'
  | 'auto-retry-start'
  | 'manual-retry-start'
  | 'force-failed'
  | 'state-change';

export type LifecycleEventName =
  | 'socket_connect'
  | 'socket_disconnect'
  | 'reconnect_attempt'
  | 'reconnect_error'
  | 'reconnect_failed'
  | 'reconnect_success'
  | 'connect_error'
  | 'browser_online'
  | 'browser_offline'
  | 'visibilitychange'
  | 'pagehide'
  | 'pageshow'
  // Internal, non-recursive marker for a diagnostics-subsystem failure
  // (IndexedDB write failed, FS Access API unavailable/denied, …). The
  // reason field carries a safe fixed code only.
  | 'local_diag_error';

/** One sanitized diagnostics event. Field set is a closed allowlist —
 *  mirrored by the server-side validator (client-diagnostics.util.ts). */
export interface DiagEvent {
  seq: number;
  ts: number;
  kind: 'lifecycle' | 'chat_send';
  pageInstanceId: string;
  browserSessionId: string;
  // lifecycle
  event?: LifecycleEventName;
  // chat_send
  phase?: ChatSendPhase;
  sendOrigin?: SendOrigin;
  clientMessageId?: string;
  conversationId?: string;
  deliveryState?: string;
  attempt?: number;
  // shared
  reason?: string;
  // socket/browser snapshot at the moment of the event
  socketId?: string;
  connected?: boolean;
  active?: boolean;
  reconnecting?: boolean;
  readyState?: string;
  transport?: string;
  visibility?: string;
  online?: boolean;
  path?: string;
}

// ─── Config ────────────────────────────────────────────────────────────────────

const ENABLED: boolean = (() => {
  const v = process.env['NEXT_PUBLIC_CHAT_DIAG'];
  return !(v === '0' || v === 'false' || v === 'off');
})();

const PREFIX = '[karamooz-chat-diag]';
const MAX_BUFFER = 100; // ring buffer size (memory + sessionStorage + max batch)
const FLUSH_MIN_INTERVAL_MS = 10_000; // must match server-side rate limit
const FLUSH_ACK_TIMEOUT_MS = 5_000;
const BSID_KEY = 'karamooz.diag.bsid';
const BUFFER_KEY = 'karamooz.diag.events';

// ─── Identity ──────────────────────────────────────────────────────────────────

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** New on every JS app boot (module evaluation). A changed pageInstanceId with
 *  a stable browserSessionId means refresh/navigation/new boot — the primary
 *  refresh detector (pagehide/pageshow are supporting evidence only). */
export const pageInstanceId = `pi_${randomId()}`;

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage;
  } catch {
    /* storage blocked (private mode / permissions) */
  }
  return null;
}

let cachedBsid: string | null = null;

/** Survives refresh within the same tab (sessionStorage). */
export function getBrowserSessionId(): string {
  if (cachedBsid) return cachedBsid;
  const storage = safeSessionStorage();
  if (!storage) return 'bs_unavailable';
  try {
    let v = storage.getItem(BSID_KEY);
    if (!v) {
      v = `bs_${randomId()}`;
      storage.setItem(BSID_KEY, v);
    }
    cachedBsid = v;
    return v;
  } catch {
    return 'bs_unavailable';
  }
}

// ─── Ring buffer (memory + sessionStorage) ─────────────────────────────────────

let seqCounter = 0;
let buffer: DiagEvent[] = [];
let restored = false;

/** Restore pre-refresh events once per boot so the first post-refresh batch
 *  shows the previous pageInstanceId's tail (each event carries its own ids). */
function restoreOnce(): void {
  if (restored) return;
  restored = true;
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(BUFFER_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const events = parsed.filter(
      (e): e is DiagEvent =>
        typeof e === 'object' && e !== null && typeof (e as DiagEvent).seq === 'number',
    );
    buffer = events.slice(-MAX_BUFFER);
    seqCounter = buffer.reduce((m, e) => Math.max(m, e.seq), 0);
  } catch {
    /* corrupt/blocked — start empty */
  }
}

function persist(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch {
    /* quota/blocked — memory buffer still works */
  }
}

// ─── Snapshot ──────────────────────────────────────────────────────────────────

let attachedSocket: Socket | null = null;

interface ManagerInternals {
  _reconnecting?: boolean;
  engine?: { readyState?: string; transport?: { name?: string } };
}

function snapshot(): Partial<DiagEvent> {
  const out: Partial<DiagEvent> = {};
  try {
    const s = attachedSocket;
    if (s) {
      out.socketId = s.id;
      out.connected = s.connected;
      out.active = s.active;
      const mgr = s.io as unknown as ManagerInternals;
      out.reconnecting = mgr?._reconnecting === true;
      out.readyState = mgr?.engine?.readyState;
      out.transport = mgr?.engine?.transport?.name;
    }
  } catch {
    /* snapshot is best-effort */
  }
  try {
    if (typeof document !== 'undefined') out.visibility = document.visibilityState;
    if (typeof navigator !== 'undefined') out.online = navigator.onLine;
    if (typeof location !== 'undefined') out.path = trunc(location.pathname, 120);
  } catch {
    /* best-effort */
  }
  return out;
}

// ─── Record + console ──────────────────────────────────────────────────────────

function trunc(v: unknown, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v).slice(0, max);
}

function record(partial: Partial<DiagEvent> & { kind: DiagEvent['kind'] }): void {
  if (!ENABLED) return;
  try {
    restoreOnce();
    const evt: DiagEvent = {
      seq: ++seqCounter,
      ts: Date.now(),
      pageInstanceId,
      browserSessionId: getBrowserSessionId(),
      ...snapshot(),
      ...partial,
    };
    buffer.push(evt);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    persist();
    persistLocalFirst(evt);
    try {
      const label = evt.kind === 'lifecycle' ? evt.event : 'chat_send_phase';
      // eslint-disable-next-line no-console
      console.info(`${PREFIX} ${label}`, evt);
    } catch {
      /* console blocked — never propagate */
    }
    scheduleFlush();
  } catch {
    /* diagnostics must never throw into the chat path */
  }
}

// ─── Local-first persistence (IndexedDB, see diagnostics-store.ts) ─────────────

// Guards against recursive telemetry: while an internal diagnostics error is
// being recorded, skip local persistence for that event, and report each
// distinct internal failure reason at most once per JS boot.
let suppressLocalPersist = false;
const reportedInternalErrors = new Set<string>();
let liveLogSink: ((evt: DiagEvent) => void) | null = null;

/** Fire-and-forget: store the sanitized event locally BEFORE any server
 *  delivery attempt. Failure is caught and reported exactly once. */
function persistLocalFirst(evt: DiagEvent): void {
  try {
    if (liveLogSink) {
      try {
        liveLogSink(evt);
      } catch {
        /* live-log sink is optional convenience — never propagate */
      }
    }
    if (suppressLocalPersist) return;
    void persistDiagEvents([evt]).then((ok) => {
      if (!ok) recordDiagInternalError('idb-write-failed');
    });
  } catch {
    /* never throw into the chat path */
  }
}

/**
 * Record ONE safe, non-recursive `local_diag_error` lifecycle event for a
 * diagnostics-subsystem failure. `reason` must be a fixed code — never a raw
 * error message from storage/file APIs.
 */
export function recordDiagInternalError(reason: string): void {
  try {
    if (reportedInternalErrors.has(reason)) return;
    reportedInternalErrors.add(reason);
    suppressLocalPersist = true;
    try {
      lifecycle('local_diag_error', reason);
    } finally {
      suppressLocalPersist = false;
    }
  } catch {
    /* never throw */
  }
}

/** Register/unregister the optional live file-log sink (diagnostics-live-log.ts). */
export function setLiveLogSink(sink: ((evt: DiagEvent) => void) | null): void {
  liveLogSink = sink;
}

/** Record a socket/browser lifecycle event. */
export function lifecycle(event: LifecycleEventName, reason?: string): void {
  record({ kind: 'lifecycle', event, reason: trunc(reason, 160) });
}

/** Record a chat-send phase transition (called only from outbox.ts). */
export function chatSendPhase(args: {
  clientMessageId: string;
  conversationId: string;
  sendOrigin: SendOrigin;
  phase: ChatSendPhase;
  deliveryState?: string;
  attempt?: number;
  reason?: string;
}): void {
  record({
    kind: 'chat_send',
    phase: args.phase,
    sendOrigin: args.sendOrigin,
    clientMessageId: trunc(args.clientMessageId, 64),
    conversationId: trunc(args.conversationId, 64),
    deliveryState: trunc(args.deliveryState, 32),
    attempt: typeof args.attempt === 'number' ? args.attempt : undefined,
    reason: trunc(args.reason, 160),
  });
}

// ─── Delivery to server (buffered, ack-confirmed, never blocking) ──────────────

let lastFlushAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;
let inPageHide = false;

function scheduleFlush(): void {
  try {
    if (!ENABLED || flushTimer !== null || flushInFlight || inPageHide) return;
    const s = attachedSocket;
    if (!s || !s.connected || buffer.length === 0) return;
    const wait = Math.max(0, lastFlushAt + FLUSH_MIN_INTERVAL_MS - Date.now());
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushNow();
    }, wait);
  } catch {
    /* never throw */
  }
}

function flushNow(): void {
  try {
    const s = attachedSocket;
    if (!ENABLED || !s || !s.connected || inPageHide || flushInFlight || buffer.length === 0) return;
    flushInFlight = true;
    lastFlushAt = Date.now();
    const events = buffer.slice(0, MAX_BUFFER);
    const upToSeq = events[events.length - 1]!.seq;
    let settled = false;
    const timer = setTimeout(() => {
      // No ack — keep the events; they will be retried on a later connect/flush.
      if (!settled) {
        settled = true;
        flushInFlight = false;
      }
    }, FLUSH_ACK_TIMEOUT_MS);
    s.emit(
      SOCKET_EVENTS.CHAT_CLIENT_DIAGNOSTICS,
      { pageInstanceId, browserSessionId: getBrowserSessionId(), events },
      (ack: { ok?: boolean; acceptedIds?: string[] } | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        flushInFlight = false;
        if (ack && ack.ok === true) {
          // Local records are kept until normal retention pruning — only the
          // serverReceived flag flips, so an on-site export still shows the
          // complete timeline including everything the server already has.
          // Prefer the server's explicit acceptedIds; fall back to locally
          // derived ids when talking to an older API build.
          const ids = Array.isArray(ack.acceptedIds)
            ? ack.acceptedIds.filter((id): id is string => typeof id === 'string')
            : events.map((e) => diagnosticEventIdOf(e));
          void markDiagEventsServerReceived(ids);
          // Clear ONLY confirmed events (anything recorded during the flush stays).
          buffer = buffer.filter((e) => e.seq > upToSeq);
          persist();
          if (buffer.length > 0) scheduleFlush();
        }
        // ok:false (rate-limited / rejected): retain and retry later.
      },
    );
  } catch {
    flushInFlight = false; // telemetry failure must never block anything
  }
}

// ─── Socket + window wiring ────────────────────────────────────────────────────

const attachedSockets = new WeakSet<Socket>();
let windowHooked = false;

function attachWindowListenersOnce(): void {
  if (windowHooked || typeof window === 'undefined') return;
  windowHooked = true;
  try {
    window.addEventListener('online', () => lifecycle('browser_online'));
    window.addEventListener('offline', () => lifecycle('browser_offline'));
    window.addEventListener('pagehide', () => {
      inPageHide = true; // never send diagnostics during pagehide — buffer only
      lifecycle('pagehide');
    });
    window.addEventListener('pageshow', (e) => {
      inPageHide = false;
      lifecycle('pageshow', (e as PageTransitionEvent).persisted ? 'bfcache' : 'load');
      scheduleFlush();
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () =>
        lifecycle('visibilitychange', document.visibilityState),
      );
    }
  } catch {
    /* never throw */
  }
}

function errReason(err: unknown): string {
  const msg = (err as Error | undefined)?.message ?? err;
  return String(msg ?? 'unknown');
}

/**
 * Attach lifecycle listeners + the flush-on-connect hook to the shared socket.
 * Idempotent per socket instance; safe to call on every getSocket().
 * Pure observation — never alters reconnect/retry behavior.
 */
export function attachSocketDiagnostics(socket: Socket): void {
  if (!ENABLED) return;
  try {
    attachedSocket = socket;
    if (attachedSockets.has(socket)) return;
    attachedSockets.add(socket);

    socket.on('connect', () => {
      lifecycle('socket_connect');
      scheduleFlush(); // confirmed connect → flush buffered events as one batch
    });
    socket.on('disconnect', (reason) => lifecycle('socket_disconnect', String(reason)));
    socket.on('connect_error', (err) => lifecycle('connect_error', errReason(err)));

    const mgr = socket.io;
    mgr.on('reconnect_attempt', (n: number) => lifecycle('reconnect_attempt', `attempt-${n}`));
    mgr.on('reconnect_error', (err: unknown) => lifecycle('reconnect_error', errReason(err)));
    mgr.on('reconnect_failed', () => lifecycle('reconnect_failed'));
    mgr.on('reconnect', (n: number) => lifecycle('reconnect_success', `after-${n}-attempts`));

    attachWindowListenersOnce();
  } catch {
    /* diagnostics wiring must never break socket creation */
  }
}

// ─── Test-only helpers ─────────────────────────────────────────────────────────

/** Test-only: current in-memory buffer. */
export function __getDiagnosticsBufferForTests(): readonly DiagEvent[] {
  return buffer;
}

/** Test-only: reset all module state (buffer, timers, attached socket). */
export function __resetDiagnosticsForTests(): void {
  buffer = [];
  seqCounter = 0;
  restored = true; // don't re-restore stale sessionStorage into a reset test
  lastFlushAt = 0;
  flushInFlight = false;
  inPageHide = false;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  attachedSocket = null;
  cachedBsid = null;
  suppressLocalPersist = false;
  reportedInternalErrors.clear();
  liveLogSink = null;
}
