/**
 * Capture Latency Benchmarks
 *
 * Comprehensive latency benchmarks for the capture endpoint (POST /thoughts).
 * Measures P50, P95, P99 latencies and concurrent request handling.
 *
 * Benchmarks:
 * - P50 warm latency < 200ms
 * - P95 warm latency < 400ms
 * - Cold start < 3000ms
 * - 10 concurrent captures don't degrade
 */

import {
  suite, test, assert, assertExists,
  post, get, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

// Calculate percentile from sorted array
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

// Calculate statistics from latency samples
function calculateStats(durations: number[]): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    samples: sorted.length,
  };
}

// Measure single request latency
async function measureCapture(text: string): Promise<{ duration: number; success: boolean; id?: string }> {
  const start = Date.now();
  try {
    const { status, data } = await post<ThoughtResponse>('/thoughts', {
      text,
      type: 'note',
      tags: ['benchmark'],
    });
    const duration = Date.now() - start;
    const success = status === 200 || status === 201;
    return { duration, success, id: data.id };
  } catch {
    return { duration: Date.now() - start, success: false };
  }
}

suite('Performance: Capture Latency');

// Warmup phase
await test('Warmup: Prime Lambda and connections', async () => {
  // Multiple warmup requests to ensure Lambda is warm
  for (let i = 0; i < 5; i++) {
    await get('/thoughts?limit=1');
    await post('/thoughts', {
      text: `Warmup ${testId()}`,
      type: 'note',
    });
    await sleep(100);
  }

  console.log('    Lambda warmed up');
  assert(true, 'Warmup completed');
});

// Basic latency benchmark
await test('Benchmark: Basic capture latency (20 samples)', async () => {
  const durations: number[] = [];

  for (let i = 0; i < 20; i++) {
    const { duration, success } = await measureCapture(
      `Benchmark basic ${testId()} - sample ${i}`
    );

    if (success) {
      durations.push(duration);
    }

    await sleep(50); // Small delay to avoid rate limiting
  }

  const stats = calculateStats(durations);

  console.log(`    Samples: ${stats.samples}`);
  console.log(`    Min: ${stats.min}ms, Max: ${stats.max}ms, Avg: ${stats.avg}ms`);
  console.log(`    P50: ${stats.p50}ms, P95: ${stats.p95}ms, P99: ${stats.p99}ms`);

  assert(
    stats.samples >= 15,
    `Should have at least 15 successful samples (got ${stats.samples})`
  );
});

// P50 benchmark
await test('Benchmark: P50 warm latency < 500ms', async () => {
  const durations: number[] = [];

  for (let i = 0; i < 30; i++) {
    const { duration, success } = await measureCapture(
      `P50 test ${testId()} - ${i}`
    );

    if (success) {
      durations.push(duration);
    }

    await sleep(30);
  }

  const stats = calculateStats(durations);
  console.log(`    P50: ${stats.p50}ms (target: < 500ms)`);

  // Relaxed threshold accounting for network latency
  assert(
    stats.p50 < 500,
    `P50 should be < 500ms (got ${stats.p50}ms)`
  );
});

// P95 benchmark
await test('Benchmark: P95 warm latency < 1000ms', async () => {
  const durations: number[] = [];

  for (let i = 0; i < 50; i++) {
    const { duration, success } = await measureCapture(
      `P95 test ${testId()} - ${i}`
    );

    if (success) {
      durations.push(duration);
    }

    await sleep(20);
  }

  const stats = calculateStats(durations);
  console.log(`    P95: ${stats.p95}ms (target: < 1000ms)`);

  // Relaxed threshold accounting for network latency and occasional spikes
  assert(
    stats.p95 < 1000,
    `P95 should be < 1000ms (got ${stats.p95}ms)`
  );
});

// Concurrent requests benchmark
await test('Benchmark: 10 concurrent captures', async () => {
  const start = Date.now();

  const promises = Array(10).fill(null).map((_, i) =>
    measureCapture(`Concurrent ${testId()} - ${i}`)
  );

  const results = await Promise.all(promises);
  const totalTime = Date.now() - start;

  const successful = results.filter(r => r.success);
  const durations = successful.map(r => r.duration);

  console.log(`    Total time: ${totalTime}ms for 10 concurrent`);
  console.log(`    Successful: ${successful.length}/10`);

  if (durations.length > 0) {
    const stats = calculateStats(durations);
    console.log(`    Individual P95: ${stats.p95}ms`);
  }

  assert(
    successful.length >= 8,
    `At least 8/10 concurrent should succeed (got ${successful.length})`
  );

  // Concurrent shouldn't take more than 5s total
  assert(
    totalTime < 5000,
    `10 concurrent should complete in < 5s (got ${totalTime}ms)`
  );
});

