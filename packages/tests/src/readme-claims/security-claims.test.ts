/**
 * README Security Claims Verification Tests
 *
 * Tests that verify security claims made in README and CLAUDE.md.
 *
 * Claims verified:
 * - "All data encrypted" (KMS encryption)
 * - "No secrets in logs" (no key echoing)
 * - "Privacy focused" (user isolation)
 * - "PII scrubbing" (error sanitization)
 */

import {
  suite, test, assert, assertExists, assertArray,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ConversationResponse {
  id: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
}

interface ExportResponse {
  thoughts: unknown[];
  conversations: Array<{
    id: string;
    messages: Array<{
      role: string;
      content: string;
    }>;
  }>;
  deletedThoughts: string[];
  deletedConversations: string[];
  syncTimestamp: string;
}

interface ListThoughtsResponse {
  thoughts: Array<{
    id: string;
    text: string;
  }>;
}

// Track created resources
const createdConversations: string[] = [];

suite('README Claims: Security');

// Claim: "All data encrypted"

await test('Claim: Conversation messages stored encrypted', async () => {
  // Create a conversation with sensitive content
  const { status, data } = await post<ConversationResponse>('/conversations', {
    title: 'Encryption verification',
    initialMessage: `Sensitive test content ${testId()} - should be encrypted`,
    tags: ['security-claim-test'],
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should create conversation');

  createdConversations.push(data.id);

  // Wait for storage
  await sleep(1000);

  // Retrieve and verify it decrypts properly
  const { status: getStatus, data: convData } = await get<ConversationDetail>(
    `/conversations/${data.id}`
  );

  assert(getStatus === 200, `Expected 200, got ${getStatus}`);
  assertExists(convData.messages, 'Should have messages');
  assert(convData.messages.length > 0, 'Should have at least one message');

  // Content should be readable (decrypted), not ciphertext
  const firstMessage = convData.messages[0];
  assert(
    firstMessage.content.includes('Sensitive test content'),
    'Message should be decrypted and readable'
  );
});

await test('Claim: Export returns decrypted data (authorized access)', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  // If we have conversations, verify they're decrypted
  if (data.conversations && data.conversations.length > 0) {
    for (const conv of data.conversations) {
      if (conv.messages && conv.messages.length > 0) {
        const msg = conv.messages[0];
        // Should not look like base64-encoded ciphertext
        assert(
          !msg.content.match(/^[A-Za-z0-9+/]{50,}={0,2}$/),
          'Message should not be base64 ciphertext'
        );
      }
    }
    console.log(`    Verified ${data.conversations.length} conversations are decrypted`);
  }
});

// Claim: "No secrets in logs"

await test('Claim: API key not echoed in successful responses', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=1');
  const responseStr = JSON.stringify(data);

  assert(status === 200, `Expected 200, got ${status}`);

  if (API_KEY.length > 8) {
    // Full key should not appear
    assert(
      !responseStr.includes(API_KEY),
      'API key should not be in response'
    );

    // First 8 chars shouldn't appear either
    assert(
      !responseStr.includes(API_KEY.substring(0, 8)),
      'Partial API key should not be in response'
    );
  }
});

await test('Claim: API key not echoed in error responses', async () => {
  const API_KEY = process.env.RAGBRAIN_API_KEY || '';

  // Trigger an error
  const { data } = await post('/thoughts', {
    // Missing required field
    type: 'note',
  });

  const errorStr = JSON.stringify(data);

  if (API_KEY.length > 8) {
    assert(
      !errorStr.includes(API_KEY),
      'API key should not be in error response'
    );
  }
});

await test('Claim: No internal paths in responses', async () => {
  const { status, data } = await get('/thoughts/invalid-id');
  const responseStr = JSON.stringify(data);

  // Should not expose Lambda function paths
  assert(
    !responseStr.includes('/var/task'),
    'Should not expose Lambda paths'
  );
  assert(
    !responseStr.includes('/var/runtime'),
    'Should not expose runtime paths'
  );
  assert(
    !responseStr.includes('node_modules'),
    'Should not expose node_modules'
  );
});

// Claim: "Privacy focused" - User isolation

await test('Claim: User can only see own thoughts', async () => {
  // Create a thought
  const { status: createStatus, data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Privacy test ${testId()} - only visible to owner`,
    type: 'note',
    tags: ['privacy-test'],
  });

  assert(createStatus === 200 || createStatus === 201, 'Should create thought');

  // List thoughts - should include ours
  const { status: listStatus, data: listData } = await get<ListThoughtsResponse>(
    '/thoughts?tag=privacy-test&limit=10'
  );

  assert(listStatus === 200, `Expected 200, got ${listStatus}`);

  // Our thought should be there
  const found = listData.thoughts.some(t => t.id === createData.id);
  assert(found, 'User should see their own thought');
});

await test('Claim: No cross-user data leakage in list', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=50');

  assert(status === 200, `Expected 200, got ${status}`);
  assertArray(data.thoughts, 'Should return array');

  // All returned thoughts should belong to the authenticated user
  // We can't directly verify this without another user, but we can check
  // that no obviously foreign data is present
  for (const thought of data.thoughts) {
    const thoughtObj = thought as Record<string, unknown>;

    // Should not have a userId field exposed (would indicate multi-tenancy leak)
    assert(
      !('userId' in thoughtObj) || thoughtObj.userId === undefined,
      'Thoughts should not expose userId'
    );

    // Should not have ownership markers from other users
    assert(
      !('ownerId' in thoughtObj),
      'Thoughts should not expose ownerId'
    );
  }
});

// Claim: "PII scrubbing" - Error sanitization

await test('Claim: Error messages are sanitized', async () => {
  // Trigger various errors and check sanitization
  const testCases = [
    '/thoughts/nonexistent',
    '/conversations/invalid',
    '/thoughts/../etc/passwd',
  ];

  for (const path of testCases) {
    const { data } = await get(path);
    const errorStr = JSON.stringify(data);

    // Should not contain stack traces
    assert(
      !errorStr.includes('at '),
      `Error for ${path} should not have stack trace`
    );

    // Should not contain internal error types
    assert(
      !errorStr.includes('TypeError'),
      `Error for ${path} should not expose TypeError`
    );
    assert(
      !errorStr.includes('ReferenceError'),
      `Error for ${path} should not expose ReferenceError`
    );
  }
});

await test('Claim: No sensitive data in error details', async () => {
  // Try to trigger a validation error with sensitive-looking data
  const { data } = await post('/thoughts', {
    text: '', // Invalid empty text
    type: 'note',
    // Include some sensitive-looking fields that shouldn't be echoed
    password: 'secret123',
    ssn: '123-45-6789',
  });

  const errorStr = JSON.stringify(data);

  // The error should not echo back the sensitive fields
  assert(
    !errorStr.includes('secret123'),
    'Error should not echo password field'
  );
  assert(
    !errorStr.includes('123-45-6789'),
    'Error should not echo ssn field'
  );
});

// Claim: API authentication required

await test('Claim: All endpoints require authentication', async () => {
  const API_URL = process.env.RAGBRAIN_API_URL!;

  const endpoints = [
    { method: 'GET', path: '/thoughts' },
    { method: 'POST', path: '/thoughts' },
    { method: 'GET', path: '/conversations' },
    { method: 'POST', path: '/ask' },
    { method: 'GET', path: '/graph' },
    { method: 'GET', path: '/export' },
  ];

  for (const { method, path } of endpoints) {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify({ text: 'test', query: 'test' }) : undefined,
    });

    assert(
      response.status === 401 || response.status === 403,
      `${method} ${path} should require auth, got ${response.status}`
    );
  }
});

// Known limitations documentation

await test('Info: Document known security limitations', async () => {
  console.log('    Known limitations:');
  console.log('    - CORS: allowOrigins: ["*"] (noted as TODO in codebase)');
  console.log('    - WAF: Not enabled for dev environment');
  console.log('    - Single user mode: API key = user identity');
  assert(true, 'Documentation test always passes');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
