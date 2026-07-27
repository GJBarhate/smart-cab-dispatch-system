// Hungarian assignment over a driver x demand cost matrix (plan.md §8.5).
// Padded to square with BIG_M dummy rows/cols — munkres-js requires a square
// matrix and would otherwise throw or silently misbehave (plan.md §16.22).
import munkres from 'munkres-js';
import { BIG_M } from './types';

// Above this, Hungarian's O(n^3) stops being "single-digit milliseconds" and
// we fall back to greedy instead (documented threshold, plan.md §8.5).
export const MAX_HUNGARIAN_SIZE = 150;

export interface AssignmentPair {
  driverIndex: number;
  demandIndex: number;
}

function greedyFallback(cost: number[][]): AssignmentPair[] {
  const n = cost.length;
  const m = n > 0 ? cost[0].length : 0;
  const usedDrivers = new Set<number>();
  const usedDemands = new Set<number>();
  const pairs: Array<{ i: number; j: number; c: number }> = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (cost[i][j] < BIG_M) pairs.push({ i, j, c: cost[i][j] });
    }
  }
  pairs.sort((a, b) => a.c - b.c);

  const result: AssignmentPair[] = [];
  for (const { i, j } of pairs) {
    if (usedDrivers.has(i) || usedDemands.has(j)) continue;
    usedDrivers.add(i);
    usedDemands.add(j);
    result.push({ driverIndex: i, demandIndex: j });
  }
  return result;
}

export const BatchAssigner = {
  /**
   * Solves a (possibly rectangular) driver x demand cost matrix. Returns only
   * feasible pairs (cost < BIG_M) — dummy rows/cols and infeasible cells are
   * dropped, never committed.
   */
  solve(cost: number[][]): AssignmentPair[] {
    const n = cost.length;
    if (n === 0) return [];
    const m = cost[0].length;
    if (m === 0) return [];

    if (n > MAX_HUNGARIAN_SIZE || m > MAX_HUNGARIAN_SIZE) {
      return greedyFallback(cost).filter(({ driverIndex, demandIndex }) => cost[driverIndex][demandIndex] < BIG_M);
    }

    const size = Math.max(n, m);
    const padded: number[][] = Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i < n && j < m ? cost[i][j] : BIG_M))
    );

    const raw = munkres(padded);

    return raw
      .filter(([i, j]) => i < n && j < m)
      .filter(([i, j]) => cost[i][j] < BIG_M)
      .map(([i, j]) => ({ driverIndex: i, demandIndex: j }));
  }
};
