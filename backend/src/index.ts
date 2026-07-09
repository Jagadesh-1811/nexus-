/**
 * SYNAPSE ORCHESTRATOR — Main Server Entry Point
 * 
 * Initializes Express with full security middleware stack,
 * registers all API routes, and starts the HTTP + WebSocket server.
 */

import 'express-async-errors';
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { helmetConfig } from './security/helmetConfig.js';
import { globalRateLimit, authRateLimit } from './security/rateLimiter.js';
import {
  requestIdMiddleware,
  securityHeaders,
  sanitizeBody,
  globalErrorHandler,
  notFoundHandler,
} from './middleware/security.js';
import { initializeWebSocket } from './services/websocket.js';
import { initializeQdrantCollection } from './services/qdrant.js';
import { prisma, disconnectPrisma } from './services/prisma.js';
import { disconnectRedis } from './services/redis.js';

// Routes
import { ingestRouter } from './api/ingest.js';
import { meetingsRouter } from './api/meetings.js';
import { executionPlanRouter } from './api/executionPlan.js';
import { memoryRouter } from './api/memory.js';
import { settingsRouter } from './api/settings.js';

const app = express();
const httpServer = createServer(app);

// ============================================================
// SECURITY MIDDLEWARE (applied globally, in order)
// ============================================================

// 1. Helmet — HTTP security headers
app.use(helmetConfig);

// 2. CORS — strict origin whitelist
app.use(cors({
  origin: (origin, callback) => {
    const allowed = env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
    if (
      !origin || 
      allowed.includes(origin) || 
      origin.startsWith('chrome-extension://') || 
      origin.startsWith('file://') ||
      env.NODE_ENV === 'development'
    ) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request from unauthorized origin', { origin });
      callback(new Error(`CORS: Origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Synapse-Signature', 'X-Synapse-Timestamp', 'X-API-Key'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
}));

// 3. Request ID
app.use(requestIdMiddleware);

// 4. Extra security headers
app.use(securityHeaders);

// 5. Global rate limit
app.use(globalRateLimit);

// 6. Compression
app.use(compression());

// 7. Cookie parser
app.use(cookieParser(env.SESSION_SECRET));

// 8. Body parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 9. Input sanitization
app.use(sanitizeBody);

// 10. HTTP Request logging
app.use(morgan('combined', {
  stream: { write: (message) => logger.http(message.trim()) },
  skip: (req) => req.path === '/health',
}));

// ============================================================
// HEALTH CHECK (no auth required)
// ============================================================

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: '1.0.0' });
  } catch {
    res.status(503).json({ status: 'unhealthy', error: 'Database unavailable' });
  }
});

// ============================================================
// API ROUTES
// ============================================================

const API_PREFIX = `/api/${env.API_VERSION}`;

app.use(`${API_PREFIX}/ingest`, ingestRouter);
app.use(`${API_PREFIX}/meetings`, meetingsRouter);
app.use(`${API_PREFIX}/execution-plan`, executionPlanRouter);
app.use(`${API_PREFIX}/memory`, memoryRouter);
app.use(`${API_PREFIX}/settings`, settingsRouter);

// ============================================================
// ERROR HANDLING
// ============================================================

app.use(notFoundHandler);
app.use(globalErrorHandler);

// ============================================================
// SERVER STARTUP
// ============================================================

async function start() {
  try {
    logger.info('Starting Synapse Orchestrator...');

    // Initialize infrastructure
    await prisma.$connect();
    logger.info('PostgreSQL connected');

    await initializeQdrantCollection();

    // Initialize WebSocket
    initializeWebSocket(httpServer);
    logger.info('WebSocket server initialized');

    httpServer.listen(env.PORT, () => {
      logger.info(`🚀 Synapse Orchestrator running on port ${env.PORT}`, {
        env: env.NODE_ENV,
        apiVersion: env.API_VERSION,
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal: string) {
  logger.info(`${signal} received. Shutting down gracefully...`);

  httpServer.close(async () => {
    await disconnectPrisma();
    await disconnectRedis();
    logger.info('Server shut down cleanly');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

start();
