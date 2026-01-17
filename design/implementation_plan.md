# Ultrathink Implementation Plan

## Overview
This document outlines the phased implementation approach for Ultrathink, a local-first personal knowledge management system for macOS with AWS backend.

## Phase 1: Foundation & Core Capture (Week 1-2)

### 1.1 Project Setup
- [ ] Initialize monorepo structure
  ```
  ultrathink/
  ├── apps/
  │   ├── macos/          # Swift/SwiftUI app
  │   └── web/            # Optional web viewer
  ├── packages/
  │   ├── api/            # Lambda functions
  │   ├── infra/          # CDK/Terraform
  │   └── shared/         # Shared types/utils
  └── docs/
  ```
- [ ] Configure build tooling (Xcode project, npm/yarn workspaces)
- [ ] Set up git with proper .gitignore patterns
- [ ] Initialize CDK/Terraform project structure

### 1.2 macOS App Foundation
- [ ] Create SwiftUI app with AppKit integration
- [ ] Implement global hotkey registration (⌥S, ⌥F)
  - NSEvent global monitors
  - Accessibility permissions request flow
- [ ] Set up Core Data schema
  ```swift
  // Entities: Note, Settings, SyncQueue
  // Note: id, text, createdAt, type, tags, context, syncedAt
  // SyncQueue: noteId, operation, retryCount, lastAttempt
  ```
- [ ] Implement Keychain integration for secure storage
- [ ] Create app menu bar icon with sync status indicator

