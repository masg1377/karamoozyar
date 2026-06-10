import { io, type Socket } from 'socket.io-client';
import { tokenStore } from './api-client';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = tokenStore.getAccess();
    socket = io(WS_URL, {
      auth: { token: token ? `Bearer ${token}` : '' },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    // If server explicitly disconnects us (auth failure), stop reconnecting
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server rejected — clean up so next getSocket() creates fresh with new token
        socket?.removeAllListeners();
        socket = null;
      }
    });
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
