// Hard pre-emption rule (plan.md §8.4): any QueueEntry waiting longer than
// starvationThresholdMin gets matched greedily against the nearest feasible
// driver *before* the next batch tick runs, trading optimality for fairness.
import { EventConfig } from '../models/EventConfig';
import { QueueEntry } from '../models/QueueEntry';
import { DispatchEngine } from '../services/dispatch/DispatchEngine';
import { logger } from '../config/logger';

export async function runStarvationSweep(): Promise<void> {
  const cfgDoc = await EventConfig.findOne({ singleton: 'singleton' });
  if (!cfgDoc || !cfgDoc.featureFlags?.autoDispatchEnabled) return;

  const thresholdMin = cfgDoc.dispatch!.starvationThresholdMin!;
  const cutoff = new Date(Date.now() - thresholdMin * 60_000);

  const starving = await QueueEntry.find({ status: 'waiting', enqueuedAt: { $lte: cutoff } }).sort({ enqueuedAt: 1 });
  if (starving.length === 0) return;

  let matched = 0;
  for (const entry of starving) {
    const ok = await DispatchEngine.matchEntryNow(entry._id.toString(), 'starvation_sweep');
    if (ok) matched++;
  }

  logger.info({ starving: starving.length, matched }, 'starvation sweep complete');
}
