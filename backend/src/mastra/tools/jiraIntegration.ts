import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const jiraAuth = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');

const PRIORITY_MAP: Record<string, string> = {
  CRITICAL: 'Highest',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const createJiraTicketTool = createTool({
  id: 'createJiraTicket',
  description: 'Creates a Jira issue for a validated action item',
  inputSchema: z.object({
    summary: z.string().max(255),
    description: z.string(),
    assignee: z.string().optional(),
    priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
    dueDate: z.string().optional().describe('YYYY-MM-DD format'),
    projectKey: z.string().optional(),
    meetingId: z.string(),
    actionItemId: z.string(),
  }),
  outputSchema: z.object({
    ticketId: z.string(),
    ticketUrl: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { summary, description, assignee, priority, dueDate, projectKey, meetingId, actionItemId } = context;

    if (!env.JIRA_BASE_URL || !env.JIRA_API_TOKEN) {
      logger.warn('Jira not configured — skipping ticket creation', { actionItemId });
      return { ticketId: '', ticketUrl: '', success: false, error: 'Jira not configured' };
    }

    try {
      const payload: Record<string, unknown> = {
        fields: {
          project: { key: projectKey ?? env.JIRA_DEFAULT_PROJECT },
          summary: `[Synapse] ${summary}`,
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: description }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: `\n📋 Source: Synapse Meeting ID ${meetingId}` }],
              },
            ],
          },
          issuetype: { name: 'Task' },
          priority: { name: PRIORITY_MAP[priority] ?? 'Medium' },
          labels: ['synapse-ai', 'auto-generated'],
        },
      };

      if (dueDate) (payload['fields'] as any).duedate = dueDate;

      const response = await axios.post(
        `${env.JIRA_BASE_URL}/rest/api/3/issue`,
        payload,
        {
          headers: {
            Authorization: `Basic ${jiraAuth}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 10000,
        }
      );

      const ticketId = response.data.key as string;
      const ticketUrl = `${env.JIRA_BASE_URL}/browse/${ticketId}`;

      logger.info('Jira ticket created', { ticketId, ticketUrl, actionItemId });
      return { ticketId, ticketUrl, success: true };
    } catch (error) {
      const msg = axios.isAxiosError(error) ? error.response?.data?.errorMessages?.join(', ') ?? error.message : (error as Error).message;
      logger.error('Jira ticket creation failed', { error: msg, actionItemId });
      return { ticketId: '', ticketUrl: '', success: false, error: msg };
    }
  },
});
