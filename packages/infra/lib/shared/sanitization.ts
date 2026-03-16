import { escapeHtml } from '@ragbrain/shared';

export function sanitizeHighlightSnippet(snippet?: string): string | undefined {
  if (!snippet) return undefined;

  return snippet
    .split(/(<mark>|<\/mark>)/g)
    .map(part => {
      if (part === '<mark>' || part === '</mark>') {
        return part;
      }

      return escapeHtml(part);
    })
    .join('');
}
