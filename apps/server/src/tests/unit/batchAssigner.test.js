import { describe, expect, it } from 'vitest';
import { BatchAssigner } from '../../services/dispatch/BatchAssigner';
import { BIG_M } from '../../services/dispatch/types';
describe('BatchAssigner.solve', () => {
  it('solves a known 3x3 matrix optimally', () => {
    // Optimal assignment is (0,1),(1,0),(2,2) = 1+2+2 = 5 (checked exhaustively
    // over all 6 permutations).
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
    const pairs = BatchAssigner.solve(cost);
    const total = pairs.reduce((sum, p) => sum + cost[p.driverIndex][p.demandIndex], 0);
    expect(pairs).toHaveLength(3);
    expect(total).toBe(5);
  });
  it('assigns all demands in a rectangular 5 drivers x 3 demands matrix, no driver reused', () => {
    const cost = [[10, 20, 30], [15, 5, 25], [40, 40, 1], [8, 8, 8], [50, 50, 50]];
    const pairs = BatchAssigner.solve(cost);
    expect(pairs).toHaveLength(3);
    const drivers = pairs.map(p => p.driverIndex);
    expect(new Set(drivers).size).toBe(drivers.length);
    const demands = pairs.map(p => p.demandIndex).sort();
    expect(demands).toEqual([0, 1, 2]);
  });
  it('never selects an infeasible (BIG_M) pair when a feasible alternative exists', () => {
    const cost = [[BIG_M, 5], [5, BIG_M]];
    const pairs = BatchAssigner.solve(cost);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(cost[p.driverIndex][p.demandIndex]).toBeLessThan(BIG_M);
    }
  });
  it('drops a pair entirely rather than commit an infeasible one when no feasible alternative exists', () => {
    const cost = [[BIG_M, BIG_M], [5, BIG_M]];
    const pairs = BatchAssigner.solve(cost);
    for (const p of pairs) {
      expect(cost[p.driverIndex][p.demandIndex]).toBeLessThan(BIG_M);
    }
    expect(pairs.length).toBeLessThanOrEqual(1);
  });
  it('solves a 100x100 random matrix in under 500ms', () => {
    const n = 100;
    const cost = Array.from({
      length: n
    }, () => Array.from({
      length: n
    }, () => Math.round(Math.random() * 1000)));
    const start = Date.now();
    const pairs = BatchAssigner.solve(cost);
    const elapsed = Date.now() - start;
    expect(pairs).toHaveLength(n);
    expect(elapsed).toBeLessThan(500);
  });
});
