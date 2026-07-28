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
import { EventConfig } from '../models/EventConfig';
import { Guest } from '../models/Guest';
import { Location } from '../models/Location';
import { QueueEntry } from '../models/QueueEntry';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { defaultTripType } from '../services/EventPhaseService';
import { NotificationService } from '../services/NotificationService';
import { GuestStatus } from '../shared';

const OPEN_QUEUE_STATUSES = ['waiting', 'matching'];
const DEADLINE_AFTER_ARRIVAL_MIN = 45;

export interface ArrivalSweepReport {
  enqueued: number;
  skipped: number;
}

export async function runArrivalSweep(now: Date = new Date()): Promise<ArrivalSweepReport> {
  const cfg = await EventConfig.findOne({ singleton: 'singleton' });
  if (!cfg) return { enqueued: 0, skipped: 0 };

  const lookaheadMs = env.ARRIVAL_LOOKAHEAD_MIN * 60_000;
  // Guests whose flight/train lands inside the lookahead window. The lower
  // bound is open-ended so a late sweep still picks up an arrival it missed
  // rather than stranding that guest forever.
  const due = await Guest.find({
    status: GuestStatus.REGISTERED,
    'arrival.scheduledAt': { $ne: null, $lte: new Date(now.getTime() + lookaheadMs) },
    'arrival.pickupLocationId': { $ne: null },
    accommodationId: { $ne: null }
  }).limit(200);

  if (due.length === 0) return { enqueued: 0, skipped: 0 };

  const guestIds = due.map((g) => g._id);
  const alreadyQueued = await QueueEntry.find({
    guestIds: { $in: guestIds },
    status: { $in: OPEN_QUEUE_STATUSES }
  })
    .select('guestIds')
    .lean();

  const busy = new Set<string>();
  for (const entry of alreadyQueued) {
    for (const id of entry.guestIds ?? []) busy.add(String(id));
  }

  const type = defaultTripType(cfg, now);
  let enqueued = 0;
  let skipped = 0;

  for (const guest of due) {
    if (busy.has(guest._id.toString()) || guest.currentTripId) {
      skipped++;
      continue;
    }

    const [pickup, dropoff] = await Promise.all([
      Location.findById(guest.arrival!.pickupLocationId),
      Location.findById(guest.accommodationId)
    ]);
    if (!pickup || !dropoff) {
      skipped++;
      continue;
    }

    const scheduledAt = new Date(guest.arrival!.scheduledAt as unknown as Date);
    // earliestAt never precedes the actual landing time, but a guest whose
    // flight already landed is claimable right now.
    const earliestAt = scheduledAt.getTime() > now.getTime() ? scheduledAt : now;

    await QueueEntry.create({
      type,
      guestIds: [guest._id],
      seats: guest.groupSize,
      luggage: guest.luggageCount,
      pickup: { locationId: pickup._id, coordinates: pickup.coordinates, label: pickup.name },
      dropoff: { locationId: dropoff._id, coordinates: dropoff.coordinates, label: dropoff.name },
      earliestAt,
      deadlineAt: new Date(earliestAt.getTime() + DEADLINE_AFTER_ARRIVAL_MIN * 60_000),
      enqueuedAt: now,
      priorityTier: guest.priorityTier,
      status: 'waiting'
    });

    await Guest.updateOne(
      { _id: guest._id },
      { $set: { status: GuestStatus.QUEUED, waitingSince: now } }
    );

    enqueued++;
  }

  if (enqueued > 0) {
    const [depth, unassignableCount, oldest] = await Promise.all([
      QueueEntry.countDocuments({ status: 'waiting' }),
      QueueEntry.countDocuments({ status: 'failed' }),
      QueueEntry.findOne({ status: 'waiting' }).sort({ enqueuedAt: 1 }).select('enqueuedAt').lean()
    ]);
    const oldestWaitMin = oldest
      ? Math.round((now.getTime() - new Date(oldest.enqueuedAt as unknown as Date).getTime()) / 60_000)
      : 0;
    NotificationService.queueUpdate({ depth, oldestWaitMin, unassignableCount });
    logger.info({ enqueued, skipped, type }, 'arrival sweep enqueued due arrivals');
  }

  return { enqueued, skipped };
}
