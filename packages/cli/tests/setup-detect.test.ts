import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectSuggestedIntegration } from '../src/commands/setup-detect.js';

describe('detectSuggestedIntegration', () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot && tempRoot.startsWith(tmpdir())) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('suggests prefactor-langchain from pyproject.toml with pinned and extras deps', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-setup-detect-'));
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'pyproject.toml'),
      `[project]
name = "demo"
dependencies = [
  "langchain>=0.1.0",
  "pydantic[dotenv]>=2.0",
]
`
    );

    expect(detectSuggestedIntegration(cwd)).toEqual({
      language: 'python',
      suggested_package: 'prefactor-langchain',
    });
  });

  test('suggests prefactor-livekit from pyproject.toml with extras deps', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'prefactor-setup-detect-'));
    const cwd = join(tempRoot, 'cwd');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(
      join(cwd, 'pyproject.toml'),
      `[project]
name = "demo"
dependencies = [
  "livekit-agents[openai]>=0.12",
]
`
    );

    expect(detectSuggestedIntegration(cwd)).toEqual({
      language: 'python',
      suggested_package: 'prefactor-livekit',
    });
  });
});
