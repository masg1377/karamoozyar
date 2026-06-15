'use client';

import { useEffect } from 'react';

/**
 * ثبت سراسری و زودهنگام service worker.
 *
 * در root layout (مستقل از احراز هویت) mount می‌شود تا حتی در صفحه ورود هم
 * service worker فعال باشد. این برای نصب‌پذیری PWA روی اندروید حیاتی است:
 *  - بدون SW فعال، کروم رویداد beforeinstallprompt را fire نمی‌کند و اپ را
 *    فقط به‌صورت شورتکات بوکمارک (با نوار آدرس) اضافه می‌کند، نه WebAPK تمام‌صفحه.
 *  - اشتراک واقعی وب‌پوش همچنان بعد از لاگین و با مجوز کاربر انجام می‌شود.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* ثبت ناموفق — تجربه کاربر را مختل نکن */
    });
  }, []);

  return null;
}
