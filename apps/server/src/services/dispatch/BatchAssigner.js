"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_HUNGARIAN_SIZE = exports.BatchAssigner = void 0;
var _munkresJs = _interopRequireDefault(require("munkres-js"));
var _types = require("./types");
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : {
    default: e
  };
}
// Hungarian assignment over a driver x demand cost matrix (plan.md §8.5).
// Padded to square with BIG_M dummy rows/cols — munkres-js requires a square
// matrix and would otherwise throw or silently misbehave (plan.md §16.22).

// Above this, Hungarian's O(n^3) stops being "single-digit milliseconds" and
// we fall back to greedy instead (documented threshold, plan.md §8.5).
const MAX_HUNGARIAN_SIZE = 150;
exports.MAX_HUNGARIAN_SIZE = MAX_HUNGARIAN_SIZE;
function greedyFallback(cost) {
  const n = cost.length;
  const m = n > 0 ? cost[0].length : 0;
  const usedDrivers = new Set();
  const usedDemands = new Set();
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (cost[i][j] < _types.BIG_M) pairs.push({
        i,
        j,
        c: cost[i][j]
      });
    }
  }
  pairs.sort((a, b) => a.c - b.c);
  const result = [];
  for (const {
    i,
    j
  } of pairs) {
    if (usedDrivers.has(i) || usedDemands.has(j)) continue;
    usedDrivers.add(i);
    usedDemands.add(j);
    result.push({
      driverIndex: i,
      demandIndex: j
    });
  }
  return result;
}
const BatchAssigner = {
  /**
   * Solves a (possibly rectangular) driver x demand cost matrix. Returns only
   * feasible pairs (cost < BIG_M) — dummy rows/cols and infeasible cells are
   * dropped, never committed.
   */
  solve(cost) {
    const n = cost.length;
    if (n === 0) return [];
    const m = cost[0].length;
    if (m === 0) return [];
    if (n > MAX_HUNGARIAN_SIZE || m > MAX_HUNGARIAN_SIZE) {
      return greedyFallback(cost).filter(({
        driverIndex,
        demandIndex
      }) => cost[driverIndex][demandIndex] < _types.BIG_M);
    }
    const size = Math.max(n, m);
    const padded = Array.from({
      length: size
    }, (_, i) => Array.from({
      length: size
    }, (_, j) => i < n && j < m ? cost[i][j] : _types.BIG_M));
    const raw = (0, _munkresJs.default)(padded);
    return raw.filter(([i, j]) => i < n && j < m).filter(([i, j]) => cost[i][j] < _types.BIG_M).map(([i, j]) => ({
      driverIndex: i,
      demandIndex: j
    }));
  }
};
exports.BatchAssigner = BatchAssigner;
