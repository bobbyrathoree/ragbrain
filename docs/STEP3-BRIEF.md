# Step 3 brief — fix retrieval

Working brief for the session implementing step 3 of `docs/AUDIT-2026-08.md`.
Steps 1 and 2 are already done, deployed to dev, and verified (commit `2ac746e`).

## The one-sentence version

Semantic search has never run in this system, not once, and nobody noticed
because the metrics that would have shown it were silently unauthorized. Step 1
fixed the metrics. Step 3 fixes the search.

## Hard constraints

1. **AWS profile is `default`.** Every CLI call must use it. Region `us-west-2`,
   environment `dev`.
2. **Nothing sensitive reaches a remote.** No AWS account ID, API key, API
   Gateway ID, or collection endpoint in any file that gets committed — including
   code comments, docs, and test fixtures. Read them from env or CLI at runtime.
   Verify with `git diff` before committing.
3. **Deploy and verify for real.** Untested assumptions are exactly what produced
   these bugs. A fix is not done until a live query proves it.
4. **Demo data is disposable.** 32 notes in DynamoDB, all reproducible. DynamoDB
   is the source of truth; the OpenSearch index is derived and safe to destroy.
   Do not delete DynamoDB rows.

## Decisions already made — do not relitigate

| Decision | Choice |
|---|---|
| Search backend | **Keep OpenSearch Serverless.** Fix the mapping and the query. The ~$175/mo OCU floor is a step-4 question. |
| Embedding model | **Upgrade to `amazon.titan-embed-text-v2:0` @ 1024 dims.** Verify availability in us-west-2 first; fall back to v1 @ 1536 and say so if absent. |
| Scope | Core retrieval + finding 18 + finding 7 + remove provisioned concurrency. **Not** "feed Ask full note text" (step 4). |

---

## Finding 1 (P0) — semantic search has never run

### What is actually wrong

Three independent defects stacked. The third is the one that surprises people.

**1a. The `filter` key is in the wrong place.** `packages/infra/lib/shared/search.ts:148`:

```js
const searchBody = {
  size,
  query: { hybrid: { queries: [ /* multi_match */, /* knn */ ] } },
  filter: { bool: { must } },        // ← not a valid top-level search body key
  highlight: { ... },
};
```

OpenSearch rejects the body. The `catch` at `search.ts:163` swallows it and
returns `bm25Fallback`. **Every "hybrid" search in production has been pure
BM25 keyword matching.** The fallback logs to console but emits no metric and
returns a 200, so the API looks perfectly healthy.

**1b. `embedding` is mapped as `float`, not `knn_vector`.** Confirmed by
querying the live index mapping during the audit:

```json
"embedding": { "type": "float" }
```

And the resulting live error, from CloudWatch:

```
Field 'embedding' is not knn_vector type.
```

So even with the filter fixed, the kNN clause cannot execute.

**1c. Nothing in this repo ever creates the index.** Verified:

```
grep -rn "indices.create|knn_vector|_mapping" packages/infra/  →  no matches
```

The index is auto-created by the indexer's first document write, and OpenSearch
dynamic mapping infers `float` from a JSON array of numbers. **There is no
mapping bug to fix — the mapping code does not exist.** This is the root cause;
1b is its symptom. Any fix that does not create an explicit mapping will regress
the moment the index is recreated.

Also note `EMBED_DIMENSIONS = 1024` in `packages/infra/lib/shared/config.ts:16`
while `MODELS.EMBED` is `titan-embed-text-v1`, **which emits 1536**. That
constant has been wrong and unused. Titan v2 defaults to 1024, so the upgrade
makes it honest — but assert the real vector length at runtime rather than
trusting either number.

### What to build

**An explicit index mapping, created and owned by code.** Decide where it lives
and justify it: a CDK custom resource, or an idempotent
`ensureIndex()` in the indexer that runs before the first write. Prefer whichever
makes it impossible to recreate the index without the mapping. It must specify:

- `embedding` as `knn_vector` with `dimension` matching the model's true output,
  and an `hnsw` method with a `cosinesimil`/`l2` space chosen deliberately —
  state which and why.
- `index.knn: true` in settings.
- Explicit types for the fields that are queried or filtered: `text`, `summary`,
  `tags`, `type`, `user`, `id`, `docType`, `created_at_epoch`, `decision_score`.
  **`user` and `id` are filtered on exact values** — today they are analyzed
  `text` with a `.keyword` subfield, which is why the delete path in
  `indexer/index.ts` has to use `id.keyword`. Map them as `keyword` and simplify
  those call sites, or keep `.keyword` and leave them; either way make it
  consistent and deliberate, not accidental.

