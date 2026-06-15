'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import api from '@/lib/api-client';
import type { NewsletterPostDto, CursorPaginatedResponse } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

const NAVY = '#1c274c';
const CARD_GRADIENT = 'linear-gradient(180deg, #FBFDFF 0%, #EDF3F8 100%)';
const CARD_SHADOW = '4px 6px 12px rgba(28,39,76,0.14)';

const faNum = (n: number) => n.toLocaleString('fa-IR');

const formatDateShort = (dateStr: string) =>
  new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(dateStr));

export default function UserDashboardPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // زنده — از chat store که NotificationsProvider همگامش نگه می‌دارد
  const unreadCount = useChatStore((s) =>
    s.conversations.reduce((acc, c) => acc + (c.unreadByUser ?? 0), 0),
  );
  const [posts, setPosts] = useState<NewsletterPostDto[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: CursorPaginatedResponse<NewsletterPostDto> }>('/newsletter', { params: { limit: 3 } })
      .then((r) => setPosts(r.data.data.data))
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  }, []);

  if (!user) return null;

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '22px 22px calc(110px)', display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* ── کارت خوش‌آمد ── */}
        <div style={{
          borderRadius: 26,
          padding: '20px 20px 18px',
          background: '#BDD8E2',
          boxShadow: '4px 6px 12px rgba(28,39,76,0.20)',
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: 0 }}>
            سلام {user.firstName} عزیز
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8, marginTop: 14 }}>
            <p style={{ fontSize: 12.5, color: '#3b4a6b', margin: 0 }}>
              {unreadCount > 0
                ? `${faNum(unreadCount)} پیام خوانده نشده از مدیریت مرکز`
                : 'پیام خوانده‌نشده‌ای ندارید'}
            </p>
            {unreadCount > 0 && (
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444', flexShrink: 0 }} />
            )}
          </div>
        </div>

        {/* ── دسترسی سریع ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* پیام‌ها */}
          <Link
            href="/chat"
            style={{
              position: 'relative',
              background: CARD_GRADIENT,
              borderRadius: 24,
              padding: '16px 16px 18px',
              textDecoration: 'none',
              display: 'block',
              boxShadow: CARD_SHADOW,
            }}
          >
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 12, left: 16,
                fontSize: 13, fontWeight: 700, color: '#EF4444',
              }}>
                {faNum(unreadCount)}
              </span>
            )}
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: '#06ACE8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 10,
              boxShadow: '0 3px 8px rgba(6,172,232,0.35)',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>پیام ها</p>
            <p style={{ fontSize: 11.5, color: '#8595ad', margin: '4px 0 0' }}>چت با مدیران</p>
          </Link>

          {/* اطلاعیه‌ها */}
          <Link
            href="/newsletter"
            style={{
              background: CARD_GRADIENT,
              borderRadius: 24,
              padding: '16px 16px 18px',
              textDecoration: 'none',
              display: 'block',
              boxShadow: CARD_SHADOW,
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: '#06ACE8',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 10,
              boxShadow: '0 3px 8px rgba(6,172,232,0.35)',
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
              </svg>
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>اطلاعیه ها</p>
            <p style={{ fontSize: 11.5, color: '#8595ad', margin: '4px 0 0' }}>اخبار و اطلاعیه ها</p>
          </Link>
        </div>

        {/* ── آخرین اطلاعیه‌ها ── */}
        <h2 style={{ fontSize: 15, fontWeight: 800, color: NAVY, margin: '14px 0 0' }}>آخرین اطلاعیه ها</h2>

        {postsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <LoadingSpinner size="md" />
          </div>
        ) : posts.length === 0 ? (
          <div style={{ background: CARD_GRADIENT, borderRadius: 26, padding: '26px 16px', textAlign: 'center', boxShadow: CARD_SHADOW }}>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>هنوز اطلاعیه‌ای منتشر نشده</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {posts.map((post) => <DashboardNewsCard key={post.id} post={post} onClick={() => router.push(`/newsletter/${post.id}`)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** کارت اطلاعیه داشبورد — مطابق دیزاین: تصویر راست، عنوان/پیش‌نمایش، تاریخ پایین‌چپ، نشانگر «جدید» بالا‌چپ */
function DashboardNewsCard({ post, onClick }: { post: NewsletterPostDto; onClick: () => void }) {
  const blocks = post.contentBlocks as Array<{ type: string; content?: string; url?: string }> | undefined;
  const textBlock = blocks?.find((b) => b.type === 'TEXT');
  const imageBlock = blocks?.find((b) => b.type === 'IMAGE');
  const preview = textBlock?.content?.slice(0, 60) ?? '';
  const isNew = post.isSeen === false;

  return (
    <button
      onClick={onClick}
      style={{
        position: 'relative',
        width: '100%',
        background: CARD_GRADIENT,
        borderRadius: 26,
        padding: '18px 18px 16px',
        border: 'none',
        boxShadow: CARD_SHADOW,
        cursor: 'pointer',
        textAlign: 'right',
        fontFamily: 'inherit',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* نشانگر «خوانده‌نشده» — بالا چپ */}
      {isNew && (
        <span style={{
          position: 'absolute', top: 14, left: 14,
          width: 30, height: 30, borderRadius: '50%',
          border: '1.6px solid #06ACE8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#06ACE8" strokeWidth={1.8} width={15} height={15}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {/* تصویر پست (راست) */}
        {imageBlock?.url ? (
          <img
            src={imageBlock.url}
            alt=""
            style={{ width: 62, height: 62, borderRadius: 16, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : (
          <div style={{
            width: 62, height: 62, borderRadius: 16, flexShrink: 0,
            background: 'linear-gradient(135deg, #E3F6FC, #BAE9F8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.6} width={24} height={24}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.title || 'اطلاعیه جدید'}
          </p>
          {preview && (
            <p style={{ fontSize: 12, color: '#8595ad', margin: '6px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {preview}
            </p>
          )}
        </div>
      </div>

      {/* تاریخ — پایین چپ (در RTL یعنی flex-end) */}
      <span style={{ alignSelf: 'flex-end', fontSize: 11, fontWeight: 700, color: '#5b6b8c', marginTop: 4 }}>
        {formatDateShort(post.createdAt)}
      </span>
    </button>
  );
}
