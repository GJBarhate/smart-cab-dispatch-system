import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CarFront, MapPin, Minus, Plus, Send } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ListSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { RequestStepper } from '../components/RequestStepper';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useGuestLocations, useGuestMe, usePendingRequest, useTripCurrent, guestKeys } from '../hooks/useGuestQueries';
import { useActiveRequestStore } from '../store/activeRequestStore';
import { useSocketEvent } from '../hooks/useSocket';
import { guestApi } from '../api/guest';
import { ApiError } from '../api/client';
import { isTripActive, TRIP_STATUS_LABEL } from '../utils/labels';
const LOCATION_TYPE_LABEL = {
  airport: 'Airports',
  railway_station: 'Railway stations',
  venue: 'Venue',
  accommodation: 'Accommodations',
  custom: 'Other'
};
function groupByType(locations) {
  const groups = new Map();
  for (const loc of locations) {
    const list = groups.get(loc.type) ?? [];
    list.push(loc);
    groups.set(loc.type, list);
  }
  return Array.from(groups.entries());
}
function Stepper({
  value,
  onChange,
  min,
  max,
  label
}) {
  return <div className="flex items-center justify-between rounded-xl bg-elevated px-4 py-3">
      <span className="text-sm font-medium text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Decrease ${label.toLowerCase()}`} className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted shadow active:bg-elevated disabled:opacity-40">
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-6 text-center text-lg font-bold text-ink">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`Increase ${label.toLowerCase()}`} className="flex h-12 w-12 items-center justify-center rounded-full bg-surface text-muted shadow active:bg-elevated disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>;
}
export default function Request() {
  const activeRequestId = useActiveRequestStore(s => s.requestId);
  const setActiveRequestId = useActiveRequestStore(s => s.setRequestId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pendingQuery = usePendingRequest(activeRequestId);
  const {
    data: guest
  } = useGuestMe();
  const {
    data: tripResp
  } = useTripCurrent();
  useSocketEvent('request:status', useCallback(() => {
    if (activeRequestId) queryClient.invalidateQueries({
      queryKey: guestKeys.request(activeRequestId)
    });
    queryClient.invalidateQueries({
      queryKey: guestKeys.me
    });
    queryClient.invalidateQueries({
      queryKey: guestKeys.tripCurrent
    });
  }, [activeRequestId, queryClient]));
  useSocketEvent('trip:assigned', useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: guestKeys.tripCurrent
    });
    if (activeRequestId) queryClient.invalidateQueries({
      queryKey: guestKeys.request(activeRequestId)
    });
  }, [activeRequestId, queryClient]));
  useSocketEvent('trip:status', useCallback(() => queryClient.invalidateQueries({
    queryKey: guestKeys.tripCurrent
  }), [queryClient]));
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelTripOpen, setCancelTripOpen] = useState(false);
  const [cancellingTrip, setCancellingTrip] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  async function handleCancelTrip(tripId) {
    setCancellingTrip(true);
    setCancelError(null);
    try {
      await guestApi.cancelTrip(tripId);
      setActiveRequestId(null);
      setCancelTripOpen(false);
      queryClient.invalidateQueries({
        queryKey: guestKeys.tripCurrent
      });
      queryClient.invalidateQueries({
        queryKey: guestKeys.me
      });
    } catch (err) {
      // Most likely the driver picked them up while the dialog was open — the
      // message says so, and the refresh flips the screen to the boarded state.
      setCancelError(err instanceof ApiError ? err.message : 'Could not cancel your ride. Please try again.');
      setCancelTripOpen(false);
      queryClient.invalidateQueries({
        queryKey: guestKeys.tripCurrent
      });
    } finally {
      setCancellingTrip(false);
    }
  }
  async function handleCancel() {
    if (!activeRequestId) return;
    setCancelling(true);
    try {
      await guestApi.cancelRequest(activeRequestId);
      setActiveRequestId(null);
      queryClient.invalidateQueries({
        queryKey: guestKeys.me
      });
    } catch {
      // Leave the stepper visible; the guest can retry.
    } finally {
      setCancelling(false);
      setCancelConfirmOpen(false);
    }
  }

  // A terminal request (declined/expired) — clear the pointer after showing it briefly, then land on the form.
  useEffect(() => {
    if (pendingQuery.data && (pendingQuery.data.status === 'declined' || pendingQuery.data.status === 'expired')) {
      const t = setTimeout(() => setActiveRequestId(null), 4000);
      return () => clearTimeout(t);
    }
  }, [pendingQuery.data, setActiveRequestId]);

  // The stored id is a local convenience pointer, not a source of truth, and it
  // can outlive the request it names — the row was purged, or the database was
  // rebuilt while this browser kept the id. A 404 means exactly that, so drop
  // the pointer instead of leaving the tab stuck on "Request not found" with no
  // route back to the booking form.
  const requestMissing = pendingQuery.error instanceof ApiError && pendingQuery.error.status === 404;
  useEffect(() => {
    if (requestMissing) setActiveRequestId(null);
  }, [requestMissing, setActiveRequestId]);
  if (activeRequestId && pendingQuery.isLoading) {
    return <div className="p-4">
        <ListSkeleton rows={1} />
      </div>;
  }
  if (activeRequestId && pendingQuery.data) {
    return <div className="p-4 pb-6">
        <RequestStepper request={pendingQuery.data} trip={tripResp?.trip} onCancel={() => setCancelConfirmOpen(true)} cancelling={cancelling} />
        <ConfirmDialog open={cancelConfirmOpen} title="Cancel this request?" message="You'll lose your place and will need to submit a new request if you still need a ride." confirmLabel="Cancel request" danger loading={cancelling} onConfirm={handleCancel} onCancel={() => setCancelConfirmOpen(false)} />
      </div>;
  }
  // Only real failures get the error screen. A 404 is handled above by dropping
  // the stale pointer and falling through to the live ride or the form.
  if (activeRequestId && pendingQuery.error && !requestMissing) {
    return <div className="p-4">
        <ErrorState error={pendingQuery.error} onRetry={() => pendingQuery.refetch()} />
      </div>;
  }

  // A ride is already under way. The stepper above covers the case where this
  // guest raised the request on this device; this catches every other route to
  // the same state — the trip came from their scheduled arrival, or they signed
  // in on a different phone, so there is no local requestId to key off.
  //
  // Falling through to the form here is what made "Request" look broken: it
  // offered a booking the API refuses with a 409, so the only way to find out
  // was to fill it in and submit.
  if (isTripActive(tripResp?.trip)) {
    const trip = tripResp.trip;
    // Once boarded the guest is in the vehicle and the API refuses to cancel,
    // so the button is not offered — showing it would only produce a 409.
    const canCancel = trip.status !== 'boarded';
    return <div className="space-y-3 p-4">
        <EmptyState icon={CarFront} title="You already have a ride on the way" subtitle={`${TRIP_STATUS_LABEL[trip.status] ?? 'In progress'} · ${trip.code}`} action={<Button onClick={() => navigate('/track')}>Track my ride</Button>} />
        {cancelError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{cancelError}</p>}
        {canCancel && <Button variant="danger" fullWidth loading={cancellingTrip} onClick={() => setCancelTripOpen(true)}>
            Cancel this ride
          </Button>}
        <ConfirmDialog open={cancelTripOpen} title="Cancel this ride?" message="Your driver will be released to another guest. You'll need to request a new ride if you still need one." confirmLabel="Cancel ride" danger loading={cancellingTrip} onConfirm={() => handleCancelTrip(trip.id)} onCancel={() => setCancelTripOpen(false)} />
      </div>;
  }
  return <RequestForm guestGroupSize={guest?.groupSize ?? 1} guestLuggage={guest?.luggageCount ?? 1} accommodationId={guest?.accommodationId?.id} />;
}
function RequestForm({
  guestGroupSize,
  guestLuggage,
  accommodationId
}) {
  const {
    data: locations,
    isLoading,
    error,
    refetch
  } = useGuestLocations();
  const setActiveRequestId = useActiveRequestStore(s => s.setRequestId);
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [passengers, setPassengers] = useState(Math.max(1, guestGroupSize));
  const [luggage, setLuggage] = useState(Math.max(0, guestLuggage));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  useEffect(() => {
    if (!locations || fromId) return;
    const mine = accommodationId && locations.find(l => l.id === accommodationId);
    setFromId(mine ? mine.id : locations[0]?.id ?? '');
  }, [locations, accommodationId, fromId]);
  const grouped = useMemo(() => locations ? groupByType(locations) : [], [locations]);
  const fromLoc = locations?.find(l => l.id === fromId);
  const toLoc = locations?.find(l => l.id === toId);
  const canSubmit = !!fromLoc && !!toLoc && fromLoc.id !== toLoc.id && !submitting;
  async function handleSubmit(e) {
    e.preventDefault();
    if (!fromLoc || !toLoc) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const created = await guestApi.createRequest({
        pickupLocationId: fromLoc.id,
        pickupLabel: fromLoc.name,
        dropoffLocationId: toLoc.id,
        dropoffLabel: toLoc.name,
        passengerCount: passengers,
        luggageCount: luggage,
        reason: reason.trim()
      });
      setActiveRequestId(created.id);
      queryClient.invalidateQueries({
        queryKey: guestKeys.me
      });
    } catch (err) {
      // Use the server's wording rather than assuming the reason: a 409 here
      // means either a request already pending approval or a ride already under
      // way, and hardcoding the former told a guest mid-trip the wrong thing.
      setFormError(err instanceof ApiError ? err.message : 'Could not send your request. Please try again.');
      if (err instanceof ApiError && err.status === 409) {
        // Refresh so the screen can switch to the live-ride state instead of
        // sitting on a form the API will keep refusing.
        queryClient.invalidateQueries({
          queryKey: guestKeys.tripCurrent
        });
        queryClient.invalidateQueries({
          queryKey: guestKeys.me
        });
      }
    } finally {
      setSubmitting(false);
    }
  }
  if (isLoading) {
    return <div className="p-4">
        <ListSkeleton rows={2} />
      </div>;
  }
  if (error) {
    return <div className="p-4">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>;
  }
  if (!locations || locations.length === 0) {
    return <div className="p-4">
        <EmptyState icon={MapPin} title="No locations available yet" subtitle="Check back shortly, or contact the event help desk." />
      </div>;
  }
  return <form onSubmit={handleSubmit} className="space-y-4 p-4 pb-6">
      <div>
        <h1 className="text-xl font-bold text-ink">Request a ride</h1>
        <p className="mt-1 text-sm text-muted">Your driver is assigned automatically for the fastest pickup.</p>
      </div>

      <Card className="space-y-3">
        <div>
          <label htmlFor="pickup-location" className="mb-1 block text-sm font-medium text-muted">From</label>
          <select id="pickup-location" value={fromId} onChange={e => setFromId(e.target.value)} className="min-h-[48px] w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
            {grouped.map(([type, locs]) => <optgroup key={type} label={LOCATION_TYPE_LABEL[type] ?? type}>
                {locs.map(l => <option key={l.id} value={l.id}>
                    {l.name}
                  </option>)}
              </optgroup>)}
          </select>
        </div>

        <div>
          <label htmlFor="dropoff-location" className="mb-1 block text-sm font-medium text-muted">To</label>
          <select id="dropoff-location" value={toId} onChange={e => setToId(e.target.value)} className="min-h-[48px] w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
            <option value="" disabled>
              Select a destination
            </option>
            {grouped.map(([type, locs]) => <optgroup key={type} label={LOCATION_TYPE_LABEL[type] ?? type}>
                {locs.map(l => <option key={l.id} value={l.id} disabled={l.id === fromId}>
                    {l.name}
                  </option>)}
              </optgroup>)}
          </select>
        </div>
      </Card>

      <Card className="space-y-3">
        <Stepper label="Passengers" value={passengers} onChange={setPassengers} min={1} max={8} />
        <Stepper label="Luggage" value={luggage} onChange={setLuggage} min={0} max={12} />
      </Card>

      <Card>
        <label htmlFor="ride-reason" className="mb-1 block text-sm font-medium text-muted">Reason (optional)</label>
        <input id="ride-reason" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Heading to the keynote session" className="min-h-[48px] w-full rounded-xl border border-line bg-surface px-3 text-base text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" maxLength={140} />
      </Card>

      {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}

      <Button type="submit" fullWidth loading={submitting} disabled={!canSubmit}>
        <Send className="mr-1.5 inline h-4 w-4" />
        Request ride
      </Button>
    </form>;
}
