'use client';

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, subscribeSocket } from '@/lib/socket-client';
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
    getSocket();
    // Subscribe (not just a one-off getSocket()) so a hard rebuild (zombie
    // socket recovery) or a login/logout socket swap re-renders this
    // consumer with the fresh instance instead of leaving it holding a
    // disconnected, listener-stripped socket.
    const unsubscribe = subscribeSocket(setSocket);
    return unsubscribe;
    // Don't disconnect on unmount — shared connection
  }, [isAuthenticated]);

  return socket;
}

/**
 * Always-current live socket, for consumers that attach listeners in an
 * effect and must keep them attached to whichever Socket.IO client is
 * actually live (a hard rebuild replaces the underlying client with a new
 * object — see socket-client.ts). Re-renders the owning component on every
 * replacement so the effect's `[socket]` dependency re-runs and reattaches.
 */
export function useLiveSocket(): Socket {
  const [socket, setSocket] = useState<Socket>(() => getSocket());
  useEffect(() => subscribeSocket(setSocket), []);
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
