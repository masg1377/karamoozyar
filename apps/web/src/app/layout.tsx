import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import 'react-multi-date-picker/styles/colors/teal.css';
import { PwaInstallGate } from '@/components/shared/PwaInstallGate';
import { IosViewportFix } from '@/components/shared/IosViewportFix';
import { ServiceWorkerRegistrar } from '@/components/shared/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: {
    default: 'کارآموزیار',
    template: '%s | کارآموزیار',
  },
  description: 'سامانه ارتباطی مرکز کارشناسان رسمی دادگستری مازندران',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'کارآموزیار',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    // آیکون iOS باید opaque باشد — نسخه مخصوص با پس‌زمینه سفید از logo.png
    // sizes صریح، تا iOS موقع Add to Home Screen مطمئن برش دارد
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#1B4F72',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        <link
          href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"
          rel="stylesheet"
          type="text/css"
        />
      </head>
      <body
        className="font-sans antialiased"
        style={{ fontFamily: 'Vazirmatn, Tahoma, sans-serif', background: '#cbd5e1' }}
      >
        <IosViewportFix />
        <ServiceWorkerRegistrar />
        <PwaInstallGate>
          {/* height: 100% (نه 100dvh) — body با position:fixed + inset:0 دقیقاً
              هم‌اندازه صفحه است؛ dvh در PWA های iOS باگ دارد و گاهی کوچک‌تر
              از صفحه محاسبه می‌شود → گپ خاکستری پایین. 100% همیشه دقیق است. */}
          <div
            className="relative mx-auto"
            style={{ maxWidth: 500, height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
          >
            {children}
          </div>
        </PwaInstallGate>
        <Toaster
          position="top-center"
          richColors
          offset="calc(env(safe-area-inset-top, 0px) + 12px)"
          toastOptions={{ style: { fontFamily: 'Vazirmatn, Tahoma, sans-serif', direction: 'rtl' } }}
        />
      </body>
    </html>
  );
}
