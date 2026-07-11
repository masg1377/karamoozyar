import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { MessageDto, SocketChatSendAck, SocketChatSendPayload } from '@karamooziyar/shared';

/**
 * Outbox reconnect-resilience tests.
 *
 * Covers the `awaiting-reconnect` delivery state introduced to stop a
 * transport-level hiccup (socket not connected / reconnect timeout / ack
 * timeout caused by connection loss) from immediately becoming a normal
 * `failed` message. See lib/outbox.ts for the state machine.
 *
 * The socket is faked with a small EventEmitter so tests can deterministically
 * control `connected`, fire `connect`, and resolve/withhold acks. Timers are
 * faked so the 5s connect-wait, 12s ack-timeout, and 60s reconnect budget are
 * exercised without real delays.
 */

interface PendingAck {
  payload: SocketChatSendPayload;
  cb: (ack: SocketChatSendAck) => void;
}

class FakeSocket extends EventEmitter {
  connected = false;
  id: string | undefined = 'fake-socket-id';
  sentPayloads: SocketChatSendPayload[] = [];
  pendingAcks: PendingAck[] = [];

  connect = vi.fn(() => this);
  disconnect = vi.fn(() => this);

  override emit(event: string, ...args: unknown[]): boolean {
    if (event === 'chat:send') {
      const [payload, cb] = args as [SocketChatSendPayload, (ack: SocketChatSendAck) => void];
      this.sentPayloads.push(payload);
      this.pendingAcks.push({ payload, cb });
      return true;
    }
    return super.emit(event, ...args);
  }

  /** Test helper — simulate the transport coming up (fires the real `connect` event). */
  simulateConnect(): void {
    this.connected = true;
    super.emit('connect');
  }

  /** Test helper — resolve the oldest still-pending ack (FIFO; sends are sequential here). */
  resolveOldestAck(ack: SocketChatSendAck): void {
    const next = this.pendingAcks.shift();
    if (!next) throw new Error('no pending ack to resolve');
    next.cb(ack);
  }

  reset(): void {
    this.connected = false;
    this.sentPayloads = [];
    this.pendingAcks = [];
  }
}

const fakeSocket = new FakeSocket();

vi.mock('./socket-client', () => ({
  getSocket: () => fakeSocket,
  disconnectSocket: vi.fn(),
  reconnectSocket: vi.fn(),
}));

// Diagnostics are observation-only: mock to (a) assert the sendOrigin/phase
// contract and (b) prove the outbox flow completes with telemetry replaced.
vi.mock('./socket-diagnostics', () => ({
  chatSendPhase: vi.fn(),
}));

vi.mock('./api-client', () => ({
  default: { post: vi.fn() },
  tokenStore: { getAccess: () => null, getRefresh: () => null, setAccess: vi.fn(), setRefresh: vi.fn(), clear: vi.fn() },
  refreshAccessToken: vi.fn(),
}));

const { sendText, sendMedia, retryMessage, canRetry, __resetOutboxForTests } = await import('./outbox');
const { useChatStore } = await import('@/store/chat.store');
const { default: apiClient } = await import('./api-client');
const { MessageType } = await import('@karamooziyar/shared');
const { chatSendPhase } = await import('./socket-diagnostics');

type DiagCall = { phase: string; sendOrigin: string; clientMessageId: string };
function diagCalls(): DiagCall[] {
  return vi.mocked(chatSendPhase).mock.calls.map((c) => c[0] as DiagCall);
}

const SENDER = { id: 'u1', firstName: 'Ali', lastName: 'Rezaei' };
const CONV = 'conv-1';

function messages(conversationId: string) {
  return useChatStore.getState().messages[conversationId] ?? [];
}

function lastMessage(conversationId: string) {
  const list = messages(conversationId);
  return list[list.length - 1];
}

function serverMessageFor(cid: string): MessageDto {
  return {
    id: `srv-${cid}`,
    clientMessageId: cid,
    conversationId: CONV,
    senderId: SENDER.id,
    senderName: 'Ali Rezaei',
    type: 'TEXT',
    body: 'hi',
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

beforeEach(() => {
  vi.useFakeTimers();
  // NOTE: deliberately not removing the socket's listeners here — outbox.ts
  // attaches its `connect` retry-hook exactly once per socket instance (a
  // WeakSet, see ensureReconnectHook), and `fakeSocket` is reused across every
  // test in this file to model that same-instance lifecycle. Stripping
  // listeners between tests would silently defeat that "attach once" guard.
  fakeSocket.reset();
  __resetOutboxForTests();
  useChatStore.setState({ messages: {}, conversations: [], typingUsers: {}, hasMore: {}, nextCursor: {} });
  vi.mocked(chatSendPhase).mockClear();
  vi.mocked(apiClient.post).mockReset();
  vi.mocked(apiClient.post).mockResolvedValue({
    data: { data: { fileKey: 'key-1', fileName: 'photo.png', mimeType: 'image/png', fileSize: 1234 } },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('outbox — connectivity vs. real failures', () => {
  it('socket disconnected: message becomes awaiting-reconnect, not failed', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    // Still within the 5s connect-wait budget: nothing decided yet.
    expect(lastMessage(CONV).deliveryState).toBe('sending');

    await vi.advanceTimersByTimeAsync(5_000); // CONNECT_WAIT_MS elapses, no connect ever fired

    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');
    expect(lastMessage(CONV).clientMessageId).toBe(cid); // clientMessageId preserved
    expect(fakeSocket.sentPayloads).toHaveLength(0); // never reached the server at all
    expect(canRetry(cid)).toBe(true); // input retained
  });

  it('on reconnect, the message is retried exactly once and succeeds', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');

    fakeSocket.connected = true;
    fakeSocket.simulateConnect(); // the confirmed `connect` event
    await vi.advanceTimersByTimeAsync(0);

    expect(fakeSocket.sentPayloads).toHaveLength(1); // exactly one automatic retry emit
    expect(fakeSocket.sentPayloads[0]!.clientMessageId).toBe(cid); // same clientMessageId reused

    fakeSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(canRetry(cid)).toBe(false); // reconciled — outbox entry cleared

    // A second, later connect must not re-send an already-confirmed message.
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSocket.sentPayloads).toHaveLength(1);
  });

  it('three unsuccessful reconnect cycles: message becomes failed, stays visible, retryable', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');

    for (let cycle = 1; cycle <= 3; cycle++) {
      fakeSocket.connected = true;
      fakeSocket.simulateConnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(fakeSocket.pendingAcks).toHaveLength(1); // exactly one retry emitted this cycle

      // Never ack it — let the 12s ack-timeout fire, simulating connection loss again.
      await vi.advanceTimersByTimeAsync(12_000);
      fakeSocket.pendingAcks = []; // bookkeeping only; outbox no longer references it

      if (cycle < 3) {
        expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');
      }
    }

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(canRetry(cid)).toBe(true); // manual retry still available
    expect(fakeSocket.sentPayloads).toHaveLength(3); // one per cycle, no extra/duplicate sends

    // A further connect must NOT auto-retry an already-`failed` message.
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSocket.sentPayloads).toHaveLength(3);
  });

  it('a real server rejection (VALIDATION) fails immediately, with no awaiting-reconnect and no auto-retry', async () => {
    fakeSocket.connected = true;
    sendText({ conversationId: CONV, body: '', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    expect(fakeSocket.pendingAcks).toHaveLength(1); // reached the server immediately (socket was connected)
    fakeSocket.resolveOldestAck({ ok: false, clientMessageId: cid, code: 'VALIDATION', error: 'body is required' });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed'); // never passed through awaiting-reconnect
    expect(canRetry(cid)).toBe(true); // still manually retryable

    const sentBefore = fakeSocket.sentPayloads.length;
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSocket.sentPayloads).toHaveLength(sentBefore); // a real rejection is never auto-retried

    // Manual retry still works and reuses the same clientMessageId.
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeSocket.sentPayloads).toHaveLength(sentBefore + 1);
    expect(fakeSocket.sentPayloads[fakeSocket.sentPayloads.length - 1]!.clientMessageId).toBe(cid);
  });

  it('reconnect-retry-then-success leaves exactly one persisted row — no duplicate', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages(CONV)).toHaveLength(1);

    fakeSocket.connected = true;
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    fakeSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    const list = messages(CONV);
    expect(list).toHaveLength(1); // reconciled in place, no second row appended
    expect(list[0]!.deliveryState).toBe('sent');
    expect(list[0]!.clientMessageId).toBe(cid);
    expect(list[0]!.id).toBe(`srv-${cid}`);
  });

  it('media send: an awaiting-reconnect retry does not re-upload an already-uploaded file', async () => {
    fakeSocket.connected = false;
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    sendMedia({ conversationId: CONV, type: MessageType.IMAGE, file, sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    // Let the (mocked) upload promise resolve, then exhaust the connect-wait.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');
    expect(apiClient.post).toHaveBeenCalledTimes(1); // uploaded exactly once

    fakeSocket.connected = true;
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(fakeSocket.pendingAcks).toHaveLength(1); // the retry reached emit
    expect(apiClient.post).toHaveBeenCalledTimes(1); // still once — no re-upload on retry

    fakeSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(apiClient.post).toHaveBeenCalledTimes(1); // confirmed: exactly one upload for the whole lifecycle
  });
});

describe('outbox — chat-send diagnostics (sendOrigin/phase contract)', () => {
  it('a normal compose send logs sendOrigin new-message through insert → emit → ack', async () => {
    fakeSocket.connected = true;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    fakeSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    const calls = diagCalls();
    const phases = calls.map((c) => `${c.sendOrigin}:${c.phase}`);
    expect(phases).toContain('new-message:optimistic-inserted');
    expect(phases).toContain('new-message:send-emitted');
    expect(phases).toContain('new-message:ack-success');
    expect(calls.every((c) => c.clientMessageId === cid)).toBe(true);
    // diagnostics never delayed the send — message is already reconciled
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });

  it('a manual Retry logs sendOrigin manual-retry starting with manual-retry-start', async () => {
    fakeSocket.connected = true;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    fakeSocket.resolveOldestAck({ ok: false, clientMessageId: cid, code: 'VALIDATION', error: 'bad' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('failed');

    vi.mocked(chatSendPhase).mockClear();
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);

    const phases = diagCalls().map((c) => `${c.sendOrigin}:${c.phase}`);
    expect(phases[0]).toBe('manual-retry:manual-retry-start');
    expect(phases).toContain('manual-retry:send-emitted');
  });

  it('an automatic resend after reconnect logs sendOrigin auto-reconnect-retry', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    await vi.advanceTimersByTimeAsync(5_000); // connect-wait times out → awaiting-reconnect
    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');

    const early = diagCalls().map((c) => `${c.sendOrigin}:${c.phase}`);
    expect(early).toContain('new-message:connect-wait-start');
    expect(early).toContain('new-message:connect-wait-timeout');
    expect(early).toContain('new-message:enter-awaiting-reconnect');

    vi.mocked(chatSendPhase).mockClear();
    fakeSocket.connected = true;
    fakeSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);

    const phases = diagCalls().map((c) => `${c.sendOrigin}:${c.phase}`);
    expect(phases[0]).toBe('auto-reconnect-retry:auto-retry-start');
    expect(phases).toContain('auto-reconnect-retry:send-emitted');
  });

  it('the 60s reconnect cap logs force-failed', async () => {
    fakeSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastMessage(CONV).deliveryState).toBe('awaiting-reconnect');

    await vi.advanceTimersByTimeAsync(60_000); // wall-clock cap, no connect ever fires

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    const forced = diagCalls().find((c) => c.phase === 'force-failed');
    expect(forced).toBeDefined();
    expect(forced!.sendOrigin).toBe('auto-reconnect-retry');
  });
});
