/**
 * Test utilities for Ragbrain API testing
 */

// Load from environment or use defaults
const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
const API_KEY = process.env.RAGBRAIN_API_KEY || '';

if (!API_KEY) {
  console.error('\n❌ RAGBRAIN_API_KEY environment variable is required');
  console.error('   Set it with: export RAGBRAIN_API_KEY=your-api-key\n');
  process.exit(1);
}

export const config = { API_URL, API_KEY };

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let currentSuite = '';

export function suite(name: string): void {
  currentSuite = name;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name: `${currentSuite}: ${name}`, passed: true, duration });
    console.log(`  ✓ ${name} (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name: `${currentSuite}: ${name}`, passed: false, error: errorMsg, duration });
    console.log(`  ✗ ${name} (${duration}ms)`);
    console.log(`    Error: ${errorMsg}`);
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

export function assertExists<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected value to exist');
  }
}

export function assertArray(value: unknown, message?: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message || `Expected array, got ${typeof value}`);
  }
}

export function assertType(value: unknown, type: string, message?: string): void {
  if (typeof value !== type) {
    throw new Error(message || `Expected ${type}, got ${typeof value}`);
  }
}

export function assertHasKeys(obj: Record<string, unknown>, keys: string[], message?: string): void {
  for (const key of keys) {
    if (!(key in obj)) {
      throw new Error(message || `Missing required key: ${key}`);
    }
  }
}

// API helper with timeout and retry
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  retries = 2
): Promise<{ status: number; data: T }> {
  const url = `${API_URL}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        signal: controller.signal,
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      clearTimeout(timeout);

      let data: T;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : ({} as T);
      } catch {
        data = text as unknown as T;
      }

      return { status: response.status, data };
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // Wait before retry
      await sleep(1000);
    }
  }

  throw new Error('Unexpected: retries exhausted');
}

// Convenience methods
export const get = <T = unknown>(path: string) => api<T>('GET', path);
export const post = <T = unknown>(path: string, body?: unknown) => api<T>('POST', path, body);
export const put = <T = unknown>(path: string, body?: unknown) => api<T>('PUT', path, body);
export const del = <T = unknown>(path: string) => api<T>('DELETE', path);

// Summary reporting
export function printSummary(): { passed: number; failed: number; total: number } {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total:  ${total} tests`);
  console.log(`  Passed: ${passed} ✓`);
  console.log(`  Failed: ${failed} ✗`);
  console.log(`  Time:   ${totalTime}ms`);

  if (failed > 0) {
    console.log(`\n  FAILURES:`);
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}`);
      console.log(`    ${r.error}`);
    });
  }

  console.log('');

  return { passed, failed, total };
}

// Sleep helper
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Generate unique test IDs
export const testId = () => `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
