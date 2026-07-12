'use client';

import api from './api-client';
import {
  getSocket,
  getSocketGeneration,
  markSocketUnhealthy,
  hardRebuildSocket,
} from './socket-client';
import { chatSendPhase, type SendOrigin } from './socket-diagnostics';
import { useChatStore } from '@/store/chat.store';
import { useAuthStore } from '@/store/auth.store';
import { generateClientMessageId, baseMimeType, extensionForMime } from './utils';
import {
  SOCKET_EVENTS,
  MessageType,
  MessageStatus,
} from '@karamooziyar/shared';
import type {
  MessageDto,
  ReplyMessageDto,
  SocketChatSendPayload,
  SocketChatSendAck,
  UploadResponseDto,
} from '@karamooziyar/shared';
import type { ChatMessage } from '@/store/chat.store';
import type { Socket } from 'socket.io-client';

/**
 * Outbox — the single source of truth for sending and retrying chat messages.
 *
 * Lives at module scope (not inside a React component) so an in-flight or
 * failed message survives chat switches, component remounts, and reconnects.
 * Every outgoing item (text/image/file/voice) gets a stable `clientMessageId`
 * BEFORE anything is sent; that id is the optimistic message id AND the
 * server idempotency key, so manual retries and automatic recovery can never
 * create duplicate rows.
 *
 * ── Zombie-socket recovery (production evidence) ────────────────────────────
 * `socket.connected === true` is NOT sufficient proof the current transport
 * can deliver outgoing events: a connected-looking socket (Engine.IO
 * readyState "open", transport "websocket") can silently stop delivering
 * CHAT_SEND events with no ack, no error, and no disconnect. Recovery from
 * that state requires actually replacing the Socket.IO client (see
 * `hardRebuildSocket` in socket-client.ts) — never just retrying on the same
 * socket, and never trusting `socket.connected` at face value.
 *
 * Bounded policy per automatic send cycle:
 *   - up to 8s waiting for a CHAT_SEND ack
 *   - at most 1 hard socket rebuild (bounded to 5s to confirm a fresh connect)
 *   - at most 2 CHAT_SEND emits total
 *   - then fail clearly — never retry indefinitely, never rebuild repeatedly.
 */

// Production timing. Kept as a mutable object (not bare consts) solely so
// real-network integration/soak tests (real Socket.IO server + client, no
// mocks) can scale the wall-clock budget down instead of literally waiting
// 8+5+8 seconds per zombie message — the fake-timer unit tests are the ones
// that verify these exact production values. Never overridden outside tests.
let timing = {
  CHAT_SEND_ACK_TIMEOUT_MS: 8_000,
  NORMAL_RECONNECT_GRACE_MS: 3_000,
  FRESH_SOCKET_CONNECT_TIMEOUT_MS: 5_000,
};
const MAX_HARD_SOCKET_REBUILDS_PER_SEND_CYCLE = 1;
const MAX_CHAT_SEND_EMITS_PER_SEND_CYCLE = 2;

export interface OutboxSender {
  id: string;
  firstName: string;
  lastName: string;
}

interface TextInput {
  kind: 'text';
  conversationId: string;
  clientMessageId: string;
  body: string;
  replyTo: MessageDto | null;
  sender: OutboxSender;
  createdAt: string;
}

interface MediaInput {
  kind: 'media';
  conversationId: string;
  clientMessageId: string;
  type: MessageType.IMAGE | MessageType.FILE | MessageType.VOICE;
  file: File;
  duration: number | null;
  previewUrl: string | null;
  replyTo: MessageDto | null;
  sender: OutboxSender;
  createdAt: string;
  /**
   * Cached result of a prior successful upload for this same clientMessageId.
   * Set once the upload step succeeds; checked before uploading again so an
   * automatic recovery cycle or a manual retry (both of which re-run this
   * exact input) never re-uploads bytes that already landed in storage —
   * only the send/ack step is retried.
   */
  uploadedFile: UploadResponseDto | null;
}

type OutgoingInput = TextInput | MediaInput;

// Retained so retry can re-run without the component. Cleared on confirmed send.
const outbox = new Map<string, OutgoingInput>();

// A clientMessageId currently running through a send cycle — guards against
// concurrent/duplicate emits for the same message (e.g. two `online` events,
// or a manual retry click while an automatic cycle is still in flight).
const inFlight = new Set<string>();

