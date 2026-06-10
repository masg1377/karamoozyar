'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api-client';
import type { UserProfileDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { JalaliDatePicker } from '@/components/shared/JalaliDatePicker';
import { provinces, citiesByProvince } from '@/lib/iran-geo';
import { toast } from 'sonner';
import { Camera, Save, User } from 'lucide-react';

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'مرد' },
  { value: 'FEMALE', label: 'زن' },
  // { value: 'OTHER', label: 'سایر' },
];

const INPUT_CLS = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 focus:bg-white transition-all';
const LABEL_CLS = 'block text-xs font-medium text-gray-500 mb-1';

export default function UserProfilePage() {
  const { user, setUser } = useAuthStore();
  const [profile, setProfile] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    judicialDomain: '',
    expertiseField: '',
    fatherName: '',
    birthDate: '',
    gender: '' as string,
    residenceProvince: '',
    residenceCity: '',
  });

  useEffect(() => {
    api.get<{ data: UserProfileDto }>('/users/me')
      .then((res) => {
        const p = res.data.data;
        setProfile(p);
        setForm({
          firstName: p.firstName,
          lastName: p.lastName,
          phoneNumber: p.phoneNumber ?? '',
          judicialDomain: p.judicialDomain,
          expertiseField: p.expertiseField,
          fatherName: p.fatherName ?? '',
          birthDate: p.birthDate ? p.birthDate.split('T')[0] : '',
          gender: p.gender ?? '',
          residenceProvince: p.residenceProvince ?? '',
          residenceCity: p.residenceCity ?? '',
        });
      })
      .catch(() => toast.error('خطا در بارگذاری اطلاعات'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Validate phone before sending
      if (form.phoneNumber && !/^09\d{9}$/.test(form.phoneNumber)) {
        toast.error('شماره موبایل نامعتبر است (مثال: 09121234567)');
        setSaving(false);
        return;
      }
      const body: Record<string, unknown> = {
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        phoneNumber: form.phoneNumber || undefined,
        judicialDomain: form.judicialDomain || undefined,
        expertiseField: form.expertiseField || undefined,
        fatherName: form.fatherName || null,
        birthDate: form.birthDate || null,
        gender: form.gender || null,
        residenceProvince: form.residenceProvince || null,
        residenceCity: form.residenceCity || null,
      };
      const res = await api.patch<{ data: UserProfileDto }>('/users/me', body);
      const updated = res.data.data;
      setProfile(updated);
      // Update Zustand store with basic fields
      if (user) {
        setUser({ ...user, firstName: updated.firstName, lastName: updated.lastName, avatarUrl: updated.avatarUrl });
      }
      toast.success('اطلاعات ذخیره شد');
    } catch {
      toast.error('ذخیره‌سازی ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم تصویر نباید بیشتر از ۵ مگابایت باشد');
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: { profileImageUrl: string; avatarUrl: string } }>('/users/me/profile-image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Store raw avatarUrl (not presigned) in Zustand so it never expires
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
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner size="lg" label="در حال بارگذاری..." />
      </div>
    );
  }

  const avatarUrl = profile?.profileImageUrl ?? profile?.avatarUrl;
  const initials = `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}`;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-6 pb-8">
        <h1 className="text-lg font-bold text-gray-800 mb-6">ویرایش پروفایل</h1>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center shadow-md">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-primary-600">{initials}</span>
              )}
            </div>
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={uploadingImage}
              className="absolute bottom-0 left-0 w-8 h-8 bg-primary-600 text-white rounded-full flex items-center justify-center shadow-md hover:bg-primary-700 transition-colors disabled:opacity-50"
            >
              {uploadingImage ? <LoadingSpinner size="sm" /> : <Camera className="w-4 h-4" />}
            </button>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImageUpload(file);
              e.target.value = '';
            }}
          />
          <p className="text-xs text-gray-400 mt-2">برای تغییر تصویر روی دکمه دوربین کلیک کنید</p>
        </div>

        {/* Read-only info */}
        <div className="bg-gray-50 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-400">شماره ملی</p>
              <p className="text-sm font-medium text-gray-700" dir="ltr">{profile?.nationalId}</p>
            </div>
          </div>
        </div>

        {/* Editable fields */}
        <div className="space-y-4">
          <div>
            <label className={LABEL_CLS}>شماره موبایل</label>
            <input
              className={INPUT_CLS}
              value={form.phoneNumber}
              onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value.replace(/\D/g, '').slice(0, 11) }))}
              placeholder="09121234567"
              dir="ltr"
              type="tel"
              inputMode="numeric"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>نام</label>
              <input
                className={INPUT_CLS}
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                placeholder="نام"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>نام خانوادگی</label>
              <input
                className={INPUT_CLS}
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                placeholder="نام خانوادگی"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>حوزه قضایی</label>
              <input
                className={INPUT_CLS}
                value={form.judicialDomain}
                onChange={(e) => setForm((f) => ({ ...f, judicialDomain: e.target.value }))}
                placeholder="مثال: ساری"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>رشته کارشناسی</label>
              <input
                className={INPUT_CLS}
                value={form.expertiseField}
                onChange={(e) => setForm((f) => ({ ...f, expertiseField: e.target.value }))}
                placeholder="مثال: کامپیوتر"
              />
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>نام پدر</label>
            <input
              className={INPUT_CLS}
              value={form.fatherName}
              onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))}
              placeholder="نام پدر"
            />
          </div>

          <div>
            <label className={LABEL_CLS}>تاریخ تولد (شمسی)</label>
            <JalaliDatePicker
              value={form.birthDate}
              onChange={(v) => setForm((f) => ({ ...f, birthDate: v }))}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>جنسیت</label>
            <SearchableSelect
              options={GENDER_OPTIONS}
              value={form.gender}
              onChange={(v) => setForm((f) => ({ ...f, gender: v }))}
              placeholder="انتخاب کنید"
              searchPlaceholder="جستجو..."
            />
          </div>

          <div>
            <label className={LABEL_CLS}>استان محل سکونت</label>
            <SearchableSelect
              options={provinces}
              value={form.residenceProvince}
              onChange={(v) => setForm((f) => ({ ...f, residenceProvince: v, residenceCity: '' }))}
              placeholder="انتخاب استان"
              searchPlaceholder="جستجوی استان..."
            />
          </div>

          <div>
            <label className={LABEL_CLS}>شهر محل سکونت</label>
            <SearchableSelect
              options={form.residenceProvince ? (citiesByProvince[form.residenceProvince] ?? []) : []}
              value={form.residenceCity}
              onChange={(v) => setForm((f) => ({ ...f, residenceCity: v }))}
              placeholder={form.residenceProvince ? 'انتخاب شهر' : 'ابتدا استان را انتخاب کنید'}
              searchPlaceholder="جستجوی شهر..."
              disabled={!form.residenceProvince}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm mt-2"
          >
            {saving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
            ذخیره تغییرات
          </button>
        </div>
      </div>
    </div>
  );
}
