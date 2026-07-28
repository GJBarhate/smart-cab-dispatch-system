import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MapPin, Coffee, Navigation2, CheckCircle2, Users, PackageCheck, XCircle, WifiOff, LocateFixed } from 'lucide-react';
import { DriverApi, AuthApi } from '../../api/endpoints';
import { ApiError } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useSocket, useSocketEvent } from '../../hooks/useSocket';
import { useDriverGeolocation } from '../../hooks/useDriverGeolocation';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Toggle } from '../../components/ui/Toggle';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../components/ui/Toast';
import { TripMap } from '../../components/map/TripMap';
import { toLeafletTuple, isZeroPoint } from '../../lib/geo';
import type { Trip } from '../../types/models';

const OFFER_TIMEOUT_SEC_DEFAULT = 60; // server default (EventConfig.dispatch.offerTimeoutSec) — not exposed to the driver role, so this mirrors the seeded default.
const REJECT_REASONS = ['Vehicle issue', 'Too far', 'Personal emergency', 'Other'];

async function fetchCurrentTripOrNull(): Promise<Trip | null> {
  try {
    return await DriverApi.currentTrip();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export default function DriverHome() {
  const qc = useQueryClient();
  const { push } = useToast();
  const clear = useAuthStore((s) => s.clear);
  const { socket } = useSocket();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(REJECT_REASONS[0]);
  const [now, setNow] = useState(Date.now());
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const meQ = useQuery({ queryKey: ['driver', 'me'], queryFn: DriverApi.me, refetchInterval: 30_000 });
  const summaryQ = useQuery({ queryKey: ['driver', 'summary'], queryFn: DriverApi.summary, refetchInterval: 30_000 });
  const tripQ = useQuery({ queryKey: ['driver', 'currentTrip'], queryFn: fetchCurrentTripOrNull, refetchInterval: 10_000 });

  const trip = tripQ.data ?? null;
  const isOnline = meQ.data?.status !== 'offline';

  const geo = useDriverGeolocation(isOnline);

  // Join the trip room the moment we know the trip id, so trip:status/trip:eta land.
  useEffect(() => {
    if (socket && trip?.id) socket.emit('trip:subscribe', { tripId: trip.id });
  }, [socket, trip?.id]);

  useSocketEvent('trip:offered', () => qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] }));
  useSocketEvent('trip:status', () => {
    qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] });
    qc.invalidateQueries({ queryKey: ['driver', 'summary'] });
  });

  // Offer countdown ticker.
  useEffect(() => {
    if (trip?.status !== 'pending_driver') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [trip?.status]);

  const secondsLeft = useMemo(() => {
    if (!trip?.createdAt) return OFFER_TIMEOUT_SEC_DEFAULT;
    const offeredAt = new Date(trip.createdAt).getTime();
    return Math.max(0, OFFER_TIMEOUT_SEC_DEFAULT - Math.floor((now - offeredAt) / 1000));
  }, [trip?.createdAt, now]);

  const statusMutation = useMutation({
    mutationFn: (action: 'online' | 'offline' | 'request_break') => DriverApi.setStatus(action),
    onSuccess: (_d, action) => {
      qc.invalidateQueries({ queryKey: ['driver', 'me'] });
      if (action === 'request_break') push({ kind: 'success', title: 'Break started', description: '20 minutes off the clock.' });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Could not update status', description: e.message })
  });

  const acceptMutation = useMutation({
    mutationFn: () => DriverApi.accept(trip!.id),
    onSuccess: () => {
      push({ kind: 'success', title: 'Trip accepted', description: "You're en route to pickup." });
      qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Accept failed', description: e.message })
  });

  const rejectMutation = useMutation({
    mutationFn: () => DriverApi.reject(trip!.id, rejectReason),
    onSuccess: () => {
      setRejectOpen(false);
      push({ kind: 'info', title: 'Trip declined', description: 'It has been re-queued for another driver.' });
      qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Reject failed', description: e.message })
  });

  const arrivedMutation = useMutation({
    mutationFn: () => DriverApi.arrived(trip!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] }),
    onError: (e: any) => push({ kind: 'error', title: 'Could not update', description: e.message })
  });

  const boardMutation = useMutation({
    mutationFn: () => DriverApi.board(trip!.id, trip!.guests.map((g) => g.guestId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] }),
    onError: (e: any) => push({ kind: 'error', title: 'Could not board guests', description: e.message })
  });

  const nextDropStop = trip?.stops.find((s) => s.kind === 'drop' && s.status !== 'done') ?? null;

  const dropMutation = useMutation({
    mutationFn: () => DriverApi.drop(trip!.id, nextDropStop!.guestIds, nextDropStop!.seq),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['driver', 'currentTrip'] });
      if (updated.status === 'completed') push({ kind: 'success', title: 'Trip completed', description: 'Great work — waiting for your next assignment.' });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Could not complete drop', description: e.message })
  });

  async function handleLogout() {
    setLoggingOut(true);
    try { await AuthApi.logout(); } catch { /* client discard proceeds regardless */ }
    clear();
  }

  if (meQ.isLoading) {
    return (
      <div className="flex min-h-screen flex-col gap-4 bg-canvas p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const driver = meQ.data;
  const driverPos = geo.position ?? (driver && !isZeroPoint(driver.currentLocation) ? toLeafletTuple(driver.currentLocation) : null);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header — deliberately different accent from the admin (ops-purple) theme */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-emerald-100 bg-surface px-4 py-3 shadow-sm">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">Hi {driver?.name?.split(' ')[0]} · {driver?.vehicle.number}</p>
          <p className="flex items-center gap-1 text-xs text-muted">
            <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-line'}`} />
            {isOnline ? 'ONLINE' : 'OFFLINE'}
            {geo.permission === 'granted' && <span className="ml-1 flex items-center gap-0.5 text-emerald-600"><LocateFixed size={11} /> sharing location</span>}
            {geo.permission === 'denied' && <span className="ml-1 flex items-center gap-0.5 text-red-500"><WifiOff size={11} /> location blocked</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            checked={isOnline}
            disabled={!!trip && trip.status !== 'completed'}
            onChange={(v) => statusMutation.mutate(v ? 'online' : 'offline')}
            accent="emerald"
          />
          <ThemeToggle compact />
          <button onClick={() => setLogoutOpen(true)} className="rounded-md p-2 text-faint hover:bg-elevated hover:text-muted" aria-label="Log out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
        {tripQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !trip ? (
          <div className="rounded-2xl border border-dashed border-emerald-200 bg-surface p-8 text-center">
            <MapPin className="mx-auto mb-2 text-emerald-300" size={32} />
            <p className="font-medium text-muted">{isOnline ? 'Waiting for your next trip' : "You're offline"}</p>
            <p className="mt-1 text-sm text-muted">
              {isOnline ? 'The dispatch engine will offer you a trip automatically — nothing to do here.' : 'Go online to start receiving trip offers.'}
            </p>
          </div>
        ) : trip.status === 'pending_driver' ? (
          <OfferCard trip={trip} secondsLeft={secondsLeft} onAccept={() => acceptMutation.mutate()} onReject={() => setRejectOpen(true)} accepting={acceptMutation.isPending} />
        ) : (
          <>
            <div className="h-56 overflow-hidden rounded-2xl border border-emerald-100 shadow-sm">
              <TripMap driverPosition={driverPos} heading={geo.heading} stops={trip.stops} polyline={trip.route?.polyline} />
            </div>

            <TripStatusCard trip={trip} />

            {(trip.status === 'accepted' || trip.status === 'en_route_pickup') && (
              <Button size="lg" variant="success" className="w-full py-5 text-base" onClick={() => arrivedMutation.mutate()} loading={arrivedMutation.isPending}>
                <Navigation2 size={18} /> ARRIVED AT PICKUP
              </Button>
            )}
            {trip.status === 'at_pickup' && (
              <Button size="lg" variant="success" className="w-full py-5 text-base" onClick={() => boardMutation.mutate()} loading={boardMutation.isPending}>
                <Users size={18} /> BOARD GUESTS ({trip.guests.length})
              </Button>
            )}
            {trip.status === 'boarded' && nextDropStop && (
              <Button size="lg" variant="success" className="w-full py-5 text-base" onClick={() => dropMutation.mutate()} loading={dropMutation.isPending}>
                <PackageCheck size={18} /> DROP AT {nextDropStop.label || `STOP ${nextDropStop.seq}`}
              </Button>
            )}
            {['completed', 'cancelled', 'rejected', 'unassignable'].includes(trip.status) && (
              <div className="flex items-center gap-2 rounded-xl bg-surface p-4 text-sm text-muted shadow-sm">
                <CheckCircle2 size={18} className="text-emerald-500" /> Trip {trip.status} — waiting for your next assignment.
              </div>
            )}
          </>
        )}

        <div className="rounded-xl border border-line-soft bg-surface p-4 shadow-sm">
          <p className="text-sm text-muted">
            Trips today <span className="font-semibold text-ink">{summaryQ.data?.tripsToday ?? 0}</span>
            {' · '}
            {summaryQ.data?.onBreakUntil
              ? <span className="font-semibold text-amber-600">On break</span>
              : <span>Since last break: <span className="font-semibold text-ink">{summaryQ.data?.tripsSinceBreak ?? 0}</span> trips</span>}
          </p>
          {!trip && isOnline && !summaryQ.data?.onBreakUntil && (
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => statusMutation.mutate('request_break')} loading={statusMutation.isPending}>
              <Coffee size={12} /> Request break
            </Button>
          )}
        </div>
      </main>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Why are you declining?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>Back</Button>
            <Button variant="danger" loading={rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>
              <XCircle size={14} /> Confirm decline
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {REJECT_REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 rounded-md border border-line-soft p-3 text-sm">
              <input type="radio" name="reject-reason" checked={rejectReason === r} onChange={() => setRejectReason(r)} />
              {r}
            </label>
          ))}
        </div>
      </Modal>

      <ConfirmDialog
        open={logoutOpen}
        title="Log out?"
        message={trip && !['completed', 'cancelled', 'rejected', 'unassignable'].includes(trip.status)
          ? "You have an active trip in progress. Logging out won't cancel it, but you'll stop receiving updates until you sign back in."
          : "You'll need to sign in again to receive trip offers."}
        confirmLabel="Log out"
        danger
        loading={loggingOut}
        onConfirm={handleLogout}
        onCancel={() => setLogoutOpen(false)}
      />
    </div>
  );
}

