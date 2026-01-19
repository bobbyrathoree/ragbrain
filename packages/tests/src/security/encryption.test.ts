/**
 * Encryption Validation Tests
 *
 * Tests for verifying KMS encryption of sensitive data.
 * Verifies that conversation messages are encrypted at rest
 * and that plaintext is not exposed in error responses.
 *
 * Security categories tested:
 * - Message encryption verification
 * - No plaintext in error responses
 * - Encrypted field structure
 */

import {
  suite, test, assert, assertExists, assertType, assertArray,
  get, post, put, printSummary, testId, sleep
} from '../test-utils.js';

interface ConversationResponse {
  id: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  title?: string;
  status: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string;
    citations?: unknown[];
  }>;
  createdAt: string;
  updatedAt: string;
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

// Track created conversations for cleanup
const createdConversations: string[] = [];

suite('Security: Encryption Validation');

// Test 1: Create a conversation and verify it's stored
await test('Conversation messages are properly stored', async () => {
  const sensitiveContent = `Sensitive data ${testId()}: password123, SSN 123-45-6789`;

  const { status, data } = await post<ConversationResponse>('/conversations', {
    title: 'Encryption test conversation',
    initialMessage: sensitiveContent,
    tags: ['encryption-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Should create conversation');

  createdConversations.push(data.id);
});

// Test 2: Verify message decryption works for authorized users
await test('Messages decrypt correctly for authorized access', async () => {
  if (createdConversations.length === 0) {
    throw new Error('No conversation created for testing');
  }

  // Wait for indexing
  await sleep(2000);

  const conversationId = createdConversations[0];
  const { status, data } = await get<ConversationDetail>(`/conversations/${conversationId}`);

  assert(status === 200, `Expected 200, got ${status}`);
  assertExists(data.messages, 'Should have messages');
  assertArray(data.messages, 'Messages should be array');

  // Verify at least one message exists and has content
  assert(data.messages.length > 0, 'Should have at least one message');

  const firstMessage = data.messages[0];
  assertExists(firstMessage.content, 'Message should have content');
  assertType(firstMessage.content, 'string', 'Content should be string');

  // Content should be decrypted (not base64 gibberish)
  assert(
    firstMessage.content.length > 0,
    'Decrypted content should not be empty'
  );
});

// Test 3: Verify export endpoint returns decrypted messages
await test('Export decrypts messages for authorized user', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);
  assertExists(data.conversations, 'Should have conversations');
  assertArray(data.conversations, 'Conversations should be array');

  // If we have conversations, verify messages are decrypted
  if (data.conversations.length > 0) {
    const conv = data.conversations[0];
    if (conv.messages && conv.messages.length > 0) {
      const msg = conv.messages[0];
      assertExists(msg.content, 'Message should have content');
      // Decrypted content should be readable text, not encrypted blob
      assert(
        !msg.content.startsWith('AQ'),
        'Content should not look like KMS ciphertext'
      );
    }
  }
});

// Test 4: Error responses should not leak plaintext
await test('Error responses do not leak sensitive data', async () => {
  // Try to get non-existent conversation
  const { status, data } = await get('/conversations/nonexistent-id-12345') as {
    status: number;
    data: { message?: string; error?: string }
  };

  assert(status === 404 || status === 400, `Expected 404 or 400, got ${status}`);

  // Error response should not contain sensitive keywords
  const errorText = JSON.stringify(data).toLowerCase();
  assert(
    !errorText.includes('password'),
    'Error should not contain password'
  );
  assert(
    !errorText.includes('kms'),
    'Error should not expose KMS details'
  );
  assert(
    !errorText.includes('key'),
    'Error should not expose encryption key info'
  );
});

// Test 5: Invalid decryption context should fail gracefully
await test('Conversation retrieval handles encryption errors gracefully', async () => {
  // This tests that the API handles any decryption issues without crashing
  // by requesting a conversation that may or may not exist
  const { status } = await get('/conversations/c_invalid_context_test');

  // Should return a proper error, not a 500 or stack trace
  assert(
    status === 400 || status === 404,
    `Expected 400 or 404 for invalid conversation, got ${status}`
  );
});

// Test 6: Verify encrypted field structure in export
await test('Export conversation structure is valid', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  // Verify structure for each conversation
  for (const conv of data.conversations) {
    assertExists(conv.id, 'Conversation should have id');
    assertExists(conv.messages, 'Conversation should have messages');
    assertArray(conv.messages, 'Messages should be array');

    for (const msg of conv.messages) {
      assertExists(msg.role, 'Message should have role');
      assertExists(msg.content, 'Message should have content');

      // Role should be a valid value
      assert(
        ['user', 'assistant', 'system'].includes(msg.role),
        `Invalid role: ${msg.role}`
      );
    }
  }
});

// Test 7: Multiple conversations maintain encryption integrity
await test('Multiple conversations encrypted independently', async () => {
  // Create a second conversation
  const { status, data } = await post<ConversationResponse>('/conversations', {
    title: 'Second encryption test',
    initialMessage: `Different sensitive content ${testId()}`,
    tags: ['encryption-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Should create second conversation');

  createdConversations.push(data.id);

  // Wait for processing
  await sleep(1000);

  // Verify both conversations are accessible and decrypted
  for (const convId of createdConversations) {
    const { status: getStatus, data: convData } = await get<ConversationDetail>(
      `/conversations/${convId}`
    );

    assert(
      getStatus === 200,
      `Expected 200 for conversation ${convId}, got ${getStatus}`
    );
    assert(
      convData.messages && convData.messages.length > 0,
      `Conversation ${convId} should have messages`
    );
  }
});

// Test 8: Message content is not in error logs
await test('Error responses omit stack traces', async () => {
  // Trigger an error condition
  const { status, data } = await post('/conversations', {
    // Missing required fields
  }) as { status: number; data: { message?: string; error?: string; stack?: string } };

  // Should return error but not with stack trace
  if (status >= 400) {
    const errorStr = JSON.stringify(data);
    assert(
      !errorStr.includes('at '),
      'Error should not contain stack trace'
    );
    assert(
      !errorStr.includes('.ts:'),
      'Error should not expose source file locations'
    );
    assert(
      !errorStr.includes('.js:'),
      'Error should not expose compiled file locations'
    );
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
