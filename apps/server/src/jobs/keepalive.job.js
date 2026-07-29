"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runKeepalive = runKeepalive;
var _env = require("../config/env");
var _logger = require("../config/logger");
// Render free tier sleeps after 15 min idle (plan.md §14.4). If KEEPALIVE_URL
// is set, ping our own health endpoint every 14 minutes so the service pings
// itself awake while it's running (combine with an external UptimeRobot
// monitor for full coverage while it's actually asleep).

async function runKeepalive() {
  if (!_env.env.KEEPALIVE_URL) return;
  try {
    const res = await fetch(_env.env.KEEPALIVE_URL);
    _logger.logger.debug({
      status: res.status
    }, 'keepalive ping');
  } catch (err) {
    _logger.logger.warn({
      err
    }, 'keepalive ping failed');
  }
}
