/**
 * کارآموزیار — Service Worker
 * وب‌پوش self-hosted (VAPID) + کشِ آفلاین.
 */

// نسخهٔ کش — اگر روزی منطق کش عوض شد این را بالا ببر (v2, v3, ...) تا کشِ قدیمی پاک شود.
const CACHE = 'karamooz-cache-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // کش‌های نسخه‌های قدیمی را پاک کن
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// ─── Fetch / کش ────────────────────────────────────────────────────────────────────
// هدف: اپ آفلاین هم باز شود، ولی آنلاین همیشه تازه باشد.
//  • صفحه (navigate): اول شبکه، اگر نت نبود از کش  → آفلاین باز می‌شود، آنلاین تازه است.
//  • فایل‌های ثابت و عکس‌ها (/_next/static, /files, آیکون/فونت): اول کش (سریع + آفلاین).
//  • دادهٔ زنده/احراز هویتی (/api, /socket.io) و version.json/sw.js: هیچ‌وقت کش نمی‌شود.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // فقط GET کش می‌شود

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // فقط same-origin

  const p = url.pathname;

  // هرگز کش نشوند — دادهٔ زنده، نسخه، و خودِ سرویس‌ورکر
  if (
    p.startsWith('/api/') ||
    p.startsWith('/socket.io/') ||
    p === '/version.json' ||
    p === '/sw.js'
  ) {
    return; // به مرورگر/شبکه بسپار
  }

  // صفحات HTML → network-first با fallback کش (آفلاین باز شود)
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // دارایی‌های ثابت و فایل‌ها → cache-first با آپدیت پس‌زمینه
  const isStatic =
    p.startsWith('/_next/static/') ||
    p.startsWith('/files/') ||
    p.startsWith('/icons/') ||
    p.startsWith('/fonts/') ||
    /\.(?:js|css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|webmanifest)$/.test(p);
  if (isStatic) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // بقیه → پیش‌فرضِ مرورگر
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = (await cache.match(req)) || (await cache.match('/'));
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) {
    // در پس‌زمینه تازه‌اش کن (بدون معطل‌کردن کاربر)
    void fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
      })
      .catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

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
