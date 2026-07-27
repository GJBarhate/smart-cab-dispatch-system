// Real-time path used between ticks — admin approvals, driver rejections,
// and the starvation sweep all need an answer now, not at the next tick
// (plan.md §8.7). Target: <800ms p95, mostly cache hits.
import { Driver } from '../../models/Driver';
import { RoutingService } from '../routing/RoutingService';
import { toGeoPoint } from '../../utils/geo';
import { Feasibility } from './Feasibility';
import { CostFunction } from './CostFunction';
import { DriverStateService } from './DriverStateService';
import type { CostBreakdown, DispatchConfig, DispatchDemand } from './types';

const RADIUS_STEPS_M = [12_000, 25_000, Number.POSITIVE_INFINITY];

export interface GreedyMatchResult {
  driver: InstanceType<typeof Driver>;
  score: number;
  breakdown: CostBreakdown;
  pickupEtaMin: number;
}

async function candidateDrivers(demand: DispatchDemand, radiusM: number): Promise<Array<InstanceType<typeof Driver>>> {
  const query: Record<string, unknown> = {
    isActive: true,
    status: { $in: ['idle', 'assigned', 'on_trip'] }
  };

  if (Number.isFinite(radiusM)) {
    query.currentLocation = {
      $near: {
        $geometry: toGeoPoint(demand.pickup),
        $maxDistance: radiusM
      }
    };
  }

  return Driver.find(query).limit(15);
}

export const GreedyMatcher = {
  async findBest(demand: DispatchDemand, cfg: DispatchConfig, now: Date = new Date()): Promise<GreedyMatchResult | null> {
    let drivers: Array<InstanceType<typeof Driver>> = [];
    for (const radius of RADIUS_STEPS_M) {
      drivers = await candidateDrivers(demand, radius);
      if (drivers.length > 0) break;
    }
    if (drivers.length === 0) return null;

    const dispatchDrivers = drivers.map((d) => ({ doc: d, plain: DriverStateService.toDispatchDriver(d, now) }));

    if (dispatchDrivers.length === 0) return null;

    const { durations } = await RoutingService.matrix(
      dispatchDrivers.map((d) => d.plain.location),
      [demand.pickup]
    );

    let best: GreedyMatchResult | null = null;

    dispatchDrivers.forEach(({ doc, plain }, i) => {
      const pickupEtaMin = (durations[i]?.[0] ?? Infinity) / 60;
      const estimatedTripEndAt = new Date(now.getTime() + (pickupEtaMin + 30) * 60_000);

      const feasibility = Feasibility.check(plain, demand, { now, pickupEtaMin, estimatedTripEndAt }, cfg);
      if (!feasibility.ok) return;

      const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
      const { total, breakdown } = CostFunction.score(plain, demand, { now, pickupEtaMin, arrivalAt }, cfg);

      if (!best || total < best.score) {
        best = { driver: doc, score: total, breakdown, pickupEtaMin };
      }
    });

    return best;
  }
};
