import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server as IOServer, type Socket as ServerSocket } from 'socket.io';
import type { MessageDto, SocketChatSendAck, SocketChatSendPayload } from '@karamooziyar/shared';

/**
 * Shared real Socket.IO test-server harness for the zombie-recovery
 * integration/leak/concurrency/soak suites (Gate 4/5/6/11). Not used by
 * production code — test-only.
 */

export type SendHandler = (payload: SocketChatSendPayload, ack: (a: SocketChatSendAck) => void) => void;

export function serverMessageFor(payload: SocketChatSendPayload): MessageDto {
  return {
    id: `srv-${payload.clientMessageId}`,
    clientMessageId: payload.clientMessageId,
    conversationId: payload.conversationId,
    senderId: 'u1',
    senderName: 'Ali Rezaei',
    type: payload.type,
    body: payload.body ?? null,
    status: 'SENT',
    isEdited: false,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    attachment: null,
    replyToMessage: null,
    createdAt: new Date().toISOString(),
  } as MessageDto;
}

export class TestChatServer {
  http: HttpServer;
  io: IOServer;
  port = 0;
  /** Every physical connection the server has ever accepted, in order. */
  connections: ServerSocket[] = [];
  /** Every chat:send payload received, tagged with which connection index sent it. */
  received: { connIndex: number; socketId: string; payload: SocketChatSendPayload }[] = [];
  /** Per-connection-index override for how chat:send is handled. Defaults to immediate ack:true. */
  handlers = new Map<number, SendHandler>();
  /** Default per-message ack delay (ms) — 0 = synchronous ack. */
  defaultAckDelayMs = 0;
  /**
   * clientMessageId → "swallow the ack exactly once, on whichever connection
   * it first arrives on". Deterministic regardless of connection multiplexing
   * or send-loop timing (unlike a raw connection-index rule, which races when
   * many sends are dispatched in the same synchronous burst — see the soak
   * test). Entry is removed after the first swallowed attempt, so a message's
   * automatic retry on the rebuilt socket acks normally.
   */
  zombieOnceByClientMessageId = new Set<string>();

  private constructor() {
    this.http = createServer();
    this.io = new IOServer(this.http, { path: '/socket.io' });
  }

  static async start(): Promise<TestChatServer> {
    const s = new TestChatServer();
    s.io.on('connection', (socket) => {
      const connIndex = s.connections.length;
      s.connections.push(socket);
      socket.on('chat:send', (payload: SocketChatSendPayload, ack: (a: SocketChatSendAck) => void) => {
        s.received.push({ connIndex, socketId: socket.id, payload });

        if (s.zombieOnceByClientMessageId.has(payload.clientMessageId)) {
          s.zombieOnceByClientMessageId.delete(payload.clientMessageId);
          return; // deliberately never ack — the zombie condition, for this one attempt only
        }

        const handler = s.handlers.get(connIndex);
        if (handler) {
          handler(payload, ack);
        } else if (s.defaultAckDelayMs > 0) {
          setTimeout(
            () => ack({ ok: true, clientMessageId: payload.clientMessageId, message: serverMessageFor(payload) }),
            s.defaultAckDelayMs,
          );
        } else {
          ack({ ok: true, clientMessageId: payload.clientMessageId, message: serverMessageFor(payload) });
        }
      });
    });
    await new Promise<void>((resolve) => s.http.listen(0, resolve));
    s.port = (s.http.address() as AddressInfo).port;
    return s;
  }

  /** Never ack chat:send on this connection index — the zombie condition. */
  ignoreAcksOn(connIndex: number): void {
    this.handlers.set(connIndex, () => {
      /* deliberately never call ack() */
    });
  }

  /** Reset per-cycle bookkeeping without tearing down the real server. */
  resetBookkeeping(): void {
    this.connections = [];
    this.received = [];
    this.handlers.clear();
    this.zombieOnceByClientMessageId.clear();
  }

  async stop(): Promise<void> {
    this.io.close();
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Number of connections the server currently considers open. */
  liveConnectionCount(): number {
    return this.connections.filter((s) => s.connected).length;
  }
}

export async function waitUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms: ${label}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}
