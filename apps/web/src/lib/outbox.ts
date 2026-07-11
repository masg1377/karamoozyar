'use client';

import api from './api-client';
import { getSocket } from './socket-client';
import { chatSendPhase, type SendOrigin } from './socket-diagnostics';
import { useChatStore } from '@/store/chat.store';
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

// Bound how long we wait for a reconnect before giving up on an
// `awaiting-reconnect` message entirely (wall-clock cap, independent of the
// reconnect-cycle cap below).
const RECONNECT_MAX_WAIT_MS = 60_000;
// Bound how many unsuccessful automatic reconnect-triggered retries a single
// message may accumulate before it is given up on and marked `failed`.
const RECONNECT_MAX_CYCLES = 3;

/**
 * Outbox — the single source of truth for sending and retrying chat messages.
 *
 * Lives at module scope (not inside a React component) so an in-flight or
 * failed message survives chat switches, component remounts, and reconnects.
 * Every outgoing item (text/image/file/voice) gets a stable `clientMessageId`
 * BEFORE anything is sent; that id is the optimistic message id AND the
 * server idempotency key, so manual retries and reconnect replays can never
 * create duplicate rows.
 */

const ACK_TIMEOUT_MS = 12_000;
// Bounded wait for a real `connect` before giving up on THIS attempt. Must be
// short relative to ACK_TIMEOUT_MS so a stalled reconnect fails fast instead
// of silently eating the whole ack budget.
const CONNECT_WAIT_MS = 5_000;

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
   * automatic reconnect retry or a manual retry (both of which re-run this
   * exact input) never re-uploads bytes that already landed in storage —
   * only the send/ack step is retried.
   */
  uploadedFile: UploadResponseDto | null;
}

type OutgoingInput = TextInput | MediaInput;

// Retained so retry can re-run without the component. Cleared on confirmed send.
const outbox = new Map<string, OutgoingInput>();

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

/**
 * Emit CHAT_SEND and await a durable, typed ack with a bounded timeout.
 *
 * Buffered-emit-on-reconnect is NOT relied on as the recovery path: if the
 * socket isn't connected right now, we explicitly drive a connect attempt and
 * wait a bounded amount of time for it. If that doesn't land, we fail this
 * attempt immediately with a real socket-state reason instead of silently
 * queuing the emit and burning the full ack timeout.
 */
async function emitSend(
  payload: SocketChatSendPayload,
  diag: { origin: SendOrigin; attempt?: number },
): Promise<SocketChatSendAck> {
  const socket = getSocket();
  ensureReconnectHook(socket);
  const cid = payload.clientMessageId;
  const base = {
    clientMessageId: cid,
    conversationId: payload.conversationId,
    sendOrigin: diag.origin,
    attempt: diag.attempt,
  };

  if (!socket.connected) {
    chatSendPhase({ ...base, phase: 'connect-wait-start' });
    const connected = await waitForConnection(socket, CONNECT_WAIT_MS);
    if (!connected) {
      chatSendPhase({ ...base, phase: 'connect-wait-timeout', reason: 'socket-not-connected' });
      return {
        ok: false,
        clientMessageId: cid,
        code: 'INTERNAL',
        error: 'socket-not-connected',
      };
    }
    chatSendPhase({ ...base, phase: 'connect-wait-success' });
  }

  chatSendPhase({ ...base, phase: 'send-emitted', deliveryState: 'sending' });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ack: SocketChatSendAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    };
    const timer = setTimeout(() => {
      chatSendPhase({ ...base, phase: 'ack-timeout' });
      finish({
        ok: false,
        clientMessageId: cid,
        code: 'INTERNAL',
        error: 'timeout',
      });
    }, ACK_TIMEOUT_MS);
    socket.emit(SOCKET_EVENTS.CHAT_SEND, payload, (ack: SocketChatSendAck) => {
      const resolved: SocketChatSendAck =
        ack ?? { ok: false, clientMessageId: cid, code: 'INTERNAL', error: 'no-ack' };
      if (resolved.ok) {
        chatSendPhase({ ...base, phase: 'ack-success', deliveryState: 'sent' });
      } else {
        chatSendPhase({ ...base, phase: 'server-rejection', reason: resolved.code });
      }
      finish(resolved);
    });
  });
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

