import type { AgentInstanceOptions, Transport } from '../transport/base.js';

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

    const existingSchema = JSON.stringify(this.registeredSchema);
    const incomingSchema = JSON.stringify(schema);
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
