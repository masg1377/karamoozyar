'use client';

import { useEffect } from 'react';

/**
 * ثبت service worker + بررسی و اعمالِ خودکارِ آپدیتِ اپ (PWA).
 *
 * چرا لازم است؟ قبلاً اپ کش می‌شد و نسخهٔ جدید دیده نمی‌شد. حالا:
 *  - هر بار که اپ باز/فعال می‌شود (و نت وصل است) فایلِ نسخه (/version.json) را
 *    بدونِ کش می‌خوانیم.
 *  - اگر نسخهٔ روی سرور با نسخه‌ای که الان لود شده فرق داشت، یعنی build جدید
 *    منتشر شده → کشِ سرویس‌ورکر را پاک، SW را آپدیت و اپ را یک‌بار رفرش می‌کنیم.
 *  - گاردِ sessionStorage جلوی حلقهٔ بی‌نهایتِ رفرش را می‌گیرد.
 *
 * نکته: روی سرور، Cache-Control برای صفحاتِ HTML باید no-cache باشد (در Caddy
 * تنظیم شده) تا «نسخهٔ لودشده» همیشه = آخرین build باشد و این مقایسه درست کار کند.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let loadedVersion: string | null = null;
    let reloading = false;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* ثبت ناموفق — تجربه کاربر را مختل نکن */
    });

    const fetchVersion = async (): Promise<string | null> => {
      try {
        const res = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data = (await res.json()) as { v?: string };
        return data.v ?? null;
      } catch {
        return null;
      }
    };

    const hardRefresh = async (version: string) => {
      if (reloading) return;
      const guardKey = `app_reloaded_for_${version}`;
      if (sessionStorage.getItem(guardKey)) return; // قبلاً برای همین نسخه رفرش کرده‌ایم
      reloading = true;
      sessionStorage.setItem(guardKey, '1');
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update();
      } catch {
        /* ignore */
      }
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        /* ignore */
      }
      window.location.reload();
    };

    const checkForUpdate = async () => {
      if (!navigator.onLine) return;
      const current = await fetchVersion();
      if (!current) return;
      if (loadedVersion === null) {
        // اولین بار: نسخهٔ فعلیِ لودشده را به‌خاطر بسپار
        // (HTML روی سرور no-cache است، پس این = آخرین build)
        loadedVersion = current;
        return;
      }
      if (current !== loadedVersion) {
        await hardRefresh(current);
      }
    };

    // اگر SW جدید کنترل را به‌دست گرفت، یک‌بار رفرش (برای وقتی خودِ sw.js عوض شده)
    let swReloaded = false;
    const onControllerChange = () => {
      if (swReloaded) return;
      swReloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // بررسیِ اولیه + هر بار که اپ به جلو/فعال می‌آید یا نت وصل می‌شود
    void checkForUpdate();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdate();
    };
    const onOnline = () => void checkForUpdate();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
