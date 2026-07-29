// The role-separation criterion, proven (plan.md §13.2).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver, makeGuest } from '../helpers/fixtures';
import { Trip } from '../../models/Trip';
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
describe('RBAC', () => {
  it('a driver token on any /api/admin/* route gets 403', async () => {
    const {
      token
    } = await makeDriver();
    const res = await request(app).get('/api/admin/drivers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
  it('a driver token on /api/dispatch/* gets 403', async () => {
    const {
      token
    } = await makeDriver();
    const res = await request(app).post('/api/dispatch/tick').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
  it('driver A requesting driver B\'s trip gets 404, not 403 (no existence leak)', async () => {
    const a = await makeDriver('Driver A');
    const b = await makeDriver('Driver B');
    const trip = await Trip.create({
      code: 'T-RBAC1',
      type: 'ON_DEMAND',
      status: 'pending_driver',
      driverId: b.driver._id,
      vehicleSnapshot: {
        number: 'x',
        model: 'x',
        seats: 4,
        luggage: 3
      },
      stops: [],
      capacityUsed: {
        seats: 0,
        luggage: 0
      }
    });
    const res = await request(app).post(`/api/driver/trip/${trip._id}/accept`).set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });
  it('a guest token on /api/driver/* gets 403', async () => {
    const {
      token
    } = await makeGuest();
    const res = await request(app).get('/api/driver/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
  it('a guest token on /api/admin/* gets 403', async () => {
    const {
      token
    } = await makeGuest();
    const res = await request(app).get('/api/admin/drivers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
  it('no /api/driver/* response body leaks another driver\'s id', async () => {
    const a = await makeDriver('Driver A');
    const b = await makeDriver('Driver B');
    const res = await request(app).get('/api/driver/me').set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(b.driver._id.toString());
  });
  it('unauthenticated requests get 401 on every non-public route', async () => {
    const protectedRoutes = [['get', '/api/guest/me'], ['get', '/api/driver/me'], ['get', '/api/admin/drivers'], ['post', '/api/dispatch/tick'], ['get', '/api/ai/digest']];
    for (const [method, path] of protectedRoutes) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });
  it('/api/health requires no auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
  it('an admin token can reach /api/admin/* routes', async () => {
    const {
      token
    } = await makeAdmin();
    const res = await request(app).get('/api/admin/drivers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
