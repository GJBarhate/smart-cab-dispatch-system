import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Timer, Gauge, Car, CircleDot, AlertTriangle, CheckCircle2,
  Play, Radio, ThumbsUp, ThumbsDown, BellRing
} from 'lucide-react';
import { AdminApi, DispatchApi } from '../api/endpoints';
import { useSocketEvent } from '../hooks/useSocket';
import { useToast } from '../components/ui/Toast';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { Slider } from '../components/ui/Slider';
import { Skeleton, SkeletonCard } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LiveOpsMap } from '../components/map/LiveOpsMap';
import { fmtNum, fmtRelative, fmtTime } from '../lib/format';
import type { Alert, RideRequest } from '../types/models';

interface ActivityItem {
  id: string;
  at: string;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

function kpiIconFor(key: string) {
  switch (key) {
    case 'guestsWaiting': return Users;
    case 'avgWaitMin': return Timer;
    case 'oldestWaitMin': return Timer;
    case 'unassignable': return AlertTriangle;
    case 'tripsCompletedToday': return CheckCircle2;
    default: return Gauge;
  }
}

export default function OpsDashboard() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  const dashboardQ = useQuery({ queryKey: ['dashboard'], queryFn: AdminApi.dashboard, refetchInterval: 20_000 });
  const configQ = useQuery({ queryKey: ['config'], queryFn: AdminApi.config });
  const healthQ = useQuery({ queryKey: ['dispatchHealth'], queryFn: DispatchApi.health, refetchInterval: 15_000 });
  const requestsQ = useQuery({ queryKey: ['requests', 'pending_approval'], queryFn: () => AdminApi.requests('pending_approval'), refetchInterval: 20_000 });

