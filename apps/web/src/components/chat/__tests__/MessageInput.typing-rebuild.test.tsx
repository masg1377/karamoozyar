// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { useState, useEffect } from 'react';

/**
 * Stabilization-pass regression tests (Task 2): every typing-related emit in
 * MessageInput.tsx — the immediate CHAT_TYPING_START/STOP, the delayed
 * 2-second timer's CHAT_TYPING_STOP, and the unmount/conversation-change
 * CHAT_TYPING_STOP — must go through whichever socket is CURRENT at emit
 * time, never the one captured in a closure when that closure was created.
 *
 * Before this fix, `handleTyping`'s setTimeout callback closed directly over
 * the render-time `socket` value (not `socketRef.current`), so a hard
 * rebuild happening AFTER the timer was scheduled but BEFORE it fired would
 * still emit CHAT_TYPING_STOP on the old, torn-down socket. Reverting the
 * `socketRef.current` reads in handleTyping back to plain `socket` reads
 * reproduces every failure below.
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

vi.mock('@/hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: () => ({
    isRecording: false, duration: 0, startRecording: vi.fn(), stopRecording: vi.fn(async () => null), cancelRecording: vi.fn(),
  }),
}));
vi.mock('@/store/auth.store', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1', firstName: 'Ali', lastName: 'R' } }) }));
vi.mock('@/lib/outbox', () => ({ sendText: vi.fn(), sendMedia: vi.fn(), voiceFileFromBlob: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('emoji-picker-react', () => ({ default: () => null }));

function replaceSocket(next: FakeSocket) {
  currentSocket = next;
  for (const fn of subscribers) fn(next);
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

describe('MessageInput — every typing emit uses the CURRENT socket, never a stale closure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    subscribers = [];
    currentSocket = makeFakeSocket('sock-1');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('1. typing timer after rebuild: STOP fires on socket B, not socket A', async () => {
    const { MessageInput } = await import('@/components/chat/MessageInput');
    const { container } = render(<MessageInput conversationId="conv-1" />);
    const textarea = container.querySelector('textarea')!;

    const socketA = currentSocket;
    const emitA = vi.spyOn(socketA, 'emit');

    // Start typing through A.
    act(() => {
      typeInto(textarea, 'h');
    });
    expect(emitA).toHaveBeenCalledWith('chat:typing:start', { conversationId: 'conv-1' });

    // Hard rebuild replaces A with B BEFORE the 2s timer fires.
    const socketB = makeFakeSocket('sock-2');
    const emitB = vi.spyOn(socketB, 'emit');
    act(() => {
      replaceSocket(socketB);
    });

    // Advance past the 2-second typing-stop timer.
    act(() => {
      vi.advanceTimersByTime(2100);
    });

    expect(emitB).toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });
    expect(emitA).not.toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });
  });

  it('2. unmount after rebuild: cleanup STOP fires on socket B only', async () => {
    const { MessageInput } = await import('@/components/chat/MessageInput');
    const { container, unmount } = render(<MessageInput conversationId="conv-1" />);
    const textarea = container.querySelector('textarea')!;

    const socketA = currentSocket;
    const emitA = vi.spyOn(socketA, 'emit');

    act(() => {
      typeInto(textarea, 'h');
    });

    const socketB = makeFakeSocket('sock-2');
    const emitB = vi.spyOn(socketB, 'emit');
    act(() => {
      replaceSocket(socketB);
    });

    // Unmount BEFORE the 2-second timer would have fired on its own.
    act(() => {
      unmount();
    });

    expect(emitB).toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });
    expect(emitA).not.toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });
  });

  it('3. immediate typing event after rebuild: next START/STOP emitted through socket B only', async () => {
    const { MessageInput } = await import('@/components/chat/MessageInput');
    const { container } = render(<MessageInput conversationId="conv-1" />);
    const textarea = container.querySelector('textarea')!;

    const socketA = currentSocket;
    const emitA = vi.spyOn(socketA, 'emit');

    act(() => {
      typeInto(textarea, 'h');
    });
    // Let the timer settle so isTyping is back to false before the rebuild.
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    emitA.mockClear();

    const socketB = makeFakeSocket('sock-2');
    const emitB = vi.spyOn(socketB, 'emit');
    act(() => {
      replaceSocket(socketB);
    });

    // The very next typing keystroke after the rebuild.
    act(() => {
      typeInto(textarea, 'hi');
    });

    expect(emitB).toHaveBeenCalledWith('chat:typing:start', { conversationId: 'conv-1' });
    expect(emitA).not.toHaveBeenCalled();
  });

  it('4. no duplicate typing events or timers after normal rerenders (no rebuild)', async () => {
    const { MessageInput } = await import('@/components/chat/MessageInput');
    const { container, rerender } = render(<MessageInput conversationId="conv-1" />);
    const textarea = container.querySelector('textarea')!;

    const socketA = currentSocket;
    const emitA = vi.spyOn(socketA, 'emit');

    act(() => {
      typeInto(textarea, 'h');
    });
    expect(emitA).toHaveBeenCalledTimes(1);

    // Re-render with the same props/socket several times (e.g. parent state
    // churn unrelated to typing) — must not re-fire START or reset/duplicate
    // the pending stop timer.
    rerender(<MessageInput conversationId="conv-1" />);
    rerender(<MessageInput conversationId="conv-1" />);
    rerender(<MessageInput conversationId="conv-1" />);

    expect(emitA).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2100);
    });

    // Exactly one STOP from the one timer that was actually scheduled.
    const stopCalls = emitA.mock.calls.filter((c) => c[0] === 'chat:typing:stop');
    expect(stopCalls).toHaveLength(1);
    expect(emitA).toHaveBeenCalledTimes(2); // 1 start + 1 stop, nothing duplicated
  });
});
