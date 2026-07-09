import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let io: SocketIOServer | null = null;

export function initializeWebSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.ALLOWED_ORIGINS.split(','),
      credentials: true,
    },
    pingTimeout: 60000,
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    logger.info('WebSocket client connected', { socketId: socket.id });

    // Client subscribes to specific meeting pipeline updates
    socket.on('subscribe:meeting', (meetingId: string) => {
      socket.join(`meeting:${meetingId}`);
      logger.info('Client subscribed to meeting', { socketId: socket.id, meetingId });
    });

    socket.on('unsubscribe:meeting', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`);
    });

    socket.on('disconnect', () => {
      logger.info('WebSocket client disconnected', { socketId: socket.id });
    });
  });

  return io;
}

export function emitPipelineEvent(
  meetingId: string,
  data: { step: string; status: string; data?: Record<string, unknown> }
): void {
  if (!io) return;
  io.to(`meeting:${meetingId}`).emit('pipeline:update', {
    meetingId,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error('WebSocket server not initialized');
  return io;
}
