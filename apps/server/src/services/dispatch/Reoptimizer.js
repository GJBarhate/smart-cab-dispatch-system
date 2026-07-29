"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Reoptimizer = void 0;
var _Trip = require("../../models/Trip");
var _Driver = require("../../models/Driver");
var _RoutingService = require("../routing/RoutingService");
var _NotificationService = require("../NotificationService");
var _AlertService = require("../AlertService");
var _geo = require("../../utils/geo");
var _time = require("../../utils/time");
var _TripService = require("./TripService");
// Continuous ETA correction over all active trips (plan.md §8.10). Runs on
// its own cron (REOPTIMIZE_CRON), independent of the dispatch tick. A
// boarded guest is never re-optimized away from — yanking a boarded guest is
// worse than being late, so only the DEADLINE_AT_RISK alert path applies once
// a trip has boarded passengers.

const ETA_DRIFT_ALERT_MIN = 3;
const ACTIVE_STATUSES = ['pending_driver', 'accepted', 'en_route_pickup', 'at_pickup', 'boarded'];
const Reoptimizer = {
  async run(now = new Date()) {
    const trips = await _Trip.Trip.find({
      status: {
        $in: ACTIVE_STATUSES
      }
    });
    const report = {
      tripsChecked: 0,
      etaUpdates: 0,
      deadlineAlerts: 0,
      requeued: 0
    };
    for (const trip of trips) {
      report.tripsChecked++;
      if (!trip.driverId) continue;
      const driver = await _Driver.Driver.findById(trip.driverId).select('currentLocation').lean();
      if (!driver) continue;
      const pending = trip.stops.filter(s => s.status === 'pending').sort((a, b) => a.seq - b.seq);
      if (pending.length === 0) continue;
      let cursor = (0, _geo.toLatLng)(driver.currentLocation);
      let cumulativeSeconds = 0;
      let driftedByMoreThan3Min = false;
      const stopEtas = [];
      for (const stop of pending) {
        const dest = (0, _geo.toLatLng)(stop.coordinates);
        const {
          durationSeconds,
          source
        } = await _RoutingService.RoutingService.eta(cursor, dest);
        cumulativeSeconds += durationSeconds;
        const newEtaAt = new Date(now.getTime() + cumulativeSeconds * 1000);
        const previousEtaAt = stop.etaAt;
        if (previousEtaAt && Math.abs((0, _time.minutesBetween)(previousEtaAt, newEtaAt)) > ETA_DRIFT_ALERT_MIN) {
          driftedByMoreThan3Min = true;
        }
        stopEtas.push({
          seq: stop.seq,
          etaAt: newEtaAt
        });
        cursor = dest;
        void source; // logged upstream by RoutingService.stats(); not needed per-stop here
      }
      await _Trip.Trip.updateOne({
        _id: trip._id
      }, {
        $set: Object.fromEntries(stopEtas.map(e => [`stops.${trip.stops.findIndex(s => s.seq === e.seq)}.etaAt`, e.etaAt]))
      });
      if (driftedByMoreThan3Min) {
        report.etaUpdates++;
        _NotificationService.NotificationService.tripEta(trip._id.toString(), {
          tripId: trip._id.toString(),
          stops: stopEtas.map(e => ({
            seq: e.seq,
            etaAt: e.etaAt.toISOString()
          })),
          source: 'reoptimizer'
        });
      }
      const finalEtaAt = stopEtas[stopEtas.length - 1]?.etaAt;
      if (trip.deadlineAt && finalEtaAt && finalEtaAt.getTime() > trip.deadlineAt.getTime()) {
        const slipMin = Math.round((0, _time.minutesBetween)(trip.deadlineAt, finalEtaAt));
        if (trip.status === 'pending_driver' || trip.status === 'accepted') {
          // Not started yet — free the driver and re-queue at boosted priority
          // rather than let a doomed trip sit on the books.
          const guestIds = trip.guests.map(g => g.guestId.toString());
          await _TripService.TripService.requeueGuests(guestIds, 'deadline_at_risk_before_start');
          await _TripService.TripService.releaseDriver(trip.driverId.toString());
          await _TripService.TripService.transition(trip._id.toString(), 'unassignable', 'reoptimizer');
          report.requeued++;
        } else {
          report.deadlineAlerts++;
        }
        await _AlertService.AlertService.raise('warning', 'DEADLINE_AT_RISK', `Trip ${trip.code} is projected ${slipMin}min past its deadline`, {
          type: 'Trip',
          id: trip._id.toString()
        });
      }
    }
    return report;
  }
};
exports.Reoptimizer = Reoptimizer;
