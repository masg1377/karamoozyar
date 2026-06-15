/**
 * کارآموزیار — Service Worker
 * وب‌پوش self-hosted (VAPID) — بدون هیچ سرویس third-party.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ─── Fetch ───────────────────────────────────────────────────────────────────────
// وجود یک fetch handler (حتی pass-through) برای نصب‌پذیری WebAPK در اندروید لازم است.
// بدون آن، کروم به‌جای نصب standalone فقط یک شورتکات بوکمارک می‌سازد که نوار آدرس دارد.
self.addEventListener('fetch', () => {
  // درخواست‌ها به‌صورت پیش‌فرض مرورگر هندل می‌شوند (بدون respondWith).
});

// ─── Push ──────────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let data = { title: 'کارآموزیار', body: 'پیام جدید', url: '/', tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* payload نامعتبر — مقادیر پیش‌فرض */
  }

  event.waitUntil(
    (async () => {
      // اگر اپ باز و فوکوس است، اعلان درون‌برنامه‌ای (toast/زنگوله) کافی است
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hasFocused = clients.some((c) => c.focused && c.visibilityState === 'visible');
      if (hasFocused) return;

      const options = {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-maskable-192.png',
        dir: 'rtl',
        lang: 'fa',
        data: { url: data.url || '/' },
      };
      if (data.tag) {
        options.tag = data.tag; // اعلان‌های همان گفتگو روی هم جمع می‌شوند
        options.renotify = true;
      }
      await self.registration.showNotification(data.title, options);
    })(),
  );
});

// ─── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // اگر پنجره‌ای از اپ باز است، همان را فوکوس و هدایت کن
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            try { await client.navigate(url); } catch { /* cross-origin guard */ }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
