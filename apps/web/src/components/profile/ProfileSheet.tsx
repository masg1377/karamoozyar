'use client';

import { createPortal } from 'react-dom';
import { X, User, LogOut } from 'lucide-react';
// import { BookmarkCheck, Headphones } from 'lucide-react'; // ← برای «فایل‌های ذخیره‌شده» و «پشتیبانی» (فعلاً غیرفعال)

interface ProfileSheetProps {
  firstName: string;
  lastName: string;
  expertiseField: string;
  initial: string;
  /** برچسب نقش زیر نام (پیش‌فرض: «کارآموز» یا رشته تخصصی) */
  roleLabel?: string;
  /** نمایش آیتم‌های «فایل‌های ذخیره‌شده» و «پشتیبانی» — برای ادمین false */
  showExtras?: boolean;
  onClose: () => void;
  onEditProfile: () => void;
  onLogout: () => void;
}

export function ProfileSheet({
  firstName,
  lastName,
  expertiseField,
  initial,
  roleLabel,
  onClose,
  onEditProfile,
  onLogout,
}: ProfileSheetProps) {
  if (typeof document === 'undefined') return null;

  const menuItem = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    danger = false,
    disabled = false,
  ) => (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        width: '100%',
        height: 44,
        background: 'rgba(255,255,255,0.61)',
        borderRadius: 30,
        boxShadow: '0 4px 4px rgba(0,0,0,0.20)',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 10px 0 12px',
        direction: 'rtl',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 500, color: danger ? '#EF4444' : '#1c274c' }}>
        {label}
      </span>
      <div
        style={{
          width: 30,
          height: 24,
          borderRadius: 6,
          background: 'rgba(189,216,226,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
    </button>
  );

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 200,
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(100vw, 480px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)',
          zIndex: 201,
        }}
      >
        <div
          style={{
            background: '#BDD8E2',
            borderRadius: '30px 30px 0 0',
            filter: 'drop-shadow(0 -4px 12px rgba(0,0,0,0.18))',
            overflow: 'hidden',
          }}
        >
          {/* Handle bar */}
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.18)' }} />
          </div>

          {/* Header row: close | name+role | avatar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px 14px',
              direction: 'rtl',
            }}
          >
            {/* Avatar + info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 2px 8px rgba(6,172,232,0.40)',
                }}
              >
                <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>{initial}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#1c274c', margin: 0 }}>
                  {firstName} {lastName}
                </p>
                <p style={{ fontSize: 11, color: 'rgba(28,39,76,0.65)', margin: '2px 0 0' }}>
                  {roleLabel ?? (expertiseField || 'کارآموز')}
                </p>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.45)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X style={{ width: 15, height: 15, color: '#1c274c' }} />
            </button>
          </div>

          {/* Menu items */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              padding: '0 14px 20px',
            }}
          >
            {menuItem(
              <User style={{ width: 14, height: 14, color: '#4A88AA' }} />,
              'ویرایش پروفایل',
              () => { onClose(); setTimeout(onEditProfile, 200); },
            )}
            {/* «فایل‌های ذخیره‌شده» و «پشتیبانی» — فعلاً غیرفعال؛ برای فعال‌سازی از کامنت خارج کنید
            {menuItem(
              <BookmarkCheck style={{ width: 14, height: 14, color: '#4A88AA' }} />,
              'فایل‌های ذخیره‌شده',
              () => {},
              false,
              true,
            )}
            {menuItem(
              <Headphones style={{ width: 14, height: 14, color: '#4A88AA' }} />,
              'پشتیبانی',
              () => {},
              false,
              true,
            )}
            */}
            {menuItem(
              <LogOut style={{ width: 14, height: 14, color: '#EF4444' }} />,
              'خروج از حساب کاربری',
              () => { onClose(); setTimeout(onLogout, 200); },
              true,
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
