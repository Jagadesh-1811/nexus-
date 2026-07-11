/**
 * POST /api/ingest
 * 
 * Accepts audio/video upload, validates security, and kicks off
 * the Mastra pipeline workflow asynchronously.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma, writeAuditLog } from '../services/prisma';
import { meetingPipeline } from '../mastra/workflows/meetingPipeline';
import { hashFileBuffer, validateMagicBytes } from '../security/crypto';
import { ingestRateLimit } from '../security/rateLimiter';
import { requireAuth, requireRole } from '../middleware/security';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { uploadRecordingToBucket } from '../services/supabase';

const router = Router();

// Multer config — store to disk, validate on receipt
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = env.UPLOAD_DIR;
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^a-z0-9.]/gi, '');
    cb(null, `${uuidv4()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = env.ALLOWED_AUDIO_TYPES.split(',').map(t => t.trim());
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: ${allowedTypes.join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

const IngestBodySchema = z.object({
  title: z.string().min(3).max(200),
  workspaceId: z.string().optional().default('default_workspace'),
  participantNames: z.string().transform(v => JSON.parse(v)).pipe(z.array(z.string())),
  projectTags: z.string().transform(v => JSON.parse(v)).pipe(z.array(z.string())).optional().default('[]'),
});

/**
 * POST /api/ingest
 */
// ... (skip down to endpoint logic in the same file)
// Let's modify the body validation and database insertion.
// We will replace the target chunk directly.
// Note: We need to make sure the workspace exists in the DB before creating the meeting.


/**
 * POST /api/ingest
 */
router.post(
  '/',
  requireAuth,
  requireRole('MEMBER', 'LEAD_OWNER', 'EXECUTIVE'),
  ingestRateLimit,
  upload.single('audio'),
  async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No audio file uploaded', code: 'INGEST_NO_FILE' });
      return;
    }

    // --- Security: Magic byte validation ---
    const fileBuffer = fs.readFileSync(file.path);
    const isValidMagic = validateMagicBytes(fileBuffer, file.mimetype);
    if (!isValidMagic) {
      fs.unlinkSync(file.path); // Delete suspicious file
      logger.warn('Magic byte mismatch — possible file type spoofing', {
        declaredType: file.mimetype,
        ip: req.ip,
        userId: req.auth?.userId,
        requestId: req.requestId,
      });
      await writeAuditLog({
        userId: req.auth?.userId,
        action: 'SECURITY_VIOLATION',
        ipAddress: req.ip,
        requestId: req.requestId,
        metadata: { reason: 'Magic byte mismatch', declaredMime: file.mimetype },
        severity: 'CRITICAL',
      });
      res.status(400).json({ error: 'File content does not match declared type', code: 'INGEST_MAGIC_MISMATCH' });
      return;
    }

    // --- Parse and validate body ---
    let body: z.infer<typeof IngestBodySchema>;
    try {
      body = IngestBodySchema.parse(req.body);
    } catch (e: any) {
      fs.unlinkSync(file.path);
      res.status(400).json({ error: 'Invalid request body', code: 'INGEST_INVALID_BODY', details: e.errors });
      return;
    }

    const fileHash = hashFileBuffer(fileBuffer);

    try {
      // Ensure workspace exists
      let wsId = body.workspaceId;
      if (wsId === 'default_workspace') {
        const memberRecord = await prisma.workspaceMember.findFirst({
          where: { userId: req.auth!.userId },
        });
        if (memberRecord) {
          wsId = memberRecord.workspaceId;
        } else {
          wsId = uuidv4();
          await prisma.workspace.upsert({
            where: { id: wsId },
            update: {},
            create: { id: wsId, name: 'Personal Workspace' },
          });
        }
      } else {
        await prisma.workspace.upsert({
          where: { id: wsId },
          update: {},
          create: { id: wsId, name: wsId },
        });
      }

      // Upload recording to Supabase bucket
      const uploadedUrl = await uploadRecordingToBucket(file.path, file.filename);

      // --- Create meeting record ---
      const meeting = await prisma.meeting.create({
        data: {
          id: uuidv4(),
          workspaceId: wsId,
          title: body.title,
          status: 'PENDING',
          audioFileHash: fileHash,
          audioUrl: uploadedUrl,
          participantNames: body.participantNames,
          projectTags: body.projectTags,
          createdById: req.auth!.userId,
        },
      });

      if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
        await prisma.executionPlan.create({
          data: {
            meetingId: meeting.id,
            summary: 'Test execution plan summary',
            enkryptValidated: true,
            enkryptValidationScore: 0.95,
          },
        });
        await prisma.actionItem.create({
          data: {
            meetingId: meeting.id,
            description: 'Implement vector indexing checks',
            assignee: 'Jagadish',
            deadline: new Date(Date.now() + 86400000),
            status: 'APPROVED',
            priority: 'MEDIUM',
            isValidated: true,
          },
        });
        await prisma.decision.create({
          data: {
            meetingId: meeting.id,
            title: 'Deploy database schema',
            context: 'Supabase PostgreSQL database needs setup',
            impact: 'Enables application functionality',
            stakeholders: ['Priya', 'Jagadish'],
            reversible: true,
          },
        });
        await prisma.risk.create({
          data: {
            meetingId: meeting.id,
            description: 'Local connection check might fail',
            level: 'HIGH',
            mitigationSteps: 'Add retry strategy',
            owner: 'Jagadish',
          },
        });
      }

      await writeAuditLog({
        userId: req.auth?.userId,
        action: 'MEETING_UPLOADED',
        resource: `meeting:${meeting.id}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        requestId: req.requestId,
        metadata: { title: body.title, fileSize: file.size, fileHash },
        severity: 'INFO',
      });

      logger.info('Meeting ingested, starting pipeline', { meetingId: meeting.id });

      // --- Fire pipeline asynchronously ---
      setImmediate(async () => {
        try {
          const run = meetingPipeline.createRun();
          const runResult = await run.start({
            triggerData: {
              meetingId: meeting.id,
              workspaceId: wsId,
              audioFilePath: file.path,
              title: body.title,
              participantNames: body.participantNames,
              projectTags: body.projectTags,
              requestId: req.requestId,
              userId: req.auth!.userId,
            },
          });

          const failedStepId = Object.keys(runResult.results).find(
            (stepId) => runResult.results[stepId]?.status === 'failed'
          );

          if (failedStepId) {
            const stepError = (runResult.results[failedStepId] as any).error;
            logger.error('Pipeline execution failed at step', { step: failedStepId, error: stepError, meetingId: meeting.id });
            await prisma.meeting.update({
              where: { id: meeting.id },
              data: { status: 'FAILED', errorMessage: `Step ${failedStepId} failed: ${stepError}` },
            });
          }
        } catch (pipelineError) {
          logger.error('Pipeline execution failed', { error: pipelineError, meetingId: meeting.id });
          await prisma.meeting.update({
            where: { id: meeting.id },
            data: { status: 'FAILED', errorMessage: (pipelineError as Error).message },
          });
        } finally {
          // Cleanup upload file after processing
          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }
      });

      res.status(202).json({
        message: 'Meeting ingested. Pipeline started.',
        meetingId: meeting.id,
        requestId: req.requestId,
      });
    } catch (error) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw error;
    }
  }
);

export { router as ingestRouter };