  const pushActivity = useCallback((text: string, tone: ActivityItem['tone'] = 'info') => {
    setActivity((prev) => [{ id: `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), text, tone }, ...prev].slice(0, 40));
  }, []);

  useSocketEvent<{ matched: number; unassignable: number; durationMs: number; at: string }>('dispatch:tick', (p) => {
    pushActivity(`Dispatch tick: ${p.matched} matched, ${p.unassignable} unassignable (${p.durationMs}ms)`, p.unassignable > 0 ? 'warning' : 'success');
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['queue'] });
  });

  useSocketEvent<{ tripId: string; status: string; at: string }>('trip:status', (p) => {
    pushActivity(`Trip ${p.tripId.slice(-6)} → ${p.status}`, p.status === 'cancelled' || p.status === 'rejected' ? 'warning' : 'info');
    qc.invalidateQueries({ queryKey: ['trips'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  });

  useSocketEvent<{ depth: number; oldestWaitMin: number; unassignableCount: number }>('queue:update', () => {
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['queue'] });
  });

  useSocketEvent<Alert>('admin:alert', (alert) => {
    pushActivity(`Alert: ${alert.message}`, alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info');
    push({ kind: alert.level === 'critical' ? 'error' : alert.level === 'warning' ? 'warning' : 'info', title: alert.code, description: alert.message });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  });

  const tickMutation = useMutation({
    mutationFn: DispatchApi.tick,
    onSuccess: (r) => {
      if (r.skipped) {
        push({ kind: 'info', title: 'Dispatch tick skipped', description: r.reason ?? r.skipped });
      } else {
        push({ kind: 'success', title: 'Dispatch tick complete', description: `${r.matched ?? 0} matched · ${r.unassignable ?? 0} unassignable` });
      }
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Dispatch tick failed', description: e.message })
  });

  const flagsMutation = useMutation({
    mutationFn: (autoDispatchEnabled: boolean) => DispatchApi.setFlags({ autoDispatchEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
    onError: (e: any) => push({ kind: 'error', title: 'Could not update flag', description: e.message })
  });

  const trafficMutation = useMutation({
    mutationFn: (globalMultiplier: number) => AdminApi.updateConfig({ traffic: { globalMultiplier } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      pushActivity('Traffic multiplier changed by admin', 'warning');
    }
  });

  const approveMutation = useMutation({
    mutationFn: AdminApi.approveRequest,
    onSuccess: () => {
      push({ kind: 'success', title: 'Request approved', description: 'The dispatch engine is matching it now.' });
      qc.invalidateQueries({ queryKey: ['requests', 'pending_approval'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => push({ kind: 'error', title: 'Approve failed', description: e.message })
  });

  const declineMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => AdminApi.declineRequest(id, reason),
    onSuccess: () => {
      push({ kind: 'info', title: 'Request declined' });
      qc.invalidateQueries({ queryKey: ['requests', 'pending_approval'] });
    }
  });

  const ackMutation = useMutation({
    mutationFn: AdminApi.ackAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
    onError: (e: any) => push({ kind: 'error', title: 'Could not acknowledge', description: e.message })
  });

  const mapDrivers = useMemo(
    () =>
      (dashboardQ.data?.liveDrivers ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        currentLocation: d.currentLocation,
        heading: d.heading,
        vehicleNumber: d.vehicle?.number
      })),
    [dashboardQ.data]
  );

  const cfg = configQ.data;
  const health = healthQ.data;

  const kpis = dashboardQ.data?.kpis;
  const kpiTiles = kpis
    ? [
        { key: 'guestsWaiting', label: 'Guests waiting', value: kpis.guestsWaiting },
        { key: 'avgWaitMin', label: 'Avg wait', value: `${fmtNum(kpis.avgWaitMin)}m` },
        { key: 'oldestWaitMin', label: 'p95-ish / oldest wait', value: `${fmtNum(kpis.oldestWaitMin)}m` },
        { key: 'idle', label: 'Drivers idle', value: dashboardQ.data?.driversByStatus.idle ?? 0 },
        { key: 'busy', label: 'Drivers busy', value: Object.entries(dashboardQ.data?.driversByStatus ?? {}).filter(([k]) => !['idle', 'offline', 'on_break', 'suspended'].includes(k)).reduce((s, [, v]) => s + v, 0) },
        { key: 'break', label: 'On break', value: dashboardQ.data?.driversByStatus.on_break ?? 0 },
        { key: 'unassignable', label: 'Unassignable', value: kpis.unassignable },
        { key: 'tripsCompletedToday', label: 'Trips completed today', value: kpis.tripsCompletedToday }
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={health?.routing.breakerOpen ? 'red' : 'green'}>
            <Radio size={12} className="mr-1 inline" />
            {health ? `${health.routing.provider} · cache ${(health.routing.cacheHitRate * 100).toFixed(0)}% · breaker ${health.routing.breakerOpen ? 'open' : 'closed'}` : 'routing health…'}
          </Badge>
          <div className="flex items-center gap-2">
            <Toggle
              checked={cfg?.featureFlags.autoDispatchEnabled ?? false}
              onChange={(v) => flagsMutation.mutate(v)}
              label="Auto-dispatch"
              disabled={!cfg}
            />
          </div>
          <div className="w-48">
            <Slider
              label="Traffic multiplier"
              value={cfg?.traffic.globalMultiplier ?? 1}
              min={0.8}
              max={2.5}
              step={0.1}
              format={(v) => `${v.toFixed(1)}x`}
              onChange={(v) => trafficMutation.mutate(v)}
              disabled={!cfg}
            />
          </div>
        </div>
        <Button onClick={() => tickMutation.mutate()} loading={tickMutation.isPending}>
          <Play size={14} />
          Run dispatch now
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {dashboardQ.isLoading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : dashboardQ.isError
          ? <div className="col-span-full"><ErrorState message={(dashboardQ.error as any)?.message} onRetry={() => dashboardQ.refetch()} /></div>
          : kpiTiles.map((t) => {
              const Icon = kpiIconFor(t.key);
              return (
                <div key={t.key} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                  <div className="mb-1 flex items-center gap-1.5 text-gray-400"><Icon size={13} /><span className="text-[11px] font-medium uppercase tracking-wide">{t.label}</span></div>
                  <p className="text-xl font-bold text-gray-900">{t.value}</p>
                </div>
              );
            })}
      </div>

      {/* Map + right column */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="overflow-hidden lg:col-span-3">
          <CardHeader title="Live fleet map" subtitle={`${mapDrivers.length} active drivers`} />
          <div className="h-[420px]">
            {dashboardQ.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <LiveOpsMap drivers={mapDrivers} className="h-full" />
            )}
          </div>
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Pending approvals"
              subtitle={requestsQ.data ? `${requestsQ.data.length} waiting` : undefined}
              action={<Car size={16} className="text-gray-300" />}
            />
            <CardBody className="max-h-64 overflow-y-auto">
              {requestsQ.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : !requestsQ.data?.length ? (
                <EmptyState icon={CircleDot} title="No pending approvals" description="On-demand requests will appear here." />
              ) : (
                <ul className="space-y-2">
                  {requestsQ.data.map((r: RideRequest) => (
                    <li key={r.id} className="rounded-lg border border-gray-100 p-2.5">
                      <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>{fmtTime(r.requestedAt)} · {r.passengerCount} pax</span>
                        <Badge tone="amber">pending</Badge>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-gray-800">{r.pickup.label} → {r.dropoff.label}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="success" onClick={() => approveMutation.mutate(r.id)} loading={approveMutation.isPending}>
                          <ThumbsUp size={12} /> Approve
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => declineMutation.mutate({ id: r.id, reason: 'Not feasible right now' })}>
                          <ThumbsDown size={12} /> Decline
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Alerts" action={<BellRing size={16} className="text-gray-300" />} />
            <CardBody className="max-h-48 overflow-y-auto">
              {dashboardQ.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : !dashboardQ.data?.alerts.length ? (
                <EmptyState title="No unacknowledged alerts" description="Alerts about unassignable trips or fleet shortfalls show up here." />
              ) : (
                <ul className="space-y-2">
                  {dashboardQ.data.alerts.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 rounded-lg border border-gray-100 p-2 text-xs">
                      <Badge tone={a.level === 'critical' ? 'red' : a.level === 'warning' ? 'amber' : 'blue'}>{a.level}</Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-800">{a.message}</p>
                        <p className="text-gray-400">{fmtRelative(a.createdAt)}</p>
                      </div>
                      <button
                        onClick={() => ackMutation.mutate(a.id)}
                        disabled={ackMutation.isPending}
                        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-ops-600 hover:bg-ops-50 disabled:opacity-50"
                      >
                        Ack
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="flex-1">
            <CardHeader title="Live activity" />
            <CardBody className="max-h-64 overflow-y-auto">
              {activity.length === 0 ? (
                <EmptyState title="Nothing yet" description="Dispatch ticks and trip status changes stream here in real time." />
              ) : (
                <ul className="space-y-1.5">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ops-400" />
                      <span className="text-gray-700">{a.text}</span>
                      <span className="ml-auto shrink-0 text-gray-400">{fmtTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
