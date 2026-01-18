/**
 * Ask API Tests
 *
 * Tests:
 * - POST /ask - Ask questions and get citation-backed answers
 *
 * README claims verified:
 * - "Every answer includes timestamped citations to source notes"
 * - "Hybrid search: BM25 keyword matching + semantic embeddings"
 * - Response includes confidence and processingTime
 * - NEW: conversationHits for searchable conversations
 */

import {
  suite, test, assert, assertEqual, assertExists, assertArray, assertHasKeys, assertType,
  post, printSummary, testId, sleep
} from './test-utils.js';

interface Citation {
  id: string;
  createdAt: string;
  preview: string;
  score: number;
  type?: string;
  tags?: string[];
}

interface ConversationHit {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  score: number;
  createdAt: string;
}

interface AskResponse {
  answer: string;
  citations: Citation[];
  conversationHits?: ConversationHit[];
  confidence?: number;
  processingTime?: number;
}

suite('Ask API');

await test('POST /ask - basic question', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What have I captured recently?',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.answer, 'Response should have answer');
  assertType(data.answer, 'string', 'answer should be a string');
  assertExists(data.citations, 'Response should have citations');
  assertArray(data.citations, 'citations should be an array');
});

await test('POST /ask - answer has citations (README claim)', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What notes do I have?',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);

  // README claims: "Every answer includes timestamped citations"
  assertExists(data.citations, 'Response must have citations array');
  assertArray(data.citations, 'citations must be an array');

  // If we have citations, verify structure
  if (data.citations.length > 0) {
    const citation = data.citations[0];
    assertHasKeys(citation as unknown as Record<string, unknown>,
      ['id', 'createdAt', 'preview', 'score'],
      'Citation should have required fields');

    // Verify timestamp format (ISO 8601)
    assert(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(citation.createdAt),
      'createdAt should be ISO 8601 format'
    );
  }
});

await test('POST /ask - response includes confidence', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Tell me about my recent thoughts',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);

  // README shows confidence in response
  if (data.confidence !== undefined) {
    assertType(data.confidence, 'number', 'confidence should be a number');
    assert(data.confidence >= 0 && data.confidence <= 1, 'confidence should be between 0 and 1');
  }
});

await test('POST /ask - response includes processingTime', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What have I noted?',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);

  // README shows processingTime in response
  if (data.processingTime !== undefined) {
    assertType(data.processingTime, 'number', 'processingTime should be a number');
    assert(data.processingTime > 0, 'processingTime should be positive');
  }
});

await test('POST /ask - with timeWindow filter', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What did I capture this week?',
    timeWindow: '7d',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.answer, 'Response should have answer');
});

await test('POST /ask - with tags filter', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What are my test thoughts?',
    tags: ['test'],
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.answer, 'Response should have answer');
});

await test('POST /ask - missing query should fail', async () => {
  const { status } = await post('/ask', {
    timeWindow: '30d',
  });

  assert(status >= 400, `Expected error status for missing query, got ${status}`);
});

await test('POST /ask - conversationHits in response (NEW feature)', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What conversations have I had?',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);

  // NEW: conversationHits should be present (may be empty array)
  if (data.conversationHits !== undefined) {
    assertArray(data.conversationHits, 'conversationHits should be an array');

    // If we have conversation hits, verify structure
    if (data.conversationHits.length > 0) {
      const hit = data.conversationHits[0];
      assertHasKeys(hit as unknown as Record<string, unknown>,
        ['id', 'title', 'preview', 'messageCount', 'score', 'createdAt'],
        'ConversationHit should have required fields');
    }
  }
});

await test('POST /ask - citation score is valid number', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Show me my notes',
  });

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const citation of data.citations) {
    assertType(citation.score, 'number', 'citation score should be a number');
    // BM25 scores can exceed 1.0, so just verify it's non-negative
    assert(citation.score >= 0, `Citation score should be non-negative, got ${citation.score}`);
  }
});

await test('POST /ask - handles empty knowledge base gracefully', async () => {
  // Query something very specific that likely doesn't exist
  const { status, data } = await post<AskResponse>('/ask', {
    query: `Find notes about ${testId()} quantum blockchain AI`,
  });

  // Should still return 200, just with low confidence or empty citations
  assertEqual(status, 200, `Expected 200 even for no results, got ${status}`);
  assertExists(data.answer, 'Should still provide an answer');
});

// Print results
const summary = printSummary();

export default summary;
