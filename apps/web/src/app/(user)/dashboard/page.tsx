'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import { formatDate } from '@/lib/utils';
import type { NewsletterPostDto, CursorPaginatedResponse } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';

export default function UserDashboardPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [posts, setPosts] = useState<NewsletterPostDto[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: CursorPaginatedResponse<NewsletterPostDto> }>('/newsletter', { params: { limit: 3 } })
      .then((r) => setPosts(r.data.data.data))
      .catch(() => {})
      .finally(() => setPostsLoading(false));
  }, []);

  if (!user) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صبح بخیر' : hour < 17 ? 'روز بخیر' : 'شب بخیر';

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '16px 16px calc(96px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Greeting banner ── */}
        <div style={{
          borderRadius: 20,
          padding: '18px 18px',
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0ABDE3 0%, #0779A0 100%)',
        }}>
          <div style={{ position: 'absolute', top: -24, left: -24, width: 90, height: 90, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ position: 'absolute', bottom: -16, right: -16, width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
          <div style={{ position: 'relative' }}>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: '0 0 4px' }}>{greeting} 👋</p>
            <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'white' }}>
              {user.firstName} {user.lastName}
            </h1>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: '4px 0 0' }}>
              {user.judicialDomain} · {user.expertiseField}
            </p>
          </div>
        </div>

        {/* ── Quick actions ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Link href="/chat" style={{ background: 'white', borderRadius: 18, padding: '16px 14px', textDecoration: 'none', display: 'block', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)' }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg, #E3F6FC, #BAE9F8)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.8} width={20} height={20}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>پیام‌ها</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>چت با مدیران</p>
          </Link>

          <Link href="/newsletter" style={{ background: 'white', borderRadius: 18, padding: '16px 14px', textDecoration: 'none', display: 'block', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)' }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth={1.8} width={20} height={20}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', margin: 0 }}>اطلاعیه‌ها</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>اخبار رسمی</p>
          </Link>
        </div>

        {/* ── آخرین اطلاعیه‌ها ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', margin: 0 }}>آخرین اطلاعیه‌ها</h2>
            <Link href="/newsletter" style={{ fontSize: 12, fontWeight: 600, color: '#0ABDE3', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}>
              همه
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          </div>

          {postsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <LoadingSpinner size="md" />
            </div>
          ) : posts.length === 0 ? (
            <div style={{ background: 'white', borderRadius: 18, padding: '24px 16px', textAlign: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>هنوز اطلاعیه‌ای منتشر نشده</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {posts.map((post) => {
                const textBlock = (post.contentBlocks as { type: string; content?: string }[] | undefined)
                  ?.find((b) => b.type === 'TEXT');
                const preview = textBlock?.content?.slice(0, 60) ?? '';
                const hasImage = (post.contentBlocks as { type: string }[] | undefined)
                  ?.some((b) => b.type === 'IMAGE');

                return (
                  <button
                    key={post.id}
                    onClick={() => router.push(`/newsletter/${post.id}`)}
                    style={{
                      width: '100%', background: 'white', borderRadius: 18, padding: '14px 14px',
                      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'right',
                      border: '1px solid rgba(10,189,227,0.07)', boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg, #E3F6FC, #BAE9F8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {hasImage ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.6} width={18} height={18}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.6} width={18} height={18}>
                          <path strokeLinecap="round" strokeLinejoin="round"
                            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(post as { title?: string }).title || 'اطلاعیه جدید'}
                      </p>
                      {preview && (
                        <p style={{ fontSize: 11, color: '#64748b', margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview}</p>
                      )}
                      <p style={{ fontSize: 10, color: '#94a3b8', margin: '3px 0 0' }}>{formatDate(post.createdAt)}</p>
                    </div>

                    <svg viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth={1.5} width={16} height={16} style={{ flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
