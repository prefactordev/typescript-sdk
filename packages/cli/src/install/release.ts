import type { InstallArch, InstallLibc, InstallPlatform, PlatformInfo } from './platform.js';

export type InstallChannel = 'stable' | 'latest' | 'pinned';

export interface ReleaseSpec {
  channel: InstallChannel;
  requestedVersion: string | null;
  resolvedTag: string;
  assetName: string;
  assetUrl: string;
  checksumUrl: string;
}

export const RELEASE_BASE_URL = 'https://github.com/prefactordev/typescript-sdk/releases/download';
export const RELEASE_LATEST_BASE_URL =
  'https://github.com/prefactordev/typescript-sdk/releases/latest/download';

export function normalizePinnedVersion(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) {
    throw new Error('Version must not be empty.');
  }

  const normalized = trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
  if (!/^v\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Invalid version '${version}'. Expected semver like 0.0.4 or v0.0.4.`);
  }

  return normalized;
}

export function resolveRequestedChannel(
  channel: 'stable' | 'latest' | undefined,
  version: string | undefined
): { channel: InstallChannel; requestedVersion: string | null } {
  if (version) {
    return {
      channel: 'pinned',
      requestedVersion: normalizePinnedVersion(version),
    };
  }

  return {
    channel: channel ?? 'stable',
    requestedVersion: null,
  };
}

function assetSuffix(platform: InstallPlatform, arch: InstallArch, libc: InstallLibc): string {
  if (platform === 'darwin') {
    return `darwin-${arch}`;
  }

  if (platform === 'windows') {
    return `windows-${arch}`;
  }

  if (libc === 'musl') {
    return `linux-${arch}-musl`;
  }

  return `linux-${arch}`;
}

function assetExtension(platform: InstallPlatform): string {
  return platform === 'windows' ? 'zip' : 'tar.gz';
}

export function buildAssetName(info: Pick<PlatformInfo, 'platform' | 'arch' | 'libc'>): string {
  return `prefactor-${assetSuffix(info.platform, info.arch, info.libc)}.${assetExtension(info.platform)}`;
}

export function buildReleaseSpec(
  info: Pick<PlatformInfo, 'platform' | 'arch' | 'libc'>,
  channel: 'stable' | 'latest' | undefined,
  version: string | undefined,
  baseUrl: string = RELEASE_BASE_URL,
  latestBaseUrl: string = RELEASE_LATEST_BASE_URL
): ReleaseSpec {
  const resolved = resolveRequestedChannel(channel, version);
  const assetName = buildAssetName(info);

  if (resolved.channel === 'stable') {
    return {
      channel: 'stable',
      requestedVersion: null,
      resolvedTag: '',
      assetName,
      assetUrl: `${latestBaseUrl}/${assetName}`,
      checksumUrl: `${latestBaseUrl}/SHA256SUMS`,
    };
  }

  if (resolved.channel === 'latest') {
    return {
      channel: 'latest',
      requestedVersion: null,
      resolvedTag: 'canary',
      assetName,
      assetUrl: `${baseUrl}/canary/${assetName}`,
      checksumUrl: `${baseUrl}/canary/SHA256SUMS`,
    };
  }

  return {
    channel: 'pinned',
    requestedVersion: resolved.requestedVersion,
    resolvedTag: resolved.requestedVersion ?? '',
    assetName,
    assetUrl: `${baseUrl}/${resolved.requestedVersion}/${assetName}`,
    checksumUrl: `${baseUrl}/${resolved.requestedVersion}/SHA256SUMS`,
  };
}

export function parseResolvedTagFromUrl(url: string): string | null {
  const match = /\/releases\/download\/([^/]+)\//.exec(url);
  return match?.[1] ?? null;
}
