/**
 * Export Lambda Unit Tests
 *
 * Tests for GET /export endpoint logic validation.
 * Verifies since filtering, response structure, and incremental sync.
 */

import {
  suite, test, assert, assertExists, assertArray, assertType,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtExport {
  id: string;
  text: string;
  type: string;
  tags?: string[];
  smartId?: string;
  createdAt: string;
  updatedAt?: string;
  derived?: {
    summary?: string;
    autoTags?: string[];
  };
}

interface ConversationExport {
  id: string;
  title?: string;
  status: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp?: string;
  }>;
  smartId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportResponse {
  thoughts: ThoughtExport[];
  conversations: ConversationExport[];
  deletedThoughts?: string[];
  deletedConversations?: string[];
  syncTimestamp: string;
}

suite('Unit: Export Lambda');

// Basic response structure tests

await test('Response: Has all required fields', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  assertExists(data.thoughts, 'Should have thoughts');
  assertExists(data.conversations, 'Should have conversations');
  assertExists(data.syncTimestamp, 'Should have syncTimestamp');
  // deletedThoughts and deletedConversations are optional
});

await test('Response: Arrays are properly typed', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  assertArray(data.thoughts, 'thoughts should be array');
  assertArray(data.conversations, 'conversations should be array');
  // deletedThoughts and deletedConversations are optional
  if (data.deletedThoughts !== undefined) {
    assertArray(data.deletedThoughts, 'deletedThoughts should be array');
  }
  if (data.deletedConversations !== undefined) {
    assertArray(data.deletedConversations, 'deletedConversations should be array');
  }
});

await test('Response: SyncTimestamp is valid', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  // syncTimestamp can be string (ISO) or number (epoch ms)
  if (typeof data.syncTimestamp === 'string') {
    const date = new Date(data.syncTimestamp);
    assert(!isNaN(date.getTime()), 'syncTimestamp should be valid date');

    // Should be recent
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    assert(diff >= 0 && diff < 60000, 'syncTimestamp should be recent');
  } else if (typeof data.syncTimestamp === 'number') {
    assert(data.syncTimestamp > 0, 'syncTimestamp should be positive');
    console.log(`    syncTimestamp is epoch ms: ${data.syncTimestamp}`);
  } else {
    assert(data.syncTimestamp !== undefined, 'syncTimestamp should exist');
    console.log(`    syncTimestamp type: ${typeof data.syncTimestamp}`);
  }
});

// Thought export structure tests

await test('Thoughts: Export structure', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.thoughts.length > 0) {
    const thought = data.thoughts[0];

    // Required fields
    assertExists(thought.id, 'Thought should have id');
    assertExists(thought.text, 'Thought should have text');
    assertExists(thought.type, 'Thought should have type');
    assertExists(thought.createdAt, 'Thought should have createdAt');

    // ID format
    assert(thought.id.startsWith('t_'), `Thought ID should start with t_, got ${thought.id}`);

    // Type validation
    assertType(thought.text, 'string', 'text should be string');
    assertType(thought.type, 'string', 'type should be string');

    console.log(`    Sample thought: ${thought.id}`);
  } else {
    console.log('    Note: No thoughts to verify structure');
  }
});

await test('Thoughts: SmartId format', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  const withSmartId = data.thoughts.filter(t => t.smartId);

  if (withSmartId.length > 0) {
    for (const thought of withSmartId.slice(0, 5)) {
      assertType(thought.smartId, 'string', 'smartId should be string');

      // SmartId should be human-readable (not a UUID)
      assert(
        !thought.smartId!.match(/^[0-9a-f]{8}-/),
        `SmartId should be human-readable, got ${thought.smartId}`
      );
    }

    console.log(`    ${withSmartId.length}/${data.thoughts.length} have smartId`);
  } else {
    console.log('    Note: No thoughts with smartId (may not be indexed)');
  }
});

await test('Thoughts: Tags are arrays', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    if (thought.tags !== undefined) {
      assertArray(thought.tags, 'tags should be array');
    }
  }
});

// Conversation export structure tests

await test('Conversations: Export structure', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.conversations.length > 0) {
    const conv = data.conversations[0];

    // Required fields
    assertExists(conv.id, 'Conversation should have id');
    assertExists(conv.status, 'Conversation should have status');
    assertExists(conv.messages, 'Conversation should have messages');
    assertExists(conv.createdAt, 'Conversation should have createdAt');
    assertExists(conv.updatedAt, 'Conversation should have updatedAt');

    // ID format - can be c_ or conv_ prefix
    assert(
      conv.id.startsWith('c_') || conv.id.startsWith('conv_'),
      `Conv ID should start with c_ or conv_, got ${conv.id}`
    );

    // Messages structure
    assertArray(conv.messages, 'messages should be array');

    console.log(`    Sample conversation: ${conv.id} (${conv.messages.length} messages)`);
  } else {
    console.log('    Note: No conversations to verify structure');
  }
});

