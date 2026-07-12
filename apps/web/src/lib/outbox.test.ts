import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { MessageDto, SocketChatSendAck, SocketChatSendPayload } from '@karamooziyar/shared';

/**
 * Outbox zombie-socket-recovery tests.
 *
 * Production evidence: a Socket.IO client can report `connected: true` (open
 * Engine.IO readyState, websocket transport) while no longer able to deliver
 * CHAT_SEND events — no ack ever arrives, and the server never sees the
 * event. `socket.connected` is therefore not trusted as proof of a working
 * transport; recovery requires actually replacing the Socket.IO client (a
 * "hard rebuild" — see socket-client.ts, mocked here as a controllable
 * single-flight stub since its own contract is covered by
 * socket-client.test.ts).
 *
 * Bounded policy under test: 8s CHAT_SEND ack timeout, 3s normal-reconnect
 * grace, 5s fresh-socket connect timeout, at most 1 hard rebuild and 2
 * CHAT_SEND emits per automatic send cycle.
 */

interface PendingAck {
  payload: SocketChatSendPayload;
  cb: (ack: SocketChatSendAck) => void;
}

class FakeSocket extends EventEmitter {
  connected = false;
  id: string;
  sentPayloads: SocketChatSendPayload[] = [];
  pendingAcks: PendingAck[] = [];

  constructor(id: string) {
    super();
    this.id = id;
  }

