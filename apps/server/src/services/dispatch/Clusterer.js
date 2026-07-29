"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Clusterer = void 0;
var _geo = require("../../utils/geo");
// Groups compatible QueueEntries into shared-ride ClusterDemands (plan.md §8.6).
// Pure haversine-based heuristics only — no routing calls here. Spending an
// API call just to decide whether two pickups are "close enough" would
// violate the one-matrix-call-per-tick budget (§7.2); that budget is spent
// once the clusters are final, scoring them against drivers.

const SERVICE_TIME_PER_STOP_MIN = 3;
const NEARBY_DROPOFF_MERGE_KM = 1.5;
function timeBucket(at, windowMin) {
  return Math.floor(at.getTime() / (windowMin * 60_000));
}
function clusterKey(e, windowMin) {
  const pickupKey = e.pickupLocationId ?? `${e.pickup.lat.toFixed(4)},${e.pickup.lng.toFixed(4)}`;
  const dropKey = e.dropoffLocationId ?? `${e.dropoff.lat.toFixed(4)},${e.dropoff.lng.toFixed(4)}`;
  return `${e.type}|${pickupKey}|${dropKey}|${timeBucket(e.earliestAt, windowMin)}`;
}
function toClusterDemand(members) {
  return {
    memberEntryIds: members.map(m => m.id),
    type: members[0].type,
    guestIds: members.flatMap(m => m.guestIds),
    seats: members.reduce((s, m) => s + m.seats, 0),
    luggage: members.reduce((s, m) => s + m.luggage, 0),
    pickup: members[0].pickup,
    dropoff: members[0].dropoff,
    earliestAt: new Date(Math.max(...members.map(m => m.earliestAt.getTime()))),
    deadlineAt: new Date(Math.min(...members.map(m => m.deadlineAt.getTime()))),
    enqueuedAt: new Date(Math.min(...members.map(m => m.enqueuedAt.getTime()))),
    priorityTier: Math.max(...members.map(m => m.priorityTier)),
    wasRejectedBefore: members.some(m => m.wasRejectedBefore),
    sharedWith: members.length > 1 ? members.flatMap(m => m.guestIds) : []
  };
}
function canAdd(cluster, candidate, cfg, now) {
  if (cluster.length + 1 > cfg.maxSharedGuestsPerTrip) return false;
  const totalSeats = cluster.reduce((s, m) => s + m.seats, 0) + candidate.seats;
  const totalLuggage = cluster.reduce((s, m) => s + m.luggage, 0) + candidate.luggage;
  if (totalSeats > cfg.maxVehicleSeats || totalLuggage > cfg.maxVehicleLuggage) return false;
  for (const member of cluster) {
    if ((0, _geo.haversineKm)(member.pickup, candidate.pickup) * 1000 > cfg.clusterRadiusM) return false;
  }
  const stopCount = cluster.length + 1;
  const addedServiceMin = stopCount * SERVICE_TIME_PER_STOP_MIN;
  const earliestDeadline = Math.min(candidate.deadlineAt.getTime(), ...cluster.map(m => m.deadlineAt.getTime()));
  if (earliestDeadline < now.getTime() + addedServiceMin * 60_000) return false;
  return true;
}

/** directDistance(pickup, farthestDrop) * 1.25 >= totalPathDistance (corridor test, §8.6). */
function onCorridor(pickup, drops) {
  if (drops.length <= 1) return true;
  let farthest = drops[0];
  let farthestDist = 0;
  for (const d of drops) {
    const dist = (0, _geo.haversineKm)(pickup, d);
    if (dist > farthestDist) {
      farthestDist = dist;
      farthest = d;
    }
  }
  const direct = (0, _geo.haversineKm)(pickup, farthest);

  // Nearest-neighbour path length from pickup through all drops.
  const remaining = [...drops];
  let total = 0;
  let current = pickup;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = (0, _geo.haversineKm)(current, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    total += bestDist;
    current = remaining[bestIdx];
    remaining.splice(bestIdx, 1);
  }
  return direct * 1.25 >= total;
}
const Clusterer = {
  build(entries, cfg, now = new Date()) {
    const groups = new Map();
    for (const e of entries) {
      const key = clusterKey(e, cfg.clusterTimeWindowMin);
      const bucket = groups.get(key) ?? [];
      bucket.push(e);
      groups.set(key, bucket);
    }
    const firstPass = [];
    for (const bucket of groups.values()) {
      const clusters = [];
      for (const entry of bucket) {
        let placed = false;
        for (const cluster of clusters) {
          if (canAdd(cluster, entry, cfg, now)) {
            cluster.push(entry);
            placed = true;
            break;
          }
        }
        if (!placed) clusters.push([entry]);
      }
      firstPass.push(...clusters);
    }

    // Second pass: same pickup, different (nearby) drop-offs — common when a
    // group lands together but is staying at different hotels.
    const byPickup = new Map();
    for (const cluster of firstPass) {
      const pickupKey = cluster[0].pickupLocationId ?? `${cluster[0].pickup.lat.toFixed(4)},${cluster[0].pickup.lng.toFixed(4)}`;
      const list = byPickup.get(pickupKey) ?? [];
      list.push(cluster);
      byPickup.set(pickupKey, list);
    }
    const finalClusters = [];
    for (const clusters of byPickup.values()) {
      const merged = clusters.map(() => false);
      for (let i = 0; i < clusters.length; i++) {
        if (merged[i]) continue;
        let acc = clusters[i];
        for (let j = i + 1; j < clusters.length; j++) {
          if (merged[j]) continue;
          const timeDiffMin = Math.abs(acc[0].earliestAt.getTime() - clusters[j][0].earliestAt.getTime()) / 60_000;
          if (timeDiffMin > cfg.clusterTimeWindowMin) continue;
          const combinedCount = acc.length + clusters[j].length;
          const combinedSeats = acc.reduce((s, m) => s + m.seats, 0) + clusters[j].reduce((s, m) => s + m.seats, 0);
          const combinedLuggage = acc.reduce((s, m) => s + m.luggage, 0) + clusters[j].reduce((s, m) => s + m.luggage, 0);
          if (combinedCount > cfg.maxSharedGuestsPerTrip) continue;
          if (combinedSeats > cfg.maxVehicleSeats || combinedLuggage > cfg.maxVehicleLuggage) continue;
          const dropsA = acc.map(m => m.dropoff);
          const dropsB = clusters[j].map(m => m.dropoff);
          const allDropsClose = dropsA.every(a => dropsB.every(b => (0, _geo.haversineKm)(a, b) <= NEARBY_DROPOFF_MERGE_KM));
          const corridorOk = onCorridor(acc[0].pickup, [...dropsA, ...dropsB]);
          if (allDropsClose || corridorOk) {
            acc = [...acc, ...clusters[j]];
            merged[j] = true;
          }
        }
        finalClusters.push(acc);
      }
    }
    return finalClusters.map(toClusterDemand);
  }
};
exports.Clusterer = Clusterer;
