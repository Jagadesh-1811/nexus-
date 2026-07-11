import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { requireAuth, requireRole } from '../middleware/security';
import { logger } from '../config/logger';
import { env } from '../config/env';

const router = Router();

// GET /api/meetings
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { status, limit = '20', offset = '0', search } = req.query;

  let meetings = await prisma.meeting.findMany({
    where: {
      createdById: req.auth!.userId,
      ...(status ? { status: status as any } : {}),
      ...(search ? { title: { contains: String(search), mode: 'insensitive' } } : {}),
    },
    select: {
      id: true,
      title: true,
      status: true,
      duration: true,
      participantNames: true,
      projectTags: true,
      createdAt: true,
      processingEndAt: true,
      _count: { select: { actionItems: true, decisions: true, risks: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit), 100),
    skip: Number(offset),
  });

  let total = await prisma.meeting.count({
    where: { createdById: req.auth!.userId },
  });



  res.json({ meetings, total, limit: Number(limit), offset: Number(offset) });
});

// GET /api/meetings/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  const meeting = await prisma.meeting.findUnique({
    where: { id: id as string },
    include: {
      actionItems: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] },
      decisions: true,
      risks: { orderBy: { level: 'asc' } },
      executionPlan: true,
    },
  });

  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found', code: 'MEETING_NOT_FOUND' });
    return;
  }

  // Authorization: users can only see their own meetings (unless admin)
  if (meeting.createdById !== req.auth!.userId && req.auth!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Access denied', code: 'MEETING_FORBIDDEN' });
    return;
  }

  // Strip encrypted transcript from response
  const { transcriptSecure, ...safeData } = meeting;

  res.json({ meeting: safeData });
});

// POST /api/meetings/:id/approve — Human-in-the-loop approval
router.post(
  '/:id/approve',
  requireAuth,
  requireRole('LEAD_OWNER', 'EXECUTIVE'),
  async (req: Request, res: Response) => {
    const { id: meetingId } = req.params;
    const { actionItemIds } = req.body as { actionItemIds: string[] };

    if (!Array.isArray(actionItemIds) || actionItemIds.length === 0) {
      res.status(400).json({ error: 'actionItemIds array required', code: 'APPROVE_INVALID_BODY' });
      return;
    }

    await prisma.actionItem.updateMany({
      where: {
        id: { in: actionItemIds },
        meetingId: meetingId as string,
        isValidated: true, // Can only approve Enkrypt-validated items
      },
      data: {
        status: 'APPROVED',
        approvedById: req.auth!.userId,
        approvedAt: new Date(),
      },
    });

    logger.info('Action items approved', { meetingId, count: actionItemIds.length, userId: req.auth!.userId });
    res.json({ approved: actionItemIds.length, message: 'Action items approved. Follow-up agent will trigger.' });
  }
);

// DELETE /api/meetings/:id — GDPR data deletion
router.delete(
  '/:id',
  requireAuth,
  requireRole('EXECUTIVE'),
  async (req: Request, res: Response) => {
    const { id } = req.params;
    await prisma.meeting.delete({ where: { id: id as string } });
    // Note: Qdrant vectors are deleted via cascade listener in production
    res.json({ deleted: true });
  }
);

export { router as meetingsRouter };
