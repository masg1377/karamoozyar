'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellOff, BellRing, Megaphone, MessageCircle } from 'lucide-react';
import { useNotificationStore } from '@/store/notification.store';
import { ensurePushSubscription, isPushSupported } from '@/lib/push-client';

function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'هم‌اکنون';
  if (min < 60) return `${min} دقیقه پیش`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ساعت پیش`;
  return `${Math.floor(hr / 24)} روز پیش`;
}

interface NotificationBellProps {
  /** نقطه قرمز اضافه (مثلاً پیام‌های خوانده‌نشده گفتگوها) */
  extraDot?: boolean;
}

export function NotificationBell({ extraDot = false }: NotificationBellProps) {
  const router = useRouter();
  const { items, unreadCount, markAllRead, markRead } = useNotificationStore();
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('granted');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPermission(isPushSupported() ? Notification.permission : 'unsupported');
  }, []);

  // بستن پنل با کلیک بیرون
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) setTimeout(markAllRead, 1200); // کمی بعد از باز شدن، خوانده‌شده
      return next;
    });
  };

  const handleEnablePush = async () => {
    const result = await ensurePushSubscription(true); // user gesture ✓
    setPermission(result);
  };

  const showDot = unreadCount > 0 || extraDot;

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* زنگوله */}
      <button
        onClick={toggle}
        aria-label="اعلان‌ها"
        style={{ position: 'relative', background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#1c274c" strokeWidth={1.8} width={22} height={22}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {showDot && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 8, height: 8, borderRadius: 8,
            background: '#EF4444', border: '1.5px solid white',
            ...(unreadCount > 0 && {
              minWidth: 15, height: 15, top: -1, right: -1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 9, fontWeight: 700, padding: '0 3px',
            }),
          }}>
            {unreadCount > 0 ? (unreadCount > 9 ? '۹+' : unreadCount.toLocaleString('fa-IR')) : ''}
          </span>
        )}
      </button>

      {/* پنل اعلان‌ها */}
      {open && (
        <div
          dir="rtl"
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            left: -54,
            width: 'min(320px, calc(100vw - 32px))',
            maxHeight: 380,
            background: '#fff',
            borderRadius: 18,
            boxShadow: '0 12px 36px rgba(27,79,114,0.22)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 100,
          }}
        >
          {/* سربرگ پنل */}
          <div style={{
            padding: '12px 16px 10px',
            borderBottom: '1px solid #f0f4f8',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#1c274c' }}>اعلان‌ها</span>
            <BellRing style={{ width: 15, height: 15, color: '#06ACE8' }} />
          </div>

          {/* دکمه فعال‌سازی پوش — فقط وقتی مجوز هنوز پرسیده نشده */}
          {permission === 'default' && (
            <button
              onClick={handleEnablePush}
              style={{
                margin: '10px 12px 0',
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px dashed #06ACE8',
                background: '#F0FAFE',
                color: '#0779A0',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
              }}
            >
              <BellRing style={{ width: 14, height: 14 }} />
              فعال‌سازی اعلان‌ها حتی وقتی اپ بسته است
            </button>
          )}
          {permission === 'denied' && (
            <p style={{
              margin: '10px 12px 0', padding: '8px 12px', borderRadius: 12,
              background: '#FEF2F2', color: '#B91C1C', fontSize: 11, lineHeight: 1.8,
            }}>
              اعلان‌ها در تنظیمات مرورگر مسدود شده‌اند. برای دریافت اعلان، آن را از تنظیمات فعال کنید.
            </p>
          )}

          {/* فهرست */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {items.length === 0 ? (
              <div style={{
                padding: '32px 16px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              }}>
                <BellOff style={{ width: 26, height: 26, color: '#cbd5e1' }} />
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>اعلان جدیدی ندارید</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    markRead(n.id);
                    setOpen(false);
                    router.push(n.href);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '11px 14px',
                    background: n.read ? '#fff' : '#F0FAFE',
                    border: 'none',
                    borderBottom: '1px solid #f4f7fa',
                    cursor: 'pointer',
                    textAlign: 'right',
                    fontFamily: 'inherit',
                  }}
                >
                  <span style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    background: n.type === 'newsletter' ? '#FFF7E8' : '#E8F9FE',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {n.type === 'newsletter'
                      ? <Megaphone style={{ width: 15, height: 15, color: '#D97706' }} />
                      : <MessageCircle style={{ width: 15, height: 15, color: '#06ACE8' }} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: '#1c274c' }}>
                      {n.title}
                    </span>
                    <span style={{
                      display: 'block', fontSize: 11.5, color: '#64748b', marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {n.body}
                    </span>
                    <span style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                  {!n.read && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: '#06ACE8', flexShrink: 0, marginTop: 5,
                    }} />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
