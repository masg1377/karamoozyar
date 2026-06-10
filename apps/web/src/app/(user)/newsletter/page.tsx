'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNewsletterStore } from '@/store/newsletter.store';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { CursorPaginatedResponse, NewsletterPostDto } from '@karamooziyar/shared';
import { NewsletterListCard } from '@/components/newsletter/NewsletterPost';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Newspaper } from 'lucide-react';

export default function UserNewsletterPage() {
  const router = useRouter();
  const { posts, hasMore, nextCursor, setPosts, appendPosts, addPost, updatePost, removePost } = useNewsletterStore();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

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
    const socket = getSocket();
    socket.emit(SOCKET_EVENTS.NEWSLETTER_JOIN);

    const onNewPost = (post: NewsletterPostDto) => addPost(post);
    const onUpdatedPost = (post: NewsletterPostDto) => updatePost(post.id, post);
    const onDeletedPost = (data: { postId: string }) => removePost(data.postId);
    const onReactionUpdated = (data: { postId: string; reactions: Record<string, number> }) =>
      updatePost(data.postId, { reactionSummary: data.reactions });

    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNewPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdatedPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeletedPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated);

    return () => {
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNewPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdatedPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeletedPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated);
    };
  }, [loadPosts, addPost, updatePost, removePost]);

  if (initialLoading) return (
    <div className="h-full flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <Newspaper className="w-5 h-5 text-primary-600" />
        <h1 className="text-lg font-bold text-gray-800">اطلاعیه‌ها</h1>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Newspaper className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-gray-400 text-sm">هنوز اطلاعیه‌ای ارسال نشده است</p>
        </div>
      ) : (
        <>
          {posts.map((post) => (
            <NewsletterListCard
              key={post.id}
              post={post}
              onClick={() => router.push(`/newsletter/${post.id}`)}
            />
          ))}
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
  );
}
