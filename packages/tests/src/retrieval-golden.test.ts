export {};

const API_URL = process.env.RAGBRAIN_API_URL?.replace(/\/$/, '');
const API_KEY = process.env.RAGBRAIN_API_KEY;

if (!API_URL || !API_KEY) {
  throw new Error('RAGBRAIN_API_URL and RAGBRAIN_API_KEY are required');
}

interface SearchResult {
  id: string;
}

interface SearchResponse {
  results?: SearchResult[];
  searchMode?: 'hybrid' | 'bm25' | 'bm25-fallback';
}

interface GoldenCase {
  name: string;
  query: string;
  expectedId: string;
  semanticOnly?: boolean;
}

const cases: GoldenCase[] = [
  {
    name: 'relational storage decision',
    query: 'What storage choice did we make when correctness across linked data mattered?',
    expectedId: 't_6013b932-3150-4ba2-b459-213af8b385b5',
    semanticOnly: true,
  },
  {
    name: 'failure isolation mechanism',
    query: 'What mechanism keeps one dependency failure from cascading through other services?',
    expectedId: 't_202effb3-5ff0-408e-8ddd-c5aee59c46fe',
    semanticOnly: true,
  },
  {
    name: 'coordinated retry prevention',
    // Deliberately shares no significant vocabulary with the target note, which
    // says "exponential backoff with jitter" / "thundering herd". An earlier
    // wording ("how should delays be varied...") leaked "delays"/"varied" and so
    // BM25 could also find it, which defeats the point of a semantic-only case.
    query: 'Why do many clients reconnecting at the same instant overwhelm a recovering service?',
    expectedId: 't_f136f2a6-cd45-4b40-baa1-ed50b73f9ed3',
    semanticOnly: true,
  },
  {
    name: 'service lookup',
    query: 'How do clients locate running components by a logical name?',
    expectedId: 't_e1ed62e2-0b27-4f38-b5aa-058ac6b4c512',
  },
  {
    name: 'startup memory reduction',
    query: 'What lowered startup memory by avoiding one giant dependency bundle?',
    expectedId: 't_62b30d09-1e4f-4c7a-aed0-bcb0b776cb68',
  },
  {
    name: 'stateful workflow choice',
    query: 'Which managed workflow tool did we favor when operations needed visible state?',
    expectedId: 't_a6048fe8-4ad5-47cc-907a-1cd73c864252',
  },
  {
    name: 'burst traffic failures',
    query: 'Why did requests fail only during sudden bursts of traffic?',
    expectedId: 't_4b2348d8-2076-4403-aef7-0b01dc0ed9f4',
  },
  {
    name: 'simple API style',
    query: 'Which interface style was selected because the service only needs straightforward resource operations?',
    expectedId: 't_e1b67832-1bd1-4d79-9a53-3e49b1f5acaa',
  },
  {
    name: 'event routing choice',
    query: 'Which event backbone won because it can route by message contents and govern payload shapes?',
    expectedId: 't_fd500897-55ca-4bc1-93b4-02a54c4f57e2',
  },
  {
    name: 'in-place object querying',
    query: 'How can object contents be examined without transferring the file first?',
    expectedId: 't_d8704a1a-df37-4def-b139-c6af5f999b84',
  },
];

const headers = {
  'x-api-key': API_KEY,
};

async function search(query: string, mode: 'hybrid' | 'bm25'): Promise<SearchResponse> {
  const response = await fetch(
    `${API_URL}/search?q=${encodeURIComponent(query)}&limit=10&mode=${mode}`,
    { headers },
  );
  const body = await response.json() as SearchResponse;
  if (!response.ok) {
    throw new Error(`${mode} search returned HTTP ${response.status}`);
  }
  return body;
}

let failures = 0;

for (const golden of cases) {
  const hybrid = await search(golden.query, 'hybrid');
  const hybridRank = (hybrid.results || []).findIndex(result => result.id === golden.expectedId) + 1;

  try {
    if (hybrid.searchMode !== 'hybrid') {
      throw new Error(`search degraded to ${hybrid.searchMode || 'an unreported mode'}`);
    }
    if (hybridRank === 0 || hybridRank > 5) {
      throw new Error(`expected note was rank ${hybridRank || 'absent'}, not top 5`);
    }

    if (golden.semanticOnly) {
      const bm25 = await search(golden.query, 'bm25');
      const bm25Rank = (bm25.results || []).findIndex(result => result.id === golden.expectedId) + 1;
      if (bm25Rank > 0 && bm25Rank <= 5) {
        throw new Error(`semantic-only case also ranked ${bm25Rank} under BM25`);
      }
    }

    console.log(`PASS ${golden.name}: hybrid rank ${hybridRank}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${golden.name}: ${(error as Error).message}`);
  }
}

if (failures > 0) {
  throw new Error(`${failures}/${cases.length} retrieval golden cases failed`);
}

console.log(`retrieval golden set: ${cases.length}/${cases.length} passed`);
