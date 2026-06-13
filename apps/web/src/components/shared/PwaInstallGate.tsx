'use client';

import { useEffect, useState } from 'react';
import logoSrc from '@/assets/logo.png';

/**
 * PwaInstallGate — صفحه انتظار نصب PWA
 *
 * وقتی اپ داخل مرورگر موبایل (iOS / Android) باز شود — نه به‌صورت standalone —
 * یک صفحه تمام‌صفحه با راهنمای «افزودن به صفحه اصلی» نمایش می‌دهد.
 * در حالت نصب‌شده (standalone) یا دسکتاپ هیچ تأثیری ندارد.
 */

type Platform = 'ios' | 'android' | null;

/** وقتی کاربر تأیید کند نصب کرده، گیت دیگر روی این دستگاه نمایش داده نمی‌شود.
 *  (روی HTTP شورتکات اندروید در حالت standalone باز نمی‌شود و راه تشخیص
 *  خودکار وجود ندارد — این تأیید دستی جایگزین آن است) */
const GATE_DONE_KEY = 'pwa_install_gate_done';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS 13+ گاهی خود را Mac معرفی می‌کند
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// ─── آیکون‌های راهنما ──────────────────────────────────────────────────────────

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#06ACE8" strokeWidth={1.8} width={22} height={22}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0-12L8 7m4-4l4 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8" />
    </svg>
  );
}

function AddSquareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#06ACE8" strokeWidth={1.8} width={22} height={22}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path strokeLinecap="round" d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

function MenuDotsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#06ACE8" width={22} height={22}>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

function PhoneAddIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#06ACE8" strokeWidth={1.8} width={22} height={22}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path strokeLinecap="round" d="M12 9v6M9 12h6" />
    </svg>
  );
}

// ─── ردیف مرحله ────────────────────────────────────────────────────────────────

function Step({ num, icon, children }: { num: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span
        style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
          color: '#fff', fontSize: 13, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {num}
      </span>
      <span
        style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: '#EBF7FD', border: '1px solid #D4EDFB',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      <p style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.9, margin: 0, textAlign: 'right' }}>
        {children}
      </p>
    </div>
  );
}

// ─── کامپوننت اصلی ─────────────────────────────────────────────────────────────

export function PwaInstallGate({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const p = detectPlatform();
    const alreadyConfirmed = localStorage.getItem(GATE_DONE_KEY) === '1';
    if (p && !isStandalone() && !alreadyConfirmed) {
      setPlatform(p);
      setShow(true);
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      localStorage.setItem(GATE_DONE_KEY, '1'); // در تب مرورگر هم دیگر گیت نیاید
    };

    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!show) return <>{children}</>;

  const handleNativeInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  };

  return (
    <div
      dir="rtl"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        overflowY: 'auto',
        background: 'linear-gradient(180deg, #C8E6F7 0%, #EBF5FF 40%, #F5FAFF 100%)',
        paddingTop: 'calc(env(safe-area-inset-top) + 40px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)',
        paddingLeft: 20, paddingRight: 20,
        fontFamily: 'Vazirmatn, Tahoma, sans-serif',
      }}
    >
      {/* لوگو و عنوان */}
      <img
        src={(logoSrc as { src: string }).src}
        alt="کارآموزیار"
        style={{ width: 88, height: 88, objectFit: 'contain', marginBottom: 14 }}
      />
      <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1c274c', margin: '0 0 6px' }}>کارآموزیار</h1>
      <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 24px', textAlign: 'center' }}>
        سامانه ارتباطی مرکز کارشناسان رسمی دادگستری مازندران
      </p>

      {/* کارت راهنما */}
      <div
        style={{
          width: '100%', maxWidth: 400,
          background: '#fff', borderRadius: 24,
          boxShadow: '0 10px 30px rgba(27,79,114,0.10)',
          padding: '24px 20px',
        }}
      >
        {installed ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div
              style={{
                width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
                background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} width={28} height={28}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1c274c', margin: '0 0 6px' }}>
              اپلیکیشن نصب شد
            </p>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, lineHeight: 1.9 }}>
              کارآموزیار را از صفحه اصلی گوشی خود باز کنید.
            </p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 15.5, fontWeight: 700, color: '#1c274c', margin: '0 0 4px', textAlign: 'right' }}>
              نصب اپلیکیشن
            </h2>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 20px', lineHeight: 1.9, textAlign: 'right' }}>
              برای تجربه بهتر و دسترسی سریع‌تر، کارآموزیار را به صفحه اصلی گوشی خود اضافه کنید.
            </p>

            {platform === 'android' && deferredPrompt ? (
              <button
                onClick={handleNativeInstall}
                style={{
                  width: '100%', height: 48, border: 'none', borderRadius: 14,
                  background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
                  color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: '0 6px 18px rgba(6,172,232,0.35)',
                }}
              >
                نصب اپلیکیشن
              </button>
            ) : platform === 'ios' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Step num={1} icon={<ShareIcon />}>
                  در نوار پایین مرورگر Safari روی دکمه <b>اشتراک‌گذاری (Share)</b> بزنید.
                </Step>
                <Step num={2} icon={<AddSquareIcon />}>
                  از منوی بازشده گزینه <b>Add to Home Screen</b> (افزودن به صفحه اصلی) را انتخاب کنید.
                </Step>
                <Step num={3} icon={<PhoneAddIcon />}>
                  در بالای صفحه روی <b>Add (افزودن)</b> بزنید و اپ را از صفحه اصلی باز کنید.
                </Step>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Step num={1} icon={<MenuDotsIcon />}>
                  در مرورگر Chrome روی منوی <b>سه‌نقطه (⋮)</b> در بالای صفحه بزنید.
                </Step>
                <Step num={2} icon={<AddSquareIcon />}>
                  گزینه <b>Add to Home Screen</b> یا <b>نصب برنامه</b> را انتخاب کنید.
                </Step>
                <Step num={3} icon={<PhoneAddIcon />}>
                  روی <b>نصب</b> بزنید و کارآموزیار را از صفحه اصلی باز کنید.
                </Step>
              </div>
            )}
          </>
        )}
      </div>

      {/* پانوشت */}
      <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 20, textAlign: 'center', lineHeight: 1.9 }}>
        پس از نصب، اپلیکیشن به‌صورت تمام‌صفحه و با اعلان‌های لحظه‌ای در اختیار شما خواهد بود.
      </p>

      {/* تأیید دستی نصب — مخصوص حالتی که تشخیص خودکار ممکن نیست (مثلاً HTTP در اندروید) */}
      <button
        onClick={() => {
          localStorage.setItem(GATE_DONE_KEY, '1');
          setShow(false);
        }}
        style={{
          marginTop: 14,
          background: 'none',
          border: 'none',
          color: '#0779A0',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: '8px 12px',
          textDecoration: 'underline',
          textUnderlineOffset: 4,
        }}
      >
        اپ را اضافه کرده‌ام — دیگر نشان نده
      </button>
    </div>
  );
}
