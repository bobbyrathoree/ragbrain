import type { ThoughtType } from '@/types'

export function detectType(content: string): ThoughtType {
  const text = content.toLowerCase()

  // Code detection
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

  // Link detection
  if (
    text.startsWith('http://') ||
    text.startsWith('https://') ||
    text.includes('www.')
  ) {
    return 'link'
  }

  // Todo detection
  if (
    text.includes('todo:') ||
    text.includes('[ ]') ||
    text.includes('- [ ]') ||
    text.startsWith('remember to') ||
    text.startsWith('need to') ||
    text.startsWith('don\'t forget')
  ) {
    return 'todo'
  }

  // Decision detection
  if (
    text.includes('decided') ||
    text.includes('decision') ||
    text.includes('chose') ||
    text.includes('going with') ||
    text.includes('vs') ||
    text.includes(' or ')
  ) {
    return 'decision'
  }

  // Insight detection
  if (
    text.includes('realized') ||
    text.includes('insight') ||
    text.includes('learned') ||
    text.includes('interesting') ||
    text.includes('key takeaway') ||
    text.includes('the key')
  ) {
    return 'insight'
  }

  return 'thought'
}
