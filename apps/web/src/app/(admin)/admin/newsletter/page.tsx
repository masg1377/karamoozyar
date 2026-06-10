'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNewsletterStore } from '@/store/newsletter.store';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { CursorPaginatedResponse, NewsletterPostDto } from '@karamooziyar/shared';
import { NewsletterListCard } from '@/components/newsletter/NewsletterPost';
import { NewsletterComposer } from '@/components/newsletter/NewsletterComposer';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Newspaper, Plus } from 'lucide-react';
import { toast } from 'sonner';

export default function AdminNewsletterPage() {
  const router = useRouter();
  const { posts, hasMore, nextCursor, setPosts, appendPosts, addPost, updatePost, removePost } = useNewsletterStore();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<NewsletterPostDto | null>(null);

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
  }, [loadPosts, addPost, updatePost, removePost]);

  if (initialLoading) return (
    <div className="h-64 flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-in p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">خبرنامه</h1>
          <p className="text-sm text-gray-400 mt-0.5">{posts.length} پست منتشر شده</p>
        </div>
        <button
          onClick={() => setComposerOpen(true)}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> پست جدید
        </button>
      </div>

      {(composerOpen || editingPost) && (
        <NewsletterComposer
          editingPost={editingPost}
          onClose={() => { setComposerOpen(false); setEditingPost(null); }}
          onSaved={(post) => {
            if (editingPost) updatePost(post.id, post);
            else addPost(post);
            setComposerOpen(false);
            setEditingPost(null);
          }}
        />
      )}

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
            <Newspaper className="w-7 h-7 text-gray-300" />
          </div>
          <p className="text-gray-400 text-sm">هنوز پستی منتشر نشده است</p>
          <button onClick={() => setComposerOpen(true)} className="text-primary-600 text-sm hover:underline">
            اولین پست را بنویس
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {posts.map((post) => (
              <NewsletterListCard
                key={post.id}
                post={post}
                onClick={() => router.push(`/admin/newsletter/${post.id}`)}
                onEdit={() => setEditingPost(post)}
                onDelete={async () => {
                  if (!confirm('آیا از حذف این پست اطمینان دارید؟')) return;
                  try {
                    await api.delete(`/newsletter/${post.id}`);
                    removePost(post.id);
                  } catch { /* silent */ }
                }}
                onPin={async () => {
                  try {
                    const res = await api.patch<{ data: { id: string; isPinned: boolean } }>(`/newsletter/${post.id}`, { isPinned: !post.isPinned });
                    updatePost(post.id, { isPinned: res.data.data.isPinned });
                    toast.success(res.data.data.isPinned ? 'پست پین شد' : 'پین برداشته شد');
                  } catch { toast.error('عملیات ناموفق بود'); }
                }}
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
  );
}
