import { initializeLogger, voice } from '@livekit/agents';
import { init } from '@prefactor/core';
import { DEFAULT_LIVEKIT_AGENT_SCHEMA, PrefactorLiveKit } from '@prefactor/livekit';

initializeLogger({ pretty: true, level: 'info' });

const apiUrl = process.env.PREFACTOR_API_URL;
const apiToken = process.env.PREFACTOR_API_TOKEN;
const agentId = process.env.PREFACTOR_AGENT_ID;

if (!apiUrl || !apiToken || !agentId) {
  throw new Error(
    'PREFACTOR_API_URL, PREFACTOR_API_TOKEN, and PREFACTOR_AGENT_ID must be set.',
  );
}

const prefactor = init({
  provider: new PrefactorLiveKit(),
  httpConfig: {
    apiUrl,
    apiToken,
    agentId,
    agentIdentifier: 'livekit-example',
    agentName: 'LiveKit Example Agent',
    agentSchema: DEFAULT_LIVEKIT_AGENT_SCHEMA,
  },
});

const session = new voice.AgentSession({
  llm: 'openai/gpt-5.4-mini',
});
const agent = new voice.Agent({
  instructions: 'You are a concise voice assistant.',
});

const { createSessionTracer } = prefactor.getMiddleware();
const sessionTracer = createSessionTracer();

try {
  await sessionTracer.start(session, { agent });
  await session.run({ userInput: 'Say hello in one sentence.' }).wait();
} finally {
  await sessionTracer.close();
  await prefactor.shutdown();
}
