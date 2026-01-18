/**
 * Smart ID generation for Obsidian-friendly filenames.
 * Format: {prefix}-{slug}-{shortId}
 *
 * Examples:
 * - t-use-redis-caching-a1b2.md
 * - conv-api-design-discussion-e5f6.md
 */

/**
 * Generate a smart ID from text content and UUID.
 * @param text - The text to slugify (first 4 words used)
 * @param uuid - The full UUID (last 4 chars used)
 * @param prefix - 't' for thoughts, 'conv' for conversations
 * @returns Smart ID string (e.g., "t-use-redis-caching-a1b2")
 */
export function generateSmartId(
  text: string,
  uuid: string,
  prefix: 't' | 'conv'
): string {
  // Slugify: lowercase, remove special chars, take first 4 words
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .slice(0, 4)
    .join('-')
    .substring(0, 30); // Cap total slug length

  // Extract last 4 characters of UUID (without hyphens)
  const cleanUuid = uuid.replace(/-/g, '');
  const shortId = cleanUuid.slice(-4);

  // Handle edge case of empty slug
  if (!slug) {
    return `${prefix}-untitled-${shortId}`;
  }

  return `${prefix}-${slug}-${shortId}`;
}

/**
 * Generate smart ID for a thought.
 */
export function generateThoughtSmartId(text: string, id: string): string {
  // Extract UUID portion from thought ID (e.g., "t_abc123..." -> "abc123...")
  const uuid = id.startsWith('t_') ? id.substring(2) : id;
  return generateSmartId(text, uuid, 't');
}

/**
 * Generate smart ID for a conversation.
 */
export function generateConversationSmartId(title: string, id: string): string {
  // Extract UUID portion from conversation ID (e.g., "conv_xyz789..." -> "xyz789...")
  const uuid = id.startsWith('conv_') ? id.substring(5) : id;
  return generateSmartId(title, uuid, 'conv');
}
