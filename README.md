# Ragbrain

**Instant thought capture and AI-powered retrieval with citations. Your second brain.**

Capture thoughts with a hotkey. Ask questions and get answers backed by timestamped citations from your own knowledge. Explore ideas through a semantic knowledge graph.

![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript)
![Vue](https://img.shields.io/badge/Vue-3.4+-green?logo=vuedotjs)
![AWS](https://img.shields.io/badge/AWS-CDK-orange?logo=amazonaws)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

### Instant Capture (⌥S)
- Capture thoughts, code snippets, decisions, and links in under 2 seconds
- Auto-detects type: thought, decision, insight, code, todo, or link
- Smart tag extraction from content

### Intelligent Ask (⌥F)
- Ask questions about your captured knowledge
- Hybrid search: BM25 keyword matching + semantic embeddings
- Every answer includes timestamped citations to source notes
- Markdown rendering with code syntax highlighting

### Knowledge Graph
- **K-means clustering** groups related thoughts into themes
- **LLM-generated labels** describe each cluster meaningfully
- Semantic similarity edges connect related ideas
- Interactive pan, zoom, and node selection
- Collapsible sidebar with theme navigation

### Visual Exploration
- **Feed** — Neo-brutalist masonry grid with type-colored accents
- **Graph** — Force-directed visualization with clustered themes
- **Timeline** — GitHub-style contribution heatmap

### AI-Powered Intelligence
- **Smart Auto-Tagging** — Extracts semantic tags from content
- **Related Thoughts** — k-NN vector similarity finds connected ideas
- **Summaries** — Automatic summarization of longer notes

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web App (Vue 3)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Capture  │  │   Ask    │  │   Feed   │  │   Graph    │  │
│  │   ⌥S     │  │   ⌥F     │  │   View   │  │    View    │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
│       └─────────────┴─────────────┴──────────────┘         │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────┼─────────────────────────────────┐
│                     AWS Backend                             │
│  ┌────────────────────────────────────────────────────────┐│
│  │                   API Gateway                          ││
│  └──┬──────┬──────┬──────┬──────┬──────┬────────────────┘ │
│     │      │      │      │      │      │                   │
│  ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐              │
│  │Capt-││ Ask ││Thou-││Graph││Index││Conv-│    Lambda     │
│  │ure  ││     ││ghts ││     ││er   ││ersa-│               │
│  └──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘              │
│     │      │      │      │      │      │                   │
│  ┌──▼──────▼──────▼──────▼──────▼──────▼──┐              │
│  │              DynamoDB                   │  KMS Encrypt  │
│  │         (thoughts + conversations)      │               │
│  └─────────────────┬──────────────────────┘               │
│                    │                                       │
│  ┌─────────────────▼─────────────────────┐                │
│  │       OpenSearch Serverless            │                │
│  │    (embeddings + hybrid search)        │                │
│  └────────────────────────────────────────┘                │
│                                                            │
│  ┌────────────────────────────────────────┐                │
│  │           AWS Bedrock                   │                │
│  │  Claude Sonnet (answers, clustering)    │                │
│  │  Titan (embeddings)                     │                │
│  └────────────────────────────────────────┘                │
└────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- AWS CLI configured with credentials
- Docker (for CDK Lambda bundling)

### 1. Clone & Install

```bash
git clone https://github.com/bobbyrathoree/ragbrain.git
cd ragbrain
npm install
```

### 2. Deploy Backend

```bash
cd packages/infra

# Bootstrap CDK (first time only)
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-west-2

# Deploy all stacks
npx cdk deploy --all --context env=dev
```

Note the outputs:
- `ApiUrl` — Your API Gateway endpoint
- `ApiKeySecretArn` — Secret containing your API key

Retrieve your API key:
```bash
aws secretsmanager get-secret-value \
  --secret-id ragbrain/dev/api-key \
  --query SecretString --output text | jq -r .key
```

### 3. Configure Web App

Create `apps/web/.env.local`:
```
VITE_API_BASE_URL=https://your-api-id.execute-api.us-west-2.amazonaws.com/dev
VITE_API_KEY=your-api-key
```

### 4. Run

```bash
cd apps/web
npm run dev
```

Open http://localhost:5173

---

## Usage

| Hotkey | Action |
|--------|--------|
| **⌥S** | Capture a thought |
| **⌥F** | Ask a question |
| **⌘K** | Command palette |
| **1/2/3** | Switch views |

### Capture Types
- **Thought** — General observations
- **Decision** — Choices with rationale
- **Insight** — Realizations and learnings
- **Code** — Snippets with syntax highlighting
- **Todo** — Action items
- **Link** — URLs

### Ask Examples
- "What did I decide about the database schema?"
- "Show me code snippets related to authentication"
- "What were my thoughts on API design?"

---

## Project Structure

```
ragbrain/
├── apps/
│   └── web/                   # Vue 3 frontend
│       ├── src/
│       │   ├── api/           # API client
│       │   ├── components/    # Vue components
│       │   │   └── views/     # Feed, Graph, Timeline
│       │   ├── composables/   # Vue composables
│       │   └── types/         # TypeScript types
│       └── index.html
├── packages/
│   ├── infra/                 # AWS CDK infrastructure
│   │   ├── lib/stacks/        # CDK stack definitions
│   │   └── functions/         # Lambda handlers
│   │       ├── capture/       # Thought capture
│   │       ├── ask/           # Question answering
│   │       ├── thoughts/      # List & filter
│   │       ├── graph/         # K-means clustering + visualization
│   │       ├── indexer/       # AI processing
│   │       └── conversations/ # Multi-turn conversations
│   └── shared/                # Shared TypeScript types
└── design/                    # Technical design docs
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Frontend** | Vue 3, TypeScript, Tailwind CSS, D3.js |
| **Backend** | AWS Lambda (Node.js 20), API Gateway |
| **Database** | DynamoDB (KMS encrypted), OpenSearch Serverless |
| **AI** | Claude Sonnet (Bedrock), Titan Embeddings |
| **Infrastructure** | AWS CDK v2 (TypeScript) |
| **Search** | Hybrid BM25 + k-NN vector similarity |

---

## API Reference

Base URL: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`

All endpoints require `x-api-key` header.

### Capture Thought
```http
POST /thoughts
Content-Type: application/json

{
  "text": "Use Redis caching for frequently accessed endpoints",
  "type": "decision",
  "tags": ["performance", "redis"]
}
```

### List Thoughts
```http
GET /thoughts?limit=50&type=decision
```

### Ask Question
```http
POST /ask
Content-Type: application/json

{
  "query": "What have I noted about caching?",
  "timeWindow": "90d"
}
```

Response includes citations:
```json
{
  "answer": "You decided to use Redis caching for frequently accessed endpoints [1].",
  "citations": [{
    "id": "t_abc123",
    "preview": "Use Redis caching...",
    "score": 0.89,
    "createdAt": "2026-01-17T15:00:00.000Z"
  }],
  "confidence": 0.87
}
```

### Get Graph Data
```http
GET /graph
```

Returns K-means clustered nodes with LLM-generated theme labels.

---

## Design Principles

1. **Speed first** — Capture in under 2 seconds
2. **Citations required** — Every answer references sources
3. **Privacy focused** — Your data in your AWS account, encrypted at rest
4. **Semantic clustering** — AI groups related thoughts automatically

---

## License

MIT © Bobby Rathore

---

Built with curiosity. Powered by Claude.
