'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import api from '@/lib/api-client';
import { useAuthStore } from '@/store/auth.store';
import { toast } from 'sonner';
import { X, Save, Loader2, Camera } from 'lucide-react';
import type { UserProfileDto } from '@karamooziyar/shared';
import { Gender } from '@karamooziyar/shared';
import { JalaliDatePicker } from '@/components/shared/JalaliDatePicker';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { provinces, citiesByProvince } from '@/lib/iran-geo';

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'مرد' },
  { value: 'FEMALE', label: 'زن' },
  { value: 'OTHER', label: 'سایر' },
] as const;

interface ProfileEditModalProps {
  onClose: () => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  judicialDomain: string;
  expertiseField: string;
  fatherName: string;
  birthCertificateNumber: string;
  birthDate: string;
  gender: string;
  residenceProvince: string;
  residenceCity: string;
}

export function ProfileEditModal({ onClose }: ProfileEditModalProps) {
  const { user, setUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [form, setForm] = useState<FormState>({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    phoneNumber: user?.phoneNumber ?? '',
    judicialDomain: user?.judicialDomain ?? '',
    expertiseField: user?.expertiseField ?? '',
    fatherName: '',
    birthCertificateNumber: '',
    birthDate: '',
    gender: '',
    residenceProvince: '',
    residenceCity: '',
  });

  // Fetch extended profile (has fatherName, birthDate, etc.)
  useEffect(() => {
    api
      .get<{ data: UserProfileDto }>('/users/me')
      .then((res) => {
        const p = res.data.data;
        setForm({
          firstName: p.firstName ?? '',
          lastName: p.lastName ?? '',
          phoneNumber: p.phoneNumber ?? '',
          judicialDomain: p.judicialDomain ?? '',
          expertiseField: p.expertiseField ?? '',
          fatherName: p.fatherName ?? '',
          birthCertificateNumber: p.birthCertificateNumber ?? '',
          birthDate: p.birthDate ?? '',
          gender: p.gender ?? '',
          residenceProvince: p.residenceProvince ?? '',
          residenceCity: p.residenceCity ?? '',
        });
      })
      .catch(() => toast.error('بارگذاری پروفایل ناموفق'))
      .finally(() => setLoading(false));
  }, []);

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('نام و نام خانوادگی الزامی است');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phoneNumber: form.phoneNumber.trim() || undefined as unknown as string,
        judicialDomain: form.judicialDomain.trim() || undefined as unknown as string,
        expertiseField: form.expertiseField.trim() || undefined as unknown as string,
        fatherName: form.fatherName.trim() || null,
        birthCertificateNumber: form.birthCertificateNumber.trim() || null,
        birthDate: form.birthDate || null,
        gender: (form.gender as Gender) || null,
        residenceProvince: form.residenceProvince.trim() || null,
        residenceCity: form.residenceCity.trim() || null,
      };

      const res = await api.patch<{ data: UserProfileDto }>('/users/me', payload);
      // Update auth store with refreshed data
      if (user) {
        setUser({ ...user, ...res.data.data });
      }
      toast.success('پروفایل با موفقیت بروزرسانی شد');
      onClose();
    } catch {
      toast.error('ذخیره پروفایل ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حداکثر حجم تصویر ۵ مگابایت است');
      return;
    }
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post<{ data: UserProfileDto }>(
        '/users/me/profile-image',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (user) setUser({ ...user, ...res.data.data });
      toast.success('تصویر پروفایل بروزرسانی شد');
    } catch {
      toast.error('بارگذاری تصویر ناموفق بود');
    } finally {
      setUploadingImage(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const initial = form.firstName?.[0] ?? user?.firstName?.[0] ?? 'ک';
  const avatarUrl = user?.profileImageUrl ?? user?.avatarUrl;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 210 }}
      />

      {/* Sheet */}
      <div
        dir="rtl"
        style={{
          position: 'fixed',
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(100vw, 480px)',
          maxHeight: '92dvh',
          zIndex: 211,
          display: 'flex',
          flexDirection: 'column',
          background: '#fff',
          borderRadius: '24px 24px 0 0',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#e2e8f0' }} />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #f0f4f8',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: '#f1f5f9', border: 'none',
              cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X style={{ width: 16, height: 16, color: '#64748b' }} />
          </button>

          <h2 style={{ fontSize: 15, fontWeight: 700, color: '#1c274c', margin: 0 }}>
            ویرایش پروفایل
          </h2>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 20,
              background: saving ? '#94a3b8' : '#06ACE8',
              border: 'none', cursor: saving ? 'default' : 'pointer',
              color: '#fff', fontSize: 13, fontWeight: 600,
              transition: 'background 0.2s',
            }}
          >
            {saving ? (
              <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
            ) : (
              <Save style={{ width: 14, height: 14 }} />
            )}
            ذخیره
          </button>
        </div>

        {/* Body */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
            <Loader2
              style={{ width: 32, height: 32, color: '#06ACE8', animation: 'spin 1s linear infinite' }}
            />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
            {/* Avatar */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <label style={{ position: 'relative', cursor: 'pointer' }}>
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 80, height: 80, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #0ABDE3, #06ACE8)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <span style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{initial}</span>
                  </div>
                )}
                <div
                  style={{
                    position: 'absolute', bottom: 0, left: 0,
                    width: 26, height: 26, borderRadius: '50%',
                    background: '#06ACE8', border: '2px solid #fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {uploadingImage ? (
                    <Loader2 style={{ width: 13, height: 13, color: '#fff', animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <Camera style={{ width: 13, height: 13, color: '#fff' }} />
                  )}
                </div>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {/* Form fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Row: firstName / lastName */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="نام" value={form.firstName} onChange={(v) => set('firstName', v)} />
                <Field label="نام خانوادگی" value={form.lastName} onChange={(v) => set('lastName', v)} />
              </div>

              <Field label="نام پدر" value={form.fatherName} onChange={(v) => set('fatherName', v)} />

              <Field
                label="شماره موبایل"
                value={form.phoneNumber}
                onChange={(v) => set('phoneNumber', v)}
                type="tel"
                dir="ltr"
              />

              <Field
                label="شماره شناسنامه"
                value={form.birthCertificateNumber}
                onChange={(v) => set('birthCertificateNumber', v)}
              />

              <Field label="حوزه قضایی" value={form.judicialDomain} onChange={(v) => set('judicialDomain', v)} />

              <Field label="رشته تخصصی" value={form.expertiseField} onChange={(v) => set('expertiseField', v)} />

              {/* Gender */}
              <div>
                <label style={labelStyle}>جنسیت</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {GENDER_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => set('gender', form.gender === value ? '' : value)}
                      style={{
                        flex: 1, padding: '7px 0', borderRadius: 10,
                        border: `1.5px solid ${form.gender === value ? '#06ACE8' : '#e2e8f0'}`,
                        background: form.gender === value ? '#e8f9fe' : '#f8fafc',
                        color: form.gender === value ? '#06ACE8' : '#64748b',
                        fontSize: 12, fontWeight: form.gender === value ? 600 : 400,
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* تاریخ تولد — تقویم شمسی */}
              <div>
                <label style={labelStyle}>تاریخ تولد (شمسی)</label>
                <JalaliDatePicker
                  value={form.birthDate}
                  onChange={(v) => set('birthDate', v)}
                />
              </div>

              {/* استان / شهر — سلکت با جستجو */}
              <div>
                <label style={labelStyle}>استان محل سکونت</label>
                <SearchableSelect
                  options={provinces}
                  value={form.residenceProvince}
                  onChange={(v) =>
                    setForm((prev) => ({ ...prev, residenceProvince: v, residenceCity: '' }))
                  }
                  placeholder="انتخاب استان"
                  searchPlaceholder="جستجوی استان..."
                />
              </div>
              <div>
                <label style={labelStyle}>شهر محل سکونت</label>
                <SearchableSelect
                  options={form.residenceProvince ? (citiesByProvince[form.residenceProvince] ?? []) : []}
                  value={form.residenceCity}
                  onChange={(v) => set('residenceCity', v)}
                  placeholder={form.residenceProvince ? 'انتخاب شهر' : 'ابتدا استان را انتخاب کنید'}
                  searchPlaceholder="جستجوی شهر..."
                  disabled={!form.residenceProvince}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>,
    document.body,
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#64748b',
  marginBottom: 4,
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
  dir,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir={dir}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '9px 12px',
          borderRadius: 10,
          border: '1.5px solid #e2e8f0',
          background: '#f8fafc',
          fontSize: 13,
          color: '#1c274c',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color 0.15s, background 0.15s',
          fontFamily: 'inherit',
        }}
        onFocus={(e) => {
          e.target.style.borderColor = '#06ACE8';
          e.target.style.background = '#fff';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = '#e2e8f0';
          e.target.style.background = '#f8fafc';
        }}
      />
    </div>
  );
}
