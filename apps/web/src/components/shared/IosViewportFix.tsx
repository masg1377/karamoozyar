'use client';

import { useEffect } from 'react';

/**
 * فیکس باگ ویوپورت iOS — وقتی کیبورد باز/بسته می‌شود سافاری گاهی window را
 * اسکرول‌شده رها می‌کند و یک گپ خاکستری پایین اپ می‌ماند تا کاربر دستی اسکرول کند.
 * این کامپوننت با visualViewport آن اسکرول سرگردان را بلافاصله صفر می‌کند.
 */
export function IosViewportFix() {
  useEffect(() => {
    const reset = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    };

    const vv = window.visualViewport;
    const onVvChange = () => {
      // کیبورد بسته شد (ویوپورت تقریباً برگشت به ارتفاع کامل) → اسکرول را برگردان
      if (!vv || vv.height >= window.innerHeight - 30) reset();
    };

    // بعد از blur شدن اینپوت (بسته شدن کیبورد) کمی صبر و بعد ریست
    const onFocusOut = () => setTimeout(reset, 60);

    vv?.addEventListener('resize', onVvChange);
    vv?.addEventListener('scroll', onVvChange);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', () => setTimeout(reset, 120));
    // لود اول
    reset();

    return () => {
      vv?.removeEventListener('resize', onVvChange);
      vv?.removeEventListener('scroll', onVvChange);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return null;
}
