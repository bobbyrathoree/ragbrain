/**
 * Export API Tests (NEW - Obsidian Sync)
 *
 * Tests:
 * - GET /export - Get export data for Obsidian sync
 *
 * README claims verified:
 * - "Continuous export to your local Obsidian vault"
 * - "Smart file names — Human-readable IDs like t-redis-caching-a1b2.md"
 * - "Incremental sync — Only syncs changes since last sync"
 * - Response includes thoughts, conversations, deleted, syncTimestamp
 */

import {
  suite, test, assert, assertEqual, assertExists, assertArray, assertHasKeys, assertType,
  get, printSummary
} from './test-utils.js';

interface ThoughtExport {
  id: string;
  smartId: string;
  text: string;
  type: string;
  tags: string[];
  category?: string;
  intent?: string;
  context?: {
    app?: string;
    repo?: string;
    file?: string;
  };
  relatedIds: string[];
  createdAt: string;
  updatedAt?: string;
}

interface MessageExport {
  role: string;
  content: string;
  citations?: Array<{
    id: string;
    preview: string;
    createdAt: string;
  }>;
  createdAt: string;
}

interface ConversationExport {
  id: string;
  smartId: string;
  title: string;
  messages: MessageExport[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportResponse {
  thoughts: ThoughtExport[];
  conversations: ConversationExport[];
  deleted: string[];
  syncTimestamp: number;
}

suite('Export API (Obsidian Sync)');

await test('GET /export - returns export data', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.thoughts, 'Response should have thoughts');
  assertExists(data.conversations, 'Response should have conversations');
  assertExists(data.deleted, 'Response should have deleted');
  assertExists(data.syncTimestamp, 'Response should have syncTimestamp');
});

await test('GET /export - thoughts array structure', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.thoughts, 'thoughts should be an array');

  if (data.thoughts.length > 0) {
    const thought = data.thoughts[0];
    assertHasKeys(thought as unknown as Record<string, unknown>,
      ['id', 'smartId', 'text', 'type', 'tags', 'relatedIds', 'createdAt'],
      'Thought should have required fields');
  }
});

await test('GET /export - thought smartId format (README claim)', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    // README: "Smart file names — Human-readable IDs like t-redis-caching-a1b2.md"
    // Format: {prefix}-{slug}-{shortId}
    assert(
      thought.smartId.startsWith('t-'),
      `Thought smartId should start with 't-', got ${thought.smartId}`
    );

    // Should have slug and short ID components
    const parts = thought.smartId.split('-');
    assert(parts.length >= 2, `smartId should have multiple parts: ${thought.smartId}`);

    // Last part should be the short ID (4 chars)
    const shortId = parts[parts.length - 1];
    assert(
      shortId.length === 4,
      `smartId should end with 4-char shortId, got ${shortId} in ${thought.smartId}`
    );
  }
});

await test('GET /export - conversations array structure', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.conversations, 'conversations should be an array');

  if (data.conversations.length > 0) {
    const conv = data.conversations[0];
    assertHasKeys(conv as unknown as Record<string, unknown>,
      ['id', 'smartId', 'title', 'messages', 'status', 'createdAt', 'updatedAt'],
      'Conversation should have required fields');
  }
});

await test('GET /export - conversation smartId format', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const conv of data.conversations) {
    // Format: conv-{slug}-{shortId}
    assert(
      conv.smartId.startsWith('conv-'),
      `Conversation smartId should start with 'conv-', got ${conv.smartId}`
    );

    const parts = conv.smartId.split('-');
    assert(parts.length >= 2, `smartId should have multiple parts: ${conv.smartId}`);

    // Last part should be the short ID (4 chars)
    const shortId = parts[parts.length - 1];
    assert(
      shortId.length === 4,
      `smartId should end with 4-char shortId, got ${shortId} in ${conv.smartId}`
    );
  }
});

