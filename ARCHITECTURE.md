# KarAmoozYar — Architecture Design Document

> **مرکز کارشناسان رسمی دادگستری مازندران**
> Version 1.0 — طراحی معماری (قبل از پیاده‌سازی)

---

## ۱. ساختار Monorepo

```
karamooziyar/
├── apps/
│   ├── web/                        # Next.js 16 - Frontend
│   └── api/                        # NestJS 11 - Backend
│
├── packages/
│   ├── types/                      # Shared TypeScript types & interfaces
│   ├── validators/                 # Shared Zod schemas
│   └── config/                     # Shared configs (env schema, constants)
│
├── docker/
│   ├── postgres/
│   │   └── init.sql
│   ├── minio/
│   └── redis/
│
├── docker-compose.yml              # Dev services (PG, Redis, MinIO)
├── docker-compose.prod.yml         # Production override
├── turbo.json                      # Turborepo pipeline config
├── pnpm-workspace.yaml
├── package.json                    # Root package.json
├── .env.example
└── README.md
```

### apps/api (NestJS)

```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── jwt-refresh.strategy.ts
│   │   │   └── guards/
│   │   │       ├── jwt-auth.guard.ts
│   │   │       ├── roles.guard.ts
│   │   │       └── ws-jwt.guard.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   └── users.service.ts
│   │   │
│   │   ├── conversations/
│   │   │   ├── conversations.module.ts
│   │   │   ├── conversations.controller.ts
│   │   │   └── conversations.service.ts
│   │   │
│   │   ├── messages/
│   │   │   ├── messages.module.ts
│   │   │   ├── messages.controller.ts
│   │   │   └── messages.service.ts
│   │   │
│   │   ├── newsletter/
│   │   │   ├── newsletter.module.ts
│   │   │   ├── newsletter.controller.ts
│   │   │   └── newsletter.service.ts
│   │   │
│   │   ├── uploads/
│   │   │   ├── uploads.module.ts
│   │   │   ├── uploads.controller.ts
│   │   │   └── uploads.service.ts
│   │   │
│   │   ├── notifications/
│   │   │   └── notifications.service.ts
│   │   │
│   │   └── admin/
│   │       ├── admin.module.ts
│   │       └── admin.controller.ts
│   │
│   ├── gateways/
│   │   └── chat.gateway.ts         # Socket.IO gateway
│   │
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   │
│   ├── redis/
│   │   ├── redis.module.ts
│   │   └── redis.service.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts
│   │   │   └── current-user.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── audit-log.interceptor.ts
│   │   │   └── transform.interceptor.ts
│   │   ├── pipes/
│   │   │   └── zod-validation.pipe.ts
│   │   └── enums/
│   │       ├── role.enum.ts
│   │       └── message-type.enum.ts
│   │
│   └── config/
│       └── configuration.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── test/
├── Dockerfile
└── package.json
```

### apps/web (Next.js)

