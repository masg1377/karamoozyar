'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNewsletterStore } from '@/store/newsletter.store';
import api from '@/lib/api-client';
import { useLiveSocket } from '@/hooks/useSocket';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { CursorPaginatedResponse, NewsletterPostDto } from '@karamooziyar/shared';
import { NewsletterListCard } from '@/components/newsletter/NewsletterPost';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Newspaper } from 'lucide-react';

/**
 * اطلاعیه‌های کارآموز — همان ظاهر صفحه ادمین،
 * فقط بدون ویرایش / حذف / پین / پست جدید (read-only).
 */
export default function UserNewsletterPage() {
  const router = useRouter();
  const { posts, hasMore, nextCursor, setPosts, appendPosts, addPost, updatePost, removePost } =
    useNewsletterStore();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  // Reactive to socket replacement (hard rebuild) — see useLiveSocket.
  const liveSocket = useLiveSocket();

  const loadPosts = useCallback(async (cursor?: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ data: CursorPaginatedResponse<NewsletterPostDto> }>('/newsletter', {
        params: { limit: 20, ...(cursor ? { cursor } : {}) },
      });
      const { data, nextCursor: nc } = res.data.data;
      if (cursor) appendPosts(data, nc);
      else setPosts(data, nc);
    } catch { /* silent */ } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [setPosts, appendPosts]);

  useEffect(() => {
    void loadPosts();
    const socket = liveSocket;
    socket.emit(SOCKET_EVENTS.NEWSLETTER_JOIN);

    const onNew = (post: NewsletterPostDto) => addPost(post);
    const onUpdated = (post: NewsletterPostDto) => updatePost(post.id, post);
    const onDeleted = (data: { postId: string }) => removePost(data.postId);
    const onReaction = (data: { postId: string; reactions: Record<string, number> }) =>
      updatePost(data.postId, { reactionSummary: data.reactions });

    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNew);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeleted);
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction);

    return () => {
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNew);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeleted);
      socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction);
    };
  }, [loadPosts, addPost, updatePost, removePost, liveSocket]);

  if (initialLoading) return (
    <div className="h-64 flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
    <div style={{ padding: '16px 16px calc(96px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', margin: 0 }}>اطلاعیه‌ها</h1>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0' }}>{posts.length} اطلاعیه منتشر شده</p>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <Newspaper className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-gray-400 text-sm">هنوز اطلاعیه‌ای منتشر نشده است</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {posts.map((post) => (
              <NewsletterListCard
                key={post.id}
                post={post}
                onClick={() => router.push(`/newsletter/${post.id}`)}
              />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => void loadPosts(nextCursor ?? undefined)}
              disabled={loading}
              className="w-full py-3 text-sm text-primary-600 hover:text-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <LoadingSpinner size="sm" /> : 'بارگذاری بیشتر'}
            </button>
          )}
        </>
      )}
    </div>
    </div>
  );
}
