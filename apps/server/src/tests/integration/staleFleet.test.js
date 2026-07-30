// A fleet whose roster has gone stale used to disable dispatch silently.
//
// The seed rostered every driver for the day it ran. On any later day
// `Feasibility.check` returned `shift_ends_before_trip` for every driver
// against every demand, so nothing could be assigned — while
// `listEligibleDrivers` still counted those drivers as supply and the UI still
// showed them `idle`. A guest booking reached the Approval Inbox, approving it
// produced no trip, and the tick reported the generic "could not be matched"
// rather than the missing supply. Observed against a live database as 12
// expired shifts, 25 failed attempts on a single one-seat request, and ~3,900
// duplicate alerts.
//
// These lock down the three invariants that failure depended on.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeEventConfig, makeDriver, makeGuest } from '../helpers/fixtures';
import { DriverStateService } from '../../services/dispatch/DriverStateService';
import { TripService } from '../../services/dispatch/TripService';
import { AlertService } from '../../services/AlertService';
import { toDispatchConfig } from '../../services/dispatch/config';
import { Driver } from '../../models/Driver';
import { Alert } from '../../models/Alert';
import { EventConfig } from '../../models/EventConfig';
import { Guest } from '../../models/Guest';
import { QueueEntry } from '../../models/QueueEntry';
import { toGeoPoint } from '../../utils/geo';

beforeAll(async () => {
  await startTestDb();
}, 60_000);
afterAll(async () => {
  await stopTestDb();
});
afterEach(async () => {
  await clearTestDb();
});

async function dispatchConfig() {
  await makeEventConfig();
  return toDispatchConfig(await EventConfig.findOne({ singleton: 'singleton' }));
}

describe('expired shifts and eligible supply', () => {
  it('excludes a driver whose shift already ended', async () => {
    const cfg = await dispatchConfig();
    const { driver } = await makeDriver('Past Shift');
    const now = new Date();
    await Driver.updateOne({ _id: driver._id }, {
      $set: {
        'shift.startAt': new Date(now.getTime() - 48 * 60 * 60_000),
        'shift.endAt': new Date(now.getTime() - 24 * 60 * 60_000)
      }
    });
    const eligible = await DriverStateService.listEligibleDrivers(cfg, now);
    // Feasibility would reject this driver for every demand anyway; counting
    // them as supply is what made the fleet look healthy while nothing matched.
    expect(eligible.map(e => e.doc.name)).not.toContain('Past Shift');
  });

  it('keeps a driver whose shift is still open', async () => {
    const cfg = await dispatchConfig();
    const { driver } = await makeDriver('On Shift');
    const now = new Date();
    await Driver.updateOne({ _id: driver._id }, {
      $set: {
        'shift.startAt': new Date(now.getTime() - 60 * 60_000),
        'shift.endAt': new Date(now.getTime() + 8 * 60 * 60_000)
      }
    });
    const eligible = await DriverStateService.listEligibleDrivers(cfg, now);
    expect(eligible.map(e => e.doc.name)).toContain('On Shift');
  });

  it('keeps a driver with no shift set at all', async () => {
    const cfg = await dispatchConfig();
    await makeDriver('No Shift');
    const eligible = await DriverStateService.listEligibleDrivers(cfg, new Date());
    expect(eligible.map(e => e.doc.name)).toContain('No Shift');
  });

  it('still applies the break filter alongside the shift filter', async () => {
    // Both are $or groups and have to coexist under $and — as sibling `$or`
    // keys the second silently replaces the first, quietly dropping one filter.
    const cfg = await dispatchConfig();
    const { driver } = await makeDriver('On Break');
    const now = new Date();
    await Driver.updateOne({ _id: driver._id }, {
      $set: {
        'break.onBreakUntil': new Date(now.getTime() + 30 * 60_000),
        'shift.endAt': new Date(now.getTime() + 8 * 60 * 60_000)
      }
    });
    const eligible = await DriverStateService.listEligibleDrivers(cfg, now);
    expect(eligible.map(e => e.doc.name)).not.toContain('On Break');
  });
});

