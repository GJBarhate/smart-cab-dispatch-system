"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DetourInserter = void 0;
exports.breaksAnyExistingDeadline = breaksAnyExistingDeadline;
exports.capacityHoldsThroughout = capacityHoldsThroughout;
exports.createEvaluationBudget = createEvaluationBudget;
exports.insertAt = insertAt;
var _Driver = require("../../models/Driver");
var _Trip = require("../../models/Trip");
var _RoutingService = require("../routing/RoutingService");
var _geo = require("../../utils/geo");
var _CostFunction = require("./CostFunction");
var _DriverStateService = require("./DriverStateService");
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

// Pre-filter before spending any routing call, and a hard cap on how many
// (trip x position-pair) evaluations one tick will pay for (plan.md §8.8).
const PREFILTER_RADIUS_KM = 15;
const MAX_EVALUATIONS = 300;

/**
 * Shared allowance across every `findBest` call in one dispatch tick.
 *
 * `MAX_EVALUATIONS` bounds a *single* demand, but the engine calls `findBest`
 * once per waiting entry, so the real per-tick ceiling was
 * `MAX_EVALUATIONS x waitingEntries` — 3,600 routing round trips for a queue of
 * 12, against a public OSRM instance. That is what pushed observed tick
 * duration to 90-155s (and, when the provider was flaky, into the tens of
 * minutes). Passing one budget through the whole detour phase restores the
 * bound the comment above always claimed.
 */

function createEvaluationBudget(total = MAX_EVALUATIONS) {
  return {
    remaining: total
  };
}
/** Walks the sequence; the running total must never exceed capacity at any point. */
function capacityHoldsThroughout(stops, capacity) {
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
function insertAt(pending, i, pickup, j, drop) {
  const withPickup = [...pending];
  withPickup.splice(i, 0, pickup);
  withPickup.splice(j + 1, 0, drop);
  return withPickup;
}
function breaksAnyExistingDeadline(totalDurationSeconds, now, tripDeadlineAt) {
  if (!tripDeadlineAt) return false;
  const completionAt = now.getTime() + totalDurationSeconds * 1000;
  return completionAt > tripDeadlineAt.getTime();
}
const DetourInserter = {
  /**
   * `budget` is optional so single-demand callers (admin approval, driver
   * rejection, the starvation sweep) keep the original per-call allowance;
   * the tick passes one shared budget so a long queue cannot multiply it.
   */
  async findBest(entry, cfg, now = new Date(), budget) {
    if (budget && budget.remaining <= 0) return null;
    const activeTrips = await _Trip.Trip.find({
      status: {
        $in: ['en_route_pickup', 'at_pickup', 'boarded']
      }
    });
    let best = null;
    let evaluations = 0;
    const exhausted = () => evaluations >= MAX_EVALUATIONS || budget !== undefined && budget.remaining <= 0;
    for (const trip of activeTrips) {
      if (exhausted()) break;
      const remainingSeats = trip.vehicleSnapshot.seats - trip.capacityUsed.seats;
      const remainingLuggage = trip.vehicleSnapshot.luggage - trip.capacityUsed.luggage;
      if (entry.seats > remainingSeats || entry.luggage > remainingLuggage) continue;
      if (!trip.driverId) continue;
      const driverDoc = await _Driver.Driver.findById(trip.driverId);
      if (!driverDoc) continue;
      const driverLoc = (0, _geo.toLatLng)(driverDoc.currentLocation);
      if ((0, _geo.haversineKm)(driverLoc, entry.pickup) > PREFILTER_RADIUS_KM) continue;
      const plainDriver = _DriverStateService.DriverStateService.toDispatchDriver(driverDoc, now);
      plainDriver.usedSeats = trip.capacityUsed.seats;
      plainDriver.usedLuggage = trip.capacityUsed.luggage;
      const guestCapacity = new Map(trip.guests.map(g => [g.guestId.toString(), {
        seats: g.seats,
        luggage: g.luggage
      }]));
      const pending = trip.stops.filter(s => s.status === 'pending').sort((a, b) => a.seq - b.seq).map(s => {
        const perGuest = s.guestIds.map(id => guestCapacity.get(id.toString()) ?? {
          seats: 1,
          luggage: 1
        });
        return {
          kind: s.kind,
          guestIds: s.guestIds.map(id => id.toString()),
          locationId: s.locationId ? s.locationId.toString() : null,
          coordinates: (0, _geo.toLatLng)(s.coordinates),
          label: s.label,
          seats: perGuest.reduce((sum, g) => sum + g.seats, 0),
          luggage: perGuest.reduce((sum, g) => sum + g.luggage, 0)
        };
      });
      const newPickup = {
        kind: 'pickup',
        guestIds: [],
        locationId: null,
        coordinates: entry.pickup,
        label: 'New pickup',
        seats: entry.seats,
        luggage: entry.luggage
      };
      const newDrop = {
        kind: 'drop',
        guestIds: [],
        locationId: null,
        coordinates: entry.dropoff,
        label: 'New drop',
        seats: entry.seats,
        luggage: entry.luggage
      };
      for (let i = 0; i <= pending.length && !exhausted(); i++) {
        for (let j = i; j <= pending.length && !exhausted(); j++) {
          evaluations++;
          if (budget) budget.remaining--;
          const candidate = insertAt(pending, i, newPickup, j, newDrop);
          if (!capacityHoldsThroughout(candidate, {
            seats: trip.vehicleSnapshot.seats,
            luggage: trip.vehicleSnapshot.luggage
          })) continue;
          const waypoints = [driverLoc, ...candidate.map(s => s.coordinates)];
          const route = await _RoutingService.RoutingService.route(waypoints);
          const originalWaypoints = [driverLoc, ...pending.map(s => s.coordinates)];
          const original = pending.length > 0 ? await _RoutingService.RoutingService.route(originalWaypoints) : {
            durationSeconds: 0
          };
          const addedMin = (route.durationSeconds - original.durationSeconds) / 60;
          if (addedMin > cfg.maxDetourMin) continue;
          if (breaksAnyExistingDeadline(route.durationSeconds, now, trip.deadlineAt ?? null)) continue;
          const pickupLegIndex = candidate.findIndex(s => s === newPickup);
          const pickupEtaSeconds = route.legs.slice(0, pickupLegIndex + 1).reduce((s, leg) => s + leg.durationSeconds, 0);
          const pickupEtaMin = pickupEtaSeconds / 60;
          const arrivalAt = new Date(now.getTime() + pickupEtaSeconds * 1000);
          const {
            total,
            breakdown
          } = _CostFunction.CostFunction.score(plainDriver, entry, {
            now,
            pickupEtaMin,
            arrivalAt,
            detourAddedMin: Math.max(0, addedMin)
          }, cfg);
          if (!best || total < best.cost) {
            best = {
              tripId: trip._id.toString(),
              driverId: driverDoc._id.toString(),
              stops: candidate,
              addedMinutes: addedMin,
              cost: total,
              breakdown
            };
          }
        }
      }
    }
    return best;
  }
};
exports.DetourInserter = DetourInserter;
