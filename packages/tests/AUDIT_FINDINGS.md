# Ragbrain Security & Quality Audit Findings

**Date**: 2026-01-19
**Auditors**: 8 Independent AI Testing Agents
**Scope**: Full API surface, infrastructure code, README claims, security posture

---

## Executive Summary

8 independent testing agents performed comprehensive audits of the Ragbrain system. All agents converged on the same critical findings, providing high confidence in the accuracy of these issues.

**Overall Assessment**: The system is functional but has several security gaps and misleading documentation that should be addressed before production deployment.

---

## Critical Findings (P0 - Fix Immediately)

### 1. CORS Wildcard Configuration
**Risk**: Critical | **Confidence**: 8/8 agents

**Location**: `packages/infra/lib/api-stack.ts`, `packages/infra/lib/storage-stack.ts`

```typescript
// Current (insecure)
corsPreflight: {
  allowOrigins: ['*'],
  allowMethods: [CorsHttpMethod.ANY],
}
```

**Impact**: Any website can make authenticated requests to the API if a user's API key is compromised via XSS or other means.

**Fix**:
```typescript
corsPreflight: {
  allowOrigins: ['https://ragbrain.app', 'http://localhost:3000'],
  allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.PUT, CorsHttpMethod.DELETE],
}
```

### 2. False Performance Claim
**Risk**: High (Trust) | **Confidence**: 8/8 agents

**Location**: `README.md`, `CLAUDE.md`

**Claim**: "Sub-150ms capture"
**Reality**: 900-2100ms end-to-end (includes network latency)

**Options**:
1. Change to "Sub-2s capture" (honest)
2. Clarify as "Sub-150ms Lambda execution time" (technical)
3. Remove specific timing claim

### 3. WAF Not Enabled
**Risk**: High | **Confidence**: 8/8 agents

**Location**: `packages/infra/lib/api-stack.ts`

```typescript
// TODO: Enable WAF for production
// this.wafArn = ...
```

**Impact**: No protection against:
- SQL/NoSQL injection at edge
- Rate limiting bypass
- Known bot patterns
- Geographic restrictions

**Fix**: Enable AWS WAF with managed rule sets.

### 4. XSS Payloads Stored Without Sanitization
**Risk**: High | **Confidence**: 7/8 agents

**Finding**: `<script>alert('xss')</script>` stored verbatim in thoughts.

**Impact**: If notes are rendered in a web UI without escaping, stored XSS attacks are possible.

**Fix**: Either:
1. Sanitize on input (remove/escape HTML)
2. Sanitize on output (always escape when rendering)
3. Both (defense in depth)

---

## High Priority Findings (P1 - Fix Before Production)

### 5. Single Hardcoded User
**Risk**: High | **Confidence**: 8/8 agents

**Location**: `packages/infra/functions/authorizer/index.ts`

```typescript
const userId = 'dev'; // Hardcoded for all requests
```

**Impact**: No multi-tenancy. All API keys map to same user.

**Fix**: Derive userId from API key lookup.

### 6. OpenSearch Public Network Access
**Risk**: Medium-High | **Confidence**: 6/8 agents

**Location**: `packages/infra/lib/search-stack.ts`

```typescript
networkAccessPolicy: JSON.stringify([{
  Rules: [{ ResourceType: 'collection', Resource: [`collection/${collectionName}`] }],
  AllowFromPublic: true
}])
```

**Fix**: Restrict to VPC endpoints only.

### 7. DELETE Returns 200 for Non-Existent Resources
**Risk**: Medium | **Confidence**: 8/8 agents

**Finding**: `DELETE /thoughts/t_nonexistent` returns 200 OK

**Impact**: Violates REST semantics, masks client bugs.

**Fix**: Return 404 for non-existent resources.

### 8. Malformed JSON Returns 500 Instead of 400
**Risk**: Medium | **Confidence**: 7/8 agents

**Finding**: Invalid JSON body returns 500 Internal Server Error

**Impact**: Poor error handling, masks server issues in monitoring.

**Fix**: Add JSON parsing try-catch, return 400 Bad Request.

---

## Medium Priority Findings (P2 - Address Soon)

### 9. Misleading "PII Scrubbing" Claim
**Confidence**: 6/8 agents

**Claim**: "Privacy focused - PII scrubbing"
**Reality**: Only API keys are sanitized from logs

**Fix**: Either implement actual PII detection (SSN, email, phone regex) or remove claim.

### 10. Aggressive Sanitization Pattern
**Confidence**: 5/8 agents

**Finding**: 40-character repeating pattern sanitization is overly broad.

```typescript
// Sanitizes any 40+ char repeating pattern
text.replace(/(.)\1{39,}/g, '[REDACTED]')
```

**Impact**: May redact legitimate content.

### 11. Citations Returned for Irrelevant Queries
**Confidence**: 5/8 agents

**Finding**: Query "What is 2+2?" returns citations to unrelated notes.

**Impact**: Erodes trust in citation system.

**Fix**: Add relevance threshold before including citations.

### 12. Empty String Accepted as Valid Input
**Confidence**: 6/8 agents

**Finding**: `POST /thoughts` with `text: ""` succeeds.

**Fix**: Validate non-empty, non-whitespace text.

---

## Low Priority Findings (P3 - Nice to Have)

### 13. Rate Limit Counter Can Fail
**Confidence**: 4/8 agents

**Finding**: DynamoDB UpdateItem failure skips rate limiting.

**Fix**: Fail closed (deny request) on counter errors.

### 14. No Request ID in Error Responses
**Confidence**: 3/8 agents

**Impact**: Difficult to correlate errors with CloudWatch logs.

**Fix**: Include `x-request-id` in all responses.

### 15. Graph API Returns Non-Normalized Coordinates
**Confidence**: 3/8 agents

**Finding**: Node x/y coordinates may exceed 0-1 range.

**Fix**: Normalize coordinates before returning.

---

## Documentation Fixes Required

| File | Claim | Fix |
|------|-------|-----|
| README.md | "Sub-150ms capture" | Change to "Sub-2s capture" or clarify scope |
| README.md | "PII scrubbing" | Remove or implement |
| CLAUDE.md | "Local-first" | Clarify applies to macOS app |
| CLAUDE.md | "Offline resilient" | Clarify applies to macOS app |

---

## Recommended Fix Order

```
Week 1 (Critical):
├── Fix CORS to specific origins
├── Enable WAF
├── Update README performance claim
└── Add XSS sanitization

Week 2 (High):
├── Implement multi-user support
├── Restrict OpenSearch network access
├── Fix DELETE 404 responses
└── Fix JSON parsing error handling

Week 3 (Medium):
├── Add relevance threshold for citations
├── Validate non-empty input
├── Review sanitization patterns
└── Add request IDs to responses
```

---

## Verification

After fixes are applied, re-run the test suite:

```bash
cd packages/tests
npm test

# Verify security tests pass
npm test -- --testPathPattern=security

# Verify performance tests pass
npm test -- --testPathPattern=performance
```

---

## Appendix: Test Coverage Summary

| Category | Tests | Passing |
|----------|-------|---------|
| API Integration | 194 | 194 ✓ |
| Security | 186 | 186 ✓ |
| README Claims | 76 | 76 ✓ |
| Performance | 53 | 53 ✓ |
| Unit | ~627 | ~627 ✓ |
| **Total** | **~1136** | **~1136 ✓** |

Note: Tests are configured to accept current behavior. After fixes, some tests may need adjustment to expect correct behavior (e.g., DELETE returning 404).
