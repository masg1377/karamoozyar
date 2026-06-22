'use client';

import { create } from 'zustand';
import type { MessageDto, ConversationSummaryDto } from '@karamooziyar/shared';

// Extends MessageDto with client-only `pending` flag for optimistic sends
export type ChatMessage = MessageDto & { pending?: boolean };

interface ChatState {
  conversations: ConversationSummaryDto[];
  messages: Record<string, ChatMessage[]>; // conversationId → messages
  typingUsers: Record<string, Set<string>>; // conversationId → userIds typing
  hasMore: Record<string, boolean>;
  nextCursor: Record<string, string | null>;

  setConversations: (convs: ConversationSummaryDto[]) => void;
  updateConversation: (conv: ConversationSummaryDto) => void;
  setMessages: (conversationId: string, msgs: ChatMessage[], nextCursor: string | null) => void;
  prependMessages: (conversationId: string, msgs: ChatMessage[], nextCursor: string | null) => void;
  addMessage: (conversationId: string, msg: ChatMessage) => void;
  /** Replace the optimistic pending message (id === tempId) with the confirmed message from server */
  replacePendingMessage: (conversationId: string, tempId: string, msg: ChatMessage) => void;
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

  setMessages: (conversationId, msgs, nextCursor) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: msgs },
      nextCursor: { ...state.nextCursor, [conversationId]: nextCursor },
      hasMore: { ...state.hasMore, [conversationId]: nextCursor !== null },
    })),

  prependMessages: (conversationId, msgs, nextCursor) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...msgs, ...(state.messages[conversationId] ?? [])],
      },
      nextCursor: { ...state.nextCursor, [conversationId]: nextCursor },
      hasMore: { ...state.hasMore, [conversationId]: nextCursor !== null },
    })),

  addMessage: (conversationId, msg) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] ?? []), msg],
      },
    })),

  replacePendingMessage: (conversationId, tempId, msg) =>
    set((state) => {
      const list = state.messages[conversationId] ?? [];
      const idx = list.findIndex((m) => m.id === tempId);
      if (idx >= 0) {
        // Replace in-place so the message doesn't jump
        const updated = [...list];
        updated[idx] = { ...msg, pending: false };
        return { messages: { ...state.messages, [conversationId]: updated } };
      }
      // No pending match — just append (e.g. received from other session)
      return { messages: { ...state.messages, [conversationId]: [...list, msg] } };
    }),

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
