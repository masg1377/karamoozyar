'use client';

import { useEffect, type RefObject } from 'react';

/**
 * فیکس کیبورد فقط برای صفحه‌ی چت روی iOS.
 *
 * بدنه‌ی اپ position:fixed و قفل است، پس وقتی کیبورد iOS باز می‌شود نوار ورودی
 * چت زیر کیبورد گم می‌شود. این هوک — فقط روی iOS و فقط برای المان داده‌شده —
 * ارتفاع کانتینر چت را به اندازه‌ی ناحیه‌ی قابل‌مشاهده (visualViewport) کوچک
 * می‌کند تا اینپوت بالای کیبورد بیاید. هیچ اثری روی بقیه‌ی صفحات/پلتفرم‌ها ندارد.
 *
 * نکتهٔ مهم (رفعِ باگِ «دفعهٔ دوم اینپوت پایین می‌ماند»):
 * iOS رویدادِ visualViewport.resize را بعد از فوکوسِ مجدد گاهی دیر یا اصلاً
 * fire نمی‌کند (مثلاً وقتی کیبورد قبلاً باز بوده یا بعد از ارسالِ پیام). برای
 * همین علاوه بر resize/scroll، به «focusin» هم گوش می‌دهیم و چند بار با تأخیر
 * محاسبه را تکرار می‌کنیم تا حتماً اینپوت بالا بیاید، و فیلدِ فوکوس‌شده را هم
 * داخلِ دید نگه می‌داریم.
 */
export function useIosKeyboardInset(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const vv = window.visualViewport;
    if (!isIos || !vv) return;

    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const apply = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top; // فاصله‌ی کانتینر از بالای ویوپورت
      const keyboardOpen = vv.height < window.innerHeight - 80;
      if (keyboardOpen) {
        el.style.height = `${Math.max(120, Math.round(vv.height - top))}px`;
      } else {
        el.style.height = '';
      }
    };

    const scheduleApply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    // iOS ارتفاعِ کیبورد را دیر گزارش می‌کند → چند بار با تأخیر دوباره حساب کن
    const applyBurst = () => {
      apply();
      [80, 200, 400, 650].forEach((d) => timers.push(setTimeout(apply, d)));
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || t.isContentEditable) {
        applyBurst();
        // فیلدِ فوکوس‌شده حتماً بالای کیبورد دیده شود
        timers.push(
          setTimeout(() => {
            try {
              t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } catch {
              /* ignore */
            }
          }, 450),
        );
      }
    };

    vv.addEventListener('resize', scheduleApply);
    vv.addEventListener('scroll', scheduleApply);
    // focusin روی document چون bubbling دارد و حتماً فوکوسِ اینپوت چت را می‌گیرد
    document.addEventListener('focusin', onFocusIn);

    return () => {
      vv.removeEventListener('resize', scheduleApply);
      vv.removeEventListener('scroll', scheduleApply);
      document.removeEventListener('focusin', onFocusIn);
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      const el = rootRef.current;
      if (el) el.style.height = '';
    };
  }, [rootRef]);
}
