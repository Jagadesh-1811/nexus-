/**
 * SYNAPSE SECURITY MODULE
 * 
 * Implements multi-layered security:
 * 1. Helmet.js — HTTP security headers
 * 2. CORS — strict origin whitelist
 * 3. Rate limiting — Redis-backed per-IP + per-user
 * 4. HMAC request signing — tamper detection for internal endpoints
 * 5. File upload security — MIME validation + magic byte verification
 * 6. AES-256-GCM encryption — sensitive data at rest
 * 7. Audit logging — immutable trail of all security events
 * 8. Request ID — correlation across services
 */

import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// ============================================================
// AES-256-GCM Encryption at Rest
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');

  const [ivB64, tagB64, encB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ============================================================
// HMAC Request Signing
// ============================================================

export function generateHMACSignature(
  payload: string,
  timestamp: number,
  secret: string = env.HMAC_SECRET
): string {
  const message = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function verifyHMACSignature(
  payload: string,
  timestamp: number,
  signature: string,
  secret: string = env.HMAC_SECRET,
  toleranceMs = 5 * 60 * 1000 // 5 minutes
): boolean {
  // Replay attack prevention: reject old timestamps
  const now = Date.now();
  if (Math.abs(now - timestamp) > toleranceMs) {
    logger.warn('HMAC timestamp out of tolerance window', { timestamp, now });
    return false;
  }

  const expected = generateHMACSignature(payload, timestamp, secret);
  
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

// ============================================================
// Request ID Generator
// ============================================================

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`;
}

// ============================================================
// SHA-256 File Hash
// ============================================================

export function hashFileBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ============================================================
// Magic Byte File Validation
// ============================================================

interface MagicBytes {
  offset: number;
  bytes: number[];
}

const AUDIO_MAGIC_SIGNATURES: Record<string, MagicBytes[]> = {
  'audio/mpeg': [{ offset: 0, bytes: [0xFF, 0xFB] }, { offset: 0, bytes: [0xFF, 0xF3] }, { offset: 0, bytes: [0xFF, 0xF2] }, { offset: 0, bytes: [0x49, 0x44, 0x33] }],
  'audio/wav': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }],
  'audio/mp4': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  'video/mp4': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  'audio/webm': [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  'video/webm': [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
  'audio/ogg': [{ offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }],
};

export function validateMagicBytes(buffer: Buffer, declaredMimeType: string): boolean {
  const signatures = AUDIO_MAGIC_SIGNATURES[declaredMimeType];
  if (!signatures) return false;

  return signatures.some(sig => {
    if (buffer.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((byte, i) => buffer[sig.offset + i] === byte);
  });
}

// ============================================================
// Sanitize String Input (prevent XSS / injection)
// ============================================================

export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip HTML angle brackets
    .replace(/javascript:/gi, '') // XSS via javascript: URIs
    .replace(/on\w+=/gi, '') // Event handlers
    .trim()
    .slice(0, 10000); // Hard length cap
}

// ============================================================
// Hash API Key for storage (bcrypt-like w/ crypto)
// ============================================================

export function hashApiKey(key: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(key, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyApiKey(key: string, stored: string): boolean {
  const [salt, hash] = stored.split(':') as [string, string];
  const derived = crypto.scryptSync(key, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export function generateApiKey(prefix = 'syn'): string {
  const random = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${random}`;
}
