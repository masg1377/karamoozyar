'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNewsletterStore } from '@/store/newsletter.store';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { CursorPaginatedResponse, NewsletterPostDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { formatDate } from '@/lib/utils';

export default function UserNewsletterPage() {
  const router = useRouter();
  const { posts, hasMore, nextCursor, setPosts, appendPosts, addPost, updatePost, removePost } =
    useNewsletterStore();
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
    const onReaction = (data: { postId: string; reactions: Record<string, number> }) =>
      updatePost(data.postId, { reactionSummary: data.reactions });
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNewPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdatedPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeletedPost);
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction);
    return () => {
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_NEW, onNewPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_UPDATED, onUpdatedPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_POST_DELETED, onDeletedPost);
      socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction);
    };
  }, [loadPosts, addPost, updatePost, removePost]);

  if (initialLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-4 pb-6">

        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={2} className="w-5 h-5 flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <h1 className="text-base font-bold text-gray-800">اطلاعیه‌ها</h1>
        </div>

        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #E3F6FC, #C5EDF8)' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.5} className="w-7 h-7">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <p className="text-sm text-gray-400">هنوز اطلاعیه‌ای ارسال نشده</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => <NewsletterCard key={post.id} post={post} onClick={() => router.push(`/newsletter/${post.id}`)} />)}
            {hasMore && (
              <button
                onClick={() => void loadPosts(nextCursor ?? undefined)}
                disabled={loading}
                className="w-full py-3 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ color: '#0ABDE3' }}
              >
                {loading ? <LoadingSpinner size="sm" /> : 'بارگذاری بیشتر'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsletterCard({ post, onClick }: { post: NewsletterPostDto; onClick: () => void }) {
  const textBlock = (post.contentBlocks as { type: string; content?: string }[] | undefined)
    ?.find((b) => b.type === 'TEXT');
  const preview = textBlock?.content?.slice(0, 70) ?? '';
  const imageBlock = (post.contentBlocks as { type: string; url?: string }[] | undefined)
    ?.find((b) => b.type === 'IMAGE');

  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-2xl border border-blue-50 shadow-sm overflow-hidden flex items-stretch active:scale-[0.98] transition-transform text-right"
    >
      {/* Thumbnail */}
      <div
        className="w-20 flex-shrink-0 flex items-center justify-center"
        style={{
          background: imageBlock?.url
            ? `url(${imageBlock.url}) center/cover no-repeat`
            : 'linear-gradient(135deg, #E3F6FC, #C5EDF8)',
        }}
      >
        {!imageBlock?.url && (
          <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.5} className="w-7 h-7">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-3.5 min-w-0">
        <p className="text-sm font-semibold text-gray-700 truncate">
          {(post as { title?: string }).title || 'اطلاعیه جدید'}
        </p>
        {preview && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{preview}</p>
        )}
        <p className="text-[10px] text-gray-300 mt-1.5">{formatDate(post.createdAt)}</p>
      </div>

      {/* Arrow */}
      <div className="flex items-center px-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
          className="w-4 h-4 text-gray-300">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </div>
    </button>
  );
}
