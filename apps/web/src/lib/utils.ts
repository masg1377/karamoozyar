import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '۰ بایت';
  const k = 1024;
  const sizes = ['بایت', 'کیلوبایت', 'مگابایت'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Simple Persian time ago
export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'همین الان';
  if (diffMin < 60) return `${diffMin} دقیقه پیش`;
  if (diffHour < 24) return `${diffHour} ساعت پیش`;
  if (diffDay < 7) return `${diffDay} روز پیش`;
  return new Intl.DateTimeFormat('fa-IR', { month: 'long', day: 'numeric' }).format(date);
}

export function formatTime(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateStr));
}

/** آیا دو تاریخ در یک روز تقویمی (محلی) هستند؟ */
export function isSameDay(a: string | Date, b: string | Date): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** برچسب روز به سبک تلگرام: «امروز» / «دیروز» / تاریخ کامل شمسی */
export function formatDayLabel(dateStr: string | Date): string {
  const d = new Date(dateStr);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'امروز';
  if (diffDays === 1) return 'دیروز';
  return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
}

/**
 * Newest message id that is SAFE to mark as seen: a durably persisted server
 * message. Never returns an optimistic/pending/failed local item — whose `id`
 * is still the temporary clientMessageId and has no `messages` row yet, which
 * would make the server's messageSeen.upsert raise a foreign-key error
 * (message_seen_messageId_fkey). Returns null when nothing qualifies.
 */
export function lastSeenableMessageId(
  messages: Array<{ id: string; clientMessageId?: string | null; deliveryState?: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const ds = m.deliveryState;
    const pending =
      ds === 'queued' ||
      ds === 'uploading' ||
      ds === 'sending' ||
      ds === 'awaiting-connection' ||
      ds === 'rebuilding-connection' ||
      ds === 'retrying' ||
      ds === 'failed';
    const optimistic = m.clientMessageId != null && m.id === m.clientMessageId;
    if (!pending && !optimistic) return m.id;
  }
  return null;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isVoiceMime(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Stable, collision-resistant client message identity used both as the
 * optimistic message id and the server-side idempotency key. Prefers the
 * platform UUID; falls back for older browsers.
 */
export function generateClientMessageId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cm_${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/** Drop the `;codecs=...` parameter so the bare MIME matches server allow-lists. */
export function baseMimeType(mimeType: string): string {
  return (mimeType.split(';')[0] ?? mimeType).trim().toLowerCase();
}

/** Pick a sensible file extension for a recorded/blob MIME type. */
export function extensionForMime(mimeType: string): string {
  const base = baseMimeType(mimeType);
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[base] ?? 'bin';
}
