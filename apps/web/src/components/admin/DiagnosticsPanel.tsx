'use client';

/**
 * ADMIN-only diagnostics section (rendered on /admin/profile).
 *
 * Surfaces the locally retained chat/socket diagnostics
 * (see lib/diagnostics-store.ts): offline JSONL export, Persian clipboard
 * summary, optional live file logging (desktop Chromium), and a confirmed
 * clear of ONLY the diagnostics store. Pure observation tooling — it never
 * touches chat messages, the outbox, auth, or server telemetry behavior.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Activity, ClipboardCopy, Download, FileText, Square, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { exportDiagnosticsJsonl, buildDiagnosticsSummaryFa } from '@/lib/diagnostics-export';
import { clearDiagnosticsEvents, readAllDiagEvents } from '@/lib/diagnostics-store';
import {
  isLiveLogSupported,
  startLiveFileLog,
  stopLiveFileLog,
  resumeLiveLogIfPermitted,
} from '@/lib/diagnostics-live-log';

const NAVY = '#1c274c';

export function DiagnosticsPanel() {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [liveActive, setLiveActive] = useState(false);
  const [liveSupported, setLiveSupported] = useState(false);
  const [eventCount, setEventCount] = useState<number | null>(null);

  useEffect(() => {
    setLiveSupported(isLiveLogSupported());
    // Verify-only resume: continues live logging in a new session ONLY when
    // permission is still granted — never prompts automatically.
    void resumeLiveLogIfPermitted().then((active) => setLiveActive(active));
    void readAllDiagEvents().then((events) => setEventCount(events.length));
  }, []);

  if (user?.role !== 'ADMIN') return null;

  const handleDownload = async () => {
    setBusy(true);
    const count = await exportDiagnosticsJsonl();
    setBusy(false);
    if (count === null) {
      toast.error('دانلود گزارش ناموفق بود');
    } else {
      toast.success(`گزارش با ${count} رویداد دانلود شد`);
    }
  };

  const handleCopySummary = async () => {
    setBusy(true);
    const summary = await buildDiagnosticsSummaryFa();
    setBusy(false);
    if (!summary) {
      toast.error('ساخت خلاصه گزارش ناموفق بود');
      return;
    }
    try {
      await navigator.clipboard.writeText(summary);
      toast.success('خلاصه گزارش کپی شد');
    } catch {
      toast.error('کپی در حافظه ناموفق بود');
    }
  };

  const handleClear = async () => {
    // Explicit confirmation — clears ONLY the diagnostics store.
    const confirmed = window.confirm(
      'گزارش محلی عیب‌یابی پاک شود؟ (پیام‌ها، گفتگوها و ورود شما تغییری نمی‌کنند)',
    );
    if (!confirmed) return;
    setBusy(true);
    const ok = await clearDiagnosticsEvents();
    setBusy(false);
    if (ok) {
      setEventCount(0);
      toast.success('گزارش محلی پاک شد');
    } else {
      toast.error('پاک‌کردن گزارش ناموفق بود');
    }
  };

  const handleLiveToggle = async () => {
    if (liveActive) {
      stopLiveFileLog();
      setLiveActive(false);
      toast.success('ثبت زنده در فایل متوقف شد');
      return;
    }
    setBusy(true);
    const result = await startLiveFileLog();
    setBusy(false);
    if (result === 'started') {
      setLiveActive(true);
      toast.success('ثبت زنده در فایل شروع شد');
    } else if (result === 'cancelled') {
      /* user closed the picker — no toast needed */
    } else if (result === 'unsupported') {
      toast.error('مرورگر از ثبت زنده در فایل پشتیبانی نمی‌کند؛ گزارش همچنان به‌صورت محلی ذخیره می‌شود');
    } else {
      toast.error('شروع ثبت زنده ناموفق بود؛ گزارش همچنان به‌صورت محلی ذخیره می‌شود');
    }
  };

  const btnStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: 42,
    padding: '0 16px',
    borderRadius: 21,
    border: `1.5px solid rgba(28,39,76,0.25)`,
    background: 'linear-gradient(180deg, #FDFEFF 0%, #EFF5FA 100%)',
    color: NAVY,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <section dir="rtl" style={{ width: '100%', maxWidth: 420, marginTop: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Activity style={{ width: 18, height: 18, color: NAVY }} strokeWidth={1.8} />
        <h2 style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, margin: 0 }}>
          گزارش عیب‌یابی اتصال و ارسال پیام
        </h2>
      </div>
      <p style={{ fontSize: 11.5, color: 'rgba(28,39,76,0.65)', margin: '0 0 14px', lineHeight: 1.8 }}>
        رویدادهای فنی اتصال (بدون متن پیام‌ها) به‌صورت محلی در همین مرورگر نگهداری می‌شوند
        {eventCount !== null ? ` — ${eventCount} رویداد ذخیره‌شده` : ''}. برای بررسی مشکلات
        اتصال، فایل گزارش را دانلود و برای پشتیبانی ارسال کنید.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={btnStyle} onClick={() => void handleDownload()} disabled={busy}>
          <Download style={{ width: 16, height: 16 }} strokeWidth={1.8} />
          دانلود گزارش اتصال و ارسال پیام
        </button>

        <button style={btnStyle} onClick={() => void handleCopySummary()} disabled={busy}>
          <ClipboardCopy style={{ width: 16, height: 16 }} strokeWidth={1.8} />
          کپی خلاصه گزارش
        </button>

        {liveSupported && (
          <button style={btnStyle} onClick={() => void handleLiveToggle()} disabled={busy}>
            {liveActive ? (
              <Square style={{ width: 16, height: 16 }} strokeWidth={1.8} />
            ) : (
              <FileText style={{ width: 16, height: 16 }} strokeWidth={1.8} />
            )}
            {liveActive ? 'توقف ثبت زنده در فایل' : 'شروع ثبت زنده در فایل'}
          </button>
        )}

        <button
          style={{ ...btnStyle, color: '#b3261e', borderColor: 'rgba(179,38,30,0.35)' }}
          onClick={() => void handleClear()}
          disabled={busy}
        >
          <Trash2 style={{ width: 16, height: 16 }} strokeWidth={1.8} />
          پاک‌کردن گزارش محلی
        </button>
      </div>
    </section>
  );
}