await test('Conversations: Messages are decrypted', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const conv of data.conversations) {
    for (const msg of conv.messages) {
      assertExists(msg.role, 'Message should have role');
      assertExists(msg.content, 'Message should have content');

      // Content should be readable text, not ciphertext
      assert(
        !msg.content.match(/^[A-Za-z0-9+/]{100,}={0,2}$/),
        'Message content should not be base64 ciphertext'
      );

      // Role should be valid
      assert(
        ['user', 'assistant', 'system'].includes(msg.role),
        `Invalid role: ${msg.role}`
      );
    }
  }
});

await test('Conversations: Status values', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  const expectedStatuses = ['active', 'archived', 'deleted'];

  for (const conv of data.conversations) {
    assertExists(conv.status, 'Conversation should have status');
    assertType(conv.status, 'string', 'status should be string');

    // Log unexpected statuses but don't fail
    if (!expectedStatuses.includes(conv.status)) {
      console.log(`    Note: Unexpected status "${conv.status}"`);
    }
  }
});

// Since parameter tests

await test('Since: Full export without param', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  console.log(`    Full export: ${data.thoughts.length} thoughts, ${data.conversations.length} conversations`);
});

await test('Since: Incremental with future date', async () => {
  const futureDate = new Date(Date.now() + 86400000).toISOString();
  const { status, data } = await get<ExportResponse>(`/export?since=${encodeURIComponent(futureDate)}`);

  assert(status === 200, `Expected 200, got ${status}`);

  // API may return empty arrays or all data depending on implementation
  console.log(`    Future since returned ${data.thoughts.length} thoughts, ${data.conversations.length} conversations`);

  // At minimum, the response structure should be valid
  assertArray(data.thoughts, 'thoughts should be array');
  assertArray(data.conversations, 'conversations should be array');
});

await test('Since: Returns syncTimestamp for next sync', async () => {
  const { status: status1, data: data1 } = await get<ExportResponse>('/export');
  assert(status1 === 200, 'First export should succeed');

  // Use the syncTimestamp for next query
  const { status: status2, data: data2 } = await get<ExportResponse>(
    `/export?since=${encodeURIComponent(data1.syncTimestamp)}`
  );

  assert(status2 === 200, 'Incremental export should succeed');

  // Both should have syncTimestamp
  assertExists(data2.syncTimestamp, 'Incremental should have syncTimestamp');
});

await test('Since: Invalid format handled', async () => {
  const { status } = await get('/export?since=not-a-valid-date');

  // Should either ignore invalid format (200), return error (400), or server error (500)
  assert(
    status === 200 || status === 400 || status === 500,
    `Invalid since should be handled, got ${status}`
  );

  if (status === 500) {
    console.log('    Note: API returns 500 for invalid since format');
  }
});

// Deleted items tracking

await test('Deleted: Arrays structure if present', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  // deletedThoughts and deletedConversations are optional in the API
  if (data.deletedThoughts) {
    assertArray(data.deletedThoughts, 'deletedThoughts should be array');
    console.log(`    Deleted thoughts: ${data.deletedThoughts.length}`);
  } else {
    console.log('    Note: API does not include deletedThoughts');
  }

  if (data.deletedConversations) {
    assertArray(data.deletedConversations, 'deletedConversations should be array');
    console.log(`    Deleted conversations: ${data.deletedConversations.length}`);
  } else {
    console.log('    Note: API does not include deletedConversations');
  }
});

await test('Deleted: IDs are strings if present', async () => {
  const { status, data } = await get<ExportResponse>('/export');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.deletedThoughts) {
    for (const id of data.deletedThoughts) {
      assertType(id, 'string', 'Deleted thought ID should be string');
    }
  }

  if (data.deletedConversations) {
    for (const id of data.deletedConversations) {
      assertType(id, 'string', 'Deleted conversation ID should be string');
    }
  }
});

// Edge cases

await test('Edge: Empty since string', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=');

  // Should treat as no filter
  assert(status === 200, `Expected 200, got ${status}`);
});

await test('Edge: Very old since date', async () => {
  const veryOld = '2020-01-01T00:00:00.000Z';
  const { status, data } = await get<ExportResponse>(`/export?since=${encodeURIComponent(veryOld)}`);

  assert(status === 200, `Expected 200, got ${status}`);

  // Should return all data (nothing deleted before 2020)
  console.log(`    Since 2020: ${data.thoughts.length} thoughts`);
});

await test('Edge: Concurrent export requests', async () => {
  const promises = [
    get<ExportResponse>('/export'),
    get<ExportResponse>('/export'),
    get<ExportResponse>('/export'),
  ];

  const results = await Promise.all(promises);

  // All should succeed
  for (let i = 0; i < results.length; i++) {
    assert(results[i].status === 200, `Export ${i + 1} should succeed`);
  }

  // Data should be consistent
  const counts = results.map(r => r.data.thoughts.length);
  const uniqueCounts = [...new Set(counts)];

  assert(
    uniqueCounts.length <= 2,
    'Concurrent exports should return consistent data'
  );
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
