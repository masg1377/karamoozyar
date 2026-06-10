'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { tokenStore } from '@/lib/api-client';
import api from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { MessageSquare, Newspaper, LogOut, Home, UserCircle } from 'lucide-react';
import { UserAvatar } from '@/components/shared/UserAvatar';
import { toast } from 'sonner';
import { disconnectSocket as disconnectWs } from '@/lib/socket-client';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'خانه', Icon: Home },
  { href: '/chat', label: 'پیام‌ها', Icon: MessageSquare },
  { href: '/newsletter', label: 'اطلاعیه‌ها', Icon: Newspaper },
  { href: '/profile', label: 'پروفایل', Icon: UserCircle },
];

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, _hasHydrated, clearUser } = useAuthStore();

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated) router.replace('/login');
  }, [_hasHydrated, isAuthenticated, router]);

  if (!_hasHydrated || !user) return null;

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.getRefresh() });
    } catch { /* silent */ }
    tokenStore.clear();
    clearUser();
    disconnectWs();
    document.cookie = 'auth_flag=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    toast.success('با موفقیت خارج شدید');
    router.replace('/login');
  };

  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`;

  return (
    // h-dvh = dynamic viewport height — shrinks when keyboard opens on mobile
    <div
      className="flex flex-col bg-gray-50"
      style={{
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      {/* ── Header (flex-shrink-0, never scrolls away) ─────── */}
      <header className="flex-shrink-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="کارآموزیار" className="w-8 h-8 object-contain flex-shrink-0" />
            <span className="text-sm font-bold text-primary-700 tracking-tight">کارآموزیار</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-2.5 py-1.5">
              <UserAvatar
                firstName={user.firstName}
                lastName={user.lastName}
                avatarUrl={user.avatarUrl}
                size="sm"
                className="w-6 h-6 text-[10px] rounded-lg"
              />
              <span className="text-xs font-medium text-gray-700 max-w-[80px] truncate">
                {user.firstName}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main (flex-1 overflow-hidden — each page controls own scroll) ── */}
      <main className="flex-1 overflow-hidden max-w-xl mx-auto w-full">
        {children}
      </main>

      {/* ── Bottom nav (flex-shrink-0, always visible) ───────── */}
      <nav
        className="flex-shrink-0 z-40 bg-white/95 backdrop-blur-sm border-t border-gray-100"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="max-w-xl mx-auto px-6 flex items-center justify-around h-16">
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-0.5 min-w-[56px] py-1 group"
              >
                <div className={cn(
                  'w-10 h-8 flex items-center justify-center rounded-2xl transition-all duration-200',
                  active ? 'bg-primary-100' : 'group-active:bg-gray-100',
                )}>
                  <Icon className={cn(
                    'w-5 h-5 transition-all duration-200',
                    active ? 'text-primary-600 stroke-[2.5]' : 'text-gray-400',
                  )} />
                </div>
                <span className={cn(
                  'text-[10px] font-medium transition-colors duration-200',
                  active ? 'text-primary-600' : 'text-gray-400',
                )}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
