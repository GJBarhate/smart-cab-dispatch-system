"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TrafficModel = void 0;
var _geo = require("../../utils/geo");
// "Live traffic" without a live-traffic API — see plan.md §7.3 for the honesty framing.
// Four layers: time-of-day peak windows, an admin-controlled global multiplier,
// admin-dropped incident zones, and an EWMA of (actual/predicted) leg time
// observed from completed trips, bucketed by hour-of-day.

const EWMA_ALPHA = 0.3;
function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}
function parseHHMM(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
const TrafficModel = {
  multiplierFor(at, from, to, cfg) {
    let multiplier = 1.0;
    const nowMin = minutesOfDay(at);
    for (const w of cfg.peakWindows ?? []) {
      const start = parseHHMM(w.from);
      const end = parseHHMM(w.to);
      if (nowMin >= start && nowMin < end) {
        multiplier = Math.max(multiplier, w.multiplier);
      }
    }
    multiplier *= cfg.globalMultiplier ?? 1.0;
    for (const incident of cfg.incidents ?? []) {
      if (incident.expiresAt && incident.expiresAt.getTime() < at.getTime()) continue;
      const distToOrigin = (0, _geo.haversineKm)(from, {
        lat: incident.lat,
        lng: incident.lng
      }) * 1000;
      const distToDest = (0, _geo.haversineKm)(to, {
        lat: incident.lat,
        lng: incident.lng
      }) * 1000;
      if (distToOrigin <= incident.radiusM || distToDest <= incident.radiusM) {
        multiplier = Math.max(multiplier, incident.multiplier);
      }
    }
    const hourKey = String(at.getHours());
    const drift = cfg.hourlyDriftEwma?.[hourKey];
    if (typeof drift === 'number' && drift > 0) {
      multiplier *= drift;
    }
    return multiplier;
  },
  /** Rolls an observed (actual/predicted) ratio into the hour-of-day EWMA. */
  updateDrift(existing, hour, observedRatio) {
    const key = String(hour);
    const prev = existing[key] ?? 1.0;
    const clampedRatio = Math.min(3, Math.max(0.3, observedRatio));
    const next = prev * (1 - EWMA_ALPHA) + clampedRatio * EWMA_ALPHA;
    return {
      ...existing,
      [key]: Number(next.toFixed(3))
    };
  }
};
exports.TrafficModel = TrafficModel;
