import { describe, expect, test } from 'bun:test';
import {
  buildToolSpanSchema,
  createToolSpanInputs,
  createToolSpanOutputs,
  createToolSpanResultPayload,
  GENERIC_OBJECT_SCHEMA,
} from '../src/tool-span-contract.js';

describe('Tool Span Contract', () => {
  describe('GENERIC_OBJECT_SCHEMA', () => {
    test('should be a valid JSON schema', () => {
      expect(GENERIC_OBJECT_SCHEMA.type).toBe('object');
      expect(GENERIC_OBJECT_SCHEMA.additionalProperties).toBe(true);
    });
  });

  describe('createToolSpanInputs', () => {
    test('should create basic inputs with tool name', () => {
      const inputs = createToolSpanInputs({ toolName: 'read' });

      expect(inputs).toEqual({
        'openclaw.tool.name': 'read',
        toolName: 'read',
      });
    });

    test('should include toolCallId when provided', () => {
      const inputs = createToolSpanInputs({
        toolName: 'exec',
        toolCallId: 'call_123',
      });

      expect(inputs).toEqual({
        'openclaw.tool.name': 'exec',
        toolName: 'exec',
        toolCallId: 'call_123',
      });
    });

    test('should include input when provided', () => {
      const toolInput = { path: '/test/file.txt' };
      const inputs = createToolSpanInputs({
        toolName: 'read',
        input: toolInput,
      });

      expect(inputs).toEqual({
        'openclaw.tool.name': 'read',
        toolName: 'read',
        input: toolInput,
      });
    });

    test('should include all optional fields when provided', () => {
      const toolInput = { command: 'ls -la', workdir: '/home' };
      const inputs = createToolSpanInputs({
        toolName: 'exec',
        toolCallId: 'call_456',
        input: toolInput,
      });

      expect(inputs).toEqual({
        'openclaw.tool.name': 'exec',
        toolName: 'exec',
        toolCallId: 'call_456',
        input: toolInput,
      });
    });

    test('should handle empty input', () => {
      const inputs = createToolSpanInputs({
        toolName: 'browser',
        input: {},
      });

      expect(inputs.input).toEqual({});
    });

    test('should handle complex nested input', () => {
      const toolInput = {
        action: 'navigate',
        url: 'https://example.com',
        target: 'sandbox',
        timeoutMs: 5000,
      };
      const inputs = createToolSpanInputs({
        toolName: 'browser',
        toolCallId: 'call_789',
        input: toolInput,
      });

      expect(inputs.input).toEqual(toolInput);
    });

    test('should handle undefined input', () => {
      const inputs = createToolSpanInputs({ toolName: 'write' });

      expect(inputs).not.toHaveProperty('input');
    });
  });

  describe('createToolSpanOutputs', () => {
    test('should wrap output in output field', () => {
      const result = createToolSpanOutputs('file content here');

      expect(result).toEqual({
        output: 'file content here',
      });
    });

    test('should handle null output', () => {
      const result = createToolSpanOutputs(null);

      expect(result).toEqual({
        output: null,
      });
    });

    test('should handle undefined output', () => {
      const result = createToolSpanOutputs(undefined);

      expect(result).toEqual({
        output: null,
      });
    });

    test('should handle object output', () => {
      const data = { status: 'success', items: [1, 2, 3] };
      const result = createToolSpanOutputs(data);

      expect(result).toEqual({
        output: data,
      });
    });

    test('should normalize OpenClaw text result objects', () => {
      const openClawOutput = { type: 'text', value: 'Hello world' };
      const result = createToolSpanOutputs(openClawOutput);

      expect(result).toEqual({
        output: 'Hello world',
      });
    });

    test('should pass through non-text OpenClaw objects', () => {
      const openClawOutput = { type: 'json', value: { data: 'test' } };
      const result = createToolSpanOutputs(openClawOutput);

      expect(result).toEqual({
        output: openClawOutput,
      });
    });

    test('should normalize string results', () => {
      const result = createToolSpanOutputs('simple string');

      expect(result).toEqual({
        output: 'simple string',
      });
    });

    test('should handle array output', () => {
      const arr = [1, 2, 3];
      const result = createToolSpanOutputs(arr);

      expect(result).toEqual({
        output: arr,
      });
    });

    test('should handle number output', () => {
      const result = createToolSpanOutputs(42);

      expect(result).toEqual({
        output: 42,
      });
    });

    test('should handle boolean output', () => {
      const result = createToolSpanOutputs(true);

      expect(result).toEqual({
        output: true,
      });
    });

    test('should handle empty string output', () => {
      const result = createToolSpanOutputs('');

      expect(result).toEqual({
        output: '',
      });
    });
  });

  describe('buildToolSpanSchema', () => {
    test('should build schema with required fields', () => {
      const inputSchema = {
        type: 'object' as const,
        properties: { command: { type: 'string' as const } },
        required: ['command'],
      };

      const fullSchema = buildToolSpanSchema(inputSchema);

      expect(fullSchema.type).toBe('object');
      expect(fullSchema.properties).toHaveProperty('span_id');
      expect(fullSchema.properties).toHaveProperty('trace_id');
      expect(fullSchema.properties).toHaveProperty('name');
      expect(fullSchema.properties).toHaveProperty('status');
      expect(fullSchema.properties).toHaveProperty('inputs');
      expect(fullSchema.properties).toHaveProperty('outputs');
      expect(fullSchema.properties).toHaveProperty('metadata');
      expect(fullSchema.properties).toHaveProperty('token_usage');
      expect(fullSchema.properties).toHaveProperty('error');
    });

    test('should require core fields', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);

      expect(fullSchema.required).toContain('span_id');
      expect(fullSchema.required).toContain('trace_id');
      expect(fullSchema.required).toContain('name');
      expect(fullSchema.required).toContain('status');
      expect(fullSchema.required).toContain('inputs');
      expect(fullSchema.required).toContain('outputs');
      expect(fullSchema.required).toContain('metadata');
    });

    test('should include input schema in inputs', () => {
      const inputSchema = {
        type: 'object' as const,
        properties: { path: { type: 'string' as const } },
        required: ['path'],
      };

      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const inputs = fullSchemaProps.inputs as { properties: Record<string, unknown> };

      // Check using array notation for dotted property names
      expect(inputs.properties).toHaveProperty(['openclaw.tool.name']);
      expect(inputs.properties).toHaveProperty('toolName');
      expect(inputs.properties).toHaveProperty('toolCallId');
      expect(inputs.properties).toHaveProperty('input');
      expect((inputs.properties.input as { properties: unknown }).properties).toEqual(
        inputSchema.properties
      );
    });

    test('should require openclaw.tool.name and toolName', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const inputs = fullSchemaProps.inputs as { required: string[] };

      expect(inputs.required.includes('openclaw.tool.name')).toBe(true);
      expect(inputs.required.includes('toolName')).toBe(true);
    });

    test('should define outputs with normalized output schema', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const outputs = fullSchemaProps.outputs as {
        properties: Record<string, unknown>;
        required: string[];
      };

      expect(outputs.properties).toHaveProperty('output');
      expect(outputs.required).toContain('output');
    });

    test('should allow generic metadata', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const metadata = fullSchemaProps.metadata as {
        type: string;
        additionalProperties: boolean;
      };

      expect(metadata.type).toBe('object');
      expect(metadata.additionalProperties).toBe(true);
    });

    test('should define token_usage with nullable object', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const tokenUsage = fullSchemaProps.token_usage as {
        anyOf: Array<Record<string, unknown>>;
      };

      expect(tokenUsage.anyOf).toBeDefined();
      expect(tokenUsage.anyOf.length).toBeGreaterThan(0);
    });

    test('should define error with nullable object', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);
      const fullSchemaProps = fullSchema.properties as Record<string, unknown>;
      const error = fullSchemaProps.error as { anyOf: Array<Record<string, unknown>> };

      expect(error.anyOf).toBeDefined();
      expect(error.anyOf.length).toBeGreaterThan(0);
    });

    test('should not allow additional properties', () => {
      const inputSchema = { type: 'object' as const };
      const fullSchema = buildToolSpanSchema(inputSchema);

      expect(fullSchema.additionalProperties).toBe(false);
    });
  });

  describe('createToolSpanResultPayload', () => {
    test('should create payload with output', () => {
      const payload = createToolSpanResultPayload('result data', false);

      expect(payload).toEqual({
        output: 'result data',
      });
    });

    test('should include isError flag when true', () => {
      const payload = createToolSpanResultPayload(null, true);

      expect(payload).toEqual({
        output: null,
        isError: true,
      });
    });

    test('should not include isError when false', () => {
      const payload = createToolSpanResultPayload('success', false);

      expect(payload).not.toHaveProperty('isError');
    });

    test('should normalize OpenClaw text result', () => {
      const openClawOutput = { type: 'text', value: 'File contents' };
      const payload = createToolSpanResultPayload(openClawOutput, false);

      expect(payload.output).toBe('File contents');
    });

    test('should handle undefined output', () => {
      const payload = createToolSpanResultPayload(undefined, false);

      expect(payload.output).toBeNull();
    });

    test('should handle error with output', () => {
      const errorOutput = { error: 'Command failed', exitCode: 1 };
      const payload = createToolSpanResultPayload(errorOutput, true);

      expect(payload.output).toEqual(errorOutput);
      expect(payload.isError).toBe(true);
    });

    test('should handle complex tool output', () => {
      const toolOutput = {
        files: ['file1.txt', 'file2.txt'],
        count: 2,
        success: true,
      };
      const payload = createToolSpanResultPayload(toolOutput, false);

      expect(payload.output).toEqual(toolOutput);
      expect(payload).not.toHaveProperty('isError');
    });
  });
});

