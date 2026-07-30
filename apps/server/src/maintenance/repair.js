"use strict";

// Idempotent repair for an already-seeded database.
//
// The seed builds a coherent world anchored to the day it runs. Left running
// past that day the world goes stale in ways the app cannot recover from on its
// own, and the symptom is always the same: bookings reach the Approval Inbox,
// approving them produces no trip, and the alert panel fills with
// "unassignable". Re-seeding would fix it by destroying every real booking, so
// this repairs in place instead.
//
//   node src/maintenance/repair.js [--close-stale-trips] [--dry-run]
//
// Safe by default. `--close-stale-trips` additionally cancels trips stranded
// long past their deadline, which requeues their guests and frees their
// drivers — a real mutation of live trip state, so it is opt-in.

require('dotenv').config();
var _mongoose = require("mongoose");
var _Driver = require("../models/Driver");
var _Trip = require("../models/Trip");
var _Alert = require("../models/Alert");
var _EventConfig = require("../models/EventConfig");
var _Guest = require("../models/Guest");
var _QueueEntry = require("../models/QueueEntry");
var _TripService = require("../services/dispatch/TripService");
var _env = require("../config/env");

const STALE_TRIP_GRACE_HOURS = 6;
const FALLBACK_SHIFT_DAYS = 7;
// Mirrors ACTIVE_TRIP_STATUSES in routes/guest.routes.js.
const ACTIVE_TRIP_STATUSES = ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup', 'boarded'];

const args = process.argv.slice(2);
const shouldCloseStaleTrips = args.includes('--close-stale-trips');
const dryRun = args.includes('--dry-run');

function log(...parts) {
  console.log(...parts);
}

/**
 * Drivers whose shift already ended are hard-rejected by Feasibility for every
 * demand, so an expired roster silently zeroes out dispatch capacity while the
 * fleet still reads `idle` in the UI. Roll them to the end of the event window
 * the EventConfig defines; if the event itself is over, take a week from now so
 * the deployment is usable while the operator decides on real dates.
 */
async function rollExpiredShifts(now) {
  const cfg = await _EventConfig.EventConfig.findOne({ singleton: 'singleton' }).lean();
  const eventEnd = cfg?.endAt ? new Date(cfg.endAt) : null;
  const target = eventEnd && eventEnd.getTime() > now.getTime()
    ? eventEnd
    : new Date(now.getTime() + FALLBACK_SHIFT_DAYS * 24 * 60 * 60_000);

  const expired = await _Driver.Driver.find({
    isActive: true,
    'shift.endAt': { $ne: null, $lte: now }
  }).select('name shift').lean();

  if (expired.length === 0) {
    log(`shifts        : ok — no expired shifts`);
    return 0;
  }
  log(`shifts        : ${expired.length} driver(s) past shift end -> ${target.toISOString()}`);
  expired.forEach(d => log(`                - ${d.name} (ended ${new Date(d.shift.endAt).toISOString()})`));
  if (dryRun) return expired.length;

  await _Driver.Driver.updateMany(
    { _id: { $in: expired.map(d => d._id) } },
    { $set: { 'shift.endAt': target } }
  );
  // A shift that had not started yet would leave the driver unavailable for a
  // different reason, so pull any future start back to now.
  await _Driver.Driver.updateMany(
    { _id: { $in: expired.map(d => d._id) }, 'shift.startAt': { $gt: now } },
    { $set: { 'shift.startAt': now } }
  );
  return expired.length;
}

/**
 * `claimDriver` only claims a driver whose `currentTripId` is null, so a driver
 * still pointing at a finished trip is invisible to dispatch forever — while
 * showing up as available everywhere in the UI.
 */
async function clearDanglingTripPointers() {
  const holding = await _Driver.Driver.find({ currentTripId: { $ne: null } })
    .select('name status currentTripId').lean();
  const stale = [];
  for (const d of holding) {
    const trip = await _Trip.Trip.findById(d.currentTripId).select('code status').lean();
    if (!trip || ['completed', 'cancelled', 'rejected', 'unassignable'].includes(trip.status)) {
      stale.push({ driver: d, trip });
    }
  }
  if (stale.length === 0) {
    log(`trip pointers : ok — no dangling currentTripId`);
    return 0;
  }
  log(`trip pointers : ${stale.length} driver(s) pinned to a finished trip`);
  stale.forEach(({ driver, trip }) =>
    log(`                - ${driver.name} -> ${trip ? `${trip.code} (${trip.status})` : 'missing trip'}`));
  if (dryRun) return stale.length;

  for (const { driver } of stale) {
    await _TripService.TripService.releaseDriver(driver._id.toString());
  }
  return stale.length;
}

/**
 * Before alerts were deduped, every tick inserted another row for the same
 * condition. Collapse each open (code, entity) group down to its newest row and
 * carry the suppressed count onto the survivor, so the panel becomes readable
 * without losing the fact that the condition repeated.
 */
async function foldDuplicateAlerts() {
  const groups = await _Alert.Alert.aggregate([
    { $match: { acknowledged: false } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: { code: '$code', entityId: '$entity.id' },
        keep: { $first: '$_id' },
        ids: { $push: '$_id' },
        total: { $sum: 1 }
      }
    },
    { $match: { total: { $gt: 1 } } }
  ]);
  if (groups.length === 0) {
    log(`alerts        : ok — no duplicate open alerts`);
    return 0;
  }
  const duplicates = groups.reduce((sum, g) => sum + (g.total - 1), 0);
  log(`alerts        : folding ${duplicates} duplicate(s) across ${groups.length} condition(s)`);
  groups.forEach(g => log(`                - ${g._id.code}${g._id.entityId ? ` [${g._id.entityId}]` : ''}: ${g.total} rows -> 1`));
  if (dryRun) return duplicates;

  for (const g of groups) {
    const drop = g.ids.filter(id => String(id) !== String(g.keep));
    await _Alert.Alert.updateOne({ _id: g.keep }, { $set: { occurrences: g.total } });
    await _Alert.Alert.updateMany(
      { _id: { $in: drop } },
      { $set: { acknowledged: true, acknowledgedAt: new Date() } }
    );
  }
  return duplicates;
}

/**
 * Realigns a guest's status with the trip they are actually on.
 *
 * The trip is authoritative — it is what the driver app drives. A guest whose
 * status drifts away from it shows up wrong in Guest Management and the
 * dashboard counts, and a guest left at `registered` mid-trip is worse than
 * cosmetic: that is the status the arrival sweep enqueues from, so it can raise
 * fresh demand for someone who already has a driver.
 */
async function reconcileGuestStatuses() {
  const trips = await _Trip.Trip.find({ status: { $in: ACTIVE_TRIP_STATUSES } })
    .select('code status guests groupSplitId').lean();
  const fixes = [];
  const seen = new Set();
  for (const t of trips) {
    // Before boarding the guest is `assigned`; once the driver marks them
    // boarded the driver app moves them to `in_transit`.
    const expected = t.status === 'boarded' ? 'in_transit' : 'assigned';
    for (const line of t.guests) {
      const guest = await _Guest.Guest.findById(line.guestId).select('name status currentTripId').lean();
      if (!guest) continue;
      // A split group legitimately rides two vehicles under one guest record,
      // so `currentTripId` can only ever name one of its legs. Judge those on
      // status alone, and only once.
      const isSplitLeg = !!t.groupSplitId;
      const key = String(guest._id);
      if (isSplitLeg && seen.has(key)) continue;
      seen.add(key);
      const pointerWrong = !isSplitLeg && String(guest.currentTripId) !== String(t._id);
      if (guest.status !== expected || pointerWrong) {
        fixes.push({ guest, tripId: t._id, code: t.code, tripStatus: t.status, expected, isSplitLeg });
      }
    }
  }
  if (fixes.length === 0) {
    log(`guest status  : ok — every guest agrees with their live trip`);
    return 0;
  }
  log(`guest status  : ${fixes.length} guest(s) out of step with their live trip`);
  fixes.forEach(f => log(`                - ${f.guest.name} on ${f.code} (${f.tripStatus}): '${f.guest.status}' -> '${f.expected}'`));
  if (dryRun) return fixes.length;

  for (const f of fixes) {
    const set = { status: f.expected };
    // Leave a split group's pointer alone — either leg is equally valid.
    if (!f.isSplitLeg) set.currentTripId = f.tripId;
    await _Guest.Guest.updateOne({ _id: f.guest._id }, { $set: set });
  }
  return fixes.length;
}

/**
 * Removes a guest listed more than once on the same trip and recharges the
 * vehicle's capacity to match the corrected manifest.
 *
 * Detour insertion had no idempotency guard, so an entry processed by two
 * overlapping ticks appended its guests twice — leaving manifests that read
 * "Krishna Iyer, Krishna Iyer" and seats charged for a passenger who does not
 * exist, which in turn made the vehicle look full to Feasibility.
 */
async function dedupeTripManifests() {
  const trips = await _Trip.Trip.find({ status: { $in: ACTIVE_TRIP_STATUSES } })
    .select('code status guests capacityUsed');
  const fixed = [];
  for (const t of trips) {
    const seen = new Set();
    const unique = [];
    const dupes = [];
    for (const g of t.guests) {
      const k = g.guestId.toString();
      if (seen.has(k)) dupes.push(g);
      else {
        seen.add(k);
        unique.push(g);
      }
    }
    if (dupes.length === 0) continue;
    // Subtract exactly what the duplicate lines added rather than recomputing
    // the total from the manifest: an on-demand ride is charged the seats its
    // request asked for, which need not equal the sum of the guests' party
    // sizes, so a wholesale recompute would quietly rewrite correct figures.
    fixed.push({
      code: t.code,
      removed: dupes.length,
      seatsBefore: t.capacityUsed?.seats ?? 0,
      seatsAfter: Math.max(0, (t.capacityUsed?.seats ?? 0) - dupes.reduce((n, g) => n + (g.seats ?? 0), 0)),
      luggageAfter: Math.max(0, (t.capacityUsed?.luggage ?? 0) - dupes.reduce((n, g) => n + (g.luggage ?? 0), 0)),
      trip: t,
      unique
    });
  }
  if (fixed.length === 0) {
    log(`manifests     : ok — no guest listed twice on a trip`);
    return 0;
  }
  log(`manifests     : ${fixed.length} trip(s) listing a guest more than once`);
  fixed.forEach(f => log(`                - ${f.code}: removed ${f.removed} duplicate line(s), seats ${f.seatsBefore} -> ${f.seatsAfter}`));
  if (dryRun) return fixed.length;

  for (const f of fixed) {
    f.trip.guests = f.unique;
    f.trip.capacityUsed = {
      seats: f.seatsAfter,
      luggage: f.luggageAfter
    };
    await f.trip.save();
  }
  return fixed.length;
}

/**
 * A guest sitting at `queued` with no live QueueEntry is invisible: the tick
 * only reads `waiting` entries, and the arrival sweep only reconsiders guests
 * back at `registered`. Offer expiry used to leave exactly this state behind.
 *
 * An entry still readable as demand is reopened. A guest with nothing left to
 * reopen goes back to `registered` so the arrival sweep can enqueue them again
 * with a fresh, reachable window.
 */
async function recoverStrandedGuests() {
  const queued = await _Guest.Guest.find({ status: 'queued', currentTripId: null })
    .select('name').lean();
  const reopen = [];
  const reset = [];
  for (const g of queued) {
    const live = await _QueueEntry.QueueEntry.countDocuments({
      guestIds: g._id,
      status: { $in: ['waiting', 'matching'] }
    });
    if (live > 0) continue;
    const reopenable = await _QueueEntry.QueueEntry.findOne({
      guestIds: g._id,
      status: 'assigned'
    }).select('_id').lean();
    if (reopenable) reopen.push({ guest: g, entryId: reopenable._id });
    else reset.push(g);
  }
  if (reopen.length === 0 && reset.length === 0) {
    log(`stranded      : ok — every queued guest has live demand`);
    return 0;
  }
  log(`stranded      : ${reopen.length + reset.length} queued guest(s) with no live demand`);
  if (reopen.length > 0) log(`                reopening ${reopen.length} entr(ies): ${reopen.map(r => r.guest.name).join(', ')}`);
  if (reset.length > 0) log(`                returning ${reset.length} to registered: ${reset.map(g => g.name).join(', ')}`);
  if (dryRun) return reopen.length + reset.length;

  if (reopen.length > 0) {
    await _QueueEntry.QueueEntry.updateMany(
      { _id: { $in: reopen.map(r => r.entryId) } },
      { $set: { status: 'waiting' } }
    );
  }
  if (reset.length > 0) {
    await _Guest.Guest.updateMany(
      { _id: { $in: reset.map(g => g._id) } },
      { $set: { status: 'registered' }, $unset: { waitingSince: 1 } }
    );
  }
  return reopen.length + reset.length;
}