/**
 * True for an ack that failed because the transport itself never delivered
 * it — never connected in time, or no ack arrived within the ack budget
 * (the two failure modes `emitSend` can produce for connection loss:
 * reconnect timeout / transport close / ping timeout all surface as one of
 * these, since `emitSend` always drives an explicit connect+ack cycle rather
 * than trusting socket.io's own buffered-emit-on-reconnect).
 *
 * False for anything the server actually looked at and rejected (VALIDATION,
 * FORBIDDEN, NOT_FOUND, ATTACHMENT, or an explicit INTERNAL error body) — those
 * are real failures and must never be treated as a connectivity blip.
 */
function isConnectivityFailure(ack: SocketChatSendAck): boolean {
  return !ack.ok && ack.code === 'INTERNAL' && (ack.error === 'socket-not-connected' || ack.error === 'timeout');
}

type SendOutcome =
  | { kind: 'ok'; message: MessageDto }
  | { kind: 'connectivity' }
  | { kind: 'failed' };

/**
 * Run upload (media) + emit + ack. Does NOT touch delivery state beyond the
 * transient `uploading`/`sending` steps — the caller decides what a given
 * outcome means for the message (first send vs. reconnect retry vs. manual
 * retry all react differently to a connectivity outcome).
 */
async function performSend(
  input: OutgoingInput,
  diag: { origin: SendOrigin; attempt?: number },
): Promise<SendOutcome> {
  const store = useChatStore.getState();
  const cid = input.clientMessageId;
  const base = {
    clientMessageId: cid,
    conversationId: input.conversationId,
    sendOrigin: diag.origin,
    attempt: diag.attempt,
  };

  try {
    let upload: UploadResponseDto | undefined;

    if (input.kind === 'media') {
      if (input.uploadedFile) {
        // Already uploaded on a prior attempt (e.g. the ack step failed after
        // a successful upload) — reuse it. Only the send/ack is retried, never
        // the bytes: avoids re-uploading on every automatic reconnect cycle
        // and the orphaned-storage-object risk that would come with it.
        upload = input.uploadedFile;
      } else {
        store.setDeliveryState(input.conversationId, cid, 'uploading');
        chatSendPhase({ ...base, phase: 'upload-start', deliveryState: 'uploading' });
        try {
          const form = new FormData();
          form.append('file', input.file);
          const res = await api.post<{ data: UploadResponseDto }>(
            `/uploads/message-attachment?conversationId=${input.conversationId}`,
            form,
            { headers: { 'Content-Type': 'multipart/form-data' } },
          );
          upload = res.data.data;
          input.uploadedFile = upload; // cache on the shared outbox entry for any future retry
          chatSendPhase({ ...base, phase: 'upload-success' });
        } catch (err) {
          // Status code only — never the URL, file name, or response body.
          const status = (err as { response?: { status?: number } })?.response?.status;
          chatSendPhase({
            ...base,
            phase: 'upload-error',
            reason: status ? `http-${status}` : 'upload-network-error',
          });
          throw err;
        }
      }
    }

    store.setDeliveryState(input.conversationId, cid, 'sending');
    const ack = await emitSend(buildPayload(input, upload), diag);

    if (ack.ok && ack.message) return { kind: 'ok', message: ack.message };
    if (isConnectivityFailure(ack)) return { kind: 'connectivity' };
    return { kind: 'failed' };
  } catch {
    // Upload threw (network error, validation, etc.) — a real failure, never
    // an `awaiting-reconnect` candidate, per spec: upload failure fails now.
    return { kind: 'failed' };
  }
}

// ─── Reconnect tracking (awaiting-reconnect ⇄ failed) ──────────────────────────

interface ReconnectEntry {
  /** Unsuccessful automatic reconnect-triggered retries so far. */
  cycles: number;
  /** True while an automatic retry for this message is in flight, to make
   *  sure a single message is never retried twice concurrently (e.g. two
   *  `connect` events firing close together). */
  retrying: boolean;
  /** Wall-clock cap: forces `failed` even if `connect` never fires again. */
  deadline: ReturnType<typeof setTimeout>;
}

const awaitingReconnect = new Map<string, ReconnectEntry>();

/** First entry into `awaiting-reconnect` for this message: start its budget. */
function enterAwaitingReconnect(conversationId: string, cid: string, origin: SendOrigin): void {
  if (!awaitingReconnect.has(cid)) {
    const deadline = setTimeout(() => forceFail(conversationId, cid), RECONNECT_MAX_WAIT_MS);
    awaitingReconnect.set(cid, { cycles: 0, retrying: false, deadline });
  }
  chatSendPhase({
    clientMessageId: cid,
    conversationId,
    sendOrigin: origin,
    phase: 'enter-awaiting-reconnect',
    deliveryState: 'awaiting-reconnect',
    attempt: awaitingReconnect.get(cid)?.cycles,
  });
  useChatStore.getState().setDeliveryState(conversationId, cid, 'awaiting-reconnect');
}

function clearReconnectTracking(cid: string): void {
  const entry = awaitingReconnect.get(cid);
  if (!entry) return;
  clearTimeout(entry.deadline);
  awaitingReconnect.delete(cid);
}

function forceFail(conversationId: string, cid: string): void {
  const entry = awaitingReconnect.get(cid);
  if (!entry) return; // already resolved by a retry
  clearReconnectTracking(cid);
  chatSendPhase({
    clientMessageId: cid,
    conversationId,
    sendOrigin: 'auto-reconnect-retry',
    phase: 'force-failed',
    deliveryState: 'failed',
    attempt: entry.cycles,
    reason: 'reconnect-60s-cap-elapsed',
  });
  useChatStore.getState().setDeliveryState(conversationId, cid, 'failed');
}

/** Attempt one automatic retry for a single `awaiting-reconnect` message. */
async function attemptReconnectRetry(cid: string): Promise<void> {
  const entry = awaitingReconnect.get(cid);
  const input = outbox.get(cid);
  if (!entry || !input) {
    clearReconnectTracking(cid);
    return;
  }
  if (entry.retrying) return; // already retrying this cycle — never double-send
  entry.retrying = true;

  const store = useChatStore.getState();
  const attempt = entry.cycles + 1;
  chatSendPhase({
    clientMessageId: cid,
    conversationId: input.conversationId,
    sendOrigin: 'auto-reconnect-retry',
    phase: 'auto-retry-start',
    deliveryState: 'awaiting-reconnect',
    attempt,
  });
  // performSend sets the transient uploading/sending state itself.
  const outcome = await performSend(input, { origin: 'auto-reconnect-retry', attempt });
  entry.retrying = false;

  if (outcome.kind === 'ok') {
    clearReconnectTracking(cid);
    store.reconcile(input.conversationId, { ...(outcome.message as ChatMessage), deliveryState: 'sent' });
    outbox.delete(cid);
    return;
  }
  if (outcome.kind === 'failed') {
    clearReconnectTracking(cid);
    store.setDeliveryState(input.conversationId, cid, 'failed');
    return;
  }

  // Still a connectivity failure — count this cycle; the deadline timer set
  // in enterAwaitingReconnect keeps running independently (60s wall clock).
  const current = awaitingReconnect.get(cid);
  if (!current) return; // deadline fired concurrently and already forced failed
  current.cycles += 1;
  if (current.cycles >= RECONNECT_MAX_CYCLES) {
    clearReconnectTracking(cid);
    chatSendPhase({
      clientMessageId: cid,
      conversationId: input.conversationId,
      sendOrigin: 'auto-reconnect-retry',
      phase: 'force-failed',
      deliveryState: 'failed',
      attempt: current.cycles,
      reason: 'reconnect-cycles-exhausted',
    });
    store.setDeliveryState(input.conversationId, cid, 'failed');
  } else {
    store.setDeliveryState(input.conversationId, cid, 'awaiting-reconnect');
  }
}