describe('Tool Span Transformation', () => {
  describe('End-to-end workflow', () => {
    test('should handle read tool span creation', () => {
      // Create inputs
      const inputs = createToolSpanInputs({
        toolName: 'read',
        toolCallId: 'call_read_001',
        input: { path: '/etc/config.txt', offset: 0, limit: 50 },
      });

      expect(inputs['openclaw.tool.name']).toBe('read');
      expect(inputs.toolName).toBe('read');
      expect(inputs.toolCallId).toBe('call_read_001');
      expect((inputs.input as { path: string }).path).toBe('/etc/config.txt');
    });

    test('should handle exec tool with workdir', () => {
      const inputs = createToolSpanInputs({
        toolName: 'exec',
        input: {
          command: 'ls -la',
          workdir: '/home/user',
          timeout: 300,
        },
      });

      const toolInput = inputs.input as { command: string; workdir: string; timeout: number };
      expect(toolInput.command).toBe('ls -la');
      expect(toolInput.workdir).toBe('/home/user');
      expect(toolInput.timeout).toBe(300);
    });

    test('should handle browser tool with action-specific params', () => {
      const inputs = createToolSpanInputs({
        toolName: 'browser',
        toolCallId: 'call_browser_001',
        input: {
          action: 'screenshot',
          target: 'sandbox',
          fullPage: true,
          type: 'png',
        },
      });

      const toolInput = inputs.input as {
        action: string;
        target: string;
        fullPage: boolean;
        type: string;
      };
      expect(toolInput.action).toBe('screenshot');
      expect(toolInput.target).toBe('sandbox');
      expect(toolInput.fullPage).toBe(true);
      expect(toolInput.type).toBe('png');
    });

    test('should handle web_search with filtering params', () => {
      const inputs = createToolSpanInputs({
        toolName: 'web_search',
        input: {
          query: 'TypeScript SDK',
          count: 5,
          country: 'US',
          freshness: 'week',
        },
      });

      const toolInput = inputs.input as {
        query: string;
        count: number;
        country: string;
        freshness: string;
      };
      expect(toolInput.query).toBe('TypeScript SDK');
      expect(toolInput.count).toBe(5);
      expect(toolInput.country).toBe('US');
      expect(toolInput.freshness).toBe('week');
    });

    test('should handle web_fetch with extractMode', () => {
      const inputs = createToolSpanInputs({
        toolName: 'web_fetch',
        input: {
          url: 'https://example.com',
          extractMode: 'markdown',
          maxChars: 10000,
        },
      });

      const toolInput = inputs.input as {
        url: string;
        extractMode: string;
        maxChars: number;
      };
      expect(toolInput.url).toBe('https://example.com');
      expect(toolInput.extractMode).toBe('markdown');
      expect(toolInput.maxChars).toBe(10000);
    });

    test('should normalize tool output for span completion', () => {
      // Simulate OpenClaw text output
      const openClawResult = { type: 'text', value: 'Operation completed successfully' };
      const outputs = createToolSpanOutputs(openClawResult);

      expect(outputs.output).toBe('Operation completed successfully');
    });

    test('should create error result payload', () => {
      const errorOutput = { message: 'Permission denied', code: 'EACCES' };
      const payload = createToolSpanResultPayload(errorOutput, true);

      expect(payload.output).toEqual(errorOutput);
      expect(payload.isError).toBe(true);
    });

    test('should build complete span schema for critical tools', () => {
      const execInputSchema = {
        type: 'object' as const,
        properties: {
          command: { type: 'string' as const, description: 'Command to execute' },
          workdir: { type: 'string' as const, description: 'Working directory' },
        },
        required: ['command'],
      };

      const spanSchema = buildToolSpanSchema(execInputSchema);

      expect(spanSchema).toBeDefined();
      expect(spanSchema.type).toBe('object');
      expect(spanSchema.properties).toHaveProperty('span_id');
      expect(spanSchema.properties).toHaveProperty('inputs');
      expect(spanSchema.properties).toHaveProperty('outputs');

      // Verify inputs contains the exec input schema
      const spanSchemaProps = spanSchema.properties as Record<string, unknown>;
      const inputs = spanSchemaProps.inputs as {
        properties: { input: { properties: Record<string, unknown> } };
      };
      expect(inputs.properties.input.properties).toHaveProperty('command');
      expect(inputs.properties.input.properties).toHaveProperty('workdir');
    });
  });
});

