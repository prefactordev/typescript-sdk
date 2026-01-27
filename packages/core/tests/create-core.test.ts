import { describe, expect, test } from 'bun:test';
import { createCore } from '../src/create-core.js';
import { createConfig } from '../src/config.js';

describe('createCore', () => {
  test('requires agentVersion when using HTTP transport', () => {
    const config = createConfig({
      transportType: 'http',
      httpConfig: {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
      },
    });

    expect(() => createCore(config)).toThrowError(
      new Error('HTTP transport requires agentVersion to be provided in httpConfig.')
    );
  });
});
