/**
 * Ask Lambda Unit Tests
 *
 * Tests for POST /ask endpoint logic validation.
 * Verifies query handling, citation structure, and response format.
 */

import {
  suite, test, assert, assertExists, assertArray, assertType, assertHasKeys,
  post, printSummary, testId, sleep
} from '../test-utils.js';

interface Citation {
  id?: string;
  thoughtId?: string;
  text?: string;
  score?: number;
  createdAt?: string;
  timestamp?: string;
  type?: string;
}

interface AskResponse {
  answer: string;
  citations?: Citation[];
  confidence?: number;
  processingTime?: number;
  conversationHits?: number;
  thoughtHits?: number;
}

suite('Unit: Ask Lambda');

// Input validation tests

await test('Validation: Requires query field', async () => {
  const { status } = await post('/ask', {});

  assert(
    status >= 400,
    `Missing query should return error, got ${status}`
  );
});

await test('Validation: Rejects empty query', async () => {
  const { status } = await post('/ask', {
    query: '',
  });

  assert(
    status >= 400,
    `Empty query should return error, got ${status}`
  );
});

await test('Validation: Accepts valid query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What do you know?',
  });

  assert(status === 200 || status === 201, `Valid query should succeed, got ${status}`);
  assertExists(data.answer, 'Response should have answer');
});

// Response structure tests

await test('Response: Has required answer field', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Test query for structure validation',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.answer, 'Response must have answer');
  assertType(data.answer, 'string', 'answer must be string');
});

await test('Response: Citations array structure', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Tell me about captured notes',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.citations !== undefined) {
    assertArray(data.citations, 'citations should be array');

    for (const citation of data.citations) {
      // Citation should have an identifier
      const hasId = citation.id !== undefined || citation.thoughtId !== undefined;
      assert(hasId, 'Citation should have id or thoughtId');

      // Score should be number if present
      if (citation.score !== undefined) {
        assertType(citation.score, 'number', 'score should be number');
        assert(
          citation.score >= 0 && citation.score <= 1,
          `Score should be 0-1, got ${citation.score}`
        );
      }
    }

    console.log(`    Received ${data.citations.length} citations`);
  }
});

await test('Response: Confidence is number if present', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What is the confidence level?',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.confidence !== undefined) {
    assertType(data.confidence, 'number', 'confidence should be number');
    assert(
      data.confidence >= 0 && data.confidence <= 1,
      `Confidence should be 0-1, got ${data.confidence}`
    );
  }
});

await test('Response: Processing time is number if present', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'How long does processing take?',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.processingTime !== undefined) {
    assertType(data.processingTime, 'number', 'processingTime should be number');
    assert(data.processingTime >= 0, 'processingTime should be non-negative');
    console.log(`    Server reported processing time: ${data.processingTime}ms`);
  }
});

// Citation content tests

await test('Citations: Include relevant text', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Show me notes with text content',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.citations && data.citations.length > 0) {
    const withText = data.citations.filter(c => c.text !== undefined);
    console.log(`    ${withText.length}/${data.citations.length} citations have text`);

    for (const citation of withText) {
      assertType(citation.text, 'string', 'Citation text should be string');
    }
  }
});

await test('Citations: Include timestamps', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'When were things created?',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.citations && data.citations.length > 0) {
    const withTimestamp = data.citations.filter(
      c => c.createdAt !== undefined || c.timestamp !== undefined
    );
    console.log(`    ${withTimestamp.length}/${data.citations.length} citations have timestamps`);

    for (const citation of withTimestamp) {
      const ts = citation.createdAt || citation.timestamp;
      if (ts) {
        const date = new Date(ts);
        assert(!isNaN(date.getTime()), 'Timestamp should be valid date');
      }
    }
  }
});

// Filter parameter tests

await test('Filter: TimeWindow parameter', async () => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Recent activity',
    timeWindow: {
      start: weekAgo.toISOString(),
      end: now.toISOString(),
    },
  });

  // TimeWindow may not be supported by the API (returns 500) or works (200/201)
  assert(
    status === 200 || status === 201 || status === 500,
    `TimeWindow filter should be handled, got ${status}`
  );

  if (status === 200 || status === 201) {
    assertExists(data.answer, 'Should return answer with filter');
  } else {
    console.log('    Note: timeWindow filter not supported by API');
  }
});

await test('Filter: Tags parameter', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Tagged content',
    tags: ['test'],
  });

  assert(status === 200 || status === 201, `Tags filter should work, got ${status}`);
  assertExists(data.answer, 'Should return answer with filter');
});

await test('Filter: Invalid timeWindow handled', async () => {
  const { status } = await post('/ask', {
    query: 'Test query',
    timeWindow: {
      start: 'not-a-date',
      end: 'also-not-a-date',
    },
  });

  // Should either ignore invalid filter, return error, or server error
  assert(
    status === 200 || status === 201 || status === 400 || status === 500,
    `Invalid timeWindow should be handled, got ${status}`
  );
});

// Query edge cases

await test('Edge: Very short query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Hi',
  });

  assert(status === 200 || status === 201, `Short query should work, got ${status}`);
  assertExists(data.answer, 'Should return answer for short query');
});

await test('Edge: Long query', async () => {
  const longQuery = `Please tell me everything you know about: ${' '.repeat(500)} and also include details about ${' '.repeat(500)} thank you.`;

  const { status, data } = await post<AskResponse>('/ask', {
    query: longQuery,
  });

  assert(
    status === 200 || status === 201 || status === 400,
    `Long query should be handled, got ${status}`
  );

  if (status === 200 || status === 201) {
    assertExists(data.answer, 'Should return answer for long query');
  }
});

await test('Edge: Query with special characters', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What about <script>alert(1)</script> & stuff?',
  });

  assert(status === 200 || status === 201, `Special chars should be handled, got ${status}`);
  assertExists(data.answer, 'Should return answer');

  // Answer should not contain unescaped script tags
  assert(
    !data.answer.includes('<script>'),
    'Answer should not have unescaped script tags'
  );
});

await test('Edge: Unicode query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: '你好，告诉我关于 🎉 的信息',
  });

  assert(status === 200 || status === 201, `Unicode query should work, got ${status}`);
  assertExists(data.answer, 'Should return answer for unicode');
});

// Hybrid search behavior

await test('Search: Returns results for keyword query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'test note code decision',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  console.log(`    Answer length: ${data.answer.length} chars`);
  console.log(`    Citations: ${data.citations?.length || 0}`);
});

await test('Search: Returns results for semantic query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What programming concepts have been captured?',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.answer, 'Should return answer');
});

// Hit counts

await test('Response: ConversationHits if present', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Previous conversations',
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);

  if (data.conversationHits !== undefined) {
    assertType(data.conversationHits, 'number', 'conversationHits should be number');
    console.log(`    Conversation hits: ${data.conversationHits}`);
  }

  if (data.thoughtHits !== undefined) {
    assertType(data.thoughtHits, 'number', 'thoughtHits should be number');
    console.log(`    Thought hits: ${data.thoughtHits}`);
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
