'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { tokenStore } from '@/lib/api-client';
import { disconnectSocket } from '@/lib/socket-client';
import { cn } from '@/lib/utils';
import { LayoutDashboard, MessageSquare, Newspaper, Users, LogOut, Menu, X, UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api-client';
import { useChatStore } from '@/store/chat.store';

const NAV_ITEMS = [
  { href: '/admin', label: 'داشبورد', Icon: LayoutDashboard, exact: true },
  { href: '/admin/conversations', label: 'گفتگوها', Icon: MessageSquare },
  { href: '/admin/newsletter', label: 'خبرنامه', Icon: Newspaper },
  { href: '/admin/users', label: 'کارآموزان', Icon: Users },
  { href: '/admin/profile', label: 'پروفایل من', Icon: UserCircle },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, _hasHydrated, clearUser } = useAuthStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const totalUnread = useChatStore((s) =>
    s.conversations.reduce((acc, c) => acc + c.unreadByAdmin, 0),
  );

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') router.replace('/login');
  }, [_hasHydrated, isAuthenticated, user, router]);

  if (!_hasHydrated || !user) return null;

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { refreshToken: tokenStore.getRefresh() });
    } catch { /* silent */ }
    tokenStore.clear();
    clearUser();
    disconnectSocket();
    document.cookie = 'auth_flag=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    toast.success('خروج موفق');
    router.replace('/login');
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 right-0 h-full w-64 bg-white border-l border-gray-200 z-40 flex flex-col transition-transform duration-300 shadow-xl lg:shadow-none',
          'lg:static lg:h-full lg:translate-x-0 lg:flex-shrink-0',
          sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
        )}
      >
        {/* Logo */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="کارآموزیار" className="w-10 h-10 object-contain flex-shrink-0" />
            <div>
              <p className="font-bold text-gray-800 text-sm">کارآموزیار</p>
              <p className="text-xs text-gray-400">پنل مدیریت</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ href, label, Icon, exact }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive(href, exact)
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800',
              )}
            >
              <Icon className="w-4.5 h-4.5 flex-shrink-0" />
              {label}
              {href === '/admin/conversations' && totalUnread > 0 && (
                <span className="mr-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* User + logout */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-bold text-xs">
              {user.firstName[0]}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-gray-400">مدیر سیستم</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
            خروج از سیستم
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <header className="lg:hidden flex-shrink-0 z-20 bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between">
          <img src="/logo.png" alt="کارآموزیار" className="h-8 w-8 object-contain" />
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 w-full min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
