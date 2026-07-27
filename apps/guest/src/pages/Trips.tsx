import React, { useState } from 'react';
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
import { TRIP_TYPE_LABEL, tripStatusTone } from '../utils/labels';
import type { TripView } from '../types/domain';

export default function Trips(): JSX.Element {
  const { data: trips, isLoading, error, refetch } = useTripHistory();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3 p-4 pb-6">
      <h1 className="text-xl font-bold text-gray-900">My rides</h1>

      {isLoading && <ListSkeleton rows={3} />}

      {error && <ErrorState error={error} onRetry={() => refetch()} />}

      {!isLoading && !error && (!trips || trips.length === 0) && (
        <EmptyState icon={History} title="No rides yet" subtitle="Your completed and past rides will show up here." />
      )}

      {trips?.map((trip) => (
        <TripRow key={trip.id} trip={trip} expanded={expandedId === trip.id} onToggle={() => setExpandedId(expandedId === trip.id ? null : trip.id)} />
      ))}
    </div>
  );
}

function TripRow({ trip, expanded, onToggle }: { trip: TripView; expanded: boolean; onToggle: () => void }): JSX.Element {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const already = (trip.timeline ?? []).some((t) => t.type === 'rated');

  return (
    <Card className="!p-0">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">{TRIP_TYPE_LABEL[trip.type] ?? trip.type}</span>
            <Badge tone={tripStatusTone(trip.status)}>{trip.status}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-gray-500">
            {first?.label ?? 'Pickup'} → {last?.label ?? 'Drop'}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">{trip.createdAt ? format(new Date(trip.createdAt), 'd MMM, HH:mm') : ''}</p>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 flex-shrink-0 text-gray-400" /> : <ChevronDown className="h-5 w-5 flex-shrink-0 text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-4">
          <ol className="space-y-2">
            {trip.stops.map((stop) => (
              <li key={stop.seq} className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 rounded-full ${stop.status === 'done' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <span className="text-gray-500">{stop.kind === 'pickup' ? 'Pickup' : 'Drop'}</span>
                <span className="font-medium text-gray-800">{stop.label}</span>
              </li>
            ))}
          </ol>

          {trip.vehicleSnapshot?.number && (
            <p className="mt-3 text-sm text-gray-500">
              Vehicle: <span className="font-medium text-gray-800">{trip.vehicleSnapshot.number}</span>
            </p>
          )}

          {trip.status === 'completed' && !already && <RateTrip tripId={trip.id} />}
          {trip.status === 'completed' && already && <p className="mt-3 text-sm text-emerald-600">Thanks for rating this ride.</p>}
        </div>
      )}
    </Card>
  );
}

function RateTrip({ tripId }: { tripId: string }): JSX.Element {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  async function submit() {
    if (rating < 1) return;
    setSubmitting(true);
    setError(null);
    try {
      await guestApi.rateTrip(tripId, rating, comment.trim() || undefined);
      setDone(true);
      queryClient.invalidateQueries({ queryKey: guestKeys.tripHistory });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your rating.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <p className="mt-3 text-sm text-emerald-600">Thanks for rating this ride!</p>;

  return (
    <div className="mt-3 rounded-xl bg-gray-50 p-3">
      <p className="mb-2 text-sm font-medium text-gray-700">Rate this ride</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star`}>
            <Star className={`h-7 w-7 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Anything you'd like to add? (optional)"
        className="mt-2 min-h-[64px] w-full rounded-lg border border-gray-200 bg-white p-2 text-sm"
        maxLength={280}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <Button className="mt-2 min-h-[40px] px-4 py-1 text-sm" onClick={submit} disabled={rating < 1} loading={submitting}>
        Submit rating
      </Button>
    </div>
  );
}