  connect = vi.fn((): this => this);
  disconnect = vi.fn((): this => this);

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

// ─── Mocked socket-client facade ────────────────────────────────────────────
// socket-client.ts's own hard-rebuild contract (single-flight, forceNew
// Manager, old-socket teardown, generation bump) is covered independently by
// socket-client.test.ts. Here it's a controllable stub so outbox tests can
// deterministically drive "rebuild succeeds / times out / is aborted".

let socketSeq = 1;
let currentSocket = new FakeSocket('sock-1');
let generation = 1;
let rebuildBehavior: 'success' | 'timeout' | 'session-changed' = 'success';
let rebuildInFlight: Promise<FakeSocket> | null = null;
const markUnhealthyMock = vi.fn();

const hardRebuildSocketMock = vi.fn((_reason: string, timeoutMs: number): Promise<FakeSocket> => {
  if (rebuildInFlight) return rebuildInFlight;
  const p = (async (): Promise<FakeSocket> => {
    if (rebuildBehavior === 'timeout') {
      await new Promise((r) => setTimeout(r, timeoutMs));
      throw new Error('fresh-socket-connect-timeout');
    }
    if (rebuildBehavior === 'session-changed') {
      throw new Error('session-changed');
    }
    socketSeq += 1;
    const fresh = new FakeSocket(`sock-${socketSeq}`);
    fresh.connected = true;
    currentSocket = fresh;
    generation += 1;
    return fresh;
  })();
  rebuildInFlight = p;
  // `.finally()` re-throws on rejection, creating a SECOND promise chain off
  // `p`; real callers already consume/catch `p` itself (returned below), but
  // this bookkeeping chain is otherwise never awaited — attach a no-op catch
  // so a rejected rebuild (rebuildBehavior: 'timeout'/'session-changed')
  // never surfaces as an unhandled rejection from the test harness itself.
  p.finally(() => {
    if (rebuildInFlight === p) rebuildInFlight = null;
  }).catch(() => {
    /* rejection is already observed via the returned `p` */
  });
  return p;
});

vi.mock('./socket-client', () => ({
  getSocket: () => currentSocket,
  getSocketGeneration: () => generation,
  markSocketUnhealthy: (...args: unknown[]) => markUnhealthyMock(...args),
  hardRebuildSocket: (reason: string, timeoutMs: number) => hardRebuildSocketMock(reason, timeoutMs),
  disconnectSocket: vi.fn(),
  reconnectSocket: vi.fn(),
}));

// Diagnostics are observation-only: mock to (a) assert the phase/reason
// contract and (b) prove the outbox flow completes with telemetry replaced.
vi.mock('./socket-diagnostics', () => ({
  chatSendPhase: vi.fn(),
}));

vi.mock('./api-client', () => ({
  default: { post: vi.fn() },
  tokenStore: { getAccess: () => null, getRefresh: () => null, setAccess: vi.fn(), setRefresh: vi.fn(), clear: vi.fn() },
  refreshAccessToken: vi.fn(),
}));

// Controllable auth store fake (session-change / logout-during-recovery tests).
const { auth } = vi.hoisted(() => ({
  auth: {
    state: { isAuthenticated: true, user: { id: 'u1' } } as { isAuthenticated: boolean; user: { id: string } | null },
  },
}));
vi.mock('@/store/auth.store', () => ({
  useAuthStore: { getState: () => auth.state },
}));

const { sendText, sendMedia, retryMessage, canRetry, __resetOutboxForTests } = await import('./outbox');
const { useChatStore } = await import('@/store/chat.store');
const { default: apiClient } = await import('./api-client');
const { MessageType } = await import('@karamooziyar/shared');
const { chatSendPhase } = await import('./socket-diagnostics');

type DiagCall = { phase: string; sendOrigin?: string; clientMessageId: string; [k: string]: unknown };
function diagCalls(): DiagCall[] {
  return vi.mocked(chatSendPhase).mock.calls.map((c) => c[0] as DiagCall);
}
function diagPhases(): string[] {
  return diagCalls().map((c) => `${c.sendOrigin ?? '-'}:${c.phase}`);
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

function setOnline(online: boolean): void {
  vi.stubGlobal('navigator', { onLine: online });
}

function fireWindowOnline(): void {
  (window as unknown as EventTarget).dispatchEvent(new Event('online'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  // This suite runs in the 'node' vitest environment (no jsdom): `window` is
  // undefined by default. Stub a real EventTarget so `ensureOnlineHook()`'s
  // `window.addEventListener('online', ...)` / our `dispatchEvent` calls
  // actually connect, exactly like a browser `online` event would.
  vi.stubGlobal('window', new EventTarget());
  socketSeq = 1;
  currentSocket = new FakeSocket('sock-1');
  currentSocket.connected = true;
  generation = 1;
  rebuildBehavior = 'success';
  rebuildInFlight = null;
  markUnhealthyMock.mockClear();
  hardRebuildSocketMock.mockClear();
  auth.state = { isAuthenticated: true, user: { id: 'u1' } };
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
  vi.unstubAllGlobals();
});

describe('1. normal send', () => {
  it('ack arrives before 8s — no reconnect, no rebuild', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(hardRebuildSocketMock).not.toHaveBeenCalled();
    expect(markUnhealthyMock).not.toHaveBeenCalled();
  });
});

describe('2. slow upload', () => {
  it('the CHAT_SEND ack timer does not start until the (>8s) upload completes', async () => {
    let resolveUpload!: (v: unknown) => void;
    vi.mocked(apiClient.post).mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      }) as never,
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    sendMedia({ conversationId: CONV, type: MessageType.IMAGE, file, sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await vi.advanceTimersByTimeAsync(10_000); // longer than the 8s ack budget
    expect(currentSocket.sentPayloads).toHaveLength(0); // never emitted — still uploading
    expect(lastMessage(CONV).deliveryState).toBe('uploading');

    resolveUpload({ data: { data: { fileKey: 'k', fileName: 'photo.png', mimeType: 'image/png', fileSize: 3 } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket.sentPayloads).toHaveLength(1); // ack timer only starts now
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });
});

describe('3/4/5. connected zombie socket → hard rebuild → fresh socket', () => {
  it('after 8s with no ack, the socket is marked unhealthy and a rebuild begins immediately', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    const zombie = currentSocket;

    await vi.advanceTimersByTimeAsync(7_999);
    expect(markUnhealthyMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2); // crosses the 8s boundary
    expect(markUnhealthyMock).toHaveBeenCalledWith(zombie.id, 1, 'ack-timeout');
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    // The mocked rebuild resolves synchronously (no timer), so by the time
    // the above microtasks flush the cycle has already moved past the
    // transient `rebuilding-connection` state into the fresh-socket retry —
    // asserted here via the resulting emit rather than an intermediate read.

    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket).not.toBe(zombie); // fresh socket is now live
    expect(currentSocket.id).not.toBe(zombie.id);
    expect(generation).toBe(2); // generation increments exactly once (§4)

    expect(currentSocket.pendingAcks).toHaveLength(1); // retried on the fresh socket
    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid); // same clientMessageId
    expect(lastMessage(CONV).deliveryState).toBe('retrying');

    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(canRetry(cid)).toBe(false);

    expect(diagPhases()).toContain('new-message:ack-timeout');
    expect(diagPhases()).toContain('new-message:retry-after-socket-rebuild');
    expect(diagPhases()).toContain('new-message:fresh-socket-ack-success');
  });
});

describe('6/7. identity + successful recovery, no duplicate', () => {
  it('preserves clientMessageId across the rebuild and reconciles to exactly one row', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    const list = messages(CONV);
    expect(list).toHaveLength(1);
    expect(list[0]!.clientMessageId).toBe(cid);
    expect(list[0]!.id).toBe(`srv-${cid}`);
  });
});

