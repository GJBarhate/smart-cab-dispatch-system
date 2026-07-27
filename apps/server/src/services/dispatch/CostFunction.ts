// The dispatch objective (plan.md §8.4). Pure function: no Mongoose, no I/O.
// Costs are offset to stay non-negative (Hungarian-friendly) and rounded to
// 2 decimals to avoid floating-point flakiness in tests (plan.md §16.23/25).
import { clamp01, minutesBetween } from '../../utils/time';
import { COST_OFFSET } from './types';
import type { CostBreakdown, DispatchConfig, DispatchDemand, DispatchDriver } from './types';

// How far out (in minutes) a deadline starts contributing to urgency. A demand
// with more than this much slack contributes ~0; one already past its
// deadline is clamped to full urgency. This is a tuning knob, not a spec
// constant — document it in DESIGN.md alongside the other weights.
export const URGENCY_WINDOW_MIN = 60;

export interface CostContext {
  now: Date;
  pickupEtaMin: number;
  /** Predicted arrival time at the point the demand's deadline is measured against. */
  arrivalAt: Date;
  /** 0 for a fresh assignment; the added minutes when scoring a detour insertion. */
  detourAddedMin?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The anti-starvation term (G1). Superlinear in wait time by design. */
export function priorityScore(demand: DispatchDemand, now: Date): number {
  const waitTerm = 10 * Math.pow(Math.max(0, demand.waitedMinutes) / 10, 1.5);
  const minutesToDeadline = minutesBetween(now, demand.deadlineAt);
  const urgency = clamp01(1 - minutesToDeadline / URGENCY_WINDOW_MIN);
  return (
    10 * demand.priorityTier +
    waitTerm +
    25 * urgency +
    (demand.type === 'DEPARTURE_DROP' ? 20 : 0) +
    (demand.wasRejectedBefore ? 15 : 0)
  );
}

export function capacityWaste(driver: DispatchDriver, demand: DispatchDemand): number {
  if (driver.capacitySeats <= 0) return 0;
  return ((driver.capacitySeats - demand.seats) / driver.capacitySeats) * 10;
}

export function breakUrgency(driver: DispatchDriver, cfg: DispatchConfig): number {
  return Math.max(0, driver.tripsSinceBreak - (cfg.driverBreakAfterTrips - 2)) * 5;
}

export function rejectionPenalty(driver: DispatchDriver, demand: DispatchDemand): number {
  const count = driver.rejectedEntryIds.filter((id) => id === demand.id).length;
  return count * 10;
}

export const CostFunction = {
  score(
    driver: DispatchDriver,
    demand: DispatchDemand,
    ctx: CostContext,
    cfg: DispatchConfig
  ): { total: number; breakdown: CostBreakdown } {
    const w = cfg.weights;

    const lateMin = Math.max(0, minutesBetween(demand.deadlineAt, ctx.arrivalAt));
    const etaTerm = w.eta * ctx.pickupEtaMin;
    const latenessTerm = w.lateness * Math.pow(lateMin, 1.5);
    const priorityTerm = w.priority * priorityScore(demand, ctx.now);
    const idleTerm = w.idle * driver.idleMinutes;
    const capWasteTerm = w.capacityWaste * capacityWaste(driver, demand);
    const breakUrgencyTerm = w.breakUrgency * breakUrgency(driver, cfg);
    const rejectionTerm = w.rejectionHistory * rejectionPenalty(driver, demand);
    const detourTerm = w.detour * (ctx.detourAddedMin ?? 0);

    const raw = etaTerm + latenessTerm - priorityTerm - idleTerm + capWasteTerm + breakUrgencyTerm + rejectionTerm + detourTerm;
    const total = round2(Math.max(0, raw + COST_OFFSET));

    const breakdown: CostBreakdown = {
      eta: round2(etaTerm),
      lateness: round2(latenessTerm),
      priority: round2(-priorityTerm),
      idle: round2(-idleTerm),
      capacityWaste: round2(capWasteTerm),
      breakUrgency: round2(breakUrgencyTerm),
      rejectionHistory: round2(rejectionTerm),
      detour: round2(detourTerm),
      total
    };

    return { total, breakdown };
  }
};
