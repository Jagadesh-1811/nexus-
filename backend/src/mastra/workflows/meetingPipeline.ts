/**
 * MASTER MEETING PIPELINE WORKFLOW
 * 
 * The full Mastra workflow orchestrating all 7 pipeline steps:
 * 1. Transcription (Deepgram)
 * 2. Vector Memory Query (Qdrant)
 * 3. AI Extraction (GPT-4o via Enkrypt proxy)
 * 4. Enkrypt AI Validation Gate
 * 5. PostgreSQL Persistence
 * 6. Vector Indexing (Qdrant)
 * 7. Follow-up Triggers (Jira + Slack + OS Notifications)
 * 
 * Each step emits WebSocket events for real-time dashboard updates.
 */

import { LegacyWorkflow as Workflow, LegacyStep as Step } from '@mastra/core/workflows/legacy';
import { z } from 'zod';
import { prisma, writeAuditLog } from '../../services/prisma';
import { encrypt } from '../../security/crypto';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { emitPipelineEvent } from '../../services/websocket';
import { createJiraTicketTool } from '../tools/jiraIntegration';
import { searchSimilar, upsertVectors } from '../../services/qdrant';
import { embed, embedMany, generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';

// Synapse Local AI Services
import { transcribeAudio } from '../../services/transcription';
import { getLLMModel, getEmbeddingModel } from '../../services/llmProvider';
import { validateActionItem } from '../../services/validationGate';
import { checkOnlineStatus } from '../../services/syncService';
import { queueOfflineMeeting } from '../../services/localQueue';

// ============================================================
// Input / Output Schemas
// ============================================================

const PipelineInputSchema = z.object({
  meetingId: z.string(),
  workspaceId: z.string(),
  audioFilePath: z.string(),
  title: z.string(),
  participantNames: z.array(z.string()),
  projectTags: z.array(z.string()),
  requestId: z.string(),
  userId: z.string(),
});

const ExtractionResultSchema = z.object({
  summary: z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return 'No summary provided.';
    return String(val);
  }, z.string().default('No summary provided.')),
  decisions: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return [];
    return val;
  }, z.array(z.object({
    title: z.preprocess((val) => val || 'Untitled Decision', z.string()),
    context: z.preprocess((val) => val || 'No context details provided.', z.string()),
    impact: z.preprocess((val) => val || 'No impact details provided.', z.string()),
    stakeholders: z.preprocess((val) => {
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (!val || !Array.isArray(val)) return [];
      return val;
    }, z.array(z.string())),
    reversible: z.preprocess((val) => val === true, z.boolean()),
  }))).default([]),
  actionItems: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return [];
    return val;
  }, z.array(z.object({
    id: z.preprocess((val) => val || `ai_${Date.now()}`, z.string()),
    description: z.preprocess((val) => val || 'Unspecified action item task.', z.string()),
    assignee: z.preprocess((val) => val || 'Unassigned', z.string()),
    deadline: z.preprocess((val) => val || null, z.string().nullable()),
    priority: z.preprocess((val) => {
      if (typeof val === 'string') return val.toUpperCase();
      return 'LOW';
    }, z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])),
  }))).default([]),
  risks: z.preprocess((val) => {
    if (!val || !Array.isArray(val)) return [];
    return val;
  }, z.array(z.object({
    description: z.preprocess((val) => val || 'Unspecified risk.', z.string()),
    level: z.preprocess((val) => {
      if (typeof val === 'string') return val.toUpperCase();
      return 'LOW';
    }, z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])),
    mitigationSteps: z.string().optional(),
    owner: z.string().optional(),
  }))).default([]),
});

// ============================================================
// Step 1: Transcription
// ============================================================

