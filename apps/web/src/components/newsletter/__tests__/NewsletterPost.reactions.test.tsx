// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventEmitter } from 'node:events';
import { useState, useEffect } from 'react';

/**
 * SCRATCH-ONLY regression test (Gap 3): NewsletterPost's ReactionsBar reads
 * `useLiveSocket()` fresh on every render and emits inline (no stale ref), so
 * a reaction click AFTER a hard rebuild must go out on the NEW socket.
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
vi.mock('@/store/newsletter.store', () => ({ useNewsletterStore: () => ({ updatePost: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api-client', () => ({ default: { post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));

function replaceSocket(next: FakeSocket) {
  currentSocket = next;
  for (const fn of subscribers) fn(next);
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    reactionSummary: { LIKE: 1 },
    myReaction: 'LIKE',
    seenCount: 0,
    isSeen: true,
    ...overrides,
  } as never;
}

describe('NewsletterPost ReactionsBar — emits on the CURRENT socket after a hard rebuild (Gap 3)', () => {
  it('handleRemoveReact emits NEWSLETTER_REACT_REMOVE on the fresh socket, never the old one', async () => {
    subscribers = [];
    currentSocket = makeFakeSocket('sock-1');
    const { ReactionsBar } = await import('@/components/newsletter/NewsletterPost');
    render(<ReactionsBar post={post()} />);

    const oldSocket = currentSocket;
    const oldEmitSpy = vi.spyOn(oldSocket, 'emit');
    const freshSocket = makeFakeSocket('sock-2');
    const freshEmitSpy = vi.spyOn(freshSocket, 'emit');

    replaceSocket(freshSocket); // simulate hard rebuild while mounted

    const btn = screen.getByText('واکنش');
    await userEvent.click(btn);

    expect(freshEmitSpy).toHaveBeenCalledWith('newsletter:react:remove', { postId: 'post-1' });
    expect(oldEmitSpy).not.toHaveBeenCalled();
    cleanup();
  });
});
