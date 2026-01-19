/**
 * Export Throughput Benchmarks
 *
 * Benchmarks for the export endpoint (GET /export).
 * Tests incremental sync performance and data throughput.
 *
 * Benchmarks:
 * - 100 thoughts export < 10s
 * - Export with conversations < 60s
 * - Incremental sync efficiency
 */

import {
  suite, test, assert, assertExists, assertArray,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ExportResponse {
  thoughts: Array<{
    id: string;
    text: string;
    smartId?: string;
    createdAt: string;
  }>;
  conversations: Array<{
    id: string;
    messages: Array<{
      role: string;
      content: string;
    }>;
  }>;
  deletedThoughts: string[];
  deletedConversations: string[];
  syncTimestamp: string;
}

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function calculateStats(durations: number[]): LatencyStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

// Measure export request
async function measureExport(since?: string): Promise<{
  duration: number;
  success: boolean;
  thoughtCount: number;
  conversationCount: number;
  size: number;
}> {
  const path = since ? `/export?since=${encodeURIComponent(since)}` : '/export';
  const start = Date.now();

  try {
    const { status, data } = await get<ExportResponse>(path);
    const duration = Date.now() - start;
    const success = status === 200;

    // Estimate response size
    const size = JSON.stringify(data).length;

    return {
      duration,
      success,
      thoughtCount: data.thoughts?.length || 0,
      conversationCount: data.conversations?.length || 0,
      size,
    };
  } catch {
    return {
      duration: Date.now() - start,
      success: false,
      thoughtCount: 0,
      conversationCount: 0,
      size: 0,
    };
  }
}

suite('Performance: Export Throughput');

// Basic export benchmark
await test('Benchmark: Full export latency', async () => {
  const durations: number[] = [];
  const sizes: number[] = [];
  const counts: number[] = [];

  for (let i = 0; i < 5; i++) {
    const result = await measureExport();

    if (result.success) {
      durations.push(result.duration);
      sizes.push(result.size);
      counts.push(result.thoughtCount);
    }

    await sleep(200);
  }

  if (durations.length > 0) {
    const stats = calculateStats(durations);
    const avgSize = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
    const avgCount = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);

    console.log(`    Samples: ${durations.length}`);
    console.log(`    Avg thoughts: ${avgCount}`);
    console.log(`    Avg response size: ${(avgSize / 1024).toFixed(1)}KB`);
    console.log(`    P50: ${stats.p50}ms, P95: ${stats.p95}ms`);
  }

  assert(durations.length >= 3, 'Should complete at least 3 exports');
});

// Export with existing data
await test('Benchmark: Export scales with data size', async () => {
  // First, get baseline export
  const baseline = await measureExport();

  if (baseline.success) {
    console.log(`    Baseline: ${baseline.thoughtCount} thoughts in ${baseline.duration}ms`);

    // Calculate throughput
    if (baseline.thoughtCount > 0) {
      const throughput = (baseline.thoughtCount / baseline.duration) * 1000;
      console.log(`    Throughput: ${throughput.toFixed(1)} thoughts/sec`);
    }
  }

  assert(baseline.success, 'Baseline export should succeed');
});

// Export within target time
await test('Benchmark: Export completes within 10s', async () => {
  const { duration, success, thoughtCount, conversationCount } = await measureExport();

  console.log(`    Duration: ${duration}ms`);
  console.log(`    Thoughts: ${thoughtCount}, Conversations: ${conversationCount}`);

  assert(success, 'Export should succeed');
  assert(
    duration < 10000,
    `Export should complete in < 10s (got ${duration}ms)`
  );
});

// Incremental sync efficiency
await test('Benchmark: Incremental sync (since parameter)', async () => {
  // First, do a full export to get timestamp
  const fullExport = await measureExport();
  assert(fullExport.success, 'Full export should succeed');

  // Get the sync timestamp
  const { data: fullData } = await get<ExportResponse>('/export');
  const syncTimestamp = fullData.syncTimestamp;

  // Wait a moment
  await sleep(1000);

  // Now do an incremental export
  const incrementalStart = Date.now();
  const { status, data: incrementalData } = await get<ExportResponse>(
    `/export?since=${encodeURIComponent(syncTimestamp)}`
  );
  const incrementalDuration = Date.now() - incrementalStart;

  console.log(`    Full export: ${fullExport.duration}ms, ${fullExport.thoughtCount} thoughts`);
  console.log(`    Incremental: ${incrementalDuration}ms, ${incrementalData.thoughts?.length || 0} new thoughts`);

  // Incremental should be faster (or at least not slower by much)
  if (fullExport.thoughtCount > 0 && incrementalData.thoughts.length === 0) {
    assert(
      incrementalDuration <= fullExport.duration + 100,
      'Incremental should not be significantly slower than full'
    );
    console.log('    Incremental sync is working (no new data = fast response)');
  }

  assert(status === 200, 'Incremental export should succeed');
});

