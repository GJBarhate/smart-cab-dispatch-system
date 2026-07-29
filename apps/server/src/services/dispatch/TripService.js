"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TripService = void 0;
var _mongoose = require("mongoose");
var _Trip = require("../../models/Trip");
var _Driver = require("../../models/Driver");
var _Guest = require("../../models/Guest");
var _QueueEntry = require("../../models/QueueEntry");
var _Counter = require("../../models/Counter");
var _errors = require("../../utils/errors");
var _geo = require("../../utils/geo");
// Trip lifecycle + the state machine (plan.md §6.2, §8.11). This is the ONLY
// module allowed to mutate `trip.status` — route handlers and the engine
// both go through here, so an invalid transition always surfaces as a 409
// instead of a silently corrupted trip.

// `unassignable` is reachable from the two not-yet-started states because the
// Reoptimizer re-queues a trip whose deadline is already unreachable before
// the driver has moved (plan.md §8.10 step 3b). It is NOT reachable once a
// guest has boarded — yanking a boarded guest is worse than being late.
const ALLOWED_TRANSITIONS = {
  pending_driver: ['accepted', 'rejected', 'cancelled', 'unassignable'],
  accepted: ['en_route_pickup', 'cancelled', 'unassignable'],
  en_route_pickup: ['at_pickup', 'cancelled'],
  at_pickup: ['boarded', 'cancelled'],
  boarded: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
  unassignable: ['pending_driver', 'cancelled']
};
const STATUS_TIMESTAMP_FIELD = {
  accepted: 'acceptedAt',
  rejected: 'rejectedAt',
  en_route_pickup: 'startedAt',
  completed: 'completedAt',
  cancelled: 'cancelledAt'
};
async function nextTripCode() {
  const seq = await (0, _Counter.nextSequence)('trip');
  return `T-${String(seq).padStart(4, '0')}`;
}
const TripService = {
  async transition(tripId, next, actor) {
    const trip = await _Trip.Trip.findById(tripId);
    if (!trip) throw new _errors.NotFoundError('Trip');
    const current = trip.status;
    if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
      throw new _errors.ConflictError(`Cannot transition trip from '${current}' to '${next}'`);
    }
    trip.status = next;
    const tsField = STATUS_TIMESTAMP_FIELD[next];
    if (tsField) trip[tsField] = new Date();
    trip.timeline.push({
      at: new Date(),
      type: `status:${next}`,
      actor,
      payload: {}
    });
    await trip.save();
    return trip;
  },
  /**
   * Atomically claims a driver for `tripId`. Returns false if someone else
   * beat us to it (§16.21/16.13). `currentTripId` must be set in this SAME
   * findOneAndUpdate as `status` — splitting it into a later, separate write
   * (as an earlier version of this function did) leaves a window where the
   * driver looks claimed (status: 'assigned') but currentTripId is still
   * null, so a second concurrent claim can slip through and double-assign
   * the driver. The caller must mint `tripId` before the Trip document
   * exists (`new Types.ObjectId()`) so it's available to claim with.
   */
  async claimDriver(driverId, tripId) {
    const result = await _Driver.Driver.findOneAndUpdate({
      _id: driverId,
      currentTripId: null
    }, {
      $set: {
        status: 'assigned',
        currentTripId: tripId
      }
    }, {
      new: true
    });
    return result !== null;
  },
  async createFromAssignment(input) {
    const tripId = new _mongoose.Types.ObjectId();
    const claimed = await TripService.claimDriver(input.driverId, tripId);
    if (!claimed) throw new _errors.ConflictError('Driver was assigned by another process');
    try {
      const code = await nextTripCode();
      const stops = input.stops.map((s, i) => ({
        seq: i,
        kind: s.kind,
        guestIds: s.guestIds,
        locationId: s.locationId,
        coordinates: (0, _geo.toGeoPoint)(s.coordinates),
        label: s.label,
        plannedAt: s.plannedAt ?? null,
        status: 'pending'
      }));
      const trip = await _Trip.Trip.create({
        _id: tripId,
        code,
        type: input.type,
        status: 'pending_driver',
        driverId: input.driverId,
        vehicleSnapshot: input.vehicleSnapshot,
        guests: input.guests,
        stops,
        capacityUsed: input.capacityUsed,
        deadlineAt: input.deadlineAt,
        assignmentMeta: {
          strategy: input.strategy,
          score: input.score,
          costBreakdown: input.costBreakdown,
          candidatesConsidered: input.candidatesConsidered,
          decidedAt: new Date(),
          decidedBy: input.decidedBy
        },
        groupSplitId: input.groupSplitId ?? null,
        sourceRequestId: input.sourceRequestId ?? null,
        offeredAt: new Date(),
        timeline: [{
          at: new Date(),
          type: 'created',
          actor: input.decidedBy,
          payload: {
            strategy: input.strategy
          }
        }]
      });
      const guestIds = input.guests.map(g => g.guestId);
      await _Guest.Guest.updateMany({
        _id: {
          $in: guestIds
        }
      }, {
        $set: {
          status: 'assigned',
          currentTripId: trip._id
        }
      });
      if (input.entryIds.length > 0) {
        await _QueueEntry.QueueEntry.updateMany({
          _id: {
            $in: input.entryIds
          }
        }, {
          $set: {
            status: 'assigned'
          }
        });
      }
      return trip;
    } catch (err) {
      // Trip creation failed after the driver was already claimed — release
      // them rather than leaving currentTripId pointing at a trip that was
      // never actually created.
      await TripService.releaseDriver(input.driverId);
      throw err;
    }
  },
  async requeueGuests(guestIds, _reason) {
    await _Guest.Guest.updateMany({
      _id: {
        $in: guestIds
      }
    }, {
      $set: {
        status: 'queued',
        currentTripId: null,
        waitingSince: new Date()
      }
    });
  },
  async releaseDriver(driverId) {
    await _Driver.Driver.updateOne({
      _id: driverId
    }, {
      $set: {
        currentTripId: null,
        status: 'idle'
      }
    });
  }
};
exports.TripService = TripService;
