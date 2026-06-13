'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { ensurePushSubscription, isPushSupported } from '@/lib/push-client';

const SESSION_KEY = 'push_prompt_dismissed';

/**
 * شیت یک‌باره فعال‌سازی اعلان‌ها — اولِ باز شدن اپ.
 *
 * چرا دکمه و نه درخواست خودکار؟ مرورگرها (مخصوصاً iOS) فقط در پاسخ به
 * لمس کاربر اجازه باز شدن prompt مجوز را می‌دهند؛ درخواست خودکار در iOS
 * بی‌صدا fail می‌شود و در اندروید هم اگر کاربر سریع رد کند برای همیشه بلاک است.
 * این شیت همان «فورس اول اپ» را به شکل درست انجام می‌دهد.
 */
export function EnablePushPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;                       // HTTP یا مرورگر بدون پشتیبانی
    if (Notification.permission !== 'default') return;    // قبلاً تعیین تکلیف شده
    if (sessionStorage.getItem(SESSION_KEY)) return;      // در همین session رد شده

    // کمی تأخیر تا UI اپ اول جا بیفتد
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!show || typeof document === 'undefined') return null;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setShow(false);
  };

  const handleEnable = async () => {
    const result = await ensurePushSubscription(true); // user gesture ✓
    setShow(false);
    sessionStorage.setItem(SESSION_KEY, '1');
    if (result === 'granted') {
      toast.success('اعلان‌ها فعال شد');
    } else if (result === 'denied') {
      toast.error('اعلان‌ها مسدود شد — برای فعال‌سازی، از تنظیمات مرورگر اقدام کنید');
    }
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 300 }}
      />

      {/* Sheet */}
      <div
        dir="rtl"
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(100vw, 480px)',
          zIndex: 301,
          background: '#fff',
          borderRadius: '26px 26px 0 0',
          boxShadow: '0 -8px 28px rgba(27,79,114,0.25)',
          padding: '22px 22px calc(env(safe-area-inset-bottom) + 20px)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 58, height: 58, borderRadius: '50%', margin: '0 auto 14px',
            background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(6,172,232,0.40)',
          }}
        >
          <BellRing style={{ width: 26, height: 26, color: '#fff' }} />
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1c274c', margin: '0 0 6px' }}>
          اعلان‌ها را فعال کنید
        </h3>
        <p style={{ fontSize: 12.5, color: '#64748b', lineHeight: 2, margin: '0 0 18px' }}>
          تا پیام‌های مدیریت مرکز و اطلاعیه‌های جدید را همان لحظه دریافت کنید —
          حتی وقتی اپلیکیشن بسته است.
        </p>

        <button
          onClick={() => void handleEnable()}
          style={{
            width: '100%', height: 48, border: 'none', borderRadius: 14,
            background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
            color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: '0 6px 18px rgba(6,172,232,0.35)',
          }}
        >
          فعال‌سازی اعلان‌ها
        </button>

        <button
          onClick={dismiss}
          style={{
            marginTop: 10, background: 'none', border: 'none',
            color: '#94a3b8', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            padding: 6,
          }}
        >
          بعداً
        </button>
      </div>
    </>,
    document.body,
  );
}
