import { createOpenAI } from '@ai-sdk/openai';
import { env } from '../config/env';
import { logger } from '../config/logger';

// Define model options
export const MODELS = {
  OLLAMA_QWEN_14B: 'qwen2.5:14b',
  OLLAMA_QWEN_1M: 'qwen2.5-1m:14b',
  OPENAI_GPT_4O: 'gpt-4o',
};

// Create local Ollama instance (using its OpenAI-compatible endpoint)
const ollama = createOpenAI({
  baseURL: env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
  apiKey: 'ollama', // Dummy key
});

// Create cloud OpenAI instance
const openaiCloud = createOpenAI({
  apiKey: env.OPENAI_API_KEY || 'sk-dummy-key',
});

/**
 * Returns the appropriate model instance based on settings.
 * Supports swappable providers.
 */
export function getLLMModel(provider: 'ollama' | 'openai' = 'ollama', modelName?: string) {
  const model = modelName || (provider === 'ollama' ? MODELS.OLLAMA_QWEN_14B : MODELS.OPENAI_GPT_4O);
  
  logger.info(`Initializing LLM Model: ${provider}/${model}`);

  if (provider === 'ollama') {
    return ollama(model);
  } else {
    return openaiCloud(model);
  }
}

/**
 * Returns the appropriate embedding model based on settings.
 * Falls back to local nomic-embed-text:latest if OpenAI key is missing.
 */
export function getEmbeddingModel() {
  if (env.OPENAI_API_KEY) {
    return openaiCloud.embedding(env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large');
  } else {
    logger.info('Using local Ollama nomic-embed-text:latest for embeddings');
    return ollama.embedding('nomic-embed-text:latest');
  }
}


/**
 * Perform a simple check if Ollama is running
 */
export async function checkOllamaStatus(): Promise<boolean> {
  const baseURL = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
  const url = baseURL.endsWith('/v1')
    ? baseURL.substring(0, baseURL.length - 3) + '/api/tags'
    : baseURL.replace(/\/+$/, '') + '/api/tags';
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json() as any;
      logger.info('Local Ollama status check: ONLINE', { models: data.models?.length });
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('Local Ollama status check: OFFLINE', { error: String(error) });
    return false;
  }
}
