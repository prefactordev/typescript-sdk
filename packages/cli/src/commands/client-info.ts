import { hostname } from 'node:os';
import { detectPlatformInfo } from '../install/platform.js';

export function clientPlatform(): string | undefined {
  try {
    const info = detectPlatformInfo();
    return `${info.platform}-${info.arch}`;
  } catch {
    return undefined;
  }
}

export function clientHostname(): string | undefined {
  const value = hostname().trim();
  return value.length > 0 ? value : undefined;
}
