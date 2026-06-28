'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/store/chat.store';
import type { ChatMessage } from '@/store/chat.store';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import type { CursorPaginatedResponse, MessageDto } from '@karamooziyar/shared';
import { SOCKET_EVENTS } from '@karamooziyar/shared';

export function useMessages(conversationId: string) {
  const {
    messages,
    hasMore,
    nextCursor,
    mergeMessages,
    prependMessages,
    reconcile,
    updateMessage,
    removeMessage,
    setTyping,
  } = useChatStore();
  const socket = getSocket();
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
      // API returns newest-first; reverse for display, then MERGE so any
      // pending/failed optimistic messages survive (never blindly overwrite).
      mergeMessages(conversationId, [...items].reverse() as ChatMessage[], nc);
    } catch {
      // handled by global error handler
    }
  }, [conversationId, mergeMessages]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore || !cursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get<{ data: CursorPaginatedResponse<MessageDto> }>(
        `/conversations/${conversationId}/messages`,
        { params: { cursor, limit: 30 } },
      );
      const { data: items, nextCursor: nc } = res.data.data;
      prependMessages(conversationId, [...items].reverse() as ChatMessage[], nc);
    } catch {
      // silent
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversationId, canLoadMore, cursor, isLoadingMore, prependMessages]);

  useEffect(() => {
    if (!conversationId) return;

    socket.emit(SOCKET_EVENTS.CHAT_JOIN, { conversationId });
    void loadInitial();

    // ── Scoped, stable listeners. Each reads the live conversationId from this
    // effect closure; the effect re-runs (with clean teardown) when it changes,
    // so events for an old conversation can never mutate the current one. ──
    const onNewMessage = (msg: MessageDto) => {
      if (msg.conversationId !== conversationId) return;
      // Dedup by clientMessageId/server id — safe against self-echo, ack/broadcast
      // races, and reconnect replays.
      reconcile(conversationId, msg as ChatMessage);
    };
    const onUpdated = (data: { messageId: string; body: string; editedAt: string }) => {
      updateMessage(conversationId, data.messageId, {
        body: data.body,
        isEdited: true,
        editedAt: data.editedAt,
      });
    };
    const onDeleted = (data: { messageId: string }) => {
      removeMessage(conversationId, data.messageId);
    };
    const onTyping = (data: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (data.conversationId === conversationId) setTyping(conversationId, data.userId, data.isTyping);
    };
    // On (re)connect: rejoin the room and re-sync missed messages via a MERGE
    // (mergeMessages preserves pending/failed locals, dedups confirmed ones).
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
      socket.emit(SOCKET_EVENTS.CHAT_LEAVE, { conversationId });
      // Remove ONLY the handlers this scope registered (never removeAllListeners).
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_NEW, onNewMessage);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_UPDATED, onUpdated);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE_DELETED, onDeleted);
      socket.off(SOCKET_EVENTS.CHAT_TYPING, onTyping);
      socket.off('connect', onReconnect);
    };
  }, [conversationId, socket, loadInitial, reconcile, updateMessage, removeMessage, setTyping]);

  return { messages: msgs, canLoadMore, loadMore, isLoadingMore };
}
