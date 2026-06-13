import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import 'react-multi-date-picker/styles/colors/teal.css';
import { PwaInstallGate } from '@/components/shared/PwaInstallGate';

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
    icon: '/icons/icon-192.png',
    // آیکون iOS باید opaque باشد — نسخه مخصوص با پس‌زمینه سفید از logo.png
    apple: '/icons/apple-touch-icon.png',
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
        <PwaInstallGate>
          <div
            className="relative mx-auto overflow-hidden"
            style={{ maxWidth: 500, minHeight: '100dvh' }}
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