describe('8. double ACK timeout', () => {
  it('one hard rebuild, second emit also times out → failed, no second rebuild, no infinite loop', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await vi.advanceTimersByTimeAsync(8_000); // first ack-timeout → rebuild
    await vi.advanceTimersByTimeAsync(0);
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    expect(currentSocket.pendingAcks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(8_000); // second ack-timeout — never resolved
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1); // still just one rebuild ever
    expect(currentSocket.sentPayloads).toHaveLength(1); // exactly 2 emits total (1 on zombie + 1 on fresh)
    expect(canRetry(cid)).toBe(true); // manual retry still available

    // No infinite loop: advancing time further changes nothing.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    expect(lastMessage(CONV).deliveryState).toBe('failed');

    expect(diagPhases()).toContain('new-message:fresh-socket-ack-timeout');
    expect(diagCalls().some((c) => c.phase === 'force-failed' && c['reason'] === 'fresh-socket-ack-timeout')).toBe(
      true,
    );
  });
});

describe('9/10. browser offline → resume on `online`', () => {
  it('offline: no rebuild, no emit, message waits for the online event', async () => {
    setOnline(false);
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(lastMessage(CONV).deliveryState).toBe('awaiting-connection');
    expect(currentSocket.sentPayloads).toHaveLength(0);
    expect(hardRebuildSocketMock).not.toHaveBeenCalled();
  });

  it('online: the pending message resumes automatically and reuses the clientMessageId', async () => {
    setOnline(false);
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('awaiting-connection');

    setOnline(true);
    fireWindowOnline();
    await vi.advanceTimersByTimeAsync(0);

    expect(currentSocket.pendingAcks).toHaveLength(1);
    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });
});

describe('11/12. online but disconnected: grace period before any rebuild', () => {
  it('reconnects within the 3s grace period — no hard rebuild at all', async () => {
    currentSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await vi.advanceTimersByTimeAsync(1_000);
    currentSocket.simulateConnect(); // reconnects inside the grace window
    await vi.advanceTimersByTimeAsync(0);

    expect(hardRebuildSocketMock).not.toHaveBeenCalled();
    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });

  it('does not reconnect within 3s — exactly one hard rebuild, then sends on the fresh socket', async () => {
    currentSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    const disconnectedSocket = currentSocket;

    await vi.advanceTimersByTimeAsync(2_999); // still inside the grace window
    expect(hardRebuildSocketMock).not.toHaveBeenCalled(); // no rebuild before grace expires (§9)

    await vi.advanceTimersByTimeAsync(1); // crosses the 3s boundary
    await vi.advanceTimersByTimeAsync(0);
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    expect(currentSocket).not.toBe(disconnectedSocket);
    expect(currentSocket.pendingAcks).toHaveLength(1);
    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid);

    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1); // still just one
  });
});