### 1.3 Capture Sheet UI
- [ ] Build borderless window with blur background
- [ ] Implement Markdown editor with:
  - Syntax highlighting for code blocks
  - Tag detection (#tag)
  - Flag detection (!todo, !decision)
  - Character counter
- [ ] Add local save animation (✅ feedback)
- [ ] Implement ESC to cancel, Enter to save

### 1.4 Local Storage Layer
- [ ] Implement Core Data CRUD operations
- [ ] Add SQLite encryption with Keychain-stored key
- [ ] Create sync queue management
- [ ] Build offline-first data layer with:
  - Optimistic updates
  - Conflict resolution strategy
  - Change tracking

## Phase 2: AWS Backend Infrastructure (Week 2-3)

### 2.1 Infrastructure as Code
- [ ] Define CDK stacks:
  ```typescript
  // Stacks:
  - NetworkStack (VPC, subnets, security groups)
  - StorageStack (S3 buckets, DynamoDB tables)
  - ComputeStack (Lambda functions, layers)
  - ApiStack (API Gateway, routes)
  - SearchStack (OpenSearch Serverless)
  - MonitoringStack (CloudWatch, alarms)
  ```
- [ ] Configure KMS keys for encryption
- [ ] Set up Secrets Manager for API keys
- [ ] Define IAM roles and policies

### 2.2 API Gateway Setup
- [ ] Create HTTP API with routes:
  - POST /thoughts
  - GET /thoughts
  - POST /ask
  - GET /graph
- [ ] Configure CORS and rate limiting
- [ ] Add API key authentication (temporary for v1)
- [ ] Set up request/response validation

### 2.3 Data Storage
- [ ] Create S3 buckets:
  - ultrathink-raw (source of truth)
  - ultrathink-artifacts (processed data)
- [ ] Configure DynamoDB table:
  - Partition key: user#userId
  - Sort key: ts#epoch#id
  - GSIs for tags and type
- [ ] Set up SQS queue with DLQ
- [ ] Configure lifecycle policies and backups

## Phase 3: Capture & Sync Pipeline (Week 3-4)

### 3.1 Capture Lambda
- [ ] Implement request validation
- [ ] Add idempotency with client-generated IDs
- [ ] Store raw JSON to S3
- [ ] Write minimal record to DynamoDB
- [ ] Enqueue to SQS for processing
- [ ] Return 201 with confirmation

### 3.2 macOS Sync Agent
- [ ] Build background sync service
- [ ] Implement exponential backoff
- [ ] Add retry logic with jitter
- [ ] Handle network state changes
- [ ] Update UI sync indicator
- [ ] Implement batch sync for efficiency

### 3.3 Context Capture (Optional)
- [ ] Detect active application (AppleScript)
- [ ] Extract VS Code workspace info
- [ ] Get git repo/branch via CLI
- [ ] Store context metadata
- [ ] Add privacy toggles in settings

## Phase 4: Intelligence Layer (Week 4-5)

### 4.1 OpenSearch Setup
- [ ] Provision OpenSearch Serverless collection
- [ ] Define index mapping:
  ```json
  {
    "mappings": {
      "properties": {
        "id": {"type": "keyword"},
        "text": {"type": "text"},
        "embedding": {"type": "knn_vector", "dimension": 1024},
        "tags": {"type": "keyword"},
        "created_at": {"type": "date"},
        "decision_score": {"type": "float"}
      }
    }
  }
  ```
- [ ] Configure k-NN settings
- [ ] Set up index aliases for versioning

### 4.2 Indexer Lambda
- [ ] Implement SQS event handler
- [ ] Fetch and parse S3 objects
- [ ] Add PII/secret detection and masking:
  - Regex patterns for tokens
  - Entropy analysis
  - Redaction logic
- [ ] Generate embeddings via Bedrock:
  - Titan Embeddings model
  - Batch processing
  - Error handling
- [ ] Index to OpenSearch
- [ ] Update DynamoDB with derived fields:
  - Auto-generated summary
  - Extracted tags
  - Decision score

### 4.3 Bedrock Integration
- [ ] Configure Bedrock access
- [ ] Implement embedding generation
- [ ] Add generation for summaries
- [ ] Set up model versioning strategy
- [ ] Implement caching layer

## Phase 5: Retrieval & Ask Feature (Week 5-6)

### 5.1 Ask Lambda
- [ ] Query rewriting logic:
  - Synonym expansion
  - Tag extraction
  - Time window parsing
- [ ] Hybrid search implementation:
  ```python
  # BM25 text search
  # k-NN vector search
  # Score fusion: 0.4*BM25 + 0.4*cosine + 0.15*recency + 0.05*decision
  ```
- [ ] Optional cross-encoder reranking
- [ ] Context assembly with snippets
- [ ] Citation extraction

### 5.2 Generation Pipeline
- [ ] Bedrock Claude/Titan integration
- [ ] Citation-required prompt engineering
- [ ] Response formatting
- [ ] Confidence scoring
- [ ] Fallback strategies

### 5.3 Ask Sheet UI
- [ ] Build ask input sheet (⌥F)
- [ ] Implement streaming response rendering
- [ ] Create citation list component
- [ ] Add tap-to-expand for full notes
- [ ] Loading states and error handling

## Phase 6: Visualization Features (Week 6-7)

### 6.1 Feed View
- [ ] Reverse chronological list
- [ ] Filter chips (tags, type, date)
- [ ] Search within feed
- [ ] Infinite scroll
- [ ] Pull-to-refresh

### 6.2 Timeline Heatband
- [ ] Calculate density metrics
- [ ] Build scrubber component
- [ ] Render heatmap visualization
- [ ] Add hover previews
- [ ] Click to navigate

### 6.3 Graph View
- [ ] Graph builder Lambda:
  - k-NN edge computation
  - UMAP dimensionality reduction
  - Monthly batch processing
- [ ] SceneKit 2D/3D renderer
- [ ] Interactive controls:
  - Pan/zoom
  - Node selection
  - Filter by tags
  - Cluster highlighting
- [ ] Export graph data to S3

## Phase 7: Production Hardening (Week 7-8)

### 7.1 Security
- [ ] Implement comprehensive encryption:
  - S3 SSE-KMS
  - DynamoDB encryption
  - TLS 1.2+ everywhere
- [ ] Add secret scanning in CI
- [ ] Implement audit logging
- [ ] Security group hardening
- [ ] Private VPC endpoints

### 7.2 Monitoring & Observability
- [ ] CloudWatch metrics:
  - Lambda performance
  - API latency
  - Error rates
  - Search performance
- [ ] Custom dashboards
- [ ] Alerts configuration:
  - DLQ messages > 0
  - Error rate > 1%
  - P95 latency breaches
- [ ] X-Ray tracing
- [ ] Log aggregation

### 7.3 Testing
- [ ] Unit tests (80% coverage target)
- [ ] Integration tests
- [ ] E2E test suite
- [ ] Performance benchmarks
- [ ] Load testing
- [ ] Chaos engineering scenarios

### 7.4 Documentation
- [ ] API documentation
- [ ] Deployment runbooks
- [ ] Troubleshooting guides
- [ ] Architecture diagrams
- [ ] User manual

## Phase 8: Future Enhancements (Post-MVP)

### 8.1 Authentication (M3)
- [ ] Replace API key with Cognito
- [ ] Implement JWT verification
- [ ] Add user isolation
- [ ] Multi-device sync

### 8.2 Advanced Features
- [ ] Collaborative spaces
- [ ] Mobile apps (iOS/iPadOS)
- [ ] Web interface
- [ ] External integrations:
  - Slack
  - Notion
  - Obsidian export
- [ ] Advanced visualizations
- [ ] ML-powered insights

## Success Metrics

### Performance Targets
- Capture latency: <150ms local, <1.2s sync
- Ask latency: <2.5s p95 end-to-end
- Indexing: <2s per note
- Availability: 99.9% uptime

### Quality Metrics
- Citation accuracy: >95%
- Search relevance: >0.8 NDCG
- Sync reliability: >99.99%
- Zero data loss

## Risk Mitigation

### Technical Risks
1. **OpenSearch costs**: Monitor usage, implement caching
2. **Embedding drift**: Version lock, reindex strategy
3. **Sync conflicts**: CRDT-like resolution
4. **Large notes**: Chunking strategy

### Operational Risks
1. **No auth in v1**: Rate limiting, API key rotation
2. **Data privacy**: Encryption, PII scrubbing
3. **Cost overruns**: Budget alerts, usage caps

## Timeline Summary

- **Weeks 1-2**: Foundation & local capture
- **Weeks 2-3**: AWS infrastructure
- **Weeks 3-4**: Sync pipeline
- **Weeks 4-5**: Intelligence layer
- **Weeks 5-6**: Retrieval & ask
- **Weeks 6-7**: Visualizations
- **Weeks 7-8**: Hardening & launch

Total: 8 weeks to MVP

## Definition of Done

- [ ] ⌥S captures thoughts locally and syncs
- [ ] ⌥F returns answers with citations
- [ ] Feed, Timeline, and Graph views functional
- [ ] All data encrypted at rest and in transit
- [ ] Monitoring and alerting configured
- [ ] Documentation complete
- [ ] Performance targets met
- [ ] Security audit passed