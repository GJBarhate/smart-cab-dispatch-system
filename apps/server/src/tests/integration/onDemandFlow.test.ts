// Guest requests -> pending_approval -> assert no trip exists -> admin
// approves -> trip created -> driver accepts -> transitions through to
// COMPLETED -> guest status COMPLETED (plan.md §13.2).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver, makeEventConfig, makeGuest } from '../helpers/fixtures';
import { Trip } from '../../models/Trip';
import { Guest } from '../../models/Guest';

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

describe('on-demand ride flow', () => {
  it('guest request -> admin approve -> auto-match -> driver lifecycle -> completed', async () => {
    await makeEventConfig();
    const { guest, token: guestToken } = await makeGuest();
    const { token: adminToken } = await makeAdmin();
    const { driver, token: driverToken } = await makeDriver();

    const reqRes = await request(app)
      .post('/api/guest/requests')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        pickupLat: 18.55,
        pickupLng: 73.85,
        pickupLabel: 'Accommodation',
        dropoffLat: 18.56,
        dropoffLng: 73.86,
        dropoffLabel: 'Venue',
        passengerCount: 1,
        luggageCount: 1
      });
    expect(reqRes.status).toBe(201);
    expect(reqRes.body.data.status).toBe('pending_approval');

    expect(await Trip.countDocuments({})).toBe(0);

    // A second request while one is already pending must 409.
    const dup = await request(app).post('/api/guest/requests').set('Authorization', `Bearer ${guestToken}`).send({
      pickupLat: 18.55,
      pickupLng: 73.85,
      dropoffLat: 18.56,
      dropoffLng: 73.86
    });
    expect(dup.status).toBe(409);

    const approveRes = await request(app)
      .post(`/api/admin/requests/${reqRes.body.data.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approveRes.status).toBe(200);

    const trip = await Trip.findOne({});
    expect(trip).toBeTruthy();
    expect(trip!.driverId?.toString()).toBe(driver._id.toString());
    expect(approveRes.body.data.status).toBe('matched');

    const acceptRes = await request(app).post(`/api/driver/trip/${trip!._id}/accept`).set('Authorization', `Bearer ${driverToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.data.status).toBe('en_route_pickup');

    const arrivedRes = await request(app).post(`/api/driver/trip/${trip!._id}/arrived`).set('Authorization', `Bearer ${driverToken}`);
    expect(arrivedRes.status).toBe(200);

    const boardRes = await request(app)
      .post(`/api/driver/trip/${trip!._id}/board`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ guestIds: [guest._id.toString()] });
    expect(boardRes.status).toBe(200);

    const dropRes = await request(app)
      .post(`/api/driver/trip/${trip!._id}/drop`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ guestIds: [guest._id.toString()], stopSeq: 1 });
    expect(dropRes.status).toBe(200);
    expect(dropRes.body.data.status).toBe('completed');

    const finalGuest = await Guest.findById(guest._id);
    expect(finalGuest!.status).toBe('completed');
  }, 30_000);
});
