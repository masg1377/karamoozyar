/**
 * Minimal structured diagnostics for the chat-send / retry path only.
 *
 * Exists to answer three questions when a message gets stuck: did chat:send
 * reach the backend, what was the socket's state at the moment of retry, and
 * which of the three distinct failure modes occurred (ack timeout vs backend
 * rejection vs reconnect failure). Nothing else is logged. Every event
 * carries `clientMessageId` and/or `socket.id` only — never message body,
 * file name, or other content.
 */

type DiagEvent =
  | { type: 'send_emitted'; clientMessageId: string; socketId: string | undefined }
  | {
      type: 'ack_received';
      clientMessageId: string;
      socketId: string | undefined;
      ok: boolean;
      code?: string;
    }
  | { type: 'ack_timeout'; clientMessageId: string; socketId: string | undefined }
  | { type: 'reconnect_failed'; clientMessageId: string; socketId: string | undefined }
  | {
      type: 'retry_attempt';
      clientMessageId: string;
      socketId: string | undefined;
      connected: boolean;
    };

function emit(event: DiagEvent): void {
  // eslint-disable-next-line no-console
  console.debug('[chat-send]', JSON.stringify({ ts: Date.now(), ...event }));
}

export const socketDiagnostics = {
  /** chat:send was actually emitted on a connected socket. */
  sendEmitted: (clientMessageId: string, socketId: string | undefined) =>
    emit({ type: 'send_emitted', clientMessageId, socketId }),

  /** Backend responded — `ok`/`code` distinguish success from a backend rejection. */
  ackReceived: (clientMessageId: string, socketId: string | undefined, ok: boolean, code?: string) =>
    emit({ type: 'ack_received', clientMessageId, socketId, ok, code }),

  /** Emitted, but no ack arrived within the ack budget. */
  ackTimeout: (clientMessageId: string, socketId: string | undefined) =>
    emit({ type: 'ack_timeout', clientMessageId, socketId }),

  /** Never got connected long enough to even emit — distinct from an ack timeout. */
  reconnectFailed: (clientMessageId: string, socketId: string | undefined) =>
    emit({ type: 'reconnect_failed', clientMessageId, socketId }),

  /** Socket state at the moment the user clicked retry. */
  retryAttempt: (clientMessageId: string, socketId: string | undefined, connected: boolean) =>
    emit({ type: 'retry_attempt', clientMessageId, socketId, connected }),
};
