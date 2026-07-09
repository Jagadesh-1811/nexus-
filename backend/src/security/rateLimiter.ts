/**
 * RATE LIMITING
 * 
 * Multi-tier rate limiting backed by Redis:
 * - Global: 200 req/15min per IP
 * - Auth endpoints: 10 req/15min per IP (brute-force protection)
 * - Ingest: 5 req/hour per user (expensive operation)
 * - API: 60 req/min per API key
 */

import rateLimit, { MemoryStore } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redis } from '../services/redis.js';
import { logger } from '../config/logger.js';
import type { Request, Response } from 'express';

class FallbackStore {
  private redisStore: RedisStore | null = null;
  private memoryStore: MemoryStore;
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.memoryStore = new MemoryStore();
  }

  private getRedisStore(): RedisStore | null {
    if (redis.status === 'ready') {
      if (!this.redisStore) {
        try {
          this.redisStore = new RedisStore({
            // @ts-ignore
            client: redis,
            prefix: `rl:${this.prefix}:`,
            sendCommand: async (command: string, ...args: string[]) => {
              if (redis.status !== 'ready') {
                throw new Error('Redis not ready');
              }
              return redis.call(command, ...args) as Promise<any>;
            },
          });
        } catch (e) {
          logger.warn(`Failed to initialize RedisStore lazily for ${this.prefix}: ${String(e)}`);
          return null;
        }
      }
      return this.redisStore;
    }
    return null;
  }

  async increment(key: string) {
    const store = this.getRedisStore();
    if (store) {
      try {
        return await store.increment(key);
      } catch (err) {
        logger.warn(`Redis store failed for ${this.prefix}, falling back to memory store`, { error: String(err) });
      }
    }
    return await this.memoryStore.increment(key);
  }

  async decrement(key: string) {
    const store = this.getRedisStore();
    if (store) {
      try {
        return await store.decrement(key);
      } catch (err) {
        // Ignored fallback
      }
    }
    return await this.memoryStore.decrement(key);
  }

  async resetKey(key: string) {
    const store = this.getRedisStore();
    if (store) {
      try {
        return await store.resetKey(key);
      } catch (err) {
        // Ignored fallback
      }
    }
    return await this.memoryStore.resetKey(key);
  }
}

function createRateLimitStore(prefix: string) {
  return new FallbackStore(prefix) as any;
}

function onLimitReached(req: Request, _res: Response) {
  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    path: req.path,
    method: req.method,
    userId: (req as any).auth?.userId,
    userAgent: req.headers['user-agent'],
  });
}

// --- Global limiter ---
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'Too many requests. Please try again later.', code: 'RATE_LIMIT_GLOBAL' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('global'),
  handler: (req, res, next, options) => {
    onLimitReached(req, res);
    res.status(429).json(options.message);
  },
});

// --- Auth limiter (strict) ---
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts. Account temporarily locked.', code: 'RATE_LIMIT_AUTH' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('auth'),
  skipSuccessfulRequests: true,
  handler: (req, res, next, options) => {
    onLimitReached(req, res);
    logger.warn('AUTH BRUTE FORCE ATTEMPT', { ip: req.ip, path: req.path });
    res.status(429).json(options.message);
  },
});

// --- Ingest limiter (very strict — expensive GPT-4o calls) ---
export const ingestRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Ingest quota exceeded. Maximum 5 meetings per hour.', code: 'RATE_LIMIT_INGEST' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('ingest'),
  keyGenerator: (req) => {
    // Key by user ID if authenticated, else by IP
    const userId = (req as any).auth?.userId;
    return userId ?? req.ip ?? 'unknown';
  },
  handler: (req, res, next, options) => {
    onLimitReached(req, res);
    res.status(429).json(options.message);
  },
});

// --- API key limiter ---
export const apiKeyRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 60,
  message: { error: 'API key rate limit exceeded. Max 60 requests/minute.', code: 'RATE_LIMIT_API_KEY' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('apikey'),
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    return apiKey?.slice(0, 16) ?? req.ip ?? 'unknown';
  },
});