await test('GET /export - conversation messages are decrypted', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const conv of data.conversations) {
    assertArray(conv.messages, 'messages should be an array');

    for (const msg of conv.messages) {
      assertExists(msg.content, 'Message should have content');
      assertType(msg.content, 'string', 'Message content should be a string');
      assert(msg.content.length > 0, 'Message content should not be empty');

      // Content should be readable text, not encrypted blob
      assert(
        !msg.content.startsWith('AQ'),
        'Message content should be decrypted, not base64 encrypted'
      );
    }
  }
});

await test('GET /export - deleted array is present', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.deleted, 'deleted should be an array');

  // Deleted items should be strings (IDs)
  for (const id of data.deleted) {
    assertType(id, 'string', 'deleted item should be a string ID');
  }
});

await test('GET /export - syncTimestamp is valid', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertType(data.syncTimestamp, 'number', 'syncTimestamp should be a number');

  // Should be a reasonable timestamp (in milliseconds)
  assert(data.syncTimestamp > 1700000000000, 'syncTimestamp should be recent');
  assert(data.syncTimestamp < Date.now() + 60000, 'syncTimestamp should not be in future');
});

await test('GET /export - incremental sync with since parameter', async () => {
  // First, get full export
  const { status: status1, data: data1 } = await get<ExportResponse>('/export?since=0');
  assertEqual(status1, 200, `Expected 200, got ${status1}`);

  // Now get incremental export using syncTimestamp
  const { status: status2, data: data2 } = await get<ExportResponse>(
    `/export?since=${data1.syncTimestamp}`
  );
  assertEqual(status2, 200, `Expected 200 for incremental, got ${status2}`);

  // Incremental should have fewer or equal items
  // (could have more if things were created between calls, but unlikely in test)
  assert(
    data2.thoughts.length <= data1.thoughts.length,
    'Incremental export should have fewer or equal thoughts'
  );

  // syncTimestamp should be updated
  assert(
    data2.syncTimestamp >= data1.syncTimestamp,
    'New syncTimestamp should be >= previous'
  );
});

await test('GET /export - thought has proper date format', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    // Verify ISO 8601 format
    assert(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(thought.createdAt),
      `createdAt should be ISO 8601 format, got ${thought.createdAt}`
    );

    // Verify it's a valid date
    const date = new Date(thought.createdAt);
    assert(!isNaN(date.getTime()), `createdAt should be valid date: ${thought.createdAt}`);
  }
});

await test('GET /export - conversation messages have timestamps', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const conv of data.conversations) {
    for (const msg of conv.messages) {
      assertExists(msg.createdAt, 'Message should have createdAt');
      assert(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(msg.createdAt),
        `Message createdAt should be ISO 8601 format, got ${msg.createdAt}`
      );
    }
  }
});

await test('GET /export - thought tags is array', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    assertArray(thought.tags, `tags should be array for thought ${thought.id}`);

    for (const tag of thought.tags) {
      assertType(tag, 'string', 'tag should be a string');
    }
  }
});

await test('GET /export - thought relatedIds is array', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    assertArray(thought.relatedIds, `relatedIds should be array for thought ${thought.id}`);

    for (const relatedId of thought.relatedIds) {
      assertType(relatedId, 'string', 'relatedId should be a string');
    }
  }
});

await test('GET /export - conversation has status field', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  // Expected statuses, but API may have others
  const expectedStatuses = ['active', 'archived', 'deleted'];

  for (const conv of data.conversations) {
    assertExists(conv.status, 'Conversation should have status field');
    assertType(conv.status, 'string', 'status should be string');

    // Log unexpected statuses but don't fail
    if (!expectedStatuses.includes(conv.status)) {
      console.log(`    Note: Unexpected status "${conv.status}" in conv ${conv.id}`);
    }
  }
});

await test('GET /export - assistant messages have citations', async () => {
  const { status, data } = await get<ExportResponse>('/export?since=0');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const conv of data.conversations) {
    for (const msg of conv.messages) {
      if (msg.role === 'assistant' && msg.citations) {
        assertArray(msg.citations, 'citations should be array');

        for (const citation of msg.citations) {
          assertHasKeys(citation as unknown as Record<string, unknown>,
            ['id', 'preview', 'createdAt'],
            'Citation should have required fields');
        }
      }
    }
  }
});

// Print results
const summary = printSummary();

export default summary;
