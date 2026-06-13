'use client';

import { create } from 'zustand';
import type { AppNotificationType } from '@karamooziyar/shared';

export interface AppNotification {
  id: string;
  type: AppNotificationType;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
  /** برای اعلان‌های پیام — تا با seen شدن همان گفتگو، اعلانش پاک شود */
  conversationId?: string;
}

interface NotificationState {
  items: AppNotification[];
  unreadCount: number;

  add: (n: Omit<AppNotification, 'id' | 'read'>) => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  /** حذف اعلان‌های پیامِ یک گفتگو (وقتی خوانده/سین شد) — بدون آرگومان: همه پیام‌ها */
  clearMessageNotifications: (conversationId?: string) => void;
  clear: () => void;
}

const MAX_ITEMS = 50;

const recount = (items: AppNotification[]) => items.filter((i) => !i.read).length;

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],
  unreadCount: 0,

  add: (n) =>
    set((state) => {
      // برای هر گفتگو فقط یک اعلانِ پیام نگه می‌داریم (جدیدترین جایگزین قبلی می‌شود)
      const base = n.type === 'message' && n.conversationId
        ? state.items.filter((i) => !(i.type === 'message' && i.conversationId === n.conversationId))
        : state.items;
      const item: AppNotification = {
        ...n,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        read: false,
      };
      const items = [item, ...base].slice(0, MAX_ITEMS);
      return { items, unreadCount: recount(items) };
    }),

  markAllRead: () =>
    set((state) => ({
      items: state.items.map((i) => ({ ...i, read: true })),
      unreadCount: 0,
    })),

  markRead: (id) =>
    set((state) => {
      const items = state.items.map((i) => (i.id === id ? { ...i, read: true } : i));
      return { items, unreadCount: recount(items) };
    }),

  clearMessageNotifications: (conversationId) =>
    set((state) => {
      const items = state.items.filter((i) =>
        i.type !== 'message' ? true : conversationId ? i.conversationId !== conversationId : false,
      );
      return { items, unreadCount: recount(items) };
    }),

  clear: () => set({ items: [], unreadCount: 0 }),
}));
