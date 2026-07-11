/**
 * Strict validation for `chat:client-diagnostics` batches.
 *
 * Everything is allowlist-based: only known keys, known lifecycle event names,
 * known chat-send phases, and known send origins are accepted; any unknown key
 * on any event rejects the whole batch. This is the hard guarantee that no
 * message content, file name, URL, token, phone number, or profile field can
 * enter the server logs through this channel — such payloads are structurally
 * impossible to submit.
 *
 * Pure functions only (no Nest deps) so this is trivially unit-testable.
 */

export const DIAG_MAX_EVENTS_PER_BATCH = 100;
export const DIAG_MIN_BATCH_INTERVAL_MS = 10_000;

export const DIAG_LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  'socket_connect',
  'socket_disconnect',
  'reconnect_attempt',
  'reconnect_error',
  'reconnect_failed',
  'reconnect_success',
  'connect_error',
  'browser_online',
  'browser_offline',
  'visibilitychange',
  'pagehide',
  'pageshow',
  // Client-side diagnostics-subsystem failure marker (IndexedDB/FS Access API
  // fallback) — reason carries a fixed safe code only.
  'local_diag_error',
]);

export const DIAG_CHAT_SEND_PHASES: ReadonlySet<string> = new Set([
  'optimistic-inserted',
  'upload-start',
  'upload-success',
  'upload-error',
  'connect-wait-start',
  'connect-wait-success',
  'connect-wait-timeout',
  'send-emitted',
  'ack-success',
  'ack-timeout',
  'server-rejection',
  'enter-awaiting-reconnect',
  'auto-retry-start',
  'manual-retry-start',
  'force-failed',
  'state-change',
]);

export const DIAG_SEND_ORIGINS: ReadonlySet<string> = new Set([
  'new-message',
  'manual-retry',
  'auto-reconnect-retry',
]);

/** Closed key set — must mirror DiagEvent in apps/web socket-diagnostics.ts. */
const ALLOWED_EVENT_KEYS: ReadonlySet<string> = new Set([
  'seq',
  'ts',
  'kind',
  'pageInstanceId',
  'browserSessionId',
  'event',
  'phase',
  'sendOrigin',
  'clientMessageId',
  'conversationId',
  'deliveryState',
  'attempt',
  'reason',
  'socketId',
  'connected',
  'active',
  'reconnecting',
  'readyState',
  'transport',
  'visibility',
  'online',
  'path',
]);

const STRING_MAX: Readonly<Record<string, number>> = {
  pageInstanceId: 64,
  browserSessionId: 64,
  event: 32,
  phase: 32,
  sendOrigin: 32,
  clientMessageId: 64,
  conversationId: 64,
  deliveryState: 32,
  reason: 160,
  socketId: 64,
  readyState: 16,
  transport: 24,
  visibility: 16,
  path: 120,
};

const BOOL_KEYS = new Set(['connected', 'active', 'reconnecting', 'online']);
const NUM_KEYS = new Set(['seq', 'ts', 'attempt']);

export interface DiagBatch {
  pageInstanceId: string;
  browserSessionId: string;
  events: Record<string, unknown>[];
}

export type DiagValidation = { ok: true; batch: DiagBatch } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validId(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length >= 2 && v.length <= max;
}

function validateEvent(e: unknown, index: number): string | null {
  if (!isPlainObject(e)) return `event[${index}] not an object`;

  for (const key of Object.keys(e)) {
    if (!ALLOWED_EVENT_KEYS.has(key)) return `event[${index}] unknown key "${key}"`;
    const value = e[key];
    if (value === undefined || value === null) continue;
    if (BOOL_KEYS.has(key) && typeof value !== 'boolean') return `event[${index}].${key} not boolean`;
    if (NUM_KEYS.has(key) && (typeof value !== 'number' || !Number.isFinite(value)))
      return `event[${index}].${key} not a finite number`;
    const max = STRING_MAX[key];
    if (max !== undefined && (typeof value !== 'string' || value.length > max))
      return `event[${index}].${key} invalid string`;
    if (key === 'kind' && value !== 'lifecycle' && value !== 'chat_send')
      return `event[${index}].kind invalid`;
  }

  const kind = e['kind'];
  if (kind !== 'lifecycle' && kind !== 'chat_send') return `event[${index}] missing kind`;
  if (typeof e['ts'] !== 'number' || typeof e['seq'] !== 'number')
    return `event[${index}] missing ts/seq`;

  if (kind === 'lifecycle') {
    if (!DIAG_LIFECYCLE_EVENTS.has(e['event'] as string))
      return `event[${index}] unknown lifecycle event`;
  } else {
    if (!DIAG_CHAT_SEND_PHASES.has(e['phase'] as string))
      return `event[${index}] unknown chat-send phase`;
    if (e['sendOrigin'] !== undefined && !DIAG_SEND_ORIGINS.has(e['sendOrigin'] as string))
      return `event[${index}] unknown sendOrigin`;
  }
  return null;
}

/** Validate an incoming diagnostics batch. Rejects the whole batch on the
 *  first malformed event — a partially-trusted batch is not worth logging. */
export function validateDiagnosticsBatch(payload: unknown): DiagValidation {
  if (!isPlainObject(payload)) return { ok: false, error: 'payload not an object' };

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (key !== 'pageInstanceId' && key !== 'browserSessionId' && key !== 'events')
      return { ok: false, error: `unknown batch key "${key}"` };
  }

  if (!validId(payload['pageInstanceId'], 64)) return { ok: false, error: 'invalid pageInstanceId' };
  if (!validId(payload['browserSessionId'], 64))
    return { ok: false, error: 'invalid browserSessionId' };

  const events = payload['events'];
  if (!Array.isArray(events) || events.length === 0)
    return { ok: false, error: 'events must be a non-empty array' };
  if (events.length > DIAG_MAX_EVENTS_PER_BATCH)
    return { ok: false, error: `more than ${DIAG_MAX_EVENTS_PER_BATCH} events` };

  for (let i = 0; i < events.length; i++) {
    const err = validateEvent(events[i], i);
    if (err) return { ok: false, error: err };
  }

  return {
    ok: true,
    batch: {
      pageInstanceId: payload['pageInstanceId'] as string,
      browserSessionId: payload['browserSessionId'] as string,
      events: events as Record<string, unknown>[],
    },
  };
}
