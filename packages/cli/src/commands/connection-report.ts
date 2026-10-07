import type { ApiClient } from '../api-client.js';

const MAX_TOOLS = 100;
const MAX_TOOL_NAME_LENGTH = 100;
const MAX_TOOL_DESCRIPTION_LENGTH = 500;
const MAX_AGENT_NAME_LENGTH = 255;

export interface ConnectionTool {
  name: string;
  description?: string;
}

export interface ConnectionReport {
  cli_version?: string;
  platform?: string;
  agent: { id?: string; name: string };
  tools: ConnectionTool[];
}

export function parseToolOption(value: string): ConnectionTool {
  const separator = value.indexOf(':');
  const name = (separator === -1 ? value : value.slice(0, separator)).trim();
  const description = separator === -1 ? undefined : value.slice(separator + 1).trim();

  if (name.length === 0) {
    throw new Error('Each --tool value needs a name. Use NAME or NAME:DESCRIPTION.');
  }

  if (name.length > MAX_TOOL_NAME_LENGTH) {
    throw new Error(`Tool names must be ${MAX_TOOL_NAME_LENGTH} characters or fewer.`);
  }

  if (description && description.length > MAX_TOOL_DESCRIPTION_LENGTH) {
    throw new Error(
      `Tool descriptions must be ${MAX_TOOL_DESCRIPTION_LENGTH} characters or fewer.`
    );
  }

  return description ? { name, description } : { name };
}

export function parseToolOptions(values: string[]): ConnectionTool[] {
  if (values.length > MAX_TOOLS) {
    throw new Error(`A connection can include at most ${MAX_TOOLS} tools.`);
  }

  return values.map(parseToolOption);
}

export function requireAgentName(value: string | undefined): string {
  const name = value?.trim() ?? '';
  if (name.length === 0) {
    throw new Error('Pass --agent-name with the agent you are connecting.');
  }

  if (name.length > MAX_AGENT_NAME_LENGTH) {
    throw new Error(`Agent names must be ${MAX_AGENT_NAME_LENGTH} characters or fewer.`);
  }

  return name;
}

export function reportCliConnection(
  apiClient: ApiClient,
  report: ConnectionReport
): Promise<unknown> {
  const agentId = report.agent.id?.trim();

  return apiClient.request('/cli_connection', {
    method: 'POST',
    body: {
      ...(report.cli_version ? { cli_version: report.cli_version } : {}),
      ...(report.platform ? { platform: report.platform } : {}),
      agent: {
        name: report.agent.name,
        ...(agentId ? { id: agentId } : {}),
      },
      tools: report.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
      })),
    },
  });
}
