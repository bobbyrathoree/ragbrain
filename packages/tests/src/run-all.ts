/**
 * Ragbrain API Test Suite
 *
 * Runs all API tests in sequence and reports aggregate results.
 *
 * Usage:
 *   export RAGBRAIN_API_KEY=your-api-key
 *   npm test
 *
 * Or run individual suites:
 *   npm run test:thoughts
 *   npm run test:ask
 *   npm run test:conversations
 *   npm run test:graph
 *   npm run test:export
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              RAGBRAIN API TEST SUITE                         ║
║                                                              ║
║  Testing all API endpoints and README claims                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

const startTime = Date.now();

interface SuiteSummary {
  passed: number;
  failed: number;
  total: number;
}

const suiteResults: Record<string, SuiteSummary> = {};

// Run test suites in order
console.log('Running test suites...\n');

try {
  console.log('▶ Thoughts API Tests');
  const thoughts = await import('./thoughts.test.js');
  suiteResults['Thoughts'] = thoughts.default;
} catch (error) {
  console.error('  ✗ Thoughts tests failed to run:', error);
  suiteResults['Thoughts'] = { passed: 0, failed: 1, total: 1 };
}

try {
  console.log('\n▶ Ask API Tests');
  const ask = await import('./ask.test.js');
  suiteResults['Ask'] = ask.default;
} catch (error) {
  console.error('  ✗ Ask tests failed to run:', error);
  suiteResults['Ask'] = { passed: 0, failed: 1, total: 1 };
}

try {
  console.log('\n▶ Conversations API Tests');
  const conversations = await import('./conversations.test.js');
  suiteResults['Conversations'] = conversations.default;
} catch (error) {
  console.error('  ✗ Conversations tests failed to run:', error);
  suiteResults['Conversations'] = { passed: 0, failed: 1, total: 1 };
}

try {
  console.log('\n▶ Graph API Tests');
  const graph = await import('./graph.test.js');
  suiteResults['Graph'] = graph.default;
} catch (error) {
  console.error('  ✗ Graph tests failed to run:', error);
  suiteResults['Graph'] = { passed: 0, failed: 1, total: 1 };
}

try {
  console.log('\n▶ Export API Tests (Obsidian Sync)');
  const exportTests = await import('./export.test.js');
  suiteResults['Export'] = exportTests.default;
} catch (error) {
  console.error('  ✗ Export tests failed to run:', error);
  suiteResults['Export'] = { passed: 0, failed: 1, total: 1 };
}

// Aggregate results
const totalTime = Date.now() - startTime;
let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

for (const [suite, result] of Object.entries(suiteResults)) {
  totalPassed += result.passed;
  totalFailed += result.failed;
  totalTests += result.total;
}

// Print final summary
console.log(`
╔══════════════════════════════════════════════════════════════╗
║                     FINAL RESULTS                            ║
╚══════════════════════════════════════════════════════════════╝
`);

console.log('  Suite Results:');
console.log('  ─────────────────────────────────────');
for (const [suite, result] of Object.entries(suiteResults)) {
  const status = result.failed === 0 ? '✓' : '✗';
  const color = result.failed === 0 ? '\x1b[32m' : '\x1b[31m';
  console.log(`  ${color}${status}\x1b[0m ${suite}: ${result.passed}/${result.total} passed`);
}

console.log('');
console.log('  ═══════════════════════════════════════');
console.log(`  Total Tests:  ${totalTests}`);
console.log(`  \x1b[32mPassed:       ${totalPassed}\x1b[0m`);
console.log(`  \x1b[31mFailed:       ${totalFailed}\x1b[0m`);
console.log(`  Time:         ${totalTime}ms`);
console.log('  ═══════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\n  \x1b[31m✗ Some tests failed\x1b[0m');
  console.log('  Run individual suites for details:\n');
  console.log('    npm run test:thoughts');
  console.log('    npm run test:ask');
  console.log('    npm run test:conversations');
  console.log('    npm run test:graph');
  console.log('    npm run test:export');
  process.exit(1);
} else {
  console.log('\n  \x1b[32m✓ All tests passed!\x1b[0m');
  process.exit(0);
}
