'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { useMessages } from '@/hooks/useMessages';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageInput } from '@/components/chat/MessageInput';
import { PinnedMessagesBar } from '@/components/chat/PinnedMessagesBar';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { getSocket } from '@/lib/socket-client';
import api from '@/lib/api-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { ConversationDetailDto, MessageDto } from '@karamooziyar/shared';
import { toast } from 'sonner';
import { ChevronUp, Shield } from 'lucide-react';

export default function UserChatPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [conversation, setConversation] = useState<ConversationDetailDto | null>(null);
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
      .get<{ data: ConversationDetailDto }>('/conversations/mine')
      .then((res) => setConversation(res.data.data))
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, []);

  const conversationId = conversation?.id ?? '';
  const { messages, canLoadMore, loadMore, isLoadingMore } = useMessages(conversationId);
  const typingUsers = useChatStore((s) => (conversationId ? s.typingUsers[conversationId] : undefined));
  const isAdminTyping = typingUsers ? typingUsers.size > 0 : false;

  // Load pinned messages when conversation is ready
  useEffect(() => {
    if (!conversationId) return;
    api
      .get<{ data: MessageDto[] }>(`/conversations/${conversationId}/pinned`)
      .then((res) => setPinnedMessages(res.data.data))
      .catch(() => {});
  }, [conversationId]);

  // Listen for real-time pin events
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

  // سین خودکار — تا وقتی داخل صفحه چت هستیم، هر پیام تازه‌رسیده بلافاصله seen شود
  // (سرور بعدش unreadByUser را صفر و conversation:updated را emit می‌کند → badge/نوتیف پاک می‌شود)
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
      // Notify other participants via socket
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
    const el = messageRefs.current.get(messageId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (initialLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  if (!conversation || !user) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Chat header ───────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white/90 backdrop-blur-md border-b border-blue-100/60 px-4 py-3 flex items-center gap-3">
        <div className="relative">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #0ABDE3, #0779A0)' }}
          >
            <Shield className="w-5 h-5" />
          </div>
          <span className="absolute bottom-0 left-0 w-2.5 h-2.5 bg-green-400 border-2 border-white rounded-full" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-gray-800">مدیریت مرکز</p>
          <p className="text-xs text-green-500 font-medium">آنلاین</p>
        </div>
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* ── Pinned messages bar ─────────────────────────────────── */}
      <PinnedMessagesBar
        pinnedMessages={pinnedMessages}
        canUnpin={true}
        onUnpin={handleUnpin}
        onScrollTo={handleScrollTo}
      />

      {/* ── Messages (scrollable) ─────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5"
        style={{ background: 'linear-gradient(180deg, #D4EDFB 0%, #EBF5FF 50%, #F2F8FF 100%)' }}
        onScroll={handleScroll}
      >
        {canLoadMore && (
          <button
            onClick={() => {
              if (scrollContainerRef.current)
                prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
              void loadMore();
            }}
            disabled={isLoadingMore}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 bg-white/60 rounded-2xl mb-2"
          >
            {isLoadingMore ? <LoadingSpinner size="sm" /> : <><ChevronUp className="w-3 h-3" /> پیام‌های قبلی</>}
          </button>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
            <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center">
              <span className="text-4xl">💬</span>
            </div>
            <div>
              <p className="text-gray-600 text-sm font-medium">شروع گفتگو</p>
              <p className="text-gray-400 text-xs mt-1">سوالات و درخواست‌های خود را مطرح کنید</p>
            </div>
          </div>
        )}

        {messages.map((msg: MessageDto) => (
          <div key={msg.id} ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}>
            <MessageBubble
              message={msg}
              isMine={msg.senderId === user.id}
              onEdit={msg.senderId === user.id ? (m) => setEditingMessage({ id: m.id, body: m.body ?? '' }) : undefined}
              onDelete={msg.senderId === user.id ? handleDelete : undefined}
              onReply={(m) => { setEditingMessage(null); setReplyingTo(m); }}
              onPin={msg.senderId === user.id ? handlePin : undefined}
              onUnpin={msg.pinnedAt ? handleUnpin : undefined}
            />
          </div>
        ))}

        {isAdminTyping && (
          <div className="flex justify-end">
            <div className="bubble-received px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ──────────────────────────────────────────── */}
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
