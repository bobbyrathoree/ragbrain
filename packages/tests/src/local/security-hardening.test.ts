import {
  getApiKeyFromHeaders,
  parseApiKeySecret,
  resolveCredentialForApiKey,
} from '../../../infra/lib/shared/auth.ts';
import { sanitizeHighlightSnippet } from '../../../infra/lib/shared/sanitization.ts';

interface ResultSummary {
  passed: number;
  failed: number;
  total: number;
}

const results: Array<{ name: string; error?: string }> = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, error: message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${message}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

console.log('\nSecurity hardening checks\n');

await test('Legacy secret falls back to the existing dev user for compatibility', () => {
  const credentials = parseApiKeySecret(JSON.stringify({ key: 'legacy-key' }));
  assert(credentials.length === 1, 'Expected one legacy credential');
  assert(credentials[0].userId === 'dev', 'Legacy credentials should keep the dev user mapping');
});

await test('Multi-user secret binds each API key to a distinct user', () => {
  const credentials = parseApiKeySecret(JSON.stringify({
    keys: [
      { key: 'alice-key', userId: 'alice' },
      { key: 'bob-key', userId: 'bob' },
    ],
  }));

  const alice = resolveCredentialForApiKey('alice-key', credentials);
  const bob = resolveCredentialForApiKey('bob-key', credentials);

  assert(alice?.userId === 'alice', 'alice-key should resolve to alice');
  assert(bob?.userId === 'bob', 'bob-key should resolve to bob');
});

await test('Header lookup is case-insensitive and ignores empty values', () => {
  const apiKey = getApiKeyFromHeaders({
    'X-API-KEY': 'secret-key',
    'x-empty': '',
  });

  assert(apiKey === 'secret-key', 'Expected to read x-api-key case-insensitively');
  assert(getApiKeyFromHeaders({ 'x-api-key': '   ' }) === null, 'Blank API keys should be rejected');
});

await test('Malformed secret entries fail closed', () => {
  let failed = false;

  try {
    parseApiKeySecret(JSON.stringify({ keys: [{ key: 'missing-user' }] }));
  } catch {
    failed = true;
  }

  assert(failed, 'Missing user IDs in multi-user secrets should be rejected');
});

await test('Search highlight sanitization preserves only <mark> tags', () => {
  const snippet = '<img src=x onerror=alert(1)><mark>match</mark><script>alert(1)</script>';
  const sanitized = sanitizeHighlightSnippet(snippet);

  assert(sanitized?.includes('<mark>match</mark>'), 'Expected mark tags to survive');
  assert(!sanitized?.includes('<img'), 'Unexpected img tag in sanitized output');
  assert(!sanitized?.includes('<script'), 'Unexpected script tag in sanitized output');
  assert(sanitized?.includes('&lt;img'), 'Expected attacker-controlled HTML to be escaped');
});

const summary: ResultSummary = {
  passed: results.filter(result => !result.error).length,
  failed: results.filter(result => result.error).length,
  total: results.length,
};

console.log(`\n${summary.passed}/${summary.total} checks passed\n`);

if (summary.failed > 0) {
  process.exit(1);
}

export default summary;
