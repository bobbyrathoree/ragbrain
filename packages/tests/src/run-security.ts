/**
 * Security Tests Runner
 *
 * Runs all security vulnerability tests.
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      SECURITY TESTS                          ║
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

await runSuite('Auth Bypass', './security/auth-bypass.test.js');
await runSuite('Injection', './security/injection.test.js');
await runSuite('Encryption', './security/encryption.test.js');
await runSuite('Rate Limiting', './security/rate-limiting.test.js');
await runSuite('PII Exposure', './security/pii-exposure.test.js');

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
console.log(`  Security Tests: ${totalPassed}/${totalTests} passed (${Math.round(totalTime / 1000)}s)`);
console.log('='.repeat(60));

process.exit(totalFailed > 0 ? 1 : 0);

export {};
