// Manual reassignment from the Trip Board.
//
// The regression this guards: the handler used to rebuild assignmentMeta with
// `{ ...trip.assignmentMeta, strategy: 'manual_override', ... }`. That reads as
// an ordinary object spread, but assignmentMeta is a Mongoose *nested path*,
// not a plain object — the spread dropped the nested `costBreakdown`, which
// then cast as undefined and failed the whole save. Every click on "Reassign"
// returned a 500.
//
// The costBreakdown assertion is the point of the test: a fix that made the
// save succeed by clearing those figures would still be a bug, because the
// "Why this driver?" explanation reads them straight back.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver, makeGuest } from '../helpers/fixtures';
import { Trip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
const app = createApp();
const COST_BREAKDOWN = {
  eta: 10.7,
  lateness: 0,
  priority: -25,
  idle: -4.8,
  capacityWaste: 2.4,
  breakUrgency: 0,
  rejectionHistory: 0,
  detour: 0,
  total: 8.3
};
async function makeAssignedTrip(driverId, guestId) {
  const trip = await Trip.create({
    code: 'T-REASSIGN',
    type: 'ON_DEMAND',
    status: 'en_route_pickup',
    driverId,
    vehicleSnapshot: {
      number: 'KA-01',
      model: 'Sedan',
      seats: 4,
      luggage: 3
    },
    stops: [],
    capacityUsed: {
      seats: 1,
      luggage: 1
    },
    guests: [{
      guestId,
      name: 'Test Guest',
      seats: 1,
      luggage: 1
    }],
    assignmentMeta: {
      strategy: 'batch_hungarian',
      score: 8.3,
      costBreakdown: COST_BREAKDOWN,
      candidatesConsidered: 8,
      decidedBy: 'engine',
      decidedAt: new Date()
    }
  });
  await Driver.updateOne({
    _id: driverId
  }, {
    $set: {
      currentTripId: trip._id,
      status: 'assigned'
    }
  });
  return trip;
}
beforeAll(async () => {
  await startTestDb();
}, 60_000);
afterAll(async () => {
  await stopTestDb();
});
afterEach(async () => {
  await clearTestDb();
});
describe('POST /api/admin/trips/:id/reassign', () => {
  it('succeeds and preserves the engine cost breakdown', async () => {
    const admin = await makeAdmin();
    const from = await makeDriver('From Driver');
    const to = await makeDriver('To Driver');
    const guest = await makeGuest();
    const trip = await makeAssignedTrip(from.driver._id, guest.guest._id);
    const res = await request(app).post(`/api/admin/trips/${trip._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({
      driverId: to.driver._id.toString()
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const meta = res.body.data.assignmentMeta;
    expect(meta.strategy).toBe('manual_override');
    expect(meta.decidedBy).toBe(admin.user._id.toString());
    // The whole reason the bug mattered: these must survive the write.
    expect(meta.costBreakdown).toMatchObject(COST_BREAKDOWN);
    expect(meta.candidatesConsidered).toBe(8);
  });
  it('moves the trip onto the new driver and frees the old one', async () => {
    const admin = await makeAdmin();
    const from = await makeDriver('From Driver');
    const to = await makeDriver('To Driver');
    const guest = await makeGuest();
    const trip = await makeAssignedTrip(from.driver._id, guest.guest._id);
    await request(app).post(`/api/admin/trips/${trip._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({
      driverId: to.driver._id.toString()
    }).expect(200);
    const saved = await Trip.findById(trip._id);
    expect(saved.driverId.toString()).toBe(to.driver._id.toString());
    // The vehicle shown to the guest has to follow the driver, not linger.
    expect(saved.vehicleSnapshot.number).toBe(to.driver.vehicle.number);
    const oldDriver = await Driver.findById(from.driver._id);
    expect(oldDriver.currentTripId).toBeNull();
    const newDriver = await Driver.findById(to.driver._id);
    expect(newDriver.currentTripId.toString()).toBe(trip._id.toString());
  });
  it('records the handover in the trip timeline', async () => {
    const admin = await makeAdmin();
    const from = await makeDriver('From Driver');
    const to = await makeDriver('To Driver');
    const guest = await makeGuest();
    const trip = await makeAssignedTrip(from.driver._id, guest.guest._id);
    await request(app).post(`/api/admin/trips/${trip._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({
      driverId: to.driver._id.toString()
    }).expect(200);
    const saved = await Trip.findById(trip._id);
    const entry = saved.timeline.find(t => t.type === 'reassigned');
    expect(entry).toBeDefined();
    expect(entry.payload).toMatchObject({
      from: from.driver._id.toString(),
      to: to.driver._id.toString()
    });
  });
  it('409s rather than stranding the trip when the target driver is busy', async () => {
    const admin = await makeAdmin();
    const from = await makeDriver('From Driver');
    const to = await makeDriver('Busy Driver');
    const guest = await makeGuest();
    const trip = await makeAssignedTrip(from.driver._id, guest.guest._id);
    // Target is already on something else.
    await Driver.updateOne({
      _id: to.driver._id
    }, {
      $set: {
        currentTripId: trip._id
      }
    });
    const res = await request(app).post(`/api/admin/trips/${trip._id}/reassign`).set('Authorization', `Bearer ${admin.token}`).send({
      driverId: to.driver._id.toString()
    });
    expect(res.status).toBe(409);
  });
  it('404s for a trip that does not exist', async () => {
    const admin = await makeAdmin();
    const to = await makeDriver();
    const res = await request(app).post('/api/admin/trips/aaaaaaaaaaaaaaaaaaaaaaaa/reassign').set('Authorization', `Bearer ${admin.token}`).send({
      driverId: to.driver._id.toString()
    });
    expect(res.status).toBe(404);
  });
});
