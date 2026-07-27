import type { EventConfig } from '../../models/EventConfig';
import type { DispatchConfig } from './types';

// EventConfig.dispatch doesn't carry these two — they're operational
// constants rather than something an admin needs to live-tune from the UI.
const DEADLINE_GRACE_MIN = 5;
const SERVICE_TIME_MIN = 3;

export function toDispatchConfig(cfg: InstanceType<typeof EventConfig>): DispatchConfig {
  const d = cfg.dispatch!;
  const w = d.weights!;
  return {
    weights: {
      eta: w.eta!,
      lateness: w.lateness!,
      priority: w.priority!,
      idle: w.idle!,
      capacityWaste: w.capacityWaste!,
      breakUrgency: w.breakUrgency!,
      rejectionHistory: w.rejectionHistory!,
      detour: w.detour!
    },
    batchHorizonMin: d.batchHorizonMin!,
    maxDetourMin: d.maxDetourMin!,
    starvationThresholdMin: d.starvationThresholdMin!,
    maxSharedGuestsPerTrip: d.maxSharedGuestsPerTrip!,
    clusterRadiusM: d.clusterRadiusM!,
    clusterTimeWindowMin: d.clusterTimeWindowMin!,
    driverBreakAfterTrips: d.driverBreakAfterTrips!,
    driverBreakMinutes: d.driverBreakMinutes!,
    driverMaxContinuousMin: d.driverMaxContinuousMin!,
    offerTimeoutSec: d.offerTimeoutSec!,
    maxReassignAttempts: d.maxReassignAttempts!,
    deadlineGraceMin: DEADLINE_GRACE_MIN,
    serviceTimeMin: SERVICE_TIME_MIN
  };
}
