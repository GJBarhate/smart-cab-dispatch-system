import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Phone, Plane, Train, Car, Clock, Users, Sparkles, CheckCircle2, Maximize2 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CardSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { InstallPrompt } from '../components/InstallPrompt';
import { LiveMap } from '../components/LiveMap';
import { useGuestMe, useTripCurrent, guestKeys } from '../hooks/useGuestQueries';
import { useSocketEvent } from '../hooks/useSocket';
import { useTripSubscription } from '../hooks/useTripSubscription';
import { useDriverPosition } from '../hooks/useDriverPosition';
import { useAssignedNotificationPrompt } from '../hooks/useServiceWorkerPush';
import { useActiveRequestStore } from '../store/activeRequestStore';
import { useCountdownSeconds, useElapsedSeconds, formatWait } from '../hooks/useCountdown';
import { toLatLng, geoPointToLeaflet } from '../utils/geo';
import { nextStopForGuest, dropStopForGuest } from '../utils/trip';
import type { GuestMe, TripView } from '../types/domain';
import type { LiveDriverPosition } from '../hooks/useDriverPosition';

function formatEta(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds <= 30) return 'Arriving now';
  const mins = Math.ceil(seconds / 60);
  return `${mins} min`;
}

export default function Home(): JSX.Element {
  const { data: guest, isLoading: guestLoading, error: guestError, refetch: refetchGuest } = useGuestMe();
  const { data: tripResp, isLoading: tripLoading, error: tripError, refetch: refetchTrip } = useTripCurrent();
  const queryClient = useQueryClient();
  const activeRequestId = useActiveRequestStore((s) => s.requestId);

  useAssignedNotificationPrompt(guest?.status);

  const invalidateTrip = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: guestKeys.tripCurrent });
    queryClient.invalidateQueries({ queryKey: guestKeys.me });
  }, [queryClient]);

  useSocketEvent('trip:assigned', invalidateTrip);
  useSocketEvent('trip:status', invalidateTrip);
  useSocketEvent('trip:eta', useCallback(() => queryClient.invalidateQueries({ queryKey: guestKeys.tripCurrent }), [queryClient]));
  useSocketEvent(
    'request:status',
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: guestKeys.me });
      queryClient.invalidateQueries({ queryKey: guestKeys.tripCurrent });
    }, [queryClient])
  );

  const trip = tripResp?.trip ?? null;
  useTripSubscription(trip?.id ?? null);

  const driverRestPos = trip?.driverId?.currentLocation ? toLatLng(trip.driverId.currentLocation) : null;
  const livePos = useDriverPosition(
    trip?.id ?? null,
    driverRestPos ? { ...driverRestPos, heading: trip?.driverId?.heading } : null
  );

  if (guestLoading || tripLoading) {
    return (
      <div className="space-y-4 p-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (guestError) {
    return (
      <div className="p-4">
        <ErrorState error={guestError} onRetry={() => refetchGuest()} />
      </div>
    );
  }

  if (!guest) return <div className="p-4" />;

  return (
    <div className="space-y-4 p-4 pb-6">
      <div>
        <p className="text-sm text-gray-500">Welcome back,</p>
        <h1 className="text-xl font-bold text-gray-900">{guest.name}</h1>
      </div>

      <InstallPrompt />

      {(guest.status === 'registered' || guest.status === 'awaiting_pickup') && (
        <RegisteredCard guest={guest} hasActiveRequest={!!activeRequestId} />
      )}

      {guest.status === 'queued' && <QueuedCard waitingSince={guest.waitingSince ?? null} hasActiveRequest={!!activeRequestId} />}

      {guest.status === 'assigned' && trip && <AssignedCard trip={trip} guestId={guest.id} coPassengers={tripResp?.coPassengers ?? []} />}

      {guest.status === 'in_transit' && trip && (
        <InTransitCard trip={trip} guestId={guest.id} livePos={livePos} />
      )}

      {guest.status === 'completed' && (
        <Card className="text-center">
          <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-500" />
          <p className="font-semibold text-gray-800">Your last ride is complete</p>
          <p className="mt-1 text-sm text-gray-500">We hope you had a smooth trip.</p>
          <Link to="/trips">
            <Button variant="secondary" className="mt-3">
              View trip history
            </Button>
          </Link>
        </Card>
      )}

      {guest.status === 'no_show' && (
        <Card className="text-center">
          <p className="font-semibold text-gray-800">Marked as no-show for your last pickup</p>
          <p className="mt-1 text-sm text-gray-500">If this is a mistake, contact the event help desk.</p>
        </Card>
      )}

      {tripError && guest.status !== 'registered' && guest.status !== 'awaiting_pickup' && (
        <ErrorState error={tripError} onRetry={() => refetchTrip()} />
      )}
    </div>
  );
}

function ArrivalIcon({ mode }: { mode?: string }): JSX.Element {
  if (mode === 'flight') return <Plane className="h-5 w-5" />;
  if (mode === 'train') return <Train className="h-5 w-5" />;
  return <Car className="h-5 w-5" />;
}

