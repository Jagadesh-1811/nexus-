import { Router, Request, Response } from 'express';
import { embed, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { searchSimilar } from '../services/qdrant';
import { requireAuth } from '../middleware/security';
import { env } from '../config/env';
import { z } from 'zod';
import { getLLMModel } from '../services/llmProvider';

const router = Router();

const SearchQuerySchema = z.object({
  q: z.string().min(3).max(500),
  projectTags: z.string().optional().transform(v => v?.split(',').filter(Boolean)),
  limit: z.string().optional().transform(v => Math.min(Number(v ?? '10'), 50)),
});

// GET /api/memory/search?q=...&projectTags=...
router.get('/search', requireAuth, async (req: Request, res: Response) => {
  const parsed = SearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query params', details: parsed.error.flatten() });
    return;
  }

  const { q, projectTags, limit } = parsed.data;

  const { embedding } = await embed({
    model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
    value: q,
  });

  const searchOptions: { projectTags?: string[] } = {};
  if (projectTags) searchOptions.projectTags = projectTags;

  const results = await searchSimilar(embedding, limit, searchOptions);

  res.json({
    query: q,
    results,
    count: results.length,
  });
});

const AskQuerySchema = z.object({
  question: z.string(),
  context: z.string(),
});

// POST /api/memory/ask
router.post('/ask', requireAuth, async (req: Request, res: Response) => {
  const parsed = AskQuerySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  const { question, context } = parsed.data;

  const prompt = `
  You are Synapse, a meeting intelligence assistant.
  Answer the following user question using ONLY the provided meeting context.
  If the answer cannot be found in the context, say "I cannot find the answer to that in the meeting records."
  
  CONTEXT:
  """
  ${context}
  """
  
  QUESTION:
  ${question}
  
  Answer concisely and clearly. Reference specific meeting details (like meeting IDs or dates) if available.
  `;

  try {
    const model = getLLMModel('ollama', env.OLLAMA_MODEL || 'qwen2.5:14b');
    const { text } = await generateText({
      model,
      prompt,
    });
    res.json({ answer: text });
  } catch (error) {
    res.status(500).json({ error: 'Failed to synthesize answer', details: String(error) });
  }
});

export { router as memoryRouter };
