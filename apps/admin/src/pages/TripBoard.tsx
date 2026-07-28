import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users2, Repeat, XCircle, Kanban, HelpCircle } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { useSocketEvent } from '../hooks/useSocket';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { ExplainAssignment } from '../components/ai/ExplainAssignment';
import { fmtRelative } from '../lib/format';
import type { Trip, TripStatus } from '../types/models';

const LANES: Array<{ key: string; label: string; statuses: TripStatus[]; tone: 'gray' | 'blue' | 'amber' | 'purple' | 'green' | 'red' }> = [
  { key: 'offered', label: 'Offered', statuses: ['pending_driver'], tone: 'gray' },
  { key: 'enroute', label: 'En route', statuses: ['accepted', 'en_route_pickup'], tone: 'blue' },
  { key: 'atpickup', label: 'At pickup', statuses: ['at_pickup'], tone: 'amber' },
  { key: 'intransit', label: 'In transit', statuses: ['boarded'], tone: 'purple' },
  { key: 'completed', label: 'Completed', statuses: ['completed'], tone: 'green' },
  { key: 'issues', label: 'Cancelled / Rejected / Unassignable', statuses: ['cancelled', 'rejected', 'unassignable'], tone: 'red' }
];

function TripCard({
  trip,
  onReassign,
  onCancel,
  onExplain
}: {
  trip: Trip;
  onReassign: (t: Trip) => void;
  onCancel: (t: Trip) => void;
  onExplain: (t: Trip) => void;
}) {
  const canAct = !['completed', 'cancelled', 'rejected'].includes(trip.status);
  // Explaining needs a recorded decision, which cancelled/rejected trips that
  // never reached a driver don't have.
  const canExplain = !!trip.driverId;
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">{trip.code}</span>
        {trip.groupSplitId && <Badge tone="purple"><Repeat size={10} className="mr-1 inline" />Convoy</Badge>}
      </div>
      <p className="mb-1 flex items-center gap-1 text-xs text-muted">
        <Users2 size={12} /> {trip.guests.length} guest{trip.guests.length !== 1 ? 's' : ''} · {trip.vehicleSnapshot?.number ?? 'unassigned vehicle'}
      </p>
      <p className="truncate text-xs text-faint">{trip.stops[0]?.label} → {trip.stops[trip.stops.length - 1]?.label}</p>
      <p className="mt-1 text-[10px] text-faint">{fmtRelative(trip.createdAt)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canAct && <Button size="sm" variant="secondary" onClick={() => onReassign(trip)}>Reassign</Button>}
        {canExplain && (
          <Button size="sm" variant="ghost" title="Why this driver?" onClick={() => onExplain(trip)}>
            <HelpCircle size={12} className="mr-1" />Why?
          </Button>
        )}
        {canAct && <Button size="sm" variant="ghost" aria-label="Cancel trip" onClick={() => onCancel(trip)}><XCircle size={12} /></Button>}
      </div>
    </div>
  );
}

export default function TripBoard() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [reassignTarget, setReassignTarget] = useState<Trip | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Trip | null>(null);
  const [explainTarget, setExplainTarget] = useState<Trip | null>(null);
  const [chosenDriverId, setChosenDriverId] = useState('');

  const tripsQ = useQuery({ queryKey: ['trips'], queryFn: () => AdminApi.trips(), refetchInterval: 15_000 });
  const driversQ = useQuery({ queryKey: ['drivers'], queryFn: () => AdminApi.drivers(), enabled: !!reassignTarget });

  useSocketEvent('trip:status', () => qc.invalidateQueries({ queryKey: ['trips'] }));

  const reassignMutation = useMutation({
    mutationFn: ({ id, driverId }: { id: string; driverId: string }) => AdminApi.reassignTrip(id, driverId),
    onSuccess: () => {
      push({ kind: 'success', title: 'Trip reassigned', description: 'Both the new driver and guests were notified.' });
      setReassignTarget(null);
      setChosenDriverId('');
      qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Reassign failed', description: e.message })
  });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => AdminApi.cancelTrip(id, reason),
    onSuccess: () => {
      push({ kind: 'info', title: 'Trip cancelled', description: 'Guests were re-queued automatically.' });
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Cancel failed', description: e.message })
  });

  const lanes = useMemo(() => {
    const trips = tripsQ.data ?? [];
    return LANES.map((lane) => ({ ...lane, trips: trips.filter((t) => lane.statuses.includes(t.status)) }));
  }, [tripsQ.data]);

  const availableDrivers = (driversQ.data ?? []).filter((d) => d.status === 'idle' || d.id === reassignTarget?.driverId);

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-lg font-semibold text-ink">Trip Board</h1>
      <p className="mb-4 text-sm text-muted">Kanban by status. Convoy badges mark sibling trips of a split group.</p>

      {tripsQ.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : tripsQ.isError ? (
        <ErrorState message={(tripsQ.error as any)?.message} onRetry={() => tripsQ.refetch()} />
      ) : (tripsQ.data?.length ?? 0) === 0 ? (
        <EmptyState icon={Kanban} title="No trips yet" description="Trips created by the dispatch engine or manual overrides will show up here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          {lanes.map((lane) => (
            <div key={lane.key} className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <Badge tone={lane.tone}>{lane.label}</Badge>
                <span className="text-xs text-faint">{lane.trips.length}</span>
              </div>
              <div className="space-y-2">
                {lane.trips.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line p-3 text-center text-[11px] text-faint">Empty</p>
                ) : (
                  lane.trips.map((t) => (
                    <TripCard key={t.id} trip={t} onReassign={setReassignTarget} onCancel={setCancelTarget} onExplain={setExplainTarget} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!reassignTarget}
        onClose={() => { setReassignTarget(null); setChosenDriverId(''); }}
        title={`Reassign ${reassignTarget?.code ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReassignTarget(null)}>Cancel</Button>
            <Button
              disabled={!chosenDriverId}
              loading={reassignMutation.isPending}
              onClick={() => reassignTarget && reassignMutation.mutate({ id: reassignTarget.id, driverId: chosenDriverId })}
            >
              Confirm reassignment
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted">This is a manual override — it bypasses the dispatch engine and is audited.</p>
        {driversQ.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : availableDrivers.length === 0 ? (
          <EmptyState title="No idle drivers available" />
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {availableDrivers.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded-md border border-line-soft p-2 text-sm">
                <input type="radio" name="driver" checked={chosenDriverId === d.id} onChange={() => setChosenDriverId(d.id)} />
                {d.name} · {d.vehicle.number} ({d.capacity.seats} seats)
              </label>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={`Cancel ${cancelTarget?.code ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button
              variant="danger"
              loading={cancelMutation.isPending}
              onClick={() => cancelTarget && cancelMutation.mutate({ id: cancelTarget.id, reason: 'Cancelled by admin' })}
            >
              Confirm cancel
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Guests on this trip will be re-queued automatically and the driver freed up.</p>
      </Modal>

      <ExplainAssignment
        tripId={explainTarget?.id ?? null}
        tripCode={explainTarget?.code}
        onClose={() => setExplainTarget(null)}
      />
    </div>
  );
}
