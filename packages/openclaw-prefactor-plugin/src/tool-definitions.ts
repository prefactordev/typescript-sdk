import type { JsonSchema } from '@prefactor/core';

/**
 * Input schemas for supported OpenClaw tools.
 * These define the expected parameters for each tool to enable
 * proper validation and structured span capture.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  aliases?: string[];
}

/**
 * Map of canonical tool names to their definitions.
 * Aliases are normalized to canonical names during span creation.
 */
export const SUPPORTED_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  read: {
    name: 'read',
    description: 'Read file contents from the filesystem',
    aliases: ['file_path', 'filePath', 'file'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Starting line offset (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read (optional)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  write: {
    name: 'write',
    description: 'Write or create files on the filesystem',
    aliases: ['file_path', 'filePath', 'file'],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  edit: {
    name: 'edit',
    description: 'Find and replace text in files',
    aliases: [
      'oldText',
      'old_text',
      'oldString',
      'old_string',
      'newText',
      'new_text',
      'newString',
      'new_string',
    ],
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to edit',
        },
        oldText: {
          type: 'string',
          description: 'Text to find and replace',
        },
        newText: {
          type: 'string',
          description: 'Replacement text',
        },
      },
      required: ['path', 'oldText', 'newText'],
      additionalProperties: false,
    },
  },
  exec: {
    name: 'exec',
    description: 'Execute shell commands',
    aliases: ['bash'],
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute',
        },
        workdir: {
          type: 'string',
          description: 'Working directory for command execution (optional, defaults to cwd)',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables (optional)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (optional, default 1800)',
        },
        background: {
          type: 'boolean',
          description: 'Run in background (optional)',
        },
        yieldMs: {
          type: 'number',
          description: 'Milliseconds before backgrounding (optional, default 10000)',
        },
        host: {
          type: 'string',
          enum: ['auto', 'sandbox', 'gateway', 'node'],
          description: 'Execution host (optional)',
        },
        security: {
          type: 'string',
          enum: ['deny', 'allowlist', 'full'],
          description: 'Security mode (optional)',
        },
        ask: {
          type: 'string',
          enum: ['off', 'on-miss', 'always'],
          description: 'Ask mode (optional)',
        },
        node: {
          type: 'string',
          description: 'Node id for host=node (optional)',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  web_search: {
    name: 'web_search',
    description: 'Search the web for information',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        count: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          description: 'Number of results to return (1-10, optional)',
        },
        country: {
          type: 'string',
          description: '2-letter country code (e.g., "US", "DE", "ALL", optional)',
        },
        language: {
          type: 'string',
          description: 'ISO 639-1 language code (e.g., "en", "de", "fr", optional)',
        },
        freshness: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Time filter for results (optional)',
        },
        date_after: {
          type: 'string',
          description: 'Filter results after this date (YYYY-MM-DD, optional)',
        },
        date_before: {
          type: 'string',
          description: 'Filter results before this date (YYYY-MM-DD, optional)',
        },
      },
      required: ['query'],
      additionalProperties: true,
    },
  },
  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch content from web URLs',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
        extractMode: {
          type: 'string',
          enum: ['markdown', 'text'],
          description: 'Extraction mode, default: "markdown"',
        },
        maxChars: {
          type: 'number',
          minimum: 100,
          description: 'Maximum characters to fetch (optional, default 50000)',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  browser: {
    name: 'browser',
    description: 'Browser automation using Playwright',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'start',
            'stop',
            'profiles',
            'tabs',
            'open',
            'focus',
            'close',
            'snapshot',
            'screenshot',
            'navigate',
            'console',
            'pdf',
            'upload',
            'dialog',
            'act',
          ],
          description: 'Browser action to perform',
        },
        target: {
          type: 'string',
          enum: ['sandbox', 'host', 'node'],
          description: 'Execution target (optional)',
        },
        node: {
          type: 'string',
          description: 'Node identifier for host=node (optional)',
        },
        profile: {
          type: 'string',
          description: 'Browser profile (optional)',
        },
        url: {
          type: 'string',
          description: 'URL for navigate/open action (optional)',
        },
        targetUrl: {
          type: 'string',
          description: 'Target URL for open/navigation (optional)',
        },
        targetId: {
          type: 'string',
          description: 'Tab/target identifier (optional)',
        },
        limit: {
          type: 'number',
          description: 'Limit for tabs/lists (optional)',
        },
        snapshotFormat: {
          type: 'string',
          enum: ['aria', 'ai'],
          description: 'Snapshot format (optional)',
        },
        refs: {
          type: 'string',
          enum: ['role', 'aria'],
          description: 'Element reference type (optional)',
        },
        interactive: {
          type: 'boolean',
          description: 'Interactive mode (optional)',
        },
        compact: {
          type: 'boolean',
          description: 'Compact output (optional)',
        },
        depth: {
          type: 'number',
          description: 'Crawl depth (optional)',
        },
        fullPage: {
          type: 'boolean',
          description: 'Full page screenshot (optional)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector (optional)',
        },
        ref: {
          type: 'string',
          description: 'Element reference (optional)',
        },
        element: {
          type: 'string',
          description: 'Element selector (optional)',
        },
        type: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Screenshot format (optional)',
        },
        text: {
          type: 'string',
          description: 'Text to type (optional)',
        },
        level: {
          type: 'string',
          description: 'Console log level (optional)',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths for upload (optional)',
        },
        inputRef: {
          type: 'string',
          description: 'Input element reference (optional)',
        },
        script: {
          type: 'string',
          description: 'JavaScript to evaluate (optional)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Action timeout in milliseconds (optional)',
        },
        accept: {
          type: 'boolean',
          description: 'Dialog acceptance (optional)',
        },
        promptText: {
          type: 'string',
          description: 'Prompt text (optional)',
        },
      },
      required: ['action'],
      additionalProperties: true,
    },
  },
};

