// Recomputes each demand's priorityScore and flags starvation pre-emption
// candidates (plan.md §8.2 step 1, §8.4 hard rule). Pure — takes and returns
// plain objects; callers persist the result to QueueEntry documents.
import { priorityScore } from './CostFunction';
import type { DispatchDemand } from './types';

export interface ScoredDemand extends DispatchDemand {
  priorityScore: number;
  isStarving: boolean;
}

export const PriorityQueue = {
  recomputeScores(demands: DispatchDemand[], starvationThresholdMin: number, now: Date = new Date()): ScoredDemand[] {
    return demands
      .map((d) => ({
        ...d,
        priorityScore: priorityScore(d, now),
        isStarving: d.waitedMinutes > starvationThresholdMin
      }))
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }
};
