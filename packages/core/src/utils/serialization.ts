/**
 * Truncate a string to a maximum length, adding an ellipsis if truncated
 *
 * @param value - The string to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 */
export function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}... [truncated]`;
}

/**
 * Serialize a value for JSON output, handling non-serializable types and
 * truncating long strings
 *
 * @param value - Value to serialize
 * @param maxLength - Maximum length for strings (null for no truncation)
 * @returns Serialized value
 *
 * @example
 * ```typescript
 * const serialized = serializeValue({ message: 'Hello'.repeat(1000) }, 100);
 * // Result: { message: 'HelloHelloHello... [truncated]' }
 * ```
 */
export function serializeValue(value: unknown, maxLength: number | null = 10000): unknown {
  // Handle primitives that don't need serialization
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  // Handle strings with truncation
  if (typeof value === 'string') {
    return maxLength !== null ? truncateString(value, maxLength) : value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, maxLength));
  }

  // Handle objects
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeValue(val, maxLength);
    }
    return result;
  }

  // Handle other types by converting to string
  try {
    return String(value);
  } catch {
    return `<${typeof value} object>`;
  }
}
