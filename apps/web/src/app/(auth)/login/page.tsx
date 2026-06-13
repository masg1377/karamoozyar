'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import logoSrc from '@/assets/logo.png';
import { toast } from 'sonner';
import api, { tokenStore } from '@/lib/api-client';
import { reconnectSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/store/auth.store';
import type { UserDto } from '@karamooziyar/shared';

type Step = 'national_id' | 'otp';
interface SendOtpResponse { data: { message: string; expiresIn: number } }
interface VerifyOtpResponse {
  data: { tokens: { accessToken: string; refreshToken: string }; user: UserDto };
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
    if (next.every((d) => d !== '')) void handleVerify(next.join(''));
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const handleVerify = async (code?: string) => {
    const otpCode = code ?? otp.join('');
    if (otpCode.length !== 6) return;
    setLoading(true);
    try {
      const res = await api.post<VerifyOtpResponse>('/auth/verify-otp', {
        identifier: identifier.trim(), otp: otpCode,
      });
      const { tokens, user } = res.data.data;
      tokenStore.setAccess(tokens.accessToken);
      tokenStore.setRefresh(tokens.refreshToken);
      setUser(user);
      reconnectSocket();
      const maxAge = 90 * 24 * 60 * 60; // هم‌راستا با عمر ۹۰ روزه refresh token
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
    <div
      className="min-h-screen flex flex-col items-center justify-center p-5"
      style={{ background: 'linear-gradient(180deg, #C8E6F7 0%, #EBF5FF 40%, #F5FAFF 100%)' }}
    >
      {/* Logo + title */}
      <div className="text-center mb-8">
        <img
          src={(logoSrc as { src: string }).src}
          alt="لوگو"
          style={{ width: 96, height: 96, objectFit: 'contain', margin: '0 auto 16px', display: 'block' }}
        />
        <h1 className="text-xl font-bold text-gray-800 tracking-tight">کارآموزیار</h1>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg shadow-blue-100/60 p-6">
        {step === 'national_id' ? (
          <>
            <h2 className="text-base font-bold text-gray-800 mb-1 text-right">ورود به سامانه</h2>
            <p className="text-xs text-gray-400 mb-5 text-right">کد ملی یا شماره موبایل خود را وارد کنید</p>

            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-500 mb-2 text-right">
                کدملی یا شماره همراه
              </label>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="123456789"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value.replace(/[^\d+]/g, '').slice(0, 14))}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendOtp()}
                className="input-ltr w-full px-4 py-3 rounded-2xl border border-gray-200 bg-gray-50/80 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-300 text-base placeholder:text-gray-300 transition-all"
                maxLength={14}
                autoFocus
                autoComplete="off"
              />
            </div>

            <button
              onClick={handleSendOtp}
              disabled={loading || identifier.trim().length < 10}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #0ABDE3 0%, #0897B8 100%)' }}
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              تایید
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={() => { setStep('national_id'); setOtp(['', '', '', '', '', '']); }}
                className="text-primary-500 hover:text-primary-600 transition-colors"
              >
                {/* RTL: arrow points right = back */}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div>
                <h2 className="text-base font-bold text-gray-800">کد تأیید</h2>
                <p className="text-xs text-gray-400">
                  ارسال شد به{' '}
                  <span className="font-mono font-medium text-gray-600" dir="ltr">{identifier}</span>
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-center mb-5" dir="ltr">
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
                  className="w-11 h-12 text-center text-xl font-bold border-2 border-gray-200 bg-gray-50 rounded-xl focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 transition-all"
                />
              ))}
            </div>

            <button
              onClick={() => void handleVerify()}
              disabled={loading || otp.some((d) => !d)}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #0ABDE3 0%, #0897B8 100%)' }}
            >
              {loading && (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              ورود
            </button>

            <div className="mt-4 text-center">
              {countdown > 0 ? (
                <p className="text-xs text-gray-400">
                  ارسال مجدد تا{' '}
                  <span className="font-mono font-medium text-primary-500">{countdown}</span> ثانیه
                </p>
              ) : (
                <button onClick={handleSendOtp} className="text-xs text-primary-500 hover:underline">
                  ارسال مجدد کد
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <p className="text-center text-[11px] text-gray-400 mt-6">
        نسخه ۱.۰.۱ - تمامی حقوق این برنامه محفوظ است
      </p>
    </div>
  );
}
