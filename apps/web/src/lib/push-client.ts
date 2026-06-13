'use client';

import api from './api-client';

/**
 * وب‌پوش self-hosted — ثبت service worker و اشتراک push با کلید VAPID سرور خودمان.
 * هیچ سرویس third-party در کار نیست.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}

/**
 * اشتراک push را برقرار می‌کند (در صورت داشتن مجوز) و در سرور ثبت می‌کند.
 * @param requestPermission اگر true باشد و مجوز هنوز پرسیده نشده، از کاربر می‌پرسد
 *        (باید در پاسخ به یک user gesture صدا زده شود — الزام Safari/iOS)
 * @returns وضعیت نهایی مجوز
 */
export async function ensurePushSubscription(
  requestPermission = false,
): Promise<NotificationPermission | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported';

  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';

  let permission = Notification.permission;
  if (permission === 'default' && requestPermission) {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return permission;

  try {
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const { data } = await api.get<{ data: { publicKey: string } }>('/push/public-key');
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.data.publicKey) as BufferSource,
      });
    }
    await api.post('/push/subscribe', subscription.toJSON());
  } catch {
    // ثبت اشتراک ناموفق — تجربه کاربر را مختل نکن؛ دفعه بعد دوباره تلاش می‌شود
  }
  return permission;
}

/** هنگام خروج از حساب: اشتراک این دستگاه را از سرور حذف می‌کند */
export async function removePushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) {
      await api.delete('/push/subscribe', { data: { endpoint: subscription.endpoint } }).catch(() => undefined);
      await subscription.unsubscribe();
    }
  } catch {
    /* silent */
  }
}
