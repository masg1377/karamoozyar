'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import api, { tokenStore } from '@/lib/api-client';
import { reconnectSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/store/auth.store';
import type { UserDto } from '@karamooziyar/shared';

type Step = 'national_id' | 'otp';

interface SendOtpResponse { data: { message: string; expiresIn: number } }
interface VerifyOtpResponse {
  data: {
    tokens: { accessToken: string; refreshToken: string };
    user: UserDto;
  };
}

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();

  const [step, setStep] = useState<Step>('national_id');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const startCountdown = (seconds: number) => {
    setCountdown(seconds);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendOtp = async () => {
    const trimmed = identifier.trim();
    // Accept 10-digit nationalId OR 11-digit phone (09...) OR +98... or 98...
    const isNationalId = /^\d{10}$/.test(trimmed);
    const isPhone = /^(\+98|98|0)9\d{9}$/.test(trimmed);
    if (!isNationalId && !isPhone) {
      toast.error('کد ملی یا شماره موبایل معتبر نیست');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<SendOtpResponse>('/auth/send-otp', { identifier: trimmed });
      toast.success(res.data.data.message);
      setStep('otp');
      startCountdown(res.data.data.expiresIn);
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    } catch {
      toast.error('کد ملی یا شماره موبایل یافت نشد');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...otp];
    next[index] = value;
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
    if (next.every((d) => d !== '')) {
      void handleVerify(next.join(''));
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (code?: string) => {
    const otpCode = code ?? otp.join('');
    if (otpCode.length !== 6) return;
    setLoading(true);
    try {
      const res = await api.post<VerifyOtpResponse>('/auth/verify-otp', {
        identifier: identifier.trim(),
        otp: otpCode,
      });
      const { tokens, user } = res.data.data;
      tokenStore.setAccess(tokens.accessToken);
      tokenStore.setRefresh(tokens.refreshToken);
      setUser(user);

      // Initialize socket with the new token now that we're authenticated
      reconnectSocket();

      // Set auth cookies for middleware (persistent — 7 days)
      const maxAge = 7 * 24 * 60 * 60;
      document.cookie = `auth_flag=true; path=/; SameSite=Lax; max-age=${maxAge}`;
      document.cookie = `user_role=${user.role}; path=/; SameSite=Lax; max-age=${maxAge}`;

      toast.success(`خوش آمدید، ${user.firstName} ${user.lastName}`);
      router.push(user.role === 'ADMIN' ? '/admin' : '/dashboard');
    } catch {
      toast.error('کد وارد شده نادرست است');
      setOtp(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="کارآموزیار" className="w-24 h-24 object-contain mb-2 mx-auto" />
          <h1 className="text-2xl font-bold text-gray-900">کارآموزیار</h1>
          <p className="text-sm text-gray-500 mt-1">مرکز کارشناسان رسمی دادگستری مازندران</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
          {step === 'national_id' ? (
            <>
              <h2 className="text-lg font-semibold text-gray-800 mb-1">ورود به سامانه</h2>
              <p className="text-sm text-gray-500 mb-6">کد ملی یا شماره موبایل خود را وارد کنید</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    کد ملی یا شماره موبایل
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="کد ملی یا شماره موبایل"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value.replace(/[^\d+]/g, '').slice(0, 14))}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSendOtp()}
                    className="input-ltr w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-lg tracking-widest placeholder:text-gray-300 placeholder:tracking-normal"
                    maxLength={14}
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                <button
                  onClick={handleSendOtp}
                  disabled={loading || identifier.trim().length < 10}
                  className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : null}
                  دریافت کد تأیید
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-6">
                <button
                  onClick={() => { setStep('national_id'); setOtp(['', '', '', '', '', '']); setIdentifier(''); }}
                  className="text-primary-600 hover:text-primary-700 transition-colors"
                >
                  <svg className="w-5 h-5 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-gray-800">کد تأیید</h2>
                  <p className="text-sm text-gray-500">
                    کد ۶ رقمی برای <span className="font-mono font-medium" dir="ltr">{identifier}</span> ارسال شد
                  </p>
                </div>
              </div>

              {/* OTP Boxes */}
              <div className="flex gap-2 justify-center mb-6" dir="ltr">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { otpRefs.current[i] = el; }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-11 h-14 text-center text-xl font-bold border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200 transition-all"
                  />
                ))}
              </div>

              <button
                onClick={() => void handleVerify()}
                disabled={loading || otp.some((d) => !d)}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors duration-200 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : null}
                ورود
              </button>

              <div className="mt-4 text-center">
                {countdown > 0 ? (
                  <p className="text-sm text-gray-500">
                    ارسال مجدد تا <span className="font-mono font-medium text-primary-600">{countdown}</span> ثانیه دیگر
                  </p>
                ) : (
                  <button
                    onClick={handleSendOtp}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    ارسال مجدد کد
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          © ۱۴۰۴ مرکز کارشناسان رسمی دادگستری مازندران
        </p>
      </div>
    </div>
  );
}