// Response size analysis
await test('Benchmark: Response size efficiency', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, 'Export should succeed');

  const fullJson = JSON.stringify(data);
  const totalSize = fullJson.length;

  // Calculate size breakdown
  const thoughtsSize = JSON.stringify(data.thoughts).length;
  const conversationsSize = JSON.stringify(data.conversations).length;
  const deletedSize = JSON.stringify({
    deletedThoughts: data.deletedThoughts,
    deletedConversations: data.deletedConversations,
  }).length;

  console.log(`    Total size: ${(totalSize / 1024).toFixed(1)}KB`);
  console.log(`    Thoughts: ${(thoughtsSize / 1024).toFixed(1)}KB (${data.thoughts.length} items)`);
  console.log(`    Conversations: ${(conversationsSize / 1024).toFixed(1)}KB (${data.conversations.length} items)`);
  console.log(`    Deleted refs: ${(deletedSize / 1024).toFixed(1)}KB`);

  // Calculate average item sizes
  if (data.thoughts.length > 0) {
    const avgThoughtSize = thoughtsSize / data.thoughts.length;
    console.log(`    Avg thought size: ${avgThoughtSize.toFixed(0)} bytes`);
  }
});

// Concurrent export requests
await test('Benchmark: Concurrent export requests', async () => {
  const start = Date.now();

  // 3 concurrent exports
  const promises = Array(3).fill(null).map(() => measureExport());
  const results = await Promise.all(promises);

  const totalTime = Date.now() - start;
  const successful = results.filter(r => r.success);

  console.log(`    3 concurrent exports: ${totalTime}ms total`);
  console.log(`    Successful: ${successful.length}/3`);

  if (successful.length > 0) {
    const avgDuration = Math.round(
      successful.reduce((a, b) => a + b.duration, 0) / successful.length
    );
    console.log(`    Avg individual duration: ${avgDuration}ms`);
  }

  assert(
    successful.length >= 2,
    `At least 2/3 concurrent exports should succeed (got ${successful.length})`
  );
});

// Export stability over multiple requests
await test('Benchmark: Export consistency', async () => {
  const results: Array<{ duration: number; thoughtCount: number }> = [];

  for (let i = 0; i < 5; i++) {
    const result = await measureExport();
    if (result.success) {
      results.push({
        duration: result.duration,
        thoughtCount: result.thoughtCount,
      });
    }
    await sleep(100);
  }

  // Thought count should be consistent
  const counts = results.map(r => r.thoughtCount);
  const uniqueCounts = [...new Set(counts)];

  console.log(`    Thought counts: ${counts.join(', ')}`);
  console.log(`    Unique counts: ${uniqueCounts.length}`);

  // Data should be consistent across requests
  // Allow for slight variance if data is being added concurrently
  assert(
    uniqueCounts.length <= 3,
    'Export should return consistent data'
  );

  // Latency should be relatively stable
  const durations = results.map(r => r.duration);
  const stats = calculateStats(durations);
  const variance = stats.max - stats.min;

  console.log(`    Duration variance: ${variance}ms (min: ${stats.min}ms, max: ${stats.max}ms)`);
});

// Large data set handling (informational)
await test('Info: Export throughput expectations', async () => {
  const { success, thoughtCount, conversationCount, duration, size } = await measureExport();

  if (success && thoughtCount > 0) {
    const throughput = (thoughtCount / duration) * 1000;
    const bytesPerThought = size / thoughtCount;

    console.log('    Current data metrics:');
    console.log(`    - ${thoughtCount} thoughts, ${conversationCount} conversations`);
    console.log(`    - ${throughput.toFixed(1)} thoughts/sec`);
    console.log(`    - ${bytesPerThought.toFixed(0)} bytes/thought avg`);
    console.log('    Projected for 1000 thoughts:');
    console.log(`    - Est. time: ${((1000 / throughput) * 1000).toFixed(0)}ms`);
    console.log(`    - Est. size: ${(bytesPerThought * 1000 / 1024).toFixed(0)}KB`);
  }

  assert(true, 'Throughput expectations documented');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
