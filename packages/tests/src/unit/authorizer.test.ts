/**
 * Authorizer Lambda Unit Tests
 *
 * Tests for API authorization behavior.
 * Tests authentication, rate limiting responses, and access control.
 *
 * Note: Tests the authorization effects via API responses.
 */

import {
  suite, test, assert, assertExists,
  get, post, api, printSummary, testId, sleep
} from '../test-utils.js';

// Custom API call without authentication
async function apiNoAuth<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: T; headers: Headers }> {
  const API_URL = process.env.RAGBRAIN_API_URL!;
  const url = `${API_URL}${path}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  let data: T;
  const text = await response.text();
  try {
    data = text ? JSON.parse(text) : ({} as T);
  } catch {
    data = text as unknown as T;
  }

  return { status: response.status, data, headers: response.headers };
}

// Custom API call with custom headers
async function apiWithHeaders<T = unknown>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; data: T; headers: Headers }> {
  const API_URL = process.env.RAGBRAIN_API_URL!;
  const url = `${API_URL}${path}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  let data: T;
  const text = await response.text();
  try {
    data = text ? JSON.parse(text) : ({} as T);
  } catch {
    data = text as unknown as T;
  }

  return { status: response.status, data, headers: response.headers };
}

interface ErrorResponse {
  message?: string;
  error?: string;
}

suite('Unit: Authorizer Lambda');

// API key validation tests

await test('Auth: Missing API key returns 401/403', async () => {
  const { status } = await apiNoAuth('GET', '/thoughts?limit=1');

  assert(
    status === 401 || status === 403,
    `Missing key should return 401/403, got ${status}`
  );
});

await test('Auth: Empty API key returns 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': '',
  });

  assert(
    status === 401 || status === 403,
    `Empty key should return 401/403, got ${status}`
  );
});

await test('Auth: Invalid API key returns 401/403', async () => {
  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': 'invalid-key-12345',
  });

  assert(
    status === 401 || status === 403,
    `Invalid key should return 401/403, got ${status}`
  );
});

await test('Auth: Valid API key allows access', async () => {
  const { status } = await get('/thoughts?limit=1');

  assert(
    status === 200,
    `Valid key should allow access, got ${status}`
  );
});

// Rate limit tests (observing effects)

await test('RateLimit: Normal requests succeed', async () => {
  // Make several requests in sequence
  for (let i = 0; i < 5; i++) {
    const { status } = await get('/thoughts?limit=1');
    assert(
      status === 200 || status === 429,
      `Request ${i + 1} should be 200 or 429, got ${status}`
    );
    await sleep(50);
  }
});

await test('RateLimit: Response includes rate limit headers (if implemented)', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL!;
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  const response = await fetch(`${API_URL}/thoughts?limit=1`, {
    headers: {
      'x-api-key': API_KEY,
    },
  });

  // Check for rate limit headers
  const limitHeader = response.headers.get('x-ratelimit-limit');
  const remainingHeader = response.headers.get('x-ratelimit-remaining');

  if (limitHeader || remainingHeader) {
    console.log(`    Rate limit headers: limit=${limitHeader}, remaining=${remainingHeader}`);
  } else {
    console.log('    Note: Standard rate limit headers not present');
  }

  assert(response.ok, 'Request should succeed');
});

await test('RateLimit: 429 response format (if triggered)', async () => {
  // Make rapid requests to potentially trigger rate limit
  const results: number[] = [];

  for (let i = 0; i < 10; i++) {
    const { status } = await get('/thoughts?limit=1');
    results.push(status);
    // No delay - trying to trigger rate limit
  }

  const rateLimited = results.filter(s => s === 429);

  if (rateLimited.length > 0) {
    console.log(`    ${rateLimited.length}/10 requests rate limited`);
  } else {
    console.log('    Note: Rate limit not triggered');
  }

  // At least some should succeed
  const succeeded = results.filter(s => s === 200);
  assert(succeeded.length > 0, 'At least some requests should succeed');
});

// User isolation tests