function toReplyDto(reply: MessageDto | null): ReplyMessageDto | null {
  if (!reply) return null;
  return {
    id: reply.id,
    senderId: reply.senderId,
    senderName: reply.senderName,
    type: reply.type,
    body: reply.body,
    deletedAt: reply.deletedAt,
    attachment: reply.attachment
      ? { fileName: reply.attachment.fileName, mimeType: reply.attachment.mimeType }
      : null,
  };
}

function baseOptimistic(input: OutgoingInput): ChatMessage {
  return {
    id: input.clientMessageId,
    clientMessageId: input.clientMessageId,
    conversationId: input.conversationId,
    senderId: input.sender.id,
    senderName: `${input.sender.firstName} ${input.sender.lastName}`,
    type: input.kind === 'text' ? MessageType.TEXT : input.type,
    body: input.kind === 'text' ? input.body : null,
    status: MessageStatus.SENT,
    isEdited: false,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    attachment:
      input.kind === 'media' && input.previewUrl
        ? {
            // `local_` id signals the renderer to use the in-memory preview URL
            // directly instead of requesting a signed URL.
            id: `local_${input.clientMessageId}`,
            fileName: input.file.name,
            fileUrl: input.previewUrl,
            mimeType: baseMimeType(input.file.type),
            fileSize: input.file.size,
            duration: input.duration,
          }
        : null,
    replyToMessage: toReplyDto(input.replyTo),
    createdAt: input.createdAt,
    deliveryState: 'sending',
  };
}

function buildPayload(input: OutgoingInput, upload?: UploadResponseDto): SocketChatSendPayload {
  if (input.kind === 'text') {
    return {
      conversationId: input.conversationId,
      type: MessageType.TEXT,
      body: input.body,
      clientMessageId: input.clientMessageId,
      tempId: input.clientMessageId,
      replyToMessageId: input.replyTo?.id,
    };
  }
  return {
    conversationId: input.conversationId,
    type: input.type,
    fileKey: upload!.fileKey,
    fileName: upload!.fileName,
    mimeType: upload!.mimeType,
    fileSize: upload!.fileSize,
    duration: input.type === MessageType.VOICE ? input.duration ?? undefined : undefined,
    clientMessageId: input.clientMessageId,
    tempId: input.clientMessageId,
    replyToMessageId: input.replyTo?.id,
  };
}

// ─── Session safety ──────────────────────────────────────────────────────────

function currentUserId(): string | null {
  try {
    return useAuthStore.getState().user?.id ?? null;
  } catch {
    return null;
  }
}

/** True while the same user/session that started this recovery is still the
 *  active one. A rebuild or retry started under one user must never complete
 *  and send after logout or a session/user change. */
function sessionStillValid(initiatingUserId: string | null): boolean {
  try {
    const s = useAuthStore.getState();
    return s.isAuthenticated === true && (s.user?.id ?? null) === initiatingUserId;
  } catch {
    return false;
  }
}

function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

// ─── Low-level connect / emit primitives ───────────────────────────────────

/**
 * Resolve once the socket is actually connected, or once `timeoutMs` elapses.
 *
 * Never trusts `socket.active` as a proxy for "a connect is imminent" — that
 * flag stays true for the entire lifetime of the automatic-reconnect backoff,
 * including while that backoff timer is stalled (backgrounded/suspended tab,
 * OS-throttled timers, a wedged transport). Instead this always issues an
 * explicit `socket.connect()` — a documented no-op if a connection attempt is
 * already in flight — and waits on the real `connect` event with a hard
 * bound, so a stuck Manager can't stall a retry indefinitely.
 */
function waitForConnection(socket: Socket, timeoutMs: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      resolve(ok);
    };
    const onConnect = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.once('connect', onConnect);
    socket.connect();
  });
}

type EmitResult =
  | { ok: true; message: MessageDto }
  | { ok: false; timedOut: true }
  | { ok: false; timedOut: false; code?: string; error?: string };

/**
 * Emit CHAT_SEND once and await a durable, typed ack with a bounded timeout.
 * The timer starts only once this is called — never before an upload (media)
 * or a connect/rebuild wait completes.
 *
 * A late ack that arrives after this attempt's own timeout already resolved
 * the promise is not lost: if it's a success, `onLateSuccess` is invoked so
 * the UI can still self-correct to `sent` (the backend's clientMessageId
 * idempotency guarantees it's the exact same row a newer attempt may also be
 * racing to confirm). A late failure/no-ack is simply ignored — a newer
 * attempt, or the terminal `failed` state, already owns this message's fate.
 */
