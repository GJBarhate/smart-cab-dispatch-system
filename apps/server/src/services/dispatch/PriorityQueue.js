"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PriorityQueue = void 0;
var _CostFunction = require("./CostFunction");
// Recomputes each demand's priorityScore and flags starvation pre-emption
// candidates (plan.md §8.2 step 1, §8.4 hard rule). Pure — takes and returns
// plain objects; callers persist the result to QueueEntry documents.

const PriorityQueue = {
  recomputeScores(demands, starvationThresholdMin, now = new Date()) {
    return demands.map(d => ({
      ...d,
      priorityScore: (0, _CostFunction.priorityScore)(d, now),
      isStarving: d.waitedMinutes > starvationThresholdMin
    })).sort((a, b) => b.priorityScore - a.priorityScore);
  }
};
exports.PriorityQueue = PriorityQueue;