describe('Data Risk Detection Support', () => {
  test('should support exec tool security parameters', () => {
    const inputs = createToolSpanInputs({
      toolName: 'exec',
      input: {
        command: 'curl https://external.com',
        host: 'sandbox',
        security: 'deny',
        ask: 'always',
      },
    });

    const toolInput = inputs.input as {
      command: string;
      host: string;
      security: string;
      ask: string;
    };
    expect(toolInput.security).toBe('deny');
    expect(toolInput.ask).toBe('always');
    // Security mode and ask mode affect data risk classification
  });

  test('should support browser tool target parameter', () => {
    const inputs = createToolSpanInputs({
      toolName: 'browser',
      input: {
        action: 'navigate',
        url: 'https://sensitive-site.com',
        target: 'sandbox',
      },
    });

    const toolInput = inputs.input as { target: string; url: string };
    expect(toolInput.target).toBe('sandbox');
    // Target affects isolation level for data risk
  });

  test('should support browser file upload paths', () => {
    const inputs = createToolSpanInputs({
      toolName: 'browser',
      input: {
        action: 'upload',
        paths: ['/data/secrets.txt', '/data/config.json'],
        inputRef: 'file-input-1',
      },
    });

    const toolInput = inputs.input as { paths: string[]; inputRef: string };
    expect(toolInput.paths).toEqual(['/data/secrets.txt', '/data/config.json']);
    // Upload paths are critical for data exfiltration detection
  });

  test('should capture web_search filtering for exfiltration detection', () => {
    const inputs = createToolSpanInputs({
      toolName: 'web_search',
      input: {
        query: 'proprietary algorithm',
        count: 10,
        country: 'ALL',
        language: 'en',
      },
    });

    const toolInput = inputs.input as { query: string; count: number; country: string };
    expect(toolInput.query).toBe('proprietary algorithm');
    expect(toolInput.count).toBe(10);
    // Search scope affects data exposure risk
  });
});