function RegisteredCard({ guest, hasActiveRequest }: { guest: GuestMe; hasActiveRequest: boolean }): JSX.Element {
  const arrival = guest.arrival;
  return (
    <Card>
      <div className="flex items-center gap-2 text-brand-600">
        <ArrivalIcon mode={arrival?.mode} />
        <span className="text-sm font-semibold uppercase tracking-wide">Your arrival</span>
      </div>

      {arrival?.scheduledAt ? (
        <>
          <p className="mt-2 text-2xl font-bold text-gray-900">{format(new Date(arrival.scheduledAt), 'd MMM, HH:mm')}</p>
          <p className="text-sm text-gray-500">
            {arrival.identifier ? `${arrival.identifier} · ` : ''}
            {arrival.pickupLocationId?.name ?? 'Pickup point to be confirmed'}
            {arrival.terminal && !arrival.pickupLocationId?.name?.includes(arrival.terminal) ? ` (${arrival.terminal})` : ''}
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-500">Your arrival details will appear here once confirmed.</p>
      )}

      {guest.accommodationId && (
        <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">Staying at {guest.accommodationId.name}</div>
      )}

      <p className="mt-4 rounded-xl bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">
        We'll assign a car automatically for your pickup — no need to book.
      </p>

      {!hasActiveRequest && (
        <Link to="/request">
          <Button variant="secondary" fullWidth className="mt-3">
            Need a ride now?
          </Button>
        </Link>
      )}
      {hasActiveRequest && (
        <Link to="/request">
          <Button variant="secondary" fullWidth className="mt-3">
            View your request
          </Button>
        </Link>
      )}
    </Card>
  );
}

function QueuedCard({ waitingSince, hasActiveRequest }: { waitingSince: string | null; hasActiveRequest: boolean }): JSX.Element {
  const elapsed = useElapsedSeconds(waitingSince);
  return (
    <Card className="text-center">
      <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
      <p className="text-lg font-bold text-gray-900">Finding your driver…</p>
      <p className="mt-1 text-sm text-gray-500">
        {elapsed !== null ? `Waiting ${formatWait(elapsed)}` : 'A car is being assigned automatically'}
      </p>
      <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
        Your driver is assigned automatically for the fastest pickup.
      </p>
      {hasActiveRequest && (
        <Link to="/request">
          <Button variant="secondary" className="mt-3">
            View request status
          </Button>
        </Link>
      )}
    </Card>
  );
}

function AssignedCard({
  trip,
  guestId,
  coPassengers
}: {
  trip: TripView;
  guestId: string;
  coPassengers: Array<{ name: string }>;
}): JSX.Element {
  const stop = nextStopForGuest(trip, guestId);
  const etaSeconds = useCountdownSeconds(stop?.etaAt ?? null);
  const vehicleNumber = trip.vehicleSnapshot?.number || trip.driverId?.vehicle?.number || '—';
  const driverName = trip.driverId?.name ?? 'Your driver';
  const driverPhone = trip.driverId?.phone;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Badge tone="brand">Your ride</Badge>
        {trip.groupSplitId && <Badge tone="warning">Convoy</Badge>}
      </div>

      <div className="mt-3 rounded-2xl bg-gray-900 px-4 py-5 text-center text-white">
        <p className="text-xs uppercase tracking-widest text-gray-300">Vehicle number</p>
        <p className="mt-1 text-4xl font-extrabold tracking-wider">{vehicleNumber}</p>
        <p className="mt-1 text-sm text-gray-300">{driverName}</p>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
        <div className="flex items-center gap-2 text-brand-700">
          <Clock className="h-5 w-5" />
          <span className="text-sm font-medium">ETA to pickup</span>
        </div>
        <span className="text-lg font-bold text-brand-800">{formatEta(etaSeconds)}</span>
      </div>

      {coPassengers.length > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
          <Users className="h-4 w-4" />
          You're sharing this ride with {coPassengers.length} other guest{coPassengers.length > 1 ? 's' : ''}.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        {driverPhone ? (
          <a href={`tel:${driverPhone}`}>
            <Button variant="secondary" fullWidth>
              <Phone className="mr-1.5 inline h-4 w-4" /> Call driver
            </Button>
          </a>
        ) : (
          <Button variant="secondary" fullWidth disabled>
            <Phone className="mr-1.5 inline h-4 w-4" /> Call driver
          </Button>
        )}
        <Link to="/track">
          <Button fullWidth>Track live</Button>
        </Link>
      </div>
    </Card>
  );
}

function InTransitCard({
  trip,
  guestId,
  livePos
}: {
  trip: TripView;
  guestId: string;
  livePos: LiveDriverPosition | null;
}): JSX.Element {
  const dropStop = dropStopForGuest(trip, guestId);
  const etaSeconds = useCountdownSeconds(dropStop?.etaAt ?? null);
  const pickup = geoPointToLeaflet(nextStopForGuest(trip, guestId)?.coordinates);
  const drop = geoPointToLeaflet(dropStop?.coordinates);

  return (
    <Card className="overflow-hidden !p-0">
      <div className="relative h-56 w-full">
        <LiveMap
          mapId="home-in-transit-map"
          className="h-full w-full"
          driverPosition={livePos}
          pickup={pickup ? { lat: pickup[0], lng: pickup[1] } : null}
          drop={drop ? { lat: drop[0], lng: drop[1] } : null}
          polyline={[]}
        />
        <Link to="/track" className="absolute right-3 top-3 z-[1000] flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md">
          <Maximize2 className="h-4 w-4 text-gray-700" />
        </Link>
      </div>
      <div className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm font-medium text-gray-500">Drop-off ETA</p>
          <p className="text-2xl font-bold text-gray-900">{formatEta(etaSeconds)}</p>
        </div>
        <div className="flex items-center gap-1 text-emerald-600">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">On the way</span>
        </div>
      </div>
    </Card>
  );
}
