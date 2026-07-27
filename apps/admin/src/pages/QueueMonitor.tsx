import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap, ListOrdered } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { useSocketEvent } from '../hooks/useSocket';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SkeletonRows } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
import { fmtWaitMinutes, minutesAgo, titleCase } from '../lib/format';

const STATUS_FILTERS = ['waiting', 'matching', 'assigned', 'failed'] as const;

export default function QueueMonitor() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('waiting');

  const configQ = useQuery({ queryKey: ['config'], queryFn: AdminApi.config });
  const queueQ = useQuery({
    queryKey: ['queue', statusFilter],
    queryFn: () => AdminApi.queue(statusFilter),
    refetchInterval: 10_000
  });

  useSocketEvent('queue:update', () => qc.invalidateQueries({ queryKey: ['queue'] }));

  const boostMutation = useMutation({
    mutationFn: AdminApi.boostQueueEntry,
    onSuccess: () => {
      push({ kind: 'success', title: 'Priority boosted', description: 'This entry will be matched first on the next tick.' });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Boost failed', description: e.message })
  });

  const starvationMin = configQ.data?.dispatch.starvationThresholdMin ?? 20;

  const rows = useMemo(() => {
    return (queueQ.data ?? []).map((q) => {
      const waitMin = minutesAgo(q.enqueuedAt);
      const tier: 'ok' | 'amber' | 'red' = waitMin >= starvationMin ? 'red' : waitMin >= 15 ? 'amber' : 'ok';
      return { entry: q, waitMin, tier };
    });
  }, [queueQ.data, starvationMin]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Queue Monitor</h1>
          <p className="text-sm text-gray-500">
            Rows turn amber past 15 min, red past the starvation threshold ({starvationMin} min) — the point at which the sweeper force-matches greedily.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                statusFilter === s ? 'bg-ops-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {queueQ.isLoading ? (
          <div className="p-4"><SkeletonRows rows={6} /></div>
        ) : queueQ.isError ? (
          <div className="p-4"><ErrorState message={(queueQ.error as any)?.message} onRetry={() => queueQ.refetch()} /></div>
        ) : rows.length === 0 ? (
          <div className="p-4"><EmptyState icon={ListOrdered} title="Queue is empty" description={`No entries with status "${statusFilter}".`} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Guest(s)</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">From → To</th>
                  <th className="px-4 py-2.5">Waiting</th>
                  <th className="px-4 py-2.5">Priority</th>
                  <th className="px-4 py-2.5">Attempts</th>
                  <th className="px-4 py-2.5">Why not matched</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ entry, waitMin, tier }) => (
                  <tr
                    key={entry.id}
                    className={tier === 'red' ? 'bg-red-50' : tier === 'amber' ? 'bg-amber-50' : undefined}
                  >
                    <td className="px-4 py-2.5">{entry.guestIds.length} guest{entry.guestIds.length > 1 ? 's' : ''} · {entry.seats} seats</td>
                    <td className="px-4 py-2.5"><Badge>{titleCase(entry.type)}</Badge></td>
                    <td className="max-w-[220px] truncate px-4 py-2.5">{entry.pickup.label} → {entry.dropoff.label}</td>
                    <td className={`px-4 py-2.5 font-medium ${tier === 'red' ? 'text-red-700' : tier === 'amber' ? 'text-amber-700' : 'text-gray-700'}`}>
                      {fmtWaitMinutes(entry.enqueuedAt)}
                      {waitMin >= starvationMin && <span className="ml-1 text-[10px] uppercase">starving</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{entry.priorityScore.toFixed(1)}</td>
                    <td className="px-4 py-2.5">{entry.attempts}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-gray-500">{entry.lastFailureReason || '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => boostMutation.mutate(entry.id)} loading={boostMutation.isPending}>
                        <Zap size={12} /> Boost
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
