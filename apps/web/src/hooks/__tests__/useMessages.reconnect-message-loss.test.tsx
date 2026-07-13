// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { TestChatServer } from '@/lib/test-helpers/real-chat-server';

/**
 * Regression test for the reported production bug: a message sent while
 * offline sends successfully once the network returns, is briefly visible as
 * `sent`, and then DISAPPEARS from the currently-open conversation until the
 * page is refreshed.
 *
 * This uses the REAL chat.store, REAL message-merge, REAL outbox, and REAL
 * useMessages hook against a REAL Socket.IO server (no mocked transport). Only
 * the REST api-client is mocked, and only so the test can pick the exact
 * moment a reconnect-triggered history refetch resolves relative to the real
 * ACK — reproducing a genuine race without depending on incidental timing.
 */

vi.mock('@/store/auth.store', () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true, user: { id: 'u1' } }) },
}));

let pendingGets: Array<{ resolve: (v: unknown) => void }>;
vi.mock('@/lib/api-client', () => ({
  default: {
    get: vi.fn(() => new Promise((resolve) => { pendingGets.push({ resolve }); })),
  },
  tokenStore: {
    getAccess: () => 'test-access-token',
    getRefresh: () => 'test-refresh-token',
    setAccess: vi.fn(),
    setRefresh: vi.fn(),
    clear: vi.fn(),
  },
  refreshAccessToken: vi.fn(async () => 'test-access-token'),
}));

function resolveAllPendingGets(): number {
  const count = pendingGets.length;
  for (const g of pendingGets.splice(0)) {
    g.resolve({ data: { data: { data: [], nextCursor: null } } });
  }
  return count;
}

let server: TestChatServer;
let outboxMod: typeof import('@/lib/outbox');
let socketClientMod: typeof import('@/lib/socket-client');
let chatStoreMod: typeof import('@/store/chat.store');
let useMessagesMod: typeof import('@/hooks/useMessages');

const CONV = 'conv-reconnect-loss';
const SENDER = { id: 'u1', firstName: 'Ali', lastName: 'Rezaei' };

function messages() {
  return chatStoreMod.useChatStore.getState().messages[CONV] ?? [];
}

beforeAll(async () => {
  server = await TestChatServer.start();
  process.env['NEXT_PUBLIC_WS_URL'] = `http://localhost:${server.port}`;
  outboxMod = await import('@/lib/outbox');
  socketClientMod = await import('@/lib/socket-client');
  chatStoreMod = await import('@/store/chat.store');
  useMessagesMod = await import('@/hooks/useMessages');
  outboxMod.__setOutboxTimingForTests({
    CHAT_SEND_ACK_TIMEOUT_MS: 400,
    NORMAL_RECONNECT_GRACE_MS: 300,
    FRESH_SOCKET_CONNECT_TIMEOUT_MS: 800,
  });
}, 20_000);

afterAll(async () => {
  socketClientMod.disconnectSocket();
  await server.stop();
});

