import { Router, Request, Response } from 'express';
import { prisma, writeAuditLog } from '../services/prisma';
import { requireAuth, requireRole } from '../middleware/security';
import { generateApiKey, hashApiKey } from '../security/crypto';
import { z } from 'zod';
import os from 'os';
import { checkOllamaStatus } from '../services/llmProvider';
import { logger } from '../config/logger';

const router = Router();

// GET /api/settings
router.get('/', requireAuth, requireRole('ADMIN', 'PROJECT_MANAGER'), async (req: Request, res: Response) => {
  let settings = await prisma.settings.findFirst();
  if (!settings) {
    settings = await prisma.settings.create({
      data: {
        requireHumanApproval: false,
        autoJiraEnabled: true,
        autoSlackEnabled: true,
      },
    });
  }
  res.json({ settings });
});

// PUT /api/settings
router.put('/', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const UpdateSchema = z.object({
    requireHumanApproval: z.boolean().optional(),
    autoJiraEnabled: z.boolean().optional(),
    autoSlackEnabled: z.boolean().optional(),
    defaultJiraProject: z.string().optional(),
    defaultSlackChannel: z.string().optional(),
    encryptTranscripts: z.boolean().optional(),
    auditRetentionDays: z.number().min(7).max(3650).optional(),
  });

  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings', details: parsed.error.flatten() });
    return;
  }

  const updateData = Object.fromEntries(
    Object.entries(parsed.data).filter(([_, v]) => v !== undefined)
  );

  const settings = await prisma.settings.upsert({
    where: { id: '1' },
    update: updateData,
    create: {
      id: '1',
      requireHumanApproval: false,
      autoJiraEnabled: true,
      autoSlackEnabled: true,
      ...updateData,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'SETTINGS_CHANGED',
    ipAddress: req.ip,
    requestId: req.requestId,
    metadata: { changes: parsed.data },
    severity: 'INFO',
  });

  res.json({ settings });
});

// POST /api/settings/api-keys — Generate new API key
router.post('/api-keys', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { name, scopes, expiresInDays } = req.body as { name: string; scopes: string[]; expiresInDays?: number };

  const rawKey = generateApiKey('syn');
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  await prisma.apiKey.create({
    data: {
      name,
      keyHash,
      keyPrefix,
      scopes: scopes ?? ['read'],
      expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
    },
  });

  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'API_KEY_ROTATED',
    requestId: req.requestId,
    metadata: { name, keyPrefix, scopes },
    severity: 'INFO',
  });

  // Return raw key ONCE — never stored in plaintext
  res.status(201).json({
    key: rawKey,
    prefix: keyPrefix,
    warning: 'Save this key now. It will never be shown again.',
  });
});

// GET /api/settings/audit-logs
router.get('/audit-logs', requireAuth, requireRole('ADMIN'), async (req: Request, res: Response) => {
  const { limit = '50', offset = '0', severity, action } = req.query;

  const logs = await prisma.auditLog.findMany({
    where: {
      ...(severity ? { severity: String(severity) } : {}),
      ...(action ? { action: String(action) as any } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit), 200),
    skip: Number(offset),
    include: { user: { select: { email: true, name: true } } },
  });

  const total = await prisma.auditLog.count();
  res.json({ logs, total });
});

// GET /api/settings/ollama-status — check local Ollama installation, RAM, and model downloads
router.get('/ollama-status', requireAuth, async (req: Request, res: Response) => {
  const isRunning = await checkOllamaStatus();
  
  const systemMemoryGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const freeMemoryGB = Math.round(os.freemem() / (1024 * 1024 * 1024));
  const cpus = os.cpus();
  const cpuCount = cpus ? cpus.length : 1;
  const loadAvg = os.loadavg();
  const cpuLoadPercent = Math.round(((loadAvg[0] || 0) / cpuCount) * 100);

  let pulledModels: string[] = [];
  if (isRunning) {
    try {
      const tagsResponse = await fetch('http://127.0.0.1:11434/api/tags');
      if (tagsResponse.ok) {
        const data = await tagsResponse.json() as any;
        pulledModels = data.models?.map((m: any) => m.name) || [];
      }
    } catch {}
  }

  const defaultModel = 'qwen2.5:14b';
  const alternateModel = 'qwen2.5-1m:14b';

  res.json({
    running: isRunning,
    defaultModelPulled: pulledModels.some(m => m.startsWith(defaultModel)),
    alternateModelPulled: pulledModels.some(m => m.startsWith(alternateModel)),
    pulledModels,
    systemMemoryGB,
    freeMemoryGB,
    cpuLoadPercent,
    sufficientMemory: systemMemoryGB >= 16,
  });
});

// POST /api/settings/ollama-pull — trigger model download
router.post('/ollama-pull', requireAuth, async (req: Request, res: Response) => {
  const { model = 'qwen2.5:14b' } = req.body;
  
  try {
    // Initiate non-blocking model pull request to local Ollama daemon
    fetch('http://127.0.0.1:11434/api/pull', {
      method: 'POST',
      body: JSON.stringify({ name: model, stream: false }),
    }).catch(e => logger.error('Async model pull failed', { error: e }));

    res.json({ status: 'downloading', message: `Download initiated for model ${model}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger model pull', details: String(error) });
  }
});

// GET /api/settings/export-data — GDPR full export of relational and metadata records
router.get('/export-data', requireAuth, async (req: Request, res: Response) => {
  try {
    const meetings = await prisma.meeting.findMany({
      include: {
        actionItems: true,
        decisions: true,
        risks: true,
        executionPlan: true,
      },
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=synapse_export.json');
    res.json({
      exportedAt: new Date().toISOString(),
      meetings,
    });
  } catch (error) {
    res.status(500).json({ error: 'Data export failed', details: String(error) });
  }
});

// DELETE /api/settings/meeting/:id — Delete a meeting + local records
router.delete('/meeting/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // 1. Delete meeting records (Cascade deletes actionItems, decisions, risks, etc.)
    await prisma.meeting.delete({
      where: { id: String(id) },
    });

    // 2. Write audit log
    await writeAuditLog({
      userId: req.auth?.userId,
      action: 'SETTINGS_CHANGED',
      resource: `deleted_meeting:${id}`,
      severity: 'WARN',
      metadata: { deletedMeetingId: id },
    });

    res.json({ success: true, message: `Meeting ${id} deleted successfully.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete meeting records', details: String(error) });
  }
});

// DELETE /api/settings/delete-all — Clean slate wipe of all data
router.delete('/delete-all', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.meeting.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.auditLog.deleteMany();

    await writeAuditLog({
      userId: req.auth?.userId,
      action: 'SECURITY_VIOLATION',
      resource: 'database_wipe',
      severity: 'CRITICAL',
      metadata: { action: 'WIPE_ALL_DATA' },
    });

    res.json({ success: true, message: 'All data deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete all data', details: String(error) });
  }
});

export { router as settingsRouter };
