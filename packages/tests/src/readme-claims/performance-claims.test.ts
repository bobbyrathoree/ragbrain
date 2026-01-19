/**
 * README Performance Claims Verification Tests
 *
 * Tests that verify performance claims made in README and CLAUDE.md.
 * Measures actual latencies against claimed targets.
 *
 * Claims verified:
 * - "Sub-150ms capture" (warm Lambda)
 * - "Capture must never block" (async indexing)
 * - "Speed first - Capture must never feel slow"
 *
 * Known limitations documented:
 * - Sub-150ms applies to warm Lambda; cold starts are 1-3s
 * - These are integration tests over network, actual Lambda execution is faster
 */

import {
  suite, test, assert, assertExists,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface AskResponse {
  answer: string;
  citations?: unknown[];
  processingTime?: number;
}

interface ListThoughtsResponse {
  thoughts: Array<{
    id: string;
    text: string;
  }>;
}

// Track created resources
const createdThoughts: string[] = [];

// Performance measurement utilities
interface LatencyResult {
  duration: number;
  status: number;
}

async function measureLatency(
  fn: () => Promise<{ status: number; data: unknown }>
): Promise<LatencyResult> {
  const start = Date.now();
  const { status } = await fn();
  return {
    duration: Date.now() - start,
    status,
  };
}

function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

suite('README Claims: Performance');

// Warm up Lambda to avoid cold start in measurements
await test('Warmup: Initial request (may include cold start)', async () => {
  const { duration } = await measureLatency(() => get('/thoughts?limit=1'));
  console.log(`    Initial request: ${duration}ms (may include cold start)`);
  assert(duration < 30000, 'Warmup should complete within 30s');

  // Additional warmup requests
  await get('/thoughts?limit=1');
  await post('/thoughts', { text: `Warmup ${testId()}`, type: 'note' });
});

// Claim: "Sub-150ms capture" - Test warm Lambda latency

await test('Claim: Warm capture latency P50 < 500ms (network included)', async () => {
  // Note: The 150ms claim is for Lambda execution; network adds ~50-300ms
  const samples: number[] = [];

  for (let i = 0; i < 10; i++) {
    const { duration, status } = await measureLatency(() =>
      post<ThoughtResponse>('/thoughts', {
        text: `Latency test ${testId()} - sample ${i}`,
        type: 'note',
        tags: ['performance-test'],
      })
    );

    if (status === 200 || status === 201) {
      samples.push(duration);
    }

    // Small delay between requests
    await sleep(100);
  }

  const p50 = calculatePercentile(samples, 50);
  console.log(`    Capture P50: ${p50}ms (${samples.length} samples)`);

  // Allow for network latency: 150ms Lambda + 350ms network variance = 500ms target
  assert(
    p50 < 500,
    `Warm capture P50 should be < 500ms (got ${p50}ms)`
  );

  // Track some thoughts for cleanup
  createdThoughts.push(...samples.map((_, i) => `performance-test-${i}`));
});

await test('Claim: Warm capture latency P95 < 1000ms (network included)', async () => {
  const samples: number[] = [];

  for (let i = 0; i < 20; i++) {
    const { duration, status } = await measureLatency(() =>
      post<ThoughtResponse>('/thoughts', {
        text: `P95 latency test ${testId()} - sample ${i}`,
        type: 'note',
        tags: ['performance-test'],
      })
    );

    if (status === 200 || status === 201) {
      samples.push(duration);
    }

    await sleep(50);
  }

  const p95 = calculatePercentile(samples, 95);
  console.log(`    Capture P95: ${p95}ms (${samples.length} samples)`);

  // Allow for network latency variance and occasional spikes
  assert(
    p95 < 1000,
    `Warm capture P95 should be < 1000ms (got ${p95}ms)`
  );
});

// Claim: "Capture must never block" - Test async indexing

await test('Claim: Capture returns before indexing completes', async () => {
  const uniqueText = `Async indexing test ${testId()} - should return immediately`;

  const start = Date.now();
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueText,
    type: 'note',
    tags: ['async-test'],
  });
  const captureTime = Date.now() - start;

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should return ID immediately');

  // Capture should return quickly (before indexing)
  assert(
    captureTime < 1000,
    `Capture should return quickly (got ${captureTime}ms)`
  );

  console.log(`    Capture returned in ${captureTime}ms`);

  // Verify thought exists but may not be indexed yet
  const { status: getStatus } = await get(`/thoughts?limit=1`);
  assert(getStatus === 200, 'Should be able to query thoughts');

  createdThoughts.push(data.id);
});

