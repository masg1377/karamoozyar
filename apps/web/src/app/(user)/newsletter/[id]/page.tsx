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

/**
 * جزئیات اطلاعیه برای کارآموز — همان چیدمان صفحه ادمین،
 * بدون ابزارهای ویرایش / حذف / پین / لیست بازدید (read-only + ری‌اکشن).
 */
export default function NewsletterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { updatePost } = useNewsletterStore();
  const [post, setPost] = useState<NewsletterPostDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.get<{ data: NewsletterPostDto }>(`/newsletter/${id}`)
      .then((r) => setPost(r.data.data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!post) return;
    const socket = getSocket();
    // ثبت «دیده شد»
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

  if (loading) return (
    <div className="h-64 flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Sticky Toolbar (مثل ادمین — فقط دکمه بازگشت) ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: '#F6F7F9',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        zIndex: 5,
      }}>
        <button
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 13, padding: 0 }}
        >
          <ArrowRight className="w-4 h-4" />
          <span>اطلاعیه‌ها</span>
        </button>
      </div>

      {/* ── Scrollable content ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', paddingBottom: 'calc(96px)' }}>
        <NewsletterPostCard post={post} />
      </div>
    </div>
  );
}
