"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.errorHandler = errorHandler;
exports.notFoundHandler = notFoundHandler;
var _errors = require("../utils/errors");
var _logger = require("../config/logger");
function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      details: null
    }
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof _errors.AppError) {
    if (err.status >= 500) _logger.logger.error({
      err
    }, err.message);
    res.status(err.status).json({
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null
      }
    });
    return;
  }
  _logger.logger.error({
    err
  }, 'unhandled error');
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({
    ok: false,
    error: {
      code: 'INTERNAL',
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
      details: null
    }
  });
}
