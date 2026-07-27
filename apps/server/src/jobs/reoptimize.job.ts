import { Reoptimizer } from '../services/dispatch/Reoptimizer';
import { logger } from '../config/logger';

export async function runReoptimize(): Promise<void> {
  const report = await Reoptimizer.run();
  logger.info({ report }, 'reoptimize pass complete');
}
