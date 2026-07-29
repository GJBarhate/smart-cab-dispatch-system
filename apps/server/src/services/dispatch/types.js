"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.COST_OFFSET = exports.BIG_M = void 0;
// Plain-object contracts for the dispatch engine. Nothing in this file or in
// Feasibility.ts / CostFunction.ts / BatchAssigner.ts / Clusterer.ts /
// GroupSplitter.ts may import Express or Mongoose — the scoring path stays
// pure and unit-testable with plain objects (plan.md §8).

const BIG_M = 1e9;
exports.BIG_M = BIG_M;
const COST_OFFSET = 500;
exports.COST_OFFSET = COST_OFFSET;