**Then reindex.** The mapping cannot change in place — delete and recreate the
index, then re-embed all 32 notes from DynamoDB. Note the Serverless quirks
already learned the hard way:

- `_delete_by_query` is unsupported (404).
- An explicit document `_id` on index is rejected.
- New documents take **~10 seconds** to become visible. The delete path already
  has a retry ladder for this; your verification needs the same patience.

**Fix the query.** Move the filter to its correct position. `hybrid` requires the
`search-pipeline` normalization processor to fuse the two clause scores — if that
pipeline does not exist, `hybrid` will not work correctly even with valid syntax.
Either create the pipeline, or run the two queries separately and fuse with
reciprocal rank fusion in the Lambda. **Pick based on what actually works
against the live collection, and say which you chose and why.** RRF in-Lambda is
more code but removes a whole class of Serverless surprise; the audit's
suggestion was RRF, but verify rather than assume.

**Make the fallback loud.** This defect survived for months because degradation
was silent. When hybrid fails and BM25 takes over, emit a CloudWatch metric
(namespace `ragbrain`, e.g. `HybridSearchFallback`) and log at error level. Add
an alarm. The `PutMetricData` permission now exists on all handlers —
`compute-stack.ts:376-387`.

### Proof required

Do not report success without this. A query whose answer depends on *meaning*
rather than shared words — where the note and the query have no significant
vocabulary overlap — must retrieve the right note, and the same query must fail
or rank it materially worse under BM25-only. Show the before/after ranking.

---

## Finding 9 — fabricated confidence and "% match"

`packages/infra/lib/shared/search.ts:247`:

```js
export function calculateConfidence(citations: Citation[]): number {
  if (citations.length === 0) return 0.3;
  return Math.min(0.95, citations.reduce((sum, c) => sum + c.score, 0) / citations.length);
}
```

This averages **fused, unbounded relevance scores** — BM25 score × 0.4, plus
recency × 0.15, plus decision × 0.05 (`SEARCH_WEIGHTS`, `config.ts:19`) — and
presents the result to the user as a percentage. It is not a probability, not
calibrated, and not bounded to [0,1] before the clamp. The clamp to 0.95 hides
that. The `0.3` floor for zero citations means **"I found nothing" renders as
30% confident.**

The frontend displays this as a filled progress bar and a percentage:

- `apps/web/src/components/AskModal.vue:110-112` — confidence bar + `%`
- `apps/web/src/components/AskModal.vue:131` — `{{ Math.round(citation.score * 100) }}% match`
- `apps/web/src/components/views/ChatView.vue:209-213` — same bar

`citation.score` there is the same fused score run through `normalizeScores`
(`search.ts:254`), which is **min-max within the result set** — so the top hit is
always exactly 100% and the worst is always exactly 0%, regardless of actual
quality. A single-citation answer normalizes to 100% match by construction.

**Fix it.** Either derive something defensible from real signals — cosine
similarity is genuinely bounded and interpretable, citation count and agreement
are real — or **remove the number from the UI entirely.** Removing it is a
perfectly good answer and better than a confident lie. Do not keep a fake number
because the UI has a slot for it. If you remove it, update the types
(`apps/web/src/types/index.ts:55-58`) and both components; leave no dead prop.

---

## Finding 18 — conversation indexing has never worked

`packages/infra/functions/indexer/index.ts:674-676`:

```js
await opensearchClient.index({
  index: `${SEARCH_COLLECTION}-thoughts`,
  id: conversationId,          // ← Serverless rejects this outright
  body: searchDocument,
});
```

Serverless refuses an explicit `_id`:
`illegal_argument_exception: Document ID is not supported in create/index operation request`.

**No conversation has ever been indexed.** CloudWatch shows the same
conversation reprocessed repeatedly in Feb 2026, never once succeeding. The
entire chat history is invisible to Ask and Search.

The comment on line 473 explains this exact constraint for thoughts. The
conversation path never got the same treatment.

The `id:` was there for upsert semantics — reindexing a conversation should
replace, not duplicate. Removing the `id` fixes the write but creates duplicates
on every reindex. **Solve both:** the thought path's search-then-delete-by-`_id`
approach (`deleteThoughtFromIndex`, same file) is the working precedent. Reuse
it rather than inventing a second mechanism.

