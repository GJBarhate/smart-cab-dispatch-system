// Opportunistic pickup insertion into trips already in progress (plan.md
// §8.8). Three details make this correct rather than decorative:
//  1. `origin` is the driver's LIVE position, not the trip's original start.
//  2. capacityHoldsThroughout walks the sequence accumulating +seats on
//     pickups / -seats on drops — checking only totals is the classic bug
//     that lets a 5th person into a 4-seater between stops.
//  3. breaksAnyExistingDeadline re-derives the trip's completion time under
//     the new stop order and rejects the insertion if it would slip past
//     the trip's own deadlineAt. Existing guests are never sacrificed for a
//     new one.
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { RoutingService } from '../routing/RoutingService';
import { toLatLng } from '../../utils/geo';
import { haversineKm } from '../../utils/geo';
import type { LatLng } from '../../utils/geo';
import { CostFunction } from './CostFunction';
import { DriverStateService } from './DriverStateService';
import type { CostBreakdown, DispatchConfig, DispatchDemand } from './types';

// Pre-filter before spending any routing call, and a hard cap on how many
// (trip x position-pair) evaluations one tick will pay for (plan.md §8.8).
const PREFILTER_RADIUS_KM = 15;
const MAX_EVALUATIONS = 300;

export interface DetourStop {
  kind: 'pickup' | 'drop';
  guestIds: string[];
  locationId: string | null;
  coordinates: LatLng;
  label: string;
  seats: number;
  luggage: number;
}

/** Walks the sequence; the running total must never exceed capacity at any point. */
export function capacityHoldsThroughout(stops: DetourStop[], capacity: { seats: number; luggage: number }): boolean {
  let seats = 0;
  let luggage = 0;
  for (const s of stops) {
    if (s.kind === 'pickup') {
      seats += s.seats;
      luggage += s.luggage;
    } else {
      seats -= s.seats;
      luggage -= s.luggage;
    }
    if (seats > capacity.seats || luggage > capacity.luggage) return false;
  }
  return true;
}

/** Insert a pickup at gap `i` and its drop at gap `j` (j >= i, both relative to the original `pending` indices). */
export function insertAt(pending: DetourStop[], i: number, pickup: DetourStop, j: number, drop: DetourStop): DetourStop[] {
  const withPickup = [...pending];
  withPickup.splice(i, 0, pickup);
  withPickup.splice(j + 1, 0, drop);
  return withPickup;
}

export function breaksAnyExistingDeadline(totalDurationSeconds: number, now: Date, tripDeadlineAt: Date | null): boolean {
  if (!tripDeadlineAt) return false;
  const completionAt = now.getTime() + totalDurationSeconds * 1000;
  return completionAt > tripDeadlineAt.getTime();
}

export interface DetourCandidate {
  tripId: string;
  driverId: string;
  stops: DetourStop[];
  addedMinutes: number;
  cost: number;
  breakdown: CostBreakdown;
}

export const DetourInserter = {
  async findBest(entry: DispatchDemand, cfg: DispatchConfig, now: Date = new Date()): Promise<DetourCandidate | null> {
    const activeTrips = await Trip.find({ status: { $in: ['en_route_pickup', 'at_pickup', 'boarded'] } });
    let best: DetourCandidate | null = null;
    let evaluations = 0;

    for (const trip of activeTrips) {
      if (evaluations >= MAX_EVALUATIONS) break;

      const remainingSeats = trip.vehicleSnapshot!.seats - trip.capacityUsed!.seats;
      const remainingLuggage = trip.vehicleSnapshot!.luggage - trip.capacityUsed!.luggage;
      if (entry.seats > remainingSeats || entry.luggage > remainingLuggage) continue;
      if (!trip.driverId) continue;

      const driverDoc = await Driver.findById(trip.driverId);
      if (!driverDoc) continue;

      const driverLoc = toLatLng(driverDoc.currentLocation as any);
      if (haversineKm(driverLoc, entry.pickup) > PREFILTER_RADIUS_KM) continue;

      const plainDriver = DriverStateService.toDispatchDriver(driverDoc, now);
      plainDriver.usedSeats = trip.capacityUsed!.seats;
      plainDriver.usedLuggage = trip.capacityUsed!.luggage;

      const guestCapacity = new Map(trip.guests.map((g) => [g.guestId.toString(), { seats: g.seats, luggage: g.luggage }]));
      const pending: DetourStop[] = trip.stops
        .filter((s) => s.status === 'pending')
        .sort((a, b) => a.seq - b.seq)
        .map((s) => {
          const perGuest = s.guestIds.map((id) => guestCapacity.get(id.toString()) ?? { seats: 1, luggage: 1 });
          return {
            kind: s.kind as 'pickup' | 'drop',
            guestIds: s.guestIds.map((id) => id.toString()),
            locationId: s.locationId ? s.locationId.toString() : null,
            coordinates: toLatLng(s.coordinates as any),
            label: s.label,
            seats: perGuest.reduce((sum, g) => sum + g.seats, 0),
            luggage: perGuest.reduce((sum, g) => sum + g.luggage, 0)
          };
        });

      const newPickup: DetourStop = {
        kind: 'pickup',
        guestIds: [],
        locationId: null,
        coordinates: entry.pickup,
        label: 'New pickup',
        seats: entry.seats,
        luggage: entry.luggage
      };
      const newDrop: DetourStop = {
        kind: 'drop',
        guestIds: [],
        locationId: null,
        coordinates: entry.dropoff,
        label: 'New drop',
        seats: entry.seats,
        luggage: entry.luggage
      };

      for (let i = 0; i <= pending.length && evaluations < MAX_EVALUATIONS; i++) {
        for (let j = i; j <= pending.length && evaluations < MAX_EVALUATIONS; j++) {
          evaluations++;
          const candidate = insertAt(pending, i, newPickup, j, newDrop);
          if (!capacityHoldsThroughout(candidate, { seats: trip.vehicleSnapshot!.seats, luggage: trip.vehicleSnapshot!.luggage })) continue;

          const waypoints = [driverLoc, ...candidate.map((s) => s.coordinates)];
          const route = await RoutingService.route(waypoints);

          const originalWaypoints = [driverLoc, ...pending.map((s) => s.coordinates)];
          const original = pending.length > 0 ? await RoutingService.route(originalWaypoints) : { durationSeconds: 0 };
          const addedMin = (route.durationSeconds - original.durationSeconds) / 60;
          if (addedMin > cfg.maxDetourMin) continue;

          if (breaksAnyExistingDeadline(route.durationSeconds, now, trip.deadlineAt ?? null)) continue;

          const pickupLegIndex = candidate.findIndex((s) => s === newPickup);
          const pickupEtaSeconds = route.legs.slice(0, pickupLegIndex + 1).reduce((s, leg) => s + leg.durationSeconds, 0);
          const pickupEtaMin = pickupEtaSeconds / 60;
          const arrivalAt = new Date(now.getTime() + pickupEtaSeconds * 1000);

          const { total, breakdown } = CostFunction.score(
            plainDriver,
            entry,
            { now, pickupEtaMin, arrivalAt, detourAddedMin: Math.max(0, addedMin) },
            cfg
          );

          if (!best || total < best.cost) {
            best = { tripId: trip._id.toString(), driverId: driverDoc._id.toString(), stops: candidate, addedMinutes: addedMin, cost: total, breakdown };
          }
        }
      }
    }

    return best;
  }
};
