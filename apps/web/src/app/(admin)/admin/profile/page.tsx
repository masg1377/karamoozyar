'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import type { UserProfileDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { DiagnosticsPanel } from '@/components/admin/DiagnosticsPanel';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Pencil, UserRoundPen } from 'lucide-react';

const NAVY = '#1c274c';

export default function AdminProfilePage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [profile, setProfile] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ firstName: '', lastName: '', phoneNumber: '' });

  useEffect(() => {
    api.get<{ data: UserProfileDto }>('/users/me')
      .then((res) => {
        const p = res.data.data;
        setProfile(p);
        setForm({ firstName: p.firstName, lastName: p.lastName, phoneNumber: p.phoneNumber });
      })
      .catch(() => toast.error('خطا در بارگذاری اطلاعات'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('نام و نام خانوادگی الزامی است');
      return;
    }
    setSaving(true);
    try {
      const res = await api.patch<{ data: UserProfileDto }>('/users/me', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phoneNumber: form.phoneNumber.trim() || undefined,
      });
      const updated = res.data.data;
      setProfile(updated);
      if (user) setUser({ ...user, firstName: updated.firstName, lastName: updated.lastName, avatarUrl: updated.avatarUrl });
      toast.success('اطلاعات ذخیره شد');
    } catch {
      toast.error('ذخیره‌سازی ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('حجم تصویر نباید بیشتر از ۵ مگابایت باشد'); return; }
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ data: { profileImageUrl: string; avatarUrl: string } }>('/users/me/profile-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const rawUrl = res.data.data.avatarUrl;
      const signedUrl = res.data.data.profileImageUrl;
      setProfile((prev) => prev ? { ...prev, avatarUrl: rawUrl, profileImageUrl: signedUrl } : prev);
      if (user) setUser({ ...user, avatarUrl: rawUrl });
      toast.success('تصویر پروفایل بارگذاری شد');
    } catch {
      toast.error('بارگذاری تصویر ناموفق بود');
    } finally {
      setUploadingImage(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  const avatarUrl = profile?.profileImageUrl ?? profile?.avatarUrl;
  const initial = form.firstName?.[0] ?? 'م';

  return (
    <div
      dir="rtl"
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '18px 22px calc(110px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* ── سربرگ: عنوان + بازگشت ── */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserRoundPen style={{ width: 24, height: 24, color: NAVY }} strokeWidth={1.7} />
          <h1 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0 }}>ویرایش پروفایل</h1>
        </div>
        <button
          onClick={() => router.back()}
          aria-label="بازگشت"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}
        >
          <ArrowLeft style={{ width: 26, height: 26, color: NAVY }} strokeWidth={1.8} />
        </button>
      </div>

      {/* ── آواتار با حلقه سرمه‌ای + دکمه مداد ── */}
      <div style={{ position: 'relative', marginTop: 8, marginBottom: 34 }}>
        <div
          style={{
            width: 158, height: 158, borderRadius: '50%',
            border: `2.5px solid ${NAVY}`,
            padding: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: '#fff', fontSize: 52, fontWeight: 700 }}>{initial}</span>
            </div>
          )}
        </div>

        {/* دکمه ویرایش تصویر */}
        <button
          onClick={() => imageInputRef.current?.click()}
          disabled={uploadingImage}
          aria-label="تغییر تصویر پروفایل"
          style={{
            position: 'absolute', bottom: 4, left: 4,
            width: 46, height: 46, borderRadius: '50%',
            background: NAVY,
            border: '3px solid #F6F7F9',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 10px rgba(28,39,76,0.35)',
          }}
        >
          {uploadingImage
            ? <Loader2 style={{ width: 18, height: 18, color: '#fff', animation: 'spin 1s linear infinite' }} />
            : <Pencil style={{ width: 18, height: 18, color: '#fff' }} />}
        </button>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }}
        />
      </div>

      {/* ── پلاک نام (سرمه‌ای) ── */}
      <div
        style={{
          width: '100%', maxWidth: 360,
          height: 48,
          borderRadius: 24,
          background: NAVY,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 14px rgba(28,39,76,0.30)',
          marginBottom: 36,
        }}
      >
        <span style={{ color: '#fff', fontSize: 16, fontWeight: 700 }}>
          {form.firstName} {form.lastName}
        </span>
      </div>

      {/* ── کارت فیلدها ── */}
      <div
        style={{
          width: '100%', maxWidth: 372,
          background: '#E3EAF1',
          borderRadius: 28,
          padding: '20px 18px',
          display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '6px 8px 16px rgba(28,39,76,0.18)',
        }}
      >
        <PillField label="نام" value={form.firstName} onChange={(v) => setForm((f) => ({ ...f, firstName: v }))} />
        <PillField label="نام خانوادگی" value={form.lastName} onChange={(v) => setForm((f) => ({ ...f, lastName: v }))} />
        <PillField
          label="شماره تماس"
          value={form.phoneNumber}
          onChange={(v) => setForm((f) => ({ ...f, phoneNumber: v }))}
          type="tel"
          ltr
        />
      </div>

      {/* ── دکمه ذخیره ── */}
      <div style={{ width: '100%', maxWidth: 372, display: 'flex', justifyContent: 'flex-end', marginTop: 26 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            minWidth: 112,
            padding: '9px 20px',
            borderRadius: 10,
            border: 'none',
            background: saving ? '#94a3b8' : '#1786C6',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: saving ? 'default' : 'pointer',
            fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: '0 5px 12px rgba(23,134,198,0.35)',
            transition: 'background 0.2s',
          }}
        >
          {saving && <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />}
          ذخیره اطلاعات
        </button>
      </div>

      {/* ── گزارش عیب‌یابی اتصال (فقط ادمین) ── */}
      <DiagnosticsPanel />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** فیلد قرصی‌شکل مطابق دیزاین — برچسب راست + جداکننده + ورودی */
function PillField({
  label,
  value,
  onChange,
  type = 'text',
  ltr = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  ltr?: boolean;
}) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center',
        height: 46,
        borderRadius: 23,
        background: 'linear-gradient(180deg, #FDFEFF 0%, #EFF5FA 100%)',
        boxShadow: '3px 4px 8px rgba(28,39,76,0.22)',
        padding: '0 18px',
        gap: 12,
        cursor: 'text',
      }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, whiteSpace: 'nowrap', flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ width: 1.5, height: 22, background: 'rgba(28,39,76,0.55)', borderRadius: 1, flexShrink: 0 }} />
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={ltr ? 'ltr' : 'rtl'}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 13.5,
          fontWeight: 600,
          color: NAVY,
          fontFamily: 'inherit',
          textAlign: ltr ? 'left' : 'right',
        }}
      />
    </label>
  );
}
