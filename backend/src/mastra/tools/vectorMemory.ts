/**
 * VECTOR MEMORY TOOLS
 * 
 * Qdrant-backed cross-meeting memory:
 * - queryMemoryTool: semantic search over historical meetings
 * - indexMemoryTool: stores new meeting embeddings
 */

import { createTool } from '@mastra/core/tools';
import { openai } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { searchSimilar, upsertVectors } from '../../services/qdrant.js';
import { prisma } from '../../services/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

async function generateEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}

// ============================================================
// Query Memory Tool
// ============================================================

export const queryMemoryTool = createTool({
  id: 'queryMemory',
  description: 'Queries Qdrant vector DB for historically relevant meeting context using semantic similarity',
  inputSchema: z.object({
    query: z.string().describe('The semantic search query — typically a summary of current meeting topic'),
    meetingId: z.string().describe('Current meeting ID to exclude from results'),
    projectTags: z.array(z.string()).optional().describe('Filter by project tags'),
    limit: z.number().default(10),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      meetingId: z.string(),
      contentType: z.string(),
      content: z.string(),
      score: z.number(),
      meetingDate: z.string(),
    })),
    hasContext: z.boolean(),
  }),
  execute: async ({ context }) => {
    const { query, meetingId, projectTags, limit } = context;
    logger.info('Querying vector memory', { query: query.slice(0, 100), meetingId });

    const queryVector = await generateEmbedding(query);
    const searchOptions: { excludeMeetingId?: string; projectTags?: string[] } = {};
    if (meetingId) searchOptions.excludeMeetingId = meetingId;
    if (projectTags) searchOptions.projectTags = projectTags;

    const results = await searchSimilar(queryVector, limit, searchOptions);

    logger.info('Vector memory query results', { count: results.length, hasContext: results.length > 0 });
    return { results, hasContext: results.length > 0 };
  },
});

// ============================================================
// Index Memory Tool
// ============================================================

export const indexMemoryTool = createTool({
  id: 'indexMemory',
  description: 'Indexes new meeting content into Qdrant and records the vector IDs in PostgreSQL',
  inputSchema: z.object({
    meetingId: z.string(),
    transcript: z.string(),
    decisions: z.array(z.string()),
    actionItems: z.array(z.string()),
    projectTags: z.array(z.string()),
    meetingDate: z.string(),
  }),
  outputSchema: z.object({
    indexedCount: z.number(),
    vectorIds: z.array(z.string()),
  }),
  execute: async ({ context }) => {
    const { meetingId, transcript, decisions, actionItems, projectTags, meetingDate } = context;
    logger.info('Indexing meeting vectors', { meetingId });

    const chunks: Array<{ contentType: 'transcript' | 'decision' | 'action_item'; content: string }> = [
      // Chunk transcript into ~500 char segments
      ...chunkText(transcript, 500).map(c => ({ contentType: 'transcript' as const, content: c })),
      ...decisions.map(d => ({ contentType: 'decision' as const, content: d })),
      ...actionItems.map(a => ({ contentType: 'action_item' as const, content: a })),
    ];

    if (chunks.length === 0) return { indexedCount: 0, vectorIds: [] };

    // Batch embed all chunks
    const { embeddings } = await embedMany({
      model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
      values: chunks.map(c => c.content),
    });

    const points = chunks.map((chunk, i) => ({
      id: uuidv4(),
      vector: embeddings[i] ?? [],
      meetingId,
      contentType: chunk.contentType,
      content: chunk.content,
      projectTags,
      meetingDate,
    }));

    await upsertVectors(points);

    // Record in PostgreSQL for traceability
    await prisma.memoryVector.createMany({
      data: points.map(p => ({
        meetingId,
        qdrantPointId: p.id,
        contentType: p.contentType,
        contentSnippet: p.content.slice(0, 500),
      })),
      skipDuplicates: true,
    });

    logger.info('Indexed vectors successfully', { count: points.length, meetingId });
    return { indexedCount: points.length, vectorIds: points.map(p => p.id) };
  },
});

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
