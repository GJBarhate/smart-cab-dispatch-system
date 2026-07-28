// Demand whose deadline has already passed can never be matched:
// Feasibility.check() returns `deadline_unreachable` for every driver, however
// close or idle. Left in `waiting` it is re-read every tick forever, spending a
// routing call per active trip on each pass — observed at 25+ attempts per
// entry against a live database, which is what exhausted the routing
// providers' rate limits and pushed tick duration into the tens of minutes.
//
// These cover the boundary: provably-dead demand is retired, demand a driver
// could still make is not.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeEventConfig, makeGuest } from '../helpers/fixtures';
import { DispatchEngine } from '../../services/dispatch/DispatchEngine';
import { Guest } from '../../models/Guest';
import { Location } from '../../models/Location';
import { QueueEntry } from '../../models/QueueEntry';
import { toGeoPoint } from '../../utils/geo';
import { GuestStatus } from '../../shared';

beforeAll(async () => {
  await startTestDb();
}, 60_000);
afterAll(async () => {
  await stopTestDb();
});
afterEach(async () => {
  await clearTestDb();
});

/** A waiting entry whose deadline is `deadlineMinFromNow` away (negative = past). */
async function makeWaitingEntry(deadlineMinFromNow: number) {
  const { guest } = await makeGuest();
  const pickup = await Location.create({
    name: 'Airport',
    type: 'airport',
    coordinates: toGeoPoint({ lat: 18.5793, lng: 73.9089 }),
    isActive: true
  });
  const dropoff = await Location.create({
    name: 'Hotel',
    type: 'accommodation',
    coordinates: toGeoPoint({ lat: 18.5362, lng: 73.893 }),
    isActive: true
  });

  await Guest.updateOne({ _id: guest._id }, { $set: { status: GuestStatus.QUEUED, waitingSince: new Date() } });

  const now = Date.now();
  const entry = await QueueEntry.create({
    type: 'ARRIVAL_PICKUP',
    guestIds: [guest._id],
    seats: 1,
    luggage: 1,
    pickup: { locationId: pickup._id, coordinates: pickup.coordinates, label: pickup.name },
    dropoff: { locationId: dropoff._id, coordinates: dropoff.coordinates, label: dropoff.name },
    earliestAt: new Date(now - 60 * 60_000),
    deadlineAt: new Date(now + deadlineMinFromNow * 60_000),
    enqueuedAt: new Date(now - 60 * 60_000),
    priorityTier: 1,
    status: 'waiting'
  });

  return { guest, entry };
}

describe('expired demand retirement', () => {
  it('retires an entry whose deadline is long past, instead of retrying it forever', async () => {
    await makeEventConfig();
    const { entry } = await makeWaitingEntry(-360); // 6 hours past, as seen in production

    await DispatchEngine.tick();

    const after = await QueueEntry.findById(entry._id).lean();
    expect(after!.status).toBe('failed');
    expect(after!.lastFailureReason).toBe('deadline_expired');
  });

  it('returns the guest to REGISTERED so the arrival sweep can requeue them', async () => {
    await makeEventConfig();
    const { guest } = await makeWaitingEntry(-360);

    await DispatchEngine.tick();

    const after = await Guest.findById(guest._id).lean();
    // Stranding them in QUEUED with no live entry is the failure mode this
    // guards: the sweep skips guests already holding an open entry, so a
    // guest left QUEUED would never be picked up again.
    expect(after!.status).toBe(GuestStatus.REGISTERED);
  });

  it('leaves demand a driver could still reach in the queue', async () => {
    await makeEventConfig();
    // 30 minutes of headroom — well beyond any grace window, so this must not
    // be treated as expired.
    const { entry } = await makeWaitingEntry(30);

    await DispatchEngine.tick();

    const after = await QueueEntry.findById(entry._id).lean();
    expect(after!.status).not.toBe('failed');
  });

  it('does not retire an entry sitting exactly at the deadline', async () => {
    await makeEventConfig();
    // The cutoff subtracts the grace window, so an entry at `now` is still
    // inside it. Only entries past deadline+grace are provably impossible.
    const { entry } = await makeWaitingEntry(0);

    await DispatchEngine.tick();

    const after = await QueueEntry.findById(entry._id).lean();
    expect(after!.status).not.toBe('failed');
  });
});
