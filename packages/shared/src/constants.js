"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGINATION = exports.OTP_EXPIRY_SECONDS = exports.OTP_LENGTH = exports.SOCKET_ROOMS = exports.SOCKET_EVENTS = exports.VOICE_MIME_TYPES = exports.IMAGE_MIME_TYPES = exports.ALLOWED_MIME_TYPES = exports.FILE_LIMITS = void 0;
exports.FILE_LIMITS = {
    MAX_SIZE_BYTES: 15 * 1024 * 1024,
    MAX_SIZE_MB: 15,
};
exports.ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
];
exports.IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
exports.VOICE_MIME_TYPES = [
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/webm',
    'audio/wav',
];
exports.SOCKET_EVENTS = {
    CHAT_JOIN: 'chat:join',
    CHAT_LEAVE: 'chat:leave',
    CHAT_SEND: 'chat:send',
    CHAT_TYPING_START: 'chat:typing:start',
    CHAT_TYPING_STOP: 'chat:typing:stop',
    CHAT_SEEN: 'chat:seen',
    CHAT_EDIT: 'chat:edit',
    CHAT_DELETE: 'chat:delete',
    CHAT_CLIENT_DIAGNOSTICS: 'chat:client-diagnostics',
    NEWSLETTER_JOIN: 'newsletter:join',
    NEWSLETTER_SEEN: 'newsletter:seen',
    NEWSLETTER_REACT: 'newsletter:react',
    NEWSLETTER_REACT_REMOVE: 'newsletter:react:remove',
    CHAT_MESSAGE_NEW: 'chat:message:new',
    CHAT_MESSAGE_UPDATED: 'chat:message:updated',
    CHAT_MESSAGE_DELETED: 'chat:message:deleted',
    CHAT_MESSAGE_SEEN: 'chat:message:seen',
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
};
exports.SOCKET_ROOMS = {
    admin: () => 'admin',
    newsletter: () => 'newsletter',
    conversation: (id) => `conversation:${id}`,
    user: (id) => `user:${id}`,
};
exports.OTP_LENGTH = 6;
exports.OTP_EXPIRY_SECONDS = 120;
exports.PAGINATION = {
    DEFAULT_LIMIT: 30,
    MAX_LIMIT: 100,
    MESSAGES_LIMIT: 30,
    NEWSLETTER_LIMIT: 20,
    USERS_LIMIT: 20,
};
//# sourceMappingURL=constants.js.map