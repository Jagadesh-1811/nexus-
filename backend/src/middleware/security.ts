/**
 * SECURITY MIDDLEWARE STACK
 * 
 * Applied to every request:
 * 1. Request ID injection (correlation tracking)
 * 2. Request logging (Morgan)
 * 3. HMAC validation for internal endpoints
 * 4. Clerk JWT verification
 * 5. RBAC authorization
 * 6. Request body sanitization
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { generateRequestId, verifyHMACSignature, sanitizeString } from '../security/crypto';
import { prisma, writeAuditLog } from '../services/prisma';
import { logger } from '../config/logger';
import { env } from '../config/env';

// Firebase Admin SDK used via firebaseAdmin singleton

// ============================================================
// Augment Express Request with security context
// ============================================================

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: {
        userId: string;
        sessionId: string;
        role: string;
      };
    }
  }
}

// ============================================================
// 1. Request ID Middleware
// ============================================================

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

// ============================================================
// 2. Security Headers — extra headers beyond Helmet
// ============================================================

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Powered-By', 'Synapse'); // Override default Express
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
}

// ============================================================
// 3. Clerk JWT Authentication
// ============================================================

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Missing authorization token', code: 'AUTH_MISSING_TOKEN' });
      return;
    }

    if ((env.NODE_ENV === 'development' || env.NODE_ENV === 'test') && token === 'test-token') {
      // Upsert test user to prevent database foreign key constraints
      await prisma.user.upsert({
        where: { id: 'test-user-id' },
        update: {},
        create: {
          id: 'test-user-id',
          supabaseId: 'test-supabase-id',
          email: 'test-user@example.com',
          name: 'Test User',
          role: 'LEAD',
        },
      });

      req.auth = {
        userId: 'test-user-id',
        sessionId: 'test-session-id',
        role: 'ADMIN',
      };
      next();
      return;
    }

    const decodedToken = jwt.verify(token, env.JWT_SECRET) as any;

    req.auth = {
      userId: decodedToken.sub || decodedToken.uid,
      sessionId: '', // Sessions are tracked via Client state
      role: (decodedToken.role as string) || 'VIEWER',
    };

    next();
  } catch (error) {
    logger.warn('JWT verification failed', {
      requestId: req.requestId,
      ip: req.ip,
      error: (error as Error).message,
    });
    await writeAuditLog({
      action: 'SECURITY_VIOLATION',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      metadata: { reason: 'Invalid JWT Token', path: req.path },
      severity: 'WARN',
    });
    res.status(401).json({ error: 'Invalid or expired token', code: 'AUTH_INVALID_TOKEN' });
  }
}

// ============================================================
// 4. RBAC — Role-Based Access Control
// ============================================================

type UserRole = 'ADMIN' | 'PROJECT_MANAGER' | 'ENGINEER_LEAD' | 'EXECUTIVE' | 'VIEWER';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  ADMIN: 100,
  PROJECT_MANAGER: 80,
  ENGINEER_LEAD: 60,
  EXECUTIVE: 50,
  VIEWER: 10,
};

export function requireRole(...roles: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userRole = req.auth?.role as UserRole;
    if (!userRole) {
      res.status(403).json({ error: 'Not authorized', code: 'RBAC_NO_ROLE' });
      return;
    }

    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = Math.min(...roles.map(r => ROLE_HIERARCHY[r] ?? Infinity));

    if (userLevel < requiredLevel) {
      logger.warn('RBAC access denied', {
        userId: req.auth?.userId,
        userRole,
        requiredRoles: roles,
        path: req.path,
        requestId: req.requestId,
      });
      await writeAuditLog({
        userId: req.auth?.userId,
        action: 'SECURITY_VIOLATION',
        resource: req.path,
        ipAddress: req.ip,
        requestId: req.requestId,
        metadata: { reason: 'RBAC denial', userRole, requiredRoles: roles },
        severity: 'WARN',
      });
      res.status(403).json({ error: 'Insufficient permissions', code: 'RBAC_DENIED' });
      return;
    }
    next();
  };
}

// ============================================================
// 5. HMAC Validation Middleware (for internal endpoints)
// ============================================================

export function requireHMAC(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-synapse-signature'] as string | undefined;
  const timestampStr = req.headers['x-synapse-timestamp'] as string | undefined;

  if (!signature || !timestampStr) {
    res.status(401).json({ error: 'Missing HMAC signature', code: 'HMAC_MISSING' });
    return;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    res.status(401).json({ error: 'Invalid timestamp', code: 'HMAC_INVALID_TIMESTAMP' });
    return;
  }

  const payload = JSON.stringify(req.body);
  const valid = verifyHMACSignature(payload, timestamp, signature);

  if (!valid) {
    logger.warn('HMAC validation failed', { ip: req.ip, path: req.path, requestId: req.requestId });
    res.status(401).json({ error: 'Invalid HMAC signature', code: 'HMAC_INVALID' });
    return;
  }

  next();
}

// ============================================================
// 6. Input Sanitization Middleware
// ============================================================

export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeDeep(req.body);
  }
  next();
}

function sanitizeDeep(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeDeep(v);
    }
    return result;
  }
  return obj;
}

// ============================================================
// 7. Validation Error Handler
// ============================================================

export function handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array(),
    });
    return;
  }
  next();
}

// ============================================================
// 8. Global Error Handler
// ============================================================

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId ?? 'unknown';

  logger.error('Unhandled error', {
    error: err.message,
    stack: env.NODE_ENV === 'development' ? err.stack : undefined,
    requestId,
    path: req.path,
    method: req.method,
    userId: req.auth?.userId,
  });

  // Don't leak internal errors in production
  const message = env.NODE_ENV === 'production'
    ? 'An internal server error occurred'
    : err.message;

  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR',
    requestId,
  });
}

// ============================================================
// 9. 404 Handler
// ============================================================

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
    requestId: req.requestId,
  });
}
