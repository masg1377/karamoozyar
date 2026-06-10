'use client';

import { useState } from 'react';
import { cn, formatTime } from '@/lib/utils';
import type { MessageDto } from '@karamooziyar/shared';
import { Pin, ChevronDown, ChevronUp, X } from 'lucide-react';

interface PinnedMessagesBarProps {
  pinnedMessages: MessageDto[];
  canUnpin: boolean;
  onUnpin: (message: MessageDto) => void;
  onScrollTo?: (messageId: string) => void;
}

export function PinnedMessagesBar({
  pinnedMessages,
  canUnpin,
  onUnpin,
  onScrollTo,
}: PinnedMessagesBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (pinnedMessages.length === 0) return null;

  const latest = pinnedMessages[0]!;
  const preview = latest.deletedAt
    ? 'پیام حذف شده'
    : latest.attachment
    ? latest.attachment.fileName
    : latest.body ?? '…';

  return (
    <div className="flex-shrink-0 bg-amber-50 border-b border-amber-100">
      {/* Collapsed single-line bar */}
      <div
        className="flex items-center gap-2 px-4 py-2 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <Pin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
        <p className="flex-1 text-xs text-amber-800 font-medium truncate">{preview}</p>
        <span className="text-xs text-amber-400 flex-shrink-0">{pinnedMessages.length} پین</span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
        )}
      </div>

      {/* Expanded list */}
      {expanded && (
        <div className="border-t border-amber-100 max-h-52 overflow-y-auto">
          {pinnedMessages.map((msg) => {
            const text = msg.deletedAt
              ? 'پیام حذف شده'
              : msg.attachment
              ? msg.attachment.fileName
              : msg.body ?? '…';

            return (
              <div
                key={msg.id}
                className="flex items-start gap-2 px-4 py-2.5 hover:bg-amber-100/50 transition-colors border-t border-amber-50 first:border-t-0"
              >
                <Pin className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />

                <button
                  className="flex-1 text-right min-w-0"
                  onClick={() => onScrollTo?.(msg.id)}
                >
                  <p className="text-xs font-medium text-amber-800 truncate">{text}</p>
                  <p className="text-[10px] text-amber-400 mt-0.5">
                    {msg.senderName} · {formatTime(msg.createdAt)}
                  </p>
                </button>

                {canUnpin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onUnpin(msg); }}
                    className="flex-shrink-0 p-1 rounded-lg text-amber-400 hover:text-red-400 hover:bg-red-50 transition-colors"
                    title="برداشتن پین"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
