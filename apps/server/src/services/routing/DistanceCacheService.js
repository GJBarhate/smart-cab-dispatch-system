"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DistanceCacheService = void 0;
exports.buildCacheKey = buildCacheKey;
var _lruCache = require("lru-cache");
var _ngeohash = _interopRequireDefault(require("ngeohash"));
var _DistanceCache = require("../../models/DistanceCache");
var _env = require("../../config/env");
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : {
    default: e
  };
}
// Four-layer cost-control strategy (plan.md §7.2):
//   1. Static Location<->Location grid, precomputed once at seed, never expires.
//   2. L1 in-memory LRU in front of Mongo.
//   3. L2 Mongo DistanceCache keyed by geohash-7 buckets (~153m x 153m) so a driver
//      crawling in traffic reuses the same cache entry instead of firing a request per GPS ping.
//   4. Batching — handled by RoutingService.matrix(), one /table call per tick.

const GEOHASH_PRECISION = 7;
const l1 = new _lruCache.LRUCache({
  max: 5000,
  ttl: 5 * 60 * 1000
});
let hits = 0;
let misses = 0;
function geohashOf(p) {
  return _ngeohash.default.encode(p.lat, p.lng, GEOHASH_PRECISION);
}
function buildCacheKey(a, b) {
  return `${geohashOf(a)}|${geohashOf(b)}|driving`;
}
const DistanceCacheService = {
  async get(a, b) {
    const key = buildCacheKey(a, b);
    const fromL1 = l1.get(key);
    if (fromL1) {
      hits++;
      return fromL1;
    }
    const doc = await _DistanceCache.DistanceCache.findOne({
      key
    }).lean();
    if (doc && (doc.isStatic || !doc.expiresAt || doc.expiresAt.getTime() > Date.now())) {
      hits++;
      const value = {
        distanceMeters: doc.distanceMeters,
        durationSeconds: doc.durationSeconds,
        provider: doc.provider
      };
      l1.set(key, value);
      return value;
    }
    misses++;
    return null;
  },
  async set(a, b, value, opts = {}) {
    const key = buildCacheKey(a, b);
    l1.set(key, value);
    const isStatic = opts.isStatic ?? false;
    await _DistanceCache.DistanceCache.updateOne({
      key
    }, {
      $set: {
        key,
        distanceMeters: value.distanceMeters,
        durationSeconds: value.durationSeconds,
        provider: value.provider,
        isStatic,
        expiresAt: isStatic ? null : new Date(Date.now() + _env.env.ROUTING_CACHE_TTL_SEC * 1000)
      }
    }, {
      upsert: true
    });
  },
  stats() {
    const total = hits + misses;
    return {
      hits,
      misses,
      hitRate: total === 0 ? 0 : hits / total
    };
  },
  resetStats() {
    hits = 0;
    misses = 0;
  }
};
exports.DistanceCacheService = DistanceCacheService;
