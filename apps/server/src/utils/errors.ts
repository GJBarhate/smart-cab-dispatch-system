export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(404, `${what} not found`, 'NOT_FOUND');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

/**
 * The token verified, but the principal it names is gone from the database —
 * the usual cause is a re-seed (`npm run seed -- --fresh`) minting new ObjectIds
 * while a browser still holds a token signed against the old ones.
 *
 * This is a dead *session*, not a missing *resource*, so it must be a 401: a 404
 * leaves the client holding a token it will never be able to use, retrying
 * forever. 401 is the one status every client already self-heals from by
 * clearing the session and bouncing to the login screen.
 */
export class StaleSessionError extends AppError {
  constructor(what: string) {
    super(401, `Your session is no longer valid (${what} not found). Please sign in again.`, 'SESSION_STALE');
  }
}

export class ValidationError extends AppError {
  constructor(details?: unknown) {
    super(422, 'Validation failed', 'VALIDATION', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, message, 'UPSTREAM');
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, message, 'BAD_REQUEST', details);
  }
}
