import { MessageStatus, MessageType, ReactionEmoji, Role, Gender } from './enums';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  nationalId: string;
  role: Role;
  iat?: number;
  exp?: number;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  phoneNumber: string;
  judicialDomain: string;
  expertiseField: string;
  role: Role;
  isActive: boolean;
  avatarUrl: string | null;
  profileImageUrl: string | null;   // signed URL — populated on demand
  createdAt: string;
}

export interface UserProfileDto extends UserDto {
  fatherName: string | null;
  birthCertificateNumber: string | null;
  birthDate: string | null;
  gender: Gender | null;
  residenceProvince: string | null;
  residenceCity: string | null;
  profileImageAttachmentId: string | null;
  updatedAt: string;
}

// ─── Conversation ──────────────────────────────────────────────────────────────

export interface ConversationSummaryDto {
  id: string;
  user: Pick<UserDto, 'id' | 'firstName' | 'lastName' | 'avatarUrl' | 'profileImageUrl'>;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadByAdmin: number;
  unreadByUser: number;
}

export interface ConversationDetailDto {
  id: string;
  userId: string;
  unreadByUser: number;
  unreadByAdmin: number;
  createdAt: string;
}

// ─── Message ──────────────────────────────────────────────────────────────────

export interface AttachmentDto {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
}

export interface ReplyMessageDto {
  id: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  body: string | null;
  deletedAt: string | null;
  attachment: Pick<AttachmentDto, 'fileName' | 'mimeType'> | null;
}

export interface MessageDto {
  id: string;
  /**
   * Stable client-generated identity (UUID) sent with the original request.
   * Used for optimistic-UI reconciliation and server-side idempotency.
   * Null for legacy rows created before idempotency was introduced.
   */
  clientMessageId: string | null;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  body: string | null;
  status: MessageStatus;
  isEdited: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  pinnedAt: string | null;   // null = not pinned
  attachment: AttachmentDto | null;
  replyToMessage: ReplyMessageDto | null;
  createdAt: string;
}

// ─── Newsletter ───────────────────────────────────────────────────────────────

export interface ReactionSummaryDto {
  [emoji: string]: number;
}

export type NewsletterBlockType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';

export interface NewsletterBlockMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration?: number | null;
}

export interface NewsletterBlock {
  id: string;
  type: NewsletterBlockType;
  content?: string;
  attachmentId?: string;
  meta?: NewsletterBlockMeta;
  caption?: string;
  order: number;
}

export interface NewsletterAttachmentDto extends AttachmentDto {
  fileKey: string;
}

export interface NewsletterPostDto {
  id: string;
  title: string | null;
  body: string | null;
  contentBlocks: NewsletterBlock[];
  hashtags: string[];
  isPinned: boolean;
  isEdited: boolean;
  editedAt: string | null;
  author: Pick<UserDto, 'id' | 'firstName' | 'lastName'>;
  reactionSummary: ReactionSummaryDto;
  myReaction: ReactionEmoji | null;
  seenCount: number;
  isSeen?: boolean;
  attachments?: NewsletterAttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminStatsDto {
  totalUsers: number;
  activeUsers: number;
  totalConversations: number;
  unreadConversations: number;
  totalMessages: number;
  totalNewsletterPosts: number;
  recentActivity: {
    latestNewsletterPost: { id: string; title: string | null; isEdited: boolean; createdAt: string } | null;
    latestUnreadAt: string | null;
    latestActiveUser: { id: string; firstName: string; lastName: string; lastSeenAt: string } | null;
  };
}

export interface UploadResponseDto {
  fileKey: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    /** Total count matching filters, independent of the current page (e.g. list-wide active count). */
    activeCount?: number;
    /** Total count matching filters, independent of the current page (e.g. list-wide inactive count). */
    inactiveCount?: number;
  };
}

export interface CursorPaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}

// ─── Socket Payloads ─────────────────────────────────────────────────────────

export interface SocketChatSendPayload {
  conversationId: string;
  type: MessageType;
  body?: string;
  fileKey?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Client-recorded media duration in seconds (voice/video). Server clamps/validates. */
  duration?: number;
  /** Stable client identity (UUID). Doubles as the idempotency key. */
  clientMessageId: string;
  /**
   * @deprecated kept for backward compatibility during rollout — always equals
   * clientMessageId. New code should rely on clientMessageId.
   */
  tempId?: string;
  replyToMessageId?: string;
}

export type SocketChatSendErrorCode =
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ATTACHMENT'
  | 'INTERNAL';

/**
 * Stable typed acknowledgement returned to the CHAT_SEND emitter.
 * `ok: true`  → message is durably persisted; `message` is the canonical row.
 * `ok: false` → not persisted; client keeps the optimistic item and marks it failed.
 * `clientMessageId` is always echoed so the client can reconcile by identity.
 */
export interface SocketChatSendAck {
  ok: boolean;
  clientMessageId: string;
  message?: MessageDto;
  code?: SocketChatSendErrorCode;
  error?: string;
}

export interface SocketTypingPayload {
  conversationId: string;
}

export interface SocketSeenPayload {
  conversationId: string;
  messageId: string;
}

export interface SocketEditPayload {
  messageId: string;
  body: string;
}

export interface SocketDeletePayload {
  messageId: string;
  conversationId: string;
}

export interface SocketNewsletterReactPayload {
  postId: string;
  emoji: ReactionEmoji;
}

export interface SocketNewsletterSeenPayload {
  postId: string;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ─── In-app / Push Notifications ─────────────────────────────────────────────

export type AppNotificationType = 'message' | 'newsletter';

/** Payload of SOCKET_EVENTS.NOTIFICATION_NEW — sent to recipient personal/admin room */
export interface SocketNotificationPayload {
  type: AppNotificationType;
  title: string;
  body: string;
  /** Route to open when the notification is clicked (e.g. /chat or /admin/conversations/:id) */
  href: string;
  conversationId?: string;
  postId?: string;
  createdAt: string;
}

/** Browser PushSubscription JSON sent to the API for self-hosted web push */
export interface PushSubscriptionDto {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
