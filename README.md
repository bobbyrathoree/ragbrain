<p align="center">
  <img src="docs/banner.png" alt="Ragbrain" width="100%">
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#api-reference">API</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vue-3.4+-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue">
  <img src="https://img.shields.io/badge/AWS-CDK_v2-FF9900?logo=amazonaws&logoColor=white" alt="AWS">
  <img src="https://img.shields.io/badge/AI-Claude_+_Titan-6B48FF" alt="AI">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

Ragbrain is a personal knowledge management system that lets you capture thoughts instantly via hotkey and retrieve them with AI-powered search that cites its sources. Your knowledge is visualized as an interactive galaxy of connected ideas.

<p align="center">
  <img src="docs/screenshots/feed.png" alt="Feed View" width="80%">
</p>

## Features

### Instant Capture (Alt+S)

Press a hotkey, type your thought, hit save. Auto-detects whether it's a decision, insight, code snippet, todo, or link. Tags extracted automatically from hashtags. Sub-2-second end-to-end.

<p align="center">
  <img src="docs/screenshots/capture-modal.png" alt="Capture Modal" width="60%">
</p>

### Intelligent Ask (Alt+F)

Ask questions about your captured knowledge. Hybrid search combines BM25 keyword matching with semantic vector embeddings. Every answer includes citations to the source notes with confidence scores.

<p align="center">
  <img src="docs/screenshots/ask-modal.png" alt="Ask Modal" width="60%">
</p>

### Knowledge Galaxy

Your thoughts organized as an interactive galaxy. Theme clusters emerge automatically via K-means clustering on embeddings. LLM-generated labels describe each cluster. Drill into any cluster to explore individual thoughts and their connections.

| Galaxy Overview | Constellation Drill-In |
|:-:|:-:|
| <img src="docs/screenshots/galaxy.png" alt="Galaxy" width="100%"> | <img src="docs/screenshots/constellation.png" alt="Constellation" width="100%"> |

- **Galaxy view** -- Theme bubbles with orbiting particles, glass highlights, and flowing affinity lines
- **Constellation view** -- Thought nodes with type icons, D3 force physics, drag interaction, and breathing edges
- **ThoughtDrawer** -- Click any node to see full text, tags, and connected thoughts. Navigate node-to-node.
- **Zoom & drag** -- Scroll to zoom, drag background to pan, drag nodes to rearrange

### Brain Pulse (Timeline)

Analytics dashboard showing your capture velocity, streak, most active day, trending tags, recent decisions, and open todos.

<p align="center">
  <img src="docs/screenshots/timeline.png" alt="Timeline" width="80%">
</p>

### Multi-Turn Chat

Have conversations with your knowledge base. Ask follow-up questions with full conversation context. Messages encrypted with KMS.

<p align="center">
  <img src="docs/screenshots/chat.png" alt="Chat" width="80%">
</p>

### AI-Powered Intelligence

- **Smart Auto-Tagging** -- Claude extracts semantic tags, categories, intent, and entities
- **Related Thoughts** -- k-NN vector similarity finds connected ideas
- **Summaries** -- Automatic one-sentence summarization
- **Deterministic Clustering** -- Seeded K-means so clusters stay stable across sessions

---

## Architecture

