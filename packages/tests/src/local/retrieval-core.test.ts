import assert from 'node:assert/strict';
import type * as SearchIndexExports from '../../../infra/lib/shared/search-index.ts';
import type * as SearchCoreExports from '../../../infra/lib/shared/search-core.ts';

const searchIndexImport = await import('../../../infra/lib/shared/search-index.ts');
const searchCoreImport = await import('../../../infra/lib/shared/search-core.ts');
const searchIndexModule = (
  (searchIndexImport as typeof searchIndexImport & { default?: typeof SearchIndexExports }).default
  || searchIndexImport
);
const searchCoreModule = (
  (searchCoreImport as typeof searchCoreImport & { default?: typeof SearchCoreExports }).default
  || searchCoreImport
);

const {
  assertEmbeddingDimensions,
  buildSearchIndexDefinition,
} = searchIndexModule;
const { reciprocalRankFusion } = searchCoreModule;

const definition = buildSearchIndexDefinition(1024);
assert.equal(definition.settings.index.knn, true);
assert.deepEqual(definition.mappings.properties.embedding, {
  type: 'knn_vector',
  dimension: 1024,
  method: {
    name: 'hnsw',
    engine: 'faiss',
    space_type: 'cosinesimil',
    parameters: {
      ef_construction: 128,
      m: 24,
    },
  },
});
assert.equal(definition.mappings.properties.id.type, 'keyword');
assert.equal(definition.mappings.properties.user.type, 'keyword');

assert.doesNotThrow(() => assertEmbeddingDimensions(new Array(1024).fill(0), 1024));
assert.throws(
  () => assertEmbeddingDimensions(new Array(1536).fill(0), 1024),
  /expected 1024, received 1536/,
);

const lexical = [
  { _id: 'lexical-a', _score: 12, _source: { id: 'a' } },
  { _id: 'lexical-b', _score: 8, _source: { id: 'b' } },
];
const semantic = [
  { _id: 'semantic-b', _score: 0.91, _source: { id: 'b' } },
  { _id: 'semantic-c', _score: 0.88, _source: { id: 'c' } },
];

const fused = reciprocalRankFusion(lexical, semantic, 60);
assert.deepEqual(fused.map((hit: typeof lexical[number]) => hit._source.id), ['b', 'a', 'c']);
assert(fused.every((hit: typeof lexical[number]) => hit._score >= 0 && hit._score <= 1));

console.log('retrieval core: mapping, dimensions, and RRF invariants passed');
