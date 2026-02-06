import type { AgentInstanceStart, QueueAction, SchemaRegistration } from '../queue/actions.js';
import type { Queue } from '../queue/base.js';

export type AgentInstanceManagerOptions = {
  allowUnregisteredSchema?: boolean;
};

type AgentInstanceStartOptions = AgentInstanceStart;

export class AgentInstanceManager {
  private registeredSchema: Record<string, unknown> | null = null;

  constructor(
    private queue: Queue<QueueAction>,
    private options: AgentInstanceManagerOptions
  ) {}

  registerSchema(schema: Record<string, unknown>): void {
    // Only register if we haven't already
    if (this.registeredSchema === null) {
      const registration: SchemaRegistration = { schema };
      this.registeredSchema = schema;
      this.queue.enqueue({ type: 'schema_register', data: registration });
    }
  }

  startInstance(options: AgentInstanceStartOptions = {}): void {
    if (!this.options.allowUnregisteredSchema && this.registeredSchema === null) {
      console.warn('Schema must be registered before starting an agent instance.');
      return;
    }

    this.queue.enqueue({ type: 'agent_start', data: options });
  }

  finishInstance(): void {
    this.queue.enqueue({ type: 'agent_finish', data: {} });
  }
}
