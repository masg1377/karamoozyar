'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import logoSrc from '@/assets/logo-splash.png';

export default function SplashPage() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const isLoggedIn = document.cookie.includes('auth_flag=true');
    const userRole = document.cookie.match(/user_role=([^;]+)/)?.[1];
    const duration = isLoggedIn ? 800 : 3000;

    const step = 100 / (duration / 16);
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + step, 100));
    }, 16);

    const dest = isLoggedIn
      ? userRole === 'ADMIN' ? '/admin' : '/dashboard'
      : '/login';

    const timer = setTimeout(() => {
      clearInterval(interval);
      router.replace(dest);
    }, duration);

    return () => { clearTimeout(timer); clearInterval(interval); };
  }, [router]);

  return (
    <div
      dir="rtl"
      style={{
        height: '100%', // والد (app-shell) فول‌اسکرین است — dvh در iOS PWA باگ دارد
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(160deg, #EAF6FD 0%, #F5FBFF 50%, #EAF6FD 100%)',
      }}
    >
      {/* Bubble top-left — پالس */}
      <div
        style={{
          position: 'absolute',
          width: 170,
          height: 170,
          top: -55,
          left: -55,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 40%, #B8E8F8 0%, #D9F1FC 55%, transparent 80%)',
          animation: 'bubble-pulse 3.5s ease-in-out infinite',
        }}
      />
      {/* Bubble bottom-right — پالس با تأخیر */}
      <div
        style={{
          position: 'absolute',
          width: 200,
          height: 200,
          bottom: -70,
          right: -60,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 60% 60%, #B8E8F8 0%, #D9F1FC 55%, transparent 80%)',
          animation: 'bubble-pulse 3.5s ease-in-out 1.2s infinite',
        }}
      />

      {/* فضای بالا — لوگو را در حدود 35% صفحه قرار می‌دهد */}
      <div style={{ flex: '0 0 30%' }} />

      {/* محتوای اصلی */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, marginBottom: 20 }}>
        {/* دایره چرخان + لوگوی ثابت */}
        <div style={{ position: 'relative', width: 168, height: 168, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #7DD8F0 0%, #0ABDE3 45%, #0093B5 100%)',
              animation: 'circle-spin 2.5s linear infinite',
            }}
          />
          <img
            src={(logoSrc as { src: string }).src}
            alt="لوگو"
            style={{ position: 'relative', zIndex: 1, width: 124, height: 124, objectFit: 'contain' }}
          />
        </div>

        {/* عنوان */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 17, fontWeight: 700, color: '#1e293b', lineHeight: 1.6, margin: 0 }}>
            مرکز کارشناسان رسمی دادگستری
          </p>
          <p style={{ fontSize: 17, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            مازندران
          </p>
        </div>
      </div>

      {/* فضای میانی */}
      {/* <div style={{ flex: 1 }} /> */}

      {/* پروگرس بار — چسبیده به پایین */}
      <div style={{ width: '100%', padding: '0 32px 52px', boxSizing: 'border-box', zIndex: 1 }}>
        <div style={{ position: 'relative', height: 2, background: '#D9EDF7', borderRadius: 4 }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              borderRadius: 4,
              background: '#0ABDE3',
              width: `${progress}%`,
              transition: 'width 0.08s linear',
            }}
          />
        </div>
        {/* <div
          style={{
            position: 'absolute',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#0ABDE3',
            marginTop: -4,
            left: `calc(32px + ${progress}% * (100% - 64px) / 100 - 4px)`,
            transition: 'left 0.08s linear',
          }}
        /> */}
      </div>

      <style>{`
        @keyframes circle-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes bubble-pulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50%       { transform: scale(1.18); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
