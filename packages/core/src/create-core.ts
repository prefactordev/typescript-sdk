import { extractPartition, type Partition } from '@prefactor/pfid';
import type { Config } from './config.js';
import { HttpTransportConfigSchema } from './config.js';
import { AgentInstanceManager } from './agent/instance-manager.js';
import type { QueueAction } from './queue/actions.js';
import { InMemoryQueue } from './queue/in-memory.js';
import { Tracer } from './tracing/tracer.js';
import type { Transport } from './transport/base.js';
import { HttpTransport } from './transport/http.js';
import { StdioTransport } from './transport/stdio.js';
import { TransportWorker } from './transport/worker.js';

export type CoreRuntime = {
  tracer: Tracer;
  agentManager: AgentInstanceManager;
  worker: TransportWorker;
  shutdown: () => Promise<void>;
};

export function createCore(config: Config): CoreRuntime {
  let transport: Transport;
  if (config.transportType === 'stdio') {
    transport = new StdioTransport();
  } else {
    if (!config.httpConfig) {
      throw new Error('HTTP transport requires httpConfig to be provided in configuration');
    }
    if (!config.httpConfig.agentVersion) {
      throw new Error(
        'HTTP transport requires agentVersion to be provided in httpConfig.'
      );
    }
    const httpConfig = HttpTransportConfigSchema.parse(config.httpConfig);
    transport = new HttpTransport(httpConfig);
  }

  let partition: Partition | undefined;
  if (config.httpConfig?.agentId) {
    try {
      partition = extractPartition(config.httpConfig.agentId);
    } catch {
      partition = undefined;
    }
  }

  const queue = new InMemoryQueue<QueueAction>();
  const worker = new TransportWorker(queue, transport, { batchSize: 25, intervalMs: 50 });
  const tracer = new Tracer(queue, partition);

  const schemaName = config.httpConfig?.schemaName ?? 'prefactor:agent';
  const schemaVersion = config.httpConfig?.schemaVersion ?? '1.0.0';
  const allowUnregisteredSchema =
    config.transportType === 'http' &&
    Boolean(
      config.httpConfig?.skipSchema ||
        config.httpConfig?.agentSchema ||
        config.httpConfig?.agentSchemaVersion
    );
  const agentManager = new AgentInstanceManager(queue, {
    schemaName,
    schemaVersion,
    allowUnregisteredSchema,
  });

  const shutdown = async (): Promise<void> => {
    await worker.close();
  };

  return { tracer, agentManager, worker, shutdown };
}
