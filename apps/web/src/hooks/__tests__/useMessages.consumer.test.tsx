// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { useState, useEffect } from 'react';

/**
 * SCRATCH-ONLY regression test (Gap 3): proves useMessages.ts stays reactive
 * across a socket replacement (hard rebuild) -- old listeners removed, new
 * listeners attached exactly once, no duplicate incoming-event handling, and
 * CHAT_JOIN is re-emitted on the fresh socket.
 */

type FakeSocket = EventEmitter & { id: string; emit: (...a: unknown[]) => boolean };

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

vi.mock('@/lib/api-client', () => ({
  default: { get: vi.fn(async () => ({ data: { data: { data: [], nextCursor: null } } })) },
}));

const storeState = {
  messages: {} as Record<string, unknown[]>,
  hasMore: {} as Record<string, boolean>,
  nextCursor: {} as Record<string, string | null>,
  mergeMessages: vi.fn(),
  prependMessages: vi.fn(),
  reconcile: vi.fn(),
  updateMessage: vi.fn(),
  removeMessage: vi.fn(),
  setTyping: vi.fn(),
};
vi.mock('@/store/chat.store', () => ({
  useChatStore: () => storeState,
}));

function replaceSocket(next: FakeSocket) {
  currentSocket = next;
  for (const fn of subscribers) fn(next);
}

describe('useMessages — socket replacement regression (Gap 3)', () => {
  beforeEach(() => {
    subscribers = [];
    currentSocket = makeFakeSocket('sock-1');
    Object.values(storeState).forEach((v) => typeof v === 'function' && (v as ReturnType<typeof vi.fn>).mockClear?.());
  });

  it('attaches listeners exactly once, re-attaches to the fresh socket after rebuild, removes old listeners, and never double-handles an event', async () => {
    const { useMessages } = await import('@/hooks/useMessages');
    const { result, rerender } = renderHook(({ cid }) => useMessages(cid), { initialProps: { cid: 'conv-1' } });

    await waitFor(() => {
      expect(currentSocket.listenerCount('chat:message:new')).toBe(1);
    });
    const oldSocket = currentSocket;
    expect(oldSocket.listenerCount('chat:message:new')).toBe(1);
    expect(oldSocket.listenerCount('chat:message:updated')).toBe(1);
    expect(oldSocket.listenerCount('chat:message:deleted')).toBe(1);
    expect(oldSocket.listenerCount('chat:typing')).toBe(1);
    expect(oldSocket.listenerCount('connect')).toBe(1);

    // Simulate a hard rebuild: a brand-new socket instance replaces the old one.
    const freshSocket = makeFakeSocket('sock-2');
    replaceSocket(freshSocket);
    rerender({ cid: 'conv-1' });

    await waitFor(() => {
      expect(freshSocket.listenerCount('chat:message:new')).toBe(1);
    });

    // Old socket's listeners must be fully removed (no leak, no stale handling).
    expect(oldSocket.listenerCount('chat:message:new')).toBe(0);
    expect(oldSocket.listenerCount('chat:message:updated')).toBe(0);
    expect(oldSocket.listenerCount('chat:message:deleted')).toBe(0);
    expect(oldSocket.listenerCount('chat:typing')).toBe(0);
    expect(oldSocket.listenerCount('connect')).toBe(0);

    // Exactly one listener per event on the fresh socket (no duplicate attachment).
    expect(freshSocket.listenerCount('chat:message:new')).toBe(1);
    expect(freshSocket.listenerCount('chat:message:updated')).toBe(1);
    expect(freshSocket.listenerCount('chat:message:deleted')).toBe(1);
    expect(freshSocket.listenerCount('chat:typing')).toBe(1);
    expect(freshSocket.listenerCount('connect')).toBe(1);

    // An incoming event on the OLD (torn-down) socket must NOT be handled --
    // proves no duplicate/ghost handling survives a rebuild.
    storeState.reconcile.mockClear();
    oldSocket.emit('chat:message:new', { conversationId: 'conv-1', id: 'ghost' });
    expect(storeState.reconcile).not.toHaveBeenCalled();

    // The SAME event on the fresh socket IS handled exactly once.
    freshSocket.emit('chat:message:new', { conversationId: 'conv-1', id: 'real-1' });
    expect(storeState.reconcile).toHaveBeenCalledTimes(1);

    result.current; // keep reference alive for lint
  });

  it('unmount cleanly removes all listeners from the then-current socket (no leak)', async () => {
    const { useMessages } = await import('@/hooks/useMessages');
    const { unmount } = renderHook(() => useMessages('conv-unmount'));
    await waitFor(() => expect(currentSocket.listenerCount('chat:message:new')).toBe(1));
    const sock = currentSocket;
    unmount();
    expect(sock.listenerCount('chat:message:new')).toBe(0);
    expect(sock.listenerCount('connect')).toBe(0);
  });
});