beforeEach(async () => {
  pendingGets = [];
  outboxMod.__resetOutboxForTests();
  socketClientMod.__resetSocketClientForTests();
  server.resetScenarioState();
  await server.disconnectAllAndResetConnections();
  chatStoreMod.useChatStore.setState({
    messages: {}, conversations: [], typingUsers: {}, hasMore: {}, nextCursor: {},
  });
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

afterEach(() => {
  socketClientMod.disconnectSocket();
});

describe('useMessages — offline reconnect must not remove a just-confirmed message', () => {
  it('the message stays visible exactly once after offline -> online -> real ack, even if a racing history refetch resolves without it', async () => {
    const { result } = renderHook(() => useMessagesMod.useMessages(CONV));

    // Let the hook fully mount and connect against the real test server.
    await waitFor(() => expect(socketClientMod.getSocket().connected).toBe(true), { timeout: 3000 });
    // Drain whatever GET(s) the mount produced (initial loadInitial(), and/or
    // an onReconnect() from the socket's very first 'connect' event).
    await waitFor(() => expect(pendingGets.length).toBeGreaterThanOrEqual(1));
    act(() => { resolveAllPendingGets(); });
    await waitFor(() => expect(result.current.messages).toHaveLength(0));

    // Go offline: this is a REAL network outage in production, so the actual
    // transport drops too, not just the navigator.onLine flag.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    socketClientMod.getSocket().disconnect();

    let cid: string;
    act(() => {
      outboxMod.sendText({ conversationId: CONV, body: 'hello from offline', sender: SENDER });
    });
    cid = messages()[0]!.clientMessageId!;
    expect(result.current.messages).toHaveLength(1);
    await waitFor(() => {
      expect(messages().find((m) => m.clientMessageId === cid)?.deliveryState).toBe('awaiting-connection');
    });

    // Real network returns.
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event('online')); });

    // Wait for the REAL socket to reconnect and the REAL server ack to land —
    // the message is durably confirmed.
    await waitFor(() => {
      expect(messages().find((m) => m.clientMessageId === cid)?.deliveryState).toBe('sent');
    }, { timeout: 5000 });

    // The reconnect ('connect' firing again on this socket, and/or the
    // useLiveSocket-driven effect re-run) queues a history refetch. Let it
    // resolve NOW — i.e. AFTER the message was already reconciled to `sent` —
    // with an empty/stale snapshot that does not (yet) contain it. This is
    // the exact race: an older refetch racing behind a newer reconciliation.
    await waitFor(() => expect(pendingGets.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
    await act(async () => {
      resolveAllPendingGets();
      // Let the resolved GET's .then chain (loadInitial -> mergeMessages)
      // fully settle before asserting.
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Nothing else should still be pending at this point (a legitimately
    // later, correct refetch is not what this test is about — it isolates
    // the single stale-snapshot race).
    expect(pendingGets).toHaveLength(0);

    // The message must remain visible exactly once, with its confirmed state
    // — both in the authoritative store and in the hook's own return value
    // (what the UI actually renders). THIS is what fails on the current
    // (unfixed) code: the stale empty snapshot wipes the already-confirmed
    // message from the merged list.
    const finalList = messages();
    expect(finalList).toHaveLength(1);
    expect(finalList[0]!.clientMessageId).toBe(cid);
    expect(finalList[0]!.id).not.toBe(cid); // real server id assigned
    expect(finalList[0]!.deliveryState).toBe('sent');

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.clientMessageId).toBe(cid);
  }, 15_000);
});

describe('Regression matrix F — socket replacement only (no offline), message list unchanged', () => {
  it('listeners move from socket A to socket B; an already-sent message is unaffected even if the resulting refetch resolves stale', async () => {
    const { result } = renderHook(() => useMessagesMod.useMessages(CONV));
    await waitFor(() => expect(socketClientMod.getSocket().connected).toBe(true), { timeout: 3000 });
    await waitFor(() => expect(pendingGets.length).toBeGreaterThanOrEqual(1));
    act(() => { resolveAllPendingGets(); });
    await waitFor(() => expect(result.current.messages).toHaveLength(0));

    // Seed an already-confirmed message directly (no send in flight) — the
    // scenario under test is purely "the socket got replaced", independent of
    // any concurrent send/ack.
    act(() => {
      chatStoreMod.useChatStore.getState().reconcile(CONV, {
        id: 'srv-seed-1',
        clientMessageId: 'cm-seed-1',
        conversationId: CONV,
        senderId: 'u2',
        senderName: 'Other User',
        type: 'TEXT' as never,
        body: 'already here',
        status: 'SENT' as never,
        isEdited: false,
        editedAt: null,
        deletedAt: null,
        pinnedAt: null,
        attachment: null,
        replyToMessage: null,
        createdAt: new Date().toISOString(),
        deliveryState: 'sent',
      });
    });
    expect(result.current.messages).toHaveLength(1);

    const socketA = socketClientMod.getSocket();
    const oldGeneration = socketClientMod.getSocketGeneration();

    // A genuine hard rebuild — brand-new Manager/Engine/socket — with no
    // offline transition and no message currently sending.
    await act(async () => {
      await socketClientMod.hardRebuildSocket('test-forced-rebuild', 2000);
    });
    const socketB = socketClientMod.getSocket();
    expect(socketB.id).not.toBe(socketA.id);
    expect(socketClientMod.getSocketGeneration()).toBeGreaterThan(oldGeneration);

    // Whatever refetch the replacement triggers, resolve it stale (empty) —
    // the message list must still be unchanged.
    if (pendingGets.length > 0) {
      await act(async () => {
        resolveAllPendingGets();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 20));
      });
    }

    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.clientMessageId).toBe('cm-seed-1');
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]!.clientMessageId).toBe('cm-seed-1');
  }, 15_000);
});
