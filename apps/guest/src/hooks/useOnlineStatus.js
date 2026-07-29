import { useEffect, useState } from 'react';

/**
 * Tracks browser connectivity.
 *
 * `navigator.onLine` is only a link-layer signal — it says the device has *a*
 * network, not that the API is reachable — so this is deliberately used only
 * for the "you are offline" banner, never to gate a request. The API client's
 * own `NETWORK_ERROR` remains the authority on whether a call actually failed.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Resync on mount: the event can fire between the initial render and here.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}