```
apps/web/
├── src/
│   ├── app/                        # App Router
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx
│   │   │
│   │   ├── (user)/                 # Trainee routes
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── chat/
│   │   │   │   └── page.tsx        # Chat with admin
│   │   │   └── newsletter/
│   │   │       └── page.tsx        # Read-only newsletter
│   │   │
│   │   ├── (admin)/                # Admin routes
│   │   │   ├── layout.tsx
│   │   │   ├── admin/
│   │   │   │   ├── page.tsx        # Admin dashboard
│   │   │   │   ├── conversations/
│   │   │   │   │   ├── page.tsx    # All conversations list
│   │   │   │   │   └── [userId]/
│   │   │   │   │       └── page.tsx # Chat with specific user
│   │   │   │   └── newsletter/
│   │   │   │       ├── page.tsx    # Newsletter management
│   │   │   │       └── compose/
│   │   │   │           └── page.tsx
│   │   │
│   │   ├── api/                    # Next.js API routes (minimal, proxy only)
│   │   │   └── health/
│   │   │       └── route.ts
│   │   │
│   │   ├── layout.tsx              # Root layout (RTL, fonts)
│   │   └── not-found.tsx
│   │
│   ├── components/
│   │   ├── ui/                     # shadcn/ui base components
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── MessageInput.tsx
│   │   │   ├── VoiceRecorder.tsx
│   │   │   ├── FileAttachment.tsx
│   │   │   ├── EmojiPicker.tsx
│   │   │   ├── MessageMenu.tsx     # copy/delete/edit context menu
│   │   │   └── SeenIndicator.tsx
│   │   ├── newsletter/
│   │   │   ├── NewsletterFeed.tsx
│   │   │   ├── NewsletterPost.tsx
│   │   │   ├── ReactionBar.tsx
│   │   │   └── SeenCount.tsx
│   │   ├── admin/
│   │   │   ├── ConversationList.tsx
│   │   │   ├── ConversationItem.tsx
│   │   │   └── UnreadBadge.tsx
│   │   └── shared/
│   │       ├── Avatar.tsx
│   │       ├── LoadingSpinner.tsx
│   │       └── RTLWrapper.tsx
│   │
│   ├── hooks/
│   │   ├── useSocket.ts
│   │   ├── useMessages.ts
│   │   ├── useVoiceRecorder.ts
│   │   └── useInfiniteScroll.ts
│   │
│   ├── lib/
│   │   ├── api-client.ts           # Axios/fetch wrapper
│   │   ├── socket-client.ts        # Socket.IO client
│   │   ├── auth.ts                 # Auth helpers
│   │   └── utils.ts
│   │
│   ├── store/                      # Zustand stores
│   │   ├── auth.store.ts
│   │   ├── chat.store.ts
│   │   └── notification.store.ts
│   │
│   └── types/
│       └── index.ts
│
├── public/
│   └── fonts/                      # Vazirmatn or IRANSans font files
│
├── Dockerfile
└── package.json
```

---

## ۲. Prisma Schema کامل

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

enum Role {
  USER
  ADMIN
}

enum MessageType {
  TEXT
  IMAGE
  FILE
  VOICE
}

enum MessageStatus {
  SENT
  DELIVERED
  SEEN
}

enum ReactionEmoji {
  LIKE      // 👍
  LOVE      // ❤️
  LAUGH     // 😂
  WOW       // 😮
  SAD       // 😢
  ANGRY     // 😡
}

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

model User {
  id                String   @id @default(cuid())
  nationalId        String   @unique                 // شماره ملی — primary login credential
  firstName         String
  lastName          String
  phoneNumber       String   @unique
  judicialDomain    String                           // حوزه قضایی
  expertiseField    String                           // رشته کارشناسی
  role              Role     @default(USER)
  isActive          Boolean  @default(true)
  passwordHash      String?                          // nullable — OTP-only mode
  otpCode           String?                          // hashed OTP in memory/Redis
  otpExpiresAt      DateTime?
  avatarUrl         String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?                        // soft delete

  // Relations
  conversation      Conversation?                    // 1-to-1 with admin
  sentMessages      Message[]      @relation("SentMessages")
  messageSeen       MessageSeen[]
  refreshTokens     RefreshToken[]
  newsletterSeen    NewsletterSeen[]
  newsletterReactions NewsletterReaction[]
  auditLogs         AuditLog[]

  @@index([nationalId])
  @@index([phoneNumber])
  @@map("users")
}

// ─────────────────────────────────────────────
// CONVERSATIONS (1 per user ↔ admin)
// ─────────────────────────────────────────────

model Conversation {
  id              String    @id @default(cuid())
  userId          String    @unique               // each user has exactly one conversation
  user            User      @relation(fields: [userId], references: [id])

  lastMessageAt   DateTime?                       // for sorting conversation list
  lastMessageText String?                         // preview text
  unreadByAdmin   Int       @default(0)           // unread count for admin badge
  unreadByUser    Int       @default(0)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  messages        Message[]

  @@index([lastMessageAt(sort: Desc)])
  @@map("conversations")
}

// ─────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────

model Message {
  id               String        @id @default(cuid())
  conversationId   String
  conversation     Conversation  @relation(fields: [conversationId], references: [id])
  senderId         String
  sender           User          @relation("SentMessages", fields: [senderId], references: [id])

  type             MessageType   @default(TEXT)
  body             String?                         // text content (nullable for media-only)
  isEdited         Boolean       @default(false)
  editedAt         DateTime?
  status           MessageStatus @default(SENT)

  deletedAt        DateTime?                       // soft delete
  deletedBy        String?                         // userId who deleted

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  attachment       MessageAttachment?
  seenBy           MessageSeen[]

  @@index([conversationId, createdAt(sort: Desc)])
  @@index([senderId])
  @@map("messages")
}