describe('13. media caching across a rebuild', () => {
  it('upload is never repeated after an ack-timeout-triggered rebuild', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    let totalEmits = 0;
    sendMedia({ conversationId: CONV, type: MessageType.IMAGE, file, sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(0);
    expect(apiClient.post).toHaveBeenCalledTimes(1); // upload count = 1 (§11)
    totalEmits += currentSocket.sentPayloads.length; // 1 (zombie attempt)

    await vi.advanceTimersByTimeAsync(8_000); // ack-timeout → rebuild → retry emit
    await vi.advanceTimersByTimeAsync(0);
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    expect(apiClient.post).toHaveBeenCalledTimes(1); // still exactly once — no re-upload
    totalEmits += currentSocket.sentPayloads.length; // + 1 (fresh-socket retry)
    expect(totalEmits).toBe(2); // CHAT_SEND emit count = 2 total (§11)

    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
});

describe('Gate 8 — media/voice recovery, per type', () => {
  it.each([
    { label: 'FILE', type: MessageType.FILE, fileName: 'report.pdf', mime: 'application/pdf' },
    { label: 'VOICE', type: MessageType.VOICE, fileName: 'voice_1.webm', mime: 'audio/webm' },
  ])(
    '$label: upload happens exactly once, first CHAT_SEND may time out, rebuild occurs, second CHAT_SEND reuses cached metadata, same clientMessageId, no second upload',
    async ({ type, fileName, mime }) => {
      const file = new File([new Uint8Array([1, 2, 3, 4])], fileName, { type: mime });
      sendMedia({
        conversationId: CONV,
        type,
        file,
        duration: type === MessageType.VOICE ? 12 : undefined,
        sender: SENDER,
      });
      const cid = lastMessage(CONV).clientMessageId!;
      await vi.advanceTimersByTimeAsync(0);
      expect(apiClient.post).toHaveBeenCalledTimes(1); // upload occurs exactly once
      expect(lastMessage(CONV).deliveryState).toBe('sending');

      const zombie = currentSocket;
      expect(zombie.pendingAcks).toHaveLength(1);
      const firstPayload = zombie.pendingAcks[0]!.payload;
      expect(firstPayload.clientMessageId).toBe(cid);
      expect(firstPayload.fileKey).toBe('key-1'); // cached upload metadata used on attempt 1

      await vi.advanceTimersByTimeAsync(8_000); // first CHAT_SEND times out → hard rebuild
      await vi.advanceTimersByTimeAsync(0);
      expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
      expect(currentSocket).not.toBe(zombie);
      expect(apiClient.post).toHaveBeenCalledTimes(1); // still exactly once — no second upload HTTP request

      expect(currentSocket.pendingAcks).toHaveLength(1);
      const secondPayload = currentSocket.pendingAcks[0]!.payload;
      expect(secondPayload.clientMessageId).toBe(cid); // same clientMessageId on the retry
      expect(secondPayload.fileKey).toBe('key-1'); // same cached upload metadata reused, not re-fetched

      currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
      await vi.advanceTimersByTimeAsync(0);
      expect(lastMessage(CONV).deliveryState).toBe('sent'); // successful ACK reconciles the optimistic message
      expect(apiClient.post).toHaveBeenCalledTimes(1);
    },
  );

  it('upload failure remains an upload failure and never triggers a zombie-socket rebuild', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({ response: { status: 413 } });
    const file = new File([new Uint8Array([1, 2, 3])], 'huge.png', { type: 'image/png' });
    sendMedia({ conversationId: CONV, type: MessageType.IMAGE, file, sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(hardRebuildSocketMock).not.toHaveBeenCalled(); // upload failure is not a socket problem
    expect(markUnhealthyMock).not.toHaveBeenCalled();
    expect(currentSocket.sentPayloads).toHaveLength(0); // never even reached CHAT_SEND
    expect(canRetry(cid)).toBe(true);
    expect(diagCalls().some((c) => c.phase === 'upload-error')).toBe(true);
  });
});

describe('14. multiple simultaneous timeouts share one rebuild', () => {
  it('two zombied messages trigger exactly one hard rebuild between them', async () => {
    sendText({ conversationId: CONV, body: 'one', sender: SENDER });
    sendText({ conversationId: CONV, body: 'two', sender: SENDER });
    const list = messages(CONV);
    const cid1 = list[0]!.clientMessageId!;
    const cid2 = list[1]!.clientMessageId!;
    expect(currentSocket.pendingAcks).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(8_000); // both time out together
    await vi.advanceTimersByTimeAsync(0);

    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1); // single-flight — not two rebuilds
    expect(currentSocket.pendingAcks).toHaveLength(2); // both retried on the one fresh socket
    const ids = currentSocket.pendingAcks.map((p) => p.payload.clientMessageId).sort();
    expect(ids).toEqual([cid1, cid2].sort());
  });
});

describe('15. manual retry after ack-timeout does not reuse the failed generation', () => {
  it('forces one rebuild before the emit when nothing has rebuilt since the failure', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(8_000); // ack-timeout → auto rebuild → retry
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000); // second ack-timeout → failed
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);

    vi.mocked(chatSendPhase).mockClear();
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);

    // The failed generation is exactly the current one → manual retry must
    // force a fresh socket before emitting, per §9.
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(2);
    expect(diagPhases()).toContain('manual-retry:manual-retry-requires-fresh-socket');
    expect(currentSocket.pendingAcks).toHaveLength(1);
    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid);

    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });

  it('does NOT force a rebuild if the socket already moved to a newer generation since the failure', async () => {
    sendText({ conversationId: CONV, body: 'one', sender: SENDER });
    const cid1 = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(8_000); // cid1 fails on generation 2 (post-rebuild)
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(generation).toBe(2);

    // A second message now succeeds normally on generation 2 — nothing changes generation further.
    vi.mocked(chatSendPhase).mockClear();
    const rebuildsBefore = hardRebuildSocketMock.mock.calls.length;
    retryMessage(CONV, cid1);
    await vi.advanceTimersByTimeAsync(0);
    // failure.generation (2) is NOT older than current generation (2) → still forces one rebuild.
    // This exercises the boundary condition explicitly per §9 ("current generation newer than failed").
    expect(hardRebuildSocketMock.mock.calls.length).toBe(rebuildsBefore + 1);
  });
});

