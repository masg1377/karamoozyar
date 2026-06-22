'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat.store';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import type { CursorPaginatedResponse, MessageDto, ConversationSummaryDto } from '@karamooziyar/shared';
import { SOCKET_EVENTS } from '@karamooziyar/shared';

export function useMessages(conversationId: string) {
  const { messages, hasMore, nextCursor, setMessages, prependMessages, addMessage, replacePendingMessage, updateMessage, removeMessage, setTyping } =
    useChatStore();
  const socket = getSocket();
  const isInitialized = useRef(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const msgs = messages[conversationId] ?? [];
  const canLoadMore = hasMore[conversationId] ?? false;
  const cursor = nextCursor[conversationId] ?? null;

  const loadInitial = useCallback(async () => {
    if (!conversationId) return;
    try {
      const res = await api.get<{ data: CursorPaginatedResponse<MessageDto> }>(
        `/conversations/${conversationId}/messages`,
        { params: { limit: 30 } },
      );
      const { data: items, nextCursor: nc } = res.data.data;
      // API returns newest-first; reverse for display
      setMessages(conversationId, [...items].reverse(), nc);
    } catch {
      // handled by global error handler
    }
  }, [conversationId, setMessages]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore || !cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get<{ data: CursorPaginatedResponse<MessageDto> }>(
        `/conversations/${conversationId}/messages`,
        { params: { cursor, limit: 30 } },
      );
      const { data: items, nextCursor: nc } = res.data.data;
      prependMessages(conversationId, [...items].reverse(), nc);
    } catch {
      // silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversationId, canLoadMore, cursor, isLoadingMore, prependMessages]);

  useEffect(() => {
    if (!conversationId || isInitialized.current) return;
    isInitialized.current = true;

    socket.emit(SOCKET_EVENTS.CHAT_JOIN, { conversationId });
    void loadInitial();

    // Socket listeners
    const onNewMessage = (msg: MessageDto & { tempId?: string }) => {
      if (msg.conversationId !== conversationId) return;
      if (msg.tempId) {
        // Replace the optimistic pending message with the confirmed one
        replacePendingMessage(conversationId, msg.tempId, msg);
      } else {
        addMessage(conversationId, msg);
      }
    };
    const onUpdated = (data: { messageId: string; body: string; editedAt: string }) => {
      updateMessage(conversationId, data.messageId, { body: data.body, isEdited: true, editedAt: data.editedAt });
    };
    const onDeleted = (data: { messageId: string }) => {
      removeMessage(conversationId, data.messageId);
    };
    const onTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId === conversationId) setTyping(conversationId, data.userId, data.isTyping);
    };
    // On reconnect: rejoin room and reload messages to catch anything missed during disconnect
    const onReconnect = () => {
      socket.emit(SOCKET_EVENTS.CHAT_JOIN, { conversationId });
      void loadInitial();
    };

    socket.on(SOCKET_EVENTS.CHAT_MESSAGE_NEW, onNewMessage);
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE_UPDATED, onUpdated);
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, onDeleted);
    socket.on(SOCKET_EVENTS.CHAT_TYPING, onTyping);
    socket.on('connect', onReconnect);

    return () => {
      isInitialized.current = false;
      socket.emit(SOCKET_EVENTS.CHAT_LEAVE, { conversationId });
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_NEW, onNewMessage);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, onDeleted);
      socket.off(SOCKET_EVENTS.CHAT_TYPING, onTyping);
      socket.off('connect', onReconnect);
    };
  }, [conversationId, socket, loadInitial, addMessage, replacePendingMessage, updateMessage, removeMessage, setTyping]);

  return { messages: msgs, canLoadMore, loadMore, isLoadingMore };
}