model MessageAttachment {
  id          String      @id @default(cuid())
  messageId   String      @unique
  message     Message     @relation(fields: [messageId], references: [id], onDelete: Cascade)

  fileName    String                               // original file name
  fileKey     String                               // S3/MinIO object key
  fileUrl     String                               // presigned or public URL
  mimeType    String
  fileSize    Int                                  // bytes
  duration    Int?                                 // seconds — for voice messages

  createdAt   DateTime    @default(now())

  @@map("message_attachments")
}

model MessageSeen {
  id          String    @id @default(cuid())
  messageId   String
  message     Message   @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  seenAt      DateTime  @default(now())

  @@unique([messageId, userId])
  @@map("message_seen")
}

// ─────────────────────────────────────────────
// NEWSLETTER (Channel)
// ─────────────────────────────────────────────

model NewsletterPost {
  id          String      @id @default(cuid())
  authorId    String                               // admin userId
  author      User        @relation(fields: [authorId], references: [id])

  type        MessageType @default(TEXT)
  body        String?
  isEdited    Boolean     @default(false)
  editedAt    DateTime?
  isPinned    Boolean     @default(false)

  deletedAt   DateTime?                            // soft delete

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  attachments NewsletterAttachment[]
  reactions   NewsletterReaction[]
  seenBy      NewsletterSeen[]

  @@index([createdAt(sort: Desc)])
  @@map("newsletter_posts")
}

// Note: authorId references User — admin users have role=ADMIN
// No separate Admin model needed; role-based access handles this

model NewsletterAttachment {
  id          String         @id @default(cuid())
  postId      String
  post        NewsletterPost @relation(fields: [postId], references: [id], onDelete: Cascade)

  fileName    String
  fileKey     String
  fileUrl     String
  mimeType    String
  fileSize    Int
  duration    Int?                                 // for voice

  createdAt   DateTime       @default(now())

  @@map("newsletter_attachments")
}

model NewsletterReaction {
  id        String         @id @default(cuid())
  postId    String
  post      NewsletterPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId    String
  user      User           @relation(fields: [userId], references: [id])
  emoji     ReactionEmoji

  createdAt DateTime       @default(now())

  @@unique([postId, userId])                       // one reaction per user per post
  @@map("newsletter_reactions")
}

model NewsletterSeen {
  id        String         @id @default(cuid())
  postId    String
  post      NewsletterPost @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId    String
  user      User           @relation(fields: [userId], references: [id])
  seenAt    DateTime       @default(now())

  @@unique([postId, userId])
  @@map("newsletter_seen")
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

model RefreshToken {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash   String    @unique                    // hashed refresh token
  userAgent   String?
  ipAddress   String?
  expiresAt   DateTime
  revokedAt   DateTime?                            // null = active

  createdAt   DateTime  @default(now())

  @@index([userId])
  @@index([tokenHash])
  @@map("refresh_tokens")
}

// ─────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────

model AuditLog {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  action      String                               // e.g. "DELETE_MESSAGE", "EDIT_POST"
  resource    String                               // e.g. "Message", "NewsletterPost"
  resourceId  String?
  metadata    Json?                                // additional context
  ipAddress   String?
  userAgent   String?

  createdAt   DateTime  @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@index([action])
  @@map("audit_logs")
}
```

---

## ۳. API Contracts کامل

### Base URL
```
/api/v1
```

### Headers مشترک
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

---

### ۳.۱ Authentication

#### `POST /auth/send-otp`
درخواست کد یکبارمصرف
```json
// Request
{ "nationalId": "1234567890" }

// Response 200
{ "message": "کد ارسال شد", "expiresIn": 120 }

// Response 404
{ "error": "کاربر یافت نشد" }
```

#### `POST /auth/verify-otp`
تأیید OTP و صدور توکن
```json
// Request
{ "nationalId": "1234567890", "otp": "123456" }

// Response 200
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "id": "cuid",
    "firstName": "علی",
    "lastName": "احمدی",
    "nationalId": "1234567890",
    "role": "USER",
    "judicialDomain": "...",
    "expertiseField": "..."
  }
}