function emitOnce(
  socket: Socket,
  payload: SocketChatSendPayload,
  timeoutMs: number,
  onLateSuccess: (message: MessageDto) => void,
): Promise<EmitResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: EmitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, timedOut: true }), timeoutMs);

    socket.emit(SOCKET_EVENTS.CHAT_SEND, payload, (ack: SocketChatSendAck) => {
      const resolved: SocketChatSendAck =
        ack ?? { ok: false, clientMessageId: payload.clientMessageId, code: 'INTERNAL', error: 'no-ack' };

      if (settled) {
        if (resolved.ok && resolved.message) onLateSuccess(resolved.message);
        return;
      }
      if (resolved.ok && resolved.message) {
        finish({ ok: true, message: resolved.message });
      } else {
        finish({ ok: false, timedOut: false, code: resolved.code, error: resolved.error });
      }
    });
  });
}

// ─── Failure classification ─────────────────────────────────────────────────

export type FailureReason =
  | 'offline'
  | 'socket-not-connected'
  | 'ack-timeout'
  | 'socket-rebuild-failed'
  | 'fresh-socket-connect-timeout'
  | 'fresh-socket-ack-timeout'
  | 'server-rejection'
  | 'upload-failed'
  | 'authentication-unavailable'
  | 'session-changed';

/** A manual Retry must not blindly reuse a socket generation that already
 *  failed for one of these reasons — it forces one rebuild first instead. */
const REBUILD_REQUIRING_REASONS: ReadonlySet<FailureReason> = new Set([
  'ack-timeout',
  'fresh-socket-ack-timeout',
  'socket-rebuild-failed',
  'fresh-socket-connect-timeout',
]);

interface FailureRecord {
  reason: FailureReason;
  generation: number;
}

const lastFailure = new Map<string, FailureRecord>();

type SendOutcome =
  | { kind: 'ok'; message: MessageDto }
  | { kind: 'offline' }
  | { kind: 'failed'; reason: FailureReason };

type DiagBase = (extra?: Record<string, unknown>) => Parameters<typeof chatSendPhase>[0];

function makeBase(cid: string, conversationId: string, origin: SendOrigin): DiagBase {
  return (extra = {}) =>
    ({ clientMessageId: cid, conversationId, sendOrigin: origin, ...extra }) as Parameters<
      typeof chatSendPhase
    >[0];
}

/**
 * Diagnostics must never affect the send/recovery path. `chatSendPhase`
 * itself is documented to never throw (every entry point in
 * socket-diagnostics.ts is wrapped in try/catch), but this call boundary
 * does not rely on that guarantee alone — every diagnostics call in this
 * file goes through this wrapper so a future diagnostics regression can
 * never interrupt message delivery (Gate 3 §20 / Gate 10).
 */
function safeDiag(event: Parameters<typeof chatSendPhase>[0]): void {
  try {
    chatSendPhase(event);
  } catch {
    /* diagnostics must never affect send/recovery */
  }
}

/** Idempotently land a late/duplicate ack. Never creates a duplicate (dedup
 *  by identity in the store) and never regresses a state a newer attempt
 *  already owns for a different reason — it only ever moves toward `sent`. */
function lateSuccessReconcile(conversationId: string, cid: string, message: MessageDto): void {
  useChatStore.getState().reconcile(conversationId, { ...(message as ChatMessage), deliveryState: 'sent' });
  outbox.delete(cid);
  lastFailure.delete(cid);
}

interface RebuildBudget {
  rebuilds: number;
  emits: number;
}

type RebuildOutcome =
  | { ok: true; socket: Socket; generation: number }
  | { ok: false; reason: FailureReason };

/**
 * Get a healthy, connected socket at a generation newer than `failedGeneration`.
 * If a concurrent send cycle already rebuilt in the meantime, reuses that
 * fresh connection for free (no extra rebuild spent). Otherwise performs the
 * one hard rebuild this cycle's budget allows.
 */