const transcribeStep = new Step({
  id: 'transcribe',
  execute: async ({ context, mastra }: any) => {
    const { meetingId, audioFilePath } = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;

    emitPipelineEvent(meetingId, { step: 'transcribe', status: 'running' });

    // Catch DB connectivity errors when offline
    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'TRANSCRIBING', processingStartedAt: new Date() },
      });
    } catch (e) {
      logger.warn('Could not update meeting status in DB (offline mode)', { error: String(e) });
    }

    // Transcribe audio using the dynamically detected provider (Deepgram or Whisper)
    let result;
    try {
      result = await transcribeAudio(audioFilePath);
    } catch (error: any) {
      logger.error('Transcription step failed', { error: String(error) });
      try {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED', errorMessage: error.message || String(error) },
        });
      } catch (dbErr) {}
      throw error;
    }

    emitPipelineEvent(meetingId, { step: 'transcribe', status: 'complete', data: { duration: result.duration } });

    return { transcript: result.transcript, duration: result.duration };
  },
});

// ============================================================
// Step 2: Query Vector Memory
// ============================================================

const queryMemoryStep = new Step({
  id: 'queryMemory',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const { transcript } = context.getStepResult('transcribe') as { transcript: string };
    const { meetingId, projectTags } = input;

    emitPipelineEvent(meetingId, { step: 'queryMemory', status: 'running' });
    logger.info('Pipeline Step 2: Memory Query', { meetingId });

    try {
      const queryText = transcript.slice(0, 500);
      const { embedding } = await embed({
        model: getEmbeddingModel(),
        value: queryText,
      });

      const results = await searchSimilar(embedding, 10, { projectTags, excludeMeetingId: meetingId });

      const contextText = results.length > 0
        ? `PRIOR MEETING CONTEXT:\n${results.map(r => `[Meeting ${r.meetingId}]: ${r.content}`).join('\n\n')}`
        : '';

      emitPipelineEvent(meetingId, { step: 'queryMemory', status: 'complete', data: { contextCount: results.length } });

      return { contextText, contextMeetingIds: results.map(r => r.meetingId), hasContext: results.length > 0 };
    } catch (e) {
      logger.warn('Query Memory failed (offline fallback)', { error: String(e) });
      emitPipelineEvent(meetingId, { step: 'queryMemory', status: 'complete', data: { contextCount: 0 } });
      return { contextText: '', contextMeetingIds: [], hasContext: false };
    }
  },
});

// ============================================================
// Step 3: AI Extraction (Local Ollama)
// ============================================================

const extractionStep = new Step({
  id: 'extract',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const { transcript } = context.getStepResult('transcribe') as { transcript: string };
    const { contextText } = context.getStepResult('queryMemory') as { contextText: string };
    const { meetingId } = input;

    emitPipelineEvent(meetingId, { step: 'extract', status: 'running' });
    try {
      await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'ANALYZING' } });
    } catch (e) {}
    logger.info('Pipeline Step 3: Extraction', { meetingId });

    const prompt = `${contextText ? contextText + '\n\n' : ''}MEETING TRANSCRIPT:
\"\"\"
${transcript}
\"\"\"

You are an expert AI extraction assistant. Your job is to extract decisions, action items, and risks from the MEETING TRANSCRIPT above.
Strict Rules:
1. DO NOT make up or hallucinate any decisions, action items, or risks.
2. If the transcript does not explicitly contain any decisions, action items, or risks, return empty arrays: "decisions": [], "actionItems": [], "risks": [].
3. For each decision, title MUST NOT be "Title", context MUST NOT be "Context", impact MUST NOT be "Impact". Only extract real decisions. If none exist, return [].
4. For each action item, only extract real commitments agreed to by the speakers. Do not make up tasks like "write a product description". If none exist, return [].
5. For each risk, only extract real risks mentioned. If none exist, return [].
6. Every action item assignee and risk owner MUST be a real speaker mentioned in the transcript.
7. Return JSON matching the ExtractionResult schema exactly.`;

    const model = getLLMModel('ollama', env.OLLAMA_MODEL || 'qwen2.5:14b');
    const { object } = await generateObject({
      model,
      schema: ExtractionResultSchema,
      prompt,
      mode: 'json',
    });

    emitPipelineEvent(meetingId, {
      step: 'extract', status: 'complete',
      data: {
        actionItemCount: object.actionItems.length,
        decisionCount: object.decisions.length,
        riskCount: object.risks.length,
      },
    });

    return object;
  },
});

