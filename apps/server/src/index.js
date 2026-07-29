"use strict";

var _http = require("http");
var _env = require("./config/env");
var _logger = require("./config/logger");
var _db = require("./config/db");
require("./models");
var _app = require("./app");
var _io = require("./realtime/io");
var _scheduler = require("./jobs/scheduler");
// registers every model once, up front — `.populate()` throws MissingSchemaError for any ref whose model was never require()'d anywhere in the process

async function main() {
  await (0, _db.connectDb)();
  const app = (0, _app.createApp)();
  const httpServer = (0, _http.createServer)(app);
  (0, _io.createSocketServer)(httpServer);
  (0, _scheduler.startScheduler)();
  httpServer.listen(_env.env.PORT, () => {
    _logger.logger.info(`server listening on :${_env.env.PORT} (${_env.env.NODE_ENV})`);
  });
  const shutdown = signal => {
    _logger.logger.info(`${signal} received, shutting down`);
    (0, _scheduler.stopScheduler)();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
main().catch(err => {
  _logger.logger.error({
    err
  }, 'fatal startup error');
  process.exit(1);
});
