'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import type { AdminStatsDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { timeAgo } from '@/lib/utils';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<AdminStatsDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: AdminStatsDto }>('/admin/stats')
      .then((res) => setStats(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  if (!stats || !user) return null;

  const STAT_CARDS = [
    {
      label: 'اطلاعیه‌ها',
      value: stats.totalNewsletterPosts,
      sub: 'مجموع پست‌ها',
      href: '/admin/newsletter',
      dotColor: '#EF4444',
      iconBg: 'linear-gradient(135deg, #FEE2E2, #FECACA)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth={1.6} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
    {
      label: 'گفتگوها',
      value: stats.totalConversations,
      sub: `${stats.unreadConversations} نخوانده`,
      href: '/admin/conversations',
      dotColor: '#0ABDE3',
      iconBg: 'linear-gradient(135deg, #E3F6FC, #BAE9F8)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.6} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      label: 'کل کارآموزان',
      value: stats.totalUsers,
      sub: `${stats.activeUsers} فعال`,
      href: '/admin/users',
      dotColor: '#F59E0B',
      iconBg: 'linear-gradient(135deg, #FEF3C7, #FDE68A)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth={1.6} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      label: 'کل پیام‌ها',
      value: stats.totalMessages,
      sub: 'ارسال شده',
      href: '/admin/conversations',
      dotColor: '#10B981',
      iconBg: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={1.6} className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ padding: '16px 16px calc(96px)', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Greeting ── */}
        <div style={{
          background: 'white',
          borderRadius: 20,
          padding: '16px 18px',
          boxShadow: '0 2px 12px rgba(10,189,227,0.08)',
          border: '1px solid rgba(10,189,227,0.08)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* decorative element */}
          <div style={{ position: 'absolute', top: -20, left: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(10,189,227,0.06)' }} />
          <div style={{ position: 'relative' }}>
            <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: 0 }}>
              سلام مدیر سیستم 👋
            </h1>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, margin: '4px 0 0' }}>
              مرکز کارشناسان رسمی دادگستری مازندران
            </p>
          </div>
        </div>

        {/* ── Stat cards 2×2 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {STAT_CARDS.map(({ label, value, sub, href, dotColor, iconBg, icon }) => (
            <Link
              key={label}
              href={href}
              style={{ background: 'white', borderRadius: 18, padding: '14px 14px 12px', textDecoration: 'none', display: 'block', position: 'relative', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)', transition: 'transform 0.15s' }}
            >
              {/* colored dot top-left */}
              <span style={{ position: 'absolute', top: 12, left: 12, width: 8, height: 8, borderRadius: '50%', background: dotColor }} />

              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 26, fontWeight: 800, color: '#1e293b', margin: 0, lineHeight: 1 }}>
                  {value.toLocaleString('fa-IR')}
                </p>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {icon}
                </div>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', margin: 0 }}>{label}</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>{sub}</p>
            </Link>
          ))}
        </div>

        {/* ── آخرین فعالیت‌ها ── */}
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', margin: '0 0 10px' }}>آخرین فعالیت‌ها</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Item 1 — latest newsletter post (real data, hidden if none exist yet) */}
            {stats.recentActivity.latestNewsletterPost && (() => {
              const post = stats.recentActivity.latestNewsletterPost;
              const isRecent = Date.now() - new Date(post.createdAt).getTime() < DAY_MS;
              const badge = isRecent
                ? { label: 'جدید', bg: '#E0F9FF', color: '#0ABDE3' }
                : post.isEdited
                  ? { label: 'ویرایش شده', bg: '#FEF3C7', color: '#D97706' }
                  : { label: 'منتشر شده', bg: '#F1F5F9', color: '#64748B' };
              return (
                <Link href="/admin/newsletter" style={{
                  background: 'white', borderRadius: 18, padding: '14px 14px', textDecoration: 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)',
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 14, background: 'linear-gradient(135deg, #E3F6FC, #BAE9F8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0ABDE3" strokeWidth={1.6} width={18} height={18}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {post.title?.trim() || 'اطلاعیه بدون عنوان'}
                    </p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>{timeAgo(post.createdAt)}</p>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: badge.bg, color: badge.color, flexShrink: 0 }}>
                    {badge.label}
                  </span>
                </Link>
              );
            })()}

            {/* Item 2 — unread conversations (real count + real most-recent timestamp) */}
            {stats.unreadConversations > 0 && (
              <Link href="/admin/conversations?filter=unread" style={{
                background: 'white', borderRadius: 18, padding: '14px 14px', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 12,
                boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 14, background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth={1.6} width={18} height={18}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0 }}>
                    {stats.unreadConversations.toLocaleString('fa-IR')} پیام نخوانده
                  </p>
                  <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>
                    {stats.recentActivity.latestUnreadAt ? timeAgo(stats.recentActivity.latestUnreadAt) : ''}
                  </p>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: '#FEE2E2', color: '#DC2626', flexShrink: 0 }}>
                  نیاز به بررسی
                </span>
              </Link>
            )}

            {/* Item 3 — most recently active trainee (real name + real lastSeenAt, real active count) */}
            <Link href="/admin/users" style={{
              background: 'white', borderRadius: 18, padding: '14px 14px', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid rgba(10,189,227,0.07)',
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 14, background: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth={1.6} width={18} height={18}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stats.recentActivity.latestActiveUser
                    ? `${stats.recentActivity.latestActiveUser.firstName} ${stats.recentActivity.latestActiveUser.lastName}`
                    : 'کارآموزان فعال'}
                </p>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '3px 0 0' }}>
                  {stats.recentActivity.latestActiveUser
                    ? timeAgo(stats.recentActivity.latestActiveUser.lastSeenAt)
                    : 'هنوز هیچ کارآموزی وارد نشده'}
                </p>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: '#EDE9FE', color: '#7C3AED', flexShrink: 0 }}>
                {stats.activeUsers.toLocaleString('fa-IR')} فعال
              </span>
            </Link>

          </div>
        </div>
      </div>
    </div>
  );
}
