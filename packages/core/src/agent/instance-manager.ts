import type { AgentInstanceStart, QueueAction, SchemaRegistration } from '../queue/actions.js';
import { isDeepStrictEqual } from 'node:util';
import type { Queue } from '../queue/base.js';
import { SchemaRegistry } from './schema-registry.js';

export type AgentInstanceManagerOptions = {
  schemaName: string;
  schemaVersion: string;
};

type AgentInstanceStartOptions = Omit<AgentInstanceStart, 'schemaName' | 'schemaVersion'>;

export class AgentInstanceManager {
  private schemaRegistry = new SchemaRegistry();

  constructor(
    private queue: Queue<QueueAction>,
    private options: AgentInstanceManagerOptions
  ) {}

  registerSchema(schema: Record<string, unknown>): void {
    if (this.schemaRegistry.has(this.options.schemaName, this.options.schemaVersion)) {
      const existing = this.schemaRegistry.get(this.options.schemaName, this.options.schemaVersion);
      if (existing && !isDeepStrictEqual(existing.schema, schema)) {
        console.warn(
          `Schema ${this.options.schemaName}@${this.options.schemaVersion} is already registered with a different payload. Ignoring registration.`
        );
      }
      return;
    }

    const registration: SchemaRegistration = {
      schemaName: this.options.schemaName,
      schemaVersion: this.options.schemaVersion,
      schema,
    };

    this.schemaRegistry.register(registration);
    this.queue.enqueue({ type: 'schema_register', data: registration });
  }

  startInstance(options: AgentInstanceStartOptions = {}): void {
    if (!this.schemaRegistry.has(this.options.schemaName, this.options.schemaVersion)) {
      console.warn(
        `Schema ${this.options.schemaName}@${this.options.schemaVersion} must be registered before starting an agent instance.`
      );
      return;
    }

    const startData: AgentInstanceStart = {
      ...options,
      schemaName: this.options.schemaName,
      schemaVersion: this.options.schemaVersion,
    };

    this.queue.enqueue({ type: 'agent_start', data: startData });
  }

  finishInstance(): void {
    this.queue.enqueue({ type: 'agent_finish', data: {} });
  }
}
