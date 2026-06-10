# KarAmoozYar — Project Introduction

You are building a production-grade realtime communication platform called “KarAmoozYar” for:
“Markaz-e Karshenasan Rasmi Dadgostari Mazandaran”
(Center of Official Judiciary Experts of Mazandaran).

The application is designed for trainees (“KarAmooz”) to communicate directly with administrators and receive official announcements through a controlled newsletter/channel system.

This platform must feel modern, professional, secure, minimal, and trustworthy — similar to high-quality messaging applications like Telegram or WhatsApp, while preserving a formal judicial/corporate identity.

Core Philosophy:

* Minimal and elegant UI
* Fast and realtime experience
* Secure communication
* Official and professional atmosphere
* Simple UX for non-technical users
* Fully responsive
* Persian RTL-first design

Primary Features:

1. Realtime Messaging System
2. Official Newsletter / Channel System
3. Admin Dashboard
4. Secure User Authentication
5. File & Voice Sharing
6. Seen / Reaction System
7. Realtime Notifications

Users:

* Trainee Users
* Admins

Authentication:
Each trainee logs into their own private profile using:

* National ID
* Temporary password or OTP-ready architecture

Each user has:

* First Name
* Last Name
* National ID
* Phone Number
* Judicial Domain
* Expertise Field

Realtime Messaging Requirements:
The messaging experience must closely resemble professional messengers.

Features:

* Realtime chat using Socket.IO
* Text messages
* Emoji support
* Voice message support (very important)
* Image upload
* File upload
* File size limit: 15MB
* Message copy
* Message delete
* Message edit
* Seen status
* Typing-ready architecture
* Message sorting by latest activity
* Conversation list like Telegram/WhatsApp
* Smart auto-scroll behavior
* Mobile-friendly UX

Newsletter / Channel Requirements:
Admins can publish:

* Text
* Voice
* Images
* Files

Users can:

* Read posts
* React to posts
* Be tracked in seen/read system

Users cannot publish content inside the newsletter.

Admin Dashboard:
The admin panel must behave like a professional communication center.

Features:

* Conversation management
* Realtime message handling
* Newsletter management
* Seen analytics
* Reactions
* Edit/Delete newsletter posts
* Notification badges
* Sort by latest activity
* Realtime updates

Technical Requirements:
Architecture must be enterprise-ready and scalable.

Required Stack:

* Monorepo architecture
* pnpm workspace
* Turborepo
* Next.js 16+
* React 19+
* NestJS 11+
* PostgreSQL
* Prisma 7+
* Redis
* Socket.IO
* TailwindCSS
* shadcn/ui
* Dockerized services
* MinIO/S3 storage
* TypeScript strict mode

Deployment Environment:
Current deployment target:

* Windows VPS

Important:
The project must be structured using Docker so it works on:

* Windows VPS
* Linux VPS

Use Docker Compose for:

* PostgreSQL
* Redis
* MinIO

The codebase must remain fully production-ready and easily deployable to Ubuntu Linux later.

Design System:
Theme:

* White
* Professional Blue
* Soft Gray

Style:

* Minimal
* Modern
* Formal
* Clean
* Elegant
* Judicial / Official atmosphere

UX should feel:

* Smooth
* Intelligent
* Lightweight
* Professional
* Trustworthy

Important Engineering Rules:

* Use latest stable package versions
* Never use outdated patterns
* TypeScript strict mode enabled
* Modular architecture
* Scalable folder structure
* Clean code principles
* Reusable components
* Secure APIs
* RBAC authorization
* File validation
* Audit logging
* Soft delete strategy
* Production-grade error handling

Before writing code:

1. Design architecture
2. Design database schema
3. Design API contracts
4. Design websocket events
5. Design frontend routes
6. Design reusable UI system
7. Then start implementation step-by-step