function OfferCard({ trip, secondsLeft, onAccept, onReject, accepting }: { trip: Trip; secondsLeft: number; onAccept: () => void; onReject: () => void; accepting: boolean }) {
  const pickup = trip.stops.find((s) => s.kind === 'pickup');
  const drop = trip.stops[trip.stops.length - 1];
  const pct = Math.max(0, Math.min(100, (secondsLeft / OFFER_TIMEOUT_SEC_DEFAULT) * 100));
  const guestCount = trip.guests.length;
  const bagCount = trip.guests.reduce((s, g) => s + g.luggage, 0);

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-300 bg-surface p-5 shadow-md">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">New trip offer</p>
        <div className="relative flex h-11 w-11 items-center justify-center">
          <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
            <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(5,150,105,0.25)" strokeWidth="4" />
            <circle
              cx="20" cy="20" r="17" fill="none" stroke="#059669" strokeWidth="4"
              strokeDasharray={2 * Math.PI * 17}
              strokeDashoffset={2 * Math.PI * 17 * (1 - pct / 100)}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute text-xs font-bold text-emerald-700">{secondsLeft}</span>
        </div>
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Pickup</dt><dd className="font-medium text-ink">{pickup?.label ?? '—'}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Guests</dt><dd className="font-medium text-ink">{guestCount} ({bagCount} bags)</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Drop</dt><dd className="font-medium text-ink">{drop?.label ?? '—'}</dd></div>
      </dl>
      <div className="mt-4 flex gap-2">
        <Button size="lg" variant="success" className="flex-1 py-4 text-base" onClick={onAccept} loading={accepting}>ACCEPT</Button>
        <Button size="lg" variant="danger" className="flex-1 py-4 text-base" onClick={onReject}>REJECT</Button>
      </div>
    </div>
  );
}

function TripStatusCard({ trip }: { trip: Trip }) {
  const labels: Record<string, string> = {
    accepted: 'Heading to pickup', en_route_pickup: 'Heading to pickup', at_pickup: 'Arrived — board your guests',
    boarded: 'Guests aboard — heading to drop'
  };
  const guestCount = trip.guests.length;
  return (
    <div className="rounded-xl bg-surface p-4 shadow-sm">
      <p className="text-sm font-semibold text-ink">{labels[trip.status] ?? trip.status}</p>
      <p className="text-xs text-muted">{guestCount} guest{guestCount !== 1 ? 's' : ''} · {trip.vehicleSnapshot?.number}</p>
    </div>
  );
}
