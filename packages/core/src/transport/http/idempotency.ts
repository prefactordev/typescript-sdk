const MAX_KEY_LENGTH = 64;

export function ensureIdempotencyKey(key?: string): string {
  if (key === undefined) {
    return crypto.randomUUID();
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`idempotency_key must be ≤${MAX_KEY_LENGTH} characters, got ${key.length}`);
  }
  return key;
}