```mermaid
graph TB
    subgraph Frontend["Web App (Vue 3 + TypeScript)"]
        Feed[Feed View]
        Graph[Knowledge Galaxy]
        Timeline[Brain Pulse]
        Chat[Chat View]
        Capture[Capture Modal]
        Ask[Ask Modal]
    end

    subgraph API["AWS API Gateway v2"]
        GW[HTTP API + WAF]
        Auth[Authorizer Lambda]
    end

    subgraph Compute["Lambda Functions"]
        CaptureL[Capture]
        AskL[Ask]
        ThoughtsL[Thoughts]
        GraphL[Graph]
        IndexerL[Indexer]
        ConvL[Conversations]
        SearchL[Search]
        ExportL[Export]
    end

    subgraph Storage["Data Layer"]
        DDB[(DynamoDB)]
        S3[(S3)]
        OS[(OpenSearch Serverless)]
    end

    subgraph AI["AWS Bedrock"]
        Claude[Claude Sonnet 4.5]
        Haiku[Claude Haiku 4.5]
        Titan[Titan Embeddings]
    end

    subgraph Queue["Async Processing"]
        SQS[SQS Queue]
        DLQ[Dead Letter Queue]
    end

    Frontend -->|HTTPS| GW
    GW --> Auth
    Auth --> CaptureL & AskL & ThoughtsL & GraphL & ConvL & SearchL & ExportL

    CaptureL --> S3 & DDB & SQS
    SQS --> IndexerL
    IndexerL --> Titan & Haiku & OS & DDB
    AskL --> Titan & Claude & OS
    GraphL --> OS & Haiku & S3
    ConvL --> DDB & OS & Haiku
    ThoughtsL --> DDB
    SearchL --> OS
    ExportL --> DDB

    SQS -.-> DLQ

    style Frontend fill:#1a1a2e,stroke:#4ECDC4,color:#fff
    style API fill:#1a1a2e,stroke:#FF6B6B,color:#fff
    style Compute fill:#1a1a2e,stroke:#45B7D1,color:#fff
    style Storage fill:#1a1a2e,stroke:#FECA57,color:#fff
    style AI fill:#1a1a2e,stroke:#a78bfa,color:#fff
    style Queue fill:#1a1a2e,stroke:#fb7185,color:#fff
```

### Data Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web App
    participant API as API Gateway
    participant C as Capture Lambda
    participant Q as SQS
    participant I as Indexer Lambda
    participant OS as OpenSearch
    participant B as Bedrock

    U->>W: Alt+S (Capture)
    W->>API: POST /thoughts
    API->>C: Invoke
    C->>C: Validate + detect type
    par Store
        C->>C: S3 (full JSON)
        C->>C: DynamoDB (metadata)
    end
    C->>Q: Queue for indexing
    C-->>W: 201 Created

    Q->>I: Process message
    I->>B: Generate embedding (Titan)
    I->>B: Smart tags + summary (Haiku)
    I->>OS: Index document
    I->>C: Update DynamoDB (indexingStatus: indexed)

    U->>W: Alt+F (Ask)
    W->>API: POST /ask
    API->>B: Embed query (Titan)
    API->>OS: Hybrid search (BM25 + k-NN)
    API->>B: Generate answer (Claude Sonnet)
    API-->>W: Answer + citations
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
- `ApiUrl` -- Your API Gateway endpoint
- `ApiKeySecretArn` -- Secret containing your API key

Retrieve your API key:
```bash
aws secretsmanager get-secret-value \
  --secret-id ragbrain/dev/api-key \
  --query SecretString --output text | jq -r .key
```

### 3. Configure Web App

