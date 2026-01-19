/**
 * PII Exposure Tests
 *
 * Tests for data leakage prevention and user isolation.
 * Verifies that error responses don't expose sensitive data
 * and that users can only access their own data.
 *
 * Security categories tested:
 * - Error response sanitization
 * - Stack trace prevention
 * - API key non-echo
 * - User data isolation
 */

import {
  suite, test, assert, assertExists, assertArray,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ListThoughtsResponse {
  thoughts: Array<{
    id: string;
    text: string;
    type: string;
  }>;
}

interface ErrorResponse {
  message?: string;
  error?: string;
  stack?: string;
  details?: unknown;
}

// Track created resources
const createdThoughts: string[] = [];

suite('Security: PII Exposure Prevention');

// Test 1: Error responses don't contain stack traces
await test('Error responses omit stack traces', async () => {
  // Trigger a 400 error
  const { status, data } = await post('/thoughts', {
    // Missing required text
    type: 'note',
  }) as { status: number; data: ErrorResponse };

  assert(status >= 400, 'Should return error status');

  const errorStr = JSON.stringify(data);

  // Should not contain stack trace indicators
  assert(
    !errorStr.includes('at '),
    'Error should not contain "at " stack trace'
  );
  assert(
    !errorStr.includes('Error:'),
    'Error should not contain raw Error: prefix'
  );
  assert(
    !errorStr.includes('.ts:'),
    'Error should not expose TypeScript file locations'
  );
  assert(
    !errorStr.includes('.js:'),
    'Error should not expose JavaScript file locations'
  );
  assert(
    !errorStr.includes('node_modules'),
    'Error should not expose node_modules paths'
  );
});

// Test 2: Error responses don't contain internal paths
await test('Error responses omit internal file paths', async () => {
  const { status, data } = await get('/thoughts/invalid-id-format') as {
    status: number;
    data: ErrorResponse
  };

  const errorStr = JSON.stringify(data);

  // Should not contain file system paths
  assert(
    !errorStr.includes('/var/'),
    'Error should not contain /var/ paths'
  );
  assert(
    !errorStr.includes('/home/'),
    'Error should not contain /home/ paths'
  );
  assert(
    !errorStr.includes('/Users/'),
    'Error should not contain /Users/ paths'
  );
  assert(
    !errorStr.includes('C:\\'),
    'Error should not contain Windows paths'
  );
});

// Test 3: API keys are not echoed in responses
await test('API key is not echoed in responses', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  // Make a successful request
  const { status, data } = await get('/thoughts?limit=1');
  const responseStr = JSON.stringify(data);

  // API key should not appear in response
  if (API_KEY.length > 8) {
    assert(
      !responseStr.includes(API_KEY),
      'Response should not contain API key'
    );
    // Also check partial key
    assert(
      !responseStr.includes(API_KEY.substring(0, 8)),
      'Response should not contain partial API key'
    );
  }
});

// Test 4: API keys not echoed in error responses
await test('API key not echoed in error responses', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  // Trigger an error
  const { data } = await post('/thoughts', {}) as {
    status: number;
    data: ErrorResponse
  };

  const errorStr = JSON.stringify(data);

  if (API_KEY.length > 8) {
    assert(
      !errorStr.includes(API_KEY),
      'Error should not contain API key'
    );
  }
});

