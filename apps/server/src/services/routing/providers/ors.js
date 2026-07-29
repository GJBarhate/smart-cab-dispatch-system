"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.orsProvider = void 0;
var _env = require("../../../config/env");
var _errors = require("../../../utils/errors");
// OpenRouteService — optional fallback (2,000 directions/day free), only used when
// ORS_API_KEY is set and OSRM has failed. See plan.md §7.4 fallback chain.

const BASE_URL = 'https://api.openrouteservice.org/v2';
async function postJson(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _env.env.ROUTING_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: _env.env.ORS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) throw new _errors.UpstreamError(`ORS responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
const orsProvider = {
  name: 'ors',
  async matrix(origins, dests) {
    const locations = [...origins, ...dests].map(p => [p.lng, p.lat]);
    const sources = origins.map((_, i) => i);
    const destinations = dests.map((_, i) => origins.length + i);
    const json = await postJson('/matrix/driving-car', {
      locations,
      sources,
      destinations,
      metrics: ['distance', 'duration']
    });
    return {
      durations: json.durations,
      distances: json.distances
    };
  },
  async route(waypoints) {
    const json = await postJson('/directions/driving-car', {
      coordinates: waypoints.map(p => [p.lng, p.lat])
    });
    const route = json.routes?.[0];
    if (!route) throw new _errors.UpstreamError('ORS returned no route');
    const legs = (route.segments ?? []).map(seg => ({
      distanceMeters: seg.distance,
      durationSeconds: seg.duration
    }));
    return {
      polyline: route.geometry,
      durationSeconds: route.summary.duration,
      distanceMeters: route.summary.distance,
      legs
    };
  }
};
exports.orsProvider = orsProvider;
