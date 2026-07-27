import { describe, expect, it } from 'vitest';
import { CostFunction, priorityScore } from '../../services/dispatch/CostFunction';
import type { DispatchConfig, DispatchDemand, DispatchDriver } from '../../services/dispatch/types';

const NOW = new Date('2026-08-10T09:00:00.000Z');
const FAR_DEADLINE = new Date('2026-08-10T13:00:00.000Z'); // 4h out — urgency term ~0

function makeDriver(overrides: Partial<DispatchDriver> = {}): DispatchDriver {
  return {
    id: 'd1',
    status: 'idle',
    vehicleType: 'sedan',
    capacitySeats: 4,
    capacityLuggage: 3,
    usedSeats: 0,
    usedLuggage: 0,
    location: { lat: 18.55, lng: 73.85 },
    predictedFreeAt: NOW,
    predictedFreeLocation: { lat: 18.55, lng: 73.85 },
    shiftEndAt: null,
    tripsSinceBreak: 0,
    minutesSinceBreak: 0,
    onBreakUntil: null,
    idleMinutes: 5,
    rejectedEntryIds: [],
    ...overrides
  };
}

function makeDemand(overrides: Partial<DispatchDemand> = {}): DispatchDemand {
  return {
    id: 'e1',
    type: 'ARRIVAL_PICKUP',
    seats: 2,
    luggage: 2,
    priorityTier: 1,
    waitedMinutes: 5,
    earliestAt: NOW,
    deadlineAt: FAR_DEADLINE,
    pickup: { lat: 18.58, lng: 73.9 },
    dropoff: { lat: 18.53, lng: 73.89 },
    wasRejectedBefore: false,
    ...overrides
  };
}

const cfg: DispatchConfig = {
  weights: { eta: 1, lateness: 6, priority: 2.5, idle: 0.8, capacityWaste: 0.6, breakUrgency: 3, rejectionHistory: 4, detour: 1.5 },
  batchHorizonMin: 45,
  maxDetourMin: 8,
  starvationThresholdMin: 20,
  maxSharedGuestsPerTrip: 4,
  clusterRadiusM: 400,
  clusterTimeWindowMin: 15,
  driverBreakAfterTrips: 4,
  driverBreakMinutes: 20,
  driverMaxContinuousMin: 180,
  offerTimeoutSec: 60,
  maxReassignAttempts: 5,
  deadlineGraceMin: 5,
  serviceTimeMin: 3
};

describe('priorityScore — anti-starvation term', () => {
  it('scores a longer-waiting guest strictly higher than a closer, newer one', () => {
    const longWait = makeDemand({ waitedMinutes: 30 });
    const shortWait = makeDemand({ waitedMinutes: 5 });
    expect(priorityScore(longWait, NOW)).toBeGreaterThan(priorityScore(shortWait, NOW));
  });

  it('is superlinear: a 40min wait scores ~8x a 10min wait, holding everything else equal', () => {
    // priorityTier held at 0 here (not a real tier value) purely to isolate the
    // wait-time term from the flat per-tier constant — see plan.md §8.4:
    // "a guest waiting 40 minutes scores ~8x a guest waiting 10 minutes".
    const long = makeDemand({ priorityTier: 0, waitedMinutes: 40 });
    const short = makeDemand({ priorityTier: 0, waitedMinutes: 10 });
    const ratio = priorityScore(long, NOW) / priorityScore(short, NOW);
    expect(ratio).toBeGreaterThanOrEqual(5);
    expect(ratio).toBeCloseTo(8, 0);
  });

  it('a 60min wait outranks a 10min wait by >=5x even with the flat tier constant included', () => {
    const long = makeDemand({ waitedMinutes: 60 });
    const short = makeDemand({ waitedMinutes: 10 });
    expect(priorityScore(long, NOW) / priorityScore(short, NOW)).toBeGreaterThanOrEqual(5);
  });

  it('ranks a VIP above a standard guest at equal wait', () => {
    const vip = makeDemand({ priorityTier: 3 });
    const standard = makeDemand({ priorityTier: 1 });
    expect(priorityScore(vip, NOW)).toBeGreaterThan(priorityScore(standard, NOW));
  });
});

describe('CostFunction.score', () => {
  const baseCtx = { now: NOW, pickupEtaMin: 10, arrivalAt: new Date('2026-08-10T09:20:00.000Z') };

  it('prefers an idle driver over an equidistant busy-soon driver', () => {
    const idleDriver = makeDriver({ idleMinutes: 40 });
    const busyDriver = makeDriver({ idleMinutes: 2 });
    const demand = makeDemand();

    const idleScore = CostFunction.score(idleDriver, demand, baseCtx, cfg).total;
    const busyScore = CostFunction.score(busyDriver, demand, baseCtx, cfg).total;
    expect(idleScore).toBeLessThan(busyScore);
  });

  it('total cost is always >= 0 after the offset, even under extreme inputs', () => {
    const driver = makeDriver({ idleMinutes: 10_000 });
    const demand = makeDemand({ priorityTier: 3, waitedMinutes: 10_000 });
    const { total } = CostFunction.score(driver, demand, baseCtx, cfg);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('adds a detour penalty only when detourAddedMin is supplied', () => {
    const driver = makeDriver();
    const demand = makeDemand();
    const fresh = CostFunction.score(driver, demand, baseCtx, cfg).total;
    const detoured = CostFunction.score(driver, demand, { ...baseCtx, detourAddedMin: 6 }, cfg).total;
    expect(detoured).toBeGreaterThan(fresh);
  });
});
