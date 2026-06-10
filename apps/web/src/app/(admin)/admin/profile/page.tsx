'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import type { UserProfileDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { toast } from 'sonner';
import { Camera, Save } from 'lucide-react';

const INPUT_CLS = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 focus:bg-white transition-all';
const LABEL_CLS = 'block text-xs font-medium text-gray-500 mb-1';

export default function AdminProfilePage() {
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
    setSaving(true);
    try {
      const res = await api.patch<{ data: UserProfileDto }>('/users/me', {
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        phoneNumber: form.phoneNumber || undefined,
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
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  const avatarUrl = profile?.profileImageUrl ?? profile?.avatarUrl;
  const initials = `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}`;

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold text-gray-800 mb-6">پروفایل مدیر</h1>

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-8 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center">
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              : <span className="text-xl font-bold text-primary-600">{initials}</span>}
          </div>
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={uploadingImage}
            className="absolute bottom-0 left-0 w-6 h-6 bg-primary-600 text-white rounded-full flex items-center justify-center shadow hover:bg-primary-700 disabled:opacity-50"
          >
            {uploadingImage ? <LoadingSpinner size="sm" /> : <Camera className="w-3 h-3" />}
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ''; }}
          />
        </div>
        <div>
          <p className="font-semibold text-gray-800">{form.firstName} {form.lastName}</p>
          <p className="text-sm text-gray-400">مدیر سیستم</p>
          <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{profile?.nationalId}</p>
        </div>
      </div>

      {/* Editable fields */}
      <div className="space-y-4 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>نام</label>
            <input className={INPUT_CLS} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="نام" />
          </div>
          <div>
            <label className={LABEL_CLS}>نام خانوادگی</label>
            <input className={INPUT_CLS} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="نام خانوادگی" />
          </div>
        </div>

        <div>
          <label className={LABEL_CLS}>شماره موبایل</label>
          <input className={INPUT_CLS} value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="09123456789" dir="ltr" />
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
          ذخیره تغییرات
        </button>
      </div>
    </div>
  );
}
