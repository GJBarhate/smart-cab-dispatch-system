import { describe, expect, it } from 'vitest';
import { Feasibility } from '../../services/dispatch/Feasibility';
const NOW = new Date('2026-08-10T09:00:00.000Z');
function makeDriver(overrides = {}) {
  return {
    id: 'd1',
    status: 'idle',
    vehicleType: 'sedan',
    capacitySeats: 4,
    capacityLuggage: 3,
    usedSeats: 0,
    usedLuggage: 0,
    location: {
      lat: 18.55,
      lng: 73.85
    },
    predictedFreeAt: NOW,
    predictedFreeLocation: {
      lat: 18.55,
      lng: 73.85
    },
    shiftEndAt: new Date('2026-08-10T18:00:00.000Z'),
    tripsSinceBreak: 0,
    minutesSinceBreak: 0,
    onBreakUntil: null,
    idleMinutes: 5,
    rejectedEntryIds: [],
    ...overrides
  };
}
function makeDemand(overrides = {}) {
  return {
    id: 'e1',
    type: 'ARRIVAL_PICKUP',
    seats: 2,
    luggage: 2,
    priorityTier: 1,
    waitedMinutes: 5,
    earliestAt: NOW,
    deadlineAt: new Date('2026-08-10T10:00:00.000Z'),
    pickup: {
      lat: 18.58,
      lng: 73.9
    },
    dropoff: {
      lat: 18.53,
      lng: 73.89
    },
    wasRejectedBefore: false,
    ...overrides
  };
}
const cfg = {
  weights: {
    eta: 1,
    lateness: 6,
    priority: 2.5,
    idle: 0.8,
    capacityWaste: 0.6,
    breakUrgency: 3,
    rejectionHistory: 4,
    detour: 1.5
  },
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
const okCtx = {
  now: NOW,
  pickupEtaMin: 10,
  estimatedTripEndAt: new Date('2026-08-10T09:40:00.000Z')
};
describe('Feasibility.check', () => {
  it('accepts a feasible driver/demand pair', () => {
    expect(Feasibility.check(makeDriver(), makeDemand(), okCtx, cfg).ok).toBe(true);
  });
  it('rejects when seats exceed remaining capacity', () => {
    const result = Feasibility.check(makeDriver({
      capacitySeats: 4,
      usedSeats: 3
    }), makeDemand({
      seats: 2
    }), okCtx, cfg);
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient_seats'
    });
  });
  it('accepts an exactly-fitting demand (boundary: seats == remaining capacity)', () => {
    const result = Feasibility.check(makeDriver({
      capacitySeats: 4,
      usedSeats: 0
    }), makeDemand({
      seats: 4
    }), okCtx, cfg);
    expect(result.ok).toBe(true);
  });
  it('rejects when luggage exceeds remaining capacity', () => {
    const result = Feasibility.check(makeDriver({
      capacityLuggage: 3,
      usedLuggage: 2
    }), makeDemand({
      luggage: 2
    }), okCtx, cfg);
    expect(result).toEqual({
      ok: false,
      reason: 'insufficient_luggage'
    });
  });
  it('rejects a driver whose shift ends before the trip would end', () => {
    const driver = makeDriver({
      shiftEndAt: new Date('2026-08-10T09:30:00.000Z')
    });
    const ctx = {
      ...okCtx,
      estimatedTripEndAt: new Date('2026-08-10T09:40:00.000Z')
    };
    expect(Feasibility.check(driver, makeDemand(), ctx, cfg)).toEqual({
      ok: false,
      reason: 'shift_ends_before_trip'
    });
  });
  it('rejects a driver who is due a break (trip count)', () => {
    const driver = makeDriver({
      tripsSinceBreak: 4
    });
    expect(Feasibility.check(driver, makeDemand(), okCtx, cfg)).toEqual({
      ok: false,
      reason: 'break_due'
    });
  });
  it('rejects a driver who is due a break (continuous minutes)', () => {
    const driver = makeDriver({
      minutesSinceBreak: 200
    });
    expect(Feasibility.check(driver, makeDemand(), okCtx, cfg)).toEqual({
      ok: false,
      reason: 'break_due'
    });
  });
  it('rejects a driver currently on break', () => {
    const driver = makeDriver({
      onBreakUntil: new Date('2026-08-10T09:15:00.000Z')
    });
    expect(Feasibility.check(driver, makeDemand(), okCtx, cfg)).toEqual({
      ok: false,
      reason: 'driver_on_break'
    });
  });
  it('rejects when the deadline is unreachable', () => {
    const ctx = {
      ...okCtx,
      pickupEtaMin: 90
    };
    const demand = makeDemand({
      deadlineAt: new Date('2026-08-10T09:30:00.000Z')
    });
    expect(Feasibility.check(makeDriver(), demand, ctx, cfg)).toEqual({
      ok: false,
      reason: 'deadline_unreachable'
    });
  });
  it('rejects a suspended driver', () => {
    expect(Feasibility.check(makeDriver({
      status: 'suspended'
    }), makeDemand(), okCtx, cfg)).toEqual({
      ok: false,
      reason: 'driver_suspended'
    });
  });
  it('rejects a driver blacklisted for this entry (2+ prior rejections)', () => {
    const driver = makeDriver({
      rejectedEntryIds: ['e1', 'e1']
    });
    expect(Feasibility.check(driver, makeDemand(), okCtx, cfg)).toEqual({
      ok: false,
      reason: 'blacklisted'
    });
  });
  it('rejects a sedan for a wheelchair demand', () => {
    const demand = makeDemand({
      specialNeeds: 'wheelchair'
    });
    expect(Feasibility.check(makeDriver({
      vehicleType: 'sedan'
    }), demand, okCtx, cfg)).toEqual({
      ok: false,
      reason: 'vehicle_incompatible'
    });
  });
  it('accepts an SUV for a wheelchair demand', () => {
    const demand = makeDemand({
      specialNeeds: 'wheelchair'
    });
    expect(Feasibility.check(makeDriver({
      vehicleType: 'suv'
    }), demand, okCtx, cfg).ok).toBe(true);
  });
});
