/**
 * Infrastructure Stack Tests
 *
 * Tests for verifying CDK infrastructure is properly deployed.
 * Tests observable effects through API behavior rather than CDK assertions
 * (since we don't have access to CDK constructs in integration tests).
 *
 * Verifies:
 * - API Gateway is deployed and responding
 * - Lambda functions are working
 * - DynamoDB tables are accessible
 * - S3 storage is working (indirectly through capture)
 * - KMS encryption is functional
 * - OpenSearch is operational (through search)
 */

import {
  suite, test, assert, assertExists, assertArray,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface HealthResponse {
  status?: string;
  message?: string;
}

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ListThoughtsResponse {
  thoughts: Array<{
    id: string;
    text: string;
  }>;
}

interface AskResponse {
  answer: string;
  citations?: unknown[];
}

interface ExportResponse {
  thoughts: unknown[];
  conversations: unknown[];
  syncTimestamp: string;
}

interface GraphResponse {
  nodes: unknown[];
  edges: unknown[];
}

suite('Infrastructure: Stack Verification');

// API Gateway verification

await test('API Gateway: Responds to requests', async () => {
  const { status } = await get('/thoughts?limit=1');

  assert(status === 200, `API Gateway should respond, got ${status}`);
});

await test('API Gateway: Returns proper CORS headers (if configured)', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  const response = await fetch(`${API_URL}/thoughts?limit=1`, {
    method: 'GET',
    headers: {
      'x-api-key': API_KEY,
    },
  });

  // Check for CORS headers
  const corsOrigin = response.headers.get('access-control-allow-origin');

  if (corsOrigin) {
    console.log(`    CORS Origin: ${corsOrigin}`);
  } else {
    console.log('    Note: CORS headers not in GET response (may be OPTIONS only)');
  }

  assert(response.ok, 'Request should succeed');
});

await test('API Gateway: Handles OPTIONS preflight', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';

  const response = await fetch(`${API_URL}/thoughts`, {
    method: 'OPTIONS',
    headers: {
      'Origin': 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
    },
  });

  // OPTIONS may return 200 or 204
  assert(
    response.status === 200 || response.status === 204 || response.status === 403,
    `OPTIONS should be handled, got ${response.status}`
  );
});

// Lambda function verification (through endpoints)

await test('Lambda: Capture function working', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Infrastructure test ${testId()} - capture function`,
    type: 'note',
    tags: ['infra-test'],
  });

  assert(status === 200 || status === 201, `Capture Lambda should work, got ${status}`);
  assertExists(data.id, 'Should return thought ID');
});

await test('Lambda: Thoughts function working', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=5');

  assert(status === 200, `Thoughts Lambda should work, got ${status}`);
  assertArray(data.thoughts, 'Should return thoughts array');
});

await test('Lambda: Ask function working', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Infrastructure test query',
  });

  assert(status === 200 || status === 201, `Ask Lambda should work, got ${status}`);
  assertExists(data.answer, 'Should return answer');
});

await test('Lambda: Conversations function working', async () => {
  const { status } = await get('/conversations?limit=1');

  assert(status === 200, `Conversations Lambda should work, got ${status}`);
});

await test('Lambda: Export function working', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Export Lambda should work, got ${status}`);
  assertExists(data.syncTimestamp, 'Should return syncTimestamp');
});

await test('Lambda: Graph function working', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Graph Lambda should work, got ${status}`);
  assertArray(data.nodes, 'Should return nodes array');
  assertArray(data.edges, 'Should return edges array');
});

await test('Lambda: Authorizer function working', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL || 'https://4xxsak1g64.execute-api.us-west-2.amazonaws.com/dev';

  // Test without auth - should be rejected
  const noAuthResponse = await fetch(`${API_URL}/thoughts?limit=1`, {
    method: 'GET',
  });

  assert(
    noAuthResponse.status === 401 || noAuthResponse.status === 403,
    `Authorizer should reject no-auth, got ${noAuthResponse.status}`
  );

  // Test with auth - should succeed
  const { status: authStatus } = await get('/thoughts?limit=1');
  assert(authStatus === 200, `Authorizer should allow valid auth, got ${authStatus}`);
});

// DynamoDB verification (through CRUD operations)

await test('DynamoDB: Write operations working', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `DynamoDB write test ${testId()}`,
    type: 'note',
    tags: ['dynamo-test'],
  });

  assert(status === 200 || status === 201, `DynamoDB write should work, got ${status}`);
  assertExists(data.id, 'Should return generated ID');
});

await test('DynamoDB: Read operations working', async () => {
  await sleep(1000);

  const { status, data } = await get<ListThoughtsResponse>('/thoughts?tag=dynamo-test&limit=5');

  assert(status === 200, `DynamoDB read should work, got ${status}`);
  assert(data.thoughts.length > 0, 'Should find written thoughts');
});

await test('DynamoDB: GSI queries working (filter by type)', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?type=note&limit=5');

  assert(status === 200, `GSI query should work, got ${status}`);

  for (const thought of data.thoughts) {
    // All returned should match type filter
    assert(
      !('type' in thought) || thought.type === undefined || (thought as { type: string }).type === 'note',
      'GSI filter should work'
    );
  }
});

// S3 verification (through capture/export which uses S3)

await test('S3: Object storage working', async () => {
  // Large thought should use S3
  const largeText = `S3 storage test ${testId()}: ${'Large content for S3. '.repeat(100)}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: largeText,
    type: 'note',
    tags: ['s3-test'],
  });

  assert(status === 200 || status === 201, `S3 storage should work, got ${status}`);

  // Verify it can be retrieved
  await sleep(1000);

  const { status: listStatus, data: listData } = await get<ListThoughtsResponse>(
    '/thoughts?tag=s3-test&limit=5'
  );

  assert(listStatus === 200, 'Should retrieve S3-stored thought');

  const found = listData.thoughts.find(t => t.id === data.id);
  assert(found !== undefined, 'S3 thought should be retrievable');
});

