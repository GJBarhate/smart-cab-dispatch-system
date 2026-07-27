// Bridges Mongoose Driver documents and the pure DispatchDriver shape the
// scoring path consumes (plan.md §8.2 step 1). Also refreshes predictedFreeAt
// / predictedFreeLocation for busy drivers so the batch matrix call can be
// scored against where a driver *will* be, not just where they are now.
import { Driver } from '../../models/Driver';
import { Trip } from '../../models/Trip';
import { RoutingService } from '../routing/RoutingService';
import { toGeoPoint, toLatLng } from '../../utils/geo';
import { minutesBetween } from '../../utils/time';
import type { DispatchConfig, DispatchDriver } from './types';

const BUSY_STATUSES = ['assigned', 'en_route_pickup', 'at_pickup', 'on_trip'];
const STOP_SERVICE_TIME_SEC = 180;

export const DriverStateService = {
  /** Walks each busy driver's remaining stops to estimate when/where they free up. */
  async refreshPredictedFreeState(): Promise<void> {
    const busyDrivers = await Driver.find({ status: { $in: BUSY_STATUSES }, currentTripId: { $ne: null } });

    for (const driver of busyDrivers) {
      const trip = await Trip.findById(driver.currentTripId).lean();
      if (!trip) continue;

      const pendingStops = trip.stops.filter((s) => s.status !== 'done').sort((a, b) => a.seq - b.seq);
      if (pendingStops.length === 0) {
        await Driver.updateOne(
          { _id: driver._id },
          { $set: { predictedFreeAt: new Date(), predictedFreeLocation: driver.currentLocation } }
        );
        continue;
      }

      let cursor = toLatLng(driver.currentLocation as any);
      let cumulativeSeconds = 0;
      for (const stop of pendingStops) {
        const dest = toLatLng(stop.coordinates as any);
        const { durationSeconds } = await RoutingService.eta(cursor, dest);
        cumulativeSeconds += durationSeconds + STOP_SERVICE_TIME_SEC;
        cursor = dest;
      }

      await Driver.updateOne(
        { _id: driver._id },
        {
          $set: {
            predictedFreeAt: new Date(Date.now() + cumulativeSeconds * 1000),
            predictedFreeLocation: toGeoPoint(cursor)
          }
        }
      );
    }
  },

  /** Idle drivers eligible to receive a new trip within the tick's batch horizon. */
  async listEligibleDrivers(cfg: DispatchConfig, now: Date = new Date()): Promise<Array<{ doc: InstanceType<typeof Driver>; plain: DispatchDriver }>> {
    const horizonAt = new Date(now.getTime() + cfg.batchHorizonMin * 60_000);

    const drivers = await Driver.find({
      isActive: true,
      status: { $in: ['idle', 'assigned', 'on_trip'] },
      $or: [{ 'break.onBreakUntil': null }, { 'break.onBreakUntil': { $lte: now } }],
      predictedFreeAt: { $lte: horizonAt }
    });

    return drivers.map((doc) => ({ doc, plain: DriverStateService.toDispatchDriver(doc, now) }));
  },

  toDispatchDriver(driver: InstanceType<typeof Driver>, now: Date = new Date()): DispatchDriver {
    // An idle driver's predictedFreeAt is the moment they last became free —
    // there's no separate "became idle at" field, so it doubles as that
    // marker once status settles back to 'idle'.
    const idleMinutes =
      driver.status === 'idle' && driver.predictedFreeAt && driver.predictedFreeAt.getTime() <= now.getTime()
        ? Math.max(0, minutesBetween(driver.predictedFreeAt, now))
        : 0;

    return {
      id: driver._id.toString(),
      status: driver.status as DispatchDriver['status'],
      vehicleType: driver.vehicle!.type as DispatchDriver['vehicleType'],
      capacitySeats: driver.capacity!.seats,
      capacityLuggage: driver.capacity!.luggage,
      usedSeats: 0,
      usedLuggage: 0,
      location: toLatLng(driver.currentLocation as any),
      predictedFreeAt: driver.predictedFreeAt ?? now,
      predictedFreeLocation: toLatLng((driver.predictedFreeLocation ?? driver.currentLocation) as any),
      shiftEndAt: driver.shift?.endAt ?? null,
      tripsSinceBreak: driver.break?.tripsSinceBreak ?? 0,
      minutesSinceBreak: driver.break?.minutesSinceBreak ?? 0,
      onBreakUntil: driver.break?.onBreakUntil ?? null,
      idleMinutes,
      rejectedEntryIds: (driver.rejectedEntryIds ?? []).map((id: any) => id.toString())
    };
  }
};
