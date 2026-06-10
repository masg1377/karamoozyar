"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagePaginationSchema = exports.CursorPaginationSchema = exports.ReactToPostSchema = exports.UpdateNewsletterPostSchema = exports.CreateNewsletterPostSchema = exports.EditMessageSchema = exports.SendMessageSchema = exports.UpdateUserSchema = exports.CreateUserSchema = exports.RefreshTokenSchema = exports.VerifyOtpSchema = exports.SendOtpSchema = void 0;
const zod_1 = require("zod");
const enums_1 = require("./enums");
exports.SendOtpSchema = zod_1.z.object({
    nationalId: zod_1.z
        .string()
        .min(10, 'شماره ملی باید ۱۰ رقم باشد')
        .max(10, 'شماره ملی باید ۱۰ رقم باشد')
        .regex(/^\d{10}$/, 'شماره ملی باید فقط عدد باشد'),
});
exports.VerifyOtpSchema = zod_1.z.object({
    nationalId: zod_1.z.string().regex(/^\d{10}$/, 'شماره ملی نامعتبر'),
    otp: zod_1.z.string().length(6, 'کد باید ۶ رقم باشد').regex(/^\d{6}$/, 'کد باید فقط عدد باشد'),
});
exports.RefreshTokenSchema = zod_1.z.object({
    refreshToken: zod_1.z.string().min(1),
});
exports.CreateUserSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(2, 'نام باید حداقل ۲ کاراکتر باشد').max(50),
    lastName: zod_1.z.string().min(2, 'نام خانوادگی باید حداقل ۲ کاراکتر باشد').max(50),
    nationalId: zod_1.z.string().regex(/^\d{10}$/, 'شماره ملی نامعتبر'),
    phoneNumber: zod_1.z
        .string()
        .regex(/^09\d{9}$/, 'شماره تلفن نامعتبر (مثال: 09123456789)'),
    judicialDomain: zod_1.z.string().min(2, 'حوزه قضایی الزامی است').max(100),
    expertiseField: zod_1.z.string().min(2, 'رشته کارشناسی الزامی است').max(100),
});
exports.UpdateUserSchema = exports.CreateUserSchema.partial().omit({ nationalId: true });
exports.SendMessageSchema = zod_1.z.object({
    body: zod_1.z.string().min(1).max(4000).optional(),
    type: zod_1.z.nativeEnum(enums_1.MessageType).default(enums_1.MessageType.TEXT),
    fileKey: zod_1.z.string().optional(),
    tempId: zod_1.z.string().min(1),
});
exports.EditMessageSchema = zod_1.z.object({
    body: zod_1.z.string().min(1, 'متن پیام نمی‌تواند خالی باشد').max(4000),
});
exports.CreateNewsletterPostSchema = zod_1.z.object({
    type: zod_1.z.nativeEnum(enums_1.MessageType).default(enums_1.MessageType.TEXT),
    body: zod_1.z.string().min(1).max(10000).optional(),
    attachmentKeys: zod_1.z.array(zod_1.z.string()).max(5).optional(),
    isPinned: zod_1.z.boolean().optional().default(false),
});
exports.UpdateNewsletterPostSchema = zod_1.z.object({
    body: zod_1.z.string().min(1).max(10000).optional(),
    isPinned: zod_1.z.boolean().optional(),
});
exports.ReactToPostSchema = zod_1.z.object({
    emoji: zod_1.z.nativeEnum(enums_1.ReactionEmoji),
});
exports.CursorPaginationSchema = zod_1.z.object({
    cursor: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().min(1).max(100).default(30),
});
exports.PagePaginationSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().min(1).default(1),
    limit: zod_1.z.coerce.number().min(1).max(100).default(20),
    search: zod_1.z.string().optional(),
});
//# sourceMappingURL=validators.js.map