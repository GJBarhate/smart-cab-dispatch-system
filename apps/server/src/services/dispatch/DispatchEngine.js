"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DispatchEngine = void 0;
var _EventConfig = require("../../models/EventConfig");
var _QueueEntry = require("../../models/QueueEntry");
var _RideRequest = require("../../models/RideRequest");
var _Trip = require("../../models/Trip");
var _logger = require("../../config/logger");
var _Guest = require("../../models/Guest");
var _geo = require("../../utils/geo");
var _time = require("../../utils/time");
var _shared = require("../../shared");
var _RoutingService = require("../routing/RoutingService");
var _NotificationService = require("../NotificationService");
var _AlertService = require("../AlertService");
var _config = require("./config");
var _TickLock = require("./TickLock");
var _DriverStateService = require("./DriverStateService");
var _Feasibility = require("./Feasibility");
var _CostFunction = require("./CostFunction");
var _BatchAssigner = require("./BatchAssigner");
var _Clusterer = require("./Clusterer");
var _GroupSplitter = require("./GroupSplitter");
var _DetourInserter = require("./DetourInserter");
var _GreedyMatcher = require("./GreedyMatcher");
var _TripService = require("./TripService");
var _types = require("./types");
// The dispatch tick orchestrator (plan.md §8.1/§8.2). Runs the three
// strategies in order — detour insertion (reuses a driver already moving,
// zero new deadhead), batch Hungarian (globally optimal for what's left),
// greedy (stragglers) — each cheaper and less disruptive than the next.

const SERVICE_TIME_MIN = 3;
const AVG_SPEED_KMPH = 30;
const ROAD_FACTOR = 1.4;
const GREEDY_SWEEP_CONCURRENCY = 10;
async function mapWithConcurrency(items, concurrency, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({
    length: Math.min(concurrency, items.length)
  }, () => worker()));
}
function roughTripMinutes(pickup, dropoff) {
  return (0, _geo.haversineKm)(pickup, dropoff) * ROAD_FACTOR / AVG_SPEED_KMPH * 60;
}
function toClusterableEntry(entry, now) {
  return {
    id: entry._id.toString(),
    type: entry.type,
    guestIds: entry.guestIds.map(id => id.toString()),
    seats: entry.seats,
    luggage: entry.luggage,
    pickup: (0, _geo.toLatLng)(entry.pickup.coordinates),
    pickupLocationId: entry.pickup.locationId ? entry.pickup.locationId.toString() : null,
    dropoff: (0, _geo.toLatLng)(entry.dropoff.coordinates),
    dropoffLocationId: entry.dropoff.locationId ? entry.dropoff.locationId.toString() : null,
    earliestAt: entry.earliestAt,
    deadlineAt: entry.deadlineAt,
    enqueuedAt: entry.enqueuedAt ?? now,
    priorityTier: entry.priorityTier,
    wasRejectedBefore: (entry.rejectedDriverIds ?? []).length > 0
  };
}
function demandFromSingleEntry(entry, now) {
  const e = toClusterableEntry(entry, now);
  return {
    id: e.id,
    type: e.type,
    seats: e.seats,
    luggage: e.luggage,
    priorityTier: e.priorityTier,
    waitedMinutes: Math.max(0, (0, _time.minutesBetween)(e.enqueuedAt, now)),
    earliestAt: e.earliestAt,
    deadlineAt: e.deadlineAt,
    pickup: e.pickup,
    dropoff: e.dropoff,
    wasRejectedBefore: e.wasRejectedBefore
  };
}
function demandFromCluster(id, cluster, seats, luggage, now) {
  return {
    id,
    type: cluster.type,
    seats,
    luggage,
    priorityTier: cluster.priorityTier,
    waitedMinutes: Math.max(0, (0, _time.minutesBetween)(cluster.enqueuedAt, now)),
    earliestAt: cluster.earliestAt,
    deadlineAt: cluster.deadlineAt,
    pickup: cluster.pickup,
    dropoff: cluster.dropoff,
    wasRejectedBefore: cluster.wasRejectedBefore
  };
}
function expandCluster(cluster, entryById, maxSeats, maxLuggage, now) {
  const members = cluster.memberEntryIds.map(id => {
    const e = entryById.get(id);
    return {
      id,
      guestIds: e.guestIds.map(g => g.toString()),
      seats: e.seats,
      luggage: e.luggage
    };
  });
  if (!_GroupSplitter.GroupSplitter.needsSplit(members, {
    maxSeats,
    maxLuggage
  })) {
    return [{
      demand: demandFromCluster(cluster.memberEntryIds[0], cluster, cluster.seats, cluster.luggage, now),
      sourceEntryIds: cluster.memberEntryIds,
      groupSplitId: null
    }];
  }
  const chunks = _GroupSplitter.GroupSplitter.split(members, {
    maxSeats,
    maxLuggage
  });
  return chunks.map((chunk, i) => ({
    demand: demandFromCluster(`${cluster.memberEntryIds[0]}#chunk${i}`, cluster, chunk.seats, chunk.luggage, now),
    sourceEntryIds: Array.from(new Set(chunk.memberIds.map(mid => mid.split('#')[0]))),
    groupSplitId: chunk.groupSplitId
  }));
}
async function expireStaleOffers(offerTimeoutSec, now) {
  const cutoff = new Date(now.getTime() - offerTimeoutSec * 1000);
  const stale = await _Trip.Trip.find({
    status: 'pending_driver',
    offeredAt: {
      $lt: cutoff
    }
  });
  for (const trip of stale) {
    const guestIds = trip.guests.map(g => g.guestId.toString());
    await _TripService.TripService.requeueGuests(guestIds, 'offer_expired');
    if (trip.driverId) await _TripService.TripService.releaseDriver(trip.driverId.toString());
    // Through the state machine, not a raw updateOne — TripService is the
    // single authority on trip.status (plan.md §6.2). It stamps rejectedAt.
    const rejected = await _TripService.TripService.transition(trip._id.toString(), 'rejected', 'engine:offer_expired');
    rejected.rejectionReason = 'offer_expired';
    await rejected.save();
  }
}
function raiseAlert(level, code, message) {
  _AlertService.AlertService.raise(level, code, message).catch(() => {
    // Best-effort — an alert failing to persist must never abort a tick.
  });
}

