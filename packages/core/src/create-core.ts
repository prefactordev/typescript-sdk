import { extractPartition, type Partition } from '@prefactor/pfid';
import { AgentInstanceManager } from './agent/instance-manager.js';
import type { Config } from './config.js';
import { HttpTransportConfigSchema } from './config.js';
import { setActiveCoreRuntime } from './lifecycle.js';
import { clearActiveTracer, setActiveTracer } from './tracing/active-tracer.js';
import { Tracer } from './tracing/tracer.js';
import { HttpTransport } from './transport/http.js';

export type CoreRuntime = {
  tracer: Tracer;
  agentManager: AgentInstanceManager;
  shutdown: () => Promise<void>;
};

export function createCore(config: Config): CoreRuntime {
  if (!config.httpConfig) {
    throw new Error('HTTP transport requires httpConfig to be provided in configuration');
  }

  const httpConfig = HttpTransportConfigSchema.parse(config.httpConfig);
  const transport = new HttpTransport(httpConfig);

  let partition: Partition | undefined;
  if (config.httpConfig.agentId) {
    try {
      partition = extractPartition(config.httpConfig.agentId);
    } catch {
      partition = undefined;
    }
  }

  const tracer = new Tracer(transport, partition);
  setActiveTracer(tracer);

  const allowUnregisteredSchema = Boolean(config.httpConfig.agentSchema);
  const agentManager = new AgentInstanceManager(transport, {
    allowUnregisteredSchema,
  });

  const shutdown = async (): Promise<void> => {
    await tracer.close();
    clearActiveTracer(tracer);
    setActiveCoreRuntime(null);
  };
  const runtime: CoreRuntime = { tracer, agentManager, shutdown };
  setActiveCoreRuntime(runtime);
  return runtime;
}
