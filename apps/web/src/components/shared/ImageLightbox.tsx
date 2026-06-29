'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Download } from 'lucide-react';

interface ImageLightboxProps {
  src: string | null;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

/**
 * Full-screen in-app image viewer. Renders the image bytes directly via an
 * <img> tag, so it works regardless of the object's Content-Disposition and
 * — crucially — inside an installed PWA (standalone) on mobile, where
 * window.open('_blank') is blocked / a no-op. Tap backdrop or ✕ to close;
 * ESC also closes on desktop.
 */
export function ImageLightbox({ src, alt, fileName, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src || typeof document === 'undefined') return null;

  return createPortal(
    <div
      dir="ltr"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 animate-in fade-in"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onClose}
    >
      {/* Top bar: download + close */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 z-10">
        <a
          href={src}
          download={fileName}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label="دانلود"
        >
          <Download className="w-5 h-5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label="بستن"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image — stop propagation so tapping the image itself doesn't close. */}
      <img
        src={src}
        alt={alt ?? fileName ?? 'تصویر'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-[100vw] max-h-[100vh] object-contain select-none"
      />
    </div>,
    document.body,
  );
}
