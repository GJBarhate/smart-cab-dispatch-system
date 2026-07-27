// Plain-object contracts for the dispatch engine. Nothing in this file or in
// Feasibility.ts / CostFunction.ts / BatchAssigner.ts / Clusterer.ts /
// GroupSplitter.ts may import Express or Mongoose — the scoring path stays
// pure and unit-testable with plain objects (plan.md §8).
import type { LatLng } from '../../utils/geo';

export type VehicleTypeT = 'sedan' | 'suv' | 'tempo' | 'bus';
export type DriverStatusT =
  | 'offline'
  | 'idle'
  | 'assigned'
  | 'en_route_pickup'
  | 'at_pickup'
  | 'on_trip'
  | 'on_break'
  | 'suspended';

export interface DispatchDriver {
  id: string;
  status: DriverStatusT;
  vehicleType: VehicleTypeT;
  capacitySeats: number;
  capacityLuggage: number;
  usedSeats: number;
  usedLuggage: number;
  location: LatLng;
  predictedFreeAt: Date;
  predictedFreeLocation: LatLng;
  shiftEndAt: Date | null;
  tripsSinceBreak: number;
  minutesSinceBreak: number;
  onBreakUntil: Date | null;
  idleMinutes: number;
  rejectedEntryIds: string[];
}

export interface DispatchDemand {
  id: string;
  type: string;
  seats: number;
  luggage: number;
  priorityTier: number;
  waitedMinutes: number;
  earliestAt: Date;
  deadlineAt: Date;
  specialNeeds?: string;
  pickup: LatLng;
  dropoff: LatLng;
  wasRejectedBefore: boolean;
}

export interface DispatchWeights {
  eta: number;
  lateness: number;
  priority: number;
  idle: number;
  capacityWaste: number;
  breakUrgency: number;
  rejectionHistory: number;
  detour: number;
}

export interface DispatchConfig {
  weights: DispatchWeights;
  batchHorizonMin: number;
  maxDetourMin: number;
  starvationThresholdMin: number;
  maxSharedGuestsPerTrip: number;
  clusterRadiusM: number;
  clusterTimeWindowMin: number;
  driverBreakAfterTrips: number;
  driverBreakMinutes: number;
  driverMaxContinuousMin: number;
  offerTimeoutSec: number;
  maxReassignAttempts: number;
  deadlineGraceMin: number;
  serviceTimeMin: number;
}

export interface FeasibilityResult {
  ok: boolean;
  reason?: string;
}

export interface CostBreakdown {
  eta: number;
  lateness: number;
  priority: number;
  idle: number;
  capacityWaste: number;
  breakUrgency: number;
  rejectionHistory: number;
  detour: number;
  total: number;
}

export const BIG_M = 1e9;
export const COST_OFFSET = 500;