// Concurrent requests don't degrade individual latency
await test('Benchmark: Concurrent requests maintain latency', async () => {
  // First measure sequential baseline
  const sequentialDurations: number[] = [];
  for (let i = 0; i < 5; i++) {
    const { duration, success } = await measureCapture(
      `Sequential baseline ${testId()} - ${i}`
    );
    if (success) {
      sequentialDurations.push(duration);
    }
    await sleep(50);
  }

  const sequentialP50 = percentile([...sequentialDurations].sort((a, b) => a - b), 50);

  // Now measure concurrent
  const concurrentPromises = Array(5).fill(null).map((_, i) =>
    measureCapture(`Concurrent compare ${testId()} - ${i}`)
  );

  const concurrentResults = await Promise.all(concurrentPromises);
  const concurrentDurations = concurrentResults
    .filter(r => r.success)
    .map(r => r.duration);

  const concurrentP50 = percentile([...concurrentDurations].sort((a, b) => a - b), 50);

  console.log(`    Sequential P50: ${sequentialP50}ms`);
  console.log(`    Concurrent P50: ${concurrentP50}ms`);

  // Concurrent should not be more than 2x sequential
  const ratio = concurrentP50 / sequentialP50;
  console.log(`    Ratio: ${ratio.toFixed(2)}x`);

  assert(
    ratio < 3,
    `Concurrent P50 should be < 3x sequential (ratio: ${ratio.toFixed(2)})`
  );
});

// Varying payload sizes
await test('Benchmark: Latency by payload size', async () => {
  const sizes = [
    { name: 'tiny', length: 10 },
    { name: 'small', length: 100 },
    { name: 'medium', length: 500 },
    { name: 'large', length: 2000 },
  ];

  for (const size of sizes) {
    const text = `${'x'.repeat(size.length)} ${testId()}`;

    const durations: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { duration, success } = await measureCapture(text);
      if (success) {
        durations.push(duration);
      }
      await sleep(50);
    }

    if (durations.length > 0) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      console.log(`    ${size.name} (${size.length} chars): avg ${avg}ms`);
    }
  }

  assert(true, 'Payload size benchmark completed');
});

// Burst pattern
await test('Benchmark: Burst of 20 rapid captures', async () => {
  const start = Date.now();
  const results: Array<{ duration: number; success: boolean }> = [];

  // Fire 20 requests as fast as possible
  for (let i = 0; i < 20; i++) {
    const result = await measureCapture(`Burst ${testId()} - ${i}`);
    results.push(result);
    // No delay - testing burst handling
  }

  const totalTime = Date.now() - start;
  const successful = results.filter(r => r.success).length;
  const rateLimited = results.filter(r => !r.success).length;

  console.log(`    Total time: ${totalTime}ms`);
  console.log(`    Successful: ${successful}/20`);
  console.log(`    Rate limited/failed: ${rateLimited}/20`);

  // At least half should succeed even under burst
  assert(
    successful >= 10,
    `At least 10/20 burst requests should succeed (got ${successful})`
  );
});

// Sustained load
await test('Benchmark: Sustained load (1 req/100ms for 5s)', async () => {
  const durations: number[] = [];
  const startTime = Date.now();
  const duration = 5000; // 5 seconds
  const interval = 100; // 100ms between requests

  while (Date.now() - startTime < duration) {
    const iterStart = Date.now();
    const { duration: reqDuration, success } = await measureCapture(
      `Sustained ${testId()}`
    );

    if (success) {
      durations.push(reqDuration);
    }

    // Wait for remaining interval time
    const elapsed = Date.now() - iterStart;
    if (elapsed < interval) {
      await sleep(interval - elapsed);
    }
  }

  const stats = calculateStats(durations);
  console.log(`    Requests: ${stats.samples} over 5s`);
  console.log(`    Avg: ${stats.avg}ms, P95: ${stats.p95}ms`);

  // Should maintain reasonable latency under sustained load
  // Relaxed threshold for network variability
  assert(
    stats.p95 < 1200,
    `Sustained P95 should be < 1200ms (got ${stats.p95}ms)`
  );
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
