import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { TestChatServer, waitUntil } from './test-helpers/real-chat-server';
import { __getDiagnosticsBufferForTests, __resetDiagnosticsForTests } from './socket-diagnostics';

/**
 * REAL Socket.IO integration test for zombie-socket recovery (Gate 4).
 *
 * Unlike outbox.test.ts (which fakes the socket with an EventEmitter and
 * fakes socket-client.ts entirely), this file starts an actual `socket.io`
 * server over a real HTTP server and a real `socket.io-client` Manager —
 * the exact same `socket-client.ts` / `outbox.ts` modules used in
 * production, unmocked. The only things mocked are the two app-level
 * concerns that are not the socket transport itself: the auth store (which
 * user is "logged in") and the REST api-client (media upload / token
 * refresh HTTP calls) — matching the pattern already used by
 * outbox.test.ts and diagnostics-recovery.test.ts.
 *
 * A "zombie" connection is reproduced literally as production evidence
 * describes it: the client's Engine.IO/Socket.IO connection is real and
 * `connected`, but the server-side handler for that specific connection
 * deliberately never invokes the CHAT_SEND ack callback. Recovery must
 * replace the actual Socket.IO client (a new TCP/WS connection, a new
 * `socket.id`) — there is no mock standing in for that replacement here.
 */

// ─── App-level mocks (NOT the socket transport) ────────────────────────────

vi.mock('@/store/auth.store', () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true, user: { id: 'u1' } }) },
}));

vi.mock('./api-client', () => ({
  default: { post: vi.fn() },
  tokenStore: {
    getAccess: () => 'test-access-token',
    getRefresh: () => 'test-refresh-token',
    setAccess: vi.fn(),
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  refreshAccessToken: vi.fn(async () => 'test-access-token'),
}));

// ─── Module wiring: env var must be set BEFORE socket-client.ts is first imported ──

let server: TestChatServer;
let outboxMod: typeof import('./outbox');
let socketClientMod: typeof import('./socket-client');
let chatStoreMod: typeof import('@/store/chat.store');

beforeAll(async () => {
  server = await TestChatServer.start();
  process.env['NEXT_PUBLIC_WS_URL'] = `http://localhost:${server.port}`;
  outboxMod = await import('./outbox');
  socketClientMod = await import('./socket-client');
  chatStoreMod = await import('@/store/chat.store');

  // Real-network timing: small but non-degenerate values so genuine Engine.IO
  // handshakes/timeouts have room to occur, without literally waiting 8s/3s/5s
  // per test. The exact production values are verified by outbox.test.ts's
  // fake-timer suite; this file proves the REAL transport behavior at any
  // consistent bound.
  outboxMod.__setOutboxTimingForTests({
    CHAT_SEND_ACK_TIMEOUT_MS: 400,
    NORMAL_RECONNECT_GRACE_MS: 200,
    FRESH_SOCKET_CONNECT_TIMEOUT_MS: 800,
  });
}, 20_000);

afterAll(async () => {
  socketClientMod.disconnectSocket();
  await server.stop();
});

const SENDER = { id: 'u1', firstName: 'Ali', lastName: 'Rezaei' };
const CONV = 'conv-integration-1';

function messages(conversationId: string) {
  return chatStoreMod.useChatStore.getState().messages[conversationId] ?? [];
}
function lastMessage(conversationId: string) {
  const list = messages(conversationId);
  return list[list.length - 1];
}

beforeEach(async () => {
  outboxMod.__resetOutboxForTests();
  socketClientMod.__resetSocketClientForTests();
  server.resetScenarioState();
  // The previous test's afterEach called disconnectSocket(), which sends a
  // real disconnect over the wire but does not synchronously guarantee the
  // server has processed it yet. Wait for the real close before clearing
  // connection history, so a still-live connection can never be hidden and
  // the next connIndex can never collide with one still open.
  await server.disconnectAllAndResetConnections();
  chatStoreMod.useChatStore.setState({ messages: {}, conversations: [], typingUsers: {}, hasMore: {}, nextCursor: {} });
  __resetDiagnosticsForTests();
});

afterEach(() => {
  socketClientMod.disconnectSocket();
});

describe('Gate 4 — real Socket.IO integration: zombie-socket recovery', () => {
  it('scenario 1: a connected zombie recovers via hard rebuild, message becomes sent, no page refresh', async () => {
    // Force the very first connection to be the zombie: never ack chat:send.
    server.ignoreAcksOn(0);

    outboxMod.sendText({ conversationId: CONV, body: 'hello from a real socket', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    // The first (zombied) connection must actually form and be genuinely connected.
    await waitUntil(() => server.connections.length >= 1, 5_000, 'first real connection established');
    expect(socketClientMod.getSocket().connected).toBe(true);
    const firstSocketId = socketClientMod.getSocket().id;
    const firstServerSocketId = server.connections[0]!.id;
    expect(firstSocketId).toBe(firstServerSocketId); // real client/server agree on the connection identity

    // Wait for the full automatic recovery to land: ack timeout → unhealthy →
    // hard rebuild → new real TCP/WS connection → retry → real ack.
    await waitUntil(() => lastMessage(CONV).deliveryState === 'sent', 10_000, 'message becomes sent after recovery');

    // A second, DIFFERENT physical connection was actually created.
    expect(server.connections.length).toBe(2);
    const secondSocketId = socketClientMod.getSocket().id;
    expect(secondSocketId).not.toBe(firstSocketId);
    expect(server.connections[1]!.id).toBe(secondSocketId);

    // The exact same clientMessageId was used on both attempts.
    expect(server.received).toHaveLength(2);
    expect(server.received[0]!.payload.clientMessageId).toBe(cid);
    expect(server.received[1]!.payload.clientMessageId).toBe(cid);
    expect(server.received[0]!.connIndex).toBe(0);
    expect(server.received[1]!.connIndex).toBe(1);

    // The old (zombie) connection was actually torn down server-side too —
    // proof the client really closed it, not just abandoned it.
    await waitUntil(() => !server.connections[0]!.connected, 5_000, 'old connection closes server-side');

    // Exactly one live connection remains for this session.
    expect(server.liveConnectionCount()).toBe(1);

    // Generation actually incremented on the real facade.
    expect(socketClientMod.getSocketGeneration()).toBe(2);
    expect(socketClientMod.getSocketHealth()).toBe('healthy');

    // No manual retry was needed — outbox entry is cleared on success.
    expect(outboxMod.canRetry(cid)).toBe(false);
  }, 20_000);

  it('scenario 2: both the zombie and the fresh connection fail to ack → exactly one rebuild, two emits, failed', async () => {
    server.ignoreAcksOn(0);
    server.ignoreAcksOn(1);

    outboxMod.sendText({ conversationId: CONV, body: 'this will not go through', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;

    await waitUntil(() => lastMessage(CONV).deliveryState === 'failed', 10_000, 'message becomes failed');

    expect(server.connections.length).toBe(2); // exactly one hard rebuild happened
    expect(server.received).toHaveLength(2); // exactly two CHAT_SEND emits total
    expect(server.received[0]!.payload.clientMessageId).toBe(cid);
    expect(server.received[1]!.payload.clientMessageId).toBe(cid);

    // Retry UI is available.
    expect(outboxMod.canRetry(cid)).toBe(true);

    // No reconnect storm / third automatic attempt follows.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(server.connections.length).toBe(2);
    expect(server.received).toHaveLength(2);
    expect(lastMessage(CONV).deliveryState).toBe('failed');
  }, 20_000);

  it('manual Retry after a double-timeout uses a fresh (third) real connection and succeeds', async () => {
    server.ignoreAcksOn(0);
    server.ignoreAcksOn(1);

    outboxMod.sendText({ conversationId: CONV, body: 'retry me', sender: SENDER });
    const cid = lastMessage(CONV).clientMessageId!;
    await waitUntil(() => lastMessage(CONV).deliveryState === 'failed', 10_000, 'initial cycle fails');
    expect(server.connections.length).toBe(2);

    // Connection index 2 (the manual-retry-forced rebuild) acks normally (default handler).
    outboxMod.retryMessage(CONV, cid);

    await waitUntil(() => lastMessage(CONV).deliveryState === 'sent', 10_000, 'manual retry succeeds');
    expect(server.connections.length).toBe(3);
    const ids = server.received.map((r) => r.payload.clientMessageId);
    expect(ids.every((id) => id === cid)).toBe(true);
    expect(server.received).toHaveLength(3); // 2 automatic + 1 manual
  }, 20_000);

  it('(Gate 10) a real recovery cycle produces the exact required sanitized diagnostic timeline, with expected fields present and no message content/PII anywhere in the buffer', async () => {
    server.ignoreAcksOn(0);
    const SECRET_BODY = 'hello from a real socket — do not leak this literal text';

    outboxMod.sendText({ conversationId: CONV, body: SECRET_BODY, sender: SENDER });
    await waitUntil(() => lastMessage(CONV).deliveryState === 'sent', 10_000, 'message recovers to sent');

    const buffer = __getDiagnosticsBufferForTests();
    const phaseSeq = buffer.map((e) => e.phase).filter((p): p is string => typeof p === 'string');

    // Required ordered phases (Gate 10) — each must appear, in this relative order.
    const required = [
      'send-emitted',
      'ack-timeout',
      'socket-marked-unhealthy',
      'socket-rebuild-start',
      'socket-rebuild-connect-wait',
      'socket-rebuild-success',
      'retry-after-socket-rebuild',
      'fresh-socket-ack-success',
    ];
    let cursor = -1;
    for (const phase of required) {
      const idx = phaseSeq.indexOf(phase, cursor + 1);
      expect(idx, `expected phase "${phase}" after index ${cursor} in ${JSON.stringify(phaseSeq)}`).toBeGreaterThan(
        cursor,
      );
      cursor = idx;
    }

    // Required fields present on the relevant events.
    const rebuildSuccess = buffer.find((e) => e.phase === 'socket-rebuild-success')!;
    expect(rebuildSuccess.oldSocketId).toBeTruthy();
    expect(rebuildSuccess.newSocketId).toBeTruthy();
    expect(rebuildSuccess.oldSocketGeneration).toBe(1);
    expect(rebuildSuccess.newSocketGeneration).toBe(2);
    expect(typeof rebuildSuccess.elapsedMs).toBe('number');

    const freshAck = buffer.find((e) => e.phase === 'fresh-socket-ack-success')!;
    expect(freshAck.clientMessageId).toBe(lastMessage(CONV).clientMessageId);
    expect(freshAck.conversationId).toBe(CONV);
    expect(freshAck.attempt).toBe(2);

    // No event anywhere in the buffer leaks message content, tokens, or PII —
    // scan every string value on every event for the secret body, the sender's
    // real name, and common sensitive-field markers.
    const forbiddenSubstrings = [SECRET_BODY, 'Ali', 'Rezaei', 'Bearer '];
    for (const evt of buffer) {
      for (const [key, value] of Object.entries(evt)) {
        expect(['body', 'text', 'fileName', 'fileUrl', 'url', 'token', 'cookie', 'phoneNumber', 'firstName', 'lastName']).not.toContain(
          key,
        );
        if (typeof value === 'string') {
          for (const forbidden of forbiddenSubstrings) {
            expect(value.includes(forbidden)).toBe(false);
          }
        }
      }
    }
  }, 20_000);

  // Diagnostics-failure-never-blocks-recovery is verified deterministically at
  // the unit level (outbox.test.ts "20 (Gate 3). diagnostics exception does
  // not affect send or recovery", plus socket-diagnostics.test.ts "telemetry
  // must never break the chat path") — forcing a REAL wire-level diagnostics
  // failure here would require independently faking the CHAT_CLIENT_DIAGNOSTICS
  // server handler, which duplicates that coverage without adding new proof.
});
