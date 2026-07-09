/**
 * MASTRA ORCHESTRATOR INSTANCE
 * 
 * Central hub connecting all agents, tools, and workflows.
 */

import { Mastra } from '@mastra/core';
import { meetingAnalystAgent } from './agents/meetingAnalyst.js';
import { followUpAgent } from './agents/followUpAgent.js';
import { meetingPipeline } from './workflows/meetingPipeline.js';
import { logger } from '../config/logger.js';

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
