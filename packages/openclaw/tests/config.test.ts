import { afterEach, describe, expect, test } from 'bun:test';
import { resolveConfig } from '../src/config.js';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('resolveConfig', () => {
  test('uses env http credentials when missing from config', () => {
    process.env.PREFACTOR_API_URL = 'https://api.prefactor.ai';
    process.env.PREFACTOR_API_TOKEN = 'env-token';

    const config = resolveConfig({ transportType: 'http' });

    expect(config?.httpConfig?.apiUrl).toBe('https://api.prefactor.ai');
    expect(config?.httpConfig?.apiToken).toBe('env-token');
  });

  test('prefers explicit httpConfig over env', () => {
    process.env.PREFACTOR_API_URL = 'https://api.prefactor.ai';
    process.env.PREFACTOR_API_TOKEN = 'env-token';

    const config = resolveConfig({
      transportType: 'http',
      httpConfig: { apiUrl: 'https://example.com', apiToken: 'config-token' },
    });

    expect(config?.httpConfig?.apiUrl).toBe('https://example.com');
    expect(config?.httpConfig?.apiToken).toBe('config-token');
  });

  test('returns null when http transport is missing credentials', () => {
    delete process.env.PREFACTOR_API_URL;
    delete process.env.PREFACTOR_API_TOKEN;

    const config = resolveConfig({ transportType: 'http' });

    expect(config).toBeNull();
  });
});