describe('14 (Gate 3). late ack from an OLD generation does not duplicate, regress, or override the fresh-generation result', () => {
  it('a late success on the abandoned zombie attempt, arriving AFTER the cycle already reached failed, self-corrects to sent — no duplicate', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    const zombie = currentSocket;
    expect(zombie.pendingAcks).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(8_000); // attempt 1 (zombie) times out → rebuild → attempt 2 emitted
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket).not.toBe(zombie);

    await vi.advanceTimersByTimeAsync(8_000); // attempt 2 (fresh) also times out → cycle terminally fails
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('failed');

    // The zombie's original ack callback was NEVER resolved/rejected by the
    // outbox itself (it just stopped waiting on it) — it can still fire late.
    expect(zombie.pendingAcks).toHaveLength(1);
    zombie.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    // The late success is real evidence the server has the message — the UI
    // self-corrects to sent, and exactly one row exists (no duplicate).
    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(messages(CONV)).toHaveLength(1);
  });

  it('a late success on the zombie attempt, arriving WHILE the fresh attempt is still in flight, is not later regressed back to failed by that fresh attempt`s own timeout', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    const zombie = currentSocket;

    await vi.advanceTimersByTimeAsync(8_000); // attempt 1 (zombie) times out → rebuild → attempt 2 emitted
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket).not.toBe(zombie);
    expect(currentSocket.pendingAcks).toHaveLength(1); // attempt 2 in flight on the fresh socket

    // Late success arrives from the OLD generation's abandoned attempt while
    // the NEW generation's attempt is still awaiting its own ack.
    zombie.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');

    // The fresh attempt now independently times out with no ack of its own.
    await vi.advanceTimersByTimeAsync(8_000);
    await vi.advanceTimersByTimeAsync(0);

    // Must NOT be regressed back to 'failed' by the cycle's own terminal tail —
    // the message is already durably sent per the earlier late ack.
    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(messages(CONV)).toHaveLength(1); // still exactly one row, no duplicate
  });
});

describe('17. logout during rebuild', () => {
  it('aborts the recovery safely — no send after logout, message left retryable', async () => {
    rebuildBehavior = 'session-changed';
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    auth.state = { isAuthenticated: false, user: null }; // simulate logout

    await vi.advanceTimersByTimeAsync(8_000); // ack-timeout → rebuild attempt aborts (session-changed)
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(currentSocket.sentPayloads.length).toBeLessThanOrEqual(1); // never sent on a fresh socket post-logout
    expect(canRetry(cid)).toBe(true);
  });
});

describe('19. session/user change aborts an in-flight cycle', () => {
  it('a user change mid-cycle prevents the pending send from completing under the new session', async () => {
    currentSocket.connected = false; // force the connect-wait path so we have an await point to change auth under
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });

    auth.state = { isAuthenticated: true, user: { id: 'someone-else' } };
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(currentSocket.sentPayloads).toHaveLength(0); // never emitted under the wrong session
    expect(diagCalls().some((c) => c['reason'] === 'session-changed' || c['failureReason'] === 'session-changed')).toBe(
      true,
    );
  });
});

describe('Gate 9 §6 — authentication not yet ready', () => {
  it('a send attempted before auth is ready fails cleanly to a controlled, retryable state — no rebuild, no exception, no send under an invalid session', async () => {
    auth.state = { isAuthenticated: false, user: null }; // auth not initialized / not yet hydrated
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(currentSocket.sentPayloads).toHaveLength(0); // never emitted without a ready session
    expect(hardRebuildSocketMock).not.toHaveBeenCalled();
    expect(canRetry(cid)).toBe(true); // controlled, retryable — not stuck

    // Auth becomes ready; a manual Retry now completes normally.
    auth.state = { isAuthenticated: true, user: { id: 'u1' } };
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });
});

