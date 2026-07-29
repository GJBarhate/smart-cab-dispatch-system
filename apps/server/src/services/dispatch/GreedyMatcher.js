"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GreedyMatcher = void 0;
var _Driver = require("../../models/Driver");
var _RoutingService = require("../routing/RoutingService");
var _geo = require("../../utils/geo");
var _Feasibility = require("./Feasibility");
var _CostFunction = require("./CostFunction");
var _DriverStateService = require("./DriverStateService");
// Real-time path used between ticks — admin approvals, driver rejections,
// and the starvation sweep all need an answer now, not at the next tick
// (plan.md §8.7). Target: <800ms p95, mostly cache hits.

const RADIUS_STEPS_M = [12_000, 25_000, Number.POSITIVE_INFINITY];
async function candidateDrivers(demand, radiusM) {
  const query = {
    isActive: true,
    status: {
      $in: ['idle', 'assigned', 'on_trip']
    }
  };
  if (Number.isFinite(radiusM)) {
    query.currentLocation = {
      $near: {
        $geometry: (0, _geo.toGeoPoint)(demand.pickup),
        $maxDistance: radiusM
      }
    };
  }
  return _Driver.Driver.find(query).limit(15);
}
const GreedyMatcher = {
  async findBest(demand, cfg, now = new Date()) {
    let drivers = [];
    for (const radius of RADIUS_STEPS_M) {
      drivers = await candidateDrivers(demand, radius);
      if (drivers.length > 0) break;
    }
    if (drivers.length === 0) return null;
    const dispatchDrivers = drivers.map(d => ({
      doc: d,
      plain: _DriverStateService.DriverStateService.toDispatchDriver(d, now)
    }));
    if (dispatchDrivers.length === 0) return null;
    const {
      durations
    } = await _RoutingService.RoutingService.matrix(dispatchDrivers.map(d => d.plain.location), [demand.pickup]);
    let best = null;
    dispatchDrivers.forEach(({
      doc,
      plain
    }, i) => {
      const pickupEtaMin = (durations[i]?.[0] ?? Infinity) / 60;
      const estimatedTripEndAt = new Date(now.getTime() + (pickupEtaMin + 30) * 60_000);
      const feasibility = _Feasibility.Feasibility.check(plain, demand, {
        now,
        pickupEtaMin,
        estimatedTripEndAt
      }, cfg);
      if (!feasibility.ok) return;
      const arrivalAt = new Date(now.getTime() + pickupEtaMin * 60_000);
      const {
        total,
        breakdown
      } = _CostFunction.CostFunction.score(plain, demand, {
        now,
        pickupEtaMin,
        arrivalAt
      }, cfg);
      if (!best || total < best.score) {
        best = {
          driver: doc,
          score: total,
          breakdown,
          pickupEtaMin
        };
      }
    });
    return best;
  }
};
exports.GreedyMatcher = GreedyMatcher;