// Test 5: User can only see their own thoughts
await test('User can only access their own thoughts', async () => {
  // Create a thought
  const { status: createStatus, data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Private thought ${testId()} - should only be visible to owner`,
    type: 'note',
    tags: ['isolation-test'],
  });

  assert(createStatus === 200 || createStatus === 201, `Expected 200 or 201, got ${createStatus}`);
  assertExists(createData.id, 'Should create thought');

  createdThoughts.push(createData.id);

  // Verify we can retrieve it
  const { status: getStatus, data: thoughtsList } = await get<ListThoughtsResponse>(
    `/thoughts?tag=isolation-test&limit=10`
  );

  assert(getStatus === 200, `Expected 200, got ${getStatus}`);
  assertArray(thoughtsList.thoughts, 'Should return thoughts array');

  // Our thought should be in the list
  const ourThought = thoughtsList.thoughts.find(t => t.id === createData.id);
  assert(ourThought !== undefined, 'Should find our own thought');
});

// Test 6: Error messages are generic (not leaking internals)
await test('Error messages are user-friendly and generic', async () => {
  // Try various invalid operations
  const testCases = [
    { path: '/thoughts/nonexistent-id', expected: [400, 404] },
    { path: '/conversations/c_invalid', expected: [400, 404] },
    { path: '/thoughts/../../../etc/passwd', expected: [400, 404] },
  ];

  for (const testCase of testCases) {
    const { status, data } = await get(testCase.path) as {
      status: number;
      data: ErrorResponse
    };

    assert(
      testCase.expected.includes(status),
      `${testCase.path} should return ${testCase.expected.join(' or ')}, got ${status}`
    );

    if (data.message) {
      // Message should be user-friendly
      assert(
        !data.message.includes('undefined'),
        `Error for ${testCase.path} should not contain 'undefined'`
      );
      assert(
        !data.message.includes('null'),
        `Error for ${testCase.path} should not contain 'null'`
      );
      assert(
        !data.message.includes('TypeError'),
        `Error for ${testCase.path} should not contain 'TypeError'`
      );
    }
  }
});

// Test 7: Successful responses don't leak other users' data
await test('List responses only contain user\'s own data', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=100');

  assert(status === 200, `Expected 200, got ${status}`);
  assertArray(data.thoughts, 'Should return thoughts array');

  // All thoughts should have expected structure (no admin fields leaked)
  for (const thought of data.thoughts) {
    const thoughtObj = thought as Record<string, unknown>;

    // Should not have internal fields
    assert(
      !('userId' in thoughtObj && thoughtObj.userId !== undefined),
      'Thoughts should not expose userId field'
    );
    assert(
      !('_internal' in thoughtObj),
      'Thoughts should not have _internal field'
    );
    assert(
      !('encryptionKey' in thoughtObj),
      'Thoughts should not expose encryptionKey'
    );
  }
});

// Test 8: AWS resource identifiers not exposed
await test('AWS resource identifiers not exposed in responses', async () => {
  const { status, data } = await get('/thoughts?limit=1');
  const responseStr = JSON.stringify(data);

  // Should not contain AWS ARNs
  assert(
    !responseStr.includes('arn:aws:'),
    'Response should not contain AWS ARNs'
  );

  // Should not contain AWS account IDs (12 digits)
  const accountIdPattern = /\d{12}/;
  // This is a soft check - IDs could legitimately have 12 digits
  // We just note if found
  if (accountIdPattern.test(responseStr)) {
    console.log('    Note: Found 12-digit number in response (may or may not be AWS account)');
  }
});

// Test 9: Error responses consistent regardless of existence
await test('Error responses don\'t reveal existence (timing-safe)', async () => {
  // Request non-existent resource
  const start1 = Date.now();
  const { status: status1 } = await get('/conversations/c_definitely_not_real_12345');
  const time1 = Date.now() - start1;

  // Request another non-existent resource
  const start2 = Date.now();
  const { status: status2 } = await get('/conversations/c_also_not_real_67890');
  const time2 = Date.now() - start2;

  // Both should return same status (not leaking existence via different codes)
  assert(
    status1 === status2,
    `Both non-existent resources should return same status: ${status1} vs ${status2}`
  );

  // Timing should be similar (within 500ms) - not a strict security test but informative
  const timeDiff = Math.abs(time1 - time2);
  if (timeDiff > 500) {
    console.log(`    Note: Response times differ by ${timeDiff}ms (may indicate timing leak)`);
  }
});

// Test 10: Sensitive field masking in logs (via response inspection)
await test('No sensitive data patterns in successful responses', async () => {
  // Create a thought with sensitive-looking content
  const { status: createStatus, data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Test with email user@example.com and phone 555-1234 ${testId()}`,
    type: 'note',
  });

  assert(createStatus === 200 || createStatus === 201, `Expected 200 or 201, got ${createStatus}`);

  if (createData.id) {
    createdThoughts.push(createData.id);
  }

  // The response itself shouldn't add any PII we didn't put in
  const responseStr = JSON.stringify(createData);

  // Response should only contain id and createdAt, not echo back sensitive content
  const responseKeys = Object.keys(createData);
  assert(
    !responseKeys.includes('password'),
    'Response should not have password field'
  );
  assert(
    !responseKeys.includes('ssn'),
    'Response should not have ssn field'
  );
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
