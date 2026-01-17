export function parseTimeWindow(window: string): Date {
  const now = new Date();

  // Handle named windows
  switch (window.toLowerCase()) {
    case 'today':
      now.setHours(0, 0, 0, 0);
      return now;
    case 'week':
      now.setDate(now.getDate() - 7);
      return now;
    case 'month':
      now.setMonth(now.getMonth() - 1);
      return now;
    case 'year':
      now.setFullYear(now.getFullYear() - 1);
      return now;
  }

  // Handle numeric format (e.g., "7d", "30d", "1m", "1y")
  const match = window.match(/^(\d+)([dwmy])$/);

  if (!match) {
    throw new Error(`Invalid time window format: ${window}`);
  }

  const [, amount, unit] = match;
  const value = parseInt(amount, 10);

  switch (unit) {
    case 'd':
      now.setDate(now.getDate() - value);
      break;
    case 'w':
      now.setDate(now.getDate() - value * 7);
      break;
    case 'm':
      now.setMonth(now.getMonth() - value);
      break;
    case 'y':
      now.setFullYear(now.getFullYear() - value);
      break;
  }

  return now;
}

export function calculateRecencyScore(date: Date): number {
  const now = Date.now();
  const timestamp = date.getTime();
  const daysSince = (now - timestamp) / (1000 * 60 * 60 * 24);
  
  // Exponential decay: recent items score higher
  return Math.exp(-daysSince / 30); // Half-life of ~30 days
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const timestamp = date.getTime();
  const seconds = Math.floor((now - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
  return `${Math.floor(seconds / 31536000)}y ago`;
}

export function getDateRange(period: 'day' | 'week' | 'month' | 'year'): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  
  switch (period) {
    case 'day':
      from.setDate(from.getDate() - 1);
      break;
    case 'week':
      from.setDate(from.getDate() - 7);
      break;
    case 'month':
      from.setMonth(from.getMonth() - 1);
      break;
    case 'year':
      from.setFullYear(from.getFullYear() - 1);
      break;
  }
  
  return { from, to };
}