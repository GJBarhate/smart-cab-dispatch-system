"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runArrivalSweep = runArrivalSweep;
var _EventConfig = require("../models/EventConfig");
var _Guest = require("../models/Guest");
var _Location = require("../models/Location");
var _QueueEntry = require("../models/QueueEntry");
var _logger = require("../config/logger");
var _env = require("../config/env");
var _EventPhaseService = require("../services/EventPhaseService");
var _NotificationService = require("../services/NotificationService");
var _shared = require("../shared");
// Turns scheduled guest arrivals into dispatch demand.
//
// Without this the QueueEntry collection only ever fills from an admin
// approving an on-demand request — the engine would have nothing to do for the
// 40 guests whose flights are already in the system, which is the actual
// problem statement. This sweep is the bridge: guest arrival data -> queue.
//
// It is deliberately idempotent and re-entrant: a guest already holding an open
// queue entry or an active trip is skipped, so overlapping runs (or a restart
// mid-sweep) cannot double-book anyone.

const OPEN_QUEUE_STATUSES = ['waiting', 'matching'];
const DEADLINE_AFTER_ARRIVAL_MIN = 45;
async function runArrivalSweep(now = new Date()) {
  const cfg = await _EventConfig.EventConfig.findOne({
    singleton: 'singleton'
  });
  if (!cfg) return {
    enqueued: 0,
    skipped: 0
  };
  const lookaheadMs = _env.env.ARRIVAL_LOOKAHEAD_MIN * 60_000;
  // Guests whose flight/train lands inside the lookahead window. The lower
  // bound is open-ended so a late sweep still picks up an arrival it missed
  // rather than stranding that guest forever.
  const due = await _Guest.Guest.find({
    status: _shared.GuestStatus.REGISTERED,
    'arrival.scheduledAt': {
      $ne: null,
      $lte: new Date(now.getTime() + lookaheadMs)
    },
    'arrival.pickupLocationId': {
      $ne: null
    },
    accommodationId: {
      $ne: null
    }
  }).limit(200);
  if (due.length === 0) return {
    enqueued: 0,
    skipped: 0
  };
  const guestIds = due.map(g => g._id);
  const alreadyQueued = await _QueueEntry.QueueEntry.find({
    guestIds: {
      $in: guestIds
    },
    status: {
      $in: OPEN_QUEUE_STATUSES
    }
  }).select('guestIds').lean();
  const busy = new Set();
  for (const entry of alreadyQueued) {
    for (const id of entry.guestIds ?? []) busy.add(String(id));
  }
  const type = (0, _EventPhaseService.defaultTripType)(cfg, now);
  let enqueued = 0;
  let skipped = 0;
  for (const guest of due) {
    if (busy.has(guest._id.toString()) || guest.currentTripId) {
      skipped++;
      continue;
    }
    const [pickup, dropoff] = await Promise.all([_Location.Location.findById(guest.arrival.pickupLocationId), _Location.Location.findById(guest.accommodationId)]);
    if (!pickup || !dropoff) {
      skipped++;
      continue;
    }
    const scheduledAt = new Date(guest.arrival.scheduledAt);
    // earliestAt never precedes the actual landing time, but a guest whose
    // flight already landed is claimable right now.
    const earliestAt = scheduledAt.getTime() > now.getTime() ? scheduledAt : now;
    await _QueueEntry.QueueEntry.create({
      type,
      guestIds: [guest._id],
      seats: guest.groupSize,
      luggage: guest.luggageCount,
      pickup: {
        locationId: pickup._id,
        coordinates: pickup.coordinates,
        label: pickup.name
      },
      dropoff: {
        locationId: dropoff._id,
        coordinates: dropoff.coordinates,
        label: dropoff.name
      },
      earliestAt,
      deadlineAt: new Date(earliestAt.getTime() + DEADLINE_AFTER_ARRIVAL_MIN * 60_000),
      enqueuedAt: now,
      priorityTier: guest.priorityTier,
      status: 'waiting'
    });
    await _Guest.Guest.updateOne({
      _id: guest._id
    }, {
      $set: {
        status: _shared.GuestStatus.QUEUED,
        waitingSince: now
      }
    });
    enqueued++;
  }
  if (enqueued > 0) {
    const [depth, unassignableCount, oldest] = await Promise.all([_QueueEntry.QueueEntry.countDocuments({
      status: 'waiting'
    }), _QueueEntry.QueueEntry.countStuck(), _QueueEntry.QueueEntry.findOne({
      status: 'waiting'
    }).sort({
      enqueuedAt: 1
    }).select('enqueuedAt').lean()]);
    const oldestWaitMin = oldest ? Math.round((now.getTime() - new Date(oldest.enqueuedAt).getTime()) / 60_000) : 0;
    _NotificationService.NotificationService.queueUpdate({
      depth,
      oldestWaitMin,
      unassignableCount
    });
    _logger.logger.info({
      enqueued,
      skipped,
      type
    }, 'arrival sweep enqueued due arrivals');
  }
  return {
    enqueued,
    skipped
  };
}
