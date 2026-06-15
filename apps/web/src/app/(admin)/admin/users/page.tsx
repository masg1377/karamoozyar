'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '@/lib/api-client';
import type { UserDto, UserProfileDto } from '@karamooziyar/shared';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { SearchableSelect } from '@/components/shared/SearchableSelect';
import { JalaliDatePicker } from '@/components/shared/JalaliDatePicker';
import { provinces, citiesByProvince } from '@/lib/iran-geo';
import { cn } from '@/lib/utils';

const GENDER_OPTIONS = [
  { value: 'MALE', label: 'مرد' },
  { value: 'FEMALE', label: 'زن' },
  // { value: 'OTHER', label: 'سایر' },
];
import {
  Search, UserPlus, Users, CheckCircle2, XCircle,
  MessageSquare, Pencil, ChevronRight, ChevronLeft,
  Camera, X, Save, Eye, EyeOff,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface UsersResponse {
  data: UserDto[];
  meta: { total: number; page: number; limit: number };
}

const INPUT_CLS = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-300 focus:bg-white transition-all';
const LABEL_CLS = 'block text-xs font-medium text-gray-500 mb-1';
const LIMIT = 20;

// ─── Create User Modal ────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateUserModal({ onClose, onCreated }: CreateModalProps) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', nationalId: '', phoneNumber: '',
    judicialDomain: '', expertiseField: '', fatherName: '',
    birthDate: '', gender: '',
    residenceProvince: '', residenceCity: '',
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await api.post('/users', {
        firstName: form.firstName,
        lastName: form.lastName,
        nationalId: form.nationalId,
        phoneNumber: form.phoneNumber,
        judicialDomain: form.judicialDomain,
        expertiseField: form.expertiseField,
        ...(form.password && { password: form.password }),
        ...(form.fatherName && { fatherName: form.fatherName }),
        ...(form.birthDate && { birthDate: form.birthDate }),
        ...(form.gender && { gender: form.gender }),
        ...(form.residenceProvince && { residenceProvince: form.residenceProvince }),
        ...(form.residenceCity && { residenceCity: form.residenceCity }),
      });
      toast.success('کارآموز اضافه شد');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
      const text = Array.isArray(msg) ? msg[0] : msg;
      toast.error(text ?? 'ایجاد کارآموز ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = form.firstName && form.lastName && form.nationalId.length === 10 && form.phoneNumber && form.judicialDomain && form.expertiseField;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90dvh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-800">افزودن کارآموز جدید</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={LABEL_CLS}>نام *</label><input className={INPUT_CLS} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="نام" /></div>
            <div><label className={LABEL_CLS}>نام خانوادگی *</label><input className={INPUT_CLS} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="نام خانوادگی" /></div>
          </div>
          <div><label className={LABEL_CLS}>شماره ملی *</label><input className={INPUT_CLS} value={form.nationalId} onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))} placeholder="۱۰ رقم" dir="ltr" maxLength={10} /></div>
          <div><label className={LABEL_CLS}>شماره موبایل *</label><input className={INPUT_CLS} value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="09123456789" dir="ltr" /></div>
          <div><label className={LABEL_CLS}>حوزه قضایی *</label><input className={INPUT_CLS} value={form.judicialDomain} onChange={(e) => setForm((f) => ({ ...f, judicialDomain: e.target.value }))} placeholder="مثال: ساری" /></div>
          <div><label className={LABEL_CLS}>رشته کارشناسی *</label><input className={INPUT_CLS} value={form.expertiseField} onChange={(e) => setForm((f) => ({ ...f, expertiseField: e.target.value }))} placeholder="مثال: کارشناس رسمی امور مالی" /></div>
          <div><label className={LABEL_CLS}>نام پدر</label><input className={INPUT_CLS} value={form.fatherName} onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))} placeholder="اختیاری" /></div>
          <div>
            <label className={LABEL_CLS}>تاریخ تولد (شمسی)</label>
            <JalaliDatePicker value={form.birthDate} onChange={(v) => setForm((f) => ({ ...f, birthDate: v }))} />
          </div>
          <div>
            <label className={LABEL_CLS}>جنسیت</label>
            <SearchableSelect options={GENDER_OPTIONS} value={form.gender} onChange={(v) => setForm((f) => ({ ...f, gender: v }))} placeholder="انتخاب کنید" searchPlaceholder="جستجو..." />
          </div>
          <div>
            <label className={LABEL_CLS}>استان</label>
            <SearchableSelect options={provinces} value={form.residenceProvince} onChange={(v) => setForm((f) => ({ ...f, residenceProvince: v, residenceCity: '' }))} placeholder="انتخاب استان" searchPlaceholder="جستجوی استان..." />
          </div>
          <div>
            <label className={LABEL_CLS}>شهر</label>
            <SearchableSelect options={form.residenceProvince ? (citiesByProvince[form.residenceProvince] ?? []) : []} value={form.residenceCity} onChange={(v) => setForm((f) => ({ ...f, residenceCity: v }))} placeholder={form.residenceProvince ? 'انتخاب شهر' : 'ابتدا استان را انتخاب کنید'} searchPlaceholder="جستجوی شهر..." disabled={!form.residenceProvince} />
          </div>
          <div>
            <label className={LABEL_CLS}>رمز عبور موقت</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className={cn(INPUT_CLS, 'pl-10')}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="اختیاری"
                dir="ltr"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 flex-shrink-0">
          <button
            onClick={handleSubmit}
            disabled={saving || !canSubmit}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
          >
            {saving ? <LoadingSpinner size="sm" /> : <UserPlus className="w-4 h-4" />}
            ایجاد کارآموز
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Edit User Modal ──────────────────────────────────────────────────────────

