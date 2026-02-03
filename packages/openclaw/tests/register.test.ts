import { describe, expect, test } from 'bun:test';
import { register } from '../src/init.js';

describe('register', () => {
  test('register wires expected hooks', () => {
    const calls: string[] = [];
    const api = {
      on: (name: string, handler: () => void) => {
        calls.push(name);
        return handler;
      },
      config: { plugins: { entries: { 'prefactor-observability': { config: {} } } } },
      logger: { info: () => {}, error: () => {}, debug: () => {} },
    } as any;

    register(api);

    expect(calls).toContain('before_agent_start');
    expect(calls).toContain('after_tool_call');
    expect(calls).toContain('message_received');
  });
});
