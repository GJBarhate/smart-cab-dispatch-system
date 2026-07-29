"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.logger = void 0;
var _pino = _interopRequireDefault(require("pino"));
var _env = require("./env");
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : {
    default: e
  };
}
const logger = (0, _pino.default)({
  level: _env.env.LOG_LEVEL,
  transport: _env.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
});
exports.logger = logger;
