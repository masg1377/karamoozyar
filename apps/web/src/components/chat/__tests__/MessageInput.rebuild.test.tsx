// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { useState, useEffect } from 'react';

/**
 * SCRATCH-ONLY regression test (Gap 3 defect fix): MessageInput.tsx's
 * unmount-cleanup effect (deps=[conversationId] only) used to close over a
 * STALE `socket` from render time, so its CHAT_TYPING_STOP emit on unmount
 * would silently target a torn-down socket if a hard rebuild happened while
 * the component stayed mounted on the same conversation. Fixed via a
 * `socketRef` mirror in MessageInput.tsx. This test fails on the pre-fix
 * code and passes after (reverting the fix reproduces the failure).
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

describe('MessageInput — unmount cleanup targets the CURRENT socket, not a stale one (Gap 3 fix)', () => {
  beforeEach(() => {
    subscribers = [];
    currentSocket = makeFakeSocket('sock-1');
  });

  it('emits CHAT_TYPING_STOP on the FRESH socket at unmount after a hard rebuild happened while mounted', async () => {
    const { MessageInput } = await import('@/components/chat/MessageInput');
    const { unmount } = render(<MessageInput conversationId="conv-1" />);

    const oldSocket = currentSocket;
    const oldEmitSpy = vi.spyOn(oldSocket, 'emit');
    const freshSocket = makeFakeSocket('sock-2');
    const freshEmitSpy = vi.spyOn(freshSocket, 'emit');

    // Simulate a hard rebuild while MessageInput stays mounted on the same conversation.
    act(() => {
      replaceSocket(freshSocket);
    });

    act(() => {
      unmount();
    });

    // The defect: this used to fire on oldSocket (stale closure). The fix
    // routes it through socketRef.current, i.e. the fresh socket.
    expect(freshEmitSpy).toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });
    expect(oldEmitSpy).not.toHaveBeenCalledWith('chat:typing:stop', { conversationId: 'conv-1' });

    cleanup();
  });
});
