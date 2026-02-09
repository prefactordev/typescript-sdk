import type { AgentInstanceOptions, Transport } from '../transport/http.js';

export type AgentInstanceManagerOptions = {
  allowUnregisteredSchema?: boolean;
};

type AgentInstanceStartOptions = AgentInstanceOptions;

export class AgentInstanceManager {
  private registeredSchema: Record<string, unknown> | null = null;

  constructor(
    private transport: Transport,
    private options: AgentInstanceManagerOptions
  ) {}

  registerSchema(schema: Record<string, unknown>): void {
    if (this.registeredSchema === null) {
      this.registeredSchema = schema;
      this.transport.registerSchema(schema);
      return;
    }

    const existingSchema = stableStringify(this.registeredSchema);
    const incomingSchema = stableStringify(schema);
    if (existingSchema !== incomingSchema) {
      console.warn(
        'A different schema was provided after registration; ignoring subsequent schema.'
      );
    }
  }

  startInstance(options: AgentInstanceStartOptions = {}): void {
    if (!this.options.allowUnregisteredSchema && this.registeredSchema === null) {
      console.warn('Schema must be registered before starting an agent instance.');
      return;
    }

    this.transport.startAgentInstance(options);
  }

  finishInstance(): void {
    this.transport.finishAgentInstance();
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      normalized[key] = normalizeValue(objectValue[key]);
    }
    return normalized;
  }

  return value;
}
