import { extractPartition, type Partition } from '@prefactor/pfid';
import { AgentInstanceManager } from './agent/instance-manager.js';
import type { Config } from './config.js';
import { HttpTransportConfigSchema } from './config.js';
import { Tracer } from './tracing/tracer.js';
import type { Transport } from './transport/http.js';
import { HttpTransport } from './transport/http.js';

export type CoreRuntime = {
  tracer: Tracer;
  agentManager: AgentInstanceManager;
  shutdown: () => Promise<void>;
};

export function createCore(config: Config): CoreRuntime {
  let transport: Transport;
  if (!config.httpConfig) {
    throw new Error('HTTP transport requires httpConfig to be provided in configuration');
  }
  const httpConfig = HttpTransportConfigSchema.parse(config.httpConfig);
  transport = new HttpTransport(httpConfig);

  let partition: Partition | undefined;
  if (config.httpConfig?.agentId) {
    try {
      partition = extractPartition(config.httpConfig.agentId);
    } catch {
      partition = undefined;
    }
  }

  const tracer = new Tracer(transport, partition);

  const allowUnregisteredSchema = Boolean(config.httpConfig?.agentSchema);
  const agentManager = new AgentInstanceManager(transport, {
    allowUnregisteredSchema,
  });

  const shutdown = async (): Promise<void> => {
    await tracer.close();
  };

  return { tracer, agentManager, shutdown };
}
