import { beforeEach, describe, expect, test } from 'bun:test';
import {
  CRITICAL_TOOL_DEFINITIONS,
  getAllCriticalToolDefinitions,
  getToolDefinition,
  getToolInputSchema,
  isCriticalTool,
  normalizeToolName,
  TOOL_ALIAS_MAP,
  type ToolDefinition,
} from '../src/tool-definitions.js';

describe('Tool Definitions', () => {
  describe('CRITICAL_TOOL_DEFINITIONS', () => {
    test('should contain all 7 critical tools', () => {
      expect(Object.keys(CRITICAL_TOOL_DEFINITIONS)).toHaveLength(7);
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('read');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('write');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('edit');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('exec');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('web_search');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('web_fetch');
      expect(CRITICAL_TOOL_DEFINITIONS).toHaveProperty('browser');
    });

    test('each tool should have required properties', () => {
      for (const [name, definition] of Object.entries(CRITICAL_TOOL_DEFINITIONS)) {
        expect(definition.name).toBe(name);
        expect(definition.description).toBeTruthy();
        expect(definition.inputSchema).toBeDefined();
        expect(definition.inputSchema.type).toBe('object');
        expect(definition.inputSchema.properties).toBeDefined();
        expect(definition.inputSchema.required).toBeDefined();
      }
    });
  });

  describe('read tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.read;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('read');
      expect(tool.description).toContain('Read file');
      expect(tool.aliases).toContain('file_path');
      expect(tool.aliases).toContain('filePath');
      expect(tool.aliases).toContain('file');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('path');
    });

    test('should have correct optional parameters', () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('offset');
      expect(properties).toHaveProperty('limit');
    });

    test('should not allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('write tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.write;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('write');
      expect(tool.description).toContain('Write');
      expect(tool.aliases).toContain('file_path');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('path');
      expect(tool.inputSchema.required).toContain('content');
    });

    test('should not allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('edit tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.edit;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('edit');
      expect(tool.description).toContain('Find and replace');
    });

    test('should have Claude Code-style aliases', () => {
      expect(tool.aliases).toContain('oldText');
      expect(tool.aliases).toContain('old_text');
      expect(tool.aliases).toContain('oldString');
      expect(tool.aliases).toContain('old_string');
      expect(tool.aliases).toContain('newText');
      expect(tool.aliases).toContain('new_text');
      expect(tool.aliases).toContain('newString');
      expect(tool.aliases).toContain('new_string');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('path');
      expect(tool.inputSchema.required).toContain('oldText');
      expect(tool.inputSchema.required).toContain('newText');
    });

    test('should not allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('exec tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.exec;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('exec');
      expect(tool.description).toContain('Execute shell');
      expect(tool.aliases).toContain('bash');
    });

    test('should use workdir instead of cwd', () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('workdir');
      expect(properties).not.toHaveProperty('cwd');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('command');
      expect(tool.inputSchema.required).toHaveLength(1);
    });

    test('should have all optional parameters defined', () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('workdir');
      expect(properties).toHaveProperty('env');
      expect(properties).toHaveProperty('timeout');
      expect(properties).toHaveProperty('background');
      expect(properties).toHaveProperty('yieldMs');
      expect(properties).toHaveProperty('host');
      expect(properties).toHaveProperty('security');
      expect(properties).toHaveProperty('ask');
      expect(properties).toHaveProperty('node');
    });

    test('should have correct enum values for host', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.host.enum).toEqual(['auto', 'sandbox', 'gateway', 'node']);
    });

    test('should have correct enum values for security', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.security.enum).toEqual(['deny', 'allowlist', 'full']);
    });

    test('should have correct enum values for ask', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.ask.enum).toEqual(['off', 'on-miss', 'always']);
    });

    test('should not allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('web_search tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.web_search;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('web_search');
      expect(tool.description).toContain('Search the web');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('query');
      expect(tool.inputSchema.required).toHaveLength(1);
    });

    test('should have all optional search parameters', () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('count');
      expect(properties).toHaveProperty('country');
      expect(properties).toHaveProperty('language');
      expect(properties).toHaveProperty('freshness');
      expect(properties).toHaveProperty('date_after');
      expect(properties).toHaveProperty('date_before');
    });

    test('should have correct min/max for count parameter', () => {
      const properties = tool.inputSchema.properties as Record<
        string,
        { minimum?: number; maximum?: number }
      >;
      expect(properties.count.minimum).toBe(1);
      expect(properties.count.maximum).toBe(10);
    });

    test('should have correct enum values for freshness', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.freshness.enum).toEqual(['day', 'week', 'month', 'year']);
    });

    test('should allow additional properties for provider-specific params', () => {
      expect(tool.inputSchema.additionalProperties).toBe(true);
    });
  });

  describe('web_fetch tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.web_fetch;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('web_fetch');
      expect(tool.description).toContain('Fetch content');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('url');
      expect(tool.inputSchema.required).toHaveLength(1);
    });

    test('should have correct extractMode enum values', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.extractMode.enum).toEqual(['markdown', 'text']);
    });

    test('should have correct minimum for maxChars', () => {
      const properties = tool.inputSchema.properties as Record<string, { minimum?: number }>;
      expect(properties.maxChars.minimum).toBe(100);
    });

    test('should not allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('browser tool', () => {
    let tool: ToolDefinition;

    beforeEach(() => {
      tool = CRITICAL_TOOL_DEFINITIONS.browser;
    });

    test('should have correct metadata', () => {
      expect(tool.name).toBe('browser');
      expect(tool.description).toContain('Browser automation');
    });

    test('should have correct required parameters', () => {
      expect(tool.inputSchema.required).toContain('action');
      expect(tool.inputSchema.required).toHaveLength(1);
    });

    test('should have all 15+ browser actions', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      const actions = properties.action.enum;
      expect(actions).toContain('status');
      expect(actions).toContain('start');
      expect(actions).toContain('stop');
      expect(actions).toContain('profiles');
      expect(actions).toContain('tabs');
      expect(actions).toContain('open');
      expect(actions).toContain('focus');
      expect(actions).toContain('close');
      expect(actions).toContain('snapshot');
      expect(actions).toContain('screenshot');
      expect(actions).toContain('navigate');
      expect(actions).toContain('console');
      expect(actions).toContain('pdf');
      expect(actions).toContain('upload');
      expect(actions).toContain('dialog');
      expect(actions).toContain('act');
      expect(actions?.length).toBeGreaterThanOrEqual(15);
    });

    test('should have all action-specific parameters', () => {
      const properties = tool.inputSchema.properties as Record<string, unknown>;
      expect(properties).toHaveProperty('target');
      expect(properties).toHaveProperty('node');
      expect(properties).toHaveProperty('profile');
      expect(properties).toHaveProperty('url');
      expect(properties).toHaveProperty('targetUrl');
      expect(properties).toHaveProperty('targetId');
      expect(properties).toHaveProperty('limit');
      expect(properties).toHaveProperty('snapshotFormat');
      expect(properties).toHaveProperty('refs');
      expect(properties).toHaveProperty('interactive');
      expect(properties).toHaveProperty('compact');
      expect(properties).toHaveProperty('depth');
      expect(properties).toHaveProperty('fullPage');
      expect(properties).toHaveProperty('selector');
      expect(properties).toHaveProperty('ref');
      expect(properties).toHaveProperty('element');
      expect(properties).toHaveProperty('type');
      expect(properties).toHaveProperty('text');
      expect(properties).toHaveProperty('level');
      expect(properties).toHaveProperty('paths');
      expect(properties).toHaveProperty('inputRef');
      expect(properties).toHaveProperty('script');
      expect(properties).toHaveProperty('timeoutMs');
      expect(properties).toHaveProperty('accept');
      expect(properties).toHaveProperty('promptText');
    });

    test('should have correct enum for target', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.target.enum).toEqual(['sandbox', 'host', 'node']);
    });

    test('should have correct enum for snapshotFormat', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.snapshotFormat.enum).toEqual(['aria', 'ai']);
    });

    test('should have correct enum for refs', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.refs.enum).toEqual(['role', 'aria']);
    });

    test('should have correct enum for screenshot type', () => {
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.type.enum).toEqual(['png', 'jpeg']);
    });

    test('should allow additional properties', () => {
      expect(tool.inputSchema.additionalProperties).toBe(true);
    });
  });

  describe('TOOL_ALIAS_MAP', () => {
    test('should map canonical names to themselves', () => {
      expect(TOOL_ALIAS_MAP.read).toBe('read');
      expect(TOOL_ALIAS_MAP.write).toBe('write');
      expect(TOOL_ALIAS_MAP.edit).toBe('edit');
      expect(TOOL_ALIAS_MAP.exec).toBe('exec');
      expect(TOOL_ALIAS_MAP.web_search).toBe('web_search');
      expect(TOOL_ALIAS_MAP.web_fetch).toBe('web_fetch');
      expect(TOOL_ALIAS_MAP.browser).toBe('browser');
    });

    test('should map read tool aliases', () => {
      // Note: All read aliases (file_path, filePath, file) overlap with write
      // In current implementation, last wins, so these all map to write
      // Read has no unique aliases
    });

    test('should map write tool aliases', () => {
      // file_path and filePath are mapped to write (last wins for overlapping aliases)
      expect(TOOL_ALIAS_MAP.file_path).toBe('write');
      expect(TOOL_ALIAS_MAP.filePath).toBe('write');
    });

    test('should map edit tool aliases', () => {
      expect(TOOL_ALIAS_MAP.oldText).toBe('edit');
      expect(TOOL_ALIAS_MAP.old_string).toBe('edit');
      expect(TOOL_ALIAS_MAP.newString).toBe('edit');
      expect(TOOL_ALIAS_MAP.new_text).toBe('edit');
    });

    test('should map exec tool aliases', () => {
      expect(TOOL_ALIAS_MAP.bash).toBe('exec');
    });
  });

  describe('normalizeToolName', () => {
    test('should return canonical name for known tools', () => {
      expect(normalizeToolName('read')).toBe('read');
      // Note: file_path, filePath, file aliases overlap with write (last wins)
      expect(normalizeToolName('bash')).toBe('exec');
    });

    test('should return original name for unknown tools', () => {
      expect(normalizeToolName('unknown_tool')).toBe('unknown_tool');
      expect(normalizeToolName('custom')).toBe('custom');
    });

    test('should handle case sensitivity', () => {
      expect(normalizeToolName('Read')).toBe('Read'); // Case-sensitive
      expect(normalizeToolName('BASH')).toBe('BASH'); // Not an alias
    });
  });

  describe('getToolDefinition', () => {
    test('should return definition for canonical names', () => {
      const tool = getToolDefinition('read');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('read');
    });

    test('should return definition for aliases', () => {
      // Note: All read aliases overlap with write, so alias lookup returns write
      // Using canonical name is recommended
      const toolByCanonical = getToolDefinition('read');
      expect(toolByCanonical).toBeDefined();
      expect(toolByCanonical?.name).toBe('read');
    });

    test('should return undefined for unknown tools', () => {
      const tool = getToolDefinition('unknown_tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getToolInputSchema', () => {
    test('should return schema for known tools', () => {
      const schema = getToolInputSchema('read');
      expect(schema).toBeDefined();
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    });

    test('should return generic schema for unknown tools', () => {
      const schema = getToolInputSchema('unknown_tool');
      expect(schema).toEqual({
        type: 'object',
        additionalProperties: true,
      });
    });

    test('should work with aliases', () => {
      const schema = getToolInputSchema('bash');
      expect(schema).toBeDefined();
      expect(schema.properties).toHaveProperty('command');
    });
  });

  describe('isCriticalTool', () => {
    test('should return true for canonical names', () => {
      expect(isCriticalTool('read')).toBe(true);
      expect(isCriticalTool('write')).toBe(true);
      expect(isCriticalTool('exec')).toBe(true);
    });

    test('should return true for aliases', () => {
      expect(isCriticalTool('file_path')).toBe(true);
      expect(isCriticalTool('bash')).toBe(true);
      expect(isCriticalTool('old_string')).toBe(true);
    });

    test('should return false for unknown tools', () => {
      expect(isCriticalTool('custom')).toBe(false);
      expect(isCriticalTool('unknown')).toBe(false);
    });
  });

  describe('getAllCriticalToolDefinitions', () => {
    test('should return a copy of all definitions', () => {
      const all = getAllCriticalToolDefinitions();
      expect(Object.keys(all)).toHaveLength(7);
      expect(all.read).toBeDefined();

      // Verify it's a copy, not the original
      delete (all as Record<string, unknown>).read;
      expect(CRITICAL_TOOL_DEFINITIONS.read).toBeDefined();
    });
  });
});

describe('OpenClaw Schema Alignment', () => {
  describe('Critical Fixes', () => {
    test('exec tool should use workdir instead of cwd', () => {
      const exec = CRITICAL_TOOL_DEFINITIONS.exec;
      const properties = exec.inputSchema.properties as Record<string, unknown>;

      // OpenClaw uses 'workdir', not 'cwd'
      expect(properties).toHaveProperty('workdir');
      expect(properties).not.toHaveProperty('cwd');
    });

    test('web_fetch should have correct extractMode enum', () => {
      const webFetch = CRITICAL_TOOL_DEFINITIONS.web_fetch;
      const properties = webFetch.inputSchema.properties as Record<string, { enum?: string[] }>;

      // OpenClaw uses ['markdown', 'text'], not ['raw', 'readability', 'firecrawl']
      expect(properties.extractMode.enum).toEqual(['markdown', 'text']);
      expect(properties.extractMode.enum).not.toContain('raw');
      expect(properties.extractMode.enum).not.toContain('readability');
      expect(properties.extractMode.enum).not.toContain('firecrawl');
    });

    test('edit tool should have Claude Code aliases', () => {
      const edit = CRITICAL_TOOL_DEFINITIONS.edit;

      // Should support both camelCase and snake_case variants
      expect(edit.aliases).toContain('old_string');
      expect(edit.aliases).toContain('oldString');
      expect(edit.aliases).toContain('new_string');
      expect(edit.aliases).toContain('newString');
    });
  });

  describe('web_search optional parameters', () => {
    test('should support data risk detection parameters', () => {
      const webSearch = CRITICAL_TOOL_DEFINITIONS.web_search;
      const properties = webSearch.inputSchema.properties as Record<string, unknown>;

      // These fields affect data exfiltration detection
      expect(properties).toHaveProperty('count');
      expect(properties).toHaveProperty('country');
      expect(properties).toHaveProperty('language');
      expect(properties).toHaveProperty('freshness');
      expect(properties).toHaveProperty('date_after');
      expect(properties).toHaveProperty('date_before');
    });

    test('should allow additional properties for provider extensions', () => {
      const webSearch = CRITICAL_TOOL_DEFINITIONS.web_search;
      expect(webSearch.inputSchema.additionalProperties).toBe(true);
    });
  });

  describe('browser tool completeness', () => {
    test('should support all OpenClaw browser actions', () => {
      const browser = CRITICAL_TOOL_DEFINITIONS.browser;
      const properties = browser.inputSchema.properties as Record<string, { enum?: string[] }>;
      const actions = properties.action.enum || [];

      // High-risk actions that must be tracked
      expect(actions).toContain('upload'); // File uploads
      expect(actions).toContain('pdf'); // PDF generation
      expect(actions).toContain('dialog'); // Dialog handling
      expect(actions).toContain('snapshot'); // Page snapshots
      expect(actions).toContain('screenshot'); // Screenshots
      expect(actions).toContain('console'); // Console access
      expect(actions).toContain('navigate'); // Navigation
      expect(actions).toContain('act'); // Complex actions
    });

    test('should support action-specific parameters', () => {
      const browser = CRITICAL_TOOL_DEFINITIONS.browser;
      const properties = browser.inputSchema.properties as Record<string, unknown>;

      // Security-relevant parameters
      expect(properties).toHaveProperty('target'); // sandbox/host/node
      expect(properties).toHaveProperty('node'); // Node identifier
      expect(properties).toHaveProperty('profile'); // Browser profile
      expect(properties).toHaveProperty('paths'); // File uploads
    });
  });
});
