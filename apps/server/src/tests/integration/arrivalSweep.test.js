// The arrival sweep is the bridge from guest arrival data to dispatch demand:
// without it the engine has nothing to match for guests whose flights are
// already in the system. These cover the properties that matter operationally
// — it must not double-book, must not run ahead of the lookahead window, and
// must be safe to run repeatedly.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeEventConfig, makeGuest } from '../helpers/fixtures';
import { runArrivalSweep } from '../../jobs/arrivalSweep.job';
import { Guest } from '../../models/Guest';
import { Location } from '../../models/Location';
import { QueueEntry } from '../../models/QueueEntry';
import { Trip } from '../../models/Trip';
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
async function makeLocations() {
  const airport = await Location.create({
    name: 'Test Airport',
    type: 'airport',
    coordinates: toGeoPoint({
      lat: 18.5793,
      lng: 73.9089
    }),
    isActive: true
  });
  const hotel = await Location.create({
    name: 'Test Hotel',
    type: 'accommodation',
    coordinates: toGeoPoint({
      lat: 18.5362,
      lng: 73.893
    }),
    isActive: true
  });
  return {
    airport,
    hotel
  };
}

/** A guest whose arrival is `minutesFromNow` away (negative = already landed). */
async function makeArrivingGuest(minutesFromNow) {
  const {
    guest
  } = await makeGuest();
  const {
    airport,
    hotel
  } = await makeLocations();
  await Guest.updateOne({
    _id: guest._id
  }, {
    $set: {
      status: 'registered',
      accommodationId: hotel._id,
      'arrival.mode': 'flight',
      'arrival.scheduledAt': new Date(Date.now() + minutesFromNow * 60_000),
      'arrival.pickupLocationId': airport._id
    }
  });
  return {
    guest,
    airport,
    hotel
  };
}
describe('arrival sweep', () => {
  it('enqueues a guest whose arrival falls inside the lookahead window', async () => {
    await makeEventConfig();
    const {
      guest,
      airport,
      hotel
    } = await makeArrivingGuest(10);
    const report = await runArrivalSweep();
    expect(report.enqueued).toBe(1);
    const entries = await QueueEntry.find({});
    expect(entries).toHaveLength(1);
    expect(entries[0].guestIds.map(String)).toEqual([guest._id.toString()]);
    expect(String(entries[0].pickup.locationId)).toBe(airport._id.toString());
    expect(String(entries[0].dropoff.locationId)).toBe(hotel._id.toString());
    expect(entries[0].status).toBe('waiting');
    const fresh = await Guest.findById(guest._id);
    expect(fresh.status).toBe('queued');
    expect(fresh.waitingSince).toBeTruthy();
  });
  it('leaves arrivals beyond the lookahead window alone', async () => {
    await makeEventConfig();
    // Default ARRIVAL_LOOKAHEAD_MIN is 45.
    const {
      guest
    } = await makeArrivingGuest(180);
    const report = await runArrivalSweep();
    expect(report.enqueued).toBe(0);
    expect(await QueueEntry.countDocuments({})).toBe(0);
    expect((await Guest.findById(guest._id)).status).toBe('registered');
  });
  it('picks up an arrival that has already landed rather than stranding it', async () => {
    await makeEventConfig();
    await makeArrivingGuest(-30);
    expect((await runArrivalSweep()).enqueued).toBe(1);

    // earliestAt must not be backdated to the landing time — the ride is
    // claimable now, not half an hour ago.
    const entry = await QueueEntry.findOne({});
    expect(new Date(entry.earliestAt).getTime()).toBeGreaterThan(Date.now() - 5_000);
  });
  it('is idempotent — a second run does not double-book the same guest', async () => {
    await makeEventConfig();
    await makeArrivingGuest(10);
    const first = await runArrivalSweep();
    const second = await runArrivalSweep();
    expect(first.enqueued).toBe(1);
    expect(second.enqueued).toBe(0);
    expect(await QueueEntry.countDocuments({})).toBe(1);
  });
  it('skips a guest who already holds an open queue entry from another source', async () => {
    await makeEventConfig();
    const {
      guest,
      airport,
      hotel
    } = await makeArrivingGuest(10);
    await QueueEntry.create({
      type: 'ON_DEMAND',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: {
        locationId: airport._id,
        coordinates: airport.coordinates,
        label: airport.name
      },
      dropoff: {
        locationId: hotel._id,
        coordinates: hotel.coordinates,
        label: hotel.name
      },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 30 * 60_000),
      status: 'waiting'
    });
    expect((await runArrivalSweep()).enqueued).toBe(0);
    expect(await QueueEntry.countDocuments({})).toBe(1);
  });
  it('skips a guest already on a trip', async () => {
    await makeEventConfig();
    const {
      guest
    } = await makeArrivingGuest(10);
    const trip = await Trip.create({
      code: 'T-9001',
      type: 'ARRIVAL_PICKUP',
      status: 'accepted'
    });
    await Guest.updateOne({
      _id: guest._id
    }, {
      $set: {
        currentTripId: trip._id
      }
    });
    expect((await runArrivalSweep()).enqueued).toBe(0);
    expect(await QueueEntry.countDocuments({})).toBe(0);
  });
  it('does nothing when no EventConfig exists', async () => {
    await makeArrivingGuest(10);
    expect((await runArrivalSweep()).enqueued).toBe(0);
  });
  it('skips guests missing a pickup location or accommodation', async () => {
    await makeEventConfig();
    const {
      guest
    } = await makeGuest();
    await Guest.updateOne({
      _id: guest._id
    }, {
      $set: {
        status: 'registered',
        'arrival.scheduledAt': new Date(Date.now() + 5 * 60_000)
      }
    });
    expect((await runArrivalSweep()).enqueued).toBe(0);
  });
});
