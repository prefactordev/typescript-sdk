import { PACKAGE_NAME, PACKAGE_VERSION } from '../../version.js';

/** @internal */
export const DEFAULT_SDK_REQUEST_HEADER = formatSdkHeaderEntry(PACKAGE_NAME, PACKAGE_VERSION);

/** @internal */
export function buildSdkRequestHeader(...entries: Array<string | null | undefined>): string {
  const parts = [
    ...entries
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => normalizeSdkHeaderEntry(entry)),
    DEFAULT_SDK_REQUEST_HEADER,
  ];
  return Array.from(new Set(parts)).join(' ');
}

function normalizeSdkHeaderEntry(entry: string): string {
  const atIndex = entry.lastIndexOf('@');
  if (atIndex <= 0) {
    return entry.replace(/^@+/, '');
  }

  const packageName = entry.slice(0, atIndex).replace(/^@+/, '');
  const version = entry.slice(atIndex + 1);
  return version ? `${packageName}@${version}` : packageName;
}

function formatSdkHeaderEntry(packageName: string, version: string): string {
  return `${packageName.replace(/^@+/, '')}@${version}`;
}
