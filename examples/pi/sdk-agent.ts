/**
 * pi SDK Example for @prefactor/pi
 *
 * Builds an agent on pi's SDK, loads the Prefactor extension through `extensionFactories`, and
 * records the session in Prefactor as one agent instance. The agent version is set when the
 * extension is loaded; leave `agentVersion` out to record the pi framework's version instead.
 *
 * The example uses pi's `AgentSessionRuntime`, because its `dispose()` runs the extension's
 * `session_shutdown` handler, which finishes the agent instance. `AgentSession.dispose()` on its
 * own does not.
 *
 * pi reads its model and provider credentials from `~/.pi/agent` (or `PI_CODING_AGENT_DIR`), as
 * for the `pi` command.
 *
 * Run:
 *   PREFACTOR_API_TOKEN=... bun examples/pi/sdk-agent.ts "What files are in this directory?"
 */

import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { prefactorExtension } from '@prefactor/pi';

const apiToken = process.env.PREFACTOR_API_TOKEN;
if (!apiToken) {
  throw new Error('PREFACTOR_API_TOKEN is required to send the session to Prefactor.');
}

const prompt = process.argv[2] ?? 'What files are in the current directory?';

const createRuntime: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({
    cwd,
    resourceLoaderOptions: {
      extensionFactories: [
        prefactorExtension({
          apiUrl: process.env.PREFACTOR_API_URL,
          apiToken,
          agentId: process.env.PREFACTOR_AGENT_ID,
          agentVersion: '1.0.0',
        }),
      ],
    },
  });
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.inMemory(),
});

try {
  // Binding extensions emits session_start, which starts the Prefactor agent instance.
  await runtime.session.bindExtensions({});
  runtime.session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await runtime.session.prompt(prompt);
  process.stdout.write('\n');
} finally {
  // Runs session_shutdown, which sends the remaining spans and finishes the agent instance.
  await runtime.dispose();
}
