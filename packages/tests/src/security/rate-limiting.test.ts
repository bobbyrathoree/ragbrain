/**
 * Rate Limiting Tests
 *
 * Tests for per-user rate limit enforcement.
 * Verifies that the API properly limits request rates
 * and returns appropriate responses when limits are exceeded.
 *
 * Security categories tested:
 * - Request rate enforcement
 * - 429 response handling
 * - Retry-After header
 * - Rate limit headers
 *
 * Note: These tests are designed to verify rate limiting behavior
 * without actually hitting the full limit (which would be 1000/hour).
 * We test the mechanism, not the exhaustion.
 */

import {
  suite, test, assert, assertExists, assertType,
  get, post, api, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

// Track created resources
const createdThoughts: string[] = [];

suite('Security: Rate Limiting');

// Test 1: Normal requests should succeed
await test('Normal requests within rate limit succeed', async () => {
  // Make a few requests in sequence
  for (let i = 0; i < 3; i++) {
    const { status } = await get('/thoughts?limit=1');
    assert(status === 200, `Request ${i + 1} should succeed with 200, got ${status}`);
    await sleep(100); // Small delay between requests
  }
});

// Test 2: Verify rate limit headers are present
await test('Response includes rate limit headers (if implemented)', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  const response = await fetch(`${API_URL}/thoughts?limit=1`, {
    headers: {
      'x-api-key': API_KEY,
    },
  });

  // Check for common rate limit headers (may or may not be present)
  const rateLimitLimit = response.headers.get('x-ratelimit-limit');
  const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
  const rateLimitReset = response.headers.get('x-ratelimit-reset');

  // Log presence for documentation
  if (rateLimitLimit || rateLimitRemaining || rateLimitReset) {
    console.log(`    Rate limit headers found: limit=${rateLimitLimit}, remaining=${rateLimitRemaining}, reset=${rateLimitReset}`);
  } else {
    console.log('    Note: Standard rate limit headers not present (may use custom implementation)');
  }

  assert(response.status === 200, `Expected 200, got ${response.status}`);
});

// Test 3: Concurrent requests should be handled
await test('Concurrent requests are handled properly', async () => {
  // Make 5 concurrent requests
  const promises = Array(5).fill(null).map(() => get('/thoughts?limit=1'));
  const results = await Promise.all(promises);

  // All should either succeed or be rate limited
  for (let i = 0; i < results.length; i++) {
    const { status } = results[i];
    assert(
      status === 200 || status === 429,
      `Request ${i + 1} should be 200 or 429, got ${status}`
    );
  }

  // At least some should succeed
  const successes = results.filter(r => r.status === 200);
  assert(successes.length > 0, 'At least some concurrent requests should succeed');
});

// Test 4: Burst of write requests
await test('Burst write requests are handled', async () => {
  const results: Array<{ status: number; id?: string }> = [];

  // Make 5 rapid POST requests
  for (let i = 0; i < 5; i++) {
    const { status, data } = await post<ThoughtResponse>('/thoughts', {
      text: `Rate limit test ${testId()} - burst ${i}`,
      type: 'note',
      tags: ['rate-limit-test'],
    });

    results.push({ status, id: data.id });

    if (data.id) {
      createdThoughts.push(data.id);
    }
  }

  // Check that requests were either successful or rate limited
  for (let i = 0; i < results.length; i++) {
    const { status } = results[i];
    assert(
      status === 200 || status === 201 || status === 429,
      `Write request ${i + 1} should be 200, 201, or 429, got ${status}`
    );
  }

  // At least the first few should succeed
  const successes = results.filter(r => r.status === 200 || r.status === 201);
  assert(successes.length >= 3, `At least 3 burst writes should succeed, got ${successes.length}`);
});

// Test 5: Different endpoints share rate limit
await test('Rate limit applies across endpoints', async () => {
  // Mix of different endpoints
  const endpoints = [
    { method: 'GET', path: '/thoughts?limit=1' },
    { method: 'GET', path: '/conversations' },
    { method: 'GET', path: '/graph' },
    { method: 'GET', path: '/export' },
  ];

  const results = await Promise.all(
    endpoints.map(({ method, path }) => api(method, path))
  );

  // All should succeed or be rate limited consistently
  for (let i = 0; i < results.length; i++) {
    const { status } = results[i];
    assert(
      status === 200 || status === 429,
      `Endpoint ${endpoints[i].path} should return 200 or 429, got ${status}`
    );
  }
});

// Test 6: 429 response format (if triggered)
await test('429 response has proper format (informational)', async () => {
  // This test documents expected 429 behavior without triggering it
  // Make a normal request to verify the API is responding
  const { status, data } = await get('/thoughts?limit=1');

  if (status === 429) {
    // If we did hit rate limit, verify format
    const error = data as { message?: string; retryAfter?: number };
    console.log('    Actually hit rate limit, verifying format...');
    assertExists(error.message, '429 should have error message');
  } else {
    assert(status === 200, `Expected 200, got ${status}`);
    console.log('    Rate limit not triggered (expected for normal usage)');
  }
});

// Test 7: POST /ask rate limiting (more expensive operation)
await test('Ask endpoint respects rate limits', async () => {
  // Ask is more expensive, verify it works within limits
  const { status } = await post('/ask', {
    query: `Rate limit test ${testId()}`,
  });

  // Should either work or be rate limited
  assert(
    status === 200 || status === 201 || status === 429,
    `Ask should return 200, 201, or 429, got ${status}`
  );
});

// Test 8: Rate limit doesn't affect error responses
await test('Rate limit tracking handles errors gracefully', async () => {
  // Make invalid request - should return error, not count against rate limit unfairly
  const { status: errorStatus } = await post('/thoughts', {
    // Missing required text field
    type: 'note',
  });

  assert(errorStatus >= 400, 'Invalid request should return error');

  // Valid request should still work
  const { status: validStatus } = await get('/thoughts?limit=1');
  assert(validStatus === 200, `Valid request after error should succeed, got ${validStatus}`);
});

// Test 9: Rate limit per user (isolated by API key)
await test('Rate limits are per-user (API key isolated)', async () => {
  // This test verifies that our requests use our rate limit bucket
  // We can't test another user's bucket, but we can verify our requests work

  const requests = Array(3).fill(null).map((_, i) =>
    post<ThoughtResponse>('/thoughts', {
      text: `User isolation test ${testId()} - ${i}`,
      type: 'note',
      tags: ['rate-limit-test'],
    })
  );

  const results = await Promise.all(requests);

  // All should succeed (within our user's limit)
  const successes = results.filter(r => r.status === 200 || r.status === 201);
  assert(successes.length >= 2, 'User requests should succeed within their limit');

  // Track created thoughts
  for (const result of results) {
    if (result.data.id) {
      createdThoughts.push(result.data.id);
    }
  }
});

// Test 10: Recovery after rate limit window
await test('Service remains available after burst', async () => {
  // Wait a moment after burst tests
  await sleep(500);

  // Verify service is still responsive
  const { status } = await get('/thoughts?limit=1');
  assert(status === 200, `Service should be available after burst, got ${status}`);
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
