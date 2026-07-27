import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { healthRouter } from './routes/health.routes';
import { authRouter } from './routes/auth.routes';
import { guestRouter } from './routes/guest.routes';
import { driverRouter } from './routes/driver.routes';
import { adminRouter } from './routes/admin.routes';
import { dispatchRouter } from './routes/dispatch.routes';
import { aiRouter } from './routes/ai.routes';
import { notFoundHandler, errorHandler } from './middleware/error';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN_LIST,
      credentials: true
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  const authLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again shortly', details: null } }
  });

  app.use('/api/health', healthRouter);
  app.use('/api/auth/guest/login', authLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/guest', guestRouter);
  app.use('/api/driver', driverRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/dispatch', dispatchRouter);
  app.use('/api/ai', aiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
