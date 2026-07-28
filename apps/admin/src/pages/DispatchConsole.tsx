import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle, Info, Sparkles } from 'lucide-react';
import { AdminApi, DispatchApi } from '../api/endpoints';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Slider } from '../components/ui/Slider';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import type { CostBreakdown, DispatchPreview, DispatchWeights } from '../types/models';

// BIG_M is 1e9 server-side (plan.md §8.3) — anything above this threshold in
// the matrix is an infeasible pair the Hungarian solver only picked because
// it had to pad the matrix square, never a real candidate.
const BIG_M_THRESHOLD = 1e8;

const WEIGHT_META: Array<{ key: keyof DispatchWeights; label: string; min: number; max: number }> = [
  { key: 'eta', label: 'ETA', min: 0, max: 5 },
  { key: 'lateness', label: 'Lateness', min: 0, max: 12 },
  { key: 'priority', label: 'Priority (anti-starvation)', min: 0, max: 8 },
  { key: 'idle', label: 'Idle credit', min: 0, max: 4 },
  { key: 'capacityWaste', label: 'Capacity waste', min: 0, max: 3 },
  { key: 'breakUrgency', label: 'Break urgency', min: 0, max: 6 },
  { key: 'rejectionHistory', label: 'Rejection history', min: 0, max: 8 },
  { key: 'detour', label: 'Detour', min: 0, max: 4 }
];

// Sequential single-hue ramp (light = cheap/preferred -> dark = expensive),
// interpolated in the admin's `ops` purple scale. Infeasible cells are
// rendered with a distinct hatch texture, never folded into this scale.
const RAMP_LIGHT: [number, number, number] = [245, 243, 255]; // ops-50
const RAMP_DARK: [number, number, number] = [76, 29, 149]; // ops-800

function lerpColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const [r1, g1, b1] = RAMP_LIGHT;
  const [r2, g2, b2] = RAMP_DARK;
  const r = Math.round(r1 + (r2 - r1) * clamped);
  const g = Math.round(g1 + (g2 - g1) * clamped);
  const b = Math.round(b1 + (b2 - b1) * clamped);
  return `rgb(${r}, ${g}, ${b})`;
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  const tone = value > 0 ? 'text-red-600' : value < 0 ? 'text-emerald-600' : 'text-muted';
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums font-medium ${tone}`}>{value >= 0 ? '+' : ''}{value.toFixed(2)}</span>
    </div>
  );
}

export default function DispatchConsole() {
  const qc = useQueryClient();
  const { push } = useToast();
  const [weights, setWeights] = useState<DispatchWeights | null>(null);
  const [selected, setSelected] = useState<{ i: number; j: number } | null>(null);
  const debounceRef = useRef<number | null>(null);

  const configQ = useQuery({ queryKey: ['config'], queryFn: AdminApi.config });

  const previewMutation = useMutation({
    mutationFn: DispatchApi.previewBatch,
    onError: (e: any) => push({ kind: 'error', title: 'Preview failed', description: e.message })
  });

  const configWeightsMutation = useMutation({
    mutationFn: (w: DispatchWeights) => AdminApi.updateConfig({ dispatch: { weights: w } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config'] });
      previewMutation.mutate();
    }
  });

  // Seed local slider state once config loads, and run the first preview.
  useEffect(() => {
    if (configQ.data && !weights) {
      setWeights(configQ.data.dispatch.weights);
      previewMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQ.data]);

  function onWeightChange(key: keyof DispatchWeights, value: number) {
    if (!weights) return;
    const next = { ...weights, [key]: value };
    setWeights(next);
    setSelected(null);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      configWeightsMutation.mutate(next);
    }, 400);
  }

  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

  const preview: DispatchPreview | undefined = previewMutation.data;

  const { minCost, maxCost } = useMemo(() => {
    if (!preview) return { minCost: 0, maxCost: 1 };
    const feasible = preview.costMatrix.flat().filter((c) => c < BIG_M_THRESHOLD);
    if (feasible.length === 0) return { minCost: 0, maxCost: 1 };
    return { minCost: Math.min(...feasible), maxCost: Math.max(...feasible) };
  }, [preview]);

  const chosenMap = useMemo(() => {
    const map = new Map<string, { cost: number; breakdown: CostBreakdown }>();
    preview?.chosenPairs.forEach((p) => map.set(`${p.driverIndex}:${p.demandIndex}`, p));
    return map;
  }, [preview]);

  const selectedDetail = selected
    ? chosenMap.get(`${selected.i}:${selected.j}`) ?? { cost: preview?.costMatrix[selected.i]?.[selected.j] ?? 0, breakdown: null }
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Dispatch Console</h1>
          <p className="text-sm text-muted">
            A dry-run preview of the Hungarian batch assigner — nothing here commits a trip. Cost matrix: drivers × demand clusters.
          </p>
        </div>
        <Button onClick={() => previewMutation.mutate()} loading={previewMutation.isPending}>
          <PlayCircle size={14} /> Preview batch
        </Button>
      </div>

      <div className="er-stagger grid grid-cols-1 gap-4 xl:grid-cols-4">
        {/* Weight sliders */}
        <Card className="xl:col-span-1">
          <CardHeader title="Cost weights" subtitle="Changes PATCH the live config and re-run the preview" />
          <CardBody className="space-y-4">
            {configQ.isError ? (
              <ErrorState message={(configQ.error as any)?.message} onRetry={() => configQ.refetch()} />
            ) : !weights ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              WEIGHT_META.map((m) => (
                <Slider
                  key={m.key}
                  label={m.label}
                  value={weights[m.key]}
                  min={m.min}
                  max={m.max}
                  step={0.1}
                  onChange={(v) => onWeightChange(m.key, v)}
                />
              ))
            )}
            {configWeightsMutation.isPending && <p className="text-xs text-ops-600">Saving & re-running…</p>}
          </CardBody>
        </Card>

        {/* Heatmap */}
        <Card className="xl:col-span-3">
          <CardHeader
            title="Cost matrix heatmap"
            subtitle={preview ? `${preview.drivers.length} drivers × ${preview.demands.length} demand clusters` : undefined}
            action={
              <div className="flex items-center gap-3 text-[11px] text-muted">
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: lerpColor(0.05) }} /> cheap</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: lerpColor(0.95) }} /> costly</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border-2 border-emerald-500 bg-surface" /> selected</span>
                <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-line bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgb(var(--c-faint))_2px,rgb(var(--c-faint))_3px)]" /> infeasible</span>
              </div>
            }
          />
          <CardBody>
            {previewMutation.isPending && !preview ? (
              <Skeleton className="h-72 w-full" />
            ) : previewMutation.isError ? (
              <ErrorState message={(previewMutation.error as any)?.message ?? 'Could not load the preview'} onRetry={() => previewMutation.mutate()} />
            ) : !preview || preview.drivers.length === 0 || preview.demands.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="Nothing to preview"
                description="No eligible drivers or waiting demand right now — seed some queue entries or wait for guests to arrive."
              />
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-line-soft" style={{ maxHeight: 460 }}>
                  <table className="border-collapse text-[11px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 top-0 z-20 bg-surface p-1 text-left" />
                        {preview.demands.map((d, j) => (
                          <th
                            key={d.id}
                            className="sticky top-0 z-10 min-w-[30px] bg-surface p-1 text-center font-medium text-muted"
                            title={`Demand ${j + 1} — ${d.guestIds.length} guest(s), ${d.seats} seats`}
                          >
                            R{j + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.drivers.map((drv, i) => (
                        <tr key={drv.id}>
                          <th className="sticky left-0 z-10 whitespace-nowrap bg-surface p-1 text-right font-medium text-muted" title={drv.name}>
                            {drv.name.length > 12 ? `${drv.name.slice(0, 11)}…` : drv.name}
                          </th>
                          {preview.demands.map((_, j) => {
                            const cost = preview.costMatrix[i]?.[j] ?? BIG_M_THRESHOLD;
                            const infeasible = cost >= BIG_M_THRESHOLD;
                            const isChosen = chosenMap.has(`${i}:${j}`);
                            const t = infeasible || maxCost === minCost ? 0 : (cost - minCost) / (maxCost - minCost);
                            const isSelectedCell = selected?.i === i && selected?.j === j;
                            return (
                              <td
                                key={j}
                                onClick={() => setSelected({ i, j })}
                                className={`h-7 w-7 cursor-pointer text-center align-middle ${isSelectedCell ? 'ring-2 ring-ops-600 ring-inset' : ''} ${isChosen ? 'border-2 border-emerald-500' : 'border border-surface'}`}
                                style={
                                  infeasible
                                    ? { background: 'rgb(var(--c-elevated))', backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgb(var(--c-faint)) 2px, rgb(var(--c-faint)) 3px)' }
                                    : { background: lerpColor(t) }
                                }
                                title={infeasible ? 'Infeasible pair' : `Cost ${cost.toFixed(1)}`}
                              />
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Detail panel */}
                <div className="w-full shrink-0 rounded-lg border border-line-soft p-3 lg:w-64">
                  {!selected ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 py-8 text-center text-xs text-faint">
                      <Info size={18} />
                      Click a cell to see its full cost breakdown
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-ink">
                        {preview.drivers[selected.i]?.name} → R{selected.j + 1}
                      </p>
                      {chosenMap.has(`${selected.i}:${selected.j}`) ? (
                        <Badge tone="green">Hungarian-selected pair</Badge>
                      ) : (
                        <Badge tone="gray">Not selected</Badge>
                      )}
                      {selectedDetail?.breakdown ? (
                        <div className="space-y-1 border-t border-line-soft pt-2">
                          <BreakdownRow label="ETA" value={selectedDetail.breakdown.eta} />
                          <BreakdownRow label="Lateness" value={selectedDetail.breakdown.lateness} />
                          <BreakdownRow label="Priority" value={selectedDetail.breakdown.priority} />
                          <BreakdownRow label="Idle credit" value={selectedDetail.breakdown.idle} />
                          <BreakdownRow label="Capacity waste" value={selectedDetail.breakdown.capacityWaste} />
                          <BreakdownRow label="Break urgency" value={selectedDetail.breakdown.breakUrgency} />
                          <BreakdownRow label="Rejection history" value={selectedDetail.breakdown.rejectionHistory} />
                          <BreakdownRow label="Detour" value={selectedDetail.breakdown.detour} />
                          <div className="flex items-center justify-between border-t border-line-soft pt-1 text-xs font-bold">
                            <span>Total</span>
                            <span className="tabular-nums">{selectedDetail.breakdown.total.toFixed(2)}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="border-t border-line-soft pt-2 text-xs text-muted">
                          Raw cost: <span className="font-medium tabular-nums">{selectedDetail?.cost.toFixed(1)}</span>
                          <br />Only cells the optimizer actually chose carry a full breakdown.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