// ============================================================
// Step 4: Enkrypt Validation Gate
// ============================================================

const validationStep = new Step({
  id: 'validate',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const { transcript } = context.getStepResult('transcribe') as { transcript: string };
    const extraction = context.getStepResult('extract') as z.infer<typeof ExtractionResultSchema>;
    const { meetingId } = input;

    emitPipelineEvent(meetingId, { step: 'validate', status: 'running' });
    try {
      await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'VALIDATING' } });
    } catch (e) {}
    logger.info('Pipeline Step 4: Local Double-Validation Gate', { meetingId, itemCount: extraction.actionItems.length });

    const useCloudEnkrypt = process.env.USE_CLOUD_ENKRYPT === 'true';

    const validationResults = await Promise.all(
      extraction.actionItems.map(async (item) => {
        const result = await validateActionItem(item, transcript, { useCloudEnkrypt });
        return {
          item: result.refinedItem,
          isValid: result.isValid,
          confidenceScore: result.confidenceScore,
          hallucFlags: result.objection ? [result.objection] : [],
          refinementCount: result.refinementHistory.length,
          refinementHistory: result.refinementHistory,
        };
      })
    );

    const passedItems = validationResults.filter(r => r.isValid);
    const failedCount = validationResults.length - passedItems.length;
    const overallScore = validationResults.reduce((s, r) => s + r.confidenceScore, 0) / (validationResults.length || 1);

    try {
      await writeAuditLog({
        userId: input.userId,
        action: passedItems.length === validationResults.length ? 'VALIDATION_PASSED' : 'VALIDATION_FAILED',
        resource: `meeting:${meetingId}`,
        metadata: { passedCount: passedItems.length, failedCount, overallScore },
        severity: failedCount > 0 ? 'WARN' : 'INFO',
      });
    } catch (e) {}

    emitPipelineEvent(meetingId, {
      step: 'validate', status: 'complete',
      data: { passedCount: passedItems.length, failedCount, overallScore },
    });

    return { validationResults, passedItems, overallScore, hallucFlagsTotal: failedCount };
  },
});

// ============================================================
// Step 5: Persist to PostgreSQL (Supabase Cloud)
// ============================================================

