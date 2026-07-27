// Continuous ETA correction over all active trips (plan.md §8.10). Runs on
// its own cron (REOPTIMIZE_CRON), independent of the dispatch tick. A
// boarded guest is never re-optimized away from — yanking a boarded guest is
// worse than being late, so only the DEADLINE_AT_RISK alert path applies once
// a trip has boarded passengers.
import { Trip } from '../../models/Trip';
import { Driver } from '../../models/Driver';
import { RoutingService } from '../routing/RoutingService';
import { NotificationService } from '../NotificationService';
import { AlertService } from '../AlertService';
import { toLatLng } from '../../utils/geo';
import { minutesBetween } from '../../utils/time';
import { TripService } from './TripService';

const ETA_DRIFT_ALERT_MIN = 3;
const ACTIVE_STATUSES = ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup', 'boarded'];

export interface ReoptimizeReport {
  tripsChecked: number;
  etaUpdates: number;
  deadlineAlerts: number;
  requeued: number;
}

export const Reoptimizer = {
  async run(now: Date = new Date()): Promise<ReoptimizeReport> {
    const trips = await Trip.find({ status: { $in: ACTIVE_STATUSES } });
    const report: ReoptimizeReport = { tripsChecked: 0, etaUpdates: 0, deadlineAlerts: 0, requeued: 0 };

    for (const trip of trips) {
      report.tripsChecked++;
      if (!trip.driverId) continue;

      const driver = await Driver.findById(trip.driverId).select('currentLocation').lean();
      if (!driver) continue;

      const pending = trip.stops.filter((s) => s.status === 'pending').sort((a, b) => a.seq - b.seq);
      if (pending.length === 0) continue;

      let cursor = toLatLng(driver.currentLocation as any);
      let cumulativeSeconds = 0;
      let driftedByMoreThan3Min = false;
      const stopEtas: Array<{ seq: number; etaAt: Date }> = [];

      for (const stop of pending) {
        const dest = toLatLng(stop.coordinates as any);
        const { durationSeconds, source } = await RoutingService.eta(cursor, dest);
        cumulativeSeconds += durationSeconds;
        const newEtaAt = new Date(now.getTime() + cumulativeSeconds * 1000);

        const previousEtaAt = stop.etaAt;
        if (previousEtaAt && Math.abs(minutesBetween(previousEtaAt, newEtaAt)) > ETA_DRIFT_ALERT_MIN) {
          driftedByMoreThan3Min = true;
        }

        stopEtas.push({ seq: stop.seq, etaAt: newEtaAt });
        cursor = dest;

        void source; // logged upstream by RoutingService.stats(); not needed per-stop here
      }

      await Trip.updateOne(
        { _id: trip._id },
        { $set: Object.fromEntries(stopEtas.map((e) => [`stops.${trip.stops.findIndex((s) => s.seq === e.seq)}.etaAt`, e.etaAt])) }
      );

      if (driftedByMoreThan3Min) {
        report.etaUpdates++;
        NotificationService.tripEta(trip._id.toString(), {
          tripId: trip._id.toString(),
          stops: stopEtas.map((e) => ({ seq: e.seq, etaAt: e.etaAt.toISOString() })),
          source: 'reoptimizer'
        });
      }

      const finalEtaAt = stopEtas[stopEtas.length - 1]?.etaAt;
      if (trip.deadlineAt && finalEtaAt && finalEtaAt.getTime() > trip.deadlineAt.getTime()) {
        const slipMin = Math.round(minutesBetween(trip.deadlineAt, finalEtaAt));

        if (trip.status === 'pending_driver' || trip.status === 'accepted') {
          // Not started yet — free the driver and re-queue at boosted priority
          // rather than let a doomed trip sit on the books.
          const guestIds = trip.guests.map((g) => g.guestId.toString());
          await TripService.requeueGuests(guestIds, 'deadline_at_risk_before_start');
          await TripService.releaseDriver(trip.driverId.toString());
          await Trip.updateOne({ _id: trip._id }, { $set: { status: 'unassignable' } });
          report.requeued++;
        } else {
          report.deadlineAlerts++;
        }

        await AlertService.raise('warning', 'DEADLINE_AT_RISK', `Trip ${trip.code} is projected ${slipMin}min past its deadline`, {
          type: 'Trip',
          id: trip._id.toString()
        });
      }
    }

    return report;
  }
};
