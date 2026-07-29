"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createSocketServer = createSocketServer;
exports.getIo = getIo;
var _socket = require("socket.io");
var _env = require("../config/env");
var _logger = require("../config/logger");
var _auth = require("../middleware/auth");
var _Driver = require("../models/Driver");
var _Guest = require("../models/Guest");
var _User = require("../models/User");
var _rooms = require("./rooms");
var _handlers = require("./handlers");
let io = null;
function createSocketServer(httpServer) {
  io = new _socket.Server(httpServer, {
    cors: {
      origin: _env.env.CORS_ORIGIN_LIST,
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  /**
   * A valid signature is not enough: the principal must still exist. After a
   * re-seed the old tokens still verify, so without this check a dead session
   * gets a live socket, joins a room keyed on a deleted id, and silently
   * receives nothing forever. Rejecting with 'unauthorized' reuses the path the
   * clients already handle by logging out.
   */
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    let payload;
    try {
      payload = (0, _auth.verifyToken)(token);
    } catch {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const exists = payload.role === 'driver' ? await _Driver.Driver.exists({
        _id: payload.driverId
      }) : payload.role === 'guest' ? await _Guest.Guest.exists({
        _id: payload.guestId
      }) : await _User.User.exists({
        _id: payload.sub
      });
      if (!exists) {
        next(new Error('unauthorized'));
        return;
      }
    } catch (err) {
      // A database blip must not read as a bad credential — that would log
      // every connected client out. Fail closed on the connection, not the
      // session: the client retries on its own backoff.
      _logger.logger.error({
        err
      }, 'socket handshake principal check failed');
      next(new Error('unavailable'));
      return;
    }
    socket.data.user = payload;
    next();
  });
  io.on('connection', socket => {
    const user = socket.data.user;
    if (user.role === 'admin') socket.join(_rooms.rooms.admin());
    if (user.role === 'driver' && user.driverId) socket.join(_rooms.rooms.driver(user.driverId));
    if (user.role === 'guest' && user.guestId) socket.join(_rooms.rooms.guest(user.guestId));
    _logger.logger.debug({
      role: user.role,
      sub: user.sub
    }, 'socket connected');
    (0, _handlers.registerHandlers)(io, socket, user);
    socket.on('disconnect', () => {
      _logger.logger.debug({
        role: user.role,
        sub: user.sub
      }, 'socket disconnected');
    });
  });
  return io;
}
function getIo() {
  if (!io) throw new Error('Socket.IO server not initialised yet');
  return io;
}
