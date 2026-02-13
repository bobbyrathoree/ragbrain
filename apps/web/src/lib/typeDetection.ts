import type { ThoughtType } from '@/types'

export function detectType(content: string): ThoughtType {
  const text = content.toLowerCase()

  // Code detection - check for code fences, common syntax patterns
  if (
    content.includes('```') ||
    content.includes('const ') ||
    content.includes('function ') ||
    content.includes('import ') ||
    content.includes('export ') ||
    content.includes('=>') ||
    /^(const|let|var|function|class|interface|type)\s/.test(content)
  ) {
    return 'code'
  }

  // Link detection - URLs anywhere in text
  if (/https?:\/\/\S+/.test(text) || text.includes('www.')) {
    return 'link'
  }

  // Todo detection - explicit markers and strong action phrases
  if (
    /\btodo\b/.test(text) ||
    text.includes('[ ]') ||
    text.includes('- [ ]') ||
    text.startsWith('remember to ') ||
    text.startsWith('don\'t forget to ')
  ) {
    return 'todo'
  }

  // Decision detection - require strong decision-intent keywords
  // "or" and "vs" alone are far too broad (match casual sentences)
  const hasDecisionIntent = /\b(decided|decision|chose|choosing|going with|opted for|picked|settled on)\b/.test(text)
  const hasComparison = /\b(vs\.?|versus|compared to|instead of|rather than|over)\b/.test(text)
  if (hasDecisionIntent || (hasComparison && /\b(going with|chose|decided|picked|choosing|opted|selected)\b/.test(text))) {
    return 'decision'
  }

  // Insight detection - learning and realization keywords
  if (
    /\brealized\b/.test(text) ||
    /\binsight\b/.test(text) ||
    /\blearned\b/.test(text) ||
    /\bkey takeaway\b/.test(text) ||
    /\bturns out\b/.test(text) ||
    /\bdiscovered that\b/.test(text) ||
    /\btil\b/.test(text)
  ) {
    return 'insight'
  }

  return 'thought'
}
