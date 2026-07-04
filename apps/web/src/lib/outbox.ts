'use client';

import api from './api-client';
import { getSocket } from './socket-client';
import { socketDiagnostics } from './socket-diagnostics';
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
async function emitSend(payload: SocketChatSendPayload): Promise<SocketChatSendAck> {
  const socket = getSocket();

  if (!socket.connected) {
    const connected = await waitForConnection(socket, CONNECT_WAIT_MS);
    if (!connected) {
      socketDiagnostics.reconnectFailed(payload.clientMessageId, socket.id);
      return {
        ok: false,
        clientMessageId: payload.clientMessageId,
        code: 'INTERNAL',
        error: 'socket-not-connected',
      };
    }
  }

  socketDiagnostics.sendEmitted(payload.clientMessageId, socket.id);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ack: SocketChatSendAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    };
    const timer = setTimeout(() => {
      socketDiagnostics.ackTimeout(payload.clientMessageId, socket.id);
      finish({
        ok: false,
        clientMessageId: payload.clientMessageId,
        code: 'INTERNAL',
        error: 'timeout',
      });
    }, ACK_TIMEOUT_MS);
    socket.emit(SOCKET_EVENTS.CHAT_SEND, payload, (ack: SocketChatSendAck) => {
      const resolved: SocketChatSendAck =
        ack ?? { ok: false, clientMessageId: payload.clientMessageId, code: 'INTERNAL', error: 'no-ack' };
      socketDiagnostics.ackReceived(payload.clientMessageId, socket.id, resolved.ok, resolved.code);
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

/** Run upload (media) + emit + ack, transitioning the optimistic message. */
async function run(input: OutgoingInput): Promise<void> {
  const store = useChatStore.getState();
  const cid = input.clientMessageId;

  try {
    let upload: UploadResponseDto | undefined;

    if (input.kind === 'media') {
      store.setDeliveryState(input.conversationId, cid, 'uploading');
      const form = new FormData();
      form.append('file', input.file);
      const res = await api.post<{ data: UploadResponseDto }>(
        `/uploads/message-attachment?conversationId=${input.conversationId}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      upload = res.data.data;
    }

    store.setDeliveryState(input.conversationId, cid, 'sending');
    const ack = await emitSend(buildPayload(input, upload));

    if (ack.ok && ack.message) {
      // Reconcile the optimistic item with the durable server row (dedup by id).
      store.reconcile(input.conversationId, { ...(ack.message as ChatMessage), deliveryState: 'sent' });
      outbox.delete(cid);
    } else {
      // Keep visible + retryable. Do NOT auto-retry in the background.
      store.setDeliveryState(input.conversationId, cid, 'failed');
    }
  } catch {
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
  void run(input);
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
  };
  outbox.set(input.clientMessageId, input);
  useChatStore.getState().insertOptimistic(args.conversationId, baseOptimistic(input));
  void run(input);
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
  const socket = getSocket();
  socketDiagnostics.retryAttempt(clientMessageId, socket.id, socket.connected);
  state.setDeliveryState(conversationId, clientMessageId, input.kind === 'media' ? 'uploading' : 'sending');
  void run(input);
}

/** True if a failed message can still be retried (its input is retained). */
export function canRetry(clientMessageId: string): boolean {
  return outbox.has(clientMessageId);
}
