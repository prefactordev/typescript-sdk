import { voice } from '@livekit/agents';
import { init } from '@prefactor/core';
import { PrefactorLiveKit } from '@prefactor/livekit';

const prefactor = init({
  provider: new PrefactorLiveKit(),
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL ?? 'https://api.prefactor.ai',
    apiToken: process.env.PREFACTOR_API_TOKEN ?? 'prefactor-api-token',
    agentIdentifier: 'livekit-example',
    agentName: 'LiveKit Example Agent',
  },
});

const session = new voice.AgentSession({
  llm: 'openai/gpt-4.1-mini',
});

const { createSessionTracer } = prefactor.getMiddleware();
const sessionTracer = createSessionTracer();

await sessionTracer.attach(session);
await sessionTracer.close();
await prefactor.shutdown();
