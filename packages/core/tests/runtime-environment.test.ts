import { describe, expect, test } from 'bun:test';
import { buildRuntimeEnvironment } from '../src/runtime-environment.js';
import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/version.js';

describe('buildRuntimeEnvironment', () => {
  test('returns all four keys', () => {
    const result = buildRuntimeEnvironment();
    expect(Object.keys(result).sort()).toEqual(['agent_sdk', 'os', 'prefactor_sdk', 'runtime']);
  });

  test('os matches process.platform', () => {
    const result = buildRuntimeEnvironment();
    const expected = process.platform === 'win32' ? 'windows' : process.platform;
    expect(result.os).toBe(expected);
  });

  test('runtime identifies the JavaScript runtime', () => {
    const result = buildRuntimeEnvironment();
    expect(result.runtime).toMatch(/^(node|bun|deno)@.+/);
  });

  test('prefactor_sdk includes the core package', () => {
    const result = buildRuntimeEnvironment();
    expect(result.prefactor_sdk).toEqual([`${PACKAGE_NAME}@${PACKAGE_VERSION}`]);
  });

  test('agent_sdk is empty without a header', () => {
    const result = buildRuntimeEnvironment();
    expect(result.agent_sdk).toEqual([]);
  });

  test('agent_sdk is empty with an undefined header', () => {
    const result = buildRuntimeEnvironment(undefined);
    expect(result.agent_sdk).toEqual([]);
  });

  test('agent_sdk parses a single upstream entry', () => {
    const result = buildRuntimeEnvironment('@prefactor/langchain@2.0.0');
    expect(result.agent_sdk).toEqual(['@prefactor/langchain@2.0.0']);
  });

  test('agent_sdk parses multiple upstream entries', () => {
    const result = buildRuntimeEnvironment('@prefactor/langchain@2.0.0 my-framework@1.0.0');
    expect(result.agent_sdk).toEqual(['@prefactor/langchain@2.0.0', 'my-framework@1.0.0']);
  });

  test('agent_sdk strips the core self-entry', () => {
    const result = buildRuntimeEnvironment(`${PACKAGE_NAME}@${PACKAGE_VERSION}`);
    expect(result.agent_sdk).toEqual([]);
  });

  test('agent_sdk strips the core self-entry from a chained header', () => {
    const result = buildRuntimeEnvironment(
      `@prefactor/langchain@2.0.0 ${PACKAGE_NAME}@${PACKAGE_VERSION}`
    );
    expect(result.agent_sdk).toEqual(['@prefactor/langchain@2.0.0']);
  });

  test('agent_sdk handles surrounding whitespace', () => {
    const result = buildRuntimeEnvironment('  @prefactor/langchain@2.0.0   ');
    expect(result.agent_sdk).toEqual(['@prefactor/langchain@2.0.0']);
  });
});