interface EditModalProps {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

function EditUserModal({ userId, onClose, onSaved }: EditModalProps) {
  const [profile, setProfile] = useState<UserProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    firstName: '', lastName: '', phoneNumber: '',
    judicialDomain: '', expertiseField: '', fatherName: '',
    birthDate: '', gender: '',
    residenceProvince: '', residenceCity: '',
  });

  useEffect(() => {
    api.get<{ data: UserProfileDto }>(`/users/${userId}`)
      .then((res) => {
        const p = res.data.data;
        setProfile(p);
        setForm({
          firstName: p.firstName,
          lastName: p.lastName,
          phoneNumber: p.phoneNumber,
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
  }, [userId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/users/${userId}`, {
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
      });
      toast.success('اطلاعات ذخیره شد');
      onSaved();
      onClose();
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
      const res = await api.post<{ data: UserProfileDto }>(`/users/${userId}/profile-image`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfile(res.data.data);
      toast.success('تصویر پروفایل بارگذاری شد');
    } catch {
      toast.error('بارگذاری تصویر ناموفق بود');
    } finally {
      setUploadingImage(false);
    }
  };

  const avatarUrl = profile?.profileImageUrl ?? profile?.avatarUrl;
  const initials = `${form.firstName[0] ?? ''}${form.lastName[0] ?? ''}`;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90dvh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-800">ویرایش کارآموز</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <LoadingSpinner size="lg" label="در حال بارگذاری..." />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 p-5 space-y-3">
            {/* Avatar upload */}
            <div className="flex items-center gap-4 mb-2">
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-primary-100 flex items-center justify-center">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                    : <span className="text-lg font-bold text-primary-600">{initials}</span>}
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
                <p className="text-sm font-semibold text-gray-700">{form.firstName} {form.lastName}</p>
                <p className="text-xs text-gray-400">{profile?.nationalId}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className={LABEL_CLS}>نام</label><input className={INPUT_CLS} value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></div>
              <div><label className={LABEL_CLS}>نام خانوادگی</label><input className={INPUT_CLS} value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></div>
            </div>
            <div><label className={LABEL_CLS}>شماره موبایل</label><input className={INPUT_CLS} value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} dir="ltr" /></div>
            <div><label className={LABEL_CLS}>حوزه قضایی</label><input className={INPUT_CLS} value={form.judicialDomain} onChange={(e) => setForm((f) => ({ ...f, judicialDomain: e.target.value }))} /></div>
            <div><label className={LABEL_CLS}>رشته کارشناسی</label><input className={INPUT_CLS} value={form.expertiseField} onChange={(e) => setForm((f) => ({ ...f, expertiseField: e.target.value }))} /></div>
            <div><label className={LABEL_CLS}>نام پدر</label><input className={INPUT_CLS} value={form.fatherName} onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))} /></div>
            <div>
              <label className={LABEL_CLS}>تاریخ تولد (شمسی)</label>
              <JalaliDatePicker value={form.birthDate} onChange={(v) => setForm((f) => ({ ...f, birthDate: v }))} />
            </div>
            <div>
              <label className={LABEL_CLS}>جنسیت</label>
              <SearchableSelect options={GENDER_OPTIONS} value={form.gender} onChange={(v) => setForm((f) => ({ ...f, gender: v }))} placeholder="انتخاب کنید" searchPlaceholder="جستجو..." />
            </div>
            <div>
              <label className={LABEL_CLS}>استان</label>
              <SearchableSelect options={provinces} value={form.residenceProvince} onChange={(v) => setForm((f) => ({ ...f, residenceProvince: v, residenceCity: '' }))} placeholder="انتخاب استان" searchPlaceholder="جستجوی استان..." />
            </div>
            <div>
              <label className={LABEL_CLS}>شهر</label>
              <SearchableSelect options={form.residenceProvince ? (citiesByProvince[form.residenceProvince] ?? []) : []} value={form.residenceCity} onChange={(v) => setForm((f) => ({ ...f, residenceCity: v }))} placeholder={form.residenceProvince ? 'انتخاب شهر' : 'ابتدا استان را انتخاب کنید'} searchPlaceholder="جستجوی شهر..." disabled={!form.residenceProvince} />
            </div>
          </div>
        )}

        {!loading && (
          <div className="px-5 pb-5 flex-shrink-0">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
            >
              {saving ? <LoadingSpinner size="sm" /> : <Save className="w-4 h-4" />}
              ذخیره تغییرات
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');

  const go = (p: number) => onChange(Math.max(1, Math.min(totalPages, p)));

  const commit = () => {
    const n = parseInt(inputVal, 10);
    if (!isNaN(n)) go(n);
    setEditing(false);
  };

  // Build: 1, 2, …, page-1, page, page+1, …, last-1, last
  const items: (number | 'ellipsis-start' | 'ellipsis-end')[] = [];
  const show = new Set([1, 2, page - 1, page, page + 1, totalPages - 1, totalPages].filter(p => p >= 1 && p <= totalPages));
  const sorted = Array.from(show).sort((a, b) => a - b);
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) items.push(i === 1 ? 'ellipsis-start' : 'ellipsis-end');
    items.push(p);
  });

  return (
    <div className="flex items-center justify-center gap-1 pt-2 flex-wrap">
      <button onClick={() => go(page - 1)} disabled={page === 1}
        className="w-8 h-8 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <ChevronRight className="w-4 h-4" />
      </button>

      {items.map((item, i) =>
        item === 'ellipsis-start' || item === 'ellipsis-end' ? (
          editing && item === 'ellipsis-end' ? (
            <input
              key="jump"
              autoFocus
              type="number"
              defaultValue={page}
              onChange={(e) => setInputVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              className="w-12 h-8 text-center text-sm border border-primary-300 ring-2 ring-primary-200 rounded-xl bg-white outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          ) : (
            <button key={item + String(i)} onClick={() => setEditing(true)}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-primary-600 text-sm transition-colors rounded-xl hover:bg-gray-50">
              ···
            </button>
          )
        ) : (
          <button key={item} onClick={() => go(item as number)}
            className={cn('w-8 h-8 rounded-xl text-sm font-medium transition-colors',
              item === page ? 'bg-primary-600 text-white shadow-sm' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}>
            {item}
          </button>
        )
      )}

      <button onClick={() => go(page + 1)} disabled={page === totalPages}
        className="w-8 h-8 flex items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadUsers = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const res = await api.get<{ data: UsersResponse }>('/users', {
        params: { page: p, limit: LIMIT, search: q || undefined },
      });
      setUsers(res.data.data.data);
      setTotal(res.data.data.meta.total);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(1, ''); }, [loadUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      void loadUsers(1, search);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, loadUsers]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void loadUsers(newPage, search);
  };

  const handleToggleStatus = async (u: UserDto) => {
    setTogglingId(u.id);
    try {
      await api.patch(`/users/${u.id}/status`, { isActive: !u.isActive });
      setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, isActive: !u.isActive } : x));
      toast.success(u.isActive ? 'حساب غیرفعال شد' : 'حساب فعال شد');
    } catch {
      toast.error('تغییر وضعیت ناموفق بود');
    } finally {
      setTogglingId(null);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);
  const activeCount = users.filter((u) => u.isActive).length;

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
    <div style={{ padding: '16px 16px calc(96px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', margin: 0 }}>مدیریت کارآموزان</h1>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '3px 0 0' }}>{total} نفر ثبت‌نام شده</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #0ABDE3, #0897B8)', color: 'white', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 14, border: 'none', cursor: 'pointer' }}
        >
          <UserPlus className="w-4 h-4" />
          افزودن
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'کل', value: total, Icon: Users, color: 'text-primary-600 bg-primary-50' },
          { label: 'فعال', value: activeCount, Icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
          { label: 'غیرفعال', value: users.length - activeCount, Icon: XCircle, color: 'text-red-500 bg-red-50' },
        ].map(({ label, value, Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl p-3 border border-gray-100 shadow-sm flex items-center gap-2">
            <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0', color)}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800 leading-none">{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="w-full bg-white border border-gray-200 rounded-2xl pr-9 pl-4 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-200 shadow-sm"
          placeholder="جستجو بر اساس نام، کد ملی، شماره موبایل..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Users list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <LoadingSpinner size="lg" label="در حال بارگذاری..." />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">کارآموزی یافت نشد</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const initials = `${u.firstName[0]}${u.lastName[0]}`;
            const avatarUrl = (u as UserDto & { profileImageUrl?: string }).profileImageUrl ?? u.avatarUrl;
            return (
              <div
                key={u.id}
                className={cn(
                  'bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3',
                  !u.isActive && 'opacity-60',
                )}
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {avatarUrl
                    ? <img src={avatarUrl} alt={u.firstName} className="w-full h-full object-cover" />
                    : <span className="text-sm font-bold text-primary-600">{initials}</span>}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-800 truncate">{u.firstName} {u.lastName}</p>
                    {!u.isActive && (
                      <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">غیرفعال</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{u.nationalId} · {u.judicialDomain}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditingUserId(u.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="ویرایش"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  <Link
                    href={`/admin/conversations?userId=${u.id}`}
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="باز کردن گفتگو"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </Link>

                  <button
                    onClick={() => handleToggleStatus(u)}
                    disabled={togglingId === u.id}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center rounded-xl transition-colors',
                      u.isActive
                        ? 'text-green-500 hover:text-red-500 hover:bg-red-50'
                        : 'text-red-400 hover:text-green-600 hover:bg-green-50',
                    )}
                    title={u.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                  >
                    {togglingId === u.id
                      ? <LoadingSpinner size="sm" />
                      : u.isActive ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onChange={handlePageChange} />
      )}

      {/* Modals */}
      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => loadUsers(1, search)} />}
      {editingUserId && <EditUserModal userId={editingUserId} onClose={() => setEditingUserId(null)} onSaved={() => loadUsers(page, search)} />}
    </div>
    </div>
  );
}
