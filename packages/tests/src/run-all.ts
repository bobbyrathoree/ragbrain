/**
 * Ragbrain Comprehensive Test Suite
 *
 * Runs all API tests in sequence and reports aggregate results.
 *
 * Test Categories:
 * - API Tests (existing): thoughts, ask, conversations, graph, export
 * - Security Tests: auth-bypass, injection, encryption, rate-limiting, pii-exposure
 * - README Claims: features, performance, security
 * - Performance: capture-latency, ask-latency, export-throughput
 * - Unit Tests: capture, thoughts, ask, conversations, export, graph, indexer, authorizer
 * - Pipeline Tests: indexing, search
 * - Infrastructure Tests: stacks
 *
 * Usage:
 *   export RAGBRAIN_API_KEY=your-api-key
 *   npm test
 *
 * Or run individual categories:
 *   npm run test:api
 *   npm run test:security
 *   npm run test:performance
 *   npm run test:readme
 *   npm run test:unit
 *   npm run test:pipeline
 *   npm run test:infra
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              RAGBRAIN COMPREHENSIVE TEST SUITE               ║
║                                                              ║
║  Testing all API endpoints, security, performance,           ║
║  README claims, and infrastructure                           ║
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

// Helper to run a suite and catch errors
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

// Run test suites in order
console.log('Running test suites...\n');

// ==========================================
// CATEGORY: API Tests (Existing)
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                      API INTEGRATION TESTS                    │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Thoughts API', './thoughts.test.js');
await runSuite('Ask API', './ask.test.js');
await runSuite('Conversations API', './conversations.test.js');
await runSuite('Graph API', './graph.test.js');
await runSuite('Export API (Obsidian Sync)', './export.test.js');

// ==========================================
// CATEGORY: Security Tests
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                       SECURITY TESTS                          │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Security: Auth Bypass', './security/auth-bypass.test.js');
await runSuite('Security: Injection', './security/injection.test.js');
await runSuite('Security: Encryption', './security/encryption.test.js');
await runSuite('Security: Rate Limiting', './security/rate-limiting.test.js');
await runSuite('Security: PII Exposure', './security/pii-exposure.test.js');

// ==========================================
// CATEGORY: README Claims Verification
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                   README CLAIMS VERIFICATION                  │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('README: Features', './readme-claims/features.test.js');
await runSuite('README: Performance Claims', './readme-claims/performance-claims.test.js');
await runSuite('README: Security Claims', './readme-claims/security-claims.test.js');

// ==========================================
// CATEGORY: Performance Benchmarks
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                    PERFORMANCE BENCHMARKS                     │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Performance: Capture Latency', './performance/capture-latency.test.js');
await runSuite('Performance: Ask Latency', './performance/ask-latency.test.js');
await runSuite('Performance: Export Throughput', './performance/export-throughput.test.js');

// ==========================================
// CATEGORY: Unit Tests
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                        UNIT TESTS                             │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Unit: Capture', './unit/capture.test.js');
await runSuite('Unit: Thoughts', './unit/thoughts.test.js');
await runSuite('Unit: Ask', './unit/ask.test.js');
await runSuite('Unit: Conversations', './unit/conversations.test.js');
await runSuite('Unit: Export', './unit/export.test.js');
await runSuite('Unit: Graph', './unit/graph.test.js');
await runSuite('Unit: Indexer', './unit/indexer.test.js');
await runSuite('Unit: Authorizer', './unit/authorizer.test.js');

// ==========================================
// CATEGORY: Pipeline Tests
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                       PIPELINE TESTS                          │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Pipeline: Indexing', './pipeline/indexing.test.js');
await runSuite('Pipeline: Search', './pipeline/search.test.js');

// ==========================================
// CATEGORY: Infrastructure Tests
// ==========================================
console.log('\n┌──────────────────────────────────────────────────────────────┐');
console.log('│                    INFRASTRUCTURE TESTS                       │');
console.log('└──────────────────────────────────────────────────────────────┘');

await runSuite('Infrastructure: Stacks', './infrastructure/stacks.test.js');

// ==========================================
// Aggregate results
// ==========================================
const totalTime = Date.now() - startTime;
let totalPassed = 0;
let totalFailed = 0;
let totalTests = 0;

for (const [suite, result] of Object.entries(suiteResults)) {
  totalPassed += result.passed;
  totalFailed += result.failed;
  totalTests += result.total;
}

// ==========================================
// Print final summary
// ==========================================
console.log(`

╔══════════════════════════════════════════════════════════════╗
║                     FINAL RESULTS                            ║
╚══════════════════════════════════════════════════════════════╝
`);

// Group results by category
const categories: Record<string, string[]> = {
  'API Tests': ['Thoughts API', 'Ask API', 'Conversations API', 'Graph API', 'Export API (Obsidian Sync)'],
  'Security': ['Security: Auth Bypass', 'Security: Injection', 'Security: Encryption', 'Security: Rate Limiting', 'Security: PII Exposure'],
  'README Claims': ['README: Features', 'README: Performance Claims', 'README: Security Claims'],
  'Performance': ['Performance: Capture Latency', 'Performance: Ask Latency', 'Performance: Export Throughput'],
  'Unit Tests': ['Unit: Capture', 'Unit: Thoughts', 'Unit: Ask', 'Unit: Conversations', 'Unit: Export', 'Unit: Graph', 'Unit: Indexer', 'Unit: Authorizer'],
  'Pipeline': ['Pipeline: Indexing', 'Pipeline: Search'],
  'Infrastructure': ['Infrastructure: Stacks'],
};

for (const [category, suites] of Object.entries(categories)) {
  let catPassed = 0;
  let catFailed = 0;
  let catTotal = 0;

  for (const suite of suites) {
    const result = suiteResults[suite];
    if (result) {
      catPassed += result.passed;
      catFailed += result.failed;
      catTotal += result.total;
    }
  }

  const catStatus = catFailed === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${catStatus} ${category}: ${catPassed}/${catTotal} passed`);
}

console.log('');
console.log('  Individual Suite Results:');
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
console.log(`  Time:         ${Math.round(totalTime / 1000)}s`);
console.log('  ═══════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\n  \x1b[31m✗ Some tests failed\x1b[0m');
  console.log('  Run individual categories for details:\n');
  console.log('    npm run test:api');
  console.log('    npm run test:security');
  console.log('    npm run test:readme');
  console.log('    npm run test:performance');
  console.log('    npm run test:unit');
  console.log('    npm run test:pipeline');
  console.log('    npm run test:infra');
  process.exit(1);
} else {
  console.log('\n  \x1b[32m✓ All tests passed!\x1b[0m');
  process.exit(0);
}

export {};
