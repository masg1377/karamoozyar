'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api-client';
import type { AdminStatsDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { Users, MessageSquare, Newspaper, Bell } from 'lucide-react';
import Link from 'next/link';

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStatsDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ data: AdminStatsDto }>('/admin/stats')
      .then((res) => setStats(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner size="lg" className="mt-16" label="در حال بارگذاری..." />;
  if (!stats) return null;

  const STAT_CARDS = [
    {
      label: 'کل کارآموزان', value: stats.totalUsers,
      sub: `${stats.activeUsers} فعال`, Icon: Users, color: 'blue', href: '/admin/users',
    },
    {
      label: 'گفتگوها', value: stats.totalConversations,
      sub: `${stats.unreadConversations} پیام نخوانده`, Icon: MessageSquare, color: 'green', href: '/admin/conversations',
    },
    {
      label: 'پست‌های خبرنامه', value: stats.totalNewsletterPosts,
      sub: 'مجموع پست‌ها', Icon: Newspaper, color: 'purple', href: '/admin/newsletter',
    },
    {
      label: 'کل پیام‌ها', value: stats.totalMessages,
      sub: 'ارسال شده', Icon: Bell, color: 'orange', href: '/admin/conversations',
    },
  ];

  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">داشبورد</h1>
        <p className="text-sm text-gray-400 mt-0.5">مرکز کارشناسان رسمی دادگستری مازندران</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ label, value, sub, Icon, color, href }) => (
          <Link
            key={label}
            href={href}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-primary-200 transition-all"
          >
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-3', colorMap[color] ?? 'bg-gray-50 text-gray-600')}>
              <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-gray-800">{value.toLocaleString('fa-IR')}</p>
            <p className="text-sm font-medium text-gray-600 mt-0.5">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </Link>
        ))}
      </div>

      {stats.unreadConversations > 0 && (
        <Link
          href="/admin/conversations"
          className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-2xl p-4 hover:bg-red-100 transition-colors"
        >
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-red-700 text-sm">
              {stats.unreadConversations} گفتگو با پیام نخوانده
            </p>
            <p className="text-xs text-red-400">برای پاسخ کلیک کنید</p>
          </div>
        </Link>
      )}
    </div>
  );
}

function cn(...args: (string | boolean | undefined)[]): string {
  return args.filter(Boolean).join(' ');
}
