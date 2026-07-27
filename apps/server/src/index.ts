import { createServer } from 'http';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDb } from './config/db';
import './models'; // registers every model once, up front — `.populate()` throws MissingSchemaError for any ref whose model was never require()'d anywhere in the process
import { createApp } from './app';
import { createSocketServer } from './realtime/io';
import { startScheduler, stopScheduler } from './jobs/scheduler';

async function main(): Promise<void> {
  await connectDb();

  const app = createApp();
  const httpServer = createServer(app);
  createSocketServer(httpServer);
  startScheduler();

  httpServer.listen(env.PORT, () => {
    logger.info(`server listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopScheduler();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
