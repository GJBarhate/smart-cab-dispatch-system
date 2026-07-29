"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.connectDb = connectDb;
exports.disconnectDb = disconnectDb;
exports.isDbConnected = isDbConnected;
var _mongoose = _interopRequireDefault(require("mongoose"));
var _env = require("./env");
var _logger = require("./logger");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
_mongoose.default.set('strictQuery', true);
let connected = false;
async function connectDb() {
  if (connected) return _mongoose.default;
  _mongoose.default.connection.on('error', err => _logger.logger.error({
    err
  }, 'mongodb connection error'));
  _mongoose.default.connection.on('disconnected', () => _logger.logger.warn('mongodb disconnected'));
  _mongoose.default.connection.on('reconnected', () => _logger.logger.info('mongodb reconnected'));
  await _mongoose.default.connect(_env.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000
  });
  connected = true;
  _logger.logger.info('mongodb connected');
  return _mongoose.default;
}
async function disconnectDb() {
  if (!connected) return;
  await _mongoose.default.disconnect();
  connected = false;
}
function isDbConnected() {
  return _mongoose.default.connection.readyState === 1;
}
