import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, MapPin } from 'lucide-react';
import { LiveMap } from '../components/LiveMap';
import { CardSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { useTripCurrent, useGuestMe, guestKeys } from '../hooks/useGuestQueries';
import { useSocketConnected, useSocketEvent } from '../hooks/useSocket';
import { useTripSubscription } from '../hooks/useTripSubscription';
import { useDriverPosition } from '../hooks/useDriverPosition';
import { useCountdownSeconds } from '../hooks/useCountdown';
import { toLatLng, geoPointToLeaflet, decodePolylineToLeaflet } from '../utils/geo';
import { nextStopForGuest, dropStopForGuest } from '../utils/trip';
import { TRIP_STATUS_LABEL } from '../utils/labels';
function formatEta(seconds) {
  if (seconds === null) return '—';
  if (seconds <= 30) return 'Arriving now';
  const mins = Math.ceil(seconds / 60);
  return `${mins} min`;
}
export default function Track() {
  const {
    data: guest
  } = useGuestMe();
  const {
    data: tripResp,
    isLoading,
    error,
    refetch
  } = useTripCurrent();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useCallback(() => queryClient.invalidateQueries({
    queryKey: guestKeys.tripCurrent
  }), [queryClient]);
  useSocketEvent('trip:status', invalidate);
  useSocketEvent('trip:eta', invalidate);
  const connected = useSocketConnected();
  const trip = tripResp?.trip ?? null;
  useTripSubscription(trip?.id ?? null);
  const driverRestPos = trip?.driverId?.currentLocation ? toLatLng(trip.driverId.currentLocation) : null;
  const livePos = useDriverPosition(trip?.id ?? null, driverRestPos ? {
    ...driverRestPos,
    heading: trip?.driverId?.heading
  } : null);
  const guestId = guest?.id;
  const pickupStop = trip && guestId ? nextStopForGuest(trip, guestId) : null;
  const dropStop = trip && guestId ? dropStopForGuest(trip, guestId) : null;
  const activeStop = pickupStop?.status !== 'done' ? pickupStop : dropStop;
  const etaSeconds = useCountdownSeconds(activeStop?.etaAt ?? null);
  const pickup = geoPointToLeaflet(pickupStop?.coordinates);
  const drop = geoPointToLeaflet(dropStop?.coordinates);
  const polyline = trip?.route?.polyline ? decodePolylineToLeaflet(trip.route.polyline) : [];
  if (isLoading) {
    return <div className="p-4">
        <CardSkeleton />
      </div>;
  }
  if (error) {
    return <div className="p-4">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>;
  }
  if (!trip) {
    return <div className="p-4">
        <EmptyState icon={MapPin} title="No active ride to track" subtitle="Once you have a driver assigned, live tracking shows up here." />
      </div>;
  }
  return <div className="relative h-full w-full">
      <LiveMap mapId="track-page-map" className="h-full w-full" driverPosition={livePos} pickup={pickup ? {
      lat: pickup[0],
      lng: pickup[1]
    } : null} drop={drop ? {
      lat: drop[0],
      lng: drop[1]
    } : null} polyline={polyline} />

      <button onClick={() => navigate(-1)} aria-label="Back" className="absolute left-4 top-4 z-[1000] flex h-12 w-12 items-center justify-center rounded-full bg-surface shadow-lg ring-1 ring-line active:scale-95">
        <ChevronLeft className="h-6 w-6 text-muted" />
      </button>

      <div className="er-elev-2 absolute left-1/2 top-4 z-[1000] flex -translate-x-1/2 items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink">
        {/* The ping is the guest's only cue that the ETA is still being updated
            rather than frozen on the last value the app happened to receive. */}
        <span className="er-live-dot" data-stale={!connected} title={connected ? 'Live' : 'Reconnecting…'} />
        {TRIP_STATUS_LABEL[trip.status] ?? trip.status} · ETA <span className="er-nums">{formatEta(etaSeconds)}</span>
      </div>
    </div>;
}
