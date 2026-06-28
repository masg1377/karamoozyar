import { z } from 'zod';
import { MessageType, ReactionEmoji, Gender } from './enums';

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * identifier can be:
 *   - 10-digit nationalId  e.g. "1234567890"
 *   - Iranian mobile       e.g. "09121234567" / "+989121234567" / "989121234567"
 *
 * Both new (identifier) and legacy (nationalId) clients are supported.
 * At least one of the two fields must be present.
 */
export const SendOtpSchema = z
  .object({
    identifier: z.string().min(10).max(14).optional(),
    nationalId: z.string().optional(), // legacy clients
  })
  .refine((d) => !!(d.identifier ?? d.nationalId), {
    message: 'کد ملی یا شماره موبایل معتبر نیست',
  });

export const VerifyOtpSchema = z
  .object({
    identifier: z.string().min(10).max(14).optional(),
    nationalId: z.string().optional(), // legacy clients
    otp: z.string().length(6, 'کد باید ۶ رقم باشد').regex(/^\d{6}$/, 'کد باید فقط عدد باشد'),
  })
  .refine((d) => !!(d.identifier ?? d.nationalId), {
    message: 'کد ملی یا شماره موبایل معتبر نیست',
  });

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── User ─────────────────────────────────────────────────────────────────────

const phoneRegex = /^09\d{9}$/;
const nationalIdRegex = /^\d{10}$/;

export const CreateUserSchema = z.object({
  firstName: z.string().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(50),
  lastName: z.string().min(2, 'نام خانوادگی باید حداقل ۲ کاراکتر باشد').max(50),
  nationalId: z.string().regex(nationalIdRegex, 'شماره ملی نامعتبر'),
  phoneNumber: z.string().regex(phoneRegex, 'شماره تلفن نامعتبر (مثال: 09123456789)'),
  judicialDomain: z.string().min(2, 'حوزه قضایی الزامی است').max(100),
  expertiseField: z.string().min(2, 'رشته کارشناسی الزامی است').max(100),
  // Extended profile fields (optional at creation)
  fatherName: z.string().min(2).max(50).optional(),
  birthCertificateNumber: z.string().min(1).max(20).optional(),
  birthDate: z.string().datetime({ offset: true }).optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  gender: z.nativeEnum(Gender).optional(),
  residenceProvince: z.string().max(100).optional(),
  residenceCity: z.string().max(100).optional(),
});

export const UpdateUserSchema = CreateUserSchema.partial().omit({ nationalId: true }).extend({
  fatherName: z.string().min(2).max(50).optional().nullable(),
  birthCertificateNumber: z.string().min(1).max(20).optional().nullable(),
  birthDate: z.string().datetime({ offset: true }).optional().nullable().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()),
  gender: z.nativeEnum(Gender).optional().nullable(),
  residenceProvince: z.string().max(100).optional().nullable(),
  residenceCity: z.string().max(100).optional().nullable(),
});

// PATCH /users/me — used by both users and admins; service decides which fields to apply
export const UpdateProfileSchema = z.object({
  firstName: z.string().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(50).optional(),
  lastName: z.string().min(2, 'نام خانوادگی باید حداقل ۲ کاراکتر باشد').max(50).optional(),
  phoneNumber: z.string().regex(phoneRegex, 'شماره تلفن نامعتبر (مثال: 09123456789)').optional(),
  judicialDomain: z.string().min(2, 'حوزه قضایی الزامی است').max(100).optional(),
  expertiseField: z.string().min(2, 'رشته کارشناسی الزامی است').max(100).optional(),
  fatherName: z.string().min(2, 'نام پدر باید حداقل ۲ کاراکتر باشد').max(50).optional().nullable(),
  birthCertificateNumber: z.string().min(1).max(20).optional().nullable(),
  birthDate: z.string().optional().nullable(),
  gender: z.nativeEnum(Gender).optional().nullable(),
  residenceProvince: z.string().max(100).optional().nullable(),
  residenceCity: z.string().max(100).optional().nullable(),
});

// Admin updates own profile
export const UpdateAdminProfileSchema = z.object({
  firstName: z.string().min(2).max(50).optional(),
  lastName: z.string().min(2).max(50).optional(),
  phoneNumber: z.string().regex(phoneRegex, 'شماره تلفن نامعتبر').optional(),
});

// ─── Message ──────────────────────────────────────────────────────────────────

export const SendMessageSchema = z.object({
  body: z.string().min(1).max(4000).optional(),
  type: z.nativeEnum(MessageType).default(MessageType.TEXT),
  fileKey: z.string().optional(),
  // Stable client identity + idempotency key (UUID-ish). tempId kept as alias.
  clientMessageId: z.string().min(8).max(64),
  tempId: z.string().min(1).optional(),
  replyToMessageId: z.string().optional(),
  fileName: z.string().optional(),
  mimeType: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  // Client-reported media duration (seconds). Server clamps to a sane range.
  duration: z.number().int().nonnegative().max(36000).optional(),
});

export const EditMessageSchema = z.object({
  body: z.string().min(1, 'متن پیام نمی‌تواند خالی باشد').max(4000),
});

// ─── Newsletter ───────────────────────────────────────────────────────────────

const NewsletterBlockSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'FILE']),
  content: z.string().max(10000).optional(),
  attachmentId: z.string().optional(),
  meta: z.object({
    fileName: z.string(),
    mimeType: z.string(),
    fileSize: z.number(),
    duration: z.number().nullable().optional(),
  }).optional(),
  caption: z.string().max(500).optional(),
  order: z.number().int().min(0),
});

export const CreateNewsletterPostSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  contentBlocks: z.array(NewsletterBlockSchema).max(50).optional(),
  hashtags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().optional().default(false),
  uploads: z.record(z.string(), z.object({
    fileKey: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    fileSize: z.number(),
    duration: z.number().nullable().optional(),
  })).optional(),
});

export const UpdateNewsletterPostSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  contentBlocks: z.array(NewsletterBlockSchema).max(50).optional(),
  hashtags: z.array(z.string().max(50)).max(20).optional(),
  isPinned: z.boolean().optional(),
  uploads: z.record(z.string(), z.object({
    fileKey: z.string(),
    fileUrl: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    fileSize: z.number(),
    duration: z.number().nullable().optional(),
  })).optional(),
});

export const ReactToPostSchema = z.object({
  emoji: z.nativeEnum(ReactionEmoji),
});

// ─── Pagination ───────────────────────────────────────────────────────────────

export const CursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(30),
});

export const PagePaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type SendOtpInput = z.infer<typeof SendOtpSchema>;
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type UpdateAdminProfileInput = z.infer<typeof UpdateAdminProfileSchema>;
export type SendMessageInput = z.infer<typeof SendMessageSchema>;
export type EditMessageInput = z.infer<typeof EditMessageSchema>;
export type CreateNewsletterPostInput = z.infer<typeof CreateNewsletterPostSchema>;
export type UpdateNewsletterPostInput = z.infer<typeof UpdateNewsletterPostSchema>;
export type ReactToPostInput = z.infer<typeof ReactToPostSchema>;