/**
 * Map of tool aliases to their canonical names.
 * Used for normalizing tool names during span creation.
 */
export const TOOL_ALIAS_MAP: Record<string, string> = Object.entries(
  SUPPORTED_TOOL_DEFINITIONS
).reduce(
  (acc, [canonicalName, definition]) => {
    // Map canonical name to itself
    acc[canonicalName] = canonicalName;

    // Map aliases to canonical name
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        acc[alias] = canonicalName;
      }
    }

    return acc;
  },
  {} as Record<string, string>
);

/**
 * Normalizes a tool name to its canonical form.
 * Falls back to the original name if no mapping exists.
 */
export function normalizeToolName(toolName: string): string {
  return TOOL_ALIAS_MAP[toolName] ?? toolName;
}

/**
 * Gets the tool definition for a given tool name.
 * Handles both canonical names and aliases.
 * Returns undefined for unknown tools.
 */
export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  const canonicalName = normalizeToolName(toolName);
  return SUPPORTED_TOOL_DEFINITIONS[canonicalName];
}

/**
 * Gets the input schema for a tool.
 * Returns a generic object schema for unknown tools.
 */
export function getToolInputSchema(toolName: string): JsonSchema {
  const definition = getToolDefinition(toolName);
  return definition?.inputSchema ?? { type: 'object', additionalProperties: true };
}

/**
 * Checks if a tool is one of the supported tools with a defined schema.
 */
export function isSupportedTool(toolName: string): boolean {
  const canonicalName = normalizeToolName(toolName);
  return canonicalName in SUPPORTED_TOOL_DEFINITIONS;
}

/**
 * Gets all tool definitions for schema registration.
 * Used when building the agent schema version.
 */
export function getAllSupportedToolDefinitions(): Record<string, ToolDefinition> {
  return { ...SUPPORTED_TOOL_DEFINITIONS };
}
