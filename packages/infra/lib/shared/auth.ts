import { timingSafeEqual } from 'node:crypto';

export interface ApiCredential {
  key: string;
  userId: string;
}

interface SecretKeyEntry {
  key?: unknown;
  userId?: unknown;
}

interface SecretPayload {
  key?: unknown;
  userId?: unknown;
  keys?: unknown;
  users?: unknown;
}

const USER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,128}$/;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeUserId(value: unknown): string {
  const userId = asNonEmptyString(value);
  if (!userId || !USER_ID_PATTERN.test(userId)) {
    throw new Error('API key secret contains an invalid userId');
  }
  return userId;
}

function normalizeCredential(
  key: unknown,
  userId: unknown,
  fallbackUserId?: string,
): ApiCredential {
  const normalizedKey = asNonEmptyString(key);
  if (!normalizedKey) {
    throw new Error('API key secret contains an empty key');
  }

  const normalizedUserId = userId == null
    ? normalizeUserId(fallbackUserId)
    : normalizeUserId(userId);

  return {
    key: normalizedKey,
    userId: normalizedUserId,
  };
}

function normalizeCredentialMap(
  value: Record<string, unknown>,
  credentials: ApiCredential[],
): void {
  for (const [userId, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      credentials.push(normalizeCredential(entry, userId));
      continue;
    }

    if (entry && typeof entry === 'object') {
      const candidate = entry as SecretKeyEntry;
      credentials.push(normalizeCredential(candidate.key, candidate.userId ?? userId));
      continue;
    }

    throw new Error('API key secret contains an invalid credential mapping');
  }
}

export function parseApiKeySecret(secretString: string): ApiCredential[] {
  const parsed = JSON.parse(secretString) as SecretPayload;
  const credentials: ApiCredential[] = [];

  if (asNonEmptyString(parsed.key)) {
    credentials.push(normalizeCredential(parsed.key, parsed.userId ?? 'dev'));
  }

  if (Array.isArray(parsed.keys)) {
    for (const entry of parsed.keys) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('API key secret contains an invalid keys array entry');
      }

      const candidate = entry as SecretKeyEntry;
      credentials.push(normalizeCredential(candidate.key, candidate.userId));
    }
  } else if (parsed.keys && typeof parsed.keys === 'object') {
    normalizeCredentialMap(parsed.keys as Record<string, unknown>, credentials);
  }

  if (parsed.users && typeof parsed.users === 'object' && !Array.isArray(parsed.users)) {
    normalizeCredentialMap(parsed.users as Record<string, unknown>, credentials);
  }

  if (credentials.length === 0) {
    throw new Error('API key secret does not contain any credentials');
  }

  return credentials;
}

export function getApiKeyFromHeaders(headers: Record<string, string | undefined>): string | null {
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() !== 'x-api-key') continue;
    const apiKey = asNonEmptyString(value);
    if (apiKey) {
      return apiKey;
    }
  }

  return null;
}

export function resolveCredentialForApiKey(
  apiKey: string,
  credentials: ApiCredential[],
): ApiCredential | null {
  const provided = Buffer.from(apiKey);

  for (const credential of credentials) {
    const expected = Buffer.from(credential.key);
    if (provided.length !== expected.length) {
      continue;
    }

    if (timingSafeEqual(provided, expected)) {
      return credential;
    }
  }

  return null;
}
