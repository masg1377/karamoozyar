'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import type { NewsletterPostDto, CursorPaginatedResponse } from '@karamooziyar/shared';
import { MessageSquare, Newspaper, ChevronLeft, Pin, Bell } from 'lucide-react';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

// ─── Latest post card ─────────────────────────────────────────────────────────

function PostCard({ post }: { post: NewsletterPostDto }) {
  const router = useRouter();
  // Get first text block preview
  const textBlock = (post.contentBlocks as { type: string; content?: string }[] | undefined)
    ?.find((b) => b.type === 'TEXT');
  const preview = textBlock?.content?.slice(0, 80) ?? '';
  const hasImage = (post.contentBlocks as { type: string }[] | undefined)?.some((b) => b.type === 'IMAGE');

  return (
    <button
      onClick={() => router.push(`/newsletter/${post.id}`)}
      className="w-full text-right bg-white rounded-2xl border border-gray-100 shadow-sm active:scale-[0.98] transition-transform overflow-hidden"
    >
      <div className="flex items-start gap-3 p-3.5">
        {/* Icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
          hasImage ? 'bg-green-50' : 'bg-blue-50'
        }`}>
          {hasImage
            ? <span className="text-base">🖼️</span>
            : <Bell className="w-4 h-4 text-primary-500" />
          }
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {post.isPinned && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            <p className="text-sm font-semibold text-gray-800 truncate">
              {(post as { title?: string }).title || 'اطلاعیه'}
            </p>
          </div>
          {preview && (
            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{preview}</p>
          )}
          <p className="text-[10px] text-gray-300 mt-1.5">{formatDate(post.createdAt)}</p>
        </div>

        <ChevronLeft className="w-4 h-4 text-gray-300 flex-shrink-0 mt-1.5" />
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [posts, setPosts] = useState<NewsletterPostDto[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: CursorPaginatedResponse<NewsletterPostDto> }>('/newsletter', { params: { limit: 3 } })
      .then((r) => setPosts(r.data.data.data))
      .catch(() => {/* silent */})
      .finally(() => setPostsLoading(false));
  }, []);

  if (!user) return null;

  // Get hour-based greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صبح بخیر' : hour < 17 ? 'روز بخیر' : 'شب بخیر';

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5 animate-fade-in">

      {/* ── Hero ────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary-700 via-primary-600 to-primary-500 rounded-3xl p-5 text-white shadow-lg">
        {/* Decorative circles */}
        <div className="absolute -top-8 -left-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-white/5 rounded-full" />

        <div className="relative">
          <p className="text-primary-200 text-xs mb-1">{greeting} 👋</p>
          <h1 className="text-xl font-bold">{user.firstName} {user.lastName}</h1>
          <p className="text-primary-300 text-xs mt-1 truncate">
            {user.judicialDomain} · {user.expertiseField}
          </p>
        </div>
      </div>

      {/* ── Quick actions ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/chat"
          className="group bg-white rounded-2xl p-4 border border-gray-100 shadow-sm active:scale-[0.97] transition-transform flex flex-col gap-3"
        >
          <div className="w-11 h-11 bg-blue-50 rounded-2xl flex items-center justify-center group-active:bg-blue-100 transition-colors">
            <MessageSquare className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">پیام‌ها</p>
            <p className="text-xs text-gray-400 mt-0.5">چت با مدیران</p>
          </div>
        </Link>

        <Link
          href="/newsletter"
          className="group bg-white rounded-2xl p-4 border border-gray-100 shadow-sm active:scale-[0.97] transition-transform flex flex-col gap-3"
        >
          <div className="w-11 h-11 bg-emerald-50 rounded-2xl flex items-center justify-center group-active:bg-emerald-100 transition-colors">
            <Newspaper className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <p className="font-bold text-gray-800 text-sm">اطلاعیه‌ها</p>
            <p className="text-xs text-gray-400 mt-0.5">اخبار و اطلاعیه‌ها</p>
          </div>
        </Link>
      </div>

      {/* ── Latest announcements ─────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">آخرین اطلاعیه‌ها</h2>
          <Link href="/newsletter" className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-0.5">
            همه <ChevronLeft className="w-3.5 h-3.5" />
          </Link>
        </div>

        {postsLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner size="md" />
          </div>
        ) : posts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
            <Newspaper className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-xs text-gray-400">هنوز اطلاعیه‌ای منتشر نشده</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {posts.map((post) => <PostCard key={post.id} post={post} />)}
          </div>
        )}
      </div>
    </div>
  );
}
