import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const SocketContext = createContext<Socket | null>(null);

/**
 * Closes a socket without tearing down a handshake that is still in flight.
 *
 * StrictMode runs every effect twice in dev, so the first socket is cleaned up
 * while its WebSocket is still CONNECTING — which the browser reports as
 * "WebSocket is closed before the connection is established". Waiting for the
 * handshake to settle removes the warning without weakening cleanup: the
 * socket is still always closed, just one tick later.
 */
function closeSocket(s: Socket): void {
  if (s.connected) {
    s.disconnect();
    return;
  }
  s.once('connect', () => s.disconnect());
  s.once('connect_error', () => s.disconnect());
}

export function SocketProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    const s = io(import.meta.env.VITE_SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000
    });

    s.on('connect_error', (err: Error) => {
      // 'unauthorized' means the token is missing, invalid, or names a principal
      // that no longer exists — the session is dead, so stop reconnecting and
      // clear it. 'unavailable' is a server-side blip, so leave the socket to
      // retry on its own backoff rather than signing the guest out.
      if (err.message === 'unauthorized') {
        s.disconnect();
        logout();
      }
    });

    setSocket(s);

    return () => {
      s.removeAllListeners();
      closeSocket(s);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

/** Subscribes to a Socket.IO event for the lifetime of the component; always cleans up on unmount. */
export function useSocketEvent<T = unknown>(event: string | undefined, handler: (payload: T) => void): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket || !event) return;
    const wrapped = (payload: T) => handlerRef.current(payload);
    socket.on(event, wrapped);
    return () => {
      socket.off(event, wrapped);
    };
  }, [socket, event]);
}

/** True once the socket has actually connected (useful for a small "live" indicator). */
export function useSocketConnected(): boolean {
  const socket = useSocket();
  const [connected, setConnected] = useState(!!socket?.connected);

  useEffect(() => {
    if (!socket) {
      setConnected(false);
      return;
    }
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    setConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return connected;
}
