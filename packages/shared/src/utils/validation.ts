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
  if (text.includes('```')) {
    return ThoughtType.CODE;
  }
  if (text.match(/https?:\/\//)) {
    return ThoughtType.LINK;
  }
  if (text.includes('!todo')) {
    return ThoughtType.TODO;
  }
  if (text.includes('!decision')) {
    return ThoughtType.DECISION;
  }
  if (text.includes('!rationale') || text.includes('because')) {
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