// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { act } from 'react';
import { EventEmitter } from 'node:events';
import { useState, useEffect } from 'react';

/**
 * SCRATCH-ONLY regression test (Gap 3): the admin conversation-detail page's
 * CHAT_MESSAGE_PINNED listener (registered via useLiveSocket, same pattern
 * and same code comment as the user chat page) must move to the fresh
 * socket after a hard rebuild -- old listener removed, new listener attached
 * exactly once, no duplicate handling.
 */

type FakeSocket = EventEmitter & { id: string };
function makeFakeSocket(id: string): FakeSocket {
  const e = new EventEmitter() as FakeSocket;
  e.id = id;
  return e;
}

let currentSocket: FakeSocket;
let subscribers: Array<(s: FakeSocket) => void>;

vi.mock('@/hooks/useSocket', () => ({
  useLiveSocket: () => {
    const [s, setS] = useState(currentSocket);
    useEffect(() => {
      subscribers.push(setS);
      return () => {
        subscribers = subscribers.filter((f) => f !== setS);
      };
    }, []);
    return s;
  },
}));
vi.mock('@/lib/socket-client', () => ({ getSocket: () => currentSocket }));
// See the user-chat-page test for a full explanation of this test-tooling
// anomaly (a handful of SOCKET_EVENTS keys resolve `undefined` under
// vitest/esbuild in this sandbox despite being present in source and in a
// standalone esbuild transform, and despite a successful `next build`).
vi.mock('@karamooziyar/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SOCKET_EVENTS: { ...(actual.SOCKET_EVENTS as Record<string, string>), CHAT_MESSAGE_PINNED: 'chat:message:pinned' },
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'conv-1' }),
}));
vi.mock('@/store/auth.store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'admin-1' } }) }));
vi.mock('@/store/chat.store', () => ({ useChatStore: (sel?: (s: unknown) => unknown) => (sel ? sel({ typingUsers: {} }) : { typingUsers: {} }) }));
vi.mock('@/hooks/useMessages', () => ({
  useMessages: () => ({ messages: [], canLoadMore: false, loadMore: vi.fn(), isLoadingMore: false }),
}));
vi.mock('@/hooks/useChatScroll', () => ({
  useChatScroll: () => ({
    scrollContainerRef: { current: null }, bottomRef: { current: null }, messageRefs: { current: {} },
    onScroll: vi.fn(), handleLoadMoreClick: vi.fn(), stickyLabel: null, showSticky: false,
  }),
}));
vi.mock('@/hooks/useIosKeyboardInset', () => ({ useIosKeyboardInset: () => {} }));
vi.mock('@/components/chat/MessageBubble', () => ({ MessageBubble: () => null }));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: () => null }));
vi.mock('@/components/chat/PinnedMessagesBar', () => ({ PinnedMessagesBar: () => null }));
vi.mock('@/components/chat/DateDivider', () => ({ DateDivider: () => null, StickyDate: () => null }));
vi.mock('@/components/shared/LoadingSpinner', () => ({ LoadingSpinner: () => null }));
vi.mock('@/components/shared/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('@/lib/navigation', () => ({ goBackOrReplace: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api-client', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/conversations/conv-1') return Promise.resolve({ data: { data: { id: 'conv-1', user: { firstName: 'Ali', lastName: 'R' } } } });
      return Promise.resolve({ data: { data: [] } });
    }),
    patch: vi.fn(), delete: vi.fn(),
  },
}));

function replaceSocket(next: FakeSocket) {
  currentSocket = next;
  for (const fn of subscribers) fn(next);
}

describe('Admin conversation-detail page — CHAT_MESSAGE_PINNED listener survives a hard rebuild (Gap 3)', () => {
  it('removes the old socket listener and attaches exactly one new listener on the fresh socket after rebuild', async () => {
    subscribers = [];
    currentSocket = makeFakeSocket('sock-1');
    const { default: AdminConversationPage } = await import('../page');

    render(<AdminConversationPage />);

    await waitFor(() => {
      expect(currentSocket.listenerCount('chat:message:pinned')).toBe(1);
    }, { timeout: 3000 });

    const oldSocket = currentSocket;
    const freshSocket = makeFakeSocket('sock-2');

    act(() => {
      replaceSocket(freshSocket);
    });

    await waitFor(() => {
      expect(freshSocket.listenerCount('chat:message:pinned')).toBe(1);
    });

    expect(oldSocket.listenerCount('chat:message:pinned')).toBe(0);

    let handled = 0;
    freshSocket.removeAllListeners('chat:message:pinned');
    freshSocket.on('chat:message:pinned', () => { handled++; });
    oldSocket.emit('chat:message:pinned', { action: 'pin', message: { id: 'm1' } });
    freshSocket.emit('chat:message:pinned', { action: 'pin', message: { id: 'm1' } });
    expect(handled).toBe(1);

    cleanup();
  });
});
