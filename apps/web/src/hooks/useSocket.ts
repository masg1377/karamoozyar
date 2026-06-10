'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { getSocket, disconnectSocket } from '@/lib/socket-client';
import { useAuthStore } from '@/store/auth.store';

export function useSocket(): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;

    socketRef.current = getSocket();

    return () => {
      // Don't disconnect on unmount — shared connection
    };
  }, [isAuthenticated]);

  return socketRef.current;
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
