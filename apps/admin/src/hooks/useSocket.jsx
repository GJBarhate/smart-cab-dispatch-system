import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:4000';
const SocketContext = createContext({
  socket: null,
  connected: false
});

/**
 * Closes a socket without tearing down a handshake that is still in flight.
 *
 * StrictMode runs every effect twice in dev, so the first socket is cleaned up
 * while its WebSocket is still CONNECTING — which the browser reports as
 * "WebSocket is closed before the connection is established". Waiting for the
 * handshake to settle removes the warning without weakening cleanup: the
 * socket is still always closed, just one tick later.
 */
function closeSocket(s) {
  if (s.connected) {
    s.disconnect();
    return;
  }
  s.once('connect', () => s.disconnect());
  s.once('connect_error', () => s.disconnect());
}
export function SocketProvider({
  children
}) {
  const token = useAuthStore(s => s.token);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
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
      auth: {
        token
      },
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
    const onConnectError = err => {
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
  const value = useMemo(() => ({
    socket,
    connected
  }), [socket, connected]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
export function useSocket() {
  return useContext(SocketContext);
}

/**
 * Subscribes to a socket event for the lifetime of the component only.
 * §16.20: listeners registered without cleanup stack up on every render/navigation.
 */
export function useSocketEvent(event, handler) {
  const {
    socket
  } = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!socket) return;
    const wrapped = payload => handlerRef.current(payload);
    socket.on(event, wrapped);
    return () => {
      socket.off(event, wrapped);
    };
  }, [socket, event]);
}
