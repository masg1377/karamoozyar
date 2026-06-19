export const FILE_LIMITS = {
  MAX_SIZE_BYTES: 14 * 1024 * 1024, // 14 MB
  MAX_SIZE_MB: 14,
} as const;

export const ALLOWED_MIME_TYPES = [
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  // Audio (voice messages)
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/wav',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  // Text
  'text/plain',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export const VOICE_MIME_TYPES = [
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/webm',
  'audio/wav',
] as const;

export const SOCKET_EVENTS = {
  // Client → Server
  CHAT_JOIN: 'chat:join',
  CHAT_LEAVE: 'chat:leave',
  CHAT_SEND: 'chat:send',
  CHAT_TYPING_START: 'chat:typing:start',
  CHAT_TYPING_STOP: 'chat:typing:stop',
  CHAT_SEEN: 'chat:seen',
  CHAT_EDIT: 'chat:edit',
  CHAT_DELETE: 'chat:delete',

  NEWSLETTER_JOIN: 'newsletter:join',
  NEWSLETTER_SEEN: 'newsletter:seen',
  NEWSLETTER_REACT: 'newsletter:react',
  NEWSLETTER_REACT_REMOVE: 'newsletter:react:remove',

  // Server → Client
  CHAT_MESSAGE_NEW: 'chat:message:new',
  CHAT_MESSAGE_UPDATED: 'chat:message:updated',
  CHAT_MESSAGE_DELETED: 'chat:message:deleted',
  CHAT_MESSAGE_SEEN: 'chat:message:seen',
  CHAT_MESSAGE_PINNED: 'chat:message:pinned',   // broadcast when a message is pinned or unpinned
  CHAT_TYPING: 'chat:typing',
  CHAT_CONVERSATION_UPDATED: 'chat:conversation:updated',
  CHAT_ERROR: 'chat:error',

  NEWSLETTER_POST_NEW: 'newsletter:post:new',
  NEWSLETTER_POST_UPDATED: 'newsletter:post:updated',
  NEWSLETTER_POST_DELETED: 'newsletter:post:deleted',
  NEWSLETTER_REACTION_UPDATED: 'newsletter:reaction:updated',
  NEWSLETTER_SEEN_UPDATED: 'newsletter:seen:updated',

  NOTIFICATION_UNREAD: 'notification:unread',
  NOTIFICATION_BADGE: 'notification:badge',
  // اعلان درون‌برنامه‌ای — به روم شخصی گیرنده (یا روم ادمین) ارسال می‌شود
  NOTIFICATION_NEW: 'notification:new',
} as const;

export const SOCKET_ROOMS = {
  admin: () => 'admin',
  newsletter: () => 'newsletter',
  conversation: (id: string) => `conversation:${id}`,
  user: (id: string) => `user:${id}`,
} as const;

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_SECONDS = 120;

export const PAGINATION = {
  DEFAULT_LIMIT: 30,
  MAX_LIMIT: 100,
  MESSAGES_LIMIT: 30,
  NEWSLETTER_LIMIT: 20,
  USERS_LIMIT: 20,
} as const;
