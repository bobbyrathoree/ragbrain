export function extractTags(content: string): string[] {
  // Extract hashtags
  const hashtags = content.match(/#\w+/g) || []
  const tags = hashtags.map((t) => t.slice(1).toLowerCase())

  // Remove duplicates
  return [...new Set(tags)]
}
