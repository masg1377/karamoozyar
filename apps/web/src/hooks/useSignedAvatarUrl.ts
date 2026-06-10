'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api-client';

/**
 * Cache: fileKey → { signedUrl, expiresAt }
 * Shared across all component instances — module-level singleton.
 */
const cache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Extract the S3/MinIO object key from a full URL.
 * e.g. "http://localhost:9000/karamooziyar/profiles/abc.jpg" → "profiles/abc.jpg"
 */
function extractKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    // Strip leading slash and bucket name segment
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    // parts[0] is bucket name, rest is the key
    return parts.slice(1).join('/');
  } catch {
    return null;
  }
}

/**
 * Returns a resolved avatar URL:
 * - If avatarUrl is null/empty → returns null (use initials)
 * - If avatarUrl is a relative URL or HTTPS URL → return as-is
 * - If avatarUrl is a MinIO/S3 URL → fetch a presigned URL and cache it
 */
export function useSignedAvatarUrl(avatarUrl: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarUrl) {
      setResolved(null);
      return;
    }

    // If already HTTPS (production S3) or a relative path, use directly
    if (avatarUrl.startsWith('https://') || avatarUrl.startsWith('/')) {
      setResolved(avatarUrl);
      return;
    }

    // MinIO / local S3 URL — needs presigning
    const key = extractKey(avatarUrl);
    if (!key) {
      // Fallback: try to use as-is
      setResolved(avatarUrl);
      return;
    }

    // Check cache
    const cached = cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now + 60_000) {
      setResolved(cached.url);
      return;
    }

    // Fetch presigned URL
    let cancelled = false;
    api
      .get<{ data: { url: string; expiresIn: number } }>(`/uploads/presign?key=${encodeURIComponent(key)}`)
      .then((res) => {
        if (cancelled) return;
        const { url, expiresIn } = res.data.data;
        if (url) {
          cache.set(key, { url, expiresAt: Date.now() + expiresIn * 1000 });
          setResolved(url);
        } else {
          setResolved(null);
        }
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => { cancelled = true; };
  }, [avatarUrl]);

  return resolved;
}
