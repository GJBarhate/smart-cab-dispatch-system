import { useEffect, useRef, useState } from 'react';
import { useSocket } from './useSocket';
import { haversineKm } from '../lib/geo';
import type { LatLngTuple } from '../lib/geo';

const EMIT_THROTTLE_MS = 5000; // matches server LOCATION_EMIT_THROTTLE_MS (plan.md §10.3)
const MIN_MOVE_METERS = 20;

export type GeoPermission = 'idle' | 'granted' | 'denied' | 'unsupported';

export function useDriverGeolocation(enabled: boolean) {
  const { socket } = useSocket();
  const [position, setPosition] = useState<LatLngTuple | null>(null);
  const [heading, setHeading] = useState(0);
  const [permission, setPermission] = useState<GeoPermission>('idle');
  const lastEmitRef = useRef<{ at: number; pos: LatLngTuple } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) {
      setPermission('unsupported');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setPermission('granted');
        const next: LatLngTuple = [pos.coords.latitude, pos.coords.longitude];
        setPosition(next);
        if (pos.coords.heading !== null && !Number.isNaN(pos.coords.heading)) setHeading(pos.coords.heading);

        const now = Date.now();
        const last = lastEmitRef.current;
        const movedEnoughKm = !last || haversineKm(last.pos, next) * 1000 >= MIN_MOVE_METERS;
        const enoughTimePassed = !last || now - last.at >= EMIT_THROTTLE_MS;

        if (movedEnoughKm && enoughTimePassed && socket) {
          socket.emit('driver:location', {
            lat: next[0],
            lng: next[1],
            heading: pos.coords.heading ?? undefined,
            speedKmph: pos.coords.speed ? pos.coords.speed * 3.6 : undefined
          });
          lastEmitRef.current = { at: now, pos: next };
        }
      },
      () => setPermission('denied'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, socket]);

  return { position, heading, permission };
}
