import { io, type Socket } from 'socket.io-client';
import { tokenStore, refreshAccessToken } from './api-client';
import { attachSocketDiagnostics } from './socket-diagnostics';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:3001';

let socket: Socket | null = null;
let visibilityHooked = false;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      // تابع (نه آبجکت) — توکن در «هر» تلاش اتصال تازه خوانده می‌شود.
      // باگ قبلی موبایل: توکن فقط بار اول گرفته می‌شد؛ بعد از suspend شدن اپ در iOS
      // یا انقضای ۱۵ دقیقه‌ای access token، reconnect با توکن مرده انجام می‌شد
      // و سرور قطع می‌کرد → realtime تا رفرش کامل صفحه می‌مُرد.
      auth: (cb) => cb({ token: `Bearer ${tokenStore.getAccess() ?? ''}` }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity, // گوشی ممکن است مدت طولانی آفلاین/قفل باشد
    });

    // Observation only (lifecycle ring buffer + [karamooz-chat-diag] console +
    // batched server telemetry). Never alters connect/reconnect behavior.
    attachSocketDiagnostics(socket);

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // سرور قطع کرد — تقریباً همیشه یعنی access token منقضی شده:
        // رفرش کن و با توکن تازه دوباره وصل شو (listener ها حفظ می‌شوند)
        void refreshAccessToken().then((token) => {
          if (token) {
            socket?.connect();
          } else {
            // refresh هم نامعتبر است — کاربر باید دوباره لاگین کند
            socket?.removeAllListeners();
            socket = null;
          }
        });
      }
    });

    // برگشت از پس‌زمینه (iOS سوکت‌ها را suspend می‌کند) → اتصال فوری با توکن تازه
    if (!visibilityHooked && typeof document !== 'undefined') {
      visibilityHooked = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (socket && !socket.connected) {
          void refreshAccessToken().finally(() => socket?.connect());
        }
      });
    }
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function reconnectSocket(): void {
  disconnectSocket();
  getSocket();
}