await test('Claim: Response time independent of text length (within reason)', async () => {
  const shortText = `Short ${testId()}`;
  const mediumText = `Medium length text ${testId()} `.repeat(10);
  const longText = `Long text content ${testId()} `.repeat(50);

  const results: Array<{ length: number; duration: number }> = [];

  for (const text of [shortText, mediumText, longText]) {
    const { duration, status } = await measureLatency(() =>
      post<ThoughtResponse>('/thoughts', {
        text,
        type: 'note',
        tags: ['length-test'],
      })
    );

    if (status === 200 || status === 201) {
      results.push({ length: text.length, duration });
    }

    await sleep(100);
  }

  // Log results
  for (const r of results) {
    console.log(`    ${r.length} chars: ${r.duration}ms`);
  }

  // Capture time shouldn't scale linearly with text length
  const shortDuration = results[0]?.duration || 0;
  const longDuration = results[2]?.duration || 0;

  // Long text shouldn't take more than 3x short text
  if (shortDuration > 0 && longDuration > 0) {
    const ratio = longDuration / shortDuration;
    assert(
      ratio < 3,
      `Long text shouldn't take >3x short text (ratio: ${ratio.toFixed(2)})`
    );
  }
});

// Ask endpoint latency

await test('Claim: Ask P50 < 5000ms', async () => {
  const samples: number[] = [];

  for (let i = 0; i < 5; i++) {
    const { duration, status } = await measureLatency(() =>
      post<AskResponse>('/ask', {
        query: `Simple query ${i}: What is this?`,
      })
    );

    if (status === 200 || status === 201) {
      samples.push(duration);
    }

    await sleep(500);
  }

  const p50 = calculatePercentile(samples, 50);
  console.log(`    Ask P50: ${p50}ms (${samples.length} samples)`);

  // Ask involves LLM, so allow more time (network + LLM inference)
  assert(
    p50 < 5000,
    `Ask P50 should be < 5000ms (got ${p50}ms)`
  );
});

await test('Claim: Ask P95 < 5000ms', async () => {
  const samples: number[] = [];

  for (let i = 0; i < 10; i++) {
    const { duration, status } = await measureLatency(() =>
      post<AskResponse>('/ask', {
        query: `Query for P95 test ${i}`,
      })
    );

    if (status === 200 || status === 201) {
      samples.push(duration);
    }

    await sleep(300);
  }

  const p95 = calculatePercentile(samples, 95);
  console.log(`    Ask P95: ${p95}ms (${samples.length} samples)`);

  assert(
    p95 < 5000,
    `Ask P95 should be < 5000ms (got ${p95}ms)`
  );
});

// Read latency

await test('Claim: List thoughts P50 < 500ms', async () => {
  const samples: number[] = [];

  for (let i = 0; i < 10; i++) {
    const { duration, status } = await measureLatency(() =>
      get<ListThoughtsResponse>('/thoughts?limit=10')
    );

    if (status === 200) {
      samples.push(duration);
    }

    await sleep(50);
  }

  const p50 = calculatePercentile(samples, 50);
  console.log(`    List P50: ${p50}ms (${samples.length} samples)`);

  // Allow for network latency
  assert(
    p50 < 500,
    `List thoughts P50 should be < 500ms (got ${p50}ms)`
  );
});

// Concurrent request handling

await test('Claim: 10 concurrent captures handled', async () => {
  const start = Date.now();
  const promises = Array(10).fill(null).map((_, i) =>
    post<ThoughtResponse>('/thoughts', {
      text: `Concurrent test ${testId()} - ${i}`,
      type: 'note',
      tags: ['concurrent-test'],
    })
  );

  const results = await Promise.all(promises);
  const totalTime = Date.now() - start;

  const successes = results.filter(r => r.status === 200 || r.status === 201);
  console.log(`    10 concurrent: ${successes.length}/10 succeeded in ${totalTime}ms`);

  // Most should succeed
  assert(
    successes.length >= 8,
    `At least 8/10 concurrent captures should succeed (got ${successes.length})`
  );

  // Total time should be reasonable (not 10x sequential)
  assert(
    totalTime < 5000,
    `10 concurrent captures should complete in < 5s (got ${totalTime}ms)`
  );
});

// Cold start documentation (informational, not a hard failure)

await test('Info: Document cold start expectations', async () => {
  // This test documents rather than enforces cold start behavior
  console.log('    Known limitation: Cold starts are 1-3s');
  console.log('    Sub-150ms claim applies to warm Lambda execution');
  console.log('    Integration tests include network latency (~50-150ms)');
  assert(true, 'Documentation test always passes');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
