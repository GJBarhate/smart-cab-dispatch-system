// Hard constraints only — never a soft penalty (plan.md §8.3). An infeasible
// pair must score BIG_M in the cost matrix, or the Hungarian solver will
// happily overload a vehicle the moment supply gets tight.
import { minutesBetween } from '../../utils/time';
import type { DispatchConfig, DispatchDemand, DispatchDriver, FeasibilityResult } from './types';

const WHEELCHAIR_COMPATIBLE: DispatchDriver['vehicleType'][] = ['suv', 'tempo', 'bus'];

function vehicleSupports(specialNeeds: string | undefined, vehicleType: DispatchDriver['vehicleType']): boolean {
  if (!specialNeeds) return true;
  const need = specialNeeds.toLowerCase();
  if (need.includes('wheelchair')) return WHEELCHAIR_COMPATIBLE.includes(vehicleType);
  return true;
}

export interface FeasibilityContext {
  now: Date;
  pickupEtaMin: number;
  estimatedTripEndAt: Date;
}

export const Feasibility = {
  check(driver: DispatchDriver, demand: DispatchDemand, ctx: FeasibilityContext, cfg: DispatchConfig): FeasibilityResult {
    if (driver.status === 'suspended') {
      return { ok: false, reason: 'driver_suspended' };
    }

    if (demand.seats > driver.capacitySeats - driver.usedSeats) {
      return { ok: false, reason: 'insufficient_seats' };
    }

    if (demand.luggage > driver.capacityLuggage - driver.usedLuggage) {
      return { ok: false, reason: 'insufficient_luggage' };
    }

    if (driver.shiftEndAt && driver.shiftEndAt.getTime() < ctx.estimatedTripEndAt.getTime()) {
      return { ok: false, reason: 'shift_ends_before_trip' };
    }

    if (driver.onBreakUntil && driver.onBreakUntil.getTime() > ctx.now.getTime()) {
      return { ok: false, reason: 'driver_on_break' };
    }

    const breakDue =
      driver.tripsSinceBreak >= cfg.driverBreakAfterTrips || driver.minutesSinceBreak >= cfg.driverMaxContinuousMin;
    if (breakDue) {
      return { ok: false, reason: 'break_due' };
    }

    const arrivalMin = ctx.pickupEtaMin + cfg.serviceTimeMin;
    const arrivalAt = ctx.now.getTime() + arrivalMin * 60_000;
    if (arrivalAt > demand.deadlineAt.getTime() + cfg.deadlineGraceMin * 60_000) {
      return { ok: false, reason: 'deadline_unreachable' };
    }

    const rejectionCount = driver.rejectedEntryIds.filter((id) => id === demand.id).length;
    if (rejectionCount >= 2) {
      return { ok: false, reason: 'blacklisted' };
    }

    if (!vehicleSupports(demand.specialNeeds, driver.vehicleType)) {
      return { ok: false, reason: 'vehicle_incompatible' };
    }

    return { ok: true };
  }
};

/** Minutes between now and a future point — small helper kept here so callers don't reimplement it. */
export function minutesUntil(now: Date, at: Date): number {
  return minutesBetween(now, at);
}
