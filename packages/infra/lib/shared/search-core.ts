interface RankedHit {
  _score: number;
  _source: {
    id: string;
  };
}

/**
 * Fuse lexical and semantic ranks without assuming their raw scores share a
 * scale. The normalized result is only an internal ranking value.
 */
export function reciprocalRankFusion<T extends RankedHit>(
  lexicalHits: T[],
  semanticHits: T[],
  rankConstant = 60,
): T[] {
  const fused = new Map<string, { hit: T; score: number }>();

  const addRankedHits = (hits: T[]) => {
    hits.forEach((hit, index) => {
      const id = hit._source.id;
      const existing = fused.get(id);
      const contribution = 1 / (rankConstant + index + 1);

      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(id, { hit, score: contribution });
      }
    });
  };

  // Add lexical hits first so merged results retain their highlights.
  addRankedHits(lexicalHits);
  addRankedHits(semanticHits);

  const maximumScore = 2 / (rankConstant + 1);
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ hit, score }) => ({
      ...hit,
      _score: score / maximumScore,
    }));
}
