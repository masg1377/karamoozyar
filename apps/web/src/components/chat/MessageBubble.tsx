'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatTime, formatFileSize, isImageMime, isVoiceMime } from '@/lib/utils';
import type { MessageDto } from '@karamooziyar/shared';
import {
  Check, CheckCheck, Copy, Trash2, Pencil, Download,
  Play, Pause, FileText, Reply, Pin, PinOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSwipeToReply } from '@/hooks/useSwipeToReply';
import { UserAvatar } from '@/components/shared/UserAvatar';

interface MessageBubbleProps {
  message: MessageDto;
  isMine: boolean;
  onEdit?: (message: MessageDto) => void;
  onDelete?: (messageId: string) => void;
  onReply?: (message: MessageDto) => void;
  onPin?: (message: MessageDto) => void;
  onUnpin?: (message: MessageDto) => void;
  senderFirstName?: string;
  senderLastName?: string;
  senderAvatarUrl?: string | null;
  showAvatar?: boolean;
}

// ─── Menu position ────────────────────────────────────────────────────────────

interface MenuPos { x: number; y: number }

function calcMenuPos(anchor: HTMLElement): MenuPos {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MENU_W = 160;
  const MENU_H = 230;
  let x = rect.left;
  let y = rect.bottom + 4;
  if (x + MENU_W > vw - 8) x = rect.right - MENU_W;
  if (y + MENU_H > vh - 8) y = rect.top - MENU_H - 4;
  return { x, y };
}

// ─── Portal context menu ──────────────────────────────────────────────────────

function ContextMenu({ pos, onClose, children }: {
  pos: MenuPos;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = false;
    const t = window.setTimeout(() => { active = true; }, 10);
    const onMD = (e: MouseEvent) => {
      if (!active) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onMD);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onMD);
      window.removeEventListener('scroll', onScroll);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={menuRef} className="fixed bg-white rounded-2xl shadow-2xl border border-gray-100 py-1.5 min-w-[155px]"
      style={{ zIndex: 9999, left: pos.x, top: pos.y }}>
      {children}
    </div>,
    document.body,
  );
}

function MenuItem({ icon, label, onClick, danger, warn }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; warn?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={cn('w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-right',
        danger && 'text-red-500 hover:bg-red-50',
        warn && 'text-amber-600 hover:bg-amber-50',
        !danger && !warn && 'text-gray-700 hover:bg-gray-50',
      )}>
      {icon}{label}
    </button>
  );
}

