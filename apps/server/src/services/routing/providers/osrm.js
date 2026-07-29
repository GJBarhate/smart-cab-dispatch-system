"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.osrmProvider = exports._decode = void 0;
var _geo = require("../../../utils/geo");
var _env = require("../../../config/env");
var _errors = require("../../../utils/errors");
// Public OSRM demo server: no key, no cost, no SLA, /table capped at ~10,000 cells.
// /table returns durations in SECONDS and distances in METRES, only when
// annotations=duration,distance is passed (plan.md §16.27).

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _env.env.ROUTING_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal
    });
    if (!res.ok) throw new _errors.UpstreamError(`OSRM responded ${res.status}`);
    const json = await res.json();
    if (json.code !== 'Ok') throw new _errors.UpstreamError(`OSRM error: ${json.code} ${json.message ?? ''}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}
async function tableChunk(origins, dests) {
  const combined = [...origins, ...dests];
  const sources = origins.map((_, i) => i).join(';');
  const destinations = dests.map((_, i) => origins.length + i).join(';');
  const coords = (0, _geo.toOsrmCoords)(combined);
  const url = `${_env.env.OSRM_BASE_URL}/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration,distance`;
  const json = await fetchJson(url);
  const durations = json.durations;
  const distances = json.distances ?? durations.map(row => row.map(() => 0));
  return {
    durations,
    distances
  };
}
const osrmProvider = {
  name: 'osrm',
  async matrix(origins, dests) {
    const totalCells = origins.length * dests.length;
    if (totalCells === 0) return {
      durations: [],
      distances: []
    };
    if (totalCells <= _env.env.OSRM_MAX_MATRIX_CELLS) {
      return tableChunk(origins, dests);
    }

    // Chunk along the destination axis to stay under the cell cap.
    const maxDestsPerChunk = Math.max(1, Math.floor(_env.env.OSRM_MAX_MATRIX_CELLS / origins.length));
    const durations = origins.map(() => []);
    const distances = origins.map(() => []);
    for (let i = 0; i < dests.length; i += maxDestsPerChunk) {
      const chunkDests = dests.slice(i, i + maxDestsPerChunk);
      const chunkResult = await tableChunk(origins, chunkDests);
      chunkResult.durations.forEach((row, r) => durations[r].push(...row));
      chunkResult.distances.forEach((row, r) => distances[r].push(...row));
    }
    return {
      durations,
      distances
    };
  },
  async route(waypoints) {
    const coords = (0, _geo.toOsrmCoords)(waypoints);
    const url = `${_env.env.OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=polyline&annotations=duration,distance`;
    const json = await fetchJson(url);
    const route = json.routes?.[0];
    if (!route) throw new _errors.UpstreamError('OSRM returned no route');
    const legs = (route.legs ?? []).map(leg => ({
      distanceMeters: leg.distance,
      durationSeconds: leg.duration
    }));
    return {
      polyline: route.geometry,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
      legs
    };
  }
};

// Exported for tests that want to sanity-check the decoded shape without a network call.
exports.osrmProvider = osrmProvider;
const _decode = _geo.decodePolyline;
exports._decode = _decode;
