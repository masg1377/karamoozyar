import { MessageStatus, MessageType, ReactionEmoji, Role, Gender } from './enums';
export interface AuthTokens { accessToken: string; refreshToken: string; }
export interface JwtPayload { sub: string; nationalId: string; role: Role; iat?: number; exp?: number; }
export interface UserDto { id: string; firstName: string; lastName: string; nationalId: string; phoneNumber: string; judicialDomain: string; expertiseField: string; role: Role; isActive: boolean; avatarUrl: string | null; profileImageUrl: string | null; createdAt: string; }
export interface UserProfileDto extends UserDto { fatherName: string | null; birthCertificateNumber: string | null; birthDate: string | null; gender: Gender | null; residenceProvince: string | null; residenceCity: string | null; profileImageAttachmentId: string | null; updatedAt: string; }
export interface ConversationSummaryDto { id: string; user: Pick<UserDto, 'id' | 'firstName' | 'lastName' | 'avatarUrl' | 'profileImageUrl'>; lastMessageText: string | null; lastMessageAt: string | null; unreadByAdmin: number; unreadByUser: number; }
export interface ConversationDetailDto { id: string; userId: string; unreadByUser: number; unreadByAdmin: number; createdAt: string; }
export interface AttachmentDto { id: string; fileName: string; fileUrl: string; mimeType: string; fileSize: number; duration: number | null; }
export interface ReplyMessageDto { id: string; senderId: string; senderName: string; type: MessageType; body: string | null; deletedAt: string | null; attachment: Pick<AttachmentDto, 'fileName' | 'mimeType'> | null; }
export interface MessageDto { id: string; conversationId: string; senderId: string; senderName: string; type: MessageType; body: string | null; status: MessageStatus; isEdited: boolean; editedAt: string | null; deletedAt: string | null; attachment: AttachmentDto | null; replyToMessage: ReplyMessageDto | null; createdAt: string; }
export interface ReactionSummaryDto { [emoji: string]: number; }
export type NewsletterBlockType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE';
export interface NewsletterBlockMeta { fileName: string; mimeType: string; fileSize: number; duration?: number | null; }
export interface NewsletterBlock { id: string; type: NewsletterBlockType; content?: string; attachmentId?: string; meta?: NewsletterBlockMeta; caption?: string; order: number; }
export interface NewsletterPostDto { id: string; title: string | null; body: string | null; contentBlocks: NewsletterBlock[]; hashtags: string[]; isPinned: boolean; isEdited: boolean; editedAt: string | null; author: Pick<UserDto, 'id' | 'firstName' | 'lastName'>; reactionSummary: ReactionSummaryDto; myReaction: ReactionEmoji | null; seenCount: number; createdAt: string; updatedAt: string; }
export interface PaginatedResponse<T> { data: T[]; meta: { total: number; page: number; limit: number }; }
export interface CursorPaginatedResponse<T> { data: T[]; nextCursor: string | null; }