describe('18 (Gate 3). rebuild Promise failure reaches a valid failed state, and a later manual retry can rebuild again', () => {
  it('a fresh-socket-connect-timeout during the automatic rebuild fails the cycle cleanly; the shared rebuild Promise clears and a later manual Retry can rebuild successfully', async () => {
    rebuildBehavior = 'timeout';
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await vi.advanceTimersByTimeAsync(8_000); // ack-timeout → ensureFreshSocket → hardRebuildSocket starts
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000); // the mocked rebuild's own connect-timeout elapses
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(canRetry(cid)).toBe(true);
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
    expect(rebuildInFlight).toBeNull(); // the shared rebuild Promise cleared after settling (§18/§19)

    // A later manual Retry can genuinely rebuild again — the cleared Promise
    // does not block or reuse a dead in-flight rebuild.
    rebuildBehavior = 'success';
    vi.mocked(chatSendPhase).mockClear();
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);

    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(2);
    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });
});

describe('20 (Gate 3). diagnostics exception does not affect send or recovery', () => {
  it('a normal send still reaches sent even when every diagnostics call throws', async () => {
    vi.mocked(chatSendPhase).mockImplementation(() => {
      throw new Error('diagnostics boom');
    });
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('sent');
  });

  it('a full zombie-recovery cycle still completes and reaches sent even when every diagnostics call throws', async () => {
    vi.mocked(chatSendPhase).mockImplementation(() => {
      throw new Error('diagnostics boom');
    });
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await vi.advanceTimersByTimeAsync(8_000); // ack-timeout → rebuild → retry, all with throwing diagnostics
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('sent');
    expect(hardRebuildSocketMock).toHaveBeenCalledTimes(1);
  });
});

describe('22. diagnostics — safe fields only, non-blocking', () => {
  it('a normal send logs the expected phase sequence with no rebuild-only fields set for a healthy send', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    const phases = diagPhases();
    expect(phases).toContain('new-message:optimistic-inserted');
    expect(phases).toContain('new-message:send-emitted');
    expect(phases).toContain('new-message:ack-success');
    expect(diagCalls().every((c) => c.clientMessageId === cid)).toBe(true);
  });
});

describe('23. existing regression coverage', () => {
  it('a real server rejection (VALIDATION) fails immediately, with no rebuild and no auto-retry', async () => {
    sendText({ conversationId: CONV, body: '', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    expect(currentSocket.pendingAcks).toHaveLength(1);
    currentSocket.resolveOldestAck({ ok: false, clientMessageId: cid, code: 'VALIDATION', error: 'body is required' });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastMessage(CONV).deliveryState).toBe('failed');
    expect(hardRebuildSocketMock).not.toHaveBeenCalled();
    expect(canRetry(cid)).toBe(true);

    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSocket.pendingAcks).toHaveLength(1);
    expect(currentSocket.pendingAcks[0]!.payload.clientMessageId).toBe(cid);
  });

  it('reconnect-retry-then-success leaves exactly one persisted row — no duplicate', async () => {
    currentSocket.connected = false;
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    expect(messages(CONV)).toHaveLength(1);

    currentSocket.simulateConnect();
    await vi.advanceTimersByTimeAsync(0);
    currentSocket.resolveOldestAck({ ok: true, clientMessageId: cid, message: serverMessageFor(cid) });
    await vi.advanceTimersByTimeAsync(0);

    const list = messages(CONV);
    expect(list).toHaveLength(1);
    expect(list[0]!.deliveryState).toBe('sent');
  });

  it('a manual Retry on a validation failure (no rebuild needed) logs sendOrigin manual-retry', async () => {
    sendText({ conversationId: CONV, body: 'hi', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    currentSocket.resolveOldestAck({ ok: false, clientMessageId: cid, code: 'VALIDATION', error: 'bad' });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastMessage(CONV).deliveryState).toBe('failed');

    vi.mocked(chatSendPhase).mockClear();
    retryMessage(CONV, cid);
    await vi.advanceTimersByTimeAsync(0);

    const phases = diagPhases();
    expect(phases[0]).toBe('manual-retry:manual-retry-start');
    expect(phases).toContain('manual-retry:send-emitted');
    expect(hardRebuildSocketMock).not.toHaveBeenCalled(); // server-rejection never requires a fresh socket
  });
});
