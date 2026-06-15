'use client';

import { useEffect } from 'react';

/**
 * فیکس ویوپورت iOS — دو کار انجام می‌دهد:
 *
 * ۱) ارتفاع واقعی اپ را در متغیر CSS «--app-height» می‌گذارد (از visualViewport).
 *    body با همین ارتفاع دقیق پیکسلی رندر می‌شود، نه 100%/100dvh که در iOS
 *    باگ دارد و باعث می‌شود محتوا کوتاه‌تر از صفحه شود و یک نوار خاکستری پایین
 *    بماند. (رفع «باکس خاکستری پایین اپ»)
 *
 * ۲) وقتی کیبورد باز می‌شود visualViewport کوچک می‌شود → ارتفاع اپ هم کوچک
 *    می‌شود → نوار ورودی چت بالای کیبورد قرار می‌گیرد و دیده می‌شود.
 *    (رفع «اینپوت زیر کیبورد گم می‌شود»)
 */
export function IosViewportFix() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    // فقط iOS/iPadOS — اندروید و دسکتاپ رفتار پیش‌فرض (inset:0) را نگه می‌دارند
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIos) root.classList.add('ios');

    const setAppHeight = () => {
      if (!isIos) return; // غیر iOS: متغیر را ست نکن تا body همان inset:0 بماند
      const h = vv?.height ?? window.innerHeight;
      root.style.setProperty('--app-height', `${Math.round(h)}px`);
    };

    const reset = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (root.scrollTop !== 0) root.scrollTop = 0;
    };

    const onVvChange = () => {
      setAppHeight();
      // کیبورد بسته شد (ویوپورت تقریباً برگشت به ارتفاع کامل) → اسکرول سرگردان را صفر کن
      if (!vv || vv.height >= window.innerHeight - 30) reset();
    };

    const onFocusOut = () => setTimeout(() => { setAppHeight(); reset(); }, 60);
    const onOrientation = () => setTimeout(() => { setAppHeight(); reset(); }, 250);

    setAppHeight();
    reset();

    vv?.addEventListener('resize', onVvChange);
    vv?.addEventListener('scroll', onVvChange);
    window.addEventListener('resize', setAppHeight);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('orientationchange', onOrientation);

    return () => {
      vv?.removeEventListener('resize', onVvChange);
      vv?.removeEventListener('scroll', onVvChange);
      window.removeEventListener('resize', setAppHeight);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, []);

  return null;
}
