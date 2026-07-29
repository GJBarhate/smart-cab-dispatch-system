// Phase 6 DONE WHEN (plan.md): a socket with no/invalid token is rejected;
// an admin sees every driver's position; a driver only ever joins their own
// trip room, never a global broadcast.
import { createServer } from 'http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { createSocketServer } from '../../realtime/io';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeAdmin, makeDriver } from '../helpers/fixtures';
import { Driver } from '../../models/Driver';
import { signToken } from '../../middleware/auth';
let httpServer;
let io;
let port;
beforeAll(async () => {
  await startTestDb();
  httpServer = createServer();
  io = createSocketServer(httpServer);
  await new Promise(resolve => httpServer.listen(0, resolve));
  port = httpServer.address().port;
}, 60_000);
afterAll(async () => {
  io.close();
  await new Promise(resolve => httpServer.close(() => resolve()));
  await stopTestDb();
});
afterEach(async () => {
  await clearTestDb();
});
function connectClient(token) {
  return ioClient(`http://localhost:${port}`, {
    auth: token ? {
      token
    } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true
  });
}
describe('Socket.IO realtime layer', () => {
  it('rejects a connection with no token', async () => {
    const client = connectClient();
    const result = await new Promise(resolve => {
      client.on('connect_error', err => resolve(err.message));
      client.on('connect', () => resolve('connected'));
    });
    expect(result).toBe('unauthorized');
    client.close();
  });
  it('rejects a connection with an invalid token', async () => {
    const client = connectClient('not-a-real-jwt');
    const result = await new Promise(resolve => {
      client.on('connect_error', err => resolve(err.message));
      client.on('connect', () => resolve('connected'));
    });
    expect(result).toBe('unauthorized');
    client.close();
  });
  it('an admin socket receives driver:position broadcasts', async () => {
    const {
      driver,
      token: driverToken
    } = await makeDriver();
    const {
      user: adminUser
    } = await makeAdmin();
    const adminToken = signToken({
      sub: adminUser._id.toString(),
      role: 'admin'
    });
    const adminClient = connectClient(adminToken);
    const driverClient = connectClient(driverToken);
    await Promise.all([new Promise(resolve => adminClient.on('connect', () => resolve())), new Promise(resolve => driverClient.on('connect', () => resolve()))]);
    const positionPromise = new Promise(resolve => adminClient.on('driver:position', resolve));
    driverClient.emit('driver:location', {
      lat: 18.6,
      lng: 73.9,
      heading: 90,
      speedKmph: 20
    });
    const payload = await positionPromise;
    expect(payload.driverId).toBe(driver._id.toString());
    expect(payload.lat).toBe(18.6);
    adminClient.close();
    driverClient.close();
  });
  it("a driver only joins their own trip room, never a global broadcast room", async () => {
    const a = await makeDriver('Driver A');
    const b = await makeDriver('Driver B');
    const clientA = connectClient(a.token);
    const clientB = connectClient(b.token);
    await Promise.all([new Promise(resolve => clientA.on('connect', () => resolve())), new Promise(resolve => clientB.on('connect', () => resolve()))]);

    // Driver B never subscribes to any trip; driver A's own-room location
    // relay must not reach driver B (no stray io.emit to everyone).
    let bReceived = false;
    clientB.on('driver:position', () => {
      bReceived = true;
    });
    await Driver.updateOne({
      _id: a.driver._id
    }, {
      $set: {
        currentTripId: null
      }
    });
    clientA.emit('driver:location', {
      lat: 18.61,
      lng: 73.91,
      heading: 0,
      speedKmph: 10
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(bReceived).toBe(false);
    clientA.close();
    clientB.close();
  });
});