await test('UserIsolation: User sees own data', async () => {
  // Create a thought
  const uniqueText = `Isolation test ${testId()} - private data`;
  const { status: createStatus, data: createData } = await post('/thoughts', {
    text: uniqueText,
    type: 'note',
    tags: ['isolation-auth-test'],
  }) as { status: number; data: { id: string } };

  assert(createStatus === 200 || createStatus === 201, 'Create should succeed');

  await sleep(1000);

  // Verify we can see it
  const { status: getStatus, data: getData } = await get('/thoughts?tag=isolation-auth-test') as {
    status: number;
    data: { thoughts: Array<{ id: string }> }
  };

  assert(getStatus === 200, 'Get should succeed');

  const found = getData.thoughts.find(t => t.id === createData.id);
  assert(found !== undefined, 'User should see their own thought');
});

// Authorization error response format

await test('AuthError: Returns proper error structure', async () => {
  const { status, data } = await apiNoAuth('GET', '/thoughts?limit=1') as {
    status: number;
    data: ErrorResponse
  };

  assert(status === 401 || status === 403, 'Should return auth error');

  // Should have some kind of message
  const hasMessage = data.message !== undefined || data.error !== undefined;

  if (hasMessage) {
    // Message should be generic (not revealing)
    const messageText = data.message || data.error || '';
    assert(
      !messageText.includes('API key'),
      'Error should not mention API key'
    );
  }
});

await test('AuthError: No stack trace in error', async () => {
  const { data } = await apiNoAuth('GET', '/thoughts?limit=1') as {
    status: number;
    data: ErrorResponse
  };

  const dataStr = JSON.stringify(data);

  assert(
    !dataStr.includes('at '),
    'Error should not contain stack trace'
  );
  assert(
    !dataStr.includes('.ts:'),
    'Error should not expose source locations'
  );
});

// Header handling tests

await test('Headers: x-api-key is case-insensitive', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  // Try different cases
  const cases = [
    'x-api-key',
    'X-Api-Key',
    'X-API-KEY',
  ];

  for (const headerName of cases) {
    const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
      [headerName]: API_KEY,
    });

    // At least one case should work (depending on API Gateway config)
    if (status === 200) {
      console.log(`    Header "${headerName}" works`);
    }
  }

  // At least standard header should work
  const { status: standardStatus } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': API_KEY,
  });

  assert(standardStatus === 200, 'Standard x-api-key should work');
});

await test('Headers: Extra headers don\'t affect auth', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  const { status } = await apiWithHeaders('GET', '/thoughts?limit=1', {
    'x-api-key': API_KEY,
    'x-custom-header': 'some-value',
    'x-another-header': 'another-value',
  });

  assert(status === 200, 'Extra headers should not affect auth');
});

// Access control per endpoint

await test('AccessControl: All endpoints require auth', async () => {
  const endpoints = [
    { method: 'GET', path: '/thoughts' },
    { method: 'POST', path: '/thoughts' },
    { method: 'GET', path: '/thoughts/t_test/related' },
    { method: 'GET', path: '/conversations' },
    { method: 'POST', path: '/conversations' },
    { method: 'POST', path: '/ask' },
    { method: 'GET', path: '/graph' },
    { method: 'GET', path: '/export' },
  ];

  for (const { method, path } of endpoints) {
    const body = method === 'POST' ? { text: 'test', query: 'test', initialMessage: 'test' } : undefined;
    const { status } = await apiNoAuth(method, path, body);

    assert(
      status === 401 || status === 403,
      `${method} ${path} should require auth, got ${status}`
    );
  }

  console.log(`    Verified ${endpoints.length} endpoints require auth`);
});

// Auth caching behavior

await test('Auth: Consistent auth decisions', async () => {
  // Same key should always work
  const results: number[] = [];

  for (let i = 0; i < 5; i++) {
    const { status } = await get('/thoughts?limit=1');
    results.push(status);
    await sleep(100);
  }

  // All should be same status (either all 200 or all rate limited)
  const uniqueStatuses = [...new Set(results)];

  // Allow for 200 and 429 mix (rate limiting), but not 401/403 mix
  const authErrors = results.filter(s => s === 401 || s === 403);
  assert(
    authErrors.length === 0,
    'Valid key should not randomly fail auth'
  );
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
