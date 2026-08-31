import { afterEach, describe, expect, test } from 'bun:test';
import type { AgentSchemaVersion, SpanTypeSchema } from '@prefactor/core';
import { Agent } from '../src/agent.js';
import { createLogger } from '../src/logger.js';
import { getAllSupportedToolDefinitions } from '../src/tool-definitions.js';

const FINISH_MARKERS: Record<string, string[]> = {
  read: ['{% if output %}', '{% if isError %}'],
  write: ['{% if output %}', '{% if isError %}'],
  edit: ['{% if output %}', '{% if isError %}'],
  exec: ['output.exitCode', '{% if isError %}'],
  web_search: ['output.results', '{% if isError %}'],
  web_fetch: ['{% if output %}', '{% if isError %}'],
  browser: ['output.success', 'isError'],
};

const INPUT_MARKERS: Record<string, string[]> = {
  read: ['input.file_path', 'input.path'],
  write: ['input.path'],
  edit: ['input.path'],
  exec: ['input.command'],
  web_search: ['input.query'],
  web_fetch: ['input.url'],
  browser: ['input.action'],
};

describe('supported tool span templates', () => {
  let agent: Agent | undefined;

  afterEach(() => {
    agent?.stop();
  });

  test('buildSupportedToolSchemas emits input and finish fields for each supported tool', () => {
    agent = new Agent(
      {
        apiUrl: 'https://example.com',
        apiToken: 'test-token',
        agentId: 'agent-1',
      },
      createLogger('error')
    );

    const schemaVersion = (agent as unknown as { agentSchemaVersion: AgentSchemaVersion })
      .agentSchemaVersion;
    const schemasByName = new Map(
      (schemaVersion.span_type_schemas ?? []).map((schema: SpanTypeSchema) => [schema.name, schema])
    );

    for (const toolName of Object.keys(getAllSupportedToolDefinitions())) {
      const schema = schemasByName.get(`openclaw:tool:${toolName}`);
      expect(schema).toBeDefined();

      const template = schema?.template ?? '';
      expect(template.length).toBeGreaterThan(0);

      for (const marker of INPUT_MARKERS[toolName] ?? []) {
        expect(template).toContain(marker);
      }

      for (const marker of FINISH_MARKERS[toolName] ?? []) {
        expect(template).toContain(marker);
      }
    }
  });
});
