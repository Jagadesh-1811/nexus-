import { prisma } from './prisma.js';
import { getQueuedMeetings, dequeueMeeting, QueuedMeeting } from './localQueue.js';
import { upsertVectors } from './qdrant.js';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { encrypt } from '../security/crypto.js';
import { v4 as uuidv4 } from 'uuid';

let isSyncing = false;

/**
 * Check if the application can reach Supabase database
 */
export async function checkOnlineStatus(): Promise<boolean> {
  try {
    // Simple query to verify Prisma/Supabase connection
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.warn('Online status check: OFFLINE', { error: String(error) });
    return false;
  }
}

/**
 * Sync a single queued meeting to Supabase Cloud and Qdrant
 */
async function syncMeetingToCloud(meeting: QueuedMeeting): Promise<void> {
  logger.info(`Syncing meeting ${meeting.meetingId} to cloud...`);

  const encryptedTranscript = encrypt(meeting.transcript);

  // 1. Transaction to write relational data to Supabase
  await prisma.$transaction(async (tx) => {
    // Ensure user exists (in case user was created locally or is being synced)
    const userExists = await tx.user.findUnique({ where: { id: meeting.userId } });
    if (!userExists) {
      await tx.user.create({
        data: {
          id: meeting.userId,
          supabaseId: meeting.userId, // Default mapping
          email: 'synced_user@synapse.local',
          name: 'Synced User',
          role: 'MEMBER',
        }
      });
    }

    // Ensure workspace exists
    const workspaceExists = await tx.workspace.findUnique({ where: { id: meeting.workspaceId } });
    if (!workspaceExists) {
      await tx.workspace.create({
        data: {
          id: meeting.workspaceId,
          name: 'Default Workspace',
        }
      });
    }

    // Create the meeting
    await tx.meeting.create({
      data: {
        id: meeting.meetingId,
        workspaceId: meeting.workspaceId,
        title: meeting.title,
        status: 'COMPLETED',
        transcriptSecure: encryptedTranscript,
        duration: meeting.duration,
        participantNames: meeting.participantNames,
        projectTags: meeting.projectTags,
        createdById: meeting.userId,
        processingStartedAt: new Date(),
        processingEndAt: new Date(),
      }
    });

    // Create execution plan
    await tx.executionPlan.create({
      data: {
        meetingId: meeting.meetingId,
        summary: meeting.extractedData.summary,
        enkryptValidated: meeting.validationResults.every(r => r.isValid),
        enkryptValidationScore: 0.95,
        contextUsed: false,
      }
    });

    // Create action items with full validation history
    for (const res of meeting.validationResults) {
      await tx.actionItem.create({
        data: {
          meetingId: meeting.meetingId,
          description: res.item.description,
          assignee: res.item.assignee,
          deadline: res.item.deadline ? new Date(res.item.deadline) : null,
          priority: res.item.priority,
          isValidated: res.isValid,
          validationScore: res.confidenceScore,
          validationNotes: res.hallucFlags.join('; ') || null,
          validationHistory: res.validationHistory || JSON.stringify(res),
          status: res.isValid ? 'APPROVED' : 'REJECTED',
        }
      });
    }

    // Create decisions
    for (const d of meeting.extractedData.decisions) {
      await tx.decision.create({
        data: {
          meetingId: meeting.meetingId,
          title: d.title,
          context: d.context,
          impact: d.impact,
          stakeholders: d.stakeholders,
          reversible: d.reversible,
        }
      });
    }

    // Create risks
    for (const r of meeting.extractedData.risks) {
      await tx.risk.create({
        data: {
          meetingId: meeting.meetingId,
          description: r.description,
          level: r.level,
          mitigationSteps: r.mitigationSteps || null,
          owner: r.owner || null,
        }
      });
    }
  });

  // 2. Vector indexing in Qdrant
  try {
    const chunks = [
      meeting.transcript.slice(0, 1000),
      ...meeting.extractedData.decisions.map(d => d.context),
      ...meeting.extractedData.actionItems.map(a => a.description),
    ];

    const { embeddings } = await embedMany({
      model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
      values: chunks,
    });

    const points = chunks.map((content, i) => ({
      id: uuidv4(),
      vector: embeddings[i] ?? [],
      meetingId: meeting.meetingId,
      contentType: i === 0 ? 'transcript' as const : i <= meeting.extractedData.decisions.length ? 'decision' as const : 'action_item' as const,
      content,
      projectTags: meeting.projectTags,
      meetingDate: new Date().toISOString(),
    }));

    await upsertVectors(points);
    logger.info(`Successfully indexed vectors in Qdrant for synced meeting ${meeting.meetingId}`);
  } catch (vectorError) {
    logger.error('Failed to index vectors in Qdrant during sync', { error: vectorError });
    // We don't fail the transaction if Qdrant is temporarily down, but log the warning.
  }
}

/**
 * Background synchronization loop
 */
export async function startSyncLoop(): Promise<void> {
  setInterval(async () => {
    if (isSyncing) return;
    
    const isOnline = await checkOnlineStatus();
    if (!isOnline) return;

    const queued = await getQueuedMeetings();
    if (queued.length === 0) return;

    isSyncing = true;
    logger.info(`Sync service: Found ${queued.length} meetings to sync.`);

    for (const meeting of queued) {
      try {
        await syncMeetingToCloud(meeting);
        await dequeueMeeting(meeting.meetingId);
      } catch (error) {
        logger.error(`Failed to sync meeting ${meeting.meetingId}, will retry.`, { error });
      }
    }

    isSyncing = false;
  }, 15000); // Check every 15 seconds
}
