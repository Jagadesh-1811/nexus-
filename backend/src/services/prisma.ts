import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { env } from '../config/env';
export type AuditAction =
  | 'USER_SIGN_IN'
  | 'USER_SIGN_UP'
  | 'USER_SIGN_OUT'
  | 'MEETING_INGEST'
  | 'MEETING_ANALYZE'
  | 'AI_VALIDATE'
  | 'ACTION_DISPATCH'
  | 'USER_OVERRIDE'
  | 'SETTINGS_UPDATE'
  | 'SETTINGS_CHANGED'
  | 'API_KEY_ROTATED'
  | 'SECURITY_VIOLATION'
  | 'MEETING_UPLOADED'
  | 'MEETING_ANALYZED'
  | 'VALIDATION_PASSED'
  | 'VALIDATION_FAILED'
  | 'JIRA_TICKET_CREATED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'SLACK_MESSAGE_SENT';


// ============================================================
// Prisma Singleton
// ============================================================

declare global {
  var __prisma: PrismaClient | undefined;
}

const prismaRaw = globalThis.__prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? [{ level: 'query', emit: 'event' }, { level: 'error', emit: 'event' }]
    : [{ level: 'error', emit: 'event' }],
});

if (env.NODE_ENV !== 'production') {
  globalThis.__prisma = prismaRaw;
}

prismaRaw.$on('error' as never, (e: any) => {
  logger.error('Prisma error', { error: e });
});

// Transparent Proxy wrapper to auto-retry database operations on connection reset (P1017)
function createAutoRetryProxy(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      
      // If it's a Prisma model (e.g. prisma.meeting)
      if (value && typeof value === 'object' && !prop.toString().startsWith('$')) {
        return new Proxy(value, {
          get(modelTarget, modelProp) {
            const modelValue = Reflect.get(modelTarget, modelProp);
            if (typeof modelValue === 'function') {
              return async (...args: any[]) => {
                try {
                  return await modelValue.apply(modelTarget, args);
                } catch (error: any) {
                  const isConnectionError = 
                    error.code === 'P1017' || 
                    error.code === 'P2024' ||
                    String(error.message).includes('closed the connection') ||
                    String(error.message).includes('10054') ||
                    String(error.message).includes('ConnectionReset');
                    
                  if (isConnectionError) {
                    logger.warn('Prisma connection lost. Attempting to reconnect and retry query...', { code: error.code });
                    try {
                      await target.$disconnect();
                      await target.$connect();
                      // Retry the query
                      return await modelValue.apply(modelTarget, args);
                    } catch (retryError) {
                      logger.error('Prisma reconnection and retry failed', { error: retryError });
                      throw retryError;
                    }
                  }
                  throw error;
                }
              };
            }
            return modelValue;
          }
        });
      }
      return value;
    }
  }) as any;
}

export const prisma = createAutoRetryProxy(prismaRaw);

// ============================================================
// Audit Logger — immutable, append-only audit trail
// ============================================================

interface AuditLogPayload {
  userId?: string | undefined;
  action: AuditAction;
  resource?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  severity?: ('INFO' | 'WARN' | 'ERROR' | 'CRITICAL') | undefined;
}

export async function writeAuditLog(payload: AuditLogPayload): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: payload.userId ?? null,
        action: payload.action,
        resource: payload.resource ?? null,
        ipAddress: payload.ipAddress ?? null,
        userAgent: payload.userAgent ?? null,
        requestId: payload.requestId ?? null,
        metadata: payload.metadata as any,
        severity: payload.severity ?? 'INFO',
      },
    });
  } catch (error) {
    // Log to file even if DB write fails — NEVER lose audit events
    logger.error('AUDIT LOG WRITE FAILED — falling back to file log', {
      payload,
      error,
    });
  }
}

// ============================================================
// Graceful shutdown
// ============================================================

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Prisma disconnected');
}