/**
 * Retires demand that no driver could ever serve in time.
 *
 * `Feasibility.check()` rejects a pair when the earliest possible arrival
 * exceeds `deadlineAt + grace`. Once `now` alone is past that point the check
 * fails for *every* driver, no matter how close or idle — the entry is
 * unmatchable by arithmetic, not by supply. Left alone it stays `waiting`
 * forever: each tick re-reads it, spends a `DetourInserter` routing call per
 * active trip on it, logs another `no_feasible_driver`, and leaves the queue
 * monitor permanently red. Observed in practice at 25+ attempts per entry,
 * which is also what exhausted the routing providers' rate limits.
 *
 * The cutoff deliberately uses zero pickup ETA — the most generous possible
 * driver — so only provably impossible entries are retired here. Anything that
 * a nearby driver could still make stays in the queue.
 *
 * Guests are returned to `REGISTERED` rather than left stranded: the arrival
 * sweep then re-enqueues them with a fresh, achievable window (§3.1). That
 * turns a permanent dead end into a ~45-minute retry cycle with an alert on
 * each pass, which is visible to ops instead of silent.
 */
async function retireExpiredDemand(cfg, now) {
  const cutoff = new Date(now.getTime() - cfg.deadlineGraceMin * 60_000);
  const doomed = await _QueueEntry.QueueEntry.find({
    status: 'waiting',
    deadlineAt: {
      $lt: cutoff
    }
  }).select('guestIds').lean();
  if (doomed.length === 0) return 0;
  const ids = doomed.map(e => e._id);
  const guestIds = doomed.flatMap(e => e.guestIds ?? []);
  await _QueueEntry.QueueEntry.updateMany({
    _id: {
      $in: ids
    }
  }, {
    $set: {
      status: 'failed',
      lastFailureReason: 'deadline_expired',
      lastAttemptAt: now
    }
  });
  if (guestIds.length > 0) {
    // Only guests with no trip in flight — a guest already riding must keep
    // their status, and their stale entry is just bookkeeping.
    await _Guest.Guest.updateMany({
      _id: {
        $in: guestIds
      },
      currentTripId: null
    }, {
      $set: {
        status: _shared.GuestStatus.REGISTERED
      },
      $unset: {
        waitingSince: 1
      }
    });
  }
  raiseAlert('warning', 'DEADLINE_EXPIRED', `${doomed.length} demand(s) passed their deadline unmatched and were requeued for a fresh window`);
  return doomed.length;
}
async function buildGuestLineItems(guestIds) {
  const guests = await _Guest.Guest.find({
    _id: {
      $in: guestIds
    }
  }).select('name groupSize luggageCount').lean();
  return guests.map(g => ({
    guestId: g._id.toString(),
    name: g.name,
    seats: g.groupSize,
    luggage: g.luggageCount
  }));
}
async function commitAssignment(driverDoc, demand, pending, strategy, score, breakdown, candidatesConsidered) {
  const entryDocs = await _QueueEntry.QueueEntry.find({
    _id: {
      $in: pending.sourceEntryIds
    }
  }).lean();
  const guestIds = entryDocs.flatMap(e => e.guestIds.map(g => g.toString()));
  const guests = await buildGuestLineItems(guestIds);
  // An entry raised by an on-demand request carries the request it came from.
  // Only the admin-approval path used to close that loop, and only when it
  // matched a driver on the spot — so a request the engine placed a tick or two
  // later stayed `approved` for ever, leaving the guest watching "Finding your
  // driver…" while their driver was already assigned.
  const sourceRequestId = entryDocs.find(e => e.sourceRequestId)?.sourceRequestId ?? null;
  const trip = await _TripService.TripService.createFromAssignment({
    type: demand.type,
    driverId: driverDoc._id.toString(),
    entryIds: pending.sourceEntryIds,
    guests,
    stops: [{
      kind: 'pickup',
      guestIds,
      locationId: null,
      coordinates: demand.pickup,
      label: 'Pickup'
    }, {
      kind: 'drop',
      guestIds,
      locationId: null,
      coordinates: demand.dropoff,
      label: 'Drop-off'
    }],
    vehicleSnapshot: {
      number: driverDoc.vehicle.number,
      model: driverDoc.vehicle.model,
      seats: driverDoc.capacity.seats,
      luggage: driverDoc.capacity.luggage
    },
    capacityUsed: {
      seats: demand.seats,
      luggage: demand.luggage
    },
    deadlineAt: demand.deadlineAt,
    strategy,
    score,
    costBreakdown: breakdown,
    candidatesConsidered,
    decidedBy: 'engine',
    groupSplitId: pending.groupSplitId,
    sourceRequestId
  });
  if (sourceRequestId) {
    await _RideRequest.RideRequest.updateOne({
      _id: sourceRequestId,
      status: {
        $in: ['approved', 'pending_approval']
      }
    }, {
      $set: {
        status: 'matched',
        tripId: trip._id
      }
    });
    const requestDoc = await _RideRequest.RideRequest.findById(sourceRequestId).select('guestId').lean();
    if (requestDoc) {
      _NotificationService.NotificationService.requestStatus(requestDoc.guestId.toString(), {
        requestId: sourceRequestId.toString(),
        status: 'matched'
      });
    }
  }
  _NotificationService.NotificationService.tripOffered(driverDoc._id.toString(), {
    trip: trip.toJSON()
  });
}
/**
 * Folds a waiting entry into a trip already on the road. Returns false when the
 * entry was not ours to place, so the caller does not count it as matched.
 *
 * The entry is claimed atomically up front. The tick lock is held for 25s while
 * the cron fires every 30s, so a tick that runs long overlaps the next one —
 * both then read the same entry as `waiting`, and appending on both passes put
 * the same passenger on a trip twice and double-counted their seats against the
 * vehicle. Seen on a live trip whose manifest read "Krishna Iyer, Krishna Iyer"
 * with capacity charged for both.
 */
