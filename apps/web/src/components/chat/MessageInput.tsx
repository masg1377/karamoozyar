'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn, generateTempId } from '@/lib/utils';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { getSocket } from '@/lib/socket-client';
import api from '@/lib/api-client';
import { SOCKET_EVENTS, FILE_LIMITS } from '@karamooziyar/shared';
import type { MessageDto } from '@karamooziyar/shared';
import { useChatStore } from '@/store/chat.store';
import { useAuthStore } from '@/store/auth.store';
import {
  Send, Mic, Paperclip, Image, X, Smile,
  Pause, Reply,
} from 'lucide-react';
import { toast } from 'sonner';
import EmojiPickerComponent from 'emoji-picker-react';

interface MessageInputProps {
  conversationId: string;
  editingMessage?: { id: string; body: string } | null;
  onCancelEdit?: () => void;
  replyingTo?: MessageDto | null;
  onCancelReply?: () => void;
  disabled?: boolean;
}

export function MessageInput({
  conversationId,
  editingMessage,
  onCancelEdit,
  replyingTo,
  onCancelReply,
  disabled,
}: MessageInputProps) {
  const socket = getSocket();
  const addMessage = useChatStore((s) => s.addMessage);
  const currentUser = useAuthStore((s) => s.user);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  // Guard: prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear typing timer and notify server on unmount
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      socket.emit(SOCKET_EVENTS.CHAT_TYPING_STOP, { conversationId });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Close emoji picker on outside click / touch
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showEmoji]);

  const toggleEmoji = () => {
    if (showEmoji) {
      setShowEmoji(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    } else {
      textareaRef.current?.blur();
      setShowEmoji(true);
    }
  };

  const { isRecording, duration, startRecording, stopRecording, cancelRecording } = useVoiceRecorder();

  // Populate textarea only when a NEW message starts being edited
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.body);
      setTimeout(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.style.height = 'auto';
          el.style.height = Math.min(el.scrollHeight, 120) + 'px';
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      }, 0);
    } else {
      setText('');
    }
  }, [editingMessage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus textarea when reply starts
  useEffect(() => {
    if (replyingTo) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [replyingTo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTyping = useCallback((typing: boolean) => {
    if (typing !== isTyping) {
      if (mountedRef.current) setIsTyping(typing);
      socket.emit(
        typing ? SOCKET_EVENTS.CHAT_TYPING_START : SOCKET_EVENTS.CHAT_TYPING_STOP,
        { conversationId },
      );
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (typing) {
      typingTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setIsTyping(false);
        socket.emit(SOCKET_EVENTS.CHAT_TYPING_STOP, { conversationId });
      }, 2000);
    }
  }, [isTyping, conversationId, socket]);

  const sendTextMessage = async () => {
    const body = text.trim();
    if (!body || sending) return;

    // Socket.IO buffers emits automatically when disconnected and flushes on reconnect.
    if (editingMessage) {
      socket.emit(SOCKET_EVENTS.CHAT_EDIT, { messageId: editingMessage.id, body });
      onCancelEdit?.();
    } else {
      const tempId = generateTempId();
      socket.emit(SOCKET_EVENTS.CHAT_SEND, {
        conversationId,
        type: 'TEXT',
        body,
        tempId,
        replyToMessageId: replyingTo?.id,
      });
      // Optimistic message — shown immediately with pending (clock) indicator
      if (currentUser) {
        addMessage(conversationId, {
          id: tempId,
          conversationId,
          senderId: currentUser.id,
          senderName: `${currentUser.firstName} ${currentUser.lastName}`,
          type: 'TEXT',
          body,
          status: 'SENT',
          isEdited: false,
          editedAt: null,
          deletedAt: null,
          pinnedAt: null,
          attachment: null,
          replyToMessage: replyingTo
            ? {
                id: replyingTo.id,
                senderId: replyingTo.senderId,
                senderName: replyingTo.senderName,
                type: replyingTo.type,
                body: replyingTo.body,
                deletedAt: replyingTo.deletedAt,
                attachment: replyingTo.attachment
                  ? { fileName: replyingTo.attachment.fileName, mimeType: replyingTo.attachment.mimeType }
                  : null,
              }
            : null,
          createdAt: new Date().toISOString(),
          pending: true,
        });
      }
      onCancelReply?.();
    }
    if (mountedRef.current) {
      setText('');
      handleTyping(false);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
  };

  /** Wait up to `ms` milliseconds for socket to connect; resolves true if connected in time */
  const waitForSocket = (ms = 8000): Promise<boolean> =>
    new Promise((resolve) => {
      if (socket.connected) return resolve(true);
      const timer = setTimeout(() => { socket.off('connect', onConnect); resolve(false); }, ms);
      const onConnect = () => { clearTimeout(timer); resolve(true); };
      socket.once('connect', onConnect);
    });

  const sendFileMessage = async (file: File, type: 'IMAGE' | 'FILE') => {
    if (file.size > FILE_LIMITS.MAX_SIZE_BYTES) {
      toast.error(`حداکثر حجم فایل ${FILE_LIMITS.MAX_SIZE_MB} مگابایت است`);
      return;
    }
    if (!socket.connected) {
      toast.loading('در حال اتصال مجدد...', { id: 'reconnect' });
      const ok = await waitForSocket();
      toast.dismiss('reconnect');
      if (!ok) { toast.error('اتصال برقرار نشد. دوباره امتحان کنید'); return; }
    }
    if (mountedRef.current) setSending(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: import('@karamooziyar/shared').UploadResponseDto }>(
        `/uploads/message-attachment?conversationId=${conversationId}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const upload = res.data.data;
      socket.emit(SOCKET_EVENTS.CHAT_SEND, {
        conversationId,
        type,
        fileKey: upload.fileKey,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        tempId: generateTempId(),
        replyToMessageId: replyingTo?.id,
      });
      if (mountedRef.current) onCancelReply?.();
      toast.success('فایل ارسال شد');
    } catch {
      toast.error('ارسال فایل ناموفق بود');
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const sendVoiceMessage = async () => {
    const recording = await stopRecording();
    if (!recording) return;
    if (!socket.connected) {
      toast.loading('در حال اتصال مجدد...', { id: 'reconnect' });
      const ok = await waitForSocket();
      toast.dismiss('reconnect');
      if (!ok) { toast.error('اتصال برقرار نشد. دوباره امتحان کنید'); return; }
    }
    if (mountedRef.current) setSending(true);
    try {
      const file = new File([recording.blob], `voice_${Date.now()}.ogg`, { type: recording.mimeType });
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: import('@karamooziyar/shared').UploadResponseDto }>(
        `/uploads/message-attachment?conversationId=${conversationId}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const upload = res.data.data;
      socket.emit(SOCKET_EVENTS.CHAT_SEND, {
        conversationId,
        type: 'VOICE',
        fileKey: upload.fileKey,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        fileSize: upload.fileSize,
        tempId: generateTempId(),
        replyToMessageId: replyingTo?.id,
      });
      if (mountedRef.current) onCancelReply?.();
    } catch {
      toast.error('ارسال پیام صوتی ناموفق بود');
    } finally {
      if (mountedRef.current) setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendTextMessage();
    }
  };

  const canSendText = text.trim().length > 0;

  // Preview text for reply bar
  const replyPreviewText = replyingTo
    ? replyingTo.attachment
      ? replyingTo.attachment.fileName
      : replyingTo.body ?? '…'
    : '';

  return (
    <div className="relative w-full bg-white border-t border-gray-100">
      {/* Reply bar */}
      {replyingTo && (
        <div className="flex items-center gap-3 px-4 py-2 bg-primary-50 border-b border-primary-100">
          <Reply className="w-4 h-4 text-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-primary-600 font-semibold">{replyingTo.senderName}</p>
            <p className="text-xs text-gray-500 truncate">{replyPreviewText}</p>
          </div>
          <button onClick={onCancelReply} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit banner */}
      {editingMessage && (
        <div className="flex items-center justify-between px-4 py-2 bg-primary-50 border-b border-primary-100">
          <span className="text-xs text-primary-700 font-medium">در حال ویرایش پیام</span>
          <button onClick={onCancelEdit} className="text-primary-600 hover:text-primary-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div
          ref={emojiPickerRef}
          className="absolute bottom-full left-0 right-0 z-50 flex justify-end px-3 pb-1"
        >
          <EmojiPickerComponent
            onEmojiClick={(e) => {
              setText((prev) => prev + e.emoji);
            }}
            previewConfig={{ showPreview: false }}
            searchPlaceholder="جستجو..."
            width="100%"
            height={380}
          />
        </div>
      )}

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border-b border-red-100">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          <span className="text-sm text-red-600 font-medium">در حال ضبط... {duration}ث</span>
          <button onClick={cancelRecording} className="mr-auto text-gray-500 hover:text-red-500">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        {/* Emoji */}
        <button
          onClick={toggleEmoji}
          className={cn(
            'w-9 h-9 flex items-center justify-center transition-colors rounded-xl flex-shrink-0',
            showEmoji
              ? 'text-primary-600 bg-primary-50'
              : 'text-gray-400 hover:text-primary-600 hover:bg-gray-100',
          )}
        >
          <Smile className="w-5 h-5" />
        </button>

        {/* Textarea */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleTyping(e.target.value.length > 0);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (showEmoji) setShowEmoji(false); }}
            onBlur={() => handleTyping(false)}
            placeholder="ارسال پیام..."
            rows={1}
            disabled={disabled || isRecording}
            className="w-full resize-none bg-gray-50 rounded-2xl px-4 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary-200 transition-all max-h-32 leading-relaxed block"
          />
        </div>

        {/* Attachments */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => imageInputRef.current?.click()}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-primary-600 transition-colors rounded-xl hover:bg-gray-100"
            disabled={disabled || isRecording}
          >
            <Image className="w-5 h-5" />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-primary-600 transition-colors rounded-xl hover:bg-gray-100"
            disabled={disabled || isRecording}
          >
            <Paperclip className="w-5 h-5" />
          </button>
        </div>

        {/* Send / Voice */}
        {canSendText ? (
          <button
            onClick={sendTextMessage}
            disabled={sending}
            className="w-9 h-9 bg-primary-600 hover:bg-primary-700 text-white rounded-full flex items-center justify-center transition-colors flex-shrink-0 shadow-sm disabled:opacity-50"
          >
            <Send className="w-4 h-4 -rotate-90 translate-x-0.5" />
          </button>
        ) : isRecording ? (
          <button
            onClick={sendVoiceMessage}
            disabled={sending}
            className="w-9 h-9 bg-green-500 hover:bg-green-600 text-white rounded-full flex items-center justify-center transition-colors flex-shrink-0 shadow-sm"
          >
            <Send className="w-4 h-4 -rotate-90 translate-x-0.5" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="w-9 h-9 bg-gray-100 hover:bg-primary-100 text-gray-500 hover:text-primary-600 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
          >
            <Mic className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void sendFileMessage(file, 'IMAGE');
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void sendFileMessage(file, 'FILE');
          e.target.value = '';
        }}
      />
    </div>
  );
}
