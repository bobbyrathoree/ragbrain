/**
 * Unit Tests Runner
 *
 * Runs all Lambda function unit tests.
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                        UNIT TESTS                            ║
╚══════════════════════════════════════════════════════════════╝
`);

const startTime = Date.now();

interface SuiteSummary {
  passed: number;
  failed: number;
  total: number;
}

const suiteResults: Record<string, SuiteSummary> = {};

async function runSuite(name: string, importPath: string): Promise<void> {
  try {
    console.log(`\n▶ ${name}`);
    const module = await import(importPath);
    suiteResults[name] = module.default;
  } catch (error) {
    console.error(`  ✗ ${name} failed to run:`, error);
    suiteResults[name] = { passed: 0, failed: 1, total: 1 };
  }
}

await runSuite('Capture', './unit/capture.test.js');
await runSuite('Thoughts', './unit/thoughts.test.js');
await runSuite('Ask', './unit/ask.test.js');
await runSuite('Conversations', './unit/conversations.test.js');
await runSuite('Export', './unit/export.test.js');
await runSuite('Graph', './unit/graph.test.js');
await runSuite('Indexer', './unit/indexer.test.js');
await runSuite('Authorizer', './unit/authorizer.test.js');

const totalTime = Date.now() - startTime;
let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

for (const result of Object.values(suiteResults)) {
  totalPassed += result.passed;
  totalFailed += result.failed;
  totalTests += result.total;
}

console.log(`\n${'='.repeat(60)}`);
console.log(`  Unit Tests: ${totalPassed}/${totalTests} passed (${Math.round(totalTime / 1000)}s)`);
console.log('='.repeat(60));

process.exit(totalFailed > 0 ? 1 : 0);

export {};
