'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MessageDto } from '@karamooziyar/shared';
import { formatDayLabel } from '@/lib/utils';

interface UseChatScrollOpts {
  canLoadMore: boolean;
  loadMore: () => void | Promise<void>;
  isLoadingMore: boolean;
}

/**
 * منطق مشترک اسکرول چت (کاربر و ادمین):
 *  - بارگذاری اول: همیشه روی آخرین پیام می‌نشیند (با re-anchor بعد از لود تصاویر/فونت)
 *  - بارگذاری پیام‌های قدیمی‌تر: موقعیت اسکرول حفظ می‌شود (بدون پرش)
 *  - پیام تازه: اگر کاربر ته چت باشد، خودکار پایین می‌رود
 *  - برچسب تاریخ شناور بالای چت (به سبک تلگرام) که هنگام اسکرول ظاهر می‌شود
 */
export function useChatScroll(messages: MessageDto[], opts: UseChatScrollOpts) {
  const { canLoadMore, loadMore, isLoadingMore } = opts;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevScrollHeightRef = useRef(0);
  const isFirstLoadRef = useRef(true);
  const autoScrollRef = useRef(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stickyLabel, setStickyLabel] = useState('');
  const [showSticky, setShowSticky] = useState(false);

  const scrollToBottom = useCallback((container: HTMLDivElement) => {
    container.scrollTop = container.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) return;

    if (isFirstLoadRef.current) {
      isFirstLoadRef.current = false;
      // فوری + دوباره بعد از چیدمان نهایی (تصاویر/فونت دیرتر ارتفاع را تغییر می‌دهند)
      scrollToBottom(container);
      requestAnimationFrame(() => scrollToBottom(container));
      setTimeout(() => scrollToBottom(container), 150);
    } else if (prevScrollHeightRef.current > 0) {
      // پیام‌های قدیمی prepend شدند → موقعیت دید را ثابت نگه دار
      container.scrollTop = container.scrollHeight - prevScrollHeightRef.current;
      prevScrollHeightRef.current = 0;
    } else if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, scrollToBottom]);

  const computeSticky = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top;
    for (const msg of messages) {
      const el = messageRefs.current.get(msg.id);
      if (!el) continue;
      if (el.getBoundingClientRect().bottom > top + 4) {
        setStickyLabel(formatDayLabel(msg.createdAt));
        return;
      }
    }
  }, [messages]);

  const flashSticky = useCallback(() => {
    setShowSticky(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowSticky(false), 1400);
  }, []);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      computeSticky();
      flashSticky();
      if (el.scrollTop < 80 && canLoadMore && !isLoadingMore) {
        prevScrollHeightRef.current = el.scrollHeight;
        void loadMore();
      }
    },
    [canLoadMore, isLoadingMore, loadMore, computeSticky, flashSticky],
  );

  const handleLoadMoreClick = useCallback(() => {
    if (scrollContainerRef.current) prevScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
    void loadMore();
  }, [loadMore]);

  return {
    scrollContainerRef,
    bottomRef,
    messageRefs,
    onScroll,
    handleLoadMoreClick,
    stickyLabel,
    showSticky,
  };
}