describe('alert folding', () => {
  it('folds a repeat of the same condition into the open alert', async () => {
    await AlertService.raise('warning', 'UNASSIGNABLE', '1 demand(s) could not be matched this tick');
    await AlertService.raise('warning', 'UNASSIGNABLE', '2 demand(s) could not be matched this tick');
    await AlertService.raise('warning', 'UNASSIGNABLE', '3 demand(s) could not be matched this tick');
    const alerts = await Alert.find({ code: 'UNASSIGNABLE' }).lean();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].occurrences).toBe(3);
    // The surviving row carries the latest wording, not the first.
    expect(alerts[0].message).toBe('3 demand(s) could not be matched this tick');
  });

  it('keeps alerts for different entities apart', async () => {
    const entity = id => ({ type: 'Trip', id });
    await AlertService.raise('warning', 'DEADLINE_AT_RISK', 'Trip T-1 is projected 5min past its deadline', entity('t1'));
    await AlertService.raise('warning', 'DEADLINE_AT_RISK', 'Trip T-1 is projected 9min past its deadline', entity('t1'));
    await AlertService.raise('warning', 'DEADLINE_AT_RISK', 'Trip T-2 is projected 4min past its deadline', entity('t2'));
    const alerts = await Alert.find({ code: 'DEADLINE_AT_RISK' }).lean();
    expect(alerts).toHaveLength(2);
    expect(alerts.find(a => a.entity.id === 't1').occurrences).toBe(2);
    expect(alerts.find(a => a.entity.id === 't2').occurrences).toBe(1);
  });

  it('raises a fresh alert once the previous one is acknowledged', async () => {
    await AlertService.raise('warning', 'UNASSIGNABLE', 'first');
    await Alert.updateOne({ code: 'UNASSIGNABLE' }, { $set: { acknowledged: true } });
    await AlertService.raise('warning', 'UNASSIGNABLE', 'second');
    expect(await Alert.countDocuments({ code: 'UNASSIGNABLE' })).toBe(2);
    expect(await Alert.countDocuments({ code: 'UNASSIGNABLE', acknowledged: false })).toBe(1);
  });
});

describe('unassignable count', () => {
  async function entry(status, attempts) {
    const { guest } = await makeGuest();
    return QueueEntry.create({
      type: 'ON_DEMAND',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: { locationId: null, coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), label: 'P' },
      dropoff: { locationId: null, coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), label: 'D' },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      enqueuedAt: new Date(),
      priorityTier: 1,
      status,
      attempts
    });
  }

  it('ignores demand that was retired long ago', async () => {
    await entry('failed', 9);
    // The old count used `status: 'failed'`, an all-time archive that only
    // grows — the tile stayed red forever once anything had ever failed.
    expect(await QueueEntry.countStuck()).toBe(0);
  });

  it('ignores a fresh entry that has only just missed a pass', async () => {
    await entry('waiting', 1);
    expect(await QueueEntry.countStuck()).toBe(0);
  });

  it('counts demand that keeps failing', async () => {
    await entry('waiting', 3);
    await entry('waiting', 7);
    expect(await QueueEntry.countStuck()).toBe(2);
  });

  it('drops back to zero once the demand is assigned', async () => {
    const e = await entry('waiting', 5);
    expect(await QueueEntry.countStuck()).toBe(1);
    await QueueEntry.updateOne({ _id: e._id }, { $set: { status: 'assigned' } });
    expect(await QueueEntry.countStuck()).toBe(0);
  });
});

