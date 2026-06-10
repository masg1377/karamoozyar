'use client';

import { useRef, useCallback } from 'react';
import type { MessageDto } from '@karamooziyar/shared';

/**
 * useSwipeToReply — RTL-aware swipe/drag to reply hook.
 *
 * In Persian RTL layout:
 *  - "isMine" bubbles are on the LEFT  → drag RIGHT  (positive deltaX) to reply
 *  - "other" bubbles  are on the RIGHT → drag LEFT   (negative deltaX) to reply
 *
 * Touch (mobile) and mouse (desktop) are both supported.
 * Visual feedback is applied directly to the wrapper element via style mutations so
 * no re-renders happen during the drag — only the final "trigger" causes a state update.
 */

const THRESHOLD = 60; // px — drag distance to trigger reply

interface SwipeHandlers {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd: () => void;
}

export function useSwipeToReply(
  message: MessageDto,
  isMine: boolean,
  onReply: ((msg: MessageDto) => void) | undefined,
  wrapperRef: React.RefObject<HTMLDivElement | null>,
  iconRef: React.RefObject<HTMLDivElement | null>,
): SwipeHandlers {
  const startXRef = useRef<number>(0);
  const currentXRef = useRef<number>(0);
  const draggingRef = useRef(false);
  const triggeredRef = useRef(false);

  const applyVisual = useCallback(
    (delta: number) => {
      const wrapper = wrapperRef.current;
      const icon = iconRef.current;
      if (!wrapper || !icon) return;

      // Clamp movement: max THRESHOLD px in the allowed direction
      const clampedDelta = isMine
        ? Math.max(0, Math.min(delta, THRESHOLD))       // right drag (positive)
        : Math.max(-THRESHOLD, Math.min(delta, 0));     // left drag (negative)

      const progress = Math.abs(clampedDelta) / THRESHOLD; // 0–1

      // Translate the bubble
      wrapper.style.transform = `translateX(${clampedDelta}px)`;
      wrapper.style.transition = 'none';

      // Show reply icon
      icon.style.opacity = String(progress);
      icon.style.transform = `scale(${0.5 + progress * 0.5})`;

      // Background highlight
      const alpha = progress * 0.12;
      wrapper.style.backgroundColor = `rgba(59,130,246,${alpha})`;
    },
    [isMine, wrapperRef, iconRef],
  );

  const resetVisual = useCallback(() => {
    const wrapper = wrapperRef.current;
    const icon = iconRef.current;
    if (!wrapper || !icon) return;

    wrapper.style.transform = 'translateX(0)';
    wrapper.style.transition = 'transform 0.2s ease, background-color 0.2s ease';
    wrapper.style.backgroundColor = '';

    icon.style.opacity = '0';
    icon.style.transform = 'scale(0.5)';
  }, [wrapperRef, iconRef]);

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;

    const delta = currentXRef.current - startXRef.current;
    const triggered =
      !triggeredRef.current &&
      onReply &&
      (isMine ? delta >= THRESHOLD : delta <= -THRESHOLD);

    resetVisual();

    if (triggered) {
      triggeredRef.current = true;
      // Vibrate on mobile for haptic feedback
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
      onReply!(message);
    }

    triggeredRef.current = false;
  }, [isMine, message, onReply, resetVisual]);

  // ── Touch handlers ──────────────────────────────────────────────────────────

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!onReply) return;
    startXRef.current = e.touches[0]!.clientX;
    currentXRef.current = e.touches[0]!.clientX;
    draggingRef.current = true;
    triggeredRef.current = false;
  }, [onReply]);

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!draggingRef.current || !onReply) return;
      currentXRef.current = e.touches[0]!.clientX;
      const delta = currentXRef.current - startXRef.current;

      // Only intercept horizontal swipes; let vertical scrolling pass through
      if (Math.abs(delta) < 5) return;

      const isHorizontal = isMine ? delta > 0 : delta < 0;
      if (!isHorizontal) {
        resetVisual();
        draggingRef.current = false;
        return;
      }

      applyVisual(delta);

      // Trigger early (at threshold) so the user gets instant feedback
      if (!triggeredRef.current && Math.abs(delta) >= THRESHOLD) {
        triggeredRef.current = true;
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        onReply!(message);
        resetVisual();
        draggingRef.current = false;
      }
    },
    [applyVisual, isMine, message, onReply, resetVisual],
  );

  const onTouchEnd = useCallback(() => endDrag(), [endDrag]);

  // ── Mouse handlers (desktop) ────────────────────────────────────────────────

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onReply) return;
      // Only primary button
      if (e.button !== 0) return;

      startXRef.current = e.clientX;
      currentXRef.current = e.clientX;
      draggingRef.current = true;
      triggeredRef.current = false;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        currentXRef.current = ev.clientX;
        const delta = currentXRef.current - startXRef.current;
        const isHorizontal = isMine ? delta > 0 : delta < 0;
        if (!isHorizontal) {
          resetVisual();
          return;
        }
        applyVisual(delta);
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        endDrag();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [applyVisual, endDrag, isMine, onReply, resetVisual],
  );

  return { onMouseDown, onTouchStart, onTouchMove, onTouchEnd };
}
