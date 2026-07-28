import { useEffect, useState } from 'react';

/**
 * Tracks browser connectivity.
 *
 * `navigator.onLine` is only a link-layer signal — it says the device has *a*
 * network, not that the API is reachable — so this drives the offline banner
 * only, never request gating. The socket's `connected` flag and the API
 * client's `NETWORK_ERROR` remain the authority on real reachability.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

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
