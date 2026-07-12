'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api-client';
import { useLiveSocket } from '@/hooks/useSocket';
import { useChatStore } from '@/store/chat.store';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { ConversationSummaryDto, UserDto } from '@karamooziyar/shared';
import { cn, timeAgo } from '@/lib/utils';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { MessageSquare, Search, Users, Plus, X, ChevronRight } from 'lucide-react';
import { UserAvatar } from '@/components/shared/UserAvatar';

// ─── New Chat Modal (infinite scroll) ─────────────────────────────────────────

const MODAL_PAGE_SIZE = 20;

function NewChatModal({ onClose, onStartChat }: {
  onClose: () => void;
  onStartChat: (userId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<UserDto[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingFirst, setLoadingFirst] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch page p with query q; if reset=true, replaces list instead of appending
  const load = useCallback(async (p: number, q: string, reset: boolean) => {
    if (reset) setLoadingFirst(true); else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(MODAL_PAGE_SIZE) });
      if (q) params.set('search', q);
      const res = await api.get<{ data: { data: UserDto[]; meta: { total: number } } }>(
        `/users/without-conversation?${params}`,
      );
      const fetched = res.data.data.data;
      const total = res.data.data.meta.total;
      setUsers((prev) => reset ? fetched : [...prev, ...fetched]);
      setHasMore(p * MODAL_PAGE_SIZE < total);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingFirst(false);
      setLoadingMore(false);
    }
  }, []);

  // Initial load
  useEffect(() => { void load(1, '', true); }, [load]);

  // Debounced search
  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(1, val, true), 300);
  };

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loadingFirst) {
          const nextPage = page + 1;
          setPage(nextPage);
          void load(nextPage, search, false);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadingFirst, page, search, load]);

  const handleStart = async (userId: string) => {
    setStarting(userId);
    try {
      const res = await api.get<{ data: ConversationSummaryDto }>(`/conversations/by-user/${userId}`);
      onStartChat(res.data.data.id);
    } catch {
      setStarting(null);
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-[200]" onClick={onClose} />

      {/* Modal — fixed height, flex column so search stays sticky */}
      <div className="fixed inset-x-4 top-[10vh] z-[200] bg-white rounded-2xl shadow-2xl max-w-md mx-auto flex flex-col"
        style={{ height: 'min(80vh, 600px)' }}>

        {/* ── Header (sticky) ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-bold text-gray-800">گفتگوی جدید</h2>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Search (sticky below header) ────────────────────────────── */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0 bg-white border-b border-gray-50">
          <div className="flex items-center gap-2 bg-gray-100 rounded-2xl px-3 py-2">
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="نام، کد ملی یا شماره موبایل..."
              className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none w-full"
            />
            {search && (
              <button onClick={() => handleSearch('')} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable list ──────────────────────────────────────────── */}
        <div ref={listRef} className="flex-1 overflow-y-auto min-h-0">
          {loadingFirst ? (
            <div className="flex items-center justify-center py-16">
              <LoadingSpinner size="md" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
              <Users className="w-10 h-10 text-gray-200" />
              <p className="text-gray-400 text-sm">
                {search ? 'کارآموزی با این مشخصات یافت نشد' : 'همه کارآموزان گفتگوی فعال دارند'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => void handleStart(u.id)}
                  disabled={!!starting}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-right disabled:opacity-60"
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {starting === u.id ? (
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                        <LoadingSpinner size="sm" />
                      </div>
                    ) : (
                      <UserAvatar firstName={u.firstName} lastName={u.lastName} avatarUrl={u.avatarUrl} size="md" />
                    )}
                  </div>

                  {/* User info card */}
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-sm font-semibold text-gray-800 truncate">
                      {u.firstName} {u.lastName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-gray-400 font-mono" dir="ltr">{u.nationalId}</span>
                      {u.phoneNumber && (
                        <span className="text-xs text-gray-400 font-mono" dir="ltr">{u.phoneNumber}</span>
                      )}
                    </div>
                    {u.expertiseField && (
                      <p className="text-xs text-primary-500 truncate mt-0.5">{u.expertiseField}</p>
                    )}
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 rotate-180" />
                </button>
              ))}

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-1" />

              {/* Loading more spinner */}
              {loadingMore && (
                <div className="flex items-center justify-center py-4">
                  <LoadingSpinner size="sm" />
                </div>
              )}

              {/* End of list */}
              {!hasMore && users.length > 0 && (
                <p className="text-center text-xs text-gray-300 py-4">پایان لیست</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const LIMIT = 20;

export default function AdminConversationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { conversations, setConversations, updateConversation } = useChatStore();
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reactive to socket replacement (hard rebuild) — see useLiveSocket.
  const liveSocket = useLiveSocket();

  // Auto-navigate to a specific user's conversation when userId query param is present
  useEffect(() => {
    const userId = searchParams.get('userId');
    if (!userId) return;
    api.get<{ data: ConversationSummaryDto }>(`/conversations/by-user/${userId}`)
      .then((res) => router.replace(`/admin/conversations/${res.data.data.id}`))
      .catch(() => { /* fall through to list */ });
  }, [searchParams, router]);

  const loadConversations = useCallback(async (p: number, q: string) => {
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (q) params.set('search', q);
      const res = await api.get<{ data: { data: ConversationSummaryDto[]; meta: { total: number } } }>(
        `/conversations?${params}`,
      );
      setConversations(res.data.data.data);
      setTotal(res.data.data.meta.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [setConversations]);

  useEffect(() => {
    void loadConversations(1, '');

    const socket = liveSocket;
    const onConvUpdated = (conv: ConversationSummaryDto) => {
      updateConversation(conv);
    };
    socket.on(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, onConvUpdated);
    return () => { socket.off(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, onConvUpdated); };
  }, [loadConversations, updateConversation, liveSocket]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadConversations(1, val), 300);
  };

  const handlePage = (p: number) => {
    setPage(p);
    void loadConversations(p, search);
  };

  const handleStartChat = (conversationId: string) => {
    setShowNewChat(false);
    router.push(`/admin/conversations/${conversationId}`);
  };

  const totalUnread = conversations.reduce((acc, c) => acc + c.unreadByAdmin, 0);
  const totalPages = Math.ceil(total / LIMIT);

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  return (
    <>
      <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '16px 16px calc(96px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: 0 }}>گفتگوها</h1>
              {totalUnread > 0 && (
                <p style={{ fontSize: 12, color: '#EF4444', margin: '3px 0 0' }}>{totalUnread} پیام نخوانده</p>
              )}
            </div>
            <button
              onClick={() => setShowNewChat(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #0ABDE3, #0897B8)', color: 'white', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 14, border: 'none', cursor: 'pointer' }}
            >
              <Plus className="w-4 h-4" />
              گفتگو جدید
            </button>
          </div>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', borderRadius: 14, padding: '8px 12px', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
            <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="جستجو بر اساس نام..."
              style={{ background: 'transparent', fontSize: 13, color: '#374151', outline: 'none', width: '100%', border: 'none' }}
            />
          </div>
        </div>

        {/* List */}
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              {search ? <Search className="w-7 h-7 text-gray-300" /> : <Users className="w-7 h-7 text-gray-300" />}
            </div>
            <p className="text-gray-400 text-sm">
              {search ? 'نتیجه‌ای یافت نشد' : 'هنوز گفتگویی وجود ندارد'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
            {conversations.map((conv) => (
              <ConversationRow key={conv.id} conv={conv} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 pt-2">
            <button
              onClick={() => handlePage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm rounded-xl hover:bg-gray-100 disabled:opacity-40 transition-colors text-gray-600"
            >
              قبلی
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => handlePage(p as number)}
                    className={cn(
                      'w-8 h-8 rounded-xl text-sm font-medium transition-colors',
                      p === page ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-100',
                    )}
                  >
                    {p}
                  </button>
                ),
              )}
            <button
              onClick={() => handlePage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm rounded-xl hover:bg-gray-100 disabled:opacity-40 transition-colors text-gray-600"
            >
              بعدی
            </button>
          </div>
        )}

        {total > 0 && (
          <p className="text-center text-xs text-gray-400">
            {total} گفتگو
          </p>
        )}
      </div>
      </div>

      {/* New Chat Modal */}
      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onStartChat={handleStartChat}
        />
      )}
    </>
  );
}

function ConversationRow({ conv }: { conv: ConversationSummaryDto }) {
  const hasUnread = conv.unreadByAdmin > 0;

  return (
    <Link
      href={`/admin/conversations/${conv.id}`}
      className={cn(
        'flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors',
        hasUnread && 'bg-blue-50/40 hover:bg-blue-50/60',
      )}
    >
      <div className="relative flex-shrink-0">
        <UserAvatar
          firstName={conv.user.firstName}
          lastName={conv.user.lastName}
          avatarUrl={conv.user.avatarUrl}
          size="md"
          className="w-11 h-11 text-sm"
        />
        {hasUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-sm font-medium truncate', hasUnread ? 'text-gray-900' : 'text-gray-700')}>
            {conv.user.firstName} {conv.user.lastName}
          </p>
          <span className="text-xs text-gray-400 flex-shrink-0">
            {conv.lastMessageAt ? timeAgo(conv.lastMessageAt) : ''}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className={cn('text-xs truncate', hasUnread ? 'text-gray-600 font-medium' : 'text-gray-400')}>
            {conv.lastMessageText ?? ''}
          </p>
          {hasUnread && (
            <span className="flex-shrink-0 bg-primary-600 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5">
              {conv.unreadByAdmin > 99 ? '99+' : conv.unreadByAdmin}
            </span>
          )}
        </div>
      </div>

      <MessageSquare className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </Link>
  );
}
