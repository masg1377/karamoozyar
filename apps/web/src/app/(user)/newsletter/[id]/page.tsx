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
import { ArrowRight } from 'lucide-react';

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

  // Mark seen
  useEffect(() => {
    if (!post) return;
    const socket = getSocket();
    socket.emit(SOCKET_EVENTS.NEWSLETTER_SEEN, { postId: post.id });

    // Live reaction updates
    const onReactionUpdated = (data: { postId: string; reactions: Record<string, number> }) => {
      if (data.postId === post.id) {
        setPost((prev) => prev ? { ...prev, reactionSummary: data.reactions } : prev);
        updatePost(post.id, { reactionSummary: data.reactions });
      }
    };
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated);
    return () => { socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReactionUpdated); };
  }, [post, updatePost]);

  if (loading) return (
    <div className="h-64 flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

  if (notFound || !post) return (
    <div className="p-4 text-center py-16">
      <p className="text-gray-400 text-sm">اطلاعیه پیدا نشد</p>
      <button onClick={() => router.back()} className="mt-3 text-sm text-primary-600">
        برگشت
      </button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 animate-fade-in">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowRight className="w-4 h-4" />
        <span>اطلاعیه‌ها</span>
      </button>

      <NewsletterPostCard post={post} />
    </div>
  );
}
