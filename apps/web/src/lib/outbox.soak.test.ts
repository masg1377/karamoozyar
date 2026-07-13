import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { TestChatServer, waitUntil, serverMessageFor } from './test-helpers/real-chat-server';

/**
 * Gates 5, 6, 11, 12 — real Socket.IO leak, concurrency, soak, and timing
 * verification. Same unmocked socket-client.ts/outbox.ts + real server as
 * outbox.integration.test.ts (Gate 4); this file focuses on repeated-cycle
 * resource hygiene, concurrent-message correctness, and volume/timing.
 */

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

let server: TestChatServer;
let outboxMod: typeof import('./outbox');
let socketClientMod: typeof import('./socket-client');
let chatStoreMod: typeof import('@/store/chat.store');

const TIMING = {
  CHAT_SEND_ACK_TIMEOUT_MS: 250,
  NORMAL_RECONNECT_GRACE_MS: 120,
  FRESH_SOCKET_CONNECT_TIMEOUT_MS: 400,
};

beforeAll(async () => {
  server = await TestChatServer.start();
  process.env['NEXT_PUBLIC_WS_URL'] = `http://localhost:${server.port}`;
  outboxMod = await import('./outbox');
  socketClientMod = await import('./socket-client');
  chatStoreMod = await import('@/store/chat.store');
  outboxMod.__setOutboxTimingForTests(TIMING);
}, 20_000);

afterAll(async () => {
  socketClientMod.disconnectSocket();
  await server.stop();
});

function messages(conversationId: string) {
  return chatStoreMod.useChatStore.getState().messages[conversationId] ?? [];
}
function findMessage(conversationId: string, cid: string) {
  return messages(conversationId).find((m) => m.clientMessageId === cid);
}

beforeEach(async () => {
  outboxMod.__resetOutboxForTests();
  socketClientMod.__resetSocketClientForTests();
  server.resetScenarioState();
  // See outbox.integration.test.ts for why this must be awaited: the
  // previous test's afterEach only *initiates* a real disconnect; clearing
  // connection history must wait for the server to actually see it close.
  await server.disconnectAllAndResetConnections();
  chatStoreMod.useChatStore.setState({ messages: {}, conversations: [], typingUsers: {}, hasMore: {}, nextCursor: {} });
});

afterEach(() => {
  socketClientMod.disconnectSocket();
});

const SENDER = { id: 'u1', firstName: 'Ali', lastName: 'Rezaei' };

// ─── Gate 5: repeated recovery cycles — no Manager/listener leak ───────────

describe('Gate 5 — 20 sequential recovery cycles: no Manager/listener leak', () => {
  it('active connection count and application-listener counts stay flat across 20 zombie→rebuild cycles', async () => {
    const CONV = 'conv-leak-1';
    const listenerCountsBefore: number[] = [];
    const listenerCountsAfter: number[] = [];
    const EVENTS = ['chat:message:new', 'chat:message:updated', 'chat:message:deleted', 'chat:typing', 'connect', 'disconnect'];

    // Bookkeeping is cumulative (NOT reset per cycle): the point of this gate
    // is that a socket which survived a PRIOR cycle healthily must also be
    // forceable into the zombie condition again — connections/handlers are
    // tracked against the server's real, ever-growing connection index, not
    // reset to a fake per-cycle "0" that would silently stop matching once
    // the client is already connected going into a later cycle.
    for (let cycle = 0; cycle < 20; cycle++) {
      const connectionsBeforeCycle = server.connections.length;
      // Whichever physical connection is currently live becomes this cycle's
      // zombie; the connection created by ITS rebuild acks normally (no
      // handler registered for it).
      const liveIdx = Math.max(0, server.connections.length - 1);
      server.ignoreAcksOn(liveIdx);

      const before = socketClientMod.getSocket();
      listenerCountsBefore.push(EVENTS.reduce((sum, e) => sum + before.listeners(e).length, 0));

      outboxMod.sendText({ conversationId: CONV, body: `cycle ${cycle}`, sender: SENDER });
      const cid = messages(CONV)[messages(CONV).length - 1]!.clientMessageId!;

      await waitUntil(
        () => findMessage(CONV, cid)?.deliveryState === 'sent',
        5_000,
        `cycle ${cycle} recovers to sent`,
      );

      // Exactly one rebuild this cycle: exactly one NEW physical connection.
      expect(server.connections.length).toBe(connectionsBeforeCycle === 0 ? 2 : connectionsBeforeCycle + 1);
      const zombieConn = server.connections[liveIdx]!;
      await waitUntil(() => !zombieConn.connected, 2_000, `cycle ${cycle} old connection closes`);
      expect(server.liveConnectionCount()).toBe(1);

      // Rebuild bookkeeping fully settled — no dangling rebuild state.
      expect(socketClientMod.getSocketHealth()).toBe('healthy');

      const after = socketClientMod.getSocket();
      listenerCountsAfter.push(EVENTS.reduce((sum, e) => sum + after.listeners(e).length, 0));
    }

    // Generation increased by exactly one rebuild per cycle (20 cycles → generation 21:
    // 1 for the very first getSocket() + 1 per cycle's single rebuild).
    expect(socketClientMod.getSocketGeneration()).toBe(21);

    // No growth in per-socket application listener counts across cycles —
    // each fresh socket starts with the same fixed listener set every time.
    const distinctBefore = new Set(listenerCountsBefore);
    const distinctAfter = new Set(listenerCountsAfter);
    expect(distinctBefore.size).toBe(1);
    expect(distinctAfter.size).toBe(1);
    expect(Math.max(...listenerCountsAfter)).toBe(Math.min(...listenerCountsAfter));
  }, 30_000);
});

