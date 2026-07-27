// Render free tier sleeps after 15 min idle (plan.md §14.4). If KEEPALIVE_URL
// is set, ping our own health endpoint every 14 minutes so the service pings
// itself awake while it's running (combine with an external UptimeRobot
// monitor for full coverage while it's actually asleep).
import { env } from '../config/env';
import { logger } from '../config/logger';

export async function runKeepalive(): Promise<void> {
  if (!env.KEEPALIVE_URL) return;
  try {
    const res = await fetch(env.KEEPALIVE_URL);
    logger.debug({ status: res.status }, 'keepalive ping');
  } catch (err) {
    logger.warn({ err }, 'keepalive ping failed');
  }
}
