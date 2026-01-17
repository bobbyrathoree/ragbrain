# Ragbrain

**A blazing-fast, local-first personal knowledge management system for macOS.**

Capture thoughts instantly with global hotkeys. Ask questions and get citation-backed answers from your own knowledge base. Explore your ideas through beautiful 3D visualizations.

![macOS](https://img.shields.io/badge/macOS-14.0+-black?logo=apple)
![Swift](https://img.shields.io/badge/Swift-5.9+-orange?logo=swift)
![AWS](https://img.shields.io/badge/AWS-CDK-orange?logo=amazonaws)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Features

### ⚡ Instant Capture
- **⌥S** — Capture thoughts, code snippets, decisions, and links in under 150ms
- Auto-captures context: active app, window title, git repo, branch, file path
- Works offline with background sync

### 🔍 Intelligent Ask
- **⌥F** — Ask questions about your captured knowledge
- Hybrid search: BM25 keyword matching + semantic embeddings
- Every answer includes timestamped citations to source notes

### 🌌 Visual Exploration
- **3D Hypergraph** — Navigate your knowledge as an interactive node graph
- **Constellation View** — See thoughts as a twinkling starfield grouped by topic
- **Timeline Heatmap** — Visualize capture density over time
- **Smart Feed** — AI-grouped thoughts by topic, date, or importance

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
│  └──────┬──────────┬──────────┬──────────┬─────────────────┘ │
│         │          │          │          │                    │
│    ┌────▼───┐ ┌────▼───┐ ┌────▼───┐ ┌────▼───┐               │
│    │Capture │ │  Ask   │ │Thoughts│ │ Graph  │   Lambda      │
│    │Lambda  │ │ Lambda │ │ Lambda │ │ Lambda │               │
│    └────┬───┘ └────┬───┘ └────┬───┘ └────┬───┘               │
│         │          │          │          │                    │
│    ┌────▼──────────▼──────────▼──────────▼───┐               │
│    │              DynamoDB                    │               │
│    │         (thoughts table)                 │               │
│    └─────────────────┬───────────────────────┘               │
│                      │                                        │
│    ┌─────────────────▼───────────────────────┐               │
│    │       OpenSearch Serverless              │               │
│    │    (embeddings + hybrid search)          │               │
│    └─────────────────────────────────────────┘               │
│                                                               │
│    ┌─────────────────────────────────────────┐               │
│    │           AWS Bedrock                    │               │
│    │   (Claude for embeddings + answers)      │               │
│    └─────────────────────────────────────────┘               │
└───────────────────────────────────────────────────────────────┘
```

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
  --query SecretString --output text
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

### 5. Enter API Key

1. Click the menu bar icon → **Settings** (or press ⌘,)
2. Go to the **API** tab
3. Paste your API key
4. Click **Test Connection**

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
│   │   └── functions/      # Lambda handlers
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

### Local Configuration

The app looks for configuration in this order:
1. `apps/macos/.env.local` (gitignored)
2. `~/.ragbrain/config`
3. Settings entered in the app UI

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **macOS App** | Swift 5.9, SwiftUI, SceneKit, Core Data |
| **Backend** | AWS Lambda (Node.js 20), API Gateway |
| **Database** | DynamoDB, OpenSearch Serverless |
| **AI** | AWS Bedrock (Claude) |
| **Infrastructure** | AWS CDK v2 (TypeScript) |
| **Search** | Hybrid BM25 + k-NN vector similarity |

---

## Design Principles

1. **Speed first** — Capture must never block or feel slow (<150ms)
2. **Citations required** — Every answer references source notes with timestamps
3. **Privacy focused** — Your data, your AWS account, encrypted at rest
4. **Offline resilient** — Full local functionality, sync when available
5. **Local-first** — Core Data for instant access, cloud for sync and search

---

## License

MIT © Bobby Rathore

---

## Acknowledgments

Built with caffeine and curiosity. Powered by Claude.
