import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { verifyToken } from '../middleware/auth';
import { rooms } from './rooms';
import { registerHandlers } from './handlers';
import type { JwtPayload } from '../shared';

let io: Server | null = null;

export function createSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN_LIST, credentials: true },
    transports: ['websocket', 'polling']
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = verifyToken(token);
      (socket.data as { user: JwtPayload }).user = payload;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
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