const persistStep = new Step({
  id: 'persist',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const { transcript, duration } = context.getStepResult('transcribe') as { transcript: string; duration: number };
    const extraction = context.getStepResult('extract') as z.infer<typeof ExtractionResultSchema>;
    const { contextMeetingIds, hasContext } = context.getStepResult('queryMemory') as any;
    const { validationResults, passedItems, overallScore, hallucFlagsTotal } = context.getStepResult('validate') as any;
    const { meetingId, workspaceId, title, participantNames, userId } = input;

    emitPipelineEvent(meetingId, { step: 'persist', status: 'running' });

    // Check if cloud database is accessible
    const isOnline = await checkOnlineStatus();
    if (!isOnline) {
      logger.info('App is OFFLINE. Queueing meeting results locally.', { meetingId });
      await queueOfflineMeeting({
        meetingId,
        workspaceId,
        title,
        transcript,
        duration,
        participantNames,
        projectTags: input.projectTags,
        userId,
        extractedData: extraction,
        validationResults: validationResults.map((r: any) => ({
          item: r.item,
          isValid: r.isValid,
          confidenceScore: r.confidenceScore,
          hallucFlags: r.hallucFlags || [],
          validationHistory: r.refinementHistory,
        })),
      });

      emitPipelineEvent(meetingId, { step: 'persist', status: 'complete', data: { queued: true } });
      return { persisted: false, queued: true };
    }

    logger.info('Pipeline Step 5: Cloud Persistence', { meetingId });

    // Encrypt transcript before storing
    const encryptedTranscript = encrypt(transcript);

    await prisma.$transaction(async (tx: any) => {
      // Update meeting record
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          status: 'COMPLETED',
          transcriptRaw: transcript,
          transcriptSecure: encryptedTranscript,
          duration,
          participantNames,
          processingEndAt: new Date(),
        },
      });

      // Create execution plan
      await tx.executionPlan.create({
        data: {
          meetingId,
          summary: extraction.summary,
          enkryptValidated: passedItems.length > 0,
          enkryptValidationScore: overallScore,
          hallucFlagsCount: hallucFlagsTotal,
          refinementCount: validationResults.reduce((s: number, r: any) => s + r.refinementCount, 0),
          contextUsed: hasContext,
          contextMeetingIds: contextMeetingIds ?? [],
        },
      });

      // Create validated action items with full history
      for (const result of validationResults) {
        await tx.actionItem.create({
          data: {
            meetingId,
            description: result.item.description,
            assignee: result.item.assignee,
            deadline: result.item.deadline ? new Date(result.item.deadline) : null,
            priority: result.item.priority,
            isValidated: result.isValid,
            validationScore: result.confidenceScore,
            validationNotes: result.hallucFlags.join('; ') || null,
            validationHistory: result.refinementHistory,
            status: 'APPROVED',
          },
        });
      }

      // Create decisions
      for (const d of extraction.decisions) {
        await tx.decision.create({
          data: {
            meetingId,
            title: d.title,
            context: d.context,
            impact: d.impact,
            stakeholders: d.stakeholders,
            reversible: d.reversible,
          },
        });
      }

      // Create risks
      for (const r of extraction.risks) {
        await tx.risk.create({
          data: {
            meetingId,
            description: r.description,
            level: r.level,
            mitigationSteps: r.mitigationSteps ?? null,
            owner: r.owner ?? null,
          },
        });
      }
    });

    emitPipelineEvent(meetingId, { step: 'persist', status: 'complete' });
    return { persisted: true };
  },
});

// ============================================================
// Step 6: Index Vectors (Qdrant)
// ============================================================

const indexVectorsStep = new Step({
  id: 'indexVectors',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const { transcript } = context.getStepResult('transcribe') as { transcript: string };
    const extraction = context.getStepResult('extract') as z.infer<typeof ExtractionResultSchema>;
    const persistResult = context.getStepResult('persist') as any;
    const { meetingId, projectTags } = input;

    if (persistResult?.queued) {
      logger.info('Skipping vector indexing because app is offline. Embeddings will index on sync.', { meetingId });
      emitPipelineEvent(meetingId, { step: 'indexVectors', status: 'complete', data: { skipped: true } });
      return { skipped: true };
    }

    emitPipelineEvent(meetingId, { step: 'indexVectors', status: 'running' });
    logger.info('Pipeline Step 6: Vector Indexing', { meetingId });

    try {
      const chunks: string[] = [
        ...chunkText(transcript, 500),
        ...extraction.decisions.map(d => d.context),
        ...extraction.actionItems.map(a => a.description),
      ];

      const { embeddings } = await embedMany({
        model: getEmbeddingModel(),
        values: chunks,
      });

      const transcriptChunkCount = chunkText(transcript, 500).length;

      const points = chunks.map((content, i) => ({
        id: uuidv4(),
        vector: embeddings[i] ?? [],
        meetingId,
        contentType: i < transcriptChunkCount ? 'transcript' as const :
          i < transcriptChunkCount + extraction.decisions.length ? 'decision' as const : 'action_item' as const,
        content,
        projectTags,
        meetingDate: new Date().toISOString(),
      }));

      await upsertVectors(points);

      await prisma.memoryVector.createMany({
        data: points.map(p => ({
          meetingId,
          qdrantPointId: p.id,
          contentType: p.contentType,
          contentSnippet: p.content.slice(0, 500),
        })),
        skipDuplicates: true,
      });

      emitPipelineEvent(meetingId, { step: 'indexVectors', status: 'complete', data: { vectorCount: points.length } });
      return { indexedCount: points.length };
    } catch (error) {
      logger.error('Vector indexing failed during workflow', { error });
      emitPipelineEvent(meetingId, { step: 'indexVectors', status: 'complete', data: { failed: true } });
      return { failed: true };
    }
  },
});

