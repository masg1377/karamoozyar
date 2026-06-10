'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn, formatDate, formatFileSize } from '@/lib/utils';
import type { NewsletterPostDto, NewsletterBlock } from '@karamooziyar/shared';
import { REACTION_EMOJI_MAP, ReactionEmoji } from '@karamooziyar/shared';
import { Download, FileText, Pin, ChevronLeft, Image as ImageIcon, Film, Mic, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import { useNewsletterStore } from '@/store/newsletter.store';
import { toast } from 'sonner';
import api from '@/lib/api-client';
import { getAttachmentSignedUrl } from '@/lib/attachment';
import { createPortal } from 'react-dom';

// ─── Banner image ─────────────────────────────────────────────────────────────

function BannerImage({ block, full = false }: { block: NewsletterBlock; full?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!block.attachmentId) return;
    getAttachmentSignedUrl(block.attachmentId, 'newsletter').then(setSrc).catch(() => setSrc(null));
  }, [block.attachmentId]);

  if (!src) return full
    ? <div className="w-full h-48 bg-gray-100 animate-pulse" />
    : <div className="w-16 h-16 rounded-xl bg-gray-100 animate-pulse flex-shrink-0" />;

  if (full) {
    return <img src={src} alt={block.caption ?? 'بنر'} className="w-full object-cover max-h-64 cursor-pointer"
      onClick={() => window.open(src, '_blank')} />;
  }
  return <img src={src} alt={block.caption ?? 'بنر'} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" />;
}

// ─── Block renderer (detail page) ────────────────────────────────────────────

function MediaBlock({ block }: { block: NewsletterBlock }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!block.attachmentId) return;
    getAttachmentSignedUrl(block.attachmentId, 'newsletter').then(setSrc).catch(() => setSrc(null));
  }, [block.attachmentId]);

  if (block.type === 'TEXT') return (
    <div className="px-4 py-1">
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{block.content}</p>
    </div>
  );

  if (block.type === 'IMAGE') return (
    <div className="px-4 py-1">
      {src
        ? <img src={src} alt={block.meta?.fileName ?? 'تصویر'} className="w-full rounded-xl object-cover max-h-80 cursor-pointer" onClick={() => window.open(src, '_blank')} />
        : <div className="w-full h-32 rounded-xl bg-gray-100 animate-pulse" />}
      {block.caption && <p className="text-xs text-gray-500 mt-1 text-center">{block.caption}</p>}
    </div>
  );

  if (block.type === 'VIDEO') return (
    <div className="px-4 py-1">
      {src
        ? <video src={src} controls className="w-full rounded-xl max-h-80" playsInline />
        : <div className="w-full h-32 rounded-xl bg-gray-100 animate-pulse" />}
      {block.caption && <p className="text-xs text-gray-500 mt-1 text-center">{block.caption}</p>}
    </div>
  );

  if (block.type === 'AUDIO') return (
    <div className="px-4 py-1">
      {src ? <audio controls src={src} className="w-full" /> : <div className="w-full h-10 rounded-xl bg-gray-100 animate-pulse" />}
      {block.caption && <p className="text-xs text-gray-500 mt-1 text-center">{block.caption}</p>}
    </div>
  );

  if (block.type === 'FILE') return (
    <div className="px-4 py-1">
      {src
        ? <a href={src} download={block.meta?.fileName} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-colors">
            <FileText className="w-5 h-5 text-primary-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-700 truncate">{block.meta?.fileName ?? 'فایل'}</p>
              {block.meta?.fileSize != null && <p className="text-xs text-gray-400">{formatFileSize(block.meta.fileSize)}</p>}
            </div>
            <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </a>
        : <div className="w-full h-14 rounded-xl bg-gray-100 animate-pulse" />}
    </div>
  );

  return null;
}

// ─── Legacy attachments ───────────────────────────────────────────────────────

function LegacyAttachments({ post }: { post: NewsletterPostDto }) {
  if (!post.attachments?.length) return null;
  return (
    <div className="px-4 pb-3 space-y-2">
      {post.attachments.map((att) => {
        const mt = att.mimeType ?? '';
        if (mt.startsWith('image/')) return <img key={att.id} src={att.fileUrl} alt={att.fileName} className="w-full rounded-xl object-cover max-h-64" />;
        if (mt.startsWith('audio/')) return <audio key={att.id} controls src={att.fileUrl} className="w-full" />;
        return (
          <a key={att.id} href={att.fileUrl} download={att.fileName} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-colors">
            <FileText className="w-5 h-5 text-primary-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-700 truncate">{att.fileName}</p>
              <p className="text-xs text-gray-400">{formatFileSize(att.fileSize)}</p>
            </div>
            <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </a>
        );
      })}
    </div>
  );
}

// ─── Reactions bar ────────────────────────────────────────────────────────────

const REACTIONS = Object.entries(REACTION_EMOJI_MAP) as [ReactionEmoji, string][];