async function ensureFreshSocket(
  base: DiagBase,
  budget: RebuildBudget,
  reason: string,
  failedSocketId: string | undefined,
  failedGeneration: number,
): Promise<RebuildOutcome> {
  const liveSocket = getSocket();
  const liveGeneration = getSocketGeneration();
  if (liveGeneration > failedGeneration && liveSocket.connected) {
    safeDiag(
      base({
        phase: 'retry-after-socket-rebuild',
        oldSocketId: failedSocketId,
        oldSocketGeneration: failedGeneration,
        newSocketId: liveSocket.id,
        newSocketGeneration: liveGeneration,
        rebuildReason: 'concurrent-rebuild-reused',
      }),
    );
    return { ok: true, socket: liveSocket, generation: liveGeneration };
  }

  if (budget.rebuilds >= MAX_HARD_SOCKET_REBUILDS_PER_SEND_CYCLE) {
    return { ok: false, reason: 'socket-rebuild-failed' };
  }
  budget.rebuilds += 1;

  try {
    const socket = await hardRebuildSocket(reason, timing.FRESH_SOCKET_CONNECT_TIMEOUT_MS);
    const generation = getSocketGeneration();
    safeDiag(
      base({
        phase: 'retry-after-socket-rebuild',
        oldSocketId: failedSocketId,
        oldSocketGeneration: failedGeneration,
        newSocketId: socket.id,
        newSocketGeneration: generation,
        rebuildReason: reason,
      }),
    );
    return { ok: true, socket, generation };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'socket-rebuild-failed';
    const failureReason: FailureReason =
      msg === 'session-changed'
        ? 'session-changed'
        : msg === 'fresh-socket-connect-timeout'
          ? 'fresh-socket-connect-timeout'
          : 'socket-rebuild-failed';
    safeDiag(base({ phase: 'recovery-aborted', reason: failureReason, failureReason }));
    return { ok: false, reason: failureReason };
  }
}

interface AttemptOptions {
  /** Manual retry after a failure whose recorded socket generation is not
   *  older than the current one — force one rebuild before the first emit
   *  instead of spending 8s emitting on a socket already known to be bad. */
  forceRebuildFirst?: boolean;
}

/**
 * Run upload (media, cached) + connect/rebuild as needed + the bounded
 * CHAT_SEND emit cycle (≤2 emits, ≤1 hard rebuild). Does not itself touch
 * terminal store state beyond the transient uploading/sending/rebuilding/
 * retrying delivery states — the caller (`run`) decides what an outcome
 * means (first send vs. offline-resume vs. manual retry all react the same
 * way to the same outcome shape).
 */
