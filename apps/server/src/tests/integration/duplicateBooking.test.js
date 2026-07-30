// A guest who already has a ride must not be able to raise another one.
//
// The only guard used to be "no other request pending approval", which let a
// passenger already in a moving cab submit a fresh request. That did real
// damage rather than just showing a confusing screen:
//   - the handler flipped them to `queued`, so the admin's guest list showed
//     them waiting while they were mid-trip, and
//   - cancelling that request dropped them to `registered` — the exact status
//     the arrival sweep enqueues from — so they could be matched to a second
//     driver while the first was still carrying them.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeEventConfig, makeGuest } from '../helpers/fixtures';
import { Guest } from '../../models/Guest';
import { Trip } from '../../models/Trip';
import { QueueEntry } from '../../models/QueueEntry';
import { toGeoPoint } from '../../utils/geo';

const app = createApp();
beforeAll(async () => {
  await startTestDb();
}, 60_000);
afterAll(async () => {
  await stopTestDb();
});
afterEach(async () => {
  await clearTestDb();
});

const BOOKING = {
  pickupLat: 18.55,
  pickupLng: 73.85,
  pickupLabel: 'Accommodation',
  dropoffLat: 18.56,
  dropoffLng: 73.86,
  dropoffLabel: 'Venue',
  passengerCount: 1,
  luggageCount: 1
};

function book(token) {
  return request(app).post('/api/guest/requests').set('Authorization', `Bearer ${token}`).send(BOOKING);
}

/** Puts the guest on a live trip in the given state. */
async function giveTrip(guest, status) {
  const trip = await Trip.create({
    code: 'T-9001',
    type: 'ON_DEMAND',
    status,
    guests: [{ guestId: guest._id, name: guest.name, seats: 1, luggage: 1 }],
    stops: [],
    capacityUsed: { seats: 1, luggage: 1 }
  });
  await Guest.updateOne({ _id: guest._id }, { $set: { status: 'assigned', currentTripId: trip._id } });
  return trip;
}

describe('booking while a ride is already in progress', () => {
  for (const status of ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup', 'boarded']) {
    it(`refuses a new request when the guest's trip is ${status}`, async () => {
      await makeEventConfig();
      const { guest, token } = await makeGuest();
      await giveTrip(guest, status);

      const res = await book(token);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already in progress/i);
    });
  }

  it('leaves the riding guest\'s status untouched', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    await giveTrip(guest, 'boarded');

    await book(token);

    const after = await Guest.findById(guest._id).lean();
    // Flipping a mid-trip passenger to `queued` made the admin's guest list
    // disagree with the trip they were actually sitting in.
    expect(after.status).toBe('assigned');
    expect(after.currentTripId).not.toBeNull();
  });

  it('still allows a booking once the trip has finished', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const trip = await giveTrip(guest, 'boarded');
    await Trip.updateOne({ _id: trip._id }, { $set: { status: 'completed' } });
    await Guest.updateOne({ _id: guest._id }, { $set: { status: 'registered', currentTripId: null } });

    expect((await book(token)).status).toBe(201);
  });
});

describe('cancelling a pending request', () => {
  it('returns the guest to registered when nothing else holds them', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const created = await book(token);
    expect((await Guest.findById(guest._id).lean()).status).toBe('queued');

    await request(app).delete(`/api/guest/requests/${created.body.data.id}`).set('Authorization', `Bearer ${token}`).expect(200);

    expect((await Guest.findById(guest._id).lean()).status).toBe('registered');
  });

  it('keeps the guest queued while an arrival-sweep entry is still live', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const created = await book(token);
    await QueueEntry.create({
      type: 'ARRIVAL_PICKUP',
      guestIds: [guest._id],
      seats: 1,
      luggage: 1,
      pickup: { locationId: null, coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), label: 'P' },
      dropoff: { locationId: null, coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), label: 'D' },
      earliestAt: new Date(),
      deadlineAt: new Date(Date.now() + 60 * 60_000),
      enqueuedAt: new Date(),
      priorityTier: 1,
      status: 'waiting'
    });

    await request(app).delete(`/api/guest/requests/${created.body.data.id}`).set('Authorization', `Bearer ${token}`).expect(200);

    // Dropping them to `registered` here would have the guest list claim they
    // want nothing while they are still sitting in the dispatch queue.
    expect((await Guest.findById(guest._id).lean()).status).toBe('queued');
  });
});
