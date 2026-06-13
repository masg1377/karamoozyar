'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  SOCKET_EVENTS,
  type ConversationDetailDto,
  type ConversationSummaryDto,
  type SocketNotificationPayload,
} from '@karamooziyar/shared';
import api from '@/lib/api-client';
import { useSocketEvent } from '@/hooks/useSocket';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { useNotificationStore } from '@/store/notification.store';
import { ensurePushSubscription } from '@/lib/push-client';

interface NotificationsProviderProps {
  role: 'USER' | 'ADMIN';
}

/**
 * شنونده سراسری اعلان‌ها — در layout کاربر و ادمین mount می‌شود.
 *  - پیام جدید (وقتی داخل همان گفتگو نیستیم) → toast + زنگوله
 *  - اطلاعیه جدید (فقط کارآموز) → toast + زنگوله
 *  - همگام‌سازی زنده badge پیام‌های خوانده‌نشده (هدر + منوی پایین) در کل اپ
 *  - seed لیست زنگوله از خوانده‌نشده‌های موجود (بعد از رفرش هم خالی نباشد)
 *  - با seen شدن گفتگو، اعلان همان گفتگو از زنگوله پاک می‌شود
 *  - ثبت service worker و اشتراک وب‌پوش (اگر مجوز از قبل داده شده)
 */
export function NotificationsProvider({ role }: NotificationsProviderProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const add = useNotificationStore((s) => s.add);
  const clearMessageNotifications = useNotificationStore((s) => s.clearMessageNotifications);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const setConversations = useChatStore((s) => s.setConversations);

  // SW را همیشه ثبت کن؛ اشتراک push فقط اگر مجوز از قبل granted باشد
  // (درخواست مجوز نیازمند user gesture است — از پنل زنگوله انجام می‌شود)
  useEffect(() => {
    void ensurePushSubscription(false);
  }, []);

  // ── بارگذاری اولیه: badge ها + seed لیست زنگوله از خوانده‌نشده‌ها ──
  useEffect(() => {
    const seedAllowed = useNotificationStore.getState().items.length === 0;

    if (role === 'ADMIN') {
      api
        .get<{ data: { data: ConversationSummaryDto[] } }>('/conversations?page=1&limit=100')
        .then((res) => {
          const convs = res.data.data.data;
          setConversations(convs);
          if (!seedAllowed) return;
          convs
            .filter((c) => c.unreadByAdmin > 0)
            .forEach((c) =>
              add({
                type: 'message',
                title: `${c.user.firstName} ${c.user.lastName}`,
                body: `${c.unreadByAdmin.toLocaleString('fa-IR')} پیام خوانده‌نشده`,
                href: `/admin/conversations/${c.id}`,
                conversationId: c.id,
                createdAt: c.lastMessageAt ?? new Date().toISOString(),
              }),
            );
        })
        .catch(() => undefined);
    } else {
      api
        .get<{ data: ConversationDetailDto }>('/conversations/mine')
        .then((res) => {
          const c = res.data.data;
          // Detail → شکل Summary برای chat store (badge ها از همین store می‌خوانند)
          updateConversation({
            id: c.id,
            user: {
              id: c.userId,
              firstName: user?.firstName ?? '',
              lastName: user?.lastName ?? '',
              avatarUrl: user?.avatarUrl ?? null,
              profileImageUrl: null,
            },
            lastMessageText: null,
            lastMessageAt: null,
            unreadByAdmin: c.unreadByAdmin,
            unreadByUser: c.unreadByUser,
          } as ConversationSummaryDto);
          if (seedAllowed && c.unreadByUser > 0) {
            add({
              type: 'message',
              title: 'مدیریت مرکز',
              body: `${c.unreadByUser.toLocaleString('fa-IR')} پیام خوانده‌نشده`,
              href: '/chat',
              conversationId: c.id,
              createdAt: new Date().toISOString(),
            });
          }
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  // ── آپدیت زنده گفتگوها + پاک کردن اعلان بعد از seen ──
  const handleConversationUpdated = useCallback(
    (conv: ConversationSummaryDto) => {
      updateConversation(conv);
      const myUnread = role === 'ADMIN' ? conv.unreadByAdmin : conv.unreadByUser;
      if (myUnread === 0) clearMessageNotifications(conv.id);
    },
    [updateConversation, clearMessageNotifications, role],
  );
  useSocketEvent<ConversationSummaryDto>(SOCKET_EVENTS.CHAT_CONVERSATION_UPDATED, handleConversationUpdated);

  /** آیا کاربر همین حالا داخل صفحه مرتبط با اعلان است؟ */
  const isViewing = useCallback(
    (n: SocketNotificationPayload): boolean => {
      const path = window.location.pathname;
      if (n.type === 'message') {
        if (role === 'ADMIN') return n.conversationId ? path === `/admin/conversations/${n.conversationId}` : false;
        return path === '/chat';
      }
      // newsletter
      return path.startsWith(role === 'ADMIN' ? '/admin/newsletter' : '/newsletter');
    },
    [role],
  );

  const handleNotification = useCallback(
    (n: SocketNotificationPayload) => {
      // اطلاعیه‌ها فقط برای کارآموز (ادمین خودش منتشرکننده است)
      if (n.type === 'newsletter' && role === 'ADMIN') return;
      // داخل همان صفحه — چت خودش پیام را زنده نشان می‌دهد
      if (isViewing(n)) return;

      const href = n.type === 'message' && role === 'ADMIN' && n.conversationId
        ? `/admin/conversations/${n.conversationId}`
        : n.href;

      add({
        type: n.type,
        title: n.title,
        body: n.body,
        href,
        conversationId: n.conversationId,
        createdAt: n.createdAt,
      });

      toast(n.title, {
        description: n.body,
        icon: n.type === 'newsletter' ? '📢' : '💬',
        duration: 4500,
        action: {
          label: 'مشاهده',
          onClick: () => router.push(href),
        },
      });
    },
    [add, isViewing, role, router],
  );

  useSocketEvent<SocketNotificationPayload>(SOCKET_EVENTS.NOTIFICATION_NEW, handleNotification);

  return null;
}
