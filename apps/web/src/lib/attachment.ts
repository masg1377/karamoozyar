import api from './api-client';

const cache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Fetch a short-lived signed URL for an attachment.
 * Results are cached for 55 minutes (URLs expire in 60 min).
 *
 * This is the fix for 401 on browser <img>/<audio>/<video> preview:
 * - Raw MinIO URLs require S3 auth which browser media tags cannot provide
 * - Signed URLs are self-authenticating temporary URLs that work in any browser tag
 */
export async function getAttachmentSignedUrl(
  attachmentId: string,
  type: 'newsletter' | 'message' = 'newsletter',
): Promise<string> {
  const cacheKey = `${type}:${attachmentId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const res = await api.get<{ data: { url: string; expiresIn: number } }>(
    `/uploads/attachments/${attachmentId}/signed-url?type=${type}`,
  );
  const { url } = res.data.data;
  cache.set(cacheKey, { url, expiresAt: Date.now() + 55 * 60 * 1000 });
  return url;
}
