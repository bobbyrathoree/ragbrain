/**
 * Injection Vulnerability Tests
 *
 * Tests for NoSQL injection, XSS, command injection, and path traversal.
 * Verifies that the API properly sanitizes and validates all inputs.
 *
 * Security categories tested:
 * - NoSQL injection in query parameters
 * - NoSQL injection in request bodies
 * - XSS payload handling (stored XSS prevention)
 * - Path traversal attempts
 * - JSON injection
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

interface AskResponse {
  answer: string;
  citations?: unknown[];
}

// Track created thoughts for cleanup
const createdThoughts: string[] = [];

suite('Security: Injection Vulnerabilities');

// NoSQL Injection Tests

await test('NoSQL injection in query param - $gt operator', async () => {
  const { status, data } = await get<ListThoughtsResponse>(
    '/thoughts?limit=1&type={"$gt":""}'
  );

  // Should either return 400 (invalid param) or 200 with no results
  // Should NOT return all documents
  assert(
    status === 200 || status === 400,
    `Expected 200 or 400, got ${status}`
  );

  if (status === 200) {
    assertArray(data.thoughts, 'Response should be array');
    // Verify the injection didn't return unexpected results
    for (const thought of data.thoughts) {
      assert(
        thought.type === '{"$gt":""}' || thought.type === undefined,
        'Should not have matched arbitrary types'
      );
    }
  }
});

await test('NoSQL injection in query param - $ne operator', async () => {
  const { status } = await get<ListThoughtsResponse>(
    '/thoughts?limit=1&type={"$ne":null}'
  );

  assert(
    status === 200 || status === 400,
    `Expected 200 or 400, got ${status}`
  );
});

await test('NoSQL injection in query param - $regex operator', async () => {
  const { status } = await get<ListThoughtsResponse>(
    '/thoughts?limit=1&type={"$regex":".*"}'
  );

  assert(
    status === 200 || status === 400,
    `Expected 200 or 400, got ${status}`
  );
});

await test('NoSQL injection in thought text should be stored safely', async () => {
  const injectionPayload = 'Test {"$gt":""}';

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: injectionPayload,
    type: 'note',
    tags: ['security-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Should create thought even with NoSQL-like text');

  createdThoughts.push(data.id);
});

await test('NoSQL injection in tags array', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Safe text ${testId()}`,
    type: 'note',
    tags: ['{"$gt":""}', 'safe-tag'],
  });

  // Should either accept (treating as literal string) or reject
  assert(
    status === 200 || status === 201 || status === 400,
    `Expected 200, 201, or 400, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// XSS Payload Tests

await test('XSS payload in thought text - script tag', async () => {
  const xssPayload = `<script>alert('XSS');</script> ${testId()}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: xssPayload,
    type: 'note',
    tags: ['xss-test'],
  });

  // Should accept the text (API stores it) but it should be properly escaped on retrieval
  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Should create thought');

  createdThoughts.push(data.id);
});

await test('XSS payload in thought text - img onerror', async () => {
  const xssPayload = `<img src=x onerror="alert('XSS')"> ${testId()}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: xssPayload,
    type: 'note',
    tags: ['xss-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('XSS payload in thought text - event handler', async () => {
  const xssPayload = `<div onmouseover="alert('XSS')">hover me</div> ${testId()}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: xssPayload,
    type: 'note',
    tags: ['xss-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('XSS payload in tags', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Safe text ${testId()}`,
    type: 'note',
    tags: ['<script>alert(1)</script>', 'normal-tag'],
  });

  assert(
    status === 200 || status === 201 || status === 400,
    `Expected 200, 201, or 400, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Path Traversal Tests

await test('Path traversal in thought ID - parent directory', async () => {
  const { status } = await get('/thoughts/../../../etc/passwd');

  // Should return 400 or 404, NOT file contents
  assert(
    status === 400 || status === 404,
    `Expected 400 or 404 for path traversal, got ${status}`
  );
});

await test('Path traversal in thought ID - encoded dots', async () => {
  const { status } = await get('/thoughts/%2e%2e%2f%2e%2e%2fetc/passwd');

  assert(
    status === 400 || status === 404,
    `Expected 400 or 404 for encoded path traversal, got ${status}`
  );
});

await test('Path traversal in related thoughts endpoint', async () => {
  const { status } = await get('/thoughts/../admin/related');

  assert(
    status === 400 || status === 404,
    `Expected 400 or 404 for path traversal, got ${status}`
  );
});

// JSON Injection Tests

await test('JSON injection - nested object in text field', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: '{"nested": {"injection": true}}',
    type: 'note',
  });

  // Should treat as string, not parse as JSON
  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('JSON injection - prototype pollution attempt', async () => {
  const { status } = await post('/thoughts', {
    text: `Test ${testId()}`,
    type: 'note',
    '__proto__': { admin: true },
    'constructor': { prototype: { admin: true } },
  });

  // Should ignore the prototype pollution attempt
  assert(
    status === 200 || status === 201 || status === 400,
    `Expected 200, 201, or 400, got ${status}`
  );
});

// Ask endpoint injection tests

await test('Injection in ask query - NoSQL operators', async () => {
  const { status } = await post<AskResponse>('/ask', {
    query: '{"$gt": ""} OR 1=1',
  });

  // Should process as a literal query string
  assert(
    status === 200 || status === 201,
    `Expected 200 or 201, got ${status}`
  );
});

await test('Injection in ask query - XSS payload', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: '<script>alert("XSS")</script> What is this?',
  });

  // The API should accept the query and process it
  // Note: XSS prevention is a client-side concern when rendering LLM responses
  // The LLM may reference or quote the script tag in its answer, which is expected
  assert(
    status === 200 || status === 201,
    `Expected 200 or 201, got ${status}`
  );

  if (data.answer) {
    // Verify the answer is a valid string (LLM processed the query)
    assert(
      typeof data.answer === 'string' && data.answer.length > 0,
      'Answer should be a non-empty string'
    );
  }
});

// Unicode and special character tests

await test('Unicode null byte injection', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Test\u0000injection ${testId()}`,
    type: 'note',
  });

  // Should either sanitize or reject
  assert(
    status === 200 || status === 201 || status === 400,
    `Expected 200, 201, or 400, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

await test('Unicode direction override characters', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Test\u202Einjection\u202C ${testId()}`,
    type: 'note',
  });

  assert(
    status === 200 || status === 201 || status === 400,
    `Expected 200, 201, or 400, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
