"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createApp = createApp;
var _express = _interopRequireDefault(require("express"));
var _cors = _interopRequireDefault(require("cors"));
var _helmet = _interopRequireDefault(require("helmet"));
var _expressRateLimit = _interopRequireDefault(require("express-rate-limit"));
var _env = require("./config/env");
var _health = require("./routes/health.routes");
var _auth = require("./routes/auth.routes");
var _guest = require("./routes/guest.routes");
var _driver = require("./routes/driver.routes");
var _admin = require("./routes/admin.routes");
var _dispatch = require("./routes/dispatch.routes");
var _ai = require("./routes/ai.routes");
var _error = require("./middleware/error");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
function createApp() {
  const app = (0, _express.default)();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((0, _helmet.default)());
  app.use((0, _cors.default)({
    origin: _env.env.CORS_ORIGIN_LIST,
    credentials: true
  }));
  app.use(_express.default.json({
    limit: '2mb'
  }));
  app.use(_express.default.urlencoded({
    extended: true
  }));
  const authLimiter = (0, _expressRateLimit.default)({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many attempts, try again shortly',
        details: null
      }
    }
  });
  app.use('/api/health', _health.healthRouter);
  app.use('/api/auth/guest/login', authLimiter);
  app.use('/api/auth', _auth.authRouter);
  app.use('/api/guest', _guest.guestRouter);
  app.use('/api/driver', _driver.driverRouter);
  app.use('/api/admin', _admin.adminRouter);
  app.use('/api/dispatch', _dispatch.dispatchRouter);
  app.use('/api/ai', _ai.aiRouter);
  app.use(_error.notFoundHandler);
  app.use(_error.errorHandler);
  return app;
}