describe('requeueing reopens the demand', () => {
  it('puts the guest\'s assigned entry back to waiting', async () => {
    const { guest } = await makeGuest();
    const entry = await QueueEntry.create({
      type: 'ON_DEMAND',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: { locationId: null, coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), label: 'P' },
      dropoff: { locationId: null, coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), label: 'D' },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      enqueuedAt: new Date(),
      priorityTier: 1,
      status: 'assigned'
    });

    await TripService.requeueGuests([guest._id.toString()], 'offer_expired');

    // Leaving the entry at `assigned` while the guest reads `queued` hides
    // them from the tick (waiting entries only) and from the arrival sweep
    // (registered guests only) — they wait forever and the queue looks empty.
    expect((await QueueEntry.findById(entry._id)).status).toBe('waiting');
    expect((await Guest.findById(guest._id)).status).toBe('queued');
  });

  it('preserves enqueuedAt so accrued priority is not reset', async () => {
    const { guest } = await makeGuest();
    const enqueuedAt = new Date(Date.now() - 40 * 60_000);
    const entry = await QueueEntry.create({
      type: 'ON_DEMAND',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: { locationId: null, coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), label: 'P' },
      dropoff: { locationId: null, coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), label: 'D' },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      enqueuedAt,
      priorityTier: 1,
      status: 'assigned'
    });

    await TripService.requeueGuests([guest._id.toString()], 'driver_rejected');

    const after = await QueueEntry.findById(entry._id);
    expect(after.enqueuedAt.getTime()).toBe(enqueuedAt.getTime());
  });

  it('leaves an already-completed entry alone', async () => {
    const { guest } = await makeGuest();
    const entry = await QueueEntry.create({
      type: 'ON_DEMAND',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: { locationId: null, coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), label: 'P' },
      dropoff: { locationId: null, coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), label: 'D' },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      enqueuedAt: new Date(),
      priorityTier: 1,
      status: 'failed'
    });

    await TripService.requeueGuests([guest._id.toString()], 'offer_expired');

    expect((await QueueEntry.findById(entry._id)).status).toBe('failed');
  });
});

describe('driver release on terminal transitions', () => {
  async function tripForDriver(driverId, guestId) {
    return TripService.createFromAssignment({
      type: 'ON_DEMAND',
      driverId: driverId.toString(),
      entryIds: [],
      guests: [{ guestId: guestId.toString(), name: 'G', seats: 1, luggage: 1 }],
      stops: [
        { kind: 'pickup', guestIds: [guestId.toString()], locationId: null, coordinates: { lat: 18.55, lng: 73.85 }, label: 'P' },
        { kind: 'drop', guestIds: [guestId.toString()], locationId: null, coordinates: { lat: 18.56, lng: 73.86 }, label: 'D' }
      ],
      vehicleSnapshot: { number: 'KA-1', model: 'Sedan', seats: 4, luggage: 3 },
      capacityUsed: { seats: 1, luggage: 1 },
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      strategy: 'greedy_realtime',
      score: 1,
      costBreakdown: {},
      candidatesConsidered: 1,
      decidedBy: 'engine',
      groupSplitId: null,
      sourceRequestId: null
    });
  }

  it('clears currentTripId when a trip is cancelled, so the driver can be claimed again', async () => {
    const { driver } = await makeDriver('Releasable');
    const { guest } = await makeGuest();
    const trip = await tripForDriver(driver._id, guest._id);
    expect((await Driver.findById(driver._id)).currentTripId).not.toBeNull();

    await TripService.transition(trip._id.toString(), 'cancelled', 'test');

    const after = await Driver.findById(driver._id);
    // A driver left pointing at a finished trip is invisible to dispatch
    // forever: claimDriver only claims when currentTripId is null.
    expect(after.currentTripId).toBeNull();
    expect(after.status).toBe('idle');
    expect(await TripService.claimDriver(driver._id.toString(), trip._id)).toBe(true);
  });

  it('does not pull an offline driver back on duty when their trip ends', async () => {
    const { driver } = await makeDriver('Went Offline');
    const { guest } = await makeGuest();
    const trip = await tripForDriver(driver._id, guest._id);
    await Driver.updateOne({ _id: driver._id }, { $set: { status: 'offline' } });

    await TripService.transition(trip._id.toString(), 'cancelled', 'test');

    const after = await Driver.findById(driver._id);
    expect(after.currentTripId).toBeNull();
    expect(after.status).toBe('offline');
  });
});
