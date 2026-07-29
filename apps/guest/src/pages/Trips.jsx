import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, ChevronUp, History, Star } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ListSkeleton } from '../components/ui/Skeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';
import { useTripHistory, guestKeys } from '../hooks/useGuestQueries';
import { guestApi } from '../api/guest';
import { ApiError } from '../api/client';
import { TRIP_TYPE_LABEL, TRIP_STATUS_LABEL, tripStatusTone } from '../utils/labels';
export default function Trips() {
  const {
    data: trips,
    isLoading,
    error,
    refetch
  } = useTripHistory();
  const [expandedId, setExpandedId] = useState(null);
  return <div className="er-stagger space-y-4 p-4 pb-6">
      <h1 className="text-xl font-bold tracking-tight text-ink">My rides</h1>

      {isLoading && <ListSkeleton rows={3} />}

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {!isLoading && !error && (!trips || trips.length === 0) && <EmptyState icon={History} title="No rides yet" subtitle="Your completed and past rides will show up here." />}

      {trips?.map(trip => <TripRow key={trip.id} trip={trip} expanded={expandedId === trip.id} onToggle={() => setExpandedId(expandedId === trip.id ? null : trip.id)} />)}
    </div>;
}
function TripRow({
  trip,
  expanded,
  onToggle
}) {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const already = (trip.timeline ?? []).some(t => t.type === 'rated');
  return <Card className="!p-0">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left active:bg-elevated">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{TRIP_TYPE_LABEL[trip.type] ?? trip.type}</span>
            <Badge tone={tripStatusTone(trip.status)}>{TRIP_STATUS_LABEL[trip.status] ?? trip.status}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted">
            {first?.label ?? 'Pickup'} → {last?.label ?? 'Drop'}
          </p>
          <p className="mt-0.5 text-xs text-faint">{trip.createdAt ? format(new Date(trip.createdAt), 'd MMM, HH:mm') : ''}</p>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 flex-shrink-0 text-faint" /> : <ChevronDown className="h-5 w-5 flex-shrink-0 text-faint" />}
      </button>

      {expanded && <div className="border-t border-line-soft p-4">
          <ol className="space-y-2">
            {trip.stops.map(stop => <li key={stop.seq} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${stop.status === 'done' ? 'bg-emerald-500' : 'bg-line'}`} />
                <span className="text-muted">{stop.kind === 'pickup' ? 'Pickup' : 'Drop'}</span>
                <span className="font-medium text-ink">{stop.label}</span>
              </li>)}
          </ol>

          {trip.vehicleSnapshot?.number && <p className="mt-3 text-sm text-muted">
              Vehicle: <span className="font-medium text-ink">{trip.vehicleSnapshot.number}</span>
            </p>}

          {trip.status === 'completed' && !already && <RateTrip tripId={trip.id} />}
          {trip.status === 'completed' && already && <p className="mt-3 text-sm text-emerald-600">Thanks for rating this ride.</p>}
        </div>}
    </Card>;
}
function RateTrip({
  tripId
}) {
  // One rating card renders per trip, so the ids have to be per-instance —
  // a hard-coded id would make every textarea on the page share a label.
  const commentId = useId();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();
  async function submit() {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await guestApi.rateTrip(tripId, rating, comment.trim() || undefined);
      setDone(true);
      queryClient.invalidateQueries({
        queryKey: guestKeys.tripHistory
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your rating.');
    } finally {
      setSubmitting(false);
    }
  }
  if (done) return <p className="mt-3 text-sm text-emerald-600">Thanks for rating this ride!</p>;
  return <div className="mt-3 rounded-xl bg-elevated p-3">
      {/* radiogroup, not a bare row of buttons: it tells a screen reader these
          five controls are one choice, and `aria-checked` reports which. */}
      <p className="mb-2 text-sm font-medium text-muted" id={`${commentId}-heading`}>
        Rate this ride
      </p>
      <div className="flex gap-1" role="radiogroup" aria-labelledby={`${commentId}-heading`}>
        {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={rating === n} onClick={() => setRating(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="active:scale-90 transition-transform">
            <Star className={`h-7 w-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-faint'}`} />
          </button>)}
      </div>
      {/* A placeholder is not a label: it vanishes as soon as typing starts and
          is not reliably announced. The visible label is hidden rather than
          dropped so the field still has a name. */}
      <label htmlFor={commentId} className="sr-only">
        Add a comment about this ride (optional)
      </label>
      <textarea id={commentId} value={comment} onChange={e => setComment(e.target.value)} placeholder="Anything you'd like to add? (optional)" className="mt-2 min-h-[64px] w-full rounded-xl border border-line bg-surface p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" maxLength={280} />
      {error && <p className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      <Button className="mt-2 min-h-[36px] px-4 py-1 text-sm" onClick={submit} disabled={rating < 1} loading={submitting}>
        Submit rating
      </Button>
    </div>;
}
