"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ValidationError = exports.UpstreamError = exports.UnauthorizedError = exports.StaleSessionError = exports.NotFoundError = exports.ForbiddenError = exports.ConflictError = exports.BadRequestError = exports.AppError = void 0;
class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
exports.AppError = AppError;
class NotFoundError extends AppError {
  constructor(what) {
    super(404, `${what} not found`, 'NOT_FOUND');
  }
}
exports.NotFoundError = NotFoundError;
class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}
exports.ForbiddenError = ForbiddenError;
class UnauthorizedError extends AppError {
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
exports.UnauthorizedError = UnauthorizedError;
class StaleSessionError extends AppError {
  constructor(what) {
    super(401, `Your session is no longer valid (${what} not found). Please sign in again.`, 'SESSION_STALE');
  }
}
exports.StaleSessionError = StaleSessionError;
class ValidationError extends AppError {
  constructor(details) {
    super(422, 'Validation failed', 'VALIDATION', details);
  }
}
exports.ValidationError = ValidationError;
class ConflictError extends AppError {
  constructor(message) {
    super(409, message, 'CONFLICT');
  }
}
exports.ConflictError = ConflictError;
class UpstreamError extends AppError {
  constructor(message) {
    super(502, message, 'UPSTREAM');
  }
}
exports.UpstreamError = UpstreamError;
class BadRequestError extends AppError {
  constructor(message, details) {
    super(400, message, 'BAD_REQUEST', details);
  }
}
exports.BadRequestError = BadRequestError;