/**
 * Trips stranded well past their deadline never reach a terminal state on their
 * own: they hold their driver out of the supply pool and re-alert on every
 * reoptimize pass. Cancelling them through TripService keeps the state machine
 * and driver release invariants intact.
 */
async function closeStaleTrips(now) {
  const cutoff = new Date(now.getTime() - STALE_TRIP_GRACE_HOURS * 60 * 60_000);
  const stranded = await _Trip.Trip.find({
    status: { $nin: ['completed', 'cancelled', 'rejected'] },
    deadlineAt: { $ne: null, $lt: cutoff }
  }).select('code status deadlineAt guests driverId');

  if (stranded.length === 0) {
    log(`stale trips   : ok — none past deadline by >${STALE_TRIP_GRACE_HOURS}h`);
    return 0;
  }
  if (!shouldCloseStaleTrips) {
    log(`stale trips   : ${stranded.length} trip(s) stranded >${STALE_TRIP_GRACE_HOURS}h past deadline (re-run with --close-stale-trips to cancel)`);
    stranded.forEach(t => log(`                - ${t.code} (${t.status}, deadline ${t.deadlineAt.toISOString()})`));
    return 0;
  }
  log(`stale trips   : cancelling ${stranded.length} trip(s) stranded >${STALE_TRIP_GRACE_HOURS}h past deadline`);
  stranded.forEach(t => log(`                - ${t.code} (${t.status})`));
  if (dryRun) return stranded.length;

  for (const trip of stranded) {
    const guestIds = trip.guests.map(g => g.guestId.toString());
    const cancelled = await _TripService.TripService.transition(trip._id.toString(), 'cancelled', 'maintenance:repair');
    cancelled.cancellationReason = 'Stranded past deadline — closed by maintenance repair';
    await cancelled.save();
    // Guests go back to registered rather than queued: the arrival sweep will
    // re-enqueue them with a fresh, reachable window, whereas leaving them
    // queued against the old expired deadline just fails again immediately.
    await _Guest.Guest.updateMany(
      { _id: { $in: guestIds } },
      { $set: { status: 'registered', currentTripId: null }, $unset: { waitingSince: 1 } }
    );
    await _QueueEntry.QueueEntry.updateMany(
      { guestIds: { $in: guestIds }, status: { $in: ['waiting', 'matching', 'assigned'] } },
      { $set: { status: 'failed', lastFailureReason: 'trip_stranded_past_deadline' } }
    );
  }
  return stranded.length;
}

(async () => {
  await _mongoose.connect(_env.env.MONGODB_URI);
  const now = new Date();
  log(`repair        : ${now.toISOString()}${dryRun ? '  [dry run — no writes]' : ''}`);
  log('');
  const shifts = await rollExpiredShifts(now);
  const pointers = await clearDanglingTripPointers();
  const alerts = await foldDuplicateAlerts();
  // After stale trips are closed, so guests freed by those cancellations are
  // considered in the same pass.
  const trips = await closeStaleTrips(now);
  const stranded = await recoverStrandedGuests();
  const manifests = await dedupeTripManifests();
  // Last, so it sees the state the steps above have settled on.
  const guestStatus = await reconcileGuestStatuses();
  log('');
  log(`summary       : shifts=${shifts} pointers=${pointers} alertsFolded=${alerts} tripsClosed=${trips}`);
  log(`                strandedRecovered=${stranded} manifestsFixed=${manifests} guestStatusFixed=${guestStatus}`);
  await _mongoose.disconnect();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
