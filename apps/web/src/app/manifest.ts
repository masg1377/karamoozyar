import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'کارآموزیار',
    short_name: 'کارآموزیار',
    description: 'سامانه ارتباطی مرکز کارشناسان رسمی دادگستری مازندران',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1B4F72',
    orientation: 'portrait',
    lang: 'fa',
    dir: 'rtl',
    icons: [
      { src: '/logo.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/logo.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    categories: ['productivity', 'business'],
    shortcuts: [
      { name: 'پیام‌ها', url: '/chat', description: 'باز کردن پیام‌ها' },
      { name: 'اطلاعیه‌ها', url: '/newsletter', description: 'باز کردن اطلاعیه‌ها' },
    ],
  };
}
