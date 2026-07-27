import { DispatchEngine } from '../services/dispatch/DispatchEngine';
import { logger } from '../config/logger';

export async function runDispatchTick(): Promise<void> {
  const report = await DispatchEngine.tick();
  if (report.skipped) {
    logger.debug({ report }, 'dispatch tick skipped');
    return;
  }
  logger.info({ report }, 'dispatch tick complete');
}
