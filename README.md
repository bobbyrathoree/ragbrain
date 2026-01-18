# Ragbrain

**A blazing-fast, local-first personal knowledge management system for macOS.**

Capture thoughts instantly with global hotkeys. Ask questions and get citation-backed answers from your own knowledge base. Have multi-turn conversations with encrypted history. Explore your ideas through beautiful 3D visualizations.

![macOS](https://img.shields.io/badge/macOS-14.0+-black?logo=apple)
![Swift](https://img.shields.io/badge/Swift-5.9+-orange?logo=swift)
![AWS](https://img.shields.io/badge/AWS-CDK-orange?logo=amazonaws)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

### Instant Capture
- **⌥S** — Capture thoughts, code snippets, decisions, and links in under 150ms
- Auto-captures context: active app, window title, git repo, branch, file path
- Works offline with background sync

### Intelligent Ask
- **⌥F** — Ask questions about your captured knowledge
- Hybrid search: BM25 keyword matching + semantic embeddings
- Every answer includes timestamped citations to source notes

### Multi-Turn Conversations
- Have back-and-forth conversations with follow-up questions
- Full conversation history with context maintained
- **End-to-end encrypted** — Messages encrypted with KMS before storage
- **Searchable** — Conversations are indexed alongside thoughts for unified search

### AI-Powered Intelligence
- **Smart Auto-Tagging** — Claude analyzes each thought and extracts:
  - Semantic tags (3-5 per thought)
  - Category (engineering, design, product, personal, learning, decision)
  - Intent (note, question, decision, todo, idea, bug-report, feature-request)
  - Named entities (technologies, people, concepts)
- **Related Thoughts** — k-NN vector similarity finds connected ideas
- **Summaries** — Automatic summarization of longer notes

### Visual Exploration
- **3D Hypergraph** — Navigate your knowledge as an interactive node graph
- **Constellation View** — See thoughts as a twinkling starfield grouped by topic
- **Timeline Heatmap** — Visualize capture density over time
- **Smart Feed** — AI-grouped thoughts by topic, date, category, or importance

### Obsidian Sync
- **Continuous export** to your local Obsidian vault
- **Daily notes** with thoughts and conversations organized by date
- **Smart file names** — Human-readable IDs like `t-redis-caching-a1b2.md`
- **Wikilinks** — Navigate between thoughts, conversations, and daily notes
- **Incremental sync** — Only syncs changes since last sync
- **Auto-detect vault** — Finds your Obsidian vault automatically

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     macOS App (SwiftUI)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Capture  │  │   Ask    │  │  Feed    │  │ Hypergraph   │ │
│  │  ⌥S      │  │   ⌥F     │  │  View    │  │ /Constellation│ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘ │
│       │             │             │               │          │
│       └─────────────┴─────────────┴───────────────┘          │
│                           │                                   │
│                    Core Data (offline)                        │
└───────────────────────────┼───────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────┼───────────────────────────────────┐
│                     AWS Backend                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   API Gateway                            │ │
│  └──┬──────┬──────┬──────┬──────┬──────┬──────┬──────────┘ │
│     │      │      │      │      │      │      │              │
│  ┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──┐┌──▼──────┐     │
│  │Capt-││ Ask ││Thou-││Graph││Index││Conv-││ Export  │ Lambda│
│  │ure  ││     ││ghts ││     ││er   ││ersa-││(Obsid.) │      │
│  └──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──┘└──┬──────┘     │
│     │      │      │      │      │      │      │              │
│  ┌──▼──────▼──────▼──────▼──────▼──────▼──────▼──┐         │
│  │              DynamoDB                        │           │
│  │    (thoughts + conversations)                │KMS Encrypt│
│  └─────────────────┬────────────────────────────┘           │
│                    │                                        │
│  ┌─────────────────▼───────────────────────┐               │
│  │       OpenSearch Serverless              │               │
│  │    (embeddings + hybrid search)          │               │
│  └─────────────────────────────────────────┘               │
│                                                             │
│  ┌─────────────────────────────────────────┐               │
│  │           AWS Bedrock                    │               │
│  │  Claude Sonnet 4.5 (answers)             │               │
│  │  Claude Haiku 4.5 (tagging/summaries)    │               │
│  │  Titan (embeddings)                      │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## API Reference

Base URL: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`

All endpoints require `x-api-key` header.

### Thoughts

#### Capture Thought
```http
POST /thoughts
Content-Type: application/json

{
  "text": "Use Redis caching for frequently accessed endpoints",
  "type": "note",
  "tags": ["performance", "redis"],
  "context": {
    "app": "VSCode",
    "repo": "myproject",
    "file": "src/cache.ts"
  }
}
```

Response:
```json
{
  "id": "t_abc123",
  "createdAt": "2026-01-17T15:00:00.000Z"
}
```

#### List Thoughts
```http
GET /thoughts?limit=50&type=note&tag=redis&from=2026-01-01&to=2026-01-31
```

Response includes AI-derived fields:
```json
{
  "thoughts": [{
    "id": "t_abc123",
    "text": "Use Redis caching...",
    "type": "note",
    "tags": ["performance", "redis"],
    "derived": {
      "summary": "Implement Redis caching for performance",
      "autoTags": ["caching", "performance-optimization"],
      "category": "engineering",
      "intent": "decision",
      "entities": ["Redis"],
      "relatedIds": ["t_def456", "t_ghi789"]
    }
  }],
  "cursor": "...",
  "hasMore": true
}
```

#### Get Related Thoughts
```http
GET /thoughts/{id}/related
```

Returns thoughts connected by semantic similarity.

### Ask

#### Ask a Question
```http
POST /ask
Content-Type: application/json

{
  "query": "What have I noted about caching?",
  "timeWindow": "90d",
  "tags": ["performance"]
}
```

Response:
```json
{
  "answer": "Based on your notes, you implemented Redis caching for frequently accessed endpoints, achieving a 10x response time improvement [1].",
  "citations": [{
    "id": "t_abc123",
    "createdAt": "2026-01-17T15:00:00.000Z",
    "preview": "Use Redis caching...",
    "score": 0.89,
    "type": "note",
    "tags": ["performance", "redis"]
  }],
  "confidence": 0.87,
  "processingTime": 3200
}
```

### Conversations

#### Create Conversation
```http
POST /conversations
Content-Type: application/json

{
  "title": "API Design Discussion",
  "initialMessage": "What patterns have I used for APIs?"
}
```

Response:
```json
{
  "id": "conv_xyz789",
  "title": "API Design Discussion",
  "createdAt": "2026-01-17T16:00:00.000Z",
  "messages": [
    {"role": "user", "content": "What patterns have I used for APIs?"},
    {"role": "assistant", "content": "Based on your notes...", "citations": [...]}
  ]
}
```

#### Send Message (with follow-up context)
```http
POST /conversations/{id}/messages
Content-Type: application/json

{
  "content": "Tell me more about the caching approach",
  "includeHistory": 10
}
```

Response:
```json
{
  "userMessage": {
    "id": "msg_abc",
    "role": "user",
    "content": "Tell me more about the caching approach",
    "createdAt": "2026-01-17T16:05:00.000Z"
  },
  "assistantMessage": {
    "id": "msg_def",
    "role": "assistant",
    "content": "You implemented Redis caching and achieved exactly a 10x improvement [1]...",
    "citations": [...],
    "confidence": 0.95,
    "createdAt": "2026-01-17T16:05:03.000Z"
  },
  "processingTime": 3400
}
```

#### List Conversations
```http
GET /conversations?status=active&limit=20
```

#### Get Conversation with Messages
```http
GET /conversations/{id}
```

#### Update Conversation
```http
PUT /conversations/{id}
Content-Type: application/json

{"title": "New Title", "status": "archived"}
```

#### Delete Conversation
```http
DELETE /conversations/{id}
```

### Graph

#### Get Visualization Data
```http
GET /graph?month=2026-01
```

Response:
```json
{
  "nodes": [{
    "id": "t_abc123",
    "x": 0.5, "y": 0.3, "z": 0.8,
    "tags": ["redis", "caching"],
    "recency": 0.9,
    "importance": 0.7,
    "type": "note",
    "clusterId": "cluster_1"
  }],
  "edges": [{
    "source": "t_abc123",
    "target": "t_def456",
    "similarity": 0.85
  }],
  "clusters": [{
    "id": "cluster_1",
    "label": "Performance",
    "color": "#3b82f6",
    "nodeIds": ["t_abc123", "t_def456"]
  }]
}
```

### Export (Obsidian Sync)

#### Get Export Data
```http
GET /export?since=0
```

Parameters:
- `since` — Unix timestamp in milliseconds. Use `0` for full export, or last `syncTimestamp` for incremental.

Response:
```json
{
  "thoughts": [{
    "id": "t_abc123",
    "smartId": "t-redis-caching-a1b2",
    "text": "Use Redis caching for frequently accessed endpoints",
    "type": "note",
    "tags": ["performance", "redis"],
    "category": "engineering",
    "context": {"app": "VSCode", "repo": "myproject"},
    "relatedIds": ["t_def456"],
    "createdAt": "2026-01-17T15:00:00.000Z"
  }],
  "conversations": [{
    "id": "conv_xyz789",
    "smartId": "conv-api-design-e5f6",
    "title": "API Design Discussion",
    "messages": [
      {"role": "user", "content": "What patterns...", "createdAt": "..."},
      {"role": "assistant", "content": "Based on...", "citations": [...], "createdAt": "..."}
    ],
    "status": "active",
    "createdAt": "2026-01-17T16:00:00.000Z",
    "updatedAt": "2026-01-17T16:15:00.000Z"
  }],
  "deleted": ["t_old123"],
  "syncTimestamp": 1705600800000
}
```

---

## Security

### Encryption

- **At Rest**: All DynamoDB data encrypted with customer-managed KMS keys
- **Conversations**: Application-level encryption with KMS encryption context
- **In Transit**: TLS 1.2+ for all API calls
- **S3**: Server-side encryption with KMS

### Authentication

Currently uses API key authentication. Cognito integration planned for multi-user support.

---

## Quick Start

### Prerequisites

- macOS 14.0+
- Xcode 15+ (for building the app)
- Node.js 20+ & npm
- AWS CLI configured with credentials
- Docker (for CDK Lambda bundling)

### 1. Clone & Install

```bash
git clone https://github.com/bobbyrathoree/ragbrain.git
cd ragbrain
npm install
```

### 2. Deploy Backend (AWS)

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

### 3. Configure macOS App

Create `apps/macos/.env.local`:
```
API_BASE_URL=https://your-api-id.execute-api.us-west-2.amazonaws.com/dev
```

### 4. Build & Run

```bash
cd apps/macos
swift build
swift run
```

Or open in Xcode and run.

---

## Usage

| Hotkey | Action |
|--------|--------|
| **⌥S** | Capture a thought |
| **⌥F** | Ask a question |
| **⌘,** | Open settings |

### Capture Types
- **Note** — General thoughts and observations
- **Code** — Code snippets with syntax highlighting
- **Decision** — Decisions with rationale
- **Link** — URLs with auto-fetched titles
- **Todo** — Action items

### Ask Examples
- "What did I decide about the database schema?"
- "Show me code snippets related to authentication"
- "What were my thoughts on the API design last week?"

### Conversation Examples
- Start: "What patterns have I used for caching?"
- Follow-up: "Which one gave the best performance improvement?"
- Follow-up: "How did I implement that?"

---

## Project Structure

```
ragbrain/
├── apps/
│   └── macos/              # SwiftUI native app
│       ├── Sources/
│       │   ├── Config/     # API configuration
│       │   ├── Managers/   # Business logic
│       │   ├── Models/     # Core Data models
│       │   └── Views/      # SwiftUI views
│       └── Tests/
├── packages/
│   ├── infra/              # AWS CDK infrastructure
│   │   ├── lib/stacks/     # CDK stack definitions
│   │   │   ├── api-stack.ts
│   │   │   ├── compute-stack.ts
│   │   │   ├── storage-stack.ts
│   │   │   ├── search-stack.ts
│   │   │   └── monitoring-stack.ts
│   │   └── functions/      # Lambda handlers
│   │       ├── capture/    # Thought capture
│   │       ├── ask/        # Question answering
│   │       ├── thoughts/   # List & filter
│   │       ├── graph/      # Visualization data
│   │       ├── indexer/    # AI processing (thoughts + conversations)
│   │       ├── conversations/ # Multi-turn conversations
│   │       └── export/     # Obsidian sync export
│   └── shared/             # Shared TypeScript types
└── design/                 # Technical design docs
```

---

## Development

### macOS App

```bash
cd apps/macos
swift build           # Build
swift test            # Run tests
swift run             # Run app
```

### Infrastructure

```bash
cd packages/infra
npm run build         # Compile TypeScript
npx cdk diff          # Preview changes
npx cdk deploy --all  # Deploy
npx cdk destroy --all # Tear down
```

### Test API

```bash
# Set variables
API_URL="https://your-api.execute-api.us-west-2.amazonaws.com/dev"
API_KEY="your-api-key"

# Capture a thought
curl -X POST "$API_URL/thoughts" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test thought", "type": "note", "tags": ["test"]}'

# Ask a question
curl -X POST "$API_URL/ask" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "What have I captured today?"}'

# Start a conversation
curl -X POST "$API_URL/conversations" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Conversation"}'
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **macOS App** | Swift 5.9, SwiftUI, SceneKit, Core Data |
| **Backend** | AWS Lambda (Node.js 20), API Gateway HTTP API |
| **Database** | DynamoDB (KMS encrypted), OpenSearch Serverless |
| **AI Models** | Claude Sonnet 4.5, Claude Haiku 4.5, Titan Embeddings |
| **Infrastructure** | AWS CDK v2 (TypeScript) |
| **Search** | Hybrid BM25 + k-NN vector similarity |
| **Encryption** | AWS KMS with application-level encryption |

---

## Design Principles

1. **Speed first** — Capture must never block or feel slow (<150ms)
2. **Citations required** — Every answer references source notes with timestamps
3. **Privacy focused** — Your data, your AWS account, encrypted at rest and in conversations
4. **Offline resilient** — Full local functionality, sync when available
5. **Local-first** — Core Data for instant access, cloud for sync and search
6. **AI-enhanced** — Smart tagging, categorization, and linking without manual effort

---

## Roadmap

- [x] Conversation search (Q&A sessions indexed as searchable knowledge)
- [x] Obsidian sync (continuous export with daily notes, smart IDs, wikilinks)
- [ ] Cognito authentication for multi-user support
- [ ] iOS companion app
- [ ] Voice capture
- [ ] Browser extension

---

## License

MIT © Bobby Rathore

---

## Acknowledgments

Built with caffeine and curiosity. Powered by Claude.