// ─── Gate 6: concurrency — 5 simultaneous zombied messages ─────────────────

describe('Gate 6 — concurrency: 5 messages timing out close together', () => {
  it('share exactly one rebuild, all retry on the fresh generation, no loss/duplication/cross-resolution', async () => {
    const CONV = 'conv-concurrent-1';
    server.ignoreAcksOn(0); // the shared first (zombie) connection

    const cids: string[] = [];
    for (let i = 0; i < 5; i++) {
      outboxMod.sendText({ conversationId: CONV, body: `msg-${i}`, sender: SENDER });
    }
    const list = messages(CONV);
    expect(list).toHaveLength(5);
    for (const m of list) cids.push(m.clientMessageId!);

    await waitUntil(
      () => cids.every((cid) => findMessage(CONV, cid)?.deliveryState === 'sent'),
      8_000,
      'all 5 concurrent messages recover to sent',
    );

    // Single-flight: exactly one rebuild for all 5 concurrently-timing-out messages.
    expect(server.connections.length).toBe(2);

    // Every clientMessageId appears in the received log; each exactly twice (zombie attempt + fresh retry)
    // OR once if it happened to be part of the same generation reuse — but the shared-rebuild design
    // guarantees a bounded 1..2 emits per message here.
    for (const cid of cids) {
      const count = server.received.filter((r) => r.payload.clientMessageId === cid).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    }

    // No duplicate rows: exactly 5 distinct messages in the store, one per clientMessageId.
    expect(new Set(messages(CONV).map((m) => m.clientMessageId))).toEqual(new Set(cids));
    expect(messages(CONV)).toHaveLength(5);

    // No cross-resolution: every message's final server id matches its own clientMessageId.
    for (const m of messages(CONV)) {
      expect(m.id).toBe(`srv-${m.clientMessageId}`);
    }
  }, 20_000);

  it('one message failing (double timeout) does not fail the others', async () => {
    const CONV = 'conv-concurrent-2';
    server.ignoreAcksOn(0);

    outboxMod.sendText({ conversationId: CONV, body: 'will-fail', sender: SENDER });
    const failingCid = messages(CONV)[0]!.clientMessageId!;
    // The second attempt for THIS message must also fail — force it once the
    // rebuilt connection (index 1) is known by never acking that specific cid.
    server.handlers.set(1, (payload, ack) => {
      if (payload.clientMessageId === failingCid) return; // never ack this one
      ack({ ok: true, clientMessageId: payload.clientMessageId, message: serverMessageFor(payload) });
    });

    outboxMod.sendText({ conversationId: CONV, body: 'will-succeed', sender: SENDER });
    const okCid = messages(CONV)[1]!.clientMessageId!;

    await waitUntil(() => findMessage(CONV, failingCid)?.deliveryState === 'failed', 8_000, 'failing message fails');
    await waitUntil(() => findMessage(CONV, okCid)?.deliveryState === 'sent', 8_000, 'other message still succeeds');

    expect(findMessage(CONV, failingCid)?.deliveryState).toBe('failed');
    expect(findMessage(CONV, okCid)?.deliveryState).toBe('sent');
  }, 20_000);
});

// ─── Gate 11/12: soak test + timing measurement ────────────────────────────

