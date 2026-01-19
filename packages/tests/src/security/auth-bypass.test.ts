/**
 * Authentication Bypass Tests
 *
 * Tests for authentication vulnerabilities and API key validation.
 * Verifies that the API properly rejects unauthorized requests.
 *
 * Security categories tested:
 * - Missing authentication
 * - Invalid credentials
 * - Injection attacks on auth
 * - Auth header manipulation
 */

import {
  suite, test, assert, assertType, api, printSummary, testId,
} from '../test-utils.js';

// Custom API call without authentication
async function apiNoAuth<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
  const url = `${API_URL}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
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
}

// Custom API call with custom headers
async function apiWithHeaders<T = unknown>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
  const url = `${API_URL}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
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
}

suite('Security: Authentication Bypass');

// Test 1: Missing API key header
await test('Missing x-api-key header should return 401/403', async () => {
  const { status } = await apiNoAuth('GET', '/thoughts?limit=1');

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for missing API key, got ${status}`
  );
});

// Test 2: Empty API key
await test('Empty API key should return 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': '',
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for empty API key, got ${status}`
  );
});

// Test 3: Invalid API key
await test('Invalid API key should return 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': 'invalid-key-12345',
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for invalid API key, got ${status}`
  );
});

// Test 4: SQL injection in API key
await test('SQL injection in API key should return 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': "' OR '1'='1",
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for SQL injection attempt, got ${status}`
  );
});

// Test 5: NoSQL injection in API key
await test('NoSQL injection in API key should return 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': '{"$gt": ""}',
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for NoSQL injection attempt, got ${status}`
  );
});

// Test 6: API key in query string should not work
await test('API key in query string should not authenticate', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';
  const { status } = await apiNoAuth('GET', `/thoughts?limit=1&x-api-key=${API_KEY}`);

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for API key in query string, got ${status}`
  );
});

// Test 7: API key in body should not work
await test('API key in request body should not authenticate', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';
  const { status } = await apiNoAuth('POST', '/thoughts', {
    text: `Test ${testId()}`,
    type: 'note',
    'x-api-key': API_KEY,
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for API key in body, got ${status}`
  );
});

// Test 8: Very long API key
await test('Very long API key should return error', async () => {
  const longKey = 'a'.repeat(10000);
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': longKey,
  });

  // 431 = Request Header Fields Too Large (valid error for oversized headers)
  assert(
    status === 401 || status === 403 || status === 400 || status === 431,
    `Expected 401, 403, 400, or 431 for very long API key, got ${status}`
  );
});

// Test 9: API key with null bytes
await test('API key with null bytes should return error', async () => {
  try {
    const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
      'x-api-key': 'valid-key\x00-injection',
    });

    // Null bytes in headers may return 400 (bad request) or auth errors
    assert(
      status === 401 || status === 403 || status === 400,
      `Expected 401, 403, or 400 for API key with null bytes, got ${status}`
    );
  } catch (error) {
    // Headers API in Node.js/browser may reject null bytes outright
    // This is actually good - it means the attack is blocked at the client level
    const errorMessage = error instanceof Error ? error.message : String(error);
    assert(
      errorMessage.includes('invalid header') || errorMessage.includes('null'),
      `Expected header rejection error, got: ${errorMessage}`
    );
    console.log('    Null bytes blocked by Headers API (good)');
  }
});

// Test 10: Verify authenticated requests work (sanity check)
await test('Valid API key should return 200', async () => {
  const { status } = await api('GET', '/thoughts?limit=1');

  assert(
    status === 200 || status === 201,
    `Expected 200 or 201 for valid API key, got ${status}`
  );
});

// Test 11: Test POST endpoint without auth
await test('POST /thoughts without auth should return 401/403', async () => {
  const { status } = await apiNoAuth('POST', '/thoughts', {
    text: `Unauthorized test ${testId()}`,
    type: 'note',
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for POST without auth, got ${status}`
  );
});

// Test 12: Test POST /ask without auth
await test('POST /ask without auth should return 401/403', async () => {
  const { status } = await apiNoAuth('POST', '/ask', {
    query: 'What is the meaning of life?',
  });

  assert(
    status === 401 || status === 403,
    `Expected 401 or 403 for POST /ask without auth, got ${status}`
  );
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
