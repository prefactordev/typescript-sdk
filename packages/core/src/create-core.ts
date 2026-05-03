import { extractPartition, type Partition } from '@prefactor/pfid';
import { AgentInstanceManager } from './agent/instance-manager.js';
import type { Config } from './config.js';
import { HttpTransportConfigSchema } from './config.js';
import { setActiveCoreRuntime } from './lifecycle.js';
import { TerminationMonitor } from './monitoring/termination-monitor.js';
import { clearActiveTracer, setActiveTracer } from './tracing/active-tracer.js';
import { Tracer } from './tracing/tracer.js';
import { HttpTransport } from './transport/http.js';

export type CoreRuntime = {
  tracer: Tracer;
  agentManager: AgentInstanceManager;
  terminationMonitor: TerminationMonitor;
  shutdown: () => Promise<void>;
};

export type CreateCoreOptions = {
  /** Optional adapter identifier appended ahead of the core SDK header. */
  sdkHeaderEntry?: string;
};

/**
 * Creates a fully initialized core runtime from validated SDK configuration.
 *
 * @param config - Resolved SDK configuration.
 * @param options - Optional runtime construction options.
 * @returns Runtime containing tracer, agent manager, and shutdown function.
 */
export function createCore(config: Config, options: CreateCoreOptions = {}): CoreRuntime {
  if (!config.httpConfig) {
    throw new Error('HTTP transport requires httpConfig to be provided in configuration');
  }

  const httpConfig = HttpTransportConfigSchema.parse(config.httpConfig);
  const transport = new HttpTransport(httpConfig, {
    failureHandling: config.failureHandling,
    sdkHeaderEntry: options.sdkHeaderEntry,
  });

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

  const terminationMonitor = new TerminationMonitor(transport.getHttpRequester(), () =>
    transport.getAgentInstanceId()
  );
  const syncInterval = setInterval(() => terminationMonitor.sync(), 1_000);

  const shutdown = async (): Promise<void> => {
    try {
      clearInterval(syncInterval);
      terminationMonitor.destroy();
      await tracer.close();
    } finally {
      clearActiveTracer(tracer);
      setActiveCoreRuntime(null);
    }
  };
  const runtime: CoreRuntime = { tracer, agentManager, terminationMonitor, shutdown };
  setActiveCoreRuntime(runtime);
  return runtime;
}