export function ReactionsBar({ post, isAdmin }: { post: NewsletterPostDto; isAdmin?: boolean }) {
  const socket = getSocket();
  const { updatePost } = useNewsletterStore();
  const [showReactions, setShowReactions] = useState(false);

  const handleReact = (emoji: ReactionEmoji) => {
    socket.emit(SOCKET_EVENTS.NEWSLETTER_REACT, { postId: post.id, emoji });
    setShowReactions(false);
    const s = { ...post.reactionSummary };
    if (post.myReaction) s[post.myReaction] = Math.max(0, (s[post.myReaction] ?? 1) - 1);
    s[emoji] = (s[emoji] ?? 0) + 1;
    updatePost(post.id, { reactionSummary: s, myReaction: emoji });
  };

  const handleRemoveReact = () => {
    socket.emit(SOCKET_EVENTS.NEWSLETTER_REACT_REMOVE, { postId: post.id });
    const s = { ...post.reactionSummary };
    if (post.myReaction) s[post.myReaction] = Math.max(0, (s[post.myReaction] ?? 1) - 1);
    updatePost(post.id, { reactionSummary: s, myReaction: null });
  };

  const total = Object.values(post.reactionSummary).reduce((a, b) => a + b, 0);

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {total > 0 && (
          <div className="flex items-center gap-1 bg-gray-50 rounded-full px-2 py-1">
            {REACTIONS.filter(([e]) => (post.reactionSummary[e] ?? 0) > 0).slice(0, 3)
              .map(([e, icon]) => <span key={e} className="text-sm">{icon}</span>)}
            <span className="text-xs text-gray-500 mr-0.5">{total}</span>
          </div>
        )}
        <div className="relative">
          <button
            onClick={() => post.myReaction ? handleRemoveReact() : setShowReactions(!showReactions)}
            className={cn(
              'flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full transition-colors',
              post.myReaction ? 'bg-primary-50 text-primary-600 border border-primary-200' : 'text-gray-400 hover:bg-gray-100 border border-transparent',
            )}
          >
            {post.myReaction ? REACTION_EMOJI_MAP[post.myReaction] : '🙂'}
            <span>واکنش</span>
          </button>
          {showReactions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
              <div className="absolute bottom-full mb-2 right-0 z-20 bg-white rounded-2xl shadow-lg border border-gray-100 p-2 flex gap-1">
                {REACTIONS.map(([e, icon]) => (
                  <button key={e} onClick={() => handleReact(e)}
                    className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors text-xl">
                    {icon}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {isAdmin
        ? <span className="text-xs text-gray-400">{post.seenCount} بازدید</span>
        : post.isSeen ? <span className="text-xs text-primary-400">✓ دیده شد</span> : null}
    </div>
  );
}

// ─── Three-dot menu — fixed portal to avoid overflow clipping ────────────────

function ThreeDotMenu({ onEdit, onDelete, onPin, isPinned }: {
  onEdit: () => void;
  onDelete: () => void;
  onPin?: () => void;
  isPinned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuWidth = 144; // min-w in px
    const margin = 8;
    // Prefer aligning right edge of menu to right edge of button
    let left = rect.right - menuWidth;
    // Clamp so it doesn't go off left or right edge
    left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
    // If menu would go below viewport, open upward
    const menuHeight = 120; // approx
    const top = rect.bottom + menuHeight > window.innerHeight
      ? rect.top - menuHeight - 4
      : rect.bottom + 4;
    setPos({ top, left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors flex-shrink-0"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden min-w-[144px]"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={(e) => { e.stopPropagation(); onEdit(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            <Pencil className="w-3.5 h-3.5 text-primary-500" /> ویرایش
          </button>
          {onPin && (
            <button onClick={(e) => { e.stopPropagation(); onPin(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
              <Pin className="w-3.5 h-3.5 text-amber-500" />
              {isPinned ? 'برداشتن پین' : 'پین کردن'}
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> حذف
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Compact list card ────────────────────────────────────────────────────────

interface NewsletterListCardProps {
  post: NewsletterPostDto;
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
}

export function NewsletterListCard({ post, onClick, onEdit, onDelete, onPin }: NewsletterListCardProps) {
  const hasBlocks = post.contentBlocks && post.contentBlocks.length > 0;
  const textBlock = hasBlocks ? post.contentBlocks.find((b) => b.type === 'TEXT') : null;
  const previewText = textBlock?.content ?? post.body ?? '';
  const firstImageBlock = hasBlocks ? post.contentBlocks.find((b) => b.type === 'IMAGE') : null;
  const otherMediaBlocks = hasBlocks ? post.contentBlocks.filter((b) => b.type !== 'TEXT' && b.type !== 'IMAGE') : [];
  const total = Object.values(post.reactionSummary).reduce((a, b) => a + b, 0);
  const isAdmin = !!(onEdit || onDelete);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-primary-100 transition-all">
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Thumbnail */}
          {firstImageBlock?.attachmentId && <BannerImage block={firstImageBlock} />}

          {/* Content */}
          <button onClick={onClick} className="flex-1 min-w-0 text-right">
            {post.title && <h3 className="text-sm font-semibold text-gray-800 truncate mb-0.5">{post.title}</h3>}
            {previewText && (
              <p className={cn(
                'text-xs text-gray-500 leading-relaxed',
                post.title ? 'line-clamp-2 mb-1.5' : 'line-clamp-3 font-medium text-gray-700 mb-1.5',
              )}>
                {previewText}
              </p>
            )}
            {otherMediaBlocks.length > 0 && (
              <div className="flex items-center gap-2 mb-1.5">
                {otherMediaBlocks.some((b) => b.type === 'VIDEO') && <span className="flex items-center gap-0.5 text-xs text-gray-400"><Film className="w-3 h-3" /> ویدیو</span>}
                {otherMediaBlocks.some((b) => b.type === 'AUDIO') && <span className="flex items-center gap-0.5 text-xs text-gray-400"><Mic className="w-3 h-3" /> صدا</span>}
                {otherMediaBlocks.some((b) => b.type === 'FILE') && <span className="flex items-center gap-0.5 text-xs text-gray-400"><FileText className="w-3 h-3" /> فایل</span>}
                {!firstImageBlock && post.contentBlocks?.some((b) => b.type === 'IMAGE') && <span className="flex items-center gap-0.5 text-xs text-gray-400"><ImageIcon className="w-3 h-3" /> تصویر</span>}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-400">{formatDate(post.createdAt)}</span>
              {isAdmin && <span className="text-xs text-gray-400">{post.seenCount} بازدید</span>}
              {total > 0 && (
                <span className="text-xs text-gray-400">
                  {REACTIONS.filter(([e]) => (post.reactionSummary[e] ?? 0) > 0).slice(0, 3).map(([, i]) => i).join('')} {total}
                </span>
              )}
              {post.hashtags?.slice(0, 2).map((tag) => <span key={tag} className="text-xs text-primary-500">#{tag}</span>)}
            </div>
          </button>

          {/* Right side */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {isAdmin && onEdit && onDelete
              ? <ThreeDotMenu onEdit={onEdit} onDelete={onDelete} onPin={onPin} isPinned={post.isPinned} />
              : <button onClick={onClick}><ChevronLeft className="w-4 h-4 text-gray-300 mt-1" /></button>
            }
            {post.isPinned && <Pin className="w-3 h-3 text-primary-500" />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Full detail card ─────────────────────────────────────────────────────────

interface NewsletterPostCardProps {
  post: NewsletterPostDto;
  isAdmin?: boolean;
  onEdit?: (post: NewsletterPostDto) => void;
  onDelete?: (postId: string) => void;
  onPin?: (postId: string, isPinned: boolean) => void;
}

export function NewsletterPostCard({ post, isAdmin, onEdit, onDelete, onPin }: NewsletterPostCardProps) {
  const hasBlocks = post.contentBlocks && post.contentBlocks.length > 0;
  const sortedBlocks = hasBlocks ? [...post.contentBlocks].sort((a, b) => a.order - b.order) : [];
  const firstImageIdx = sortedBlocks.findIndex((b) => b.type === 'IMAGE');

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Banner */}
      {firstImageIdx >= 0 && sortedBlocks[firstImageIdx]?.attachmentId && (
        <BannerImage block={sortedBlocks[firstImageIdx]!} full />
      )}

      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 text-xs font-bold">م</div>
          <div>
            <p className="text-sm font-medium text-gray-800">{post.author.firstName} {post.author.lastName}</p>
            <p className="text-xs text-gray-400">{formatDate(post.createdAt)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {post.isPinned && <Pin className="w-3.5 h-3.5 text-primary-500" />}
          {isAdmin && onEdit && onDelete && (
            <ThreeDotMenu
              onEdit={() => onEdit(post)}
              onDelete={() => onDelete(post.id)}
              onPin={onPin ? () => onPin(post.id, !post.isPinned) : undefined}
              isPinned={post.isPinned}
            />
          )}
        </div>
      </div>

      {post.title && <div className="px-4 pb-1"><h2 className="text-base font-semibold text-gray-800">{post.title}</h2></div>}

      {/* Content */}
      <div className="pb-2 space-y-2">
        {hasBlocks ? (
          sortedBlocks.map((block, i) => {
            if (block.type === 'IMAGE' && i === firstImageIdx) return null; // already shown as banner
            return <MediaBlock key={block.id} block={block} />;
          })
        ) : (
          <>
            {post.body && <div className="px-4"><p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{post.body}</p></div>}
            <LegacyAttachments post={post} />
          </>
        )}
        {post.isEdited && <p className="px-4 text-xs text-gray-400">ویرایش شده</p>}
      </div>

      {post.hashtags && post.hashtags.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1">
          {post.hashtags.map((tag) => (
            <span key={tag} className="text-xs text-primary-600 bg-primary-50 rounded-full px-2 py-0.5">#{tag}</span>
          ))}
        </div>
      )}

      <div className="px-4 pb-3 pt-2 border-t border-gray-50">
        <ReactionsBar post={post} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
