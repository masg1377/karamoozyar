'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { NewsletterPostDto } from '@karamooziyar/shared';
import { NewsletterPostCard } from '@/components/newsletter/NewsletterPost';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { useNewsletterStore } from '@/store/newsletter.store';

export default function NewsletterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { updatePost } = useNewsletterStore();
  const [post, setPost] = useState<NewsletterPostDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchPost = async () => {
      try {
        const res = await api.get<{ data: NewsletterPostDto }>(`/newsletter/${id}`);
        setPost(res.data.data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    void fetchPost();
  }, [id]);

  useEffect(() => {
    if (!post) return;
    const socket = getSocket();
    socket.emit(SOCKET_EVENTS.NEWSLETTER_SEEN, { postId: post.id });
    const onReactionUpdated = (data: { postId: string; reactions: Record<string, number> }) => {
      if (data.postId === post.id) {
        setPost((prev) => prev ? { ...prev, reactionSummary: data.reactions } : prev);
        updatePost(post.id, { reactionSummary: data.reactions });
      }
    };
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated);
    return () => { socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated); };
  }, [post, updatePost]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="p-4 text-center py-16">
        <p className="text-gray-400 text-sm">اطلاعیه پیدا نشد</p>
        <button onClick={() => router.back()} className="mt-3 text-sm" style={{ color: '#0ABDE3' }}>
          برگشت
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-4 pb-6 space-y-4 animate-fade-in">
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          اطلاعیه‌ها
        </button>

        {/* Post card with white bg */}
        <div className="bg-white rounded-3xl border border-blue-50 shadow-sm overflow-hidden">
          <NewsletterPostCard post={post} />
        </div>
      </div>
    </div>
  );
}