async function attemptDeliver(
  input: OutgoingInput,
  origin: SendOrigin,
  initiatingUserId: string | null,
  opts: AttemptOptions = {},
): Promise<SendOutcome> {
  const cid = input.clientMessageId;
  const convId = input.conversationId;
  const store = useChatStore.getState();
  const base = makeBase(cid, convId, origin);

  if (isOffline()) return { kind: 'offline' };
  if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };

  // ── Upload (media only) — never repeated once cached ──
  let upload: UploadResponseDto | undefined;
  if (input.kind === 'media') {
    if (input.uploadedFile) {
      upload = input.uploadedFile;
    } else {
      store.setDeliveryState(convId, cid, 'uploading');
      safeDiag(base({ phase: 'upload-start', deliveryState: 'uploading' }));
      try {
        const form = new FormData();
        form.append('file', input.file);
        const res = await api.post<{ data: UploadResponseDto }>(
          `/uploads/message-attachment?conversationId=${convId}`,
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        upload = res.data.data;
        input.uploadedFile = upload; // cache on the shared outbox entry for any future retry
        safeDiag(base({ phase: 'upload-success' }));
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        safeDiag(base({ phase: 'upload-error', reason: status ? `http-${status}` : 'upload-network-error' }));
        return { kind: 'failed', reason: 'upload-failed' };
      }
    }
  }

  // Connectivity/session could have changed while the upload was in flight —
  // the ack timer must never start on a request we already know can't land.
  if (isOffline()) return { kind: 'offline' };
  if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };

  const budget: RebuildBudget = { rebuilds: 0, emits: 0 };
  let socket = getSocket();
  let generation = getSocketGeneration();

  // ── Phase A: obtain a connected socket ──
  if (opts.forceRebuildFirst) {
    safeDiag(base({ phase: 'manual-retry-requires-fresh-socket', reason: 'stale-socket-generation' }));
    store.setDeliveryState(convId, cid, 'rebuilding-connection');
    const rebuilt = await ensureFreshSocket(base, budget, 'manual-retry-stale-generation', socket.id, generation);
    if (!rebuilt.ok) return { kind: 'failed', reason: rebuilt.reason };
    socket = rebuilt.socket;
    generation = rebuilt.generation;
  } else if (!socket.connected) {
    safeDiag(base({ phase: 'connect-wait-start', deliveryState: 'sending' }));
    const reconnected = await waitForConnection(socket, timing.NORMAL_RECONNECT_GRACE_MS);
    if (reconnected) {
      safeDiag(base({ phase: 'connect-wait-success' }));
      socket = getSocket();
      generation = getSocketGeneration();
    } else {
      if (isOffline()) return { kind: 'offline' };
      if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };
      safeDiag(base({ phase: 'connect-wait-timeout', reason: 'socket-not-connected' }));
      store.setDeliveryState(convId, cid, 'rebuilding-connection');
      const rebuilt = await ensureFreshSocket(base, budget, 'not-connected-grace-expired', socket.id, generation);
      if (!rebuilt.ok) return { kind: 'failed', reason: rebuilt.reason };
      socket = rebuilt.socket;
      generation = rebuilt.generation;
    }
  }

  if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };

  // ── Phase B: bounded emit cycle ──
  const payload = buildPayload(input, upload);

  for (;;) {
    if (budget.emits >= MAX_CHAT_SEND_EMITS_PER_SEND_CYCLE) {
      return { kind: 'failed', reason: 'ack-timeout' };
    }
    if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };

    budget.emits += 1;
    const attemptNumber = budget.emits;
    const isFirstAttempt = attemptNumber === 1;
    const attemptDeliveryState = isFirstAttempt ? 'sending' : 'retrying';
    store.setDeliveryState(convId, cid, attemptDeliveryState);
    safeDiag(base({ phase: 'send-emitted', deliveryState: attemptDeliveryState, attempt: attemptNumber }));

    const result = await emitOnce(socket, payload, timing.CHAT_SEND_ACK_TIMEOUT_MS, (msg) =>
      lateSuccessReconcile(convId, cid, msg),
    );

    if (result.ok) {
      safeDiag(
        base({
          phase: isFirstAttempt ? 'ack-success' : 'fresh-socket-ack-success',
          deliveryState: 'sent',
          attempt: attemptNumber,
        }),
      );
      return { kind: 'ok', message: result.message };
    }

    if (!result.timedOut) {
      safeDiag(base({ phase: 'server-rejection', reason: result.code, attempt: attemptNumber }));
      return { kind: 'failed', reason: 'server-rejection' };
    }

    const timeoutPhase = isFirstAttempt ? 'ack-timeout' : 'fresh-socket-ack-timeout';
    safeDiag(base({ phase: timeoutPhase, attempt: attemptNumber }));

    if (budget.emits >= MAX_CHAT_SEND_EMITS_PER_SEND_CYCLE) {
      return { kind: 'failed', reason: isFirstAttempt ? 'ack-timeout' : 'fresh-socket-ack-timeout' };
    }
    if (isOffline()) return { kind: 'offline' };
    if (!sessionStillValid(initiatingUserId)) return { kind: 'failed', reason: 'session-changed' };

    // Connected-socket ack timeout: the confirmed zombie condition. Never
    // trust `socket.connected` again for this attempt — mark it unhealthy
    // and get a fresh one (reusing a concurrent rebuild if one already
    // landed) before the one remaining emit.
    markSocketUnhealthy(socket.id, generation, 'ack-timeout');
    store.setDeliveryState(convId, cid, 'rebuilding-connection');
    const rebuilt = await ensureFreshSocket(base, budget, 'ack-timeout', socket.id, generation);
    if (!rebuilt.ok) return { kind: 'failed', reason: rebuilt.reason };
    socket = rebuilt.socket;
    generation = rebuilt.generation;
    // loop continues → the next emit uses the fresh socket
  }
}

// ─── Offline (browser) resume ───────────────────────────────────────────────

// cid → the origin to resume with once the browser comes back online.
const offlineWaiting = new Map<string, SendOrigin>();
let onlineHookAttached = false;

