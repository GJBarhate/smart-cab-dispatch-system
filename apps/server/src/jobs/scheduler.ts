import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { runDispatchTick } from './dispatchTick.job';
import { runReoptimize } from './reoptimize.job';
import { runStarvationSweep } from './starvationSweep.job';
import { runArrivalSweep } from './arrivalSweep.job';
import { runKeepalive } from './keepalive.job';

const tasks: Array<ReturnType<typeof cron.schedule>> = [];

function schedule(expr: string, name: string, run: () => Promise<void>): void {
  tasks.push(
    cron.schedule(expr, () => {
      run().catch((err) => logger.error({ err, job: name }, 'scheduled job failed'));
    })
  );
}

export function startScheduler(): void {
  if (tasks.length > 0) return; // already started

  schedule(env.DISPATCH_TICK_CRON, 'dispatch-tick', runDispatchTick);
  schedule(env.REOPTIMIZE_CRON, 'reoptimize', runReoptimize);
  schedule(env.STARVATION_SWEEP_CRON, 'starvation-sweep', runStarvationSweep);
  // Feeds the queue from scheduled arrivals — must run before the tick has
  // anything to match, so it gets its own (slower) cadence.
  schedule(env.ARRIVAL_SWEEP_CRON, 'arrival-sweep', async () => {
    await runArrivalSweep();
  });

  if (env.KEEPALIVE_URL) {
    schedule('*/14 * * * *', 'keepalive', runKeepalive);
  }

  logger.info({ jobs: tasks.length }, 'dispatch scheduler started');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
