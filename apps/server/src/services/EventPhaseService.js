"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.activePhase = activePhase;
exports.defaultTripType = defaultTripType;
var _shared = require("../shared");
// plan.md §6.3 — EventConfig.phases is an ordered array; the default trip type
// for a guest is decided by matching `now` against the active phase. Kept as a
// pure module so the arrival sweep and the tests can both use it without a DB.

const TRIP_TYPES = new Set(Object.values(_shared.TripType));
/**
 * The phase whose half-open window [startAt, endAt) contains `now`.
 * Half-open so back-to-back phases (one's endAt === the next's startAt) never
 * both match — the seed defines exactly that boundary at 18:00 on day 2.
 */
function activePhase(phases, now = new Date()) {
  const t = now.getTime();
  for (const p of phases ?? []) {
    if (!p?.startAt || !p?.endAt) continue;
    if (new Date(p.startAt).getTime() <= t && t < new Date(p.endAt).getTime()) return p;
  }
  return null;
}

/**
 * Default trip type for `now`. Falls back to ARRIVAL_PICKUP outside every
 * phase (e.g. before the event opens) rather than throwing — a dispatch tick
 * must never fail because the clock drifted past the last configured phase.
 */
function defaultTripType(cfg, now = new Date()) {
  const phase = activePhase(cfg?.phases, now);
  const candidate = phase?.defaultTripType;
  return candidate && TRIP_TYPES.has(candidate) ? candidate : _shared.TripType.ARRIVAL_PICKUP;
}
