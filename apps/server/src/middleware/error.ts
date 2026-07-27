import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../config/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, details: null } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details ?? null } });
    return;
  }

  logger.error({ err }, 'unhandled error');
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? 'Internal server error' : message, details: null } });
}
