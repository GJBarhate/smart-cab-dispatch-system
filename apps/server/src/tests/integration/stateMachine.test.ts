// Every invalid trip-status transition returns 409; the full valid path
// succeeds (plan.md §13.2).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, stopTestDb, clearTestDb } from '../helpers/testDb';
import { makeDriver, makeGuest } from '../helpers/fixtures';
import { Trip } from '../../models/Trip';
import { TripService } from '../../services/dispatch/TripService';
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

async function makeTrip(driverId: string, guestId: string) {
  return Trip.create({
    code: `T-SM${Date.now()}${Math.random()}`,
    type: 'ON_DEMAND',
    status: 'pending_driver',
    driverId,
    vehicleSnapshot: { number: 'x', model: 'x', seats: 4, luggage: 3 },
    guests: [{ guestId, name: 'G', seats: 1, luggage: 1 }],
    stops: [
      { seq: 0, kind: 'pickup', guestIds: [guestId], coordinates: toGeoPoint({ lat: 18.55, lng: 73.85 }), status: 'pending' },
      { seq: 1, kind: 'drop', guestIds: [guestId], coordinates: toGeoPoint({ lat: 18.56, lng: 73.86 }), status: 'pending' }
    ],
    capacityUsed: { seats: 1, luggage: 1 }
  });
}

describe('Trip state machine', () => {
  it('rejects every invalid transition with a 409-style ConflictError', async () => {
    const { driver } = await makeDriver();
    const { guest } = await makeGuest();
    const trip = await makeTrip(driver._id.toString(), guest._id.toString());

    // Can't skip straight from pending_driver to boarded, completed, or at_pickup.
    await expect(TripService.transition(trip._id.toString(), 'boarded', 'test')).rejects.toMatchObject({ status: 409 });
    await expect(TripService.transition(trip._id.toString(), 'completed', 'test')).rejects.toMatchObject({ status: 409 });
    await expect(TripService.transition(trip._id.toString(), 'at_pickup', 'test')).rejects.toMatchObject({ status: 409 });
  });

  it('rejects transitioning out of a terminal state', async () => {
    const { driver } = await makeDriver();
    const { guest } = await makeGuest();
    const trip = await makeTrip(driver._id.toString(), guest._id.toString());

    await TripService.transition(trip._id.toString(), 'rejected', 'test');
    await expect(TripService.transition(trip._id.toString(), 'accepted', 'test')).rejects.toMatchObject({ status: 409 });
  });

  it('allows the full valid path from pending_driver to completed', async () => {
    const { driver } = await makeDriver();
    const { guest } = await makeGuest();
    const trip = await makeTrip(driver._id.toString(), guest._id.toString());

    await TripService.transition(trip._id.toString(), 'accepted', 'test');
    await TripService.transition(trip._id.toString(), 'en_route_pickup', 'test');
    await TripService.transition(trip._id.toString(), 'at_pickup', 'test');
    await TripService.transition(trip._id.toString(), 'boarded', 'test');
    const completed = await TripService.transition(trip._id.toString(), 'completed', 'test');

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
  });

  it('allows cancellation from most non-terminal states', async () => {
    const { driver } = await makeDriver();
    const { guest } = await makeGuest();
    const trip = await makeTrip(driver._id.toString(), guest._id.toString());

    await TripService.transition(trip._id.toString(), 'accepted', 'test');
    const cancelled = await TripService.transition(trip._id.toString(), 'cancelled', 'test');
    expect(cancelled.status).toBe('cancelled');
  });
});
