import type { JsonSchema } from '@prefactor/core';

/**
 * Schema details for one of pi's built-in tools.
 */
export interface ToolDefinition {
  description: string;
  inputSchema: JsonSchema;
  template: string;
}

const TOOL_STATUS_SUFFIX = '{% if error %} (error){% endif %}';

/**
 * Input schemas and summary templates for pi's built-in `read`, `write`, `edit` and `bash` tools.
 *
 * The schemas follow the argument shapes pi's tools declare. Other tools record their arguments
 * without a schema for them.
 */
export const SUPPORTED_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  read: {
    description: 'Read file contents from the filesystem',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['path'],
    },
    template: `read: {{ params.path | default: "(unknown file)" }}{% if params.offset %}:{{ params.offset }}{% endif %}{% if params.limit %} (limit {{ params.limit }}){% endif %}${TOOL_STATUS_SUFFIX}`,
  },
  write: {
    description: 'Write or create files on the filesystem',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
    template: `write: {{ params.path | default: "(unknown file)" }}${TOOL_STATUS_SUFFIX}`,
  },
  edit: {
    description: 'Replace targeted text in a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        edits: {
          type: 'array',
          description: 'Targeted replacements to apply',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string', description: 'Text to find' },
              newText: { type: 'string', description: 'Replacement text' },
            },
          },
        },
      },
      required: ['path'],
    },
    template: `edit: {{ params.path | default: "(unknown file)" }}{% if params.edits %} ({{ params.edits | size }} edits){% endif %}${TOOL_STATUS_SUFFIX}`,
  },
  bash: {
    description: 'Execute a shell command',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in seconds' },
      },
      required: ['command'],
    },
    template: `bash: \`{% assign cmd = params.command | default: "(no command)" %}{% if cmd.size > 60 %}{{ cmd | slice: 0, 60 }}...{% else %}{{ cmd }}{% endif %}\`${TOOL_STATUS_SUFFIX}`,
  },
};
