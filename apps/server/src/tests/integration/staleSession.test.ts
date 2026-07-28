// A token whose signature verifies but whose principal no longer exists must
// read as a dead session (401), never as a missing resource (404).
//
// The regression this guards: `npm run seed -- --fresh` wipes the collections
// and re-inserts with new ObjectIds, while the browser keeps the token signed
// against the old ones. The route-level `findById` then returned null and the
// handler threw NotFoundError, so the client — which only clears a session on
// 401 — held the dead token and retried forever. In the browser that showed up
// as an endless stream of 404s on /api/guest/me and /api/guest/trip/current.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver, makeGuest } from '../helpers/fixtures';
import { Driver } from '../../models/Driver';
import { Guest } from '../../models/Guest';
import { User } from '../../models/User';

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

describe('stale session (valid token, deleted principal)', () => {
  it('GET /api/guest/me returns 401 SESSION_STALE, not 404', async () => {
    const { guest, token } = await makeGuest();
    await Guest.deleteOne({ _id: guest._id }); // stand-in for a re-seed

    const res = await request(app).get('/api/guest/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_STALE');
  });

  it('GET /api/guest/trip/current returns 401 SESSION_STALE, not 404', async () => {
    const { guest, token } = await makeGuest();
    await Guest.deleteOne({ _id: guest._id });

    const res = await request(app).get('/api/guest/trip/current').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_STALE');
  });

  it('GET /api/driver/me returns 401 SESSION_STALE, not 404', async () => {
    const { driver, token } = await makeDriver();
    await Driver.deleteOne({ _id: driver._id });

    const res = await request(app).get('/api/driver/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_STALE');
  });

  it('GET /api/auth/me returns 401 SESSION_STALE for every role', async () => {
    const admin = await makeAdmin();
    await User.deleteOne({ _id: admin.user._id });
    const adminRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin.token}`);
    expect(adminRes.status).toBe(401);
    expect(adminRes.body.error.code).toBe('SESSION_STALE');

    const guest = await makeGuest();
    await Guest.deleteOne({ _id: guest.guest._id });
    const guestRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${guest.token}`);
    expect(guestRes.status).toBe(401);
    expect(guestRes.body.error.code).toBe('SESSION_STALE');
  });

  it('a live session is unaffected — the principal still exists', async () => {
    const { token } = await makeGuest();

    const res = await request(app).get('/api/guest/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('a genuinely missing *resource* still returns 404, not 401', async () => {
    // The distinction matters: only the caller's own identity going missing is
    // a session problem. Someone else's row being absent is an ordinary 404,
    // and collapsing the two would sign users out for a bad URL.
    const { token } = await makeGuest();

    const res = await request(app)
      .get('/api/guest/requests/aaaaaaaaaaaaaaaaaaaaaaaa')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
