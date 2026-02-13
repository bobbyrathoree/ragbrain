import { ThoughtType } from '../types/thought';

export function validateThoughtText(text: string): boolean {
  return text.length > 0 && text.length <= 50000;
}

export function validateTags(tags: string[]): boolean {
  return (
    tags.length <= 20 &&
    tags.every(tag => 
      tag.length > 0 && 
      tag.length <= 50 && 
      /^[a-zA-Z0-9_-]+$/.test(tag)
    )
  );
}

export function validateThoughtType(type: string): boolean {
  return Object.values(ThoughtType).includes(type as ThoughtType);
}

export function detectThoughtType(text: string): ThoughtType {
  const lowerText = text.toLowerCase();

  // Code detection - fences or common syntax patterns
  if (
    text.includes('```') ||
    text.includes('const ') ||
    text.includes('function ') ||
    text.includes('import ') ||
    text.includes('export ') ||
    text.includes('=>') ||
    /^(const|let|var|function|class|interface|type)\s/.test(text)
  ) {
    return ThoughtType.CODE;
  }

  // Link detection
  if (/https?:\/\//.test(text)) {
    return ThoughtType.LINK;
  }

  // Todo detection - explicit flag or word-boundary match
  if (text.includes('!todo') || /\btodo\b/i.test(text) || text.includes('[ ]')) {
    return ThoughtType.TODO;
  }

  // Decision detection - explicit flag or strong decision-intent keywords
  const hasDecisionFlag = text.includes('!decision');
  const hasDecisionIntent = /\b(decided|decision|chose|choosing|going with|opted for|picked|settled on)\b/i.test(lowerText);
  const hasComparison = /\b(vs\.?|versus|compared to|instead of|rather than)\b/i.test(lowerText);
  if (hasDecisionFlag || hasDecisionIntent || (hasComparison && /\b(going with|chose|decided|picked|choosing|opted|selected)\b/i.test(lowerText))) {
    return ThoughtType.DECISION;
  }

  // Rationale detection - explicit flag only ("because" alone is far too broad)
  if (text.includes('!rationale')) {
    return ThoughtType.RATIONALE;
  }

  return ThoughtType.NOTE;
}

export function extractTags(text: string): string[] {
  const tagPattern = /#(\w+)/g;
  const matches = text.matchAll(tagPattern);
  const tags = new Set<string>();
  
  for (const match of matches) {
    tags.add(match[1].toLowerCase());
  }
  
  return Array.from(tags);
}

export function sanitizeText(text: string): string {
  // Remove potential secrets and sensitive data
  const patterns = [
    /sk-[a-zA-Z0-9]{48}/g, // OpenAI API keys
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub tokens
    /npm_[a-zA-Z0-9]{36}/g, // npm tokens
    /AKIA[0-9A-Z]{16}/g, // AWS access keys
    /[a-zA-Z0-9]{40}/g, // Generic API keys (be careful with this)
  ];
  
  let sanitized = text;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  
  return sanitized;
}

/**
 * Escape HTML entities to prevent XSS attacks.
 * Use this when rendering user-generated content in HTML contexts.
 */
export function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => htmlEntities[char]);
}

export function calculateDecisionScore(text: string): number {
  let score = 0;
  
  // Keywords that indicate decision-making
  const decisionKeywords = [
    'decided', 'chose', 'selected', 'picked',
    'because', 'rationale', 'reason', 'tradeoff',
    'pros', 'cons', 'alternative', 'option',
    'instead of', 'rather than', 'over',
  ];
  
  const lowerText = text.toLowerCase();
  for (const keyword of decisionKeywords) {
    if (lowerText.includes(keyword)) {
      score += 0.1;
    }
  }
  
  // Flags increase score
  if (text.includes('!decision')) score += 0.3;
  if (text.includes('!rationale')) score += 0.2;
  
  return Math.min(score, 1.0);
}