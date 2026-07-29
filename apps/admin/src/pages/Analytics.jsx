import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useChartTheme } from '../hooks/useChartTheme';
import { titleCase } from '../lib/format';
const CHART_HEIGHT = 240;
export default function Analytics() {
  const t = useChartTheme();
  const analyticsQ = useQuery({
    queryKey: ['analytics'],
    queryFn: AdminApi.analytics,
    refetchInterval: 30_000
  });

  // Error first, then "no data yet" — keyed on the data itself rather than
  // `isLoading`, which is false in several states (disabled, paused offline,
  // idle-pending) where `data` is still undefined. Reading it in those states
  // is what crashed the Trip Board's explain dialog.
  if (analyticsQ.isError) {
    return <div className="p-4 md:p-6">
        <Heading />
        <ErrorState message={analyticsQ.error?.message} onRetry={() => analyticsQ.refetch()} />
      </div>;
  }
  if (!analyticsQ.data) {
    return <div className="p-4 md:p-6">
        <Heading />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          {Array.from({
          length: 6
        }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>;
  }
  const data = analyticsQ.data;
  const strategyData = Object.entries(data.assignmentsByStrategy).map(([strategy, count]) => ({
    strategy: titleCase(strategy),
    count
  }));
  return <div className="p-4 md:p-6">
      <Heading />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Avg wait" value={`${data.avgWaitMin}m`} />
        <Tile label="p95 wait" value={`${data.p95WaitMin}m`} />
        <Tile label="Shared-ride %" value={`${data.sharedRidePct}%`} />
        <Tile label="Driver utilisation" value={`${data.driverUtilisationPct}%`} />
        <Tile label="ETA within ±2m" value={`${data.etaWithin2MinPct}%`} />
        <Tile label="Trips completed" value={data.tripsCompleted} />
      </div>

      {data.tripsCompleted === 0 ? <Card>
          <CardBody>
            <EmptyState icon={BarChart3} title="No completed trips yet" description="Analytics are computed from completed trips. Run the dispatch engine or the simulation and these charts will populate." />
          </CardBody>
        </Card> : <div className="er-stagger grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Wait-time distribution" subtitle="Guests per wait band, in minutes. The shape matters more than the mean — bursty arrivals hide a long tail behind a healthy average.">
            <BarChart data={data.waitDistribution} margin={{
          top: 8,
          right: 8,
          left: 0,
          bottom: 4
        }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
              <XAxis dataKey="bucket" tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={{
            stroke: t.axis
          }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={t.tooltip} cursor={{
            fill: t.grid,
            fillOpacity: 0.3
          }} formatter={v => [v, 'Guests']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {/* Bands at and past the starvation threshold are called out in
                    the series colour rather than left for the reader to spot. */}
                {data.waitDistribution.map((b, i) => <Cell key={b.bucket} fill={i >= 4 ? t.series.danger : i === 3 ? t.series.warning : t.series.primary} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          <ChartCard title="Throughput across the day" subtitle="Completed trips and guests carried, by hour — the utilisation curve, with the arrival peak visible.">
            <AreaChart data={data.tripsByHour} margin={{
          top: 8,
          right: 8,
          left: 0,
          bottom: 4
        }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
              <XAxis dataKey="hour" tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={{
            stroke: t.axis
          }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={t.tooltip} />
              <Area type="monotone" dataKey="guests" name="Guests" stroke={t.series.secondary} fill={t.series.secondary} fillOpacity={0.25} />
              <Area type="monotone" dataKey="trips" name="Trips" stroke={t.series.primary} fill={t.series.primary} fillOpacity={0.35} />
            </AreaChart>
          </ChartCard>

          <ChartCard title="ETA accuracy" subtitle="Predicted minus actual, in minutes. Bars left of zero ran later than promised; the two green bands are within ±2 min.">
            <BarChart data={data.etaAccuracyDistribution} margin={{
          top: 8,
          right: 8,
          left: 0,
          bottom: 4
        }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
              <XAxis dataKey="bucket" tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={{
            stroke: t.axis
          }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={t.tooltip} cursor={{
            fill: t.grid,
            fillOpacity: 0.3
          }} formatter={v => [v, 'Trips']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56}>
                {data.etaAccuracyDistribution.map((b, i) => <Cell key={b.bucket} fill={i === 2 || i === 3 ? t.series.positive : t.series.primary} />)}
              </Bar>
            </BarChart>
          </ChartCard>

          <ChartCard title="Trips per driver" subtitle="A flat profile means the cost function's idle-time term is spreading work across the fleet rather than favouring the same few cars.">
            <BarChart data={data.tripsPerDriver} margin={{
          top: 8,
          right: 8,
          left: 0,
          bottom: 4
        }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
              <XAxis dataKey="name" tick={{
            fontSize: 10,
            fill: t.tick
          }} axisLine={{
            stroke: t.axis
          }} tickLine={false} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={t.tooltip} cursor={{
            fill: t.grid,
            fillOpacity: 0.3
          }} formatter={v => [v, 'Trips']} />
              <Bar dataKey="trips" fill={t.series.primary} radius={[4, 4, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ChartCard>

          <ChartCard title="Assignments by strategy" subtitle="How completed trips were matched — batch Hungarian, greedy real-time, detour insertion, starvation sweep, or manual override.">
            <BarChart data={strategyData} margin={{
          top: 8,
          right: 8,
          left: 0,
          bottom: 4
        }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
              <XAxis dataKey="strategy" tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={{
            stroke: t.axis
          }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{
            fontSize: 11,
            fill: t.tick
          }} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={t.tooltip} cursor={{
            fill: t.grid,
            fillOpacity: 0.3
          }} formatter={v => [v, 'Trips']} />
              <Bar dataKey="count" fill={t.series.primary} radius={[4, 4, 0, 0]} maxBarSize={56} />
            </BarChart>
          </ChartCard>

          <Card>
            <CardHeader title="Sharing dividend" subtitle="Vehicle-minutes not driven because rides were combined, net of the detour each combination cost." />
            <CardBody>
              <div className="flex flex-col items-center justify-center gap-1 text-center" style={{
            height: CHART_HEIGHT
          }}>
                <p className="text-5xl font-bold text-ops-600">{data.detourSavedMin}</p>
                <p className="text-sm font-medium text-ink">vehicle-minutes saved</p>
                <p className="mt-2 max-w-sm text-xs text-muted">
                  Across {data.sharedTripCount} shared trip{data.sharedTripCount === 1 ? '' : 's'}. Each replaces{' '}
                  <span className="font-medium text-ink">n − 1</span> journeys that would otherwise have been driven separately,
                  less the detour minutes actually incurred to combine them. The baseline is the median single-guest trip, so one
                  long airport run cannot inflate the figure.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>}
    </div>;
}
function Heading() {
  return <>
      <h1 className="text-lg font-semibold text-ink">Analytics</h1>
      <p className="mb-4 text-sm text-muted">Computed from completed trips. Refreshes every 30s.</p>
    </>;
}
function ChartCard({
  title,
  subtitle,
  children
}) {
  return <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody>
        <div style={{
        width: '100%',
        height: CHART_HEIGHT
      }}>
          <ResponsiveContainer>{children}</ResponsiveContainer>
        </div>
      </CardBody>
    </Card>;
}
function Tile({
  label,
  value
}) {
  return <div className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</p>
      <p className="text-xl font-bold text-ink">{value}</p>
    </div>;
}
