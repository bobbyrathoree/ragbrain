/**
 * Capture Lambda Unit Tests
 *
 * Tests for capture endpoint (POST /thoughts) logic validation.
 * Verifies input validation, response structure, and edge cases.
 *
 * Without mocking, these tests verify behavior through the API layer.
 */

import {
  suite, test, assert, assertExists, assertType, assertHasKeys,
  post, get, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ThoughtDetail {
  id: string;
  text: string;
  type: string;
  tags?: string[];
  context?: {
    app?: string;
    repo?: string;
    file?: string;
    branch?: string;
  };
  createdAt: string;
}

interface ListThoughtsResponse {
  thoughts: ThoughtDetail[];
}

// Track created thoughts
const createdThoughts: string[] = [];

suite('Unit: Capture Lambda');

// Input validation tests

await test('Validation: Requires text field', async () => {
  const { status } = await post('/thoughts', {
    type: 'note',
    tags: ['test'],
  });

  assert(
    status >= 400,
    `Missing text should return error, got ${status}`
  );
});

await test('Validation: Rejects empty text', async () => {
  const { status } = await post('/thoughts', {
    text: '',
    type: 'note',
  });

  assert(
    status >= 400,
    `Empty text should return error, got ${status}`
  );
});

await test('Validation: Accepts valid types', async () => {
  const validTypes = ['note', 'code', 'decision', 'link', 'todo'];

  for (const type of validTypes) {
    const { status, data } = await post<ThoughtResponse>('/thoughts', {
      text: `Type validation test ${testId()} - ${type}`,
      type,
    });

    assert(
      status === 200 || status === 201,
      `Type "${type}" should be accepted, got ${status}`
    );

    if (data.id) {
      createdThoughts.push(data.id);
    }
  }
});

await test('Validation: Handles unknown type gracefully', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Unknown type test ${testId()}`,
    type: 'unknown_type_xyz',
  });

  // Should either accept (defaulting to note) or reject with 400
  assert(
    status === 200 || status === 201 || status === 400,
    `Unknown type should be handled, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Validation: Tags must be array', async () => {
  // Valid array tags
  const { status: validStatus, data: validData } = await post<ThoughtResponse>('/thoughts', {
    text: `Tags array test ${testId()}`,
    type: 'note',
    tags: ['tag1', 'tag2'],
  });

  assert(
    validStatus === 200 || validStatus === 201,
    `Array tags should be accepted, got ${validStatus}`
  );

  if (validData.id) {
    createdThoughts.push(validData.id);
  }
});

await test('Validation: Empty tags array is valid', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Empty tags test ${testId()}`,
    type: 'note',
    tags: [],
  });

  assert(
    status === 200 || status === 201,
    `Empty tags array should be accepted, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Response structure tests

await test('Response: ID format starts with t_', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `ID format test ${testId()}`,
    type: 'note',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Response should have id');
  assert(
    data.id.startsWith('t_'),
    `ID should start with t_, got ${data.id}`
  );

  createdThoughts.push(data.id);
});

await test('Response: Includes createdAt timestamp', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Timestamp test ${testId()}`,
    type: 'note',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.createdAt, 'Response should have createdAt');
  assertType(data.createdAt, 'string', 'createdAt should be string');

  // Should be ISO format
  assert(
    data.createdAt.includes('T'),
    `createdAt should be ISO format, got ${data.createdAt}`
  );

  createdThoughts.push(data.id);
});

await test('Response: createdAt is valid ISO timestamp', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `ISO timestamp test ${testId()}`,
    type: 'note',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  // Parse timestamp
  const date = new Date(data.createdAt);
  assert(
    !isNaN(date.getTime()),
    `createdAt should be parseable date, got ${data.createdAt}`
  );

  // Should be recent (within last minute)
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  assert(
    diff >= 0 && diff < 60000,
    `createdAt should be recent, diff: ${diff}ms`
  );

  createdThoughts.push(data.id);
});

// Context handling tests

await test('Context: Accepts valid context object', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Context test ${testId()}`,
    type: 'note',
    context: {
      app: 'VSCode',
      repo: 'ragbrain',
      file: 'src/test.ts',
      branch: 'main',
    },
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should create thought with context');

  createdThoughts.push(data.id);
});

await test('Context: Handles partial context', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Partial context test ${testId()}`,
    type: 'note',
    context: {
      app: 'Terminal',
      // Other fields omitted
    },
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should accept partial context');

  createdThoughts.push(data.id);
});

await test('Context: Handles empty context object', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Empty context test ${testId()}`,
    type: 'note',
    context: {},
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Edge cases

await test('Edge: Very long text', async () => {
  const longText = `Long text test ${testId()}: ${'x'.repeat(5000)}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: longText,
    type: 'note',
  });

  assert(
    status === 200 || status === 201 || status === 400,
    `Long text should be handled, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Edge: Unicode characters', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Unicode test ${testId()}: 你好世界 🎉 αβγ`,
    type: 'note',
    tags: ['unicode', '测试'],
  });

  // API may accept unicode or reject it with 400
  assert(
    status === 200 || status === 201 || status === 400,
    `Unicode should be handled, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Edge: Special characters in text', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Special chars test ${testId()}: <>&"'`,
    type: 'note',
  });

  assert(status === 200 || status === 201, `Special chars should be handled, got ${status}`);

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Edge: Multiline text', async () => {
  const multilineText = `Multiline test ${testId()}:
Line 1
Line 2
Line 3

With blank line above.`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: multilineText,
    type: 'note',
  });

  assert(status === 200 || status === 201, `Multiline should be accepted, got ${status}`);

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Edge: Many tags', async () => {
  const manyTags = Array(20).fill(null).map((_, i) => `tag-${i}`);

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Many tags test ${testId()}`,
    type: 'note',
    tags: manyTags,
  });

  assert(
    status === 200 || status === 201 || status === 400,
    `Many tags should be handled, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Verify stored data matches input

await test('Storage: Created thought is retrievable', async () => {
  const uniqueText = `Retrieval test ${testId()} - unique content for verification`;

  const { status: createStatus, data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueText,
    type: 'decision',
    tags: ['retrieval-test'],
  });

  assert(createStatus === 200 || createStatus === 201, 'Create should succeed');
  createdThoughts.push(createData.id);

  // Wait for storage
  await sleep(1000);

  // Retrieve the thought
  const { status: listStatus, data: listData } = await get<ListThoughtsResponse>(
    `/thoughts?tag=retrieval-test&limit=10`
  );

  assert(listStatus === 200, 'List should succeed');

  const found = listData.thoughts.find(t => t.id === createData.id);
  assert(found !== undefined, 'Created thought should be retrievable');

  if (found) {
    assert(
      found.text === uniqueText,
      'Retrieved text should match input'
    );
    assert(
      found.type === 'decision',
      'Retrieved type should match input'
    );
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