// ─── Voice Player ─────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function VoicePlayer({ src, isMine, storedDuration }: { src: string; isMine: boolean; storedDuration: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(storedDuration ?? 0);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    const a = new Audio(src); audioRef.current = a;
    const onMeta = () => { if (isFinite(a.duration)) setDur(a.duration); };
    const onTime = () => { setCur(a.currentTime); if (a.duration && isFinite(a.duration)) setProg(a.currentTime / a.duration * 100); };
    const onEnd = () => { setPlaying(false); setCur(0); setProg(0); a.currentTime = 0; };
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => { a.pause(); a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('durationchange', onMeta); a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); };
  }, [src]);

  const toggle = () => { const a = audioRef.current; if (!a) return; if (playing) { a.pause(); setPlaying(false); } else { void a.play(); setPlaying(true); } };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a || !isFinite(a.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    a.currentTime = ratio * a.duration; setProg(ratio * 100);
  };
  const bars = [3,5,8,6,9,7,10,8,5,7,9,6,8,5,7,10,8,6,9,7,5,8,7,9,6,8,5,7,6,8];
  return (
    <div dir="ltr" className="flex items-center gap-2.5 min-w-[200px] max-w-[260px]">
      <button onClick={toggle} className={cn('w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors', isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-primary-100 hover:bg-primary-200')}>
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 translate-x-0.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-1">
        <div className="relative flex items-center gap-[2px] h-7 cursor-pointer" onClick={seek}>
          {bars.map((h, i) => <div key={i} style={{ height: `${h * 2.2}px` }} className={cn('w-[3px] rounded-full flex-shrink-0 transition-colors', (i / bars.length) * 100 <= prog ? isMine ? 'bg-white/90' : 'bg-primary-500' : isMine ? 'bg-white/35' : 'bg-gray-300')} />)}
        </div>
        <p className={cn('text-[11px] leading-none tabular-nums', isMine ? 'text-white/65' : 'text-gray-400')}>
          {playing || cur > 0 ? `${fmtSecs(cur)} / ${fmtSecs(dur)}` : fmtSecs(dur)}
        </p>
      </div>
    </div>
  );
}

// ─── Reply preview ────────────────────────────────────────────────────────────

function ReplyPreview({ reply, isMine }: { reply: MessageDto['replyToMessage']; isMine: boolean }) {
  if (!reply) return null;
  const text = reply.deletedAt ? 'پیام حذف شده' : reply.attachment ? reply.attachment.fileName : reply.body ?? '…';
  return (
    <div className={cn('rounded-lg px-3 py-1.5 mb-2 border-r-4 text-xs max-w-full',
      isMine ? 'bg-white/15 border-white/60 text-white/80' : 'bg-gray-100 border-primary-400 text-gray-600')}>
      <p className={cn('font-semibold text-[11px] mb-0.5', isMine ? 'text-white/70' : 'text-primary-600')}>{reply.senderName}</p>
      <p className="truncate max-w-[200px]">{text}</p>
    </div>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

export function MessageBubble({
  message, isMine,
  onEdit, onDelete, onReply, onPin, onUnpin,
  senderFirstName, senderLastName, senderAvatarUrl, showAvatar = false,
}: MessageBubbleProps) {
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const showMenu = menuPos !== null;

  const dotButtonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // swipe refs: the wrapper (for transform) and the reply icon
  const wrapperRef = useRef<HTMLDivElement>(null);
  const replyIconRef = useRef<HTMLDivElement>(null);

  const canCopy  = message.type === 'TEXT' && !!message.body;
  const canEdit  = isMine && message.type === 'TEXT' && !!onEdit;
  const canDelete = !!onDelete;
  const canReply = !!onReply;
  const isPinned = !!message.pinnedAt;
  const canPin   = !isPinned && !!onPin;
  const canUnpin = isPinned && !!onUnpin;
  const hasActions = canCopy || canEdit || canDelete || canReply || canPin || canUnpin;

  const swipe = useSwipeToReply(message, isMine, onReply, wrapperRef, replyIconRef);

  const openMenu = useCallback((anchor: HTMLElement) => {
    if (!hasActions) return;
    setMenuPos(calcMenuPos(anchor));
  }, [hasActions]);
  const closeMenu = useCallback(() => setMenuPos(null), []);

  const handleContextMenu = (e: React.MouseEvent) => { e.preventDefault(); openMenu(e.currentTarget as HTMLElement); };

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    longPressTimer.current = setTimeout(() => {
      if (hasActions) { openMenu(target); if (navigator.vibrate) navigator.vibrate(40); }
    }, 550);
    swipe.onTouchStart(e);
  }, [hasActions, openMenu, swipe]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    swipe.onTouchMove(e);
  }, [swipe]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    swipe.onTouchEnd();
  }, [swipe]);

  const handleCopy = async () => {
    if (message.body) { await navigator.clipboard.writeText(message.body); toast.success('کپی شد'); }
    closeMenu();
  };

  if (message.deletedAt) {
    return (
      <div className={cn('flex', isMine ? 'justify-start' : 'justify-end')}>
        <div className="bubble-deleted px-4 py-2 text-xs">پیام حذف شده است</div>
      </div>
    );
  }

  const att = message.attachment;

  const renderContent = () => {
    if (att && isImageMime(att.mimeType)) {
      return <img src={att.fileUrl} alt={att.fileName} className="max-w-[240px] max-h-[300px] rounded-xl object-cover cursor-pointer" onClick={() => window.open(att.fileUrl, '_blank')} />;
    }
    if (att && isVoiceMime(att.mimeType)) return <VoicePlayer src={att.fileUrl} isMine={isMine} storedDuration={att.duration} />;
    if (att) {
      return (
        <a href={att.fileUrl} download={att.fileName} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className={cn('p-2 rounded-lg flex-shrink-0', isMine ? 'bg-white/20' : 'bg-primary-50')}><FileText className="w-5 h-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate max-w-[150px]">{att.fileName}</p>
            <p className={cn('text-xs', isMine ? 'text-white/70' : 'text-gray-400')}>{formatFileSize(att.fileSize)}</p>
          </div>
          <Download className="w-4 h-4 flex-shrink-0 opacity-70" />
        </a>
      );
    }
    return <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.body}</p>;
  };

  const avatarEl = senderFirstName && senderLastName ? (
    <div className="flex-shrink-0 self-end mb-0.5">
      <UserAvatar firstName={senderFirstName} lastName={senderLastName} avatarUrl={senderAvatarUrl} size="sm" />
    </div>
  ) : null;

  return (
    <>
      {/*
        ── Layout explanation ──────────────────────────────────────────────────
        The app uses dir="rtl". In RTL flex:
          justify-start = packs items to the RIGHT (RTL main-start)
          justify-end   = packs items to the LEFT  (RTL main-end)

        Sent messages (isMine=true):  RIGHT side → justify-start
        Received messages (!isMine):  LEFT side  → justify-end

        Avatar for received is placed AFTER wrapper in DOM so it appears on the
        outer-LEFT edge (screen edge side) in RTL flex-end layout.
        ────────────────────────────────────────────────────────────────────────
      */}
      <div className={cn(
        'flex items-end gap-1.5',
        // RTL: justify-start = RIGHT side, justify-end = LEFT side
        // Sent (mine) → RIGHT; Received → LEFT
        isMine ? 'justify-start' : 'justify-end',
      )}>

        {/* Avatar for sent messages shown first (visual RIGHT in RTL justify-start) — not currently used */}
        {isMine && showAvatar && avatarEl}

        {/*
          Swipe wrapper: position:relative for reply icon + drag transform.
          max-w-[75%] constrains the bubble width (no flex-1 = not full-width).
        */}
        <div
          ref={wrapperRef}
          className="relative max-w-[75%]"
        >
          {/* Floating reply icon — appears during swipe drag */}
          <div
            ref={replyIconRef}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 z-10 pointer-events-none',
              'w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shadow-md',
              // isMine messages are on the RIGHT (RTL) → drag LEFT → icon on LEFT of bubble
              // non-mine messages are on the LEFT (RTL) → drag RIGHT → icon on RIGHT of bubble
              isMine ? '-left-10' : '-right-10',
            )}
            style={{ opacity: 0, transform: 'scale(0.5)', transition: 'none' }}
          >
            <Reply className="w-4 h-4 text-primary-600" />
          </div>

          {/* Bubble */}
          <div
            ref={bubbleRef}
            className={cn(
              'relative group',
              isMine ? 'bubble-sent' : 'bubble-received',
              'px-4 py-2.5',
            )}
            onContextMenu={handleContextMenu}
            onMouseDown={swipe.onMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {/* Three-dot button */}
            {hasActions && (
              <button
                ref={dotButtonRef}
                onClick={(e) => { e.stopPropagation(); showMenu ? closeMenu() : openMenu(dotButtonRef.current!); }}
                className={cn(
                  'absolute top-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-10',
                  'w-5 h-5 rounded-full flex items-center justify-center',
                  isMine ? 'left-1.5 bg-white/20 hover:bg-white/30' : 'right-1.5 bg-black/[0.08] hover:bg-black/15',
                )}
              >
                <span className="text-[10px] leading-none font-bold">⋮</span>
              </button>
            )}

            {/* Pinned indicator */}
            {isPinned && (
              <div className={cn('flex items-center gap-1 text-[10px] font-medium mb-1', isMine ? 'text-white/60' : 'text-amber-500')}>
                <Pin className="w-2.5 h-2.5" />پین شده
              </div>
            )}

            {message.replyToMessage && <ReplyPreview reply={message.replyToMessage} isMine={isMine} />}
            {renderContent()}

            {/* Meta row */}
            <div className={cn('flex items-center gap-1 mt-1', isMine ? 'justify-start' : 'justify-end')}>
              {message.isEdited && <span className={cn('text-xs', isMine ? 'text-white/60' : 'text-gray-400')}>ویرایش شده</span>}
              <span className={cn('text-xs', isMine ? 'text-white/60' : 'text-gray-400')}>{formatTime(message.createdAt)}</span>
              {isMine && (
                <span className="text-white/70">
                  {message.status === 'SEEN' ? <CheckCheck className="w-3.5 h-3.5 inline" /> : <Check className="w-3.5 h-3.5 inline" />}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Avatar for received messages (non-mine): appears AFTER wrapper = LEFT side in RTL justify-end */}
        {!isMine && showAvatar && avatarEl}
      </div>

      {/* Context menu portal — always on top, z-9999, escapes scroll containers */}
      {showMenu && menuPos && (
        <ContextMenu pos={menuPos} onClose={closeMenu}>
          {canReply && <MenuItem icon={<Reply className="w-4 h-4" />} label="پاسخ" onClick={() => { onReply!(message); closeMenu(); }} />}
          {canPin   && <MenuItem icon={<Pin className="w-4 h-4" />} label="پین کردن" warn onClick={() => { onPin!(message); closeMenu(); }} />}
          {canUnpin && <MenuItem icon={<PinOff className="w-4 h-4" />} label="برداشتن پین" onClick={() => { onUnpin!(message); closeMenu(); }} />}
          {canCopy  && <MenuItem icon={<Copy className="w-4 h-4" />} label="کپی" onClick={handleCopy} />}
          {canEdit  && <MenuItem icon={<Pencil className="w-4 h-4" />} label="ویرایش" onClick={() => { onEdit!(message); closeMenu(); }} />}
          {canDelete && <MenuItem icon={<Trash2 className="w-4 h-4" />} label="حذف" danger onClick={() => { onDelete!(message.id); closeMenu(); }} />}
        </ContextMenu>
      )}
    </>
  );
}
