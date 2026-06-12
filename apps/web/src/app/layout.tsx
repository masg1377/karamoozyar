import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import 'react-multi-date-picker/styles/colors/teal.css';

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
    apple: '/icons/icon-192.png',
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
        <div
          className="relative mx-auto overflow-hidden"
          style={{ maxWidth: 500, minHeight: '100dvh' }}
        >
          {children}
        </div>
        <Toaster
          position="top-center"
          richColors
          toastOptions={{ style: { fontFamily: 'Vazirmatn, Tahoma, sans-serif', direction: 'rtl' } }}
        />
      </body>
    </html>
  );
}
