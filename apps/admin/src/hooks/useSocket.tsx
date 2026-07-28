import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? 'http://localhost:4000';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

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

export function SocketProvider({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      return;
    }

    // §16.11: production behind a proxy needs both transports listed explicitly.
    const s = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000
    });

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    // 'unauthorized' means the token is missing, invalid, or names a principal
    // that no longer exists (the usual cause is a re-seed). Without this the
    // socket retries a dead session forever and the UI just looks offline.
    // 'unavailable' is a server-side blip, so leave it to the normal backoff.
    const onConnectError = (err: Error) => {
      setConnected(false);
      if (err.message === 'unauthorized') {
        s.disconnect();
        // Read through getState() rather than subscribing: making `clear` an
        // effect dependency would tear down and rebuild the socket whenever the
        // store's identity changed.
        useAuthStore.getState().clear();
      }
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);

    socketRef.current = s;
    setSocket(s);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      closeSocket(s);
      socketRef.current = null;
    };
  }, [token]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * Subscribes to a socket event for the lifetime of the component only.
 * §16.20: listeners registered without cleanup stack up on every render/navigation.
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  const { socket } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const wrapped = (payload: T) => handlerRef.current(payload);
    socket.on(event, wrapped);
    return () => {
      socket.off(event, wrapped);
    };
  }, [socket, event]);
}
