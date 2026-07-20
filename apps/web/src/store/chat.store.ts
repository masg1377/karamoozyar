'use client';

import { create } from 'zustand';
import type { ConversationSummaryDto } from '@karamooziyar/shared';
import {
  type ClientMessage,
  type DeliveryState,
  reconcileMessage,
  mergeServerMessages,
  identityKey,
} from '@/lib/message-merge';

// ChatMessage carries the optimistic delivery state alongside the server DTO.
export type ChatMessage = ClientMessage;

interface ChatState {
  conversations: ConversationSummaryDto[];
  messages: Record<string, ChatMessage[]>; // conversationId → messages
  typingUsers: Record<string, Set<string>>; // conversationId → userIds typing
  hasMore: Record<string, boolean>;
  nextCursor: Record<string, string | null>;

  setConversations: (convs: ConversationSummaryDto[]) => void;
  /** Append a freshly fetched page (infinite scroll), de-duped by id. */
  appendConversations: (convs: ConversationSummaryDto[]) => void;
  updateConversation: (conv: ConversationSummaryDto) => void;
  /** Merge a freshly fetched page; preserves pending/failed local items. */
  mergeMessages: (conversationId: string, msgs: ChatMessage[], nextCursor: string | null) => void;
  prependMessages: (conversationId: string, msgs: ChatMessage[], nextCursor: string | null) => void;
  /** Insert an optimistic outgoing message (id === clientMessageId). */
  insertOptimistic: (conversationId: string, msg: ChatMessage) => void;
  /** Reconcile a confirmed/incoming server message (dedup by identity). */
  reconcile: (conversationId: string, msg: ChatMessage) => void;
  /** Move an outgoing message to a new delivery state, matched by clientMessageId. */
  setDeliveryState: (conversationId: string, clientMessageId: string, state: DeliveryState) => void;
  updateMessage: (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  typingUsers: {},
  hasMore: {},
  nextCursor: {},

  setConversations: (convs) => set({ conversations: convs }),

  appendConversations: (convs) =>
    set((state) => {
      const seen = new Set(state.conversations.map((c) => c.id));
      const fresh = convs.filter((c) => !seen.has(c.id));
      return { conversations: [...state.conversations, ...fresh] };
    }),

  updateConversation: (conv) =>
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conv.id);
      const updated = [...state.conversations];
      if (idx >= 0) {
        updated[idx] = conv;
      } else {
        updated.unshift(conv);
      }
      updated.sort((a, b) => {
        if (!a.lastMessageAt) return 1;
        if (!b.lastMessageAt) return -1;
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });
      return { conversations: updated };
    }),

  mergeMessages: (conversationId, msgs, nextCursor) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: mergeServerMessages(state.messages[conversationId] ?? [], msgs),
      },
      nextCursor: { ...state.nextCursor, [conversationId]: nextCursor },
      hasMore: { ...state.hasMore, [conversationId]: nextCursor !== null },
    })),

  prependMessages: (conversationId, msgs, nextCursor) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      // Guard against re-prepending an already-present page (dedup by identity).
      const have = new Set(existing.map(identityKey));
      const fresh = msgs.filter((m) => !have.has(identityKey(m)));
      return {
        messages: { ...state.messages, [conversationId]: [...fresh, ...existing] },
        nextCursor: { ...state.nextCursor, [conversationId]: nextCursor },
        hasMore: { ...state.hasMore, [conversationId]: nextCursor !== null },
      };
    }),

  insertOptimistic: (conversationId, msg) =>
    set((state) => ({
      messages: {
        ...state.messages,
        // reconcileMessage de-dups if (somehow) the same clientMessageId already exists,
        // and preserves the explicit optimistic state.
        [conversationId]: reconcileMessage(
          state.messages[conversationId] ?? [],
          msg,
          msg.deliveryState,
        ),
      },
    })),

  reconcile: (conversationId, msg) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: reconcileMessage(state.messages[conversationId] ?? [], msg),
      },
    })),

  setDeliveryState: (conversationId, clientMessageId, deliveryState) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.clientMessageId === clientMessageId || m.id === clientMessageId
            ? { ...m, deliveryState }
            : m,
        ),
      },
    })),

  updateMessage: (conversationId, messageId, patch) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        ),
      },
    })),

  removeMessage: (conversationId, messageId) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).filter((m) => m.id !== messageId),
      },
    })),

  setTyping: (conversationId, userId, isTyping) =>
    set((state) => {
      const current = new Set(state.typingUsers[conversationId] ?? []);
      if (isTyping) current.add(userId);
      else current.delete(userId);
      return { typingUsers: { ...state.typingUsers, [conversationId]: current } };
    }),
}));
