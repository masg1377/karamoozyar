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
  meta: { total: number; page: number; limit: number };
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
  tempId: string;
  replyToMessageId?: string;
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
