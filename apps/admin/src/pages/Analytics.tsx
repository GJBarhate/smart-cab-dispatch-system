import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AdminApi } from '../api/endpoints';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { titleCase } from '../lib/format';
import { BarChart3 } from 'lucide-react';

const OPS_HUE = '#6d28d9';

export default function Analytics() {
  const analyticsQ = useQuery({ queryKey: ['analytics'], queryFn: AdminApi.analytics, refetchInterval: 30_000 });

  const strategyData = Object.entries(analyticsQ.data?.assignmentsByStrategy ?? {}).map(([strategy, count]) => ({
    strategy: titleCase(strategy),
    count
  }));

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Analytics</h1>
      <p className="mb-4 text-sm text-gray-500">Computed from completed trips. Refreshes every 30s.</p>

      {analyticsQ.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : analyticsQ.isError ? (
        <ErrorState message={(analyticsQ.error as any)?.message} onRetry={() => analyticsQ.refetch()} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Avg wait" value={`${analyticsQ.data!.avgWaitMin}m`} />
            <Tile label="p95 wait" value={`${analyticsQ.data!.p95WaitMin}m`} />
            <Tile label="Shared-ride %" value={`${analyticsQ.data!.sharedRidePct}%`} />
            <Tile label="Driver utilisation" value={`${analyticsQ.data!.driverUtilisationPct}%`} />
            <Tile label="Trips completed" value={analyticsQ.data!.tripsCompleted} />
          </div>

          <Card>
            <CardHeader title="Assignments by strategy" subtitle="How completed trips were matched — batch Hungarian, greedy real-time, detour insertion, starvation sweep, or manual override" />
            <CardBody>
              {strategyData.length === 0 ? (
                <EmptyState icon={BarChart3} title="No completed trips yet" description="Once trips complete, their assignment strategy is tallied here." />
              ) : (
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={strategyData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="strategy" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                        formatter={(value: number) => [value, 'Trips']}
                      />
                      <Bar dataKey="count" fill={OPS_HUE} radius={[4, 4, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