// ============================================================
// Step 7: Follow-up Triggers
// ============================================================

const followUpStep = new Step({
  id: 'followUp',
  execute: async ({ context }: any) => {
    const input = (context.triggerData || context.machineContext?.triggerData) as z.infer<typeof PipelineInputSchema>;
    const extraction = context.getStepResult('extract') as z.infer<typeof ExtractionResultSchema>;
    const { validationResults } = context.getStepResult('validate') as any;
    const persistResult = context.getStepResult('persist') as any;
    const { meetingId, title, userId } = input;

    if (persistResult?.queued) {
      logger.info('App is offline, skipping follow-up triggers', { meetingId });
      emitPipelineEvent(meetingId, { step: 'followUp', status: 'complete', data: { skipped: true, offline: true } });
      return { skipped: true, offline: true };
    }

    if (env.REQUIRE_HUMAN_APPROVAL) {
      logger.info('HITL mode: Skipping auto follow-up, awaiting human approval', { meetingId });
      emitPipelineEvent(meetingId, { step: 'followUp', status: 'awaiting_approval' });
      return { skipped: true, reason: 'HITL_REQUIRED' };
    }

    emitPipelineEvent(meetingId, { step: 'followUp', status: 'running' });
    logger.info('Pipeline Step 7: Follow-up Triggers', { meetingId });

    const approvedItems = validationResults.filter((r: any) => r.isValid);
    const results: Record<string, unknown>[] = [];

    for (const result of approvedItems) {
      const actionItem = result.item;

      // Jira
      const jiraResult = await createJiraTicketTool.execute!({
        context: {
          summary: actionItem.description.slice(0, 255),
          description: `${actionItem.description}\n\nAssignee: ${actionItem.assignee}\nDeadline: ${actionItem.deadline ?? 'Not specified'}`,
          assignee: actionItem.assignee,
          priority: actionItem.priority,
          dueDate: actionItem.deadline ?? undefined,
          meetingId,
          actionItemId: actionItem.id,
        },
        runId: '',
        mastra: undefined as any,
        agents: {},
        workflows: {},
      } as any);

      // Update DB with Jira info
      if (jiraResult.success) {
        await prisma.actionItem.updateMany({
          where: { meetingId, description: actionItem.description },
          data: { jiraTicketId: jiraResult.ticketId, jiraTicketUrl: jiraResult.ticketUrl, status: 'JIRA_CREATED' },
        });
      }

      results.push({ actionItemId: actionItem.id, jira: jiraResult });

      await writeAuditLog({
        userId,
        action: 'JIRA_TICKET_CREATED',
        resource: `meeting:${meetingId}`,
        metadata: { ticketId: jiraResult.ticketId },
        severity: 'INFO',
      });
    }

    emitPipelineEvent(meetingId, { step: 'followUp', status: 'complete', data: { triggeredCount: results.length } });
    return { triggeredCount: results.length, results };
  },
});

// ============================================================
// Assemble Workflow
// ============================================================

export const meetingPipeline = new Workflow({
  name: 'meetingPipeline',
  triggerSchema: PipelineInputSchema,
})
  .step(transcribeStep)
  .then(queryMemoryStep)
  .then(extractionStep)
  .then(validationStep)
  .then(persistStep)
  .then(indexVectorsStep)
  .then(followUpStep)
  .commit();

// ============================================================
// Helpers
// ============================================================

function chunkText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = word;
    } else {
      current += (current ? ' ' : '') + word;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
