// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * SCRATCH-ONLY regression test (Gap 3): MessageBubble's manual Retry button
 * (visible only for isMine + deliveryState 'failed') must call retryMessage
 * with the exact conversationId + clientMessageId (falling back to id), and
 * must NOT be present/clickable for a non-failed message.
 */

vi.mock('@/hooks/useSwipeToReply', () => ({ useSwipeToReply: () => ({}) }));
vi.mock('@/components/shared/UserAvatar', () => ({ UserAvatar: () => null }));
vi.mock('@/components/shared/ImageLightbox', () => ({ ImageLightbox: () => null }));
vi.mock('@/lib/attachment', () => ({ getAttachmentSignedUrl: vi.fn(async () => null) }));
const retryMessageMock = vi.fn();
vi.mock('@/lib/outbox', () => ({ retryMessage: retryMessageMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    clientMessageId: 'cm_abc123',
    conversationId: 'conv-9',
    senderId: 'u1',
    senderName: 'Ali',
    type: 'TEXT',
    body: 'hello',
    status: 'SENT',
    isEdited: false,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    attachment: null,
    replyToMessage: null,
    createdAt: new Date().toISOString(),
    deliveryState: 'sent',
    ...overrides,
  };
}

describe('MessageBubble — manual Retry (Gap 3)', () => {
  it('clicking Retry on a FAILED message calls retryMessage(conversationId, clientMessageId) exactly once', async () => {
    const { MessageBubble } = await import('@/components/chat/MessageBubble');
    const msg = baseMessage({ deliveryState: 'failed' });
    render(<MessageBubble message={msg as never} isMine />);

    const retryBtn = screen.getByLabelText('ارسال مجدد');
    await userEvent.click(retryBtn);

    expect(retryMessageMock).toHaveBeenCalledTimes(1);
    expect(retryMessageMock).toHaveBeenCalledWith('conv-9', 'cm_abc123');
    cleanup();
  });

  it('does not render a Retry control for a successfully SENT message', async () => {
    const { MessageBubble } = await import('@/components/chat/MessageBubble');
    const msg = baseMessage({ deliveryState: 'sent' });
    render(<MessageBubble message={msg as never} isMine />);
    expect(screen.queryByLabelText('ارسال مجدد')).toBeNull();
    cleanup();
  });
});
