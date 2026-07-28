import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { verifyToken } from '../middleware/auth';
import { Driver } from '../models/Driver';
import { Guest } from '../models/Guest';
import { User } from '../models/User';
import { rooms } from './rooms';
import { registerHandlers } from './handlers';
import type { JwtPayload } from '../shared';

let io: Server | null = null;

export function createSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN_LIST, credentials: true },
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
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch {
      next(new Error('unauthorized'));
      return;
    }

    try {
      const exists =
        payload.role === 'driver'
          ? await Driver.exists({ _id: payload.driverId })
          : payload.role === 'guest'
            ? await Guest.exists({ _id: payload.guestId })
            : await User.exists({ _id: payload.sub });

      if (!exists) {
        next(new Error('unauthorized'));
        return;
      }
    } catch (err) {
      // A database blip must not read as a bad credential — that would log
      // every connected client out. Fail closed on the connection, not the
      // session: the client retries on its own backoff.
      logger.error({ err }, 'socket handshake principal check failed');
      next(new Error('unavailable'));
      return;
    }

    (socket.data as { user: JwtPayload }).user = payload;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as { user: JwtPayload }).user;

    if (user.role === 'admin') socket.join(rooms.admin());
    if (user.role === 'driver' && user.driverId) socket.join(rooms.driver(user.driverId));
    if (user.role === 'guest' && user.guestId) socket.join(rooms.guest(user.guestId));

    logger.debug({ role: user.role, sub: user.sub }, 'socket connected');
    registerHandlers(io as Server, socket, user);

    socket.on('disconnect', () => {
      logger.debug({ role: user.role, sub: user.sub }, 'socket disconnected');
    });
  });

  return io;
}

export function getIo(): Server {
  if (!io) throw new Error('Socket.IO server not initialised yet');
  return io;
}