// Response 401
{ "error": "کد نادرست یا منقضی شده" }
```

#### `POST /auth/refresh`
تجدید access token
```json
// Request (cookie یا body)
{ "refreshToken": "eyJ..." }

// Response 200
{ "accessToken": "eyJ..." }
```

#### `POST /auth/logout`
خروج از سیستم
```json
// Response 200
{ "message": "خروج موفق" }
```

---

### ۳.۲ Users (Admin only)

#### `GET /users`
لیست همه کارآموزان
```
Query: ?page=1&limit=20&search=احمدی
```
```json
// Response 200
{
  "data": [
    {
      "id": "cuid",
      "firstName": "علی",
      "lastName": "احمدی",
      "nationalId": "1234567890",
      "phoneNumber": "09123456789",
      "judicialDomain": "آمل",
      "expertiseField": "راه و ساختمان",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": { "total": 100, "page": 1, "limit": 20 }
}
```

#### `POST /users`
ایجاد کاربر جدید (Admin)
```json
// Request
{
  "firstName": "علی",
  "lastName": "احمدی",
  "nationalId": "1234567890",
  "phoneNumber": "09123456789",
  "judicialDomain": "آمل",
  "expertiseField": "راه و ساختمان"
}
// Response 201
{ "id": "cuid", ... }
```

#### `GET /users/:id`
پروفایل کاربر
```json
// Response 200 — full user object
```

#### `PATCH /users/:id`
ویرایش کاربر (Admin یا خود کاربر برای فیلدهای مجاز)
```json
// Request (partial)
{ "phoneNumber": "09129999999" }
```

#### `DELETE /users/:id`
حذف نرم کاربر (Admin)
```json
// Response 200
{ "message": "کاربر غیرفعال شد" }
```

#### `GET /users/me`
پروفایل خودم (User)
```json
// Response 200 — user object
```

---

### ۳.۳ Conversations (Chat)

#### `GET /conversations` — Admin only
لیست همه گفتگوها، مرتب بر اساس آخرین پیام
```json
// Response 200
{
  "data": [
    {
      "id": "cuid",
      "user": { "id": "...", "firstName": "علی", "lastName": "احمدی", "avatarUrl": null },
      "lastMessageText": "سلام، سؤالی داشتم",
      "lastMessageAt": "2024-01-01T12:00:00Z",
      "unreadByAdmin": 3
    }
  ]
}
```

#### `GET /conversations/mine` — User only
گفتگوی خودم با ادمین
```json
// Response 200
{
  "id": "cuid",
  "unreadByUser": 1,
  "lastMessageAt": "..."
}
```

#### `GET /conversations/:id/messages`
پیام‌های یک گفتگو (pagination)
```
Query: ?cursor=<messageId>&limit=30
```
```json
// Response 200
{
  "data": [
    {
      "id": "cuid",
      "senderId": "...",
      "senderName": "علی احمدی",
      "type": "TEXT",
      "body": "سلام",
      "status": "SEEN",
      "isEdited": false,
      "createdAt": "2024-01-01T12:00:00Z",
      "attachment": null
    }
  ],
  "nextCursor": "cuid_older_message"
}
```

#### `POST /conversations/:id/messages`
ارسال پیام متنی
```json
// Request
{ "body": "سلام، چطور می‌توانم کمک کنم؟", "type": "TEXT" }

// Response 201
{ "id": "cuid", "body": "...", "createdAt": "..." }
```

#### `PATCH /conversations/:id/messages/:messageId`
ویرایش پیام
```json
// Request
{ "body": "متن ویرایش شده" }
// Response 200
{ "id": "...", "body": "...", "isEdited": true, "editedAt": "..." }
```

#### `DELETE /conversations/:id/messages/:messageId`
حذف نرم پیام
```json
// Response 200
{ "message": "پیام حذف شد" }
```

#### `POST /conversations/:id/messages/:messageId/seen`
علامت‌گذاری به عنوان دیده‌شده
```json
// Response 200
{ "message": "ok" }
```

---

### ۳.۴ Uploads

#### `POST /uploads/message-attachment`
آپلود فایل برای پیام
```
Content-Type: multipart/form-data
Fields: file (max 15MB), conversationId
```
```json
// Response 201
{
  "fileKey": "messages/2024/01/uuid.jpg",
  "fileUrl": "https://...",
  "fileName": "photo.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 204800,
  "duration": null
}
```

#### `POST /uploads/newsletter-attachment`
آپلود فایل برای خبرنامه (Admin only)
```json
// Response 201 — same structure as above
```

#### `GET /uploads/presigned/:key`
دریافت URL موقت برای فایل private
```json
// Response 200
{ "url": "https://...", "expiresIn": 3600 }
```

---

### ۳.۵ Newsletter

#### `GET /newsletter`
لیست پست‌های خبرنامه
```
Query: ?cursor=<postId>&limit=20
```
```json
// Response 200
{
  "data": [
    {
      "id": "cuid",
      "type": "TEXT",
      "body": "اطلاعیه مهم...",
      "isPinned": false,
      "isEdited": false,
      "author": { "firstName": "مدیر", "lastName": "سیستم" },
      "attachments": [],
      "reactionSummary": { "LIKE": 5, "LOVE": 2 },
      "myReaction": "LIKE",
      "seenCount": 42,
      "isSeen": true,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ],
  "nextCursor": "..."
}
```

#### `POST /newsletter` — Admin only
ایجاد پست جدید
```json
// Request
{
  "type": "TEXT",
  "body": "متن اطلاعیه",
  "attachmentKeys": ["newsletter/2024/01/uuid.pdf"]   // از قبل آپلود شده
}
// Response 201 — full post object
```

#### `PATCH /newsletter/:id` — Admin only
ویرایش پست
```json
// Request
{ "body": "متن ویرایش شده" }
// Response 200
```

#### `DELETE /newsletter/:id` — Admin only
حذف نرم پست
```json
// Response 200
{ "message": "پست حذف شد" }
```

#### `POST /newsletter/:id/seen`
ثبت دیده شدن پست
```json
// Response 200
{ "message": "ok" }
```

#### `POST /newsletter/:id/react`
ارسال یا تغییر reaction
```json
// Request
{ "emoji": "LIKE" }
// Response 200
{ "emoji": "LIKE", "postId": "..." }
```

#### `DELETE /newsletter/:id/react`
حذف reaction
```json
// Response 200
```

#### `GET /newsletter/:id/seen-list` — Admin only
لیست کاربرانی که پست را دیده‌اند
```json
// Response 200
{
  "data": [
    { "userId": "...", "name": "علی احمدی", "seenAt": "..." }
  ],
  "total": 42
}
```

---

### ۳.۶ Admin Specific

#### `GET /admin/stats`
آمار کلی
```json
// Response 200
{
  "totalUsers": 150,
  "activeUsers": 148,
  "totalConversations": 150,
  "unreadConversations": 12,
  "totalNewsletterPosts": 45,
  "totalMessages": 2340
}
```

---

## ۴. Socket.IO Events کامل

### Connection & Auth

```typescript
// Client connects with auth token
const socket = io('wss://api.domain.com', {
  auth: { token: 'Bearer <access_token>' },
  transports: ['websocket'],
})
```

### Rooms Strategy
```
room: "conversation:<conversationId>"   → participants of a conversation
room: "admin"                           → all admin users
room: "newsletter"                      → all connected users
room: "user:<userId>"                   → specific user's private room
```

---

### ۴.۱ رویدادهای Chat (Conversation)

#### Client → Server

| Event | Payload | توضیح |
|-------|---------|-------|
| `chat:join` | `{ conversationId }` | ورود به اتاق گفتگو |
| `chat:leave` | `{ conversationId }` | خروج از اتاق |
| `chat:send` | `{ conversationId, type, body?, tempId }` | ارسال پیام متنی |
| `chat:typing:start` | `{ conversationId }` | شروع تایپ |
| `chat:typing:stop` | `{ conversationId }` | پایان تایپ |
| `chat:seen` | `{ conversationId, messageId }` | دیدن پیام |
| `chat:edit` | `{ messageId, body }` | ویرایش پیام |
| `chat:delete` | `{ messageId }` | حذف پیام |

#### Server → Client

| Event | Payload | توضیح |
|-------|---------|-------|
| `chat:message:new` | `MessageDto` | پیام جدید دریافت شد |
| `chat:message:updated` | `{ messageId, body, editedAt }` | پیام ویرایش شد |
| `chat:message:deleted` | `{ messageId, conversationId }` | پیام حذف شد |
| `chat:message:seen` | `{ messageId, userId, seenAt }` | پیام دیده شد |
| `chat:typing` | `{ conversationId, userId, isTyping }` | تایپ کردن |
| `chat:conversation:updated` | `ConversationSummaryDto` | آخرین پیام و unread به‌روز شد |
| `chat:error` | `{ message }` | خطا |

---

### ۴.۲ رویدادهای Newsletter

#### Client → Server

| Event | Payload | توضیح |
|-------|---------|-------|
| `newsletter:join` | — | اشتراک در خبرنامه |
| `newsletter:seen` | `{ postId }` | دیدن پست |
| `newsletter:react` | `{ postId, emoji }` | ارسال reaction |
| `newsletter:react:remove` | `{ postId }` | حذف reaction |

#### Server → Client

| Event | Payload | توضیح |
|-------|---------|-------|
| `newsletter:post:new` | `NewsletterPostDto` | پست جدید ارسال شد |
| `newsletter:post:updated` | `NewsletterPostDto` | پست ویرایش شد |
| `newsletter:post:deleted` | `{ postId }` | پست حذف شد |
| `newsletter:reaction:updated` | `{ postId, reactions }` | واکنش‌ها به‌روز شد |
| `newsletter:seen:updated` | `{ postId, seenCount }` | تعداد دیدن (ادمین) |

---

### ۴.۳ رویدادهای Notification

#### Server → Client

| Event | Payload | توضیح |
|-------|---------|-------|
| `notification:unread` | `{ count }` | تعداد پیام‌های خوانده‌نشده |
| `notification:badge` | `{ conversationId, count }` | badge ادمین |

---

### ۴.۴ ارسال فایل (Voice / Image / File)
فایل‌ها ابتدا از طریق **REST API** آپلود می‌شوند، سپس `fileKey` از طریق Socket ارسال می‌شود:

```typescript
// 1. Upload via REST
POST /uploads/message-attachment → { fileKey, fileUrl, ... }

// 2. Send via Socket
emit('chat:send', {
  conversationId: "...",
  type: "VOICE",      // IMAGE | FILE | VOICE
  body: null,
  fileKey: "messages/2024/01/uuid.ogg",
  tempId: "local-uuid"
})
```

---

## ۵. Frontend Routes (Next.js App Router)

```
/                            → redirect به /login یا /dashboard
/login                       → صفحه ورود (OTP)

# User Routes (role=USER)
/dashboard                   → داشبورد کارآموز (لینک به chat و newsletter)
/chat                        → چت مستقیم با ادمین
/newsletter                  → خبرنامه (read-only)

# Admin Routes (role=ADMIN)
/admin                       → داشبورد ادمین (آمار)
/admin/conversations          → لیست گفتگوهای همه کارآموزان
/admin/conversations/:userId  → چت با کارآموز مشخص
/admin/newsletter             → مدیریت خبرنامه
/admin/newsletter/compose     → ارسال پست جدید
/admin/users                  → مدیریت کارآموزان
/admin/users/new              → ایجاد کارآموز جدید
/admin/users/:id              → پروفایل و ویرایش کارآموز
```

### Auth Guards
- صفحات `(user)/` فقط با `role=USER`
- صفحات `(admin)/` فقط با `role=ADMIN`
- Middleware در `middleware.ts` توکن را بررسی می‌کند

---

## ۶. Environment Variables

### `apps/api/.env`

```env
# App
NODE_ENV=development
PORT=3001
API_PREFIX=api/v1

# Database
DATABASE_URL=postgresql://karamooz_user:karamooz_pass@localhost:5432/karamooziyar

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=redis_secret_password

# JWT
JWT_ACCESS_SECRET=super_secret_access_key_change_in_prod_32chars+
JWT_REFRESH_SECRET=super_secret_refresh_key_change_in_prod_32chars+
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d

# S3 / MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin_secret
S3_BUCKET_NAME=karamooziyar
S3_REGION=us-east-1
S3_USE_SSL=false

# File Upload
MAX_FILE_SIZE_BYTES=15728640         # 15 MB
ALLOWED_MIME_TYPES=image/jpeg,image/png,image/webp,image/gif,audio/ogg,audio/mpeg,audio/webm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip,application/x-zip-compressed,text/plain

# OTP (Simulated for MVP)
OTP_EXPIRY_SECONDS=120
OTP_LENGTH=6
# SMS_PROVIDER_URL=                  # for future real OTP

# Rate Limiting
THROTTLE_TTL=60000
THROTTLE_LIMIT=100

# CORS
CORS_ORIGINS=http://localhost:3000

# Frontend URL (for email/SMS links)
FRONTEND_URL=http://localhost:3000
```

### `apps/web/.env.local`

```env
# API
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_WS_URL=http://localhost:3001

# App
NEXT_PUBLIC_APP_NAME=کارآموزیار
NEXT_PUBLIC_APP_DESCRIPTION=سامانه ارتباطی مرکز کارشناسان رسمی دادگستری مازندران

# Feature Flags
NEXT_PUBLIC_ENABLE_VOICE=true
```

### Root `.env` (Docker services)

```env
# PostgreSQL
POSTGRES_DB=karamooziyar
POSTGRES_USER=karamooz_user
POSTGRES_PASSWORD=karamooz_pass
POSTGRES_PORT=5432

# Redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_secret_password

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin_secret
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001
```

### `docker-compose.yml`

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    container_name: karamooziyar_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: karamooziyar_redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "--pass", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    container_name: karamooziyar_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    ports:
      - "${MINIO_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

---

## ۷. نقشه امنیتی

### RBAC Matrix

| Action | USER | ADMIN |
|--------|------|-------|
| ارسال پیام به ادمین | ✅ | ✅ |
| خواندن پیام‌های خودم | ✅ | ✅ |
| خواندن پیام‌های دیگران | ❌ | ✅ |
| ارسال پست خبرنامه | ❌ | ✅ |
| خواندن خبرنامه | ✅ | ✅ |
| ویرایش/حذف خبرنامه | ❌ | ✅ |
| مشاهده لیست گفتگوها | ❌ | ✅ |
| مدیریت کاربران | ❌ | ✅ |
| مشاهده آمار seen | ❌ | ✅ |

### File Upload Security
```
✅ Validate MIME type (not just extension)
✅ Max size: 15MB
✅ Random UUID filename (no original name in key)
✅ Virus scan ready (hook for ClamAV)
✅ Private bucket — presigned URLs با expiry
✅ Rate limit روی upload endpoints
```

### API Security
```
✅ JWT access token (15min) + refresh token (30d)
✅ Refresh token rotation
✅ Rate limiting (NestJS ThrottlerModule)
✅ Helmet (HTTP security headers)
✅ CORS whitelist
✅ Input validation (class-validator / Zod)
✅ SQL injection protection (Prisma parameterized queries)
✅ Soft delete (نگهداری audit trail)
✅ Audit log برای عملیات حساس
```

---

## ۸. ترتیب پیاده‌سازی (بعد از تأیید)

```
Phase 1: Infrastructure
  → Monorepo setup (pnpm + Turborepo)
  → Docker Compose (PG, Redis, MinIO)
  → NestJS bootstrap + Prisma setup
  → Next.js bootstrap + Tailwind + shadcn/ui

Phase 2: Auth
  → Prisma migrations
  → OTP simulation logic
  → JWT strategy
  → Login page (UI)

Phase 3: Chat System
  → Conversations & Messages API
  → Socket.IO gateway
  → Chat UI (bubbles, input, voice recorder)
  → File upload

Phase 4: Newsletter
  → Newsletter API (CRUD)
  → Socket events
  → Newsletter feed UI
  → Reactions & Seen

Phase 5: Admin Panel
  → Conversation list
  → Admin chat view
  → Newsletter management
  → Stats dashboard

Phase 6: Polish
  → RTL refinements
  → Mobile responsiveness
  → Error handling
  → Loading states
  → Audit logging
```

---

*طراحی توسط Claude — در انتظار تأیید برای شروع پیاده‌سازی*