Create `apps/web/.env.local`:
```
VITE_API_ENDPOINT=https://your-api-id.execute-api.us-west-2.amazonaws.com/dev
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
| **Alt+S** | Capture a thought |
| **Alt+F** | Ask a question |
| **Cmd+K** | Command palette |

### Capture Types

| Type | Icon | Description |
|------|------|-------------|
| Thought | ● | General observations |
| Decision | ◆ | Choices with rationale |
| Insight | ★ | Realizations and learnings |
| Code | ⟨⟩ | Snippets with syntax highlighting |
| Todo | ☐ | Action items |
| Link | ↗ | URLs with context |

### Ask Examples

- "What did I decide about the database schema?"
- "Show me code snippets related to authentication"
- "What were my insights from re:Invent?"

---

## Project Structure

```
ragbrain/
├── apps/
│   └── web/                        # Vue 3 frontend
│       ├── src/
│       │   ├── api/                # API client with legacy fallback
│       │   ├── components/
│       │   │   └── views/
│       │   │       ├── graph/      # Knowledge Galaxy (Canvas 2D + D3)
│       │   │       │   ├── CanvasRenderer.ts
│       │   │       │   ├── ThoughtDrawer.vue
│       │   │       │   └── useGraphNavigation.ts
│       │   │       ├── FeedView.vue
│       │   │       ├── GraphView.vue
│       │   │       ├── TimelineView.vue
│       │   │       └── ChatView.vue
│       │   ├── composables/        # Vue composables
│       │   ├── types/              # Re-exports from @ragbrain/shared
│       │   └── lib/                # Utilities
│       └── index.html
├── packages/
│   ├── infra/                      # AWS CDK infrastructure
│   │   ├── lib/
│   │   │   ├── stacks/            # 5 CDK stacks
│   │   │   └── shared/            # Shared backend library
│   │   │       ├── search.ts      # Hybrid search, scoring, embeddings
│   │   │       ├── metrics.ts     # CloudWatch metrics helper
│   │   │       ├── responses.ts   # Standardized API responses
│   │   │       ├── clients.ts     # AWS client factories
│   │   │       └── config.ts      # Model IDs, search weights
│   │   └── functions/             # Lambda handlers
│   │       ├── capture/           # Thought capture + S3 + SQS
│   │       ├── ask/               # Hybrid search + Claude answers
│   │       ├── graph/             # K-means + LOD tiling + LLM labels
│   │       ├── indexer/           # Embeddings + smart tags + OpenSearch
│   │       ├── conversations/     # Encrypted multi-turn chat
│   │       ├── thoughts/          # CRUD + filtering
│   │       ├── search/            # BM25 text search
│   │       ├── authorizer/        # API key + rate limiting
│   │       └── export/            # Obsidian sync export
│   ├── shared/                    # Shared TypeScript types + utils
│   └── tests/                     # API, security, performance tests
└── design/                        # Technical design docs
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vue 3, TypeScript, Tailwind CSS, D3.js, Canvas 2D |
| **Backend** | AWS Lambda (Node.js 20), API Gateway v2, WAF |
| **Database** | DynamoDB (3 GSIs, KMS encrypted), OpenSearch Serverless |
| **AI** | Claude Sonnet 4.5 (answers), Claude Haiku 4.5 (tags/themes), Titan Embeddings v1 |
| **Infrastructure** | AWS CDK v2 (TypeScript), 5 stacks |
| **Search** | Hybrid BM25 + k-NN vector similarity with score fusion |
| **Monitoring** | CloudWatch dashboards, custom metrics, SNS alarms |
| **Encryption** | Customer-managed KMS, per-message encryption for conversations |

---

## API Reference

Base URL: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`

All endpoints require `x-api-key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/thoughts` | Capture a thought |
| `GET` | `/thoughts` | List thoughts (paginated) |
| `PUT` | `/thoughts/{id}` | Update thought text |
| `DELETE` | `/thoughts/{id}` | Delete a thought |
| `GET` | `/thoughts/{id}/related` | Get related thoughts |
| `POST` | `/ask` | Ask a question with citations |
| `GET` | `/graph` | Get graph data (supports `?level=overview` and `?level=theme&themeId=X`) |
| `GET` | `/search?q=query` | Full-text search |
| `POST` | `/conversations` | Create conversation |
| `GET` | `/conversations` | List conversations |
| `POST` | `/conversations/{id}/messages` | Send message |
| `GET` | `/export` | Export for Obsidian sync |

---

## Design Principles

1. **Speed first** -- Capture in under 2 seconds, never block the user
2. **Citations required** -- Every AI answer references source notes
3. **Privacy focused** -- Your data in your AWS account, KMS encrypted at rest
4. **Progressive disclosure** -- Galaxy overview first, drill into details on demand
5. **Deterministic clustering** -- Same thoughts always produce the same graph

---

## License

MIT (c) Bobby Rathore

---

<p align="center">Built with curiosity. Powered by Claude.</p>
