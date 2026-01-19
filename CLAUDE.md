# Ragbrain - Personal Knowledge Management System

## Project Overview
Ragbrain is a blazing-fast, local-first note capture and retrieval system for macOS. It enables instant thought capture via hotkeys and provides intelligent, citation-backed answers to questions about your personal knowledge base.

## Core Features
- **⌥S** - Instant capture of thoughts, code snippets, decisions, and links
- **⌥F** - Ask questions and get answers with timestamped citations from your notes
- **Local-first** - Fast capture (sub-2s end-to-end) with offline support and background sync
- **Intelligent retrieval** - Hybrid search combining keyword matching and semantic embeddings
- **Beautiful visualizations** - Timeline heatmap and topic graph for exploring your knowledge

## Architecture
- **Frontend**: Native macOS app built with SwiftUI
- **Backend**: Serverless AWS (Lambda, S3, DynamoDB, OpenSearch)
- **AI**: AWS Bedrock for embeddings and answer generation
- **Search**: Hybrid BM25 + vector similarity with citation requirements

## Key Design Principles
1. **Speed first** - Capture must never block or feel slow
2. **Citations required** - Every answer must reference source notes with timestamps
3. **Privacy focused** - All data encrypted, no secrets in logs, API key redaction
4. **Offline resilient** - Full functionality locally, sync when available

## Implementation Status
Currently in development following a phased approach:
- Phase 1: Core capture and local storage
- Phase 2: AWS infrastructure and sync
- Phase 3: Intelligence layer with embeddings
- Phase 4: Ask feature with citations
- Phase 5: Visualization features
- Phase 6: Production hardening

## Development Guidelines
- Follow existing code patterns and conventions
- Maintain responsive capture performance (target <2s end-to-end)
- Ensure all AWS resources use KMS encryption
- Never log note contents or sensitive data
- Test offline scenarios thoroughly
- Keep citations as the primary trust mechanism

## Testing Commands
```bash
# Run tests (to be configured)
npm test

# Type checking (to be configured)
npm run typecheck

# Linting (to be configured)
npm run lint
```

## Project Structure
```
ragbrain/
├── apps/
│   ├── macos/          # Swift/SwiftUI native app
│   └── web/            # Optional web viewer
├── packages/
│   ├── api/            # Lambda functions
│   ├── infra/          # CDK infrastructure
│   └── shared/         # Shared types
├── design/             # Design documents
└── docs/               # Documentation
```