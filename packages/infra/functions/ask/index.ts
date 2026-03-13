import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  AskRequest,
  AskResponse,
  Citation,
  ConversationHit,
} from '@ragbrain/shared';
import {
  createBedrockClient,
  createCloudWatchClient,
  createOpenSearchClient,
  MODELS,
  generateEmbedding,
  hybridSearch,
  scoreAndRank,
  rewriteQuery,
  extractCitations,
  calculateConfidence,
  normalizeScores,
  emitMetrics,
  getAuthUser,
  validationError,
  internalError,
  jsonResponse,
} from '../../lib/shared';
import type { SearchHit } from '../../lib/shared';

const bedrock = createBedrockClient();
const cloudwatch = createCloudWatchClient();
const opensearch = createOpenSearchClient();

const SEARCH_COLLECTION = process.env.SEARCH_COLLECTION!;

// ── Answer Generation ───────────────────────────────────────────

async function generateAnswer(
  query: string,
  context: SearchHit[],
): Promise<{ answer: string; citations: Citation[]; confidence: number }> {
  const contextSnippets = context.slice(0, 6).map((hit, index) => {
    const date = new Date(hit._source.created_at_epoch).toISOString().split('T')[0];
    const preview = hit.highlight?.text?.[0] || hit._source.summary || hit._source.text.substring(0, 150);
    return `[${index + 1}] ${date} - ${preview}`;
  }).join('\n\n');

  const systemPrompt = `You are my memory assistant. Use ONLY the provided notes to answer questions.
Always cite your sources using [1], [2], etc. If the notes don't contain the answer, say so.
Keep answers concise (2-3 sentences max) and directly address the question.`;

  const userPrompt = `Based on these notes, ${query}\n\nNotes:\n${contextSnippets}\n\nAnswer with citations:`;

  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: MODELS.REASONING,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 300,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const answer = result.content[0].text.trim();
    const citations = extractCitations(answer, context);
    const confidence = calculateConfidence(citations);

    return { answer, citations, confidence };
  } catch (error) {
    console.error('Generation error:', error);

    // Extractive fallback
    if (context.length > 0) {
      const top = context[0];
      return {
        answer: `Based on your notes: ${top._source.text.substring(0, 250)}`,
        citations: [{
          id: top._source.id,
          createdAt: new Date(top._source.created_at_epoch).toISOString(),
          preview: top._source.text.substring(0, 300),
          score: top._score,
          type: top._source.type,
          tags: top._source.tags,
        }],
        confidence: 0.5,
      };
    }

    return {
      answer: "I couldn't find relevant information in your notes to answer this question.",
      citations: [],
      confidence: 0.1,
    };
  }
}

// ── Handler ─────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  try {
    // Parse request
    let body: AskRequest;
    try {
      body = JSON.parse(event.body || '{}') as AskRequest;
    } catch {
      return validationError('Invalid JSON in request body');
    }

    const userOrError = getAuthUser(event);
    if (typeof userOrError !== 'string') return userOrError;
    const user = userOrError;

    if (!body.query) {
      return validationError('Query is required');
    }

    // Rewrite and expand query
    const { expandedQuery, tags } = rewriteQuery(body.query);

    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(bedrock, body.query);

    // Perform hybrid search
    const searchResults = await hybridSearch(
      opensearch, SEARCH_COLLECTION, expandedQuery, queryEmbedding,
      { user, tags: [...(body.tags || []), ...tags], timeWindow: body.timeWindow },
    );

    // Score and rank
    const rankedResults = scoreAndRank(searchResults);

    // Separate thoughts from conversations
    const thoughtResults = rankedResults.filter(h => h._source.docType !== 'conversation');
    const conversationResults = rankedResults.filter(h => h._source.docType === 'conversation');

    // Generate answer with citations
    const { answer, citations, confidence } = await generateAnswer(
      body.query,
      thoughtResults.length > 0 ? thoughtResults : rankedResults,
    );

    // Build conversation hits
    const conversationHits: ConversationHit[] = conversationResults.slice(0, 3).map(hit => {
      const text = hit._source.text || '';
      const exchanges = text.split('\n\n');
      const lastExchange = exchanges.slice(-2).join(' → ').substring(0, 150);
      return {
        id: hit._source.id,
        title: hit._source.title || 'Untitled Conversation',
        preview: lastExchange || hit._source.summary || text.substring(0, 150),
        messageCount: hit._source.messageCount || 0,
        score: hit._score,
        createdAt: new Date(hit._source.created_at_epoch).toISOString(),
      };
    });

    const processingTime = Date.now() - startTime;

    // Emit metrics
    await emitMetrics(cloudwatch, [
      { name: 'AskLatency', value: processingTime, unit: 'Milliseconds' },
      { name: 'CitationCount', value: citations.length },
      { name: 'AnswerConfidence', value: confidence, unit: 'None' },
      { name: 'AbstainRate', value: citations.length === 0 ? 1 : 0, unit: 'None' },
    ]);

    const response: AskResponse = {
      answer,
      citations: normalizeScores(citations.slice(0, body.limit || 5)),
      conversationHits: conversationHits.length > 0 ? normalizeScores(conversationHits) : undefined,
      confidence,
      processingTime,
    };

    return jsonResponse(200, response, { 'X-Processing-Time': processingTime.toString() });
  } catch (error) {
    console.error('Error processing ask request:', error);
    await emitMetrics(cloudwatch, [{ name: 'AskError', value: 1 }]);
    return internalError('Failed to process question', event.requestContext.requestId);
  }
};
