import { useCallback, useEffect, useState } from 'react';
import { useSocketEvent } from './useSocket';
import type { LatLng } from '../utils/geo';

export interface LiveDriverPosition extends LatLng {
  heading?: number;
  at?: string;
}

/**
 * Tracks a driver's live position for the guest's own trip. Seeded from REST
 * (source of truth), then updated by `driver:position` socket deltas — the
 * guest is only ever a member of one trip room, so any event received here
 * belongs to their own driver.
 */
export function useDriverPosition(tripId: string | null | undefined, restFallback: LiveDriverPosition | null): LiveDriverPosition | null {
  const [pos, setPos] = useState<LiveDriverPosition | null>(restFallback);

  useEffect(() => {
    setPos(restFallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, restFallback?.lat, restFallback?.lng]);

  useSocketEvent<{ driverId: string; lat: number; lng: number; heading?: number; at: string }>(
    'driver:position',
    useCallback(
      (payload) => {
        if (!tripId) return;
        setPos({ lat: payload.lat, lng: payload.lng, heading: payload.heading, at: payload.at });
      },
      [tripId]
    )
  );

  return pos;
}