async function insertDetour(entry, insertion, now) {
  const claimed = await _QueueEntry.QueueEntry.findOneAndUpdate({
    _id: entry._id,
    status: 'waiting'
  }, {
    $set: {
      status: 'assigned'
    }
  });
  if (!claimed) return false;
  const trip = await _Trip.Trip.findById(insertion.tripId);
  if (!trip) {
    // Put it back rather than stranding it as `assigned` against a trip that
    // no longer exists — nothing reads `assigned` entries as demand.
    await _QueueEntry.QueueEntry.updateOne({
      _id: entry._id
    }, {
      $set: {
        status: 'waiting'
      }
    });
    return false;
  }
  trip.stops = insertion.stops.map((s, i) => ({
    seq: i,
    kind: s.kind,
    guestIds: s.guestIds,
    locationId: s.locationId,
    coordinates: (0, _geo.toGeoPoint)(s.coordinates),
    label: s.label,
    plannedAt: null,
    etaAt: null,
    actualAt: null,
    status: 'pending'
  }));
  // Second line of defence behind the claim above: never list a guest on the
  // same trip twice, whatever route got us here.
  const alreadyAboard = new Set(trip.guests.map(g => g.guestId.toString()));
  const boarding = (await buildGuestLineItems(entry.guestIds.map(g => g.toString()))).filter(g => !alreadyAboard.has(g.guestId.toString()));
  if (boarding.length === 0) return false;
  // Charged from the entry, not the guest line items: for an on-demand ride the
  // entry carries the seats actually requested, which need not equal the
  // guest's default party size.
  trip.capacityUsed = {
    seats: (trip.capacityUsed?.seats ?? 0) + entry.seats,
    luggage: (trip.capacityUsed?.luggage ?? 0) + entry.luggage
  };
  trip.guests.push(...boarding.map(g => ({
    guestId: g.guestId,
    name: g.name,
    seats: g.seats,
    luggage: g.luggage,
    boardedAt: null,
    droppedAt: null,
    pickupStopSeq: null,
    dropStopSeq: null
  })));
  trip.timeline.push({
    at: now,
    type: 'detour_insert',
    actor: 'engine',
    payload: {
      entryId: entry._id.toString(),
      addedMinutes: insertion.addedMinutes
    }
  });
  await trip.save();
  await _Guest.Guest.updateMany({
    _id: {
      $in: entry.guestIds
    }
  }, {
    $set: {
      status: 'assigned',
      currentTripId: trip._id
    }
  });
  return true;
}
const DispatchEngine = {
  async tick() {
    const t0 = Date.now();
    const now = new Date();
    const cfgDoc = await _EventConfig.EventConfig.findOne({
      singleton: 'singleton'
    });
    if (!cfgDoc) return {
      matched: 0,
      unassignable: 0,
      durationMs: Date.now() - t0,
      skipped: 'no_event_config'
    };
    if (!cfgDoc.featureFlags.autoDispatchEnabled) {
      return {
        matched: 0,
        unassignable: 0,
        durationMs: Date.now() - t0,
        skipped: 'disabled'
      };
    }
    const cfg = (0, _config.toDispatchConfig)(cfgDoc);
    const gotLock = await (0, _TickLock.acquireTickLock)(25_000);
    if (!gotLock) return {
      matched: 0,
      unassignable: 0,
      durationMs: Date.now() - t0,
      skipped: 'locked'
    };
    try {
      await _DriverStateService.DriverStateService.refreshPredictedFreeState();
      await expireStaleOffers(cfg.offerTimeoutSec, now);
      await retireExpiredDemand(cfg, now);
      const horizonAt = new Date(now.getTime() + cfg.batchHorizonMin * 60_000);
      const entryDocs = await _QueueEntry.QueueEntry.find({
        status: 'waiting',
        earliestAt: {
          $lte: horizonAt
        },
        $or: [{
          lockedUntil: null
        }, {
          lockedUntil: {
            $lt: now
          }
        }]
      }).sort({
        priorityScore: -1
      }).limit(200);
      if (entryDocs.length === 0) return {
        matched: 0,
        unassignable: 0,
        durationMs: Date.now() - t0
      };
      let matched = 0;
      const stillWaiting = [];

      // --- 1. Detour insertion first (cheapest — zero new deadhead) ---
      if (cfgDoc.featureFlags.detourEnabled) {
        // One allowance shared by every entry in this tick. Without it the
        // per-call cap multiplies by queue depth, and a 12-entry queue can
        // issue thousands of routing round trips in a single tick.
        const detourBudget = (0, _DetourInserter.createEvaluationBudget)();
        for (const entry of entryDocs) {
          const demand = demandFromSingleEntry(entry, now);
          const insertion = await _DetourInserter.DetourInserter.findBest(demand, cfg, now, detourBudget);
          if (!insertion) {
            stillWaiting.push(entry);
            continue;
          }
          try {
            // A false return means another pass already claimed this entry —
            // it is placed, just not by us, so it is neither matched here nor
            // pushed back into this tick's waiting list.
            if (await insertDetour(entry, insertion, now)) matched++;
          } catch (err) {
            // Most likely a Mongoose VersionError: the driver accepted/
            // arrived/boarded/dropped this same trip between findBest()
            // scoring it and this save (optimistic concurrency, not a bug
            // to prevent with heavier locking — just retry via the next
            // tick or another matching path).
            void err;
            stillWaiting.push(entry);
          }
        }
      } else {
        stillWaiting.push(...entryDocs);
      }
      if (stillWaiting.length === 0) return {
        matched,
        unassignable: 0,
        durationMs: Date.now() - t0
      };

      // --- 2. Supply ---
      const eligible = await _DriverStateService.DriverStateService.listEligibleDrivers(cfg, now);
      if (eligible.length === 0) {
        raiseAlert('warning', 'NO_SUPPLY', `${stillWaiting.length} demand(s) waiting with no eligible driver`);
        return {
          matched,
          unassignable: stillWaiting.length,
          durationMs: Date.now() - t0,
          skipped: 'no_supply'
        };
      }
      const maxFleetSeats = Math.max(...eligible.map(e => e.plain.capacitySeats));
      const maxFleetLuggage = Math.max(...eligible.map(e => e.plain.capacityLuggage));

      // --- 3. Cluster the remainder into shared rides ---
      const entryById = new Map(stillWaiting.map(e => [e._id.toString(), e]));
      const clusterableEntries = stillWaiting.map(e => toClusterableEntry(e, now));
      const clusters = _Clusterer.Clusterer.build(clusterableEntries, {
        maxSharedGuestsPerTrip: cfg.maxSharedGuestsPerTrip,
        clusterRadiusM: cfg.clusterRadiusM,
        clusterTimeWindowMin: cfg.clusterTimeWindowMin,
        maxVehicleSeats: maxFleetSeats,
        maxVehicleLuggage: maxFleetLuggage
      }, now);

      // --- 4. Split any cluster larger than the biggest available vehicle ---
      const pendingDemands = clusters.flatMap(c => expandCluster(c, entryById, maxFleetSeats, maxFleetLuggage, now));

      // --- 5. One matrix call: driver predicted-free positions -> demand pickups ---
      const {
        durations
      } = await _RoutingService.RoutingService.matrix(eligible.map(e => e.plain.predictedFreeLocation), pendingDemands.map(p => p.demand.pickup));

      // --- 6. Cost matrix with hard feasibility mask ---
      const cost = eligible.map((driver, i) => pendingDemands.map((p, j) => {
        const pickupEtaMin = (durations[i]?.[j] ?? Infinity) / 60;
        const estimatedTripEndAt = new Date(now.getTime() + (pickupEtaMin + SERVICE_TIME_MIN + roughTripMinutes(p.demand.pickup, p.demand.dropoff)) * 60_000);
        const feasibility = _Feasibility.Feasibility.check(driver.plain, p.demand, {
          now,
          pickupEtaMin,
          estimatedTripEndAt
        }, cfg);
        if (!feasibility.ok) return _types.BIG_M;
        const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
        return _CostFunction.CostFunction.score(driver.plain, p.demand, {
          now,
          pickupEtaMin,
          arrivalAt
        }, cfg).total;
      }));

      // --- 7. Hungarian ---
      const pairs = _BatchAssigner.BatchAssigner.solve(cost);
      const resolvedEntryIds = new Set();

      // Each pair touches a distinct driver (Hungarian never reuses a row), so
      // these commits are independent and safe to run concurrently — trip codes
      // come from an atomic counter (Counter.nextSequence) and driver claims are
      // an atomic findOneAndUpdate. Running them concurrently avoids the
      // sequential-Atlas-round-trip cost (dozens of commits at 100-300ms each
      // adds up to a very slow tick otherwise).
      const feasiblePairs = pairs.filter(({
        driverIndex,
        demandIndex
      }) => cost[driverIndex][demandIndex] < _types.BIG_M);
      await mapWithConcurrency(feasiblePairs, GREEDY_SWEEP_CONCURRENCY, async ({
        driverIndex,
        demandIndex
      }) => {
        const driver = eligible[driverIndex];
        const pending = pendingDemands[demandIndex];
        const pickupEtaMin = (durations[driverIndex]?.[demandIndex] ?? 0) / 60;
        const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
        const {
          total,
          breakdown
        } = _CostFunction.CostFunction.score(driver.plain, pending.demand, {
          now,
          pickupEtaMin,
          arrivalAt
        }, cfg);
        try {
          await commitAssignment(driver.doc, pending.demand, pending, 'batch_hungarian', total, breakdown, pendingDemands.length);
          matched++;
          pending.sourceEntryIds.forEach(id => resolvedEntryIds.add(id));
        } catch (err) {
          // Hungarian guarantees each row in *this batch* is a distinct driver,
          // but not that the driver is still free at commit time. The
          // starvation sweep, an admin approval, a detour insertion earlier in
          // this same tick, or an overlapping tick can all claim one between
          // scoring and commit; claimDriver is an atomic findOneAndUpdate, so
          // the loser gets a 409.
          //
          // That conflict must fail this one pair, not the whole tick. Letting
          // it propagate out of mapWithConcurrency rejects the Promise.all and
          // aborts the entire dispatch round, discarding every other
          // assignment in the batch — seen in the logs as a `scheduled job
          // failed / Driver was assigned by another process` ERROR.
          //
          // Deliberately left out of resolvedEntryIds so the greedy sweep
          // below retries it this same tick against a freshly queried driver
          // list, rather than waiting for the next one.
          void err;
        }
      });

      // --- 8. Greedy sweep for anything still unmatched ---
      // Each demand's Driver.find + matrix + commit is independent of the
      // others, so this runs with bounded concurrency rather than fully
      // sequentially — with dozens of leftover demands after a burst, doing
      // this one at a time turned a single tick into a multi-minute stall
      // (each iteration pays a real Atlas round trip). TripService.claimDriver
      // is still an atomic findOneAndUpdate, so concurrent iterations can
      // never double-assign a driver — a lost race just fails that one
      // demand's commit, which is caught below and simply retried next tick.
      const stillUnmatched = pendingDemands.filter(p => !p.sourceEntryIds.every(id => resolvedEntryIds.has(id)));
      let unassignable = 0;
      await mapWithConcurrency(stillUnmatched, GREEDY_SWEEP_CONCURRENCY, async pending => {
        try {
          const result = await _GreedyMatcher.GreedyMatcher.findBest(pending.demand, cfg, now);
          if (result) {
            await commitAssignment(result.driver, pending.demand, pending, 'greedy_realtime', result.score, result.breakdown, 1);
            matched++;
            pending.sourceEntryIds.forEach(id => resolvedEntryIds.add(id));
            return;
          }
        } catch (err) {
          // Most likely a claimDriver race lost to a concurrent iteration —
          // treat it the same as "no feasible driver this tick".
          void err;
        }
        unassignable++;
        await _QueueEntry.QueueEntry.updateMany({
          _id: {
            $in: pending.sourceEntryIds
          }
        }, {
          $inc: {
            attempts: 1
          },
          $set: {
            lastAttemptAt: now,
            lastFailureReason: 'no_feasible_driver'
          }
        });
      });
      if (unassignable > 0) {
        raiseAlert('warning', 'UNASSIGNABLE', `${unassignable} demand(s) could not be matched this tick`);
      }
      _NotificationService.NotificationService.dispatchTick({
        matched,
        unassignable,
        durationMs: Date.now() - t0,
        at: now.toISOString()
      });
      return {
        matched,
        unassignable,
        durationMs: Date.now() - t0
      };
    } finally {
      await (0, _TickLock.releaseTickLock)();
    }
  },
  /**
   * Matches one waiting QueueEntry right now via GreedyMatcher, bypassing the
   * tick's batch/cluster machinery entirely. Used by the starvation sweep
   * (plan.md §8.4 hard pre-emption rule) and by admin-approval / driver-
   * rejection flows that must not wait for the next tick (§8.7).
   */
  async matchEntryNow(entryId, strategy = 'greedy_realtime') {
    const cfgDoc = await _EventConfig.EventConfig.findOne({
      singleton: 'singleton'
    });
    if (!cfgDoc) return false;
    const entry = await _QueueEntry.QueueEntry.findById(entryId);
    if (!entry || entry.status !== 'waiting') return false;
    const cfg = (0, _config.toDispatchConfig)(cfgDoc);
    const now = new Date();
    const demand = demandFromSingleEntry(entry, now);
    const result = await _GreedyMatcher.GreedyMatcher.findBest(demand, cfg, now);
    if (!result) return false;
    try {
      await commitAssignment(result.driver, demand, {
        demand,
        sourceEntryIds: [entry._id.toString()],
        groupSplitId: null
      }, strategy, result.score, result.breakdown, 1);
    } catch (err) {
      // `claimDriver` is an atomic findOneAndUpdate, so a concurrent tick, the
      // starvation sweep, or another approval can take this driver between
      // findBest() scoring them and this commit. Losing that race means "not
      // matched right now", not a failure of the caller's request: the entry is
      // still `waiting` and the next tick assigns it.
      //
      // Letting it propagate surfaced a raw 409 "Driver was assigned by another
      // process" on the admin's Approve button, even though the approval itself
      // had already succeeded and the demand was safely queued.
      //
      // Logged rather than discarded: swallowing this silently turns any other
      // commit failure into an unexplained "not matched", which is very hard to
      // tell apart from a genuine lack of supply.
      _logger.logger.warn({
        err: err instanceof Error ? err.message : String(err),
        entryId,
        driverId: result.driver._id.toString()
      }, 'matchEntryNow could not commit the assignment');
      return false;
    }
    return true;
  },
  /**
   * Dry run of steps 2-7 of tick() — clusters demand, builds the real cost
   * matrix, and solves it, but commits nothing. Powers the admin Dispatch
   * Console's "Preview batch" heatmap (plan.md §9.5, §12.2).
   */
  async previewBatch() {
    const cfgDoc = await _EventConfig.EventConfig.findOne({
      singleton: 'singleton'
    });
    if (!cfgDoc) return {
      drivers: [],
      demands: [],
      costMatrix: [],
      chosenPairs: []
    };
    const cfg = (0, _config.toDispatchConfig)(cfgDoc);
    const now = new Date();
    const entryDocs = await _QueueEntry.QueueEntry.find({
      status: 'waiting'
    }).sort({
      priorityScore: -1
    }).limit(200);
    const eligible = await _DriverStateService.DriverStateService.listEligibleDrivers(cfg, now);
    if (entryDocs.length === 0 || eligible.length === 0) {
      return {
        drivers: eligible.map(e => ({
          id: e.plain.id,
          name: e.doc.name
        })),
        demands: [],
        costMatrix: [],
        chosenPairs: []
      };
    }
    const maxFleetSeats = Math.max(...eligible.map(e => e.plain.capacitySeats));
    const maxFleetLuggage = Math.max(...eligible.map(e => e.plain.capacityLuggage));
    const entryById = new Map(entryDocs.map(e => [e._id.toString(), e]));
    const clusterableEntries = entryDocs.map(e => toClusterableEntry(e, now));
    const clusters = _Clusterer.Clusterer.build(clusterableEntries, {
      maxSharedGuestsPerTrip: cfg.maxSharedGuestsPerTrip,
      clusterRadiusM: cfg.clusterRadiusM,
      clusterTimeWindowMin: cfg.clusterTimeWindowMin,
      maxVehicleSeats: maxFleetSeats,
      maxVehicleLuggage: maxFleetLuggage
    }, now);
    const pendingDemands = clusters.flatMap(c => expandCluster(c, entryById, maxFleetSeats, maxFleetLuggage, now));
    const {
      durations
    } = await _RoutingService.RoutingService.matrix(eligible.map(e => e.plain.predictedFreeLocation), pendingDemands.map(p => p.demand.pickup));
    const costMatrix = eligible.map((driver, i) => pendingDemands.map((p, j) => {
      const pickupEtaMin = (durations[i]?.[j] ?? Infinity) / 60;
      const estimatedTripEndAt = new Date(now.getTime() + (pickupEtaMin + SERVICE_TIME_MIN + roughTripMinutes(p.demand.pickup, p.demand.dropoff)) * 60_000);
      const feasibility = _Feasibility.Feasibility.check(driver.plain, p.demand, {
        now,
        pickupEtaMin,
        estimatedTripEndAt
      }, cfg);
      if (!feasibility.ok) return _types.BIG_M;
      const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
      return _CostFunction.CostFunction.score(driver.plain, p.demand, {
        now,
        pickupEtaMin,
        arrivalAt
      }, cfg).total;
    }));
    const pairs = _BatchAssigner.BatchAssigner.solve(costMatrix);
    const chosenPairs = pairs.map(({
      driverIndex,
      demandIndex
    }) => {
      const pickupEtaMin = (durations[driverIndex]?.[demandIndex] ?? 0) / 60;
      const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
      const {
        total,
        breakdown
      } = _CostFunction.CostFunction.score(eligible[driverIndex].plain, pendingDemands[demandIndex].demand, {
        now,
        pickupEtaMin,
        arrivalAt
      }, cfg);
      return {
        driverIndex,
        demandIndex,
        cost: total,
        breakdown
      };
    });
    return {
      drivers: eligible.map(e => ({
        id: e.plain.id,
        name: e.doc.name
      })),
      demands: pendingDemands.map(p => ({
        id: p.demand.id,
        guestIds: p.sourceEntryIds,
        seats: p.demand.seats,
        luggage: p.demand.luggage
      })),
      costMatrix,
      chosenPairs
    };
  }
};
exports.DispatchEngine = DispatchEngine;

// Exported for tests only. The guard inside is a concurrency property — two
// overlapping ticks racing on one entry — which cannot be provoked through
// tick() without standing up a live routing fixture to make a detour viable.
exports.__insertDetour = insertDetour;
