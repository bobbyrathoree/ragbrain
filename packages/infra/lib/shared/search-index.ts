interface SearchIndexClient {
  indices: {
    exists(args: { index: string }): Promise<{ body: boolean }>;
    get(args: { index: string }): Promise<{ body: any }>;
    create(args: { index: string; body: unknown }): Promise<unknown>;
  };
}

export function buildSearchIndexDefinition(dimension: number) {
  return {
    settings: {
      index: {
        knn: true,
      },
    },
    mappings: {
      dynamic: true,
      properties: {
        id: { type: 'keyword' },
        user: { type: 'keyword' },
        docType: { type: 'keyword' },
        text: { type: 'text' },
        summary: { type: 'text' },
        tags: { type: 'keyword' },
        type: { type: 'keyword' },
        created_at_epoch: { type: 'date', format: 'epoch_millis' },
        decision_score: { type: 'float' },
        embedding: {
          type: 'knn_vector',
          dimension,
          method: {
            name: 'hnsw',
            engine: 'faiss',
            space_type: 'cosinesimil',
            parameters: {
              ef_construction: 128,
              m: 24,
            },
          },
        },
      },
    },
  } as const;
}

export function assertEmbeddingDimensions(
  embedding: unknown,
  expectedDimension: number,
): asserts embedding is number[] {
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding model returned a non-array response');
  }
  if (embedding.length !== expectedDimension) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimension}, received ${embedding.length}`,
    );
  }
  if (embedding.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Embedding model returned a non-finite vector value');
  }
}

function validateExistingMapping(indexBody: any, indexName: string, dimension: number): void {
  const indexMapping = indexBody?.[indexName] || Object.values(indexBody || {})[0];
  const properties = (indexMapping as any)?.mappings?.properties;

  // An empty/unreadable response is not evidence of a bad mapping. Failing open
  // here would be worse: it would let a float-mapped index keep serving silent
  // BM25-only results, which is the exact defect this module exists to prevent.
  if (!properties) {
    throw new Error(
      `Could not read the mapping for ${indexName}; refusing to index against an unverified mapping`,
    );
  }

  if (
    properties.embedding?.type !== 'knn_vector'
    || properties.embedding.dimension !== dimension
    || properties.id?.type !== 'keyword'
    || properties.user?.type !== 'keyword'
  ) {
    throw new Error(
      `Search index ${indexName} has an incompatible mapping; delete it and reindex from DynamoDB`,
    );
  }
}

export async function ensureSearchIndex(
  client: SearchIndexClient,
  indexName: string,
  dimension: number,
): Promise<void> {
  const exists = await client.indices.exists({ index: indexName });
  if (exists.body) {
    // Use indices.get (GET /<index>), NOT indices.getMapping. OpenSearch
    // Serverless returns 404 for GET /<index>/_mapping even when the index
    // exists and is healthy, so getMapping made validation fail permanently the
    // moment the index existed — a deadlock that blocked all indexing.
    // GET /<index> returns the same mappings block and is supported.
    const existing = await client.indices.get({ index: indexName });
    validateExistingMapping(existing.body, indexName, dimension);
    return;
  }

  try {
    await client.indices.create({
      index: indexName,
      body: buildSearchIndexDefinition(dimension),
    });
  } catch (error: any) {
    const errorType = error?.meta?.body?.error?.type;
    if (errorType !== 'resource_already_exists_exception') {
      throw error;
    }
  }

  const created = await client.indices.get({ index: indexName });
  validateExistingMapping(created.body, indexName, dimension);
}
