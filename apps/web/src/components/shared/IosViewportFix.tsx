'use client';

import { useEffect } from 'react';

/**
 * فیکس ویوپورت موبایل (هم iOS هم اندروید).
 *
 * ۱) متغیر CSS «--app-height» را برابرِ ارتفاعِ واقعیِ قابل‌مشاهده (window.innerHeight)
 *    ست می‌کند. body در globals.css ارتفاعش را از همین می‌گیرد؛ بنابراین دیگر
 *    گپ/نوارِ خاکستریِ پایینِ صفحه (به‌خاطر نوار آدرسِ متغیرِ مرورگر و باگِ dvh در
 *    iOS) ایجاد نمی‌شود — صفحه همیشه دقیقاً اندازهٔ ناحیهٔ دیده‌شده است.
 * ۲) اسکرولِ سرگردانِ window را صفر می‌کند (باگ iOS بعد از باز/بسته‌شدنِ کیبورد).
 */
export function IosViewportFix() {
  useEffect(() => {
    const root = document.documentElement;

    const setAppHeight = () => {
      root.style.setProperty('--app-height', `${window.innerHeight}px`);
    };

    const reset = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (root.scrollTop !== 0) root.scrollTop = 0;
    };

    const vv = window.visualViewport;
    const onVvChange = () => {
      // کیبورد بسته شد (ویوپورت تقریباً برگشت به ارتفاع کامل) → اسکرول را برگردان
      if (!vv || vv.height >= window.innerHeight - 30) reset();
    };

    const onResize = () => setAppHeight();
    const onFocusOut = () => setTimeout(reset, 60);
    const onOrientation = () => setTimeout(() => { setAppHeight(); reset(); }, 120);

    // مقداردهیِ اولیه
    setAppHeight();
    reset();

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientation);
    vv?.addEventListener('resize', onVvChange);
    vv?.addEventListener('scroll', onVvChange);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientation);
      vv?.removeEventListener('resize', onVvChange);
      vv?.removeEventListener('scroll', onVvChange);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return null;
}
