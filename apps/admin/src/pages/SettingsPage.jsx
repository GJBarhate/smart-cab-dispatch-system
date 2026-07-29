import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { AdminApi } from '../api/endpoints';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Toggle } from '../components/ui/Toggle';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { useToast } from '../components/ui/Toast';
const THRESHOLD_FIELDS = [{
  key: 'batchHorizonMin',
  label: 'Batch horizon',
  suffix: 'min'
}, {
  key: 'maxDetourMin',
  label: 'Max detour',
  suffix: 'min'
}, {
  key: 'starvationThresholdMin',
  label: 'Starvation threshold',
  suffix: 'min'
}, {
  key: 'maxSharedGuestsPerTrip',
  label: 'Max shared guests / trip'
}, {
  key: 'clusterRadiusM',
  label: 'Cluster radius',
  suffix: 'm'
}, {
  key: 'clusterTimeWindowMin',
  label: 'Cluster time window',
  suffix: 'min'
}, {
  key: 'driverBreakAfterTrips',
  label: 'Break after N trips'
}, {
  key: 'driverBreakMinutes',
  label: 'Break duration',
  suffix: 'min'
}, {
  key: 'driverMaxContinuousMin',
  label: 'Max continuous drive',
  suffix: 'min'
}, {
  key: 'offerTimeoutSec',
  label: 'Offer timeout',
  suffix: 'sec'
}, {
  key: 'maxReassignAttempts',
  label: 'Max reassign attempts'
}];
export default function SettingsPage() {
  const qc = useQueryClient();
  const {
    push
  } = useToast();
  const [flags, setFlags] = useState(null);
  const [thresholds, setThresholds] = useState(null);
  const [dirty, setDirty] = useState(false);
  const configQ = useQuery({
    queryKey: ['config'],
    queryFn: AdminApi.config
  });
  useEffect(() => {
    if (configQ.data && !flags) {
      setFlags(configQ.data.featureFlags);
      setThresholds(configQ.data.dispatch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data]);
  const saveMutation = useMutation({
    mutationFn: () => AdminApi.updateConfig({
      featureFlags: flags ?? undefined,
      dispatch: thresholds ? {
        batchHorizonMin: thresholds.batchHorizonMin,
        maxDetourMin: thresholds.maxDetourMin,
        starvationThresholdMin: thresholds.starvationThresholdMin,
        maxSharedGuestsPerTrip: thresholds.maxSharedGuestsPerTrip,
        clusterRadiusM: thresholds.clusterRadiusM,
        clusterTimeWindowMin: thresholds.clusterTimeWindowMin,
        driverBreakAfterTrips: thresholds.driverBreakAfterTrips,
        driverBreakMinutes: thresholds.driverBreakMinutes,
        driverMaxContinuousMin: thresholds.driverMaxContinuousMin,
        offerTimeoutSec: thresholds.offerTimeoutSec,
        maxReassignAttempts: thresholds.maxReassignAttempts
      } : undefined
    }),
    onSuccess: () => {
      push({
        kind: 'success',
        title: 'Settings saved'
      });
      setDirty(false);
      qc.invalidateQueries({
        queryKey: ['config']
      });
    },
    onError: e => push({
      kind: 'error',
      title: 'Save failed',
      description: e.message
    })
  });
  function updateFlag(key, value) {
    setFlags(prev => prev ? {
      ...prev,
      [key]: value
    } : prev);
    setDirty(true);
  }
  function updateThreshold(key, value) {
    setThresholds(prev => prev ? {
      ...prev,
      [key]: value
    } : prev);
    setDirty(true);
  }
  return <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Settings</h1>
          <p className="text-sm text-muted">Event config: feature flags and dispatch thresholds. Cost weights live on the Dispatch Console.</p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={!dirty} loading={saveMutation.isPending}>
          <Save size={14} /> Save changes
        </Button>
      </div>

      {configQ.isError ? <ErrorState message={configQ.error?.message} onRetry={() => configQ.refetch()} /> : !configQ.data || !flags || !thresholds ?
    // `flags`/`thresholds` are copied out of configQ.data by an effect, so
    // they only imply data *was* present. Checking the query directly is
    // what actually makes the `configQ.data` reads below safe.
    <Skeleton className="h-96 w-full" /> : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Feature flags" subtitle="Circuit breakers for the automated pipeline" />
            <CardBody className="space-y-3">
              <Toggle checked={flags.autoDispatchEnabled} onChange={v => updateFlag('autoDispatchEnabled', v)} label="Auto-dispatch (tick scheduler)" />
              <Toggle checked={flags.detourEnabled} onChange={v => updateFlag('detourEnabled', v)} label="Detour insertion" />
              <Toggle checked={flags.sharingEnabled} onChange={v => updateFlag('sharingEnabled', v)} label="Ride sharing / clustering" />
              <Toggle checked={flags.aiEnabled} onChange={v => updateFlag('aiEnabled', v)} label="AI ops assistant (Gemini)" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Dispatch thresholds" />
            <CardBody className="grid grid-cols-2 gap-3">
              {THRESHOLD_FIELDS.map(f => <label key={f.key} className="block text-xs font-medium text-muted">
                  {f.label}
                  <div className="mt-1 flex items-center gap-1">
                    <input type="number" value={thresholds[f.key]} onChange={e => updateThreshold(f.key, Number(e.target.value))} className="input" />
                    {f.suffix && <span className="shrink-0 text-[11px] text-faint">{f.suffix}</span>}
                  </div>
                </label>)}
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Traffic peak windows" subtitle="Read-only — configured at seed time; use the traffic slider on the Ops Dashboard for live simulation" />
            <CardBody>
              {configQ.data.traffic.peakWindows.length === 0 ? <EmptyState title="No peak windows configured" /> : <ul className="flex flex-wrap gap-2">
                  {configQ.data.traffic.peakWindows.map((w, i) => <li key={i} className="rounded-md bg-elevated px-3 py-1.5 text-xs text-muted">
                      {w.from}–{w.to} · {w.multiplier}x
                    </li>)}
                </ul>}
            </CardBody>
          </Card>
        </div>}
    </div>;
}
