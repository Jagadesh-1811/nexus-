import { generateText, generateObject } from 'ai';
import { getLLMModel } from './llmProvider';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { z } from 'zod';
import OpenAI from 'openai';

const EnkryptResponseSchema = z.object({
  isGrounded: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  objection: z.string().optional(),
  refinedDescription: z.string().optional(),
  refinedAssignee: z.string().optional(),
  refinedDeadline: z.string().optional().nullable(),
});

/**
 * Validates an action item against the meeting transcript.
 */
export async function validateActionItem(
  item: { description: string; assignee: string; deadline: string | null; priority: string },
  transcript: string,
  options: { useCloudEnkrypt: boolean } = { useCloudEnkrypt: false }
): Promise<{
  isValid: boolean;
  objection: string | undefined;
  refinedItem: typeof item;
  confidenceScore: number;
  refinementHistory: any[];
}> {
  logger.info(`Validating Action Item: "${item.description.slice(0, 50)}"`);
  const refinementHistory: any[] = [];

  // If cloud mode is selected and API keys are available, run Enkrypt AI API
  if (options.useCloudEnkrypt && env.ENKRYPT_AI_API_KEY) {
    try {
      const result = await validateWithEnkryptCloud(item, transcript);
      return {
        isValid: result.isGrounded,
        objection: result.objection || undefined,
        refinedItem: {
          ...item,
          description: result.refinedDescription || item.description,
          assignee: result.refinedAssignee || item.assignee,
          deadline: result.refinedDeadline || item.deadline,
        },
        confidenceScore: result.confidenceScore,
        refinementHistory: [{ stage: 'cloud_validation', result }],
      };
    } catch (error) {
      logger.error('Cloud Enkrypt AI validation failed. Falling back to local check.', { error });
    }
  }

  // DEFAULT Mode: Local Dual-Model Cross-Check
  // We use our local Ollama model with an adversarial Auditor persona prompt.
  try {
    const auditorModel = getLLMModel('ollama', process.env.OLLAMA_AUDITOR_MODEL || env.OLLAMA_MODEL || 'qwen2.5:14b');
    
    const prompt = `
    You are an ADVERSARIAL HALLUCINATION AUDITOR. Your sole job is to cross-examine a drafted Action Item against the literal meeting transcript and flag ANY discrepancies or unconfirmed assertions.

    TRANSCRIPT:
    """
    ${transcript.slice(0, 8000)}
    """

    DRAFTED ACTION ITEM:
    - Description: ${item.description}
    - Assignee: ${item.assignee || 'Unassigned'}
    - Deadline: ${item.deadline || 'None'}

    CRITERIA:
    1. Is the action item description fully supported by the text?
    2. Did the assignee explicitly agree to this task, or was it just suggested? If someone else assigned it without confirmation, it is NOT validated.
    3. Is the deadline mentioned? If not, the deadline MUST be null.

    Provide your audit report in JSON with these fields:
    - isGrounded (boolean)
    - confidenceScore (number 0.0 to 1.0)
    - objection (string, describe why it is flagged, e.g. "Jagadish did not confirm he would check the logs by Friday")
    - refinedDescription (string, a corrected version matching the text)
    - refinedAssignee (string, corrected assignee or "Unassigned")
    - refinedDeadline (string, YYYY-MM-DD format or null)
    `;

    const { object } = await generateObject({
      model: auditorModel,
      schema: EnkryptResponseSchema,
      prompt,
      mode: 'json',
    });

    logger.info(`Local audit result: isGrounded=${object.isGrounded}, score=${object.confidenceScore}`);
    
    refinementHistory.push({
      stage: 'local_adversarial_audit',
      input: item,
      auditResult: object,
    });

    return {
      isValid: object.isGrounded && object.confidenceScore >= 0.75,
      objection: object.objection || undefined,
      refinedItem: {
        ...item,
        description: object.refinedDescription || item.description,
        assignee: object.refinedAssignee || item.assignee,
        deadline: object.refinedDeadline || item.deadline,
      },
      confidenceScore: object.confidenceScore,
      refinementHistory,
    };
  } catch (error) {
    logger.error('Local dual-model validation error. Defaulting to flagged state for safety.', { error });
    return {
      isValid: false,
      objection: 'Validation engine error - system safety fallback.',
      refinedItem: item,
      confidenceScore: 0,
      refinementHistory: [{ error: String(error) }],
    };
  }
}

/**
 * Call Enkrypt AI cloud API
 */
async function validateWithEnkryptCloud(item: any, transcript: string) {
  const client = new OpenAI({
    apiKey: env.ENKRYPT_AI_API_KEY,
    baseURL: env.ENKRYPT_AI_BASE_URL,
  });

  const response = await client.chat.completions.create({
    model: env.ENKRYPT_AI_MODEL || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a hallucination auditor. Review the action item against the transcript. Respond with JSON matching schema: {"isGrounded":bool,"confidenceScore":float,"objection":string,"refinedDescription":string,"refinedAssignee":string,"refinedDeadline":string}',
      },
      {
        role: 'user',
        content: `Transcript: ${transcript.slice(0, 5000)}\nAction Item: ${JSON.stringify(item)}`,
      },
    ],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{}';
  return EnkryptResponseSchema.parse(JSON.parse(content));
}
