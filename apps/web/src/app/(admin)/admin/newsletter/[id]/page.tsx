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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Sticky Toolbar ── */}
      <div style={{
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: '#F6F7F9',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        zIndex: 5,
      }}>
        <button
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 13, padding: 0 }}
        >
          <ArrowRight className="w-4 h-4" />
          <span>خبرنامه</span>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setShowSeen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', background: 'rgba(0,0,0,0.05)', border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 8 }}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{post.seenCount}</span>
          </button>
          <button
            onClick={handlePin}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#D97706', background: '#FEF3C7', border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 8 }}
          >
            {post.isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            <span>{post.isPinned ? 'برداشتن پین' : 'پین'}</span>
          </button>
          <button
            onClick={() => setEditing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#0ABDE3', background: '#E0F7FD', border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 8 }}
          >
            <Pencil className="w-3.5 h-3.5" /> ویرایش
          </button>
          <button
            onClick={handleDelete}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#EF4444', background: '#FEE2E2', border: 'none', cursor: 'pointer', padding: '5px 10px', borderRadius: 8 }}
          >
            <Trash2 className="w-3.5 h-3.5" /> حذف
          </button>
        </div>
      </div>

      {/* ── Scrollable content (goes under floating nav) ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', paddingBottom: 'calc(96px)' }}>
        <NewsletterPostCard post={post} isAdmin />
      </div>

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
