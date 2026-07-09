import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
export type AuditAction = string;

// ============================================================
// Prisma Singleton
// ============================================================

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = globalThis.__prisma ?? new PrismaClient({
  log: env.NODE_ENV === 'development'
    ? [{ level: 'query', emit: 'event' }, { level: 'error', emit: 'event' }]
    : [{ level: 'error', emit: 'event' }],
});

if (env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error', { error: e });
});

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
