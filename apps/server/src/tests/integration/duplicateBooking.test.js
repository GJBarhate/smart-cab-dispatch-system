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
import { makeDriver, makeEventConfig, makeGuest } from '../helpers/fixtures';
import { Driver } from '../../models/Driver';
import { Guest } from '../../models/Guest';
import { Trip } from '../../models/Trip';
import { QueueEntry } from '../../models/QueueEntry';
import { RideRequest } from '../../models/RideRequest';
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

describe('cancelling a ride that is already assigned', () => {
  function cancel(token, tripId) {
    return request(app).post(`/api/guest/trip/${tripId}/cancel`).set('Authorization', `Bearer ${token}`).send({});
  }

  for (const status of ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup']) {
    it(`lets the guest call off a ${status} ride`, async () => {
      await makeEventConfig();
      const { guest, token } = await makeGuest();
      const trip = await giveTrip(guest, status);

      const res = await cancel(token, trip._id.toString());

      expect(res.status).toBe(200);
      expect((await Trip.findById(trip._id).lean()).status).toBe('cancelled');
      const after = await Guest.findById(guest._id).lean();
      expect(after.status).toBe('registered');
      expect(after.currentTripId).toBeNull();
    });
  }

  it('refuses once the guest has boarded', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const trip = await giveTrip(guest, 'boarded');

    const res = await cancel(token, trip._id.toString());

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already under way/i);
    expect((await Trip.findById(trip._id).lean()).status).toBe('boarded');
  });

  it('retires their queued demand instead of requeueing it', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const trip = await giveTrip(guest, 'accepted');
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

    await cancel(token, trip._id.toString());

    // Requeueing here would hand them a fresh driver moments after they asked
    // to stop travelling.
    const after = await QueueEntry.findById(entry._id).lean();
    expect(after.status).toBe('failed');
    expect(after.lastFailureReason).toBe('cancelled_by_guest');
  });

  it('will not let a guest cancel someone else\'s ride', async () => {
    await makeEventConfig();
    const { guest } = await makeGuest('Rider');
    const { token: otherToken } = await makeGuest('Stranger');
    const trip = await giveTrip(guest, 'accepted');

    expect((await cancel(otherToken, trip._id.toString())).status).toBe(404);
    expect((await Trip.findById(trip._id).lean()).status).toBe('accepted');
  });

  it('frees the driver so they can take another trip', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const { driver } = await makeDriver('Freed Driver');
    const trip = await giveTrip(guest, 'accepted');
    await Trip.updateOne({ _id: trip._id }, { $set: { driverId: driver._id } });
    await Driver.updateOne({ _id: driver._id }, { $set: { status: 'assigned', currentTripId: trip._id } });

    await cancel(token, trip._id.toString());

    const after = await Driver.findById(driver._id).lean();
    expect(after.currentTripId).toBeNull();
    expect(after.status).toBe('idle');
  });
});

describe('cancelling while waiting for a driver', () => {
  function cancelRequest(token, id) {
    return request(app).delete(`/api/guest/requests/${id}`).set('Authorization', `Bearer ${token}`);
  }

  /** Mirrors admin approval: request approved, demand queued, no driver yet. */
  async function approveInto(guest, requestId) {
    await RideRequest.updateOne({ _id: requestId }, { $set: { status: 'approved' } });
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
      status: 'waiting',
      sourceRequestId: requestId
    });
  }

  it('lets the guest cancel an approved request still hunting for a driver', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const created = await book(token);
    const entry = await approveInto(guest, created.body.data.id);

    // Before, this window refused with "Only a pending request can be
    // cancelled" — a dead end for however long the fleet stayed busy.
    expect((await cancelRequest(token, created.body.data.id)).status).toBe(200);

    expect((await RideRequest.findById(created.body.data.id).lean()).status).toBe('expired');
    const afterEntry = await QueueEntry.findById(entry._id).lean();
    // Left waiting, the engine would keep placing a ride they called off.
    expect(afterEntry.status).toBe('failed');
    expect(afterEntry.lastFailureReason).toBe('cancelled_by_guest');
    expect((await Guest.findById(guest._id).lean()).status).toBe('registered');
  });

  it('redirects to the ride-cancel path when a driver landed in the meantime', async () => {
    await makeEventConfig();
    const { guest, token } = await makeGuest();
    const created = await book(token);
    await approveInto(guest, created.body.data.id);
    await giveTrip(guest, 'accepted');

    const res = await cancelRequest(token, created.body.data.id);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cancel the ride instead/i);
  });

  it('refuses to expire a request that already became a trip', async () => {
    await makeEventConfig();
    const { token } = await makeGuest();
    const created = await book(token);
    await RideRequest.updateOne({ _id: created.body.data.id }, { $set: { status: 'matched' } });

    const res = await cancelRequest(token, created.body.data.id);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cancel the ride instead/i);
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
