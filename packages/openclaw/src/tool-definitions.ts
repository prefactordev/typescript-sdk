// Define JsonSchema type locally since @prefactor/core may not export it in dist
type JsonSchema = Record<string, unknown>;

/**
 * Input schemas for critical OpenClaw tools.
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
export const CRITICAL_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
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
        cwd: {
          type: 'string',
          description: 'Working directory for command execution (optional)',
        },
        pty: {
          type: 'boolean',
          description: 'Whether to allocate a pseudo-terminal (optional)',
        },
        elevated: {
          type: 'boolean',
          description: 'Whether to run with elevated privileges (optional)',
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
      },
      required: ['query'],
      additionalProperties: false,
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
          enum: ['raw', 'readability', 'firecrawl'],
          description: 'Content extraction mode (optional)',
        },
        maxChars: {
          type: 'number',
          description: 'Maximum characters to fetch (optional)',
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
          enum: ['navigate', 'click', 'type', 'screenshot', 'evaluate', 'close'],
          description: 'Browser action to perform',
        },
        url: {
          type: 'string',
          description: 'URL for navigate action (optional)',
        },
        selector: {
          type: 'string',
          description: 'CSS selector for click/type actions (optional)',
        },
        text: {
          type: 'string',
          description: 'Text to type for type action (optional)',
        },
        script: {
          type: 'string',
          description: 'JavaScript to evaluate for evaluate action (optional)',
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
  CRITICAL_TOOL_DEFINITIONS
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
  return CRITICAL_TOOL_DEFINITIONS[canonicalName];
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
 * Checks if a tool is one of the critical tools with a defined schema.
 */
export function isCriticalTool(toolName: string): boolean {
  const canonicalName = normalizeToolName(toolName);
  return canonicalName in CRITICAL_TOOL_DEFINITIONS;
}

/**
 * Gets all tool definitions for schema registration.
 * Used when building the agent schema version.
 */
export function getAllCriticalToolDefinitions(): Record<string, ToolDefinition> {
  return { ...CRITICAL_TOOL_DEFINITIONS };
}