function ensureOnlineHook(): void {
  if (onlineHookAttached || typeof window === 'undefined') return;
  onlineHookAttached = true;
  window.addEventListener('online', () => {
    for (const [cid, origin] of Array.from(offlineWaiting.entries())) {
      offlineWaiting.delete(cid);
      const input = outbox.get(cid);
      if (!input) continue;
      safeDiag({
        clientMessageId: cid,
        conversationId: input.conversationId,
        sendOrigin: origin,
        phase: 'offline-resume',
        deliveryState: 'sending',
      });
      void run(input, origin);
    }
  });
}

function enterAwaitingConnection(conversationId: string, cid: string, origin: SendOrigin): void {
  ensureOnlineHook();
  offlineWaiting.set(cid, origin);
  safeDiag({
    clientMessageId: cid,
    conversationId,
    sendOrigin: origin,
    phase: 'offline-wait-start',
    deliveryState: 'awaiting-connection',
  });
  useChatStore.getState().setDeliveryState(conversationId, cid, 'awaiting-connection');
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/** Run one bounded send cycle (upload if needed + connect/rebuild as needed +
 *  the ≤2-emit ack cycle), transitioning the optimistic message accordingly.
 *  Guards against concurrent/duplicate emits for the same clientMessageId. */
async function run(input: OutgoingInput, origin: SendOrigin, opts: AttemptOptions = {}): Promise<void> {
  const cid = input.clientMessageId;
  if (inFlight.has(cid)) return; // already running a cycle for this message
  inFlight.add(cid);
  const initiatingUserId = currentUserId();
  const store = useChatStore.getState();

  try {
    const outcome = await attemptDeliver(input, origin, initiatingUserId, opts);

    if (outcome.kind === 'ok') {
      lastFailure.delete(cid);
      store.reconcile(input.conversationId, { ...(outcome.message as ChatMessage), deliveryState: 'sent' });
      outbox.delete(cid);
      return;
    }

    if (outcome.kind === 'offline') {
      enterAwaitingConnection(input.conversationId, cid, origin);
      return;
    }

    // A late ack from an EARLIER, abandoned attempt in this same cycle (see
    // `emitOnce`'s `onLateSuccess`) may have already reconciled this message
    // to `sent` — via a real server-confirmed row — while this cycle's own
    // (later) attempt was independently timing out toward this failure
    // branch. That success is the true, durable outcome (the server has the
    // message); the cycle's own terminal-failure tail must never regress a
    // delivered message back to `failed`.
    const nowList = useChatStore.getState().messages[input.conversationId] ?? [];
    const nowMsg = nowList.find((m) => m.clientMessageId === cid || m.id === cid);
    if (nowMsg?.deliveryState === 'sent') return;

    // Terminal failure for this cycle — remember the reason + the socket
    // generation it happened on so a manual Retry knows whether it must
    // force a fresh socket before trying again (§9).
    lastFailure.set(cid, { reason: outcome.reason, generation: getSocketGeneration() });
    safeDiag({
      clientMessageId: cid,
      conversationId: input.conversationId,
      sendOrigin: origin,
      phase: 'force-failed',
      deliveryState: 'failed',
      reason: outcome.reason,
      failureReason: outcome.reason,
    });
    store.setDeliveryState(input.conversationId, cid, 'failed');
  } finally {
    inFlight.delete(cid);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function sendText(args: {
  conversationId: string;
  body: string;
  sender: OutboxSender;
  replyTo?: MessageDto | null;
}): void {
  const input: TextInput = {
    kind: 'text',
    conversationId: args.conversationId,
    clientMessageId: generateClientMessageId(),
    body: args.body,
    replyTo: args.replyTo ?? null,
    sender: args.sender,
    createdAt: new Date().toISOString(),
  };
  outbox.set(input.clientMessageId, input);
  useChatStore.getState().insertOptimistic(args.conversationId, baseOptimistic(input));
  safeDiag({
    clientMessageId: input.clientMessageId,
    conversationId: args.conversationId,
    sendOrigin: 'new-message',
    phase: 'optimistic-inserted',
    deliveryState: 'sending',
  });
  void run(input, 'new-message');
}

export function sendMedia(args: {
  conversationId: string;
  type: MessageType.IMAGE | MessageType.FILE | MessageType.VOICE;
  file: File;
  duration?: number | null;
  sender: OutboxSender;
  replyTo?: MessageDto | null;
}): void {
  const isImage = args.type === MessageType.IMAGE;
  const previewUrl =
    isImage || args.type === MessageType.VOICE ? URL.createObjectURL(args.file) : null;
  const input: MediaInput = {
    kind: 'media',
    conversationId: args.conversationId,
    clientMessageId: generateClientMessageId(),
    type: args.type,
    file: args.file,
    duration: args.duration ?? null,
    previewUrl,
    replyTo: args.replyTo ?? null,
    sender: args.sender,
    createdAt: new Date().toISOString(),
    uploadedFile: null,
  };
  outbox.set(input.clientMessageId, input);
  useChatStore.getState().insertOptimistic(args.conversationId, baseOptimistic(input));
  safeDiag({
    clientMessageId: input.clientMessageId,
    conversationId: args.conversationId,
    sendOrigin: 'new-message',
    phase: 'optimistic-inserted',
    deliveryState: 'sending',
  });
  void run(input, 'new-message');
}

/**
 * Build a File for a recorded voice blob with a correct MIME + extension so it
 * passes the server's allow-list (which expects the bare `audio/...` type, not
 * `audio/webm;codecs=opus`).
 */
export function voiceFileFromBlob(blob: Blob, mimeType: string): { file: File; mime: string } {
  const mime = baseMimeType(mimeType || blob.type || 'audio/webm');
  const ext = extensionForMime(mime);
  const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mime });
  return { file, mime };
}

/**
 * Manually retry a failed message. Reuses the same clientMessageId
 * (idempotent). If the last failure happened on a socket generation that is
 * still the current one (i.e. nothing has rebuilt since), forces one
 * controlled hard rebuild before the first emit instead of spending another
 * 8s on a socket already known to be bad (§9).
 */
export function retryMessage(conversationId: string, clientMessageId: string): void {
  const input = outbox.get(clientMessageId);
  if (!input) return;
  if (inFlight.has(clientMessageId)) return;
  const state = useChatStore.getState();
  const list = state.messages[conversationId] ?? [];
  const current = list.find((m) => m.clientMessageId === clientMessageId || m.id === clientMessageId);
  if (current && current.deliveryState !== 'failed') return; // only retry failed

  const failure = lastFailure.get(clientMessageId);
  const forceRebuildFirst =
    !!failure &&
    REBUILD_REQUIRING_REASONS.has(failure.reason) &&
    failure.generation >= getSocketGeneration();

  safeDiag({
    clientMessageId,
    conversationId,
    sendOrigin: 'manual-retry',
    phase: 'manual-retry-start',
    deliveryState: current?.deliveryState,
  });
  state.setDeliveryState(conversationId, clientMessageId, input.kind === 'media' ? 'uploading' : 'sending');
  void run(input, 'manual-retry', { forceRebuildFirst });
}

/** True if a failed message can still be retried (its input is retained). */
export function canRetry(clientMessageId: string): boolean {
  return outbox.has(clientMessageId);
}

/**
 * Test-only: reset all module-scoped outbox state between test cases. The
 * outbox and recovery tracking intentionally live at module scope in
 * production (they must survive component remounts), which means they also
 * persist across tests in the same file unless cleared. Never call this
 * outside tests.
 */
export function __resetOutboxForTests(): void {
  outbox.clear();
  inFlight.clear();
  offlineWaiting.clear();
  lastFailure.clear();
  onlineHookAttached = false;
}

/**
 * Test-only: scale down the recovery timing budget for real-network
 * integration/soak tests (real Socket.IO server + client — no fake timers).
 * The exact production values (8000/3000/5000ms) are verified separately by
 * the fake-timer unit tests in outbox.test.ts, which never call this. Never
 * call outside tests.
 */
export function __setOutboxTimingForTests(overrides: Partial<typeof timing>): void {
  timing = { ...timing, ...overrides };
}

/** Test-only: restore the production timing values. Never call outside tests. */
export function __resetOutboxTimingForTests(): void {
  timing = {
    CHAT_SEND_ACK_TIMEOUT_MS: 8_000,
    NORMAL_RECONNECT_GRACE_MS: 3_000,
    FRESH_SOCKET_CONNECT_TIMEOUT_MS: 5_000,
  };
}
