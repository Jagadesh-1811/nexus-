/**
 * MASTRA ORCHESTRATOR INSTANCE
 * 
 * Central hub connecting all agents, tools, and workflows.
 */

import { Mastra } from '@mastra/core';
import { meetingAnalystAgent } from './agents/meetingAnalyst';
import { followUpAgent } from './agents/followUpAgent';
import { meetingPipeline } from './workflows/meetingPipeline';
import { logger } from '../config/logger';

export const mastra: Mastra = new Mastra({
  agents: {
    meetingAnalyst: meetingAnalystAgent,
    followUp: followUpAgent,
  },
  workflows: {
    meetingPipeline: meetingPipeline as any,
  },
});

logger.info('Mastra orchestrator initialized', {
  agents: ['meetingAnalyst', 'followUp'],
  workflows: ['meetingPipeline'],
});

export { meetingPipeline };
