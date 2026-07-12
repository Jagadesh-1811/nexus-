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

// Create Featherless AI instance (OpenAI-compatible)
const featherless = createOpenAI({
  baseURL: env.FEATHERLESS_BASE_URL || 'https://api.featherless.ai/v1',
  apiKey: env.FEATHERLESS_API_KEY || 'dummy-key',
});

/**
 * Custom wrapper to handle model execution fallbacks (e.g. quota exceeded)
 */
function wrapWithFallback(primary: any, fallback: any): any {
  return {
    specificationVersion: 'v1',
    provider: primary.provider || 'fallback-wrapper',
    modelId: primary.modelId || 'fallback-wrapper',
    defaultObjectGenerationMode: primary.defaultObjectGenerationMode,
    doGenerate: async (options: any) => {
      try {
        return await primary.doGenerate(options);
      } catch (error: any) {
        logger.warn(`Primary AI model generation failed (quota exceeded or error). Falling back to backup. Error: ${error.message || String(error)}`);
        return await fallback.doGenerate(options);
      }
    },
    doStream: async (options: any) => {
      try {
        return await primary.doStream(options);
      } catch (error: any) {
        logger.warn(`Primary AI model streaming failed (quota exceeded or error). Falling back to backup. Error: ${error.message || String(error)}`);
        return await fallback.doStream(options);
      }
    }
  };
}

/**
 * Returns the appropriate model instance based on settings.
 * Supports swappable providers and automatic serverless failover to local.
 */
export function getLLMModel(provider: 'ollama' | 'openai' | 'featherless' = 'ollama', modelName?: string) {
  // If FEATHERLESS_API_KEY is configured, try Featherless first, and fall back to local Ollama if quota is exceeded
  if (provider === 'ollama' && env.FEATHERLESS_API_KEY) {
    logger.info('FEATHERLESS_API_KEY is configured. Creating resilient Featherless AI model with local Ollama fallback.');
    
    const featherlessModelName = env.FEATHERLESS_MODEL;
    const ollamaModelName = modelName || MODELS.OLLAMA_QWEN_14B;
    
    const primary = featherless(featherlessModelName);
    const backup = ollama(ollamaModelName);
    
    return wrapWithFallback(primary, backup);
  }

  const model = modelName || (
    provider === 'featherless' ? env.FEATHERLESS_MODEL : 
    provider === 'ollama' ? MODELS.OLLAMA_QWEN_14B : 
    MODELS.OPENAI_GPT_4O
  );
  
  logger.info(`Initializing LLM Model: ${provider}/${model}`);

  if (provider === 'featherless') {
    return featherless(model);
  } else if (provider === 'ollama') {
    return ollama(model);
  } else {
    return openaiCloud(model);
  }
}

/**
 * Custom wrapper to handle embedding model fallbacks (e.g. quota exceeded / missing model)
 */
function wrapEmbeddingWithFallback(primary: any, fallback: any): any {
  return {
    modelId: primary.modelId || 'fallback-embedding-wrapper',
    doEmbed: async (options: any) => {
      try {
        return await primary.doEmbed(options);
      } catch (error: any) {
        logger.warn(`Primary embedding model failed, falling back to local Ollama. Error: ${error.message || String(error)}`);
        return await fallback.doEmbed(options);
      }
    },
    doEmbedMany: async (options: any) => {
      try {
        return await primary.doEmbedMany(options);
      } catch (error: any) {
        logger.warn(`Primary batch embedding model failed, falling back to local Ollama. Error: ${error.message || String(error)}`);
        return await fallback.doEmbedMany(options);
      }
    }
  };
}

/**
 * Returns the appropriate embedding model based on settings.
 * Falls back to local nomic-embed-text:latest if OpenAI/Featherless fails.
 */
export function getEmbeddingModel() {
  const localOllamaEmbedding = ollama.embedding('nomic-embed-text:latest');

  if (env.OPENAI_API_KEY) {
    const primaryEmbedding = openaiCloud.embedding(env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large');
    return wrapEmbeddingWithFallback(primaryEmbedding, localOllamaEmbedding);
  } else if (env.FEATHERLESS_API_KEY) {
    logger.info('Using Featherless AI for embeddings with local Ollama fallback');
    // Using standard nomic embedding model on Featherless
    const primaryEmbedding = featherless.embedding('Qwen/Qwen3-Embedding-8B');
    return wrapEmbeddingWithFallback(primaryEmbedding, localOllamaEmbedding);
  } else {
    logger.info('Using local Ollama nomic-embed-text:latest for embeddings');
    return localOllamaEmbedding;
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
