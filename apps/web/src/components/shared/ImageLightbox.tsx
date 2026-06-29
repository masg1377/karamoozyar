'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

const MAX_SCALE = 4;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
type Pt = { clientX: number; clientY: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * Full-screen in-app image viewer.
 *
 * Why custom: the app's viewport sets `user-scalable=no`, so native pinch-zoom
 * is disabled. We re-implement pinch / double-tap / pan via transforms. The
 * image is rendered with an <img> tag (loads regardless of Content-Disposition)
 * so it works inside an installed PWA on iOS, where window.open('_blank') and
 * navigations to download URLs are blocked.
 */
export function ImageLightbox({ src, alt, fileName, onClose }: ImageLightboxProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  // Live transform kept in a ref → mutated directly during gestures (no re-render jank).
  const tf = useRef({ scale: 1, x: 0, y: 0 });
  const gesture = useRef<{
    mode: 'idle' | 'pan' | 'pinch';
    startDist: number;
    startScale: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: number;
    time: number;
  } | null>(null);
  const lastTap = useRef(0);
  const [zoomed, setZoomed] = useState(false);

  const apply = useCallback((animate = false) => {
    const el = imgRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.18s ease-out' : 'none';
    const { scale, x, y } = tf.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }, []);

  const setScale = useCallback((s: number, animate = false) => {
    tf.current.scale = clamp(s, 1, MAX_SCALE);
    if (tf.current.scale === 1) {
      tf.current.x = 0;
      tf.current.y = 0;
    }
    apply(animate);
    setZoomed(tf.current.scale > 1);
  }, [apply]);

  // Reset transform whenever a new image opens.
  useEffect(() => {
    tf.current = { scale: 1, x: 0, y: 0 };
    setZoomed(false);
    apply();
  }, [src, apply]);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gesture.current = {
        mode: 'pinch',
        startDist: dist(e.touches[0]!, e.touches[1]!),
        startScale: tf.current.scale,
        startX: 0, startY: 0, origX: tf.current.x, origY: tf.current.y, moved: 0, time: Date.now(),
      };
    } else if (e.touches.length === 1) {
      const t = e.touches[0]!;
      gesture.current = {
        mode: tf.current.scale > 1 ? 'pan' : 'idle',
        startDist: 0, startScale: tf.current.scale,
        startX: t.clientX, startY: t.clientY,
        origX: tf.current.x, origY: tf.current.y,
        moved: 0, time: Date.now(),
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const d = dist(e.touches[0]!, e.touches[1]!);
      tf.current.scale = clamp(g.startScale * (d / g.startDist), 1, MAX_SCALE);
      apply();
    } else if (e.touches.length === 1) {
      const t = e.touches[0]!;
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      if (g.mode === 'pan') {
        e.preventDefault();
        tf.current.x = g.origX + dx;
        tf.current.y = g.origY + dy;
        apply();
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;

    if (g.mode === 'pinch') {
      // Snap back to fit if a pinch left us at/under 1×.
      if (tf.current.scale <= 1) setScale(1, true);
      else setZoomed(true);
      return;
    }

    const wasTap = g.moved < 10 && Date.now() - g.time < 250 && e.touches.length === 0;
    if (wasTap) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double-tap: toggle zoom.
        lastTap.current = 0;
        setScale(tf.current.scale > 1 ? 1 : 2.5, true);
      } else {
        lastTap.current = now;
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale(tf.current.scale * (e.deltaY < 0 ? 1.15 : 0.87));
  };

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!src) return;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const name = fileName || 'image.jpg';
      const type = blob.type || 'image/jpeg';
      const file = new File([blob], name, { type });
      // iOS PWA: the native share sheet ("Save Image" / "Save to Files") is the
      // only reliable save path — downloads + new tabs are blocked there.
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file] });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Last resort (e.g. bucket CORS not set): open the raw URL.
      window.open(src, '_blank');
    }
  }, [src, fileName]);

  if (!src || typeof document === 'undefined') return null;

  return createPortal(
    <div
      dir="ltr"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/95 overscroll-none"
      onClick={onClose}
    >
      {/* Top bar — pushed below the device safe area (notch / status bar). */}
      <div
        className="absolute inset-x-0 flex items-center justify-between px-4 z-10"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 16px)',
          paddingRight: 'calc(env(safe-area-inset-right, 0px) + 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleDownload}
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
          aria-label="دانلود / ذخیره"
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/30 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
          aria-label="بستن"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image — gestures handled manually; stop propagation so taps/pans on the
          image don't close the viewer. Long-press still works on iOS to "Save Image". */}
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? fileName ?? 'تصویر'}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); setScale(tf.current.scale > 1 ? 1 : 2.5, true); }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
        className="max-w-[100vw] max-h-[100dvh] object-contain"
        style={{
          touchAction: 'none',
          cursor: zoomed ? 'grab' : 'zoom-in',
          WebkitTouchCallout: 'default',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
      />
    </div>,
    document.body,
  );
}
