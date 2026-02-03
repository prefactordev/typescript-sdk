import { afterEach, describe, expect, test } from 'bun:test';
import { init, shutdown } from '../src/init.js';

describe('init/shutdown', () => {
  afterEach(async () => {
    await shutdown();
  });

  test('returns null when http config missing credentials', () => {
    const plugin = init({ transportType: 'http' });
    expect(plugin).toBeNull();
  });

  test('returns runtime helpers when config is valid', () => {
    const plugin = init({
      transportType: 'http',
      httpConfig: { apiUrl: 'https://example.com', apiToken: 'token' },
    });

    expect(plugin?.tracer).toBeDefined();
    expect(plugin?.agentManager).toBeDefined();
    expect(plugin?.config.transportType).toBe('http');
  });
});
