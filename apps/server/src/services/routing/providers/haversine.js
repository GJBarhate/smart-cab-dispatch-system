"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.haversineProvider = void 0;
var _geo = require("../../../utils/geo");
var _env = require("../../../config/env");
// The provider of last resort. Never fails, never throws, never touches the network.
// distanceKm = haversine * HAVERSINE_ROAD_FACTOR ; seconds = distanceKm / avgSpeed * 3600

function estimate(a, b) {
  const km = (0, _geo.haversineKm)(a, b) * _env.env.HAVERSINE_ROAD_FACTOR;
  const hours = km / _env.env.HAVERSINE_AVG_SPEED_KMPH;
  return {
    distanceMeters: Math.round(km * 1000),
    durationSeconds: Math.round(hours * 3600)
  };
}
const haversineProvider = {
  name: 'haversine',
  async matrix(origins, dests) {
    const durations = [];
    const distances = [];
    for (const o of origins) {
      const durRow = [];
      const distRow = [];
      for (const d of dests) {
        const e = estimate(o, d);
        durRow.push(e.durationSeconds);
        distRow.push(e.distanceMeters);
      }
      durations.push(durRow);
      distances.push(distRow);
    }
    return {
      durations,
      distances
    };
  },
  async route(waypoints) {
    if (waypoints.length < 2) {
      return {
        polyline: (0, _geo.encodePolyline)(waypoints),
        durationSeconds: 0,
        distanceMeters: 0,
        legs: []
      };
    }
    let totalDistance = 0;
    let totalDuration = 0;
    const legs = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
      const e = estimate(waypoints[i], waypoints[i + 1]);
      totalDistance += e.distanceMeters;
      totalDuration += e.durationSeconds;
      legs.push({
        distanceMeters: e.distanceMeters,
        durationSeconds: e.durationSeconds
      });
    }
    return {
      polyline: (0, _geo.encodePolyline)(waypoints),
      durationSeconds: totalDuration,
      distanceMeters: totalDistance,
      legs
    };
  }
};
exports.haversineProvider = haversineProvider;
