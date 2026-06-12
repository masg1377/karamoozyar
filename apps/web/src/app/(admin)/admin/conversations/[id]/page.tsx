'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import { useChatStore } from '@/store/chat.store';
import { useMessages } from '@/hooks/useMessages';
import { useAuthStore } from '@/store/auth.store';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageInput } from '@/components/chat/MessageInput';
import { PinnedMessagesBar } from '@/components/chat/PinnedMessagesBar';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { ConversationSummaryDto, MessageDto } from '@karamooziyar/shared';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { ArrowRight, ChevronUp } from 'lucide-react';

export default function AdminConversationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conversationId = params.id;
  const currentUser = useAuthStore((s) => s.user);

  const [conv, setConv] = useState<ConversationSummaryDto | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [editingMessage, setEditingMessage] = useState<{ id: string; body: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<MessageDto | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<MessageDto[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevScrollHeightRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    api
      .get<{ data: ConversationSummaryDto }>(`/conversations/${conversationId}`)
      .then((res) => setConv(res.data.data))
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [conversationId]);

  // Load pinned messages
  useEffect(() => {
    if (!conversationId) return;
    api
      .get<{ data: MessageDto[] }>(`/conversations/${conversationId}/pinned`)
      .then((res) => setPinnedMessages(res.data.data))
      .catch(() => {});
  }, [conversationId]);

  const { messages, canLoadMore, loadMore, isLoadingMore } = useMessages(conversationId);
  const typingUsers = useChatStore((s) => s.typingUsers[conversationId]);
  const isUserTyping = typingUsers ? typingUsers.size > 0 : false;

  // Real-time pin updates
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    const onPinned = (payload: { action: 'pin' | 'unpin'; message?: MessageDto; messageId?: string }) => {
      if (payload.action === 'pin' && payload.message) {
        setPinnedMessages((prev) => {
          const without = prev.filter((m) => m.id !== payload.message!.id);
          return [payload.message!, ...without];
        });
      } else if (payload.action === 'unpin' && payload.messageId) {
        setPinnedMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
      }
    };
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, onPinned);
    return () => { socket.off(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, onPinned); };
  }, [conversationId]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) return;
    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      container.scrollTop = container.scrollHeight;
    } else if (prevScrollHeightRef.current > 0) {
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
    } else if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!conversationId || messages.length === 0) return;
    const socket = getSocket();
    const lastMsg = messages[messages.length - 1];
    if (lastMsg) socket.emit(SOCKET_EVENTS.CHAT_SEEN, { conversationId, messageId: lastMsg.id });
  }, [conversationId, messages]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setAutoScroll(nearBottom);
    if (el.scrollTop < 80 && canLoadMore && !isLoadingMore) {
      prevScrollHeightRef.current = el.scrollHeight;
      void loadMore();
    }
  }, [canLoadMore, loadMore, isLoadingMore]);

  const handleDelete = (messageId: string) => {
    const socket = getSocket();
    socket.emit(SOCKET_EVENTS.CHAT_DELETE, { messageId, conversationId });
  };

  const handlePin = async (msg: MessageDto) => {
    try {
      const res = await api.patch<{ data: MessageDto }>(
        `/conversations/${conversationId}/messages/${msg.id}/pin`,
      );
      const pinned = res.data.data;
      setPinnedMessages((prev) => [pinned, ...prev.filter((m) => m.id !== pinned.id)]);
      toast.success('پیام پین شد');
      getSocket().emit(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, {
        conversationId,
        messageId: msg.id,
        action: 'pin',
      });
    } catch {
      toast.error('پین کردن ناموفق بود');
    }
  };

  const handleUnpin = async (msg: MessageDto) => {
    try {
      await api.delete(`/conversations/${conversationId}/messages/${msg.id}/pin`);
      setPinnedMessages((prev) => prev.filter((m) => m.id !== msg.id));
      toast.success('پین برداشته شد');
      getSocket().emit(SOCKET_EVENTS.CHAT_MESSAGE_PINNED, {
        conversationId,
        messageId: msg.id,
        action: 'unpin',
      });
    } catch {
      toast.error('برداشتن پین ناموفق بود');
    }
  };

  const handleScrollTo = (messageId: string) => {
    messageRefs.current.get(messageId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (initialLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  const userName = conv ? `${conv.user.firstName} ${conv.user.lastName}` : 'کارآموز';
  const traineeFirst = conv?.user.firstName ?? '';
  const traineeLast = conv?.user.lastName ?? '';
  const traineeAvatar = conv?.user.avatarUrl ?? null;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Chat header ── */}
      <div className="flex-shrink-0 bg-white/90 backdrop-blur-md border-b border-blue-100/60 px-4 py-3 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-xl hover:bg-gray-100 transition-colors text-gray-500 flex-shrink-0">
          <ArrowRight className="w-5 h-5" />
        </button>
        {traineeFirst && traineeLast ? (
          <UserAvatar firstName={traineeFirst} lastName={traineeLast} avatarUrl={traineeAvatar} size="sm" className="w-9 h-9 text-sm" />
        ) : (
          <div className="w-9 h-9 bg-primary-100 rounded-full flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800 truncate">{userName}</p>
          <p className="text-xs text-green-500 font-medium">
            {isUserTyping ? 'در حال تایپ...' : 'آنلاین'}
          </p>
        </div>
      </div>

      {/* Pinned messages bar — admin can unpin any message */}
      <PinnedMessagesBar
        pinnedMessages={pinnedMessages}
        canUnpin={true}
        onUnpin={handleUnpin}
        onScrollTo={handleScrollTo}
      />

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5" style={{ background: 'linear-gradient(180deg, #D4EDFB 0%, #EBF5FF 50%, #F2F8FF 100%)' }} onScroll={handleScroll}>
        {canLoadMore && (
          <button
            onClick={() => { if (scrollContainerRef.current) prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight; void loadMore(); }}
            disabled={isLoadingMore}
            className="w-full flex items-center justify-center gap-1 py-2 text-xs text-primary-600 hover:text-primary-700 transition-colors disabled:opacity-50"
          >
            <ChevronUp className="w-3 h-3" />
            {isLoadingMore ? 'در حال بارگذاری...' : 'پیام‌های قبلی'}
          </button>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center pt-16">
            <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-gray-500 text-sm">هنوز پیامی در این گفتگو وجود ندارد</p>
          </div>
        )}

        {messages.map((msg: MessageDto) => {
          const isAdminMsg = currentUser?.role === 'ADMIN' && msg.senderId === currentUser.id;
          return (
            <div key={msg.id} ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}>
              <MessageBubble
                message={msg}
                isMine={isAdminMsg}
                onEdit={isAdminMsg ? (m) => setEditingMessage({ id: m.id, body: m.body ?? '' }) : undefined}
                onDelete={handleDelete}
                onReply={(m) => { setEditingMessage(null); setReplyingTo(m); }}
                onPin={handlePin}
                onUnpin={msg.pinnedAt ? handleUnpin : undefined}
                senderFirstName={!isAdminMsg ? traineeFirst : undefined}
                senderLastName={!isAdminMsg ? traineeLast : undefined}
                senderAvatarUrl={!isAdminMsg ? traineeAvatar : undefined}
                showAvatar={!isAdminMsg && !!traineeFirst}
              />
            </div>
          );
        })}

        {isUserTyping && (
          <div className="flex justify-end">
            <div className={cn('px-4 py-2.5 rounded-2xl rounded-bl-sm bg-white border border-gray-100 shadow-sm flex gap-1 items-center')}>
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 bg-white/90 backdrop-blur-md border-t border-blue-100/60">
        <MessageInput
          conversationId={conversationId}
          editingMessage={editingMessage}
          onCancelEdit={() => setEditingMessage(null)}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </div>
    </div>
  );
}
