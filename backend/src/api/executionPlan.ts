import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { requireAuth } from '../middleware/security.js';

const router = Router();

// GET /api/execution-plan/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const { id } = req.params;

  const plan = await prisma.executionPlan.findUnique({
    where: { id: id as string },
    include: {
      meeting: {
        select: {
          id: true,
          title: true,
          status: true,
          participantNames: true,
          projectTags: true,
          duration: true,
          createdAt: true,
          createdById: true,
          actionItems: {
            orderBy: [{ priority: 'asc' }],
          },
          decisions: true,
          risks: true,
        },
      },
    },
  });

  if (!plan) {
    res.status(404).json({ error: 'Execution plan not found', code: 'PLAN_NOT_FOUND' });
    return;
  }

  // Authorization check
  if (plan.meeting.createdById !== req.auth!.userId && req.auth!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Access denied', code: 'PLAN_FORBIDDEN' });
    return;
  }

  res.json({ plan });
});

// GET /api/execution-plan/by-meeting/:meetingId
router.get('/by-meeting/:meetingId', requireAuth, async (req: Request, res: Response) => {
  const { meetingId } = req.params;

  const plan = await prisma.executionPlan.findUnique({
    where: { meetingId: meetingId as string },
    include: {
      meeting: {
        select: {
          id: true,
          title: true,
          status: true,
          participantNames: true,
          duration: true,
          createdById: true,
          actionItems: { orderBy: [{ priority: 'asc' }] },
          decisions: true,
          risks: true,
        },
      },
    },
  });

  if (!plan) {
    res.status(404).json({ error: 'Execution plan not found for this meeting', code: 'PLAN_NOT_FOUND' });
    return;
  }

  if (plan.meeting.createdById !== req.auth!.userId && req.auth!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Access denied', code: 'PLAN_FORBIDDEN' });
    return;
  }

  res.json({ plan });
});

export { router as executionPlanRouter };
