'use client';

import { useEffect, type RefObject } from 'react';

/**
 * فیکس کیبورد فقط برای صفحه‌ی چت روی iOS.
 *
 * بدنه‌ی اپ position:fixed و قفل است، پس وقتی کیبورد iOS باز می‌شود نوار ورودی
 * چت زیر کیبورد گم می‌شود. این هوک — فقط روی iOS و فقط برای المان داده‌شده —
 * ارتفاع کانتینر چت را به اندازه‌ی ناحیه‌ی قابل‌مشاهده (visualViewport) کوچک
 * می‌کند تا اینپوت بالای کیبورد بیاید. هیچ اثری روی بقیه‌ی صفحات/پلتفرم‌ها ندارد.
 */
export function useIosKeyboardInset(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const vv = window.visualViewport;
    if (!isIos || !vv) return;

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

    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      const el = rootRef.current;
      if (el) el.style.height = '';
    };
  }, [rootRef]);
}
