'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { tokenStore } from '@/lib/api-client';
import { disconnectSocket } from '@/lib/socket-client';
import { toast } from 'sonner';
import api from '@/lib/api-client';
import { useChatStore } from '@/store/chat.store';
import logoSrc from '@/assets/logo.png';
import { ProfileSheet } from '@/components/profile/ProfileSheet';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { NotificationsProvider } from '@/components/shared/NotificationsProvider';
import { removePushSubscription } from '@/lib/push-client';

const NAV_ITEMS = [
  {
    href: '/admin/newsletter',
    label: 'اطلاعیه‌ها',
    matchFn: (p: string) => p.startsWith('/admin/newsletter'),
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#1c274c'} strokeWidth={1.8} width={20} height={20}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
  },
  {
    href: '/admin/conversations',
    label: 'پیام‌ها',
    matchFn: (p: string) => p.startsWith('/admin/conversations'),
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#1c274c'} strokeWidth={1.8} width={20} height={20}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
  {
    href: '/admin',
    label: 'داشبورد',
    matchFn: (p: string) => p === '/admin',
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#1c274c'} strokeWidth={1.8} width={20} height={20}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6zM4 14a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'کارآموزان',
    matchFn: (p: string) => p.startsWith('/admin/users'),
    icon: (active: boolean) => (
      <svg viewBox="0 0 24 24" fill="none" stroke={active ? '#fff' : '#1c274c'} strokeWidth={1.8} width={20} height={20}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
];

// ─── Nav SVG shape ────────────────────────────────────────────────────────────
const NAV_W = 339, NAV_H = 58.253, NAV_R = 15;
const NOTCH_HW = 33.557, NOTCH_W = 67.114;

function buildNavPath(totalWidth: number, notchCenter: number): string {
  const c = NAV_R * 0.5523;
  const ns = Math.max(NAV_R, Math.min(totalWidth - NAV_R - NOTCH_W, notchCenter - NOTCH_HW));
  const ne = ns + NOTCH_W;
  const segs: string[] = [
    `M${totalWidth - NAV_R} 0`,
    `C${totalWidth - NAV_R + c} 0 ${totalWidth} ${NAV_R - c} ${totalWidth} ${NAV_R}`,
    `V${NAV_H - NAV_R}`,
    `C${totalWidth} ${NAV_H - NAV_R + c} ${totalWidth - NAV_R + c} ${NAV_H} ${totalWidth - NAV_R} ${NAV_H}`,
    `H${NAV_R}`,
    `C${c} ${NAV_H} 0 ${NAV_H - NAV_R + c} 0 ${NAV_H - NAV_R}`,
    `V${NAV_R}`,
    `C0 ${c} ${c} 0 ${NAV_R} 0`,
  ];
  if (ns > NAV_R) segs.push(`H${ns.toFixed(2)}`);
  segs.push(
    `C${(ns + 2.619).toFixed(3)} 0 ${(ns + 4.792).toFixed(3)} 1.953 ${(ns + 5.484).toFixed(3)} 4.478`,
    `C${(ns + 8.94).toFixed(3)} 17.081 ${(ns + 19.27).toFixed(3)} 26.228 ${(ns + NOTCH_HW).toFixed(3)} 26.228`,
    `C${(ns + 42.371).toFixed(3)} 26.228 ${(ns + 51.77).toFixed(3)} 18.941 ${(ns + 56.122).toFixed(3)} 8.415`,
    `C${(ns + 58.033).toFixed(3)} 3.791 ${(ns + 62.111).toFixed(3)} 0 ${ne.toFixed(3)} 0`,
  );
  if (ne < totalWidth - NAV_R) segs.push(`H${(totalWidth - NAV_R).toFixed(2)}`);
  segs.push('Z');
  return segs.join(' ');
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, _hasHydrated, clearUser } = useAuthStore();
  const totalUnread = useChatStore((s) =>
    s.conversations.reduce((acc, c) => acc + c.unreadByAdmin, 0),
  );

  useEffect(() => {
    if (!_hasHydrated) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') router.replace('/login');
  }, [_hasHydrated, isAuthenticated, user, router]);

  // ─── ALL hooks must be before any early return ───────────────────────────────
  const [showProfileSheet, setShowProfileSheet] = useState(false);
  // Measure actual nav pixel width so SVG path is never stretched.
  // Callback-ref pattern: fires whenever <nav> actually mounts — the layout
  // returns null until hydration, so a mount-time useEffect would run too
  // early (ref still null) and the nav would stay unmeasured until the next
  // pathname change. navWidth=0 means "not measured yet" (SVG hidden).
  const [navEl, setNavEl] = useState<HTMLElement | null>(null);
  const [navWidth, setNavWidth] = useState(0);
  useEffect(() => {
    if (!navEl) return;
    setNavWidth(navEl.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setNavWidth(entry.contentRect.width);
    });
    ro.observe(navEl);
    return () => ro.disconnect();
  }, [navEl]);

  if (!_hasHydrated || !user) return null;

  const handleLogout = async () => {
    await removePushSubscription(); // قبل از پاک شدن توکن — اشتراک پوش این دستگاه حذف شود
    try { await api.post('/auth/logout', { refreshToken: tokenStore.getRefresh() }); } catch { /* silent */ }
    tokenStore.clear();
    clearUser();
    disconnectSocket();
    document.cookie = 'auth_flag=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'user_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    toast.success('خروج موفق');
    router.replace('/login');
  };

  const initial = user.firstName?.[0] ?? 'م';

  // Active nav item & notch position (RTL: item 0 = visual right = large LTR x)
  const activeNavIndex = NAV_ITEMS.findIndex(({ matchFn }) => matchFn(pathname));
  const notchCenter = activeNavIndex >= 0
    ? navWidth * (2 * (NAV_ITEMS.length - 1 - activeNavIndex) + 1) / (2 * NAV_ITEMS.length)
    : navWidth / 2;
  // actualNotchCenter mirrors buildNavPath clamping so circle always aligns with SVG notch
  const clampedNs = Math.max(NAV_R, Math.min(navWidth - NAV_R - NOTCH_W, notchCenter - NOTCH_HW));
  const actualNotchCenter = clampedNs + NOTCH_HW;
  // Hide nav on individual conversation pages
  const hideNav = pathname.startsWith('/admin/conversations/');

  return (
    <div
      dir="rtl"
      style={{
        position: 'relative',
        height: '100%', // والد (app-shell) خودش 100dvh است
        overflow: 'hidden',
        /* Figma gradient: rgba(28,39,76,0.69)→rgba(17,106,154,0.69)→rgba(204,240,254,0.69) over #f6fcff */
        background: 'linear-gradient(90deg, #4A88AA 0%, #72B8D5 60%, #D9F4FE 100%)',
      }}
    >
      {/* ── اعلان‌های سراسری (toast + زنگوله + وب‌پوش) ── */}
      <NotificationsProvider role="ADMIN" />

      {/* ── Header (transparent, sits over gradient bg) ── */}
      <header
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 'env(safe-area-inset-top)',
          zIndex: 30,
        }}
      >
        <div style={{
          height: 62,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px',
        }}>
          {/* Right: logo + app name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={(logoSrc as { src: string }).src}
              alt=""
              style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}
            />
            <span style={{ fontWeight: 700, fontSize: 15, color: '#1c274c' }}>کارآموزیار</span>
          </div>

          {/* Left: avatar → bell → name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar → پروفایل (مثل کارآموز) */}
            <button
              onClick={() => setShowProfileSheet(true)}
              style={{
                width: 34, height: 34, borderRadius: '50%',
                background: '#06ACE8',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 700, fontSize: 15,
                border: 'none', cursor: 'pointer',
              }}
            >
              {initial}
            </button>

            {/* Bell — اعلان‌های درون‌برنامه‌ای */}
            <NotificationBell extraDot={totalUnread > 0} />

            <span style={{ fontSize: 13, color: '#1c274c', fontWeight: 500 }}>مدیر سیستم</span>
          </div>
        </div>
      </header>

      {/* ── White content card (rounded top corners, overlaps header area) ── */}
      <main
        style={{
          position: 'absolute',
          top: 'calc(54px + env(safe-area-inset-top))',
          bottom: 0, left: 0, right: 0,
          background: '#F6F7F9',
          borderRadius: '24px 24px 0 0',
          overflow: 'hidden',
          zIndex: 20,
        }}
      >
        {children}
      </main>

      {/* ── Floating pill nav ── */}
      {!hideNav && (
      <nav
        ref={setNavEl}
        style={{
          position: 'absolute',
          bottom: 'calc(20px + env(safe-area-inset-bottom))',
          left: 42, right: 42,
          height: NAV_H,
          zIndex: 50,
          overflow: 'visible',
          display: 'flex',
        }}
      >
        {/* SVG background — rendered only after real width is measured (navWidth > 0)
            so the notch shape is never drawn stretched/misaligned on first load */}
        {navWidth > 0 && (
        <svg
          viewBox={`0 0 ${navWidth} ${NAV_H}`}
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            overflow: 'visible',
            filter: 'drop-shadow(4px 4px 4px rgba(0,0,0,0.25))',
            zIndex: -1,
          }}
        >
          <path d={buildNavPath(navWidth, notchCenter)} fill="#BDD8E2" />
        </svg>
        )}

        {/* Active floating circle — positioned at actual SVG notch center */}
        {navWidth > 0 && activeNavIndex >= 0 && (
          <div style={{
            position: 'absolute',
            top: -22,
            left: actualNotchCenter,
            transform: 'translateX(-50%)',
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(6,172,232,0.50)',
            zIndex: 2,
            pointerEvents: 'none',
          }}>
            {NAV_ITEMS[activeNavIndex].icon(true)}
            {NAV_ITEMS[activeNavIndex].href === '/admin/conversations' && totalUnread > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: 4,
                width: 7, height: 7, borderRadius: '50%',
                background: '#EF4444', border: '1.5px solid white',
              }} />
            )}
          </div>
        )}

        {NAV_ITEMS.map(({ href, label, matchFn, icon }) => {
          const active = matchFn(pathname);
          const hasUnreadBadge = href === '/admin/conversations' && totalUnread > 0;
          return (
            <Link
              key={href + label}
              href={href}
              style={{
                flex: 1,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textDecoration: 'none',
                height: '100%',
              }}
            >
              {/* Inactive icon only — active icon rendered at nav level */}
              {!active && (
                <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)' }}>
                  {icon(false)}
                  {hasUnreadBadge && (
                    <span style={{
                      position: 'absolute', top: -2, right: -2,
                      width: 7, height: 7, borderRadius: '50%',
                      background: '#EF4444', border: '1.5px solid white',
                    }} />
                  )}
                </div>
              )}

              {/* Label */}
              <span style={{
                position: 'absolute',
                bottom: 7,
                left: 0, right: 0,
                textAlign: 'center',
                fontSize: 10,
                fontWeight: active ? 600 : 400,
                color: active ? '#06ACE8' : '#1c274c',
                zIndex: 1,
              }}>
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
      )}

      {/* ── Profile sheet (مثل کارآموز — بدون پشتیبانی و فایل‌های ذخیره‌شده) ── */}
      {showProfileSheet && (
        <ProfileSheet
          firstName={user.firstName}
          lastName={user.lastName}
          expertiseField=""
          roleLabel="مدیر سیستم"
          showExtras={false}
          initial={initial}
          onClose={() => setShowProfileSheet(false)}
          onEditProfile={() => router.push('/admin/profile')}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
