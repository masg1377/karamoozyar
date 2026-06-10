'use client';

import { useState, useRef, useEffect } from 'react';
import api from '@/lib/api-client';
import { getAttachmentSignedUrl } from '@/lib/attachment';
import { FILE_LIMITS } from '@karamooziyar/shared';
import type { NewsletterPostDto, NewsletterBlock } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { formatFileSize } from '@/lib/utils';
import {
  X, Trash2, ChevronUp, ChevronDown,
  FileText, Image, Mic, Film, AlignLeft, Hash, Eye, Send, ImagePlus,
} from 'lucide-react';
import { toast } from 'sonner';

const uuidv4 = () => crypto.randomUUID();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PendingBlock extends NewsletterBlock {
  uploading?: boolean;
  uploadError?: string;
  localPreviewUrl?: string;
  uploadMeta?: {
    fileKey: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    duration?: number | null;
  };
}

// ─── Preview Block ────────────────────────────────────────────────────────────

function PreviewBlock({ block }: { block: PendingBlock }) {
  if (block.type === 'TEXT') {
    return <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{block.content}</p>;
  }
  if (block.type === 'IMAGE' && block.localPreviewUrl) {
    return (
      <div>
        <img src={block.localPreviewUrl} alt={block.caption ?? ''} className="w-full rounded-xl object-cover max-h-64" />
        {block.caption && <p className="text-xs text-gray-400 mt-1 text-center">{block.caption}</p>}
      </div>
    );
  }
  if (block.type === 'VIDEO' && block.localPreviewUrl) {
    return (
      <div>
        <video src={block.localPreviewUrl} controls className="w-full rounded-xl" />
        {block.caption && <p className="text-xs text-gray-400 mt-1 text-center">{block.caption}</p>}
      </div>
    );
  }
  if (block.type === 'AUDIO' && block.localPreviewUrl) {
    return (
      <div>
        <audio src={block.localPreviewUrl} controls className="w-full" />
        {block.caption && <p className="text-xs text-gray-400 mt-1 text-center">{block.caption}</p>}
      </div>
    );
  }
  if (block.meta) {
    return (
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5">
        <FileText className="w-4 h-4 text-primary-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-700 truncate">{block.meta.fileName}</p>
          <p className="text-xs text-gray-400">{formatFileSize(block.meta.fileSize)}</p>
        </div>
      </div>
    );
  }
  return null;
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({
  blocks, bannerBlock, title, hashtags, onClose,
}: {
  blocks: PendingBlock[];
  bannerBlock: PendingBlock | null;
  title: string;
  hashtags: string[];
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed inset-x-4 top-8 bottom-8 z-50 bg-gray-50 rounded-2xl shadow-2xl max-w-lg mx-auto overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 flex-shrink-0">
          <p className="font-semibold text-gray-800 text-sm">پیش‌نمایش</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="bg-white border border-gray-100 shadow-sm">
            {/* Banner */}
            {bannerBlock?.localPreviewUrl && (
              <img src={bannerBlock.localPreviewUrl} alt="بنر" className="w-full object-cover max-h-48" />
            )}
            <div className="p-4 space-y-3">
              {title && <h2 className="font-bold text-gray-900 text-base">{title}</h2>}
              {blocks.map((block) => <PreviewBlock key={block.id} block={block} />)}
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-50">
                  {hashtags.map((tag) => (
                    <span key={tag} className="text-xs text-primary-600 bg-primary-50 px-2 py-0.5 rounded-full">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Block Editor ─────────────────────────────────────────────────────────────

function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: PendingBlock[];
  onChange: (blocks: PendingBlock[] | ((prev: PendingBlock[]) => PendingBlock[])) => void;
}) {
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingType, setPendingType] = useState<'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | null>(null);

  const addText = () => {
    onChange([...blocks, { id: uuidv4(), type: 'TEXT', content: '', order: blocks.length }]);
  };

  const uploadMedia = async (file: File, type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE') => {
    if (file.size > FILE_LIMITS.MAX_SIZE_BYTES) {
      toast.error(`حداکثر حجم فایل ${FILE_LIMITS.MAX_SIZE_MB} مگابایت است`);
      return;
    }
    const tempId = uuidv4();
    const localPreviewUrl = ['IMAGE', 'VIDEO'].includes(type) ? URL.createObjectURL(file) : undefined;

    onChange([...blocks, { id: tempId, type, order: blocks.length, uploading: true, localPreviewUrl }]);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: { id: string; fileKey: string; fileUrl: string; fileName: string; mimeType: string; fileSize: number; duration: number | null } }>(
        '/uploads/newsletter-attachment', form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const data = res.data.data;
      onChange((prev: PendingBlock[]) =>
        prev.map((b) =>
          b.id === tempId
            ? {
                ...b, attachmentId: data.id, uploading: false, uploadError: undefined,
                meta: { fileName: data.fileName, mimeType: data.mimeType, fileSize: data.fileSize, duration: data.duration },
                uploadMeta: { fileKey: data.fileKey, fileUrl: data.fileUrl, fileName: data.fileName, mimeType: data.mimeType, fileSize: data.fileSize, duration: data.duration },
              }
            : b,
        ) as PendingBlock[],
      );
    } catch {
      onChange((prev: PendingBlock[]) =>
        prev.map((b) => b.id === tempId ? { ...b, uploading: false, uploadError: 'آپلود ناموفق' } : b) as PendingBlock[],
      );
      toast.error('آپلود فایل ناموفق بود');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>, type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE') => {
    const file = e.target.files?.[0];
    if (file) void uploadMedia(file, type);
    e.target.value = '';
    setPendingType(null);
  };

  const updateBlock = (id: string, patch: Partial<PendingBlock>) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBlock = (id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (b?.localPreviewUrl) URL.revokeObjectURL(b.localPreviewUrl);
    onChange(blocks.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i })));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const newBlocks = [...blocks];
    const target = idx + dir;
    if (target < 0 || target >= newBlocks.length) return;
    [newBlocks[idx], newBlocks[target]] = [newBlocks[target]!, newBlocks[idx]!];
    onChange(newBlocks.map((b, i) => ({ ...b, order: i })));
  };

  // suppress lint warning for pendingType
  void pendingType;

  return (
    <div className="space-y-3">
      {blocks.map((block, idx) => (
        <div key={block.id} className="relative group rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
          <div className="absolute top-2 left-2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button onClick={() => moveBlock(block.id, -1)} disabled={idx === 0}
              className="w-6 h-6 bg-white rounded-lg shadow-sm flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30">
              <ChevronUp className="w-3 h-3" />
            </button>
            <button onClick={() => moveBlock(block.id, 1)} disabled={idx === blocks.length - 1}
              className="w-6 h-6 bg-white rounded-lg shadow-sm flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:opacity-30">
              <ChevronDown className="w-3 h-3" />
            </button>
            <button onClick={() => removeBlock(block.id)}
              className="w-6 h-6 bg-white rounded-lg shadow-sm flex items-center justify-center text-red-400 hover:text-red-600">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <div className="p-3">
            {block.type === 'TEXT' && (
              <textarea value={block.content ?? ''} onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                placeholder="متن پاراگراف را بنویسید..." rows={3}
                className="w-full resize-none bg-white rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-200 leading-relaxed border border-gray-100" />
            )}
            {['IMAGE', 'VIDEO', 'AUDIO', 'FILE'].includes(block.type) && (
              <div>
                {block.uploading ? (
                  <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100">
                    <LoadingSpinner size="sm" />
                    <span className="text-xs text-gray-400">در حال آپلود...</span>
                  </div>
                ) : block.uploadError ? (
                  <div className="p-3 bg-red-50 rounded-xl border border-red-100 text-xs text-red-500">{block.uploadError}</div>
                ) : (
                  <div className="space-y-2">
                    {block.type === 'IMAGE' && block.localPreviewUrl && (
                      <img src={block.localPreviewUrl} alt="" className="w-full max-h-48 rounded-xl object-cover" />
                    )}
                    {block.type === 'VIDEO' && block.localPreviewUrl && (
                      <video src={block.localPreviewUrl} controls className="w-full rounded-xl max-h-48" />
                    )}
                    {block.type === 'AUDIO' && block.localPreviewUrl && (
                      <audio src={block.localPreviewUrl} controls className="w-full" />
                    )}
                    {block.type === 'FILE' && block.meta && (
                      <div className="flex items-center gap-2 bg-white rounded-xl p-2.5 border border-gray-100">
                        <FileText className="w-4 h-4 text-primary-500 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-700 truncate">{block.meta.fileName}</p>
                          <p className="text-xs text-gray-400">{formatFileSize(block.meta.fileSize)}</p>
                        </div>
                      </div>
                    )}
                    <input type="text" value={block.caption ?? ''} onChange={(e) => updateBlock(block.id, { caption: e.target.value })}
                      placeholder="توضیح اختیاری..."
                      className="w-full bg-white rounded-xl px-3 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-200 border border-gray-100" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={addText} className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition-colors">
          <AlignLeft className="w-3.5 h-3.5" /> متن
        </button>
        <button onClick={() => { setPendingType('IMAGE'); setTimeout(() => imageRef.current?.click(), 0); }}
          className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition-colors">
          <Image className="w-3.5 h-3.5" /> تصویر
        </button>
        <button onClick={() => { setPendingType('VIDEO'); setTimeout(() => videoRef.current?.click(), 0); }}
          className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition-colors">
          <Film className="w-3.5 h-3.5" /> ویدیو
        </button>
        <button onClick={() => { setPendingType('AUDIO'); setTimeout(() => audioRef.current?.click(), 0); }}
          className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition-colors">
          <Mic className="w-3.5 h-3.5" /> صدا
        </button>
        <button onClick={() => { setPendingType('FILE'); setTimeout(() => fileRef.current?.click(), 0); }}
          className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl transition-colors">
          <FileText className="w-3.5 h-3.5" /> فایل
        </button>
      </div>

      <input ref={imageRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
        onChange={(e) => handleFileInput(e, 'IMAGE')} />
      <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden"
        onChange={(e) => handleFileInput(e, 'VIDEO')} />
      <input ref={audioRef} type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/webm" className="hidden"
        onChange={(e) => handleFileInput(e, 'AUDIO')} />
      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip" className="hidden"
        onChange={(e) => handleFileInput(e, 'FILE')} />
    </div>
  );
}

// ─── Composer Modal (exported) ────────────────────────────────────────────────

export function NewsletterComposer({
  editingPost,
  onClose,
  onSaved,
}: {
  editingPost?: NewsletterPostDto | null;
  onClose: () => void;
  onSaved: (post: NewsletterPostDto) => void;
}) {
  const [title, setTitle] = useState(editingPost?.title ?? '');

  // Banner is stored SEPARATELY — never inside `blocks`
  // When editing: first IMAGE block (order=0) is the banner; rest are content blocks
  const [bannerBlock, setBannerBlock] = useState<PendingBlock | null>(() => {
    if (!editingPost?.contentBlocks?.length) return null;
    const first = (editingPost.contentBlocks as PendingBlock[]).find((b) => b.type === 'IMAGE' && b.order === 0);
    return first ? { ...first } : null;
  });

  const [blocks, setBlocks] = useState<PendingBlock[]>(() => {
    if (editingPost?.contentBlocks?.length) {
      // Exclude the banner block (first IMAGE at order=0) from content blocks
      const hasBanner = (editingPost.contentBlocks as PendingBlock[]).some((b) => b.type === 'IMAGE' && b.order === 0);
      const contentBlocks = hasBanner
        ? (editingPost.contentBlocks as PendingBlock[]).filter((b) => !(b.type === 'IMAGE' && b.order === 0))
        : (editingPost.contentBlocks as PendingBlock[]);
      return contentBlocks.map((b, i) => ({ ...b, order: i } as PendingBlock));
    }
    return [];
  });

  const [hashtags, setHashtags] = useState<string[]>(editingPost?.hashtags ?? []);
  const [hashtagInput, setHashtagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Populate signed URLs for existing blocks (content + banner) when editing
  useEffect(() => {
    if (!editingPost?.contentBlocks?.length) return;
    // Content blocks
    blocks.forEach((block) => {
      if (block.attachmentId && !block.localPreviewUrl) {
        getAttachmentSignedUrl(block.attachmentId, 'newsletter')
          .then((url) => setBlocks((prev) => prev.map((b) => b.id === block.id ? { ...b, localPreviewUrl: url } : b)))
          .catch(() => {/* silent */});
      }
    });
    // Banner block
    if (bannerBlock?.attachmentId && !bannerBlock.localPreviewUrl) {
      getAttachmentSignedUrl(bannerBlock.attachmentId, 'newsletter')
        .then((url) => setBannerBlock((prev) => prev ? { ...prev, localPreviewUrl: url } : prev))
        .catch(() => {/* silent */});
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bannerRef = useRef<HTMLInputElement>(null);
  const [bannerUploading, setBannerUploading] = useState(false);

  const uploadBanner = async (file: File) => {
    if (file.size > FILE_LIMITS.MAX_SIZE_BYTES) { toast.error('حجم فایل زیاد است'); return; }
    setBannerUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: { id: string; fileKey: string; fileUrl: string; fileName: string; mimeType: string; fileSize: number; duration: number | null } }>(
        '/uploads/newsletter-attachment', form, { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const data = res.data.data;
      // Revoke old banner preview if any
      if (bannerBlock?.localPreviewUrl) URL.revokeObjectURL(bannerBlock.localPreviewUrl);
      setBannerBlock({
        id: uuidv4(), type: 'IMAGE', order: 0,
        attachmentId: data.id,
        localPreviewUrl: URL.createObjectURL(file),
        meta: { fileName: data.fileName, mimeType: data.mimeType, fileSize: data.fileSize, duration: data.duration },
        uploadMeta: { fileKey: data.fileKey, fileUrl: data.fileUrl, fileName: data.fileName, mimeType: data.mimeType, fileSize: data.fileSize, duration: data.duration },
      });
    } catch { toast.error('آپلود بنر ناموفق بود'); }
    finally { setBannerUploading(false); }
  };

  const removeBanner = () => {
    if (bannerBlock?.localPreviewUrl) URL.revokeObjectURL(bannerBlock.localPreviewUrl);
    setBannerBlock(null);
  };

  const addHashtag = (val: string) => {
    const tag = val.trim().replace(/^#/, '');
    if (tag && !hashtags.includes(tag)) setHashtags([...hashtags, tag]);
    setHashtagInput('');
  };

  const canPublish = blocks.length > 0 && !blocks.some((b) => b.uploading) && !submitting;

  const handleSubmit = async () => {
    if (!canPublish) return;
    setSubmitting(true);
    try {
      // Combine banner (order=0) + content blocks (order=1,2,...)
      const allBlocks: PendingBlock[] = [
        ...(bannerBlock ? [{ ...bannerBlock, order: 0 }] : []),
        ...blocks.map((b, i) => ({ ...b, order: bannerBlock ? i + 1 : i })),
      ];
      const payload = {
        title: title.trim() || undefined,
        contentBlocks: allBlocks.map(({ id, type, content, attachmentId, meta, caption, order }) => ({
          id, type, content, attachmentId, meta, caption, order,
        })),
        hashtags,
      };
      const res = editingPost
        ? await api.patch<{ data: NewsletterPostDto }>(`/newsletter/${editingPost.id}`, payload)
        : await api.post<{ data: NewsletterPostDto }>('/newsletter', payload);

      onSaved(res.data.data);
      toast.success(editingPost ? 'پست ویرایش شد' : 'پست منتشر شد');
    } catch {
      toast.error('عملیات ناموفق بود');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-6 bottom-6 z-40 bg-white rounded-2xl shadow-2xl max-w-2xl mx-auto flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <p className="font-bold text-gray-800">{editingPost ? 'ویرایش پست' : 'پست جدید'}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-xl transition-colors">
              <Eye className="w-3.5 h-3.5" /> پیش‌نمایش
            </button>
            <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Banner upload */}
          <div className="relative rounded-2xl overflow-hidden border border-dashed border-gray-200 bg-gray-50">
            {bannerBlock?.localPreviewUrl ? (
              <div className="relative">
                <img src={bannerBlock.localPreviewUrl} alt="بنر" className="w-full max-h-40 object-cover" />
                <button
                  onClick={removeBanner}
                  className="absolute top-2 left-2 w-7 h-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => bannerRef.current?.click()}
                  className="absolute top-2 right-2 text-xs bg-black/50 hover:bg-black/70 text-white px-2.5 py-1 rounded-full transition-colors"
                >
                  تغییر بنر
                </button>
              </div>
            ) : bannerUploading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
                <LoadingSpinner size="sm" /> <span className="text-xs">در حال آپلود بنر...</span>
              </div>
            ) : (
              <button
                onClick={() => bannerRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-5 text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
              >
                <ImagePlus className="w-6 h-6" />
                <span className="text-xs">افزودن تصویر بنر (اختیاری)</span>
              </button>
            )}
            <input ref={bannerRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadBanner(f); e.target.value = ''; }} />
          </div>

          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان اختیاری..."
            className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-200 border border-gray-100" />

          <BlockEditor blocks={blocks} onChange={setBlocks} />

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Hash className="w-4 h-4 text-gray-400" />
              <p className="text-xs font-medium text-gray-500">هشتگ‌ها</p>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {hashtags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 text-xs text-primary-700 bg-primary-50 border border-primary-100 px-2.5 py-1 rounded-full">
                  #{tag}
                  <button onClick={() => setHashtags(hashtags.filter((t) => t !== tag))} className="text-primary-400 hover:text-red-400">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <input type="text" value={hashtagInput} onChange={(e) => setHashtagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === ',') { e.preventDefault(); addHashtag(hashtagInput); }
              }}
              onBlur={() => hashtagInput && addHashtag(hashtagInput)}
              placeholder="هشتگ بزنید و Enter بفشارید..."
              className="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 border border-gray-100" />
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-gray-100 px-5 py-4 flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {blocks.length} بلاک{blocks.some((b) => b.uploading) && ' · در حال آپلود...'}
          </p>
          <button onClick={handleSubmit} disabled={!canPublish}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors">
            {submitting ? <LoadingSpinner size="sm" /> : <Send className="w-4 h-4" />}
            {editingPost ? 'ذخیره' : 'انتشار'}
          </button>
        </div>
      </div>

      {showPreview && (
        <PreviewModal blocks={blocks} bannerBlock={bannerBlock} title={title} hashtags={hashtags} onClose={() => setShowPreview(false)} />
      )}
    </>
  );
}
