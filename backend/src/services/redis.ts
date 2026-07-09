import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!redisInstance) {
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        if (times > 10) {
          // Silent retry strategy to avoid terminal spam
          return 5000;
        }
        return Math.min(times * 100, 3000);
      },
      enableReadyCheck: true,
      lazyConnect: false,
    });

    let silentErrorLogged = false;
    redisInstance.on('connect', () => {
      logger.info('Redis connected');
      silentErrorLogged = false;
    });
    redisInstance.on('error', (err) => {
      if (!silentErrorLogged) {
        logger.info('Redis offline (rate limiter running in fallback memory mode)', { error: err.message });
        silentErrorLogged = true;
      }
    });
  }
  return redisInstance;
}

export const redis = getRedis();

export async function disconnectRedis(): Promise<void> {
  if (redisInstance) {
    await redisInstance.quit();
    redisInstance = null;
    logger.info('Redis disconnected');
  }
}
