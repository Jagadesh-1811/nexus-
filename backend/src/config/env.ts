import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  API_VERSION: z.string().default('v1'),

  // Security
  JWT_SECRET: z.string().default('default_jwt_secret_value_for_synapse_app'),
  HMAC_SECRET: z.string().default('default_hmac_secret_value_for_synapse_app'),
  ENCRYPTION_KEY: z.string().default('default_encryption_key_value_for_synapse_app_exactly_32_bytes_long'),
  SESSION_SECRET: z.string().default('default_session_secret_value_for_synapse_app'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Auth (Legacy Firebase)
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // Database
  DATABASE_URL: z.string().url(),

  // Supabase (Storage)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Qdrant
  QDRANT_URL: z.string().url(),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default('synapse_meetings'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // OpenAI (Optional for local-first runtime)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),

  // Ollama (Primary local AI processor)
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434/v1'),
  OLLAMA_MODEL: z.string().default('qwen2.5:14b'),
  OLLAMA_AUDITOR_MODEL: z.string().default('qwen2.5:14b'),

  // Deepgram (Optional failover)
  DEEPGRAM_API_KEY: z.string().optional(),


  // Enkrypt AI (Optional guardrail)
  ENKRYPT_AI_API_KEY: z.string().optional(),
  ENKRYPT_AI_BASE_URL: z.string().url().default('https://api.enkryptai.com/v1'),
  ENKRYPT_AI_MODEL: z.string().optional(),
  USE_CLOUD_ENKRYPT: z.string().transform(v => v === 'true').default('false'),



  // Jira
  JIRA_BASE_URL: z.preprocess((val) => (val === '' ? undefined : val), z.string().url().optional()),
  JIRA_EMAIL: z.preprocess((val) => (val === '' ? undefined : val), z.string().email().optional()),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_DEFAULT_PROJECT: z.string().default('PROJ'),

  // Upload
  MAX_FILE_SIZE_MB: z.string().transform(Number).default('500'),
  UPLOAD_DIR: z.string().default('./uploads'),
  ALLOWED_AUDIO_TYPES: z.string().default('audio/mpeg,audio/mp4,audio/wav,audio/webm,video/mp4,video/webm'),

  // Features
  REQUIRE_HUMAN_APPROVAL: z.string().transform(v => v === 'true').default('false'),
  AUDIT_LOG_RETENTION_DAYS: z.string().transform(Number).default('90'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
