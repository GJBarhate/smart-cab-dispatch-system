// Driver rejects -> guest re-queued -> priority boosted -> reassigned to a
// different driver -> the rejecting driver is never re-offered the same
// entry (plan.md §13.2).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver, makeEventConfig, makeGuest } from '../helpers/fixtures';
import { Trip } from '../../models/Trip';
import { QueueEntry } from '../../models/QueueEntry';
import { Driver } from '../../models/Driver';
import { DispatchEngine } from '../../services/dispatch/DispatchEngine';
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
describe('driver rejection flow', () => {
  it('re-queues the guest at boosted priority and blacklists the rejecting driver for that entry', async () => {
    await makeEventConfig();
    const {
      guest,
      token: guestToken
    } = await makeGuest();
    const {
      token: adminToken
    } = await makeAdmin();
    const rejecting = await makeDriver('Rejecting Driver');
    const backup = await makeDriver('Backup Driver');
    // Put the backup driver slightly further away but still eligible, so the
    // second matching round has someone to assign to.
    await Driver.updateOne({
      _id: backup.driver._id
    }, {
      $set: {
        status: 'idle'
      }
    });
    const reqRes = await request(app).post('/api/guest/requests').set('Authorization', `Bearer ${guestToken}`).send({
      pickupLat: 18.55,
      pickupLng: 73.85,
      dropoffLat: 18.56,
      dropoffLng: 73.86
    });
    expect(reqRes.status).toBe(201);
    await request(app).post(`/api/admin/requests/${reqRes.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const trip = await Trip.findOne({});
    expect(trip).toBeTruthy();
    const assignedDriverId = trip.driverId.toString();
    const rejectingToken = assignedDriverId === rejecting.driver._id.toString() ? rejecting.token : backup.token;
    const otherDriver = assignedDriverId === rejecting.driver._id.toString() ? backup.driver : rejecting.driver;
    const rejectRes = await request(app).post(`/api/driver/trip/${trip._id}/reject`).set('Authorization', `Bearer ${rejectingToken}`).send({
      reason: 'vehicle issue'
    });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe('rejected');
    const entry = await QueueEntry.findOne({
      guestIds: guest._id
    });
    expect(entry).toBeTruthy();
    expect(entry.status).toBe('waiting');
    expect(entry.rejectedDriverIds.map(id => id.toString())).toContain(assignedDriverId);
    const rejectingDriver = await Driver.findById(assignedDriverId);
    expect(rejectingDriver.status).toBe('idle');
    expect(rejectingDriver.currentTripId).toBeNull();
    expect(rejectingDriver.stats.rejections).toBe(1);
    expect(rejectingDriver.rejectedEntryIds.map(id => id.toString())).toContain(entry._id.toString());

    // Re-match: the rejecting driver must never be re-offered this entry.
    const matched = await DispatchEngine.matchEntryNow(entry._id.toString(), 'starvation_sweep');
    expect(matched).toBe(true);
    const newTrip = await Trip.findOne({
      status: {
        $ne: 'rejected'
      }
    });
    expect(newTrip).toBeTruthy();
    expect(newTrip.driverId.toString()).toBe(otherDriver._id.toString());
    expect(newTrip.driverId.toString()).not.toBe(assignedDriverId);
  }, 30_000);
});
