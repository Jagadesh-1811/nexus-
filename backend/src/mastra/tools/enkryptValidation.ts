/**
 * ENKRYPT AI VALIDATION TOOL — THE SAFETY GATE
 * 
 * Every extracted action item passes through Enkrypt AI's guardrail layer.
 * Items with hallucination flags are refined up to MAX_REFINEMENT_ITERATIONS
 * before being marked as failed (never persisted to DB unchecked).
 * 
 * Integration: Routes GPT-4o calls through Enkrypt AI proxy which applies
 * real-time hallucination detection + content safety policies.
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';
import { env } from '../../config/env';
import { logger } from '../../config/logger';

const MAX_REFINEMENT_ITERATIONS = 3;
const MIN_CONFIDENCE_THRESHOLD = 0.75;

// Enkrypt AI client — routes through their guardrail proxy
const enkryptClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.ENKRYPT_AI_BASE_URL,
  defaultHeaders: {
    'apikey': env.ENKRYPT_AI_API_KEY,
  },
});

// Direct OpenAI client for refinement without proxy
const openaiDirect = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const ActionItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  assignee: z.string(),
  deadline: z.string().nullable(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});

type ActionItem = z.infer<typeof ActionItemSchema>;

interface ValidationResult {
  item: ActionItem;
  isValid: boolean;
  confidenceScore: number;
  hallucFlags: string[];
  refinementCount: number;
  enkryptReport: Record<string, unknown>;
}

async function validateSingleItem(
  item: ActionItem,
  transcript: string,
  iteration = 0
): Promise<ValidationResult> {
  const validationPrompt = `You are a hallucination detection auditor for AI meeting notes.

ORIGINAL TRANSCRIPT EXCERPT:
"""
${transcript.slice(0, 8000)}
"""

EXTRACTED ACTION ITEM TO VALIDATE:
${JSON.stringify(item, null, 2)}

TASK:
1. Check if the assignee "${item.assignee}" is actually mentioned in the transcript.
2. Check if the deadline "${item.deadline}" was actually stated in the transcript.
3. Check if the task description is grounded in the transcript.

Respond ONLY with this JSON:
{
  "isGrounded": true/false,
  "confidenceScore": 0.0-1.0,
  "hallucFlags": ["list of specific hallucinated details, or empty array"],
  "refinedItem": { same structure as input, with corrections if needed }
}`;

  try {
    // Route through Enkrypt AI proxy
    const response = await enkryptClient.chat.completions.create({
      model: env.ENKRYPT_AI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a precise JSON-only hallucination auditor.' },
        { role: 'user', content: validationPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1000,
    });

    const rawContent = response.choices[0]?.message?.content ?? '{}';
    let parsed: {
      isGrounded: boolean;
      confidenceScore: number;
      hallucFlags: string[];
      refinedItem: ActionItem;
    };

    try {
      parsed = JSON.parse(rawContent);
    } catch {
      logger.error('Enkrypt validation JSON parse failed', { rawContent });
      parsed = { isGrounded: false, confidenceScore: 0, hallucFlags: ['Parse error'], refinedItem: item };
    }

    const { isGrounded, confidenceScore, hallucFlags, refinedItem } = parsed;
    const safeScore = Math.max(0, Math.min(1, confidenceScore ?? 0));

    // If hallucinations detected and we have refinement attempts left
    if ((!isGrounded || safeScore < MIN_CONFIDENCE_THRESHOLD) && iteration < MAX_REFINEMENT_ITERATIONS) {
      logger.warn('Hallucination detected, attempting refinement', {
        itemId: item.id,
        iteration,
        flags: hallucFlags,
        score: safeScore,
      });

      // Refine the item using the corrected version
      const correctedItem = { ...item, ...refinedItem };
      return validateSingleItem(correctedItem, transcript, iteration + 1);
    }

    return {
      item: refinedItem ?? item,
      isValid: isGrounded && safeScore >= MIN_CONFIDENCE_THRESHOLD,
      confidenceScore: safeScore,
      hallucFlags: hallucFlags ?? [],
      refinementCount: iteration,
      enkryptReport: {
        isGrounded,
        confidenceScore: safeScore,
        hallucFlags: hallucFlags ?? [],
        iterations: iteration,
        model: response.model,
        usage: response.usage,
      },
    };
  } catch (error) {
    logger.error('Enkrypt AI validation call failed', { error, itemId: item.id, iteration });

    // SAFETY: If validation service is down, mark as INVALID — never allow unvalidated data through
    return {
      item,
      isValid: false,
      confidenceScore: 0,
      hallucFlags: ['VALIDATION_SERVICE_UNAVAILABLE'],
      refinementCount: iteration,
      enkryptReport: { error: (error as Error).message, serviceDown: true },
    };
  }
}

// ============================================================
// Enkrypt Validation Tool
// ============================================================

export const enkryptValidationTool = createTool({
  id: 'enkryptValidation',
  description: 'Validates extracted action items through Enkrypt AI guardrails to detect hallucinations. MANDATORY gate — items failing validation are never persisted.',
  inputSchema: z.object({
    actionItems: z.array(ActionItemSchema),
    transcript: z.string().describe('Original meeting transcript for grounding verification'),
    meetingId: z.string(),
  }),
  outputSchema: z.object({
    validatedItems: z.array(z.object({
      item: ActionItemSchema,
      isValid: z.boolean(),
      confidenceScore: z.number(),
      hallucFlags: z.array(z.string()),
      refinementCount: z.number(),
      enkryptReport: z.record(z.unknown()),
    })),
    overallScore: z.number(),
    hallucFlagsTotal: z.number(),
    passedCount: z.number(),
    failedCount: z.number(),
  }),
  execute: async ({ context }) => {
    const { actionItems, transcript, meetingId } = context;
    logger.info('Starting Enkrypt AI validation', { meetingId, itemCount: actionItems.length });

    // Validate all items in parallel (with concurrency limit)
    const CONCURRENCY = 3;
    const results: ValidationResult[] = [];

    for (let i = 0; i < actionItems.length; i += CONCURRENCY) {
      const batch = actionItems.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(item => validateSingleItem(item, transcript))
      );
      results.push(...batchResults);
    }

    const passedCount = results.filter(r => r.isValid).length;
    const failedCount = results.length - passedCount;
    const hallucFlagsTotal = results.reduce((sum, r) => sum + r.hallucFlags.length, 0);
    const overallScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.confidenceScore, 0) / results.length
      : 0;

    logger.info('Enkrypt validation complete', {
      meetingId,
      passedCount,
      failedCount,
      hallucFlagsTotal,
      overallScore: overallScore.toFixed(3),
    });

    return {
      validatedItems: results,
      overallScore,
      hallucFlagsTotal,
      passedCount,
      failedCount,
    };
  },
});
