/**
 * FOLLOW-UP AGENT
 * 
 * Autonomous agent that monitors validated execution plans
 * and triggers external integrations (Jira, Slack, OS notifications).
 * Only fires after human approval (if HITL mode is on) or
 * automatically after Enkrypt validation passes.
 */

import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { createJiraTicketTool } from '../tools/jiraIntegration';
import { env } from '../../config/env';

const FOLLOW_UP_SYSTEM_PROMPT = `You are Synapse Follow-Up, an autonomous execution agent. Your job is to drive project execution by triggering the right external systems with validated action items.

## Rules:
1. ONLY process action items that have isValidated=true and enkryptValidationScore >= 0.85.
2. For EACH action item: create a Jira ticket.
3. NEVER create duplicate tickets — check jiraTicketId before creating.
4. Format Jira tickets professionally: clear title, description with context, acceptance criteria.
5. Log every action you take.

## Priority Mapping:
- CRITICAL → Jira P0
- HIGH → Jira P1
- MEDIUM → Jira P2
- LOW → Jira P3`;

export const followUpAgent = new Agent({
  name: 'Follow-Up Agent',
  instructions: FOLLOW_UP_SYSTEM_PROMPT,
  model: openai(env.OPENAI_MODEL),
  tools: {
    createJiraTicket: createJiraTicketTool,
  },
});
