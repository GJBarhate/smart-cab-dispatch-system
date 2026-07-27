import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MapPin } from 'lucide-react';
import { LiveMap } from '../components/LiveMap';
import { CardSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { useTripCurrent, useGuestMe, guestKeys } from '../hooks/useGuestQueries';
import { useSocketEvent } from '../hooks/useSocket';
import { useTripSubscription } from '../hooks/useTripSubscription';
import { useDriverPosition } from '../hooks/useDriverPosition';
import { useCountdownSeconds } from '../hooks/useCountdown';
import { toLatLng, geoPointToLeaflet, decodePolylineToLeaflet } from '../utils/geo';
import { nextStopForGuest, dropStopForGuest } from '../utils/trip';
import { TRIP_STATUS_LABEL } from '../utils/labels';

function formatEta(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds <= 30) return 'Arriving now';
  const mins = Math.ceil(seconds / 60);
  return `${mins} min`;
}

export default function Track(): JSX.Element {
  const { data: guest } = useGuestMe();
  const { data: tripResp, isLoading, error, refetch } = useTripCurrent();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: guestKeys.tripCurrent }), [queryClient]);
  useSocketEvent('trip:status', invalidate);
  useSocketEvent('trip:eta', invalidate);

  const trip = tripResp?.trip ?? null;
  useTripSubscription(trip?.id ?? null);

  const driverRestPos = trip?.driverId?.currentLocation ? toLatLng(trip.driverId.currentLocation) : null;
  const livePos = useDriverPosition(trip?.id ?? null, driverRestPos ? { ...driverRestPos, heading: trip?.driverId?.heading } : null);

  const guestId = guest?.id;
  const pickupStop = trip && guestId ? nextStopForGuest(trip, guestId) : null;
  const dropStop = trip && guestId ? dropStopForGuest(trip, guestId) : null;
  const activeStop = pickupStop?.status !== 'done' ? pickupStop : dropStop;
  const etaSeconds = useCountdownSeconds(activeStop?.etaAt ?? null);

  const pickup = geoPointToLeaflet(pickupStop?.coordinates);
  const drop = geoPointToLeaflet(dropStop?.coordinates);
  const polyline = trip?.route?.polyline ? decodePolylineToLeaflet(trip.route.polyline) : [];

  if (isLoading) {
    return (
      <div className="p-4">
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="p-4">
        <EmptyState icon={MapPin} title="No active ride to track" subtitle="Once you have a driver assigned, live tracking shows up here." />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <LiveMap
        mapId="track-page-map"
        className="h-full w-full"
        driverPosition={livePos}
        pickup={pickup ? { lat: pickup[0], lng: pickup[1] } : null}
        drop={drop ? { lat: drop[0], lng: drop[1] } : null}
        polyline={polyline}
      />

      <button
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="absolute left-4 top-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg"
      >
        <ChevronLeft className="h-6 w-6 text-gray-700" />
      </button>

      <div className="absolute left-1/2 top-4 z-[1000] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-lg">
        {TRIP_STATUS_LABEL[trip.status] ?? trip.status} · ETA {formatEta(etaSeconds)}
      </div>
    </div>
  );
}
