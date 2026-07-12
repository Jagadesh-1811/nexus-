import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env';
import { logger } from '../config/logger';

// ============================================================
// Qdrant Client Singleton
// ============================================================

export const qdrant = new QdrantClient({
  url: env.QDRANT_URL,
  ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});

const COLLECTION_NAME = env.OPENAI_API_KEY ? env.QDRANT_COLLECTION : `${env.QDRANT_COLLECTION}_local`;
const VECTOR_SIZE = env.OPENAI_API_KEY ? 3072 : (env.FEATHERLESS_API_KEY ? 4096 : 768); // 3072 for OpenAI, 4096 for Featherless Qwen3, 768 for local nomic

// ============================================================
// Collection Initialization
// ============================================================

async function createNewCollection(): Promise<void> {
  await qdrant.createCollection(COLLECTION_NAME, {
    vectors: {
      size: VECTOR_SIZE,
      distance: 'Cosine',
    },
    optimizers_config: {
      default_segment_number: 2,
    },
    replication_factor: 1,
  });

  // Create payload indexes for fast filtering
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'meetingId',
    field_schema: 'keyword',
  });
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'contentType',
    field_schema: 'keyword',
  });
  await qdrant.createPayloadIndex(COLLECTION_NAME, {
    field_name: 'projectTags',
    field_schema: 'keyword',
  });

  logger.info(`Qdrant collection "${COLLECTION_NAME}" created`, { vectorSize: VECTOR_SIZE });
}

export async function initializeQdrantCollection(): Promise<void> {
  try {
    const collections = await qdrant.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION_NAME);

    if (exists) {
      const details = await qdrant.getCollection(COLLECTION_NAME);
      const currentSize = (details.config?.params?.vectors as any)?.size;
      if (currentSize !== VECTOR_SIZE) {
        logger.warn(`Dimension mismatch for Qdrant collection "${COLLECTION_NAME}". Expected: ${VECTOR_SIZE}, Found: ${currentSize}. Recreating collection...`);
        await qdrant.deleteCollection(COLLECTION_NAME);
        await createNewCollection();
      } else {
        logger.info(`Qdrant collection "${COLLECTION_NAME}" already exists with correct size: ${VECTOR_SIZE}`);
      }
    } else {
      await createNewCollection();
    }
  } catch (error) {
    logger.error('Failed to initialize Qdrant collection', { error });
    throw error;
  }
}

// ============================================================
// Upsert Vectors
// ============================================================

interface VectorPoint {
  id: string;
  vector: number[];
  meetingId: string;
  contentType: 'transcript' | 'decision' | 'action_item';
  content: string;
  projectTags: string[];
  meetingDate: string;
}

export async function upsertVectors(points: VectorPoint[]): Promise<void> {
  if (points.length === 0) return;

  await qdrant.upsert(COLLECTION_NAME, {
    wait: true,
    points: points.map(p => ({
      id: p.id,
      vector: p.vector,
      payload: {
        meetingId: p.meetingId,
        contentType: p.contentType,
        content: p.content,
        projectTags: p.projectTags,
        meetingDate: p.meetingDate,
      },
    })),
  });

  logger.info(`Upserted ${points.length} vectors to Qdrant`, { collection: COLLECTION_NAME });
}

// ============================================================
// Semantic Search
// ============================================================

interface SearchResult {
  id: string;
  score: number;
  meetingId: string;
  contentType: string;
  content: string;
  projectTags: string[];
  meetingDate: string;
}

export async function searchSimilar(
  queryVector: number[],
  limit = 10,
  filters?: { projectTags?: string[]; excludeMeetingId?: string }
): Promise<SearchResult[]> {
  const filter: any = { must: [] };

  if (filters?.projectTags && filters.projectTags.length > 0) {
    filter.must.push({
      key: 'projectTags',
      match: { any: filters.projectTags },
    });
  }

  if (filters?.excludeMeetingId) {
    filter.must_not = [{
      key: 'meetingId',
      match: { value: filters.excludeMeetingId },
    }];
  }

  const results = await qdrant.search(COLLECTION_NAME, {
    vector: queryVector,
    limit,
    score_threshold: 0.7, // Only return high-similarity results
    with_payload: true,
    ...(filter.must.length > 0 || filter.must_not ? { filter } : {}),
  });

  return results.map(r => ({
    id: String(r.id),
    score: r.score,
    meetingId: r.payload?.['meetingId'] as string,
    contentType: r.payload?.['contentType'] as string,
    content: r.payload?.['content'] as string,
    projectTags: r.payload?.['projectTags'] as string[],
    meetingDate: r.payload?.['meetingDate'] as string,
  }));
}

// ============================================================
// Delete by Meeting ID (for GDPR/data deletion)
// ============================================================

export async function deleteVectorsByMeetingId(meetingId: string): Promise<void> {
  await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    filter: {
      must: [{ key: 'meetingId', match: { value: meetingId } }],
    },
  });
  logger.info(`Deleted vectors for meeting ${meetingId}`);
}
