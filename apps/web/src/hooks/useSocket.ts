'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/store/auth.store';

export function useSocket(): Socket | null {
  // state (نه ref) — تا با آماده شدن socket مصرف‌کننده re-render شود
  // و useSocketEvent بتواند listener را واقعاً وصل کند.
  // (باگ قبلی: ref تغییرش re-render نمی‌دهد → socket همیشه null می‌ماند → هیچ event وصل نمی‌شد)
  const [socket, setSocket] = useState<Socket | null>(null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      setSocket(null);
      return;
    }
    setSocket(getSocket());
    // Don't disconnect on unmount — shared connection
  }, [isAuthenticated]);

  return socket;
}

export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}
