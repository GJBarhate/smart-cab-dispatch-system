import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminApi } from '../api/endpoints';
import { useSocketEvent } from '../hooks/useSocket';
import { LiveOpsMap, type MapDriver } from '../components/map/LiveOpsMap';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { DRIVER_STATUS_LABEL } from '../components/map/driverIcons';
import { fmtWaitMinutes } from '../lib/format';

export default function LiveOpsMapPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<MapDriver | null>(null);

  const dashboardQ = useQuery({ queryKey: ['dashboard'], queryFn: AdminApi.dashboard, refetchInterval: 15_000 });
  const queueQ = useQuery({ queryKey: ['queue', 'waiting'], queryFn: () => AdminApi.queue('waiting'), refetchInterval: 15_000 });

  useSocketEvent('driver:position', () => qc.invalidateQueries({ queryKey: ['dashboard'] }));
  useSocketEvent('queue:update', () => qc.invalidateQueries({ queryKey: ['queue', 'waiting'] }));

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

  const pickups = useMemo(
    () => (queueQ.data ?? []).map((q) => ({ id: q.id, label: q.pickup.label, coordinates: q.pickup.coordinates })),
    [queueQ.data]
  );

  return (
    <div className="flex h-screen flex-col gap-3 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Live Ops Map</h1>
        <div className="flex gap-2 text-xs text-gray-500">
          <Badge tone="green">{mapDrivers.filter((d) => d.status === 'idle').length} idle</Badge>
          <Badge tone="blue">{mapDrivers.filter((d) => ['assigned', 'en_route_pickup', 'at_pickup', 'on_trip'].includes(d.status)).length} busy</Badge>
          <Badge tone="purple">{pickups.length} waiting pickups</Badge>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-4">
        <Card className="overflow-hidden lg:col-span-3">
          {dashboardQ.isLoading ? (
            <Skeleton className="h-full min-h-[400px] w-full" />
          ) : (
            <LiveOpsMap drivers={mapDrivers} pickups={pickups} onSelectDriver={setSelected} className="h-full" height="100%" />
          )}
        </Card>
        <Card className="flex flex-col overflow-hidden">
          <CardHeader title={selected ? selected.name : 'Select a driver'} subtitle={selected ? DRIVER_STATUS_LABEL[selected.status] : 'Click a marker on the map'} />
          <CardBody className="flex-1 overflow-y-auto">
            {selected ? (
              <div className="space-y-2 text-sm">
                <p><span className="text-gray-500">Vehicle:</span> {selected.vehicleNumber ?? '—'}</p>
                <p><span className="text-gray-500">Status:</span> {DRIVER_STATUS_LABEL[selected.status]}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Guests waiting for pickup:</p>
                <ul className="space-y-1.5">
                  {(queueQ.data ?? []).slice(0, 10).map((q) => (
                    <li key={q.id} className="rounded-md border border-gray-100 p-2 text-xs">
                      <p className="font-medium text-gray-800">{q.pickup.label} → {q.dropoff.label}</p>
                      <p className="text-gray-400">waiting {fmtWaitMinutes(q.enqueuedAt)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