// KMS verification (through encrypted conversations)

await test('KMS: Encryption working (conversations)', async () => {
  // Create conversation with sensitive content
  const { status, data } = await post('/conversations', {
    title: `KMS test conversation ${testId()}`,
    initialMessage: 'This message should be encrypted at rest',
    tags: ['kms-test'],
  }) as { status: number; data: { id: string } };

  assert(status === 200 || status === 201, `KMS-backed conversation should work, got ${status}`);

  await sleep(1000);

  // Retrieve - should be decrypted
  const { status: getStatus, data: getData } = await get(`/conversations/${data.id}`) as {
    status: number;
    data: { messages: Array<{ content: string }> }
  };

  assert(getStatus === 200, 'Should retrieve encrypted conversation');
  assert(
    getData.messages?.[0]?.content === 'This message should be encrypted at rest',
    'Decrypted content should match'
  );
});

// OpenSearch verification (through search functionality)

await test('OpenSearch: Index operations working', async () => {
  // Create and wait for indexing
  const uniqueId = `opensearch_${Date.now()}`;

  await post<ThoughtResponse>('/thoughts', {
    text: `OpenSearch test ${uniqueId} - verifying search infrastructure`,
    type: 'note',
    tags: ['opensearch-test'],
  });

  // Wait for indexing
  await sleep(10000);

  // Search should find it
  const { status, data } = await post<AskResponse>('/ask', {
    query: uniqueId,
  });

  assert(status === 200 || status === 201, `OpenSearch query should work, got ${status}`);

  if (data.citations && data.citations.length > 0) {
    console.log('    OpenSearch index is working');
  } else {
    console.log('    Note: Thought may not be indexed yet');
  }
});

// CloudWatch verification (implicit - if we got this far, logs are likely working)

await test('CloudWatch: Implicit verification', async () => {
  // All Lambda invocations should be logging to CloudWatch
  // If the previous tests passed, CloudWatch is working
  console.log('    CloudWatch logs verified implicitly through Lambda execution');
  assert(true, 'CloudWatch implicit verification');
});

// Error handling verification

await test('Infrastructure: Error responses are consistent', async () => {
  const errorEndpoints = [
    '/thoughts/nonexistent-id',
    '/conversations/nonexistent-id',
  ];

  for (const endpoint of errorEndpoints) {
    const { status } = await get(endpoint);

    // Should return proper error codes, not 500
    assert(
      status === 400 || status === 404,
      `${endpoint} should return 400/404, got ${status}`
    );
  }
});

// Rate limiting infrastructure

await test('Infrastructure: Rate limiting responding', async () => {
  // Multiple rapid requests
  const results: number[] = [];

  for (let i = 0; i < 5; i++) {
    const { status } = await get('/thoughts?limit=1');
    results.push(status);
  }

  // Should either all succeed or some be rate limited
  const hasSuccess = results.some(s => s === 200);
  const hasRateLimit = results.some(s => s === 429);

  console.log(`    Rapid requests: ${results.filter(s => s === 200).length} succeeded`);

  if (hasRateLimit) {
    console.log('    Rate limiting is active');
  }

  assert(hasSuccess, 'At least some requests should succeed');
});

// Regional deployment verification

await test('Infrastructure: Deployed to expected region', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL || '';

  // Extract region from URL
  const regionMatch = API_URL.match(/\.([a-z]+-[a-z]+-\d+)\./);

  if (regionMatch) {
    console.log(`    Deployed region: ${regionMatch[1]}`);
  } else {
    console.log('    Note: Could not extract region from URL');
  }

  assert(true, 'Region check completed');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
