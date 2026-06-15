import type { useRouter } from 'next/navigation';

type AppRouter = ReturnType<typeof useRouter>;

/**
 * بازگشت هوشمند:
 *  - اگر سابقه‌ی پیمایش داخل اپ وجود داشته باشد → router.back()
 *  - اگر صفحه مستقیماً باز شده باشد (مثلاً از روی نوتیفیکیشن، بدون تاریخچه) →
 *    به‌جای back بی‌اثر، صفحه با مقصد پیش‌فرض جایگزین می‌شود.
 *
 * Next.js در history.state یک شمارنده‌ی idx نگه می‌دارد که در اولین ورودی session
 * صفر است؛ idx > 0 یعنی جایی برای برگشتن داخل اپ داریم.
 */
export function goBackOrReplace(router: AppRouter, fallback: string): void {
  if (typeof window !== 'undefined') {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) {
      router.back();
      return;
    }
  }
  router.replace(fallback);
}
