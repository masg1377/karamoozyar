'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api-client';
import { getSocket } from '@/lib/socket-client';
import { SOCKET_EVENTS } from '@karamooziyar/shared';
import type { NewsletterPostDto } from '@karamooziyar/shared';
import { NewsletterPostCard } from '@/components/newsletter/NewsletterPost';
import { NewsletterComposer } from '@/components/newsletter/NewsletterComposer';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { useNewsletterStore } from '@/store/newsletter.store';
import { ArrowRight, Eye, Pencil, Trash2, Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';

// ─── Seen Modal ───────────────────────────────────────────────────────────────

function SeenModal({ postId, totalSeen, onClose }: { postId: string; totalSeen: number; onClose: () => void }) {
  const [users, setUsers] = useState<{ userId: string; name: string; seenAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: { data: { userId: string; name: string; seenAt: string }[] } }>(`/newsletter/${postId}/seen-list`)
      .then((r) => setUsers(r.data.data.data))
      .catch(() => toast.error('بارگذاری ناموفق بود'))
      .finally(() => setLoading(false));
  }, [postId]);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-xl max-w-sm mx-auto overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="font-semibold text-gray-800 text-sm">بازدیدکنندگان ({totalSeen})</p>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 text-xl leading-none">×</button>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8"><LoadingSpinner size="md" /></div>
          ) : users.length === 0 ? (
            <p className="text-center py-8 text-sm text-gray-400">هنوز کسی این پست را ندیده است</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {users.map((u) => (
                <li key={u.userId} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-700">{u.name}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(u.seenAt).toLocaleDateString('fa-IR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminNewsletterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { updatePost, removePost } = useNewsletterStore();
  const [post, setPost] = useState<NewsletterPostDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSeen, setShowSeen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    api.get<{ data: NewsletterPostDto }>(`/newsletter/${id}`)
      .then((r) => setPost(r.data.data))
      .catch(() => router.replace('/admin/newsletter'))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    if (!post) return;
    const socket = getSocket();
    const onReaction = (data: { postId: string; reactions: Record<string, number> }) => {
      if (data.postId === post.id)
        setPost((p) => p ? { ...p, reactionSummary: data.reactions } : p);
    };
    socket.on(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction);
    return () => { socket.off(SOCKET_EVENTS.NEWSLETTER_REACTION_UPDATED, onReaction); };
  }, [post]);

  const handlePin = async () => {
    if (!post) return;
    try {
      const res = await api.patch<{ data: NewsletterPostDto }>(`/newsletter/${post.id}`, { isPinned: !post.isPinned });
      setPost(res.data.data);
      updatePost(post.id, res.data.data);
      toast.success(res.data.data.isPinned ? 'پست پین شد' : 'پین برداشته شد');
    } catch {
      toast.error('عملیات ناموفق بود');
    }
  };

  const handleDelete = async () => {
    if (!post || !confirm('آیا از حذف این پست اطمینان دارید؟')) return;
    try {
      await api.delete(`/newsletter/${post.id}`);
      removePost(post.id);
      toast.success('پست حذف شد');
      router.replace('/admin/newsletter');
    } catch {
      toast.error('حذف ناموفق بود');
    }
  };

  if (loading) return (
    <div className="h-64 flex items-center justify-center">
      <LoadingSpinner size="lg" label="در حال بارگذاری..." />
    </div>
  );

  if (!post) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-4 animate-fade-in p-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          <ArrowRight className="w-4 h-4" />
          <span>خبرنامه</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowSeen(true)}
            className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors">
            <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">{post.seenCount} بازدید</span>
            <span className="sm:hidden">{post.seenCount}</span>
          </button>
          <button onClick={handlePin}
            className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition-colors">
            {post.isPinned ? <PinOff className="w-3.5 h-3.5 flex-shrink-0" /> : <Pin className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="hidden sm:inline">{post.isPinned ? 'برداشتن پین' : 'پین'}</span>
          </button>
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-xs text-primary-600 bg-primary-50 hover:bg-primary-100 px-2.5 py-1.5 rounded-lg transition-colors">
            <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">ویرایش</span>
          </button>
          <button onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs text-red-500 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors">
            <Trash2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="hidden sm:inline">حذف</span>
          </button>
        </div>
      </div>

      {/* Full post */}
      <NewsletterPostCard post={post} isAdmin />

      {showSeen && <SeenModal postId={post.id} totalSeen={post.seenCount} onClose={() => setShowSeen(false)} />}

      {editing && (
        <NewsletterComposer
          editingPost={post}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setPost(updated);
            updatePost(post.id, updated);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