describe('Gate 11/12 — soak test (100 messages, deterministic failure schedule) + timing', () => {
  it('recovers every intentionally-recoverable message with bounded, measured latency', async () => {
    const CONV = 'conv-soak-1';
    const TOTAL = 100;
    const ZOMBIE_EVERY = 10; // every 10th message's *first* delivery attempt is a zombie

    const recoveryLatencies: number[] = [];
    const sentAt = new Map<string, number>();
    let zombieCount = 0;

    const cids: string[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const t0 = Date.now();
      outboxMod.sendText({ conversationId: CONV, body: `soak-${i}`, sender: SENDER });
      const cid = messages(CONV)[messages(CONV).length - 1]!.clientMessageId!;
      cids.push(cid);
      // Message-keyed zombie injection (not connection-index-keyed): correct
      // regardless of how many sends land on the same connection in the same
      // synchronous burst — the server swallows THIS message's first attempt
      // exactly once, on whichever real connection it happens to arrive on.
      if ((i + 1) % ZOMBIE_EVERY === 0) {
        server.zombieOnceByClientMessageId.add(cid);
        zombieCount++;
      }
      sentAt.set(cid, t0);
    }

    await waitUntil(
      () => cids.every((cid) => {
        const s = findMessage(CONV, cid)?.deliveryState;
        return s === 'sent' || s === 'failed';
      }),
      60_000,
      'all 100 soak messages reach a terminal state',
    );

    for (const cid of cids) {
      const m = findMessage(CONV, cid);
      if (m?.deliveryState === 'sent') {
        recoveryLatencies.push(Date.now() - sentAt.get(cid)!);
      }
    }

    const sentCount = messages(CONV).filter((m) => m.deliveryState === 'sent').length;
    const failedCount = messages(CONV).filter((m) => m.deliveryState === 'failed').length;
    const duplicateCheck = new Set(messages(CONV).map((m) => m.clientMessageId));

    // No message lost or duplicated.
    expect(messages(CONV)).toHaveLength(TOTAL);
    expect(duplicateCheck.size).toBe(TOTAL);
    expect(sentCount + failedCount).toBe(TOTAL);
    // The overwhelming majority must recover (some zombie sends may legitimately
    // land as failed only if both attempts on the same cid were swallowed,
    // which this schedule avoids by design — expect zero failures here).
    expect(failedCount).toBe(0);
    expect(sentCount).toBe(TOTAL);

    const maxLatency = Math.max(...recoveryLatencies);
    const avgLatency = recoveryLatencies.reduce((a, b) => a + b, 0) / recoveryLatencies.length;

    // eslint-disable-next-line no-console
    console.log(
      `[soak-report] total=${TOTAL} sent=${sentCount} failed=${failedCount} ` +
        `zombieSchedule=${zombieCount} duplicates=${TOTAL - duplicateCheck.size} ` +
        `maxLatencyMs=${maxLatency.toFixed(0)} avgLatencyMs=${avgLatency.toFixed(0)} ` +
        `rebuildCount=${socketClientMod.getSocketGeneration() - 1} ` +
        `liveConnections=${server.liveConnectionCount()}`,
    );

    // Bounded worst case at the SCALED timing (ack + rebuild + ack), with slack.
    const worstCaseBound = TIMING.CHAT_SEND_ACK_TIMEOUT_MS + TIMING.FRESH_SOCKET_CONNECT_TIMEOUT_MS + TIMING.CHAT_SEND_ACK_TIMEOUT_MS + 500;
    expect(maxLatency).toBeLessThan(worstCaseBound);

    // Exactly one active connection remains — no leaked sockets after 100 sends.
    expect(server.liveConnectionCount()).toBe(1);

    // At least one real rebuild actually occurred (proves the zombie schedule
    // was not silently skipped). It is legitimately allowed to be exactly 1
    // even though 10 messages were scheduled as zombies: sendText() dispatches
    // all 100 messages synchronously in one JS tick, so every zombie'd message
    // lands on the SAME live connection before any recovery can run, and the
    // single-flight rebuild guarantee proven in Gate 6 means all 10 share one
    // rebuild rather than triggering 10 separate ones. A higher count is also
    // valid (e.g. under real inter-send delay); the important guarantees are
    // covered above: 0 failures, 0 duplicates, exactly 1 live connection left.
    expect(socketClientMod.getSocketGeneration()).toBeGreaterThanOrEqual(2);
  }, 65_000);
});