/** On a confirmed `connect`, retry every `awaiting-reconnect` message once. */
function retryAllAwaitingReconnect(): void {
  for (const cid of Array.from(awaitingReconnect.keys())) {
    void attemptReconnectRetry(cid);
  }
}

// Attach the reconnect-retry listener exactly once per socket instance (a
// WeakSet, not a module boolean, so a fresh socket created after logout/
// reconnectSocket() still gets the hook — see socket-client.ts).
const reconnectHookSockets = new WeakSet<Socket>();
function ensureReconnectHook(socket: Socket): void {
  if (reconnectHookSockets.has(socket)) return;
  reconnectHookSockets.add(socket);
  socket.on('connect', retryAllAwaitingReconnect);
}

/** Run upload (media) + emit + ack, transitioning the optimistic message. */
async function run(input: OutgoingInput, origin: SendOrigin): Promise<void> {
  const store = useChatStore.getState();
  const cid = input.clientMessageId;
  const outcome = await performSend(input, { origin });

  if (outcome.kind === 'ok') {
    // Reconcile the optimistic item with the durable server row (dedup by id).
    clearReconnectTracking(cid);
    store.reconcile(input.conversationId, { ...(outcome.message as ChatMessage), deliveryState: 'sent' });
    outbox.delete(cid);
  } else if (outcome.kind === 'connectivity') {
    // Transport-level failure, not a real rejection: keep the optimistic
    // message visible as "awaiting reconnect" and let the connect listener
    // retry it automatically — do NOT mark it failed yet.
    enterAwaitingReconnect(input.conversationId, cid, origin);
  } else {
    // Real failure (validation/forbidden/upload/malformed/explicit backend
    // error). Keep visible + retryable. Do NOT auto-retry in the background.
    clearReconnectTracking(cid);
    store.setDeliveryState(input.conversationId, cid, 'failed');
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
  chatSendPhase({
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
  chatSendPhase({
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

/** Manually retry a failed message. Reuses the same clientMessageId (idempotent). */
export function retryMessage(conversationId: string, clientMessageId: string): void {
  const input = outbox.get(clientMessageId);
  if (!input) return;
  const state = useChatStore.getState();
  const list = state.messages[conversationId] ?? [];
  const current = list.find((m) => m.clientMessageId === clientMessageId || m.id === clientMessageId);
  if (current && current.deliveryState !== 'failed') return; // only retry failed
  chatSendPhase({
    clientMessageId,
    conversationId,
    sendOrigin: 'manual-retry',
    phase: 'manual-retry-start',
    deliveryState: current?.deliveryState,
  });
  state.setDeliveryState(conversationId, clientMessageId, input.kind === 'media' ? 'uploading' : 'sending');
  void run(input, 'manual-retry');
}

/** True if a failed message can still be retried (its input is retained). */
export function canRetry(clientMessageId: string): boolean {
  return outbox.has(clientMessageId);
}

/**
 * Test-only: reset all module-scoped outbox/reconnect state between test
 * cases. The outbox and reconnect-cycle tracking intentionally live at
 * module scope in production (they must survive component remounts), which
 * means they also persist across tests in the same file unless cleared.
 * Never call this outside tests.
 */
export function __resetOutboxForTests(): void {
  outbox.clear();
  for (const cid of Array.from(awaitingReconnect.keys())) clearReconnectTracking(cid);
}
