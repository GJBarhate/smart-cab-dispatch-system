import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ThumbsUp, ThumbsDown, Inbox as InboxIcon, Car } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { Card, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { SkeletonRows } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { toLeafletTuple, haversineKm } from '../lib/geo';
import { fmtRelative, fmtTime } from '../lib/format';
import type { RideRequest } from '../types/models';

const NEARBY_RADIUS_KM = 12;
const AVG_SPEED_KMPH = 28; // rough estimate for the "feasibility preview" chip, matches haversine fallback assumptions

function FeasibilityChip({ request }: { request: RideRequest }) {
  const dashboardQ = useQuery({ queryKey: ['dashboard'], queryFn: AdminApi.dashboard, staleTime: 15_000 });

  const stats = useMemo(() => {
    const drivers = dashboardQ.data?.liveDrivers ?? [];
    const pickup = toLeafletTuple(request.pickup.coordinates);
    const idle = drivers.filter((d) => d.status === 'idle');
    const distances = idle
      .map((d) => haversineKm(pickup, toLeafletTuple(d.currentLocation)))
      .filter((km) => km > 0 && km <= NEARBY_RADIUS_KM * 3)
      .sort((a, b) => a - b);
    const nearby = distances.filter((km) => km <= NEARBY_RADIUS_KM);
    return { nearbyCount: nearby.length, closestKm: distances[0] };
  }, [dashboardQ.data, request.pickup.coordinates]);

  if (dashboardQ.isLoading) return <Badge tone="gray">checking feasibility…</Badge>;
  if (stats.nearbyCount === 0) {
    return <Badge tone="red">No idle driver within {NEARBY_RADIUS_KM}km — approve with caution</Badge>;
  }
  const etaMin = Math.round((stats.closestKm! / AVG_SPEED_KMPH) * 60);
  return (
    <Badge tone="green">
      <Car size={11} className="mr-1 inline" />
      {stats.nearbyCount} idle driver{stats.nearbyCount > 1 ? 's' : ''} nearby · est. pickup ~{etaMin} min
    </Badge>
  );
}

const DECLINE_REASONS = ['Fleet at capacity right now', 'Outside operating hours', 'Duplicate request', 'Other'];

export default function ApprovalInbox() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [declineTarget, setDeclineTarget] = useState<RideRequest | null>(null);
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0]);

  const requestsQ = useQuery({ queryKey: ['requests', 'pending_approval'], queryFn: () => AdminApi.requests('pending_approval'), refetchInterval: 10_000 });

  const approveMutation = useMutation({
    mutationFn: AdminApi.approveRequest,
    onSuccess: (r) => {
      push({
        kind: 'success',
        title: r.status === 'matched' ? 'Approved and matched' : 'Approved',
        description: r.status === 'matched' ? 'A trip was created automatically.' : 'Waiting for a feasible driver.'
      });
      qc.invalidateQueries({ queryKey: ['requests', 'pending_approval'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Approve failed', description: e.message })
  });

  const declineMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => AdminApi.declineRequest(id, reason),
    onSuccess: () => {
      push({ kind: 'info', title: 'Request declined' });
      setDeclineTarget(null);
      qc.invalidateQueries({ queryKey: ['requests', 'pending_approval'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Decline failed', description: e.message })
  });

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Approval Inbox</h1>
          <p className="text-sm text-gray-500">On-demand ride requests awaiting a human decision — the engine takes over the moment you approve.</p>
        </div>
        <Badge tone="amber">{requestsQ.data?.length ?? 0} pending</Badge>
      </div>

      {requestsQ.isLoading ? (
        <SkeletonRows rows={4} />
      ) : requestsQ.isError ? (
        <ErrorState message={(requestsQ.error as any)?.message} onRetry={() => requestsQ.refetch()} />
      ) : !requestsQ.data?.length ? (
        <EmptyState icon={InboxIcon} title="Inbox zero" description="No on-demand requests are waiting for approval right now." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requestsQ.data.map((r) => (
            <Card key={r.id}>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Requested {fmtTime(r.requestedAt)} · {fmtRelative(r.requestedAt)}</span>
                  <Badge>{r.passengerCount} pax · {r.luggageCount} bags</Badge>
                </div>
                <p className="text-sm font-semibold text-gray-900">{r.pickup.label} → {r.dropoff.label}</p>
                {r.reason && <p className="text-xs text-gray-500">Reason: {r.reason}</p>}
                <FeasibilityChip request={r} />
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="success" className="flex-1" onClick={() => approveMutation.mutate(r.id)} loading={approveMutation.isPending}>
                    <ThumbsUp size={13} /> Approve
                  </Button>
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDeclineTarget(r)}>
                    <ThumbsDown size={13} /> Decline
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!declineTarget}
        onClose={() => setDeclineTarget(null)}
        title="Decline request"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeclineTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={declineMutation.isPending}
              onClick={() => declineTarget && declineMutation.mutate({ id: declineTarget.id, reason: declineReason })}
            >
              Confirm decline
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-gray-600">The guest will be notified with this reason.</p>
        <div className="space-y-2">
          {DECLINE_REASONS.map((reason) => (
            <label key={reason} className="flex items-center gap-2 text-sm">
              <input type="radio" name="decline-reason" checked={declineReason === reason} onChange={() => setDeclineReason(reason)} />
              {reason}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}