Verify by indexing a conversation and finding it via `/search` and `/ask`.

---

## Finding 7 — graph cache key omits `minSimilarity`

`packages/infra/functions/graph/index.ts:881`:

```js
const cacheKey = `graph/${user}/${params.month || 'all'}-v2.json`;
```

`params.minSimilarity` (parsed at `:876-878`, default `0.7`) is not in the key,
so every threshold serves whatever the first caller cached. This actively misled
me during the audit — I read a stale `edges: 0` as proof that the cosine code
was dead. Add it to the key.

---

## Finding: delete the random-embedding fallback

`packages/infra/functions/graph/index.ts:431`:

```js
// Generate random embeddings for visualization (fallback)
const embedding = Array(1024).fill(0).map(() => Math.random() - 0.5);
```

This is in the DynamoDB scan path, which is what runs when OpenSearch is not
used. Random vectors mean **the graph's similarity edges are noise** — the
"connections" the Knowledge Galaxy draws between notes are, on this path,
fabricated. Fresh computation during the audit produced 79 edges that were
insensitive to `minSimilarity` and pinned at the `32 × 5 ÷ 2` cap ceiling: the
signature of random data, not semantic structure.

Real embeddings exist — the indexer computes them. Either read them, or fail
honestly with an empty edge set. **Never invent similarity.** If the graph cannot
compute real edges, it must render nodes without edges and say so.

Note `Math.random` also appears at `:131` and `:177` as injected defaults for
seeded-PRNG parameters — those are the deterministic K-means seams and are
**fine**. Only `:431` is the defect.

---

## Also in scope

**Route the theme labeller through `MODELS.FAST`.** The graph's theme labelling
should not use the reasoning model. Check what it actually calls and fix if
mismatched.

**Remove provisioned concurrency.** `packages/infra/lib/stacks/compute-stack.ts:156`
and `:234` provision concurrency on `live` aliases of the capture and ask
Lambdas. **No API Gateway route targets those aliases** — routes point at
`$LATEST`. It is ~$27/mo buying nothing. Remove the provisioned concurrency;
before deleting the aliases themselves, confirm nothing references them
(`captureLambdaAlias` / `askLambdaAlias` are public class members).

**A 10-question retrieval golden set.** The real deliverable — the thing that
stops this class of bug recurring. `packages/tests/` already has a runner
convention (`tsx src/*.test.ts`, scripts in `package.json`); follow it and add a
script entry. Requirements:

- ~10 questions against the 32 demo notes, each with an expected note id.
- **At least 3 must be semantic-only** — no significant term overlap with the
  target note, so they pass only if kNN genuinely works. These are the
  regression tests for finding 1; without them the whole fix is unverified.
- Assert on retrieval (is the right note in the top-k?), not on generated prose.
- Fail loudly on the BM25 fallback path.
- No hardcoded endpoint, key, or account ID — read from env. There is precedent
  for this leak: `apps/web/scripts/populate-sde-thoughts.ts` had a hardcoded API
  Gateway URL until step 1 removed it.

Be aware `packages/tests/` is partly test theater (audit finding 12) — several
existing tests assert on HTTP status only and would pass against a broken
system. Do not imitate that pattern.

---

## Definition of done

1. A semantic-only query retrieves the right note, proven live, with the
   before/after ranking shown.
2. The BM25 fallback emits a metric and is alarmed.
3. The index mapping is created by code and cannot be silently lost on recreate.
4. A conversation is indexed and retrievable, and reindexing does not duplicate it.
5. Confidence and `% match` are either honest or gone from the UI.
6. The golden set passes, including its semantic-only cases, and fails if kNN breaks.
7. `cdk diff` is clean after deploy; typecheck passes.
8. `git diff` contains no account ID, API key, endpoint, or gateway ID.

## If something turns out to be wrong

The audit was empirical but not infallible — one of its conclusions (the graph
`edges: 0` reading) was right in substance and wrong in mechanism. If the code
disagrees with this brief, **the code wins.** Say so explicitly and explain what
you found instead. Do not quietly implement something different, and do not
implement something you know is wrong because a doc said so.

## Report back

- What you changed, and what you deployed.
- The live evidence for each of the 8 done-criteria.
- What you chose on the open calls (hybrid pipeline vs in-Lambda RRF; `keyword`
  vs `.keyword`; confidence fixed vs removed) and why.
- Anything you found that this brief missed.
- Anything you deliberately did not do.
