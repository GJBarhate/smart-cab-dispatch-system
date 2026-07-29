"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
exports.signToken = signToken;
exports.verifyToken = verifyToken;
var _express = require("express");
var _jsonwebtoken = _interopRequireDefault(require("jsonwebtoken"));
var _env = require("../config/env");
var _errors = require("../utils/errors");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The JWT is the only source of identity. No endpoint may accept `driverId` or
// `guestId` from the request body/query for scoping — always read them from req.user.

function signToken(payload) {
  return _jsonwebtoken.default.sign(payload, _env.env.JWT_SECRET, {
    expiresIn: _env.env.JWT_EXPIRES_IN
  });
}
function verifyToken(token) {
  return _jsonwebtoken.default.verify(token, _env.env.JWT_SECRET);
}
function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new _errors.UnauthorizedError('Missing bearer token'));
    return;
  }
  try {
    req.user = verifyToken(header.slice('Bearer '.length));
    next();
  } catch {
    next(new _errors.UnauthorizedError('Invalid or expired token'));
  }
}
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      next(new _errors.UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new _errors.ForbiddenError(`Requires role: ${roles.join(' or ')}`));
      return;
    }
    next();
  };
}
