import { PACKAGE_NAME, PACKAGE_VERSION } from './version.js';

export const DEFAULT_SDK_HEADER = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;

export function buildSdkHeader(...entries: Array<string | null | undefined>): string {
  const parts = [...entries.filter((entry): entry is string => Boolean(entry)), DEFAULT_SDK_HEADER];
  return Array.from(new Set(parts)).join(' ');
}
