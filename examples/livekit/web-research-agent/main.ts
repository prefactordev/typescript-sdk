import 'dotenv/config';

import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
  inference,
  llm,
  ServerOptions,
  type JobContext,
  type JobProcess,
  voice,
} from '@livekit/agents';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';
import { init, type PrefactorClient } from '@prefactor/core';
import {
  DEFAULT_LIVEKIT_AGENT_SCHEMA,
  PrefactorLiveKit,
  type LiveKitMiddleware,
} from '@prefactor/livekit';
import Exa, { type SearchResponse } from 'exa-js';
import { z } from 'zod';

const DEFAULT_PRESET = 'budget';
const DEFAULT_EXA_MAX_RESULTS = 5;
const DEFAULT_EXA_SEARCH_TYPE = 'auto';
const MAX_EXA_RESULTS = 5;
const SEARCH_RESULT_TEXT_CHAR_LIMIT = 1000;
const DEFAULT_PREFACTOR_AGENT_ID = 'web-research-agent';
const DEFAULT_PREFACTOR_AGENT_NAME = 'Web Research Agent';
const USER_AWAY_TIMEOUT_SECONDS = 180;
const LLM_MODEL_OPTIONS = {
  max_completion_tokens: 220,
  parallel_tool_calls: false,
  reasoning_effort: 'minimal',
  verbosity: 'low',
} as const;
const SEARCH_ACKNOWLEDGEMENT = 'One moment while I check the latest information.';
const WELCOME_MESSAGE =
  'Hi there. I can answer simple questions directly and search the web when you need up-to-date information. What would you like to know?';

const EXA_SEARCH_TYPES = [
  'auto',
  'deep',
  'deep-lite',
  'deep-reasoning',
  'fast',
  'hybrid',
  'instant',
  'keyword',
  'neural',
] as const;

const VALID_EXA_SEARCH_TYPES = new Set(EXA_SEARCH_TYPES);

const PRESETS = {
  budget: {
    llmModel: 'openai/gpt-5-mini',
    sttModel: 'deepgram/flux-general',
    sttLanguage: 'en',
    ttsModel: 'deepgram/aura-2',
    ttsVoice: 'athena',
  },
  balanced: {
    llmModel: 'openai/gpt-5.4',
    sttModel: 'deepgram/nova-3',
    sttLanguage: 'en',
    ttsModel: 'cartesia/sonic-3',
    ttsVoice: 'a4a16c5e-5902-4732-b9b6-2a48efd2e11b',
  },
} as const;

const INSTRUCTIONS = `\
You are a voice-first web research assistant.

Runtime context:
- Current local datetime: {currentDatetime}
- Current timezone: {currentTimezone}

Behavior rules:
- Decide whether to answer directly or call the searchWeb tool.
- Use searchWeb when the user needs current events, recent changes, external verification, or other up-to-date web information.
- Do not use searchWeb for greetings, thanks, conversational filler, or requests you can answer from the conversation alone.
- If the user clearly wants to end the call, use the endCall tool immediately.
- Keep answers brief, natural, and easy to follow when spoken.
- Prefer a direct answer first, then a few short supporting details.
- Mention uncertainty when the evidence is weak or conflicting.
- Do not say you searched unless you actually used searchWeb in this turn.
- searchWeb is a single-shot tool for this turn. Build one best-effort query, call it once, then answer from those results instead of refining with more searches.
- After searchWeb returns, give one short spoken paragraph under 60 words. Do not use bullets, markdown, headings, or long lists.
- If the user asks for a TLDR after a search, summarize the search results already in the conversation instead of searching again.
- If searchWeb returns no results or an error, say that plainly and briefly.
`;

type ExaSearchType = (typeof EXA_SEARCH_TYPES)[number];
type AgentPreset = (typeof PRESETS)[keyof typeof PRESETS];
type ProcessUserData = {
  vad?: Awaited<ReturnType<typeof silero.VAD.load>>;
};

type SearchConfig = {
  apiKey: string;
  maxResults: number;
  searchType: ExaSearchType;
  includeDomains: string[];
};

type SearchResult = {
  title: string | null;
  url: string;
  domain: string;
  publishedDate: string | null;
  author: string | null;
  excerpt: string;
};

type SearchToolResult = {
  status: 'ok' | 'no_results' | 'error';
  query: string;
  resolvedSearchType: string | null;
  searchTimeMs: number | null;
  resultCount: number;
  results: SearchResult[];
  error: string | null;
};

type ExaTextContentsOptions = {
  text: {
    maxCharacters: number;
  };
};
type ExaTextSearchResponse = SearchResponse<ExaTextContentsOptions>;

const EXAMPLE_AGENT_SCHEMA = {
  ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
  external_identifier: 'livekit-web-research-example-v2',
  span_schemas: {
    ...(DEFAULT_LIVEKIT_AGENT_SCHEMA.span_schemas as Record<string, unknown>),
    'example:session_setup': {
      title: 'Session Setup',
      description: 'Initial setup for the LiveKit web research session before the agent starts.',
      'prefactor:template':
        'Session setup for {{ preset }} using {{ searchProvider }} (tracing: {{ tracingEnabled }}) -> {{ status | default: "unknown" }}',
      type: 'object',
      properties: {
        preset: { type: 'string' },
        searchProvider: { type: 'string' },
        tracingEnabled: { type: 'boolean' },
      },
      required: ['preset', 'searchProvider', 'tracingEnabled'],
      additionalProperties: false,
    },
    'example:web_search': {
      title: 'Web Search',
      description: 'Single Exa web search used to answer a user request with up-to-date information.',
      'prefactor:template':
        '{% if status == "error" %}Search "{{ query }}" failed{% if error %}: {{ error }}{% endif %}{% elsif status == "no_results" %}Search "{{ query }}" returned no results{% else %}Search "{{ query }}" found {{ resultCount | default: 0 }} results{% if resolvedSearchType %} via {{ resolvedSearchType }}{% endif %}{% endif %}',
      type: 'object',
      properties: {
        query: { type: 'string' },
        provider: { type: 'string' },
        numResults: { type: 'integer', minimum: 1 },
        searchType: { type: 'string' },
        includeDomains: {
          type: ['array', 'null'],
          items: { type: 'string' },
        },
      },
      required: ['query', 'provider', 'numResults', 'searchType'],
      additionalProperties: false,
    },
  },
  span_result_schemas: {
    ...(DEFAULT_LIVEKIT_AGENT_SCHEMA.span_result_schemas as Record<string, unknown>),
    'example:session_setup': {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ready'],
        },
      },
      required: ['status'],
      additionalProperties: false,
    },
    'example:web_search': {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ok', 'no_results', 'error'],
        },
        query: { type: 'string' },
        resolvedSearchType: { type: ['string', 'null'] },
        searchTimeMs: { type: ['number', 'null'] },
        resultCount: { type: 'integer', minimum: 0 },
        error: { type: ['string', 'null'] },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: ['string', 'null'] },
              url: { type: 'string' },
              domain: { type: 'string' },
              publishedDate: { type: ['string', 'null'] },
              author: { type: ['string', 'null'] },
              excerpt: { type: 'string' },
            },
            required: ['title', 'url', 'domain', 'publishedDate', 'author', 'excerpt'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'status',
        'query',
        'resolvedSearchType',
        'searchTimeMs',
        'resultCount',
        'error',
        'results',
      ],
      additionalProperties: false,
    },
  },
  toolSchemas: {
    endCall: {
      spanType: 'end-call',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    searchWeb: {
      spanType: 'search-web',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
} as const satisfies Record<string, unknown>;

function resolvePreset(): { presetName: string; preset: AgentPreset } {
  const presetName = (process.env.AGENT_PRESET?.trim() || DEFAULT_PRESET) as keyof typeof PRESETS;
  return {
    presetName,
    preset: PRESETS[presetName] ?? PRESETS[DEFAULT_PRESET],
  };
}

function resolveSearchConfig(): SearchConfig {
  const apiKey = process.env.EXA_API_KEY?.trim() ?? '';
  if (!apiKey) {
    throw new Error('EXA_API_KEY environment variable is required.');
  }

  const maxResults = Number.parseInt(process.env.EXA_SEARCH_MAX_RESULTS?.trim() ?? '', 10);
  const searchType = process.env.EXA_SEARCH_TYPE?.trim() ?? DEFAULT_EXA_SEARCH_TYPE;

  return {
    apiKey,
    maxResults: Number.isFinite(maxResults)
      ? Math.min(Math.max(1, maxResults), MAX_EXA_RESULTS)
      : DEFAULT_EXA_MAX_RESULTS,
    searchType: VALID_EXA_SEARCH_TYPES.has(searchType as ExaSearchType)
      ? (searchType as ExaSearchType)
      : DEFAULT_EXA_SEARCH_TYPE,
    includeDomains: (process.env.EXA_INCLUDE_DOMAINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function createPrefactorClient(): PrefactorClient<LiveKitMiddleware> | null {
  const apiUrl = process.env.PREFACTOR_API_URL?.trim() ?? '';
  const apiToken = process.env.PREFACTOR_API_TOKEN?.trim() ?? '';
  if (!apiUrl || !apiToken) {
    return null;
  }

  return init({
    provider: new PrefactorLiveKit(),
    httpConfig: {
      apiUrl,
      apiToken,
      agentId: process.env.PREFACTOR_AGENT_ID?.trim() || undefined,
      agentIdentifier: DEFAULT_PREFACTOR_AGENT_ID,
      agentName: process.env.PREFACTOR_AGENT_NAME?.trim() || DEFAULT_PREFACTOR_AGENT_NAME,
      agentSchema: EXAMPLE_AGENT_SCHEMA,
    },
  });
}

function buildAgentInstructions(): string {
  const now = new Date();
  const currentTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'local';

  return INSTRUCTIONS.replace('{currentDatetime}', now.toISOString()).replace(
    '{currentTimezone}',
    currentTimezone,
  );
}

function trimText(value: string, limit = SEARCH_RESULT_EXCERPT_CHAR_LIMIT): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, limit - 3).trimEnd()}...`;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

function buildSearchResult(result: ExaTextSearchResponse['results'][number]): SearchResult {
  return {
    title: result.title,
    url: result.url,
    domain: getDomain(result.url),
    publishedDate: result.publishedDate ?? null,
    author: result.author ?? null,
    excerpt: trimText(result.text),
  };
}

async function runExaSearch(
  client: Exa,
  searchConfig: SearchConfig,
  query: string,
): Promise<SearchToolResult> {
  try {
    const response = await client.search(query, {
      type: searchConfig.searchType,
      numResults: searchConfig.maxResults,
      includeDomains: searchConfig.includeDomains.length > 0 ? searchConfig.includeDomains : undefined,
      contents: {
        text: {
          maxCharacters: SEARCH_RESULT_TEXT_CHAR_LIMIT,
        },
      },
    });

    const results = response.results.map(buildSearchResult);

    return {
      status: results.length > 0 ? 'ok' : 'no_results',
      query,
      resolvedSearchType: response.resolvedSearchType?.trim() || searchConfig.searchType,
      searchTimeMs: response.searchTime ?? null,
      resultCount: results.length,
      results,
      error: null,
    };
  } catch (error) {
    return {
      status: 'error',
      query,
      resolvedSearchType: null,
      searchTimeMs: null,
      resultCount: 0,
      results: [],
      error: error instanceof Error ? error.message : 'Web search failed.',
    };
  }
}

function createSearchTool(options: {
  searchConfig: SearchConfig;
  prefactor: PrefactorClient<LiveKitMiddleware> | null;
}) {
  const exa = new Exa(options.searchConfig.apiKey);

  return llm.tool({
    description:
      'Search the web for up-to-date or externally sourced information. Use this when the answer depends on current facts, recent changes, or specific web sources. Call this at most once per user turn.',
    parameters: z.object({
      query: z.string().min(1).describe('The web search query to run.'),
    }),
    execute: async ({ query }, opts) => {
      const run = (): Promise<SearchToolResult> => runExaSearch(exa, options.searchConfig, query);
      await opts.ctx.waitForPlayout();

      const acknowledgement = opts.ctx.session.say(SEARCH_ACKNOWLEDGEMENT, {
        allowInterruptions: true,
        addToChatCtx: false,
      });

      if (!options.prefactor) {
        const result = await run();
        await acknowledgement.waitForPlayout();
        return result;
      }

      const result = await options.prefactor.withSpan(
        {
          name: 'web_search',
          spanType: 'example:web_search',
          inputs: {
            query,
            provider: 'exa',
            numResults: options.searchConfig.maxResults,
            searchType: options.searchConfig.searchType,
            includeDomains:
              options.searchConfig.includeDomains.length > 0
                ? options.searchConfig.includeDomains
                : null,
          },
        },
        run,
      );

      await acknowledgement.waitForPlayout();
      return result;
    },
  });
}

function createAgent(options: {
  searchConfig: SearchConfig;
  prefactor: PrefactorClient<LiveKitMiddleware> | null;
  disconnectRoom: () => Promise<void>;
}): voice.Agent {
  return new voice.Agent({
    instructions: buildAgentInstructions(),
    tools: {
      endCall: llm.tool({
        description:
          'End the call only when the user clearly indicates they are done or asks to hang up.',
        parameters: z.object({}),
        execute: async (_args, opts) => {
          await opts.ctx.waitForPlayout();
          const goodbye = opts.ctx.session.say('Okay, goodbye.', {
            allowInterruptions: false,
            addToChatCtx: false,
          });
          await goodbye.waitForPlayout();

          await options.disconnectRoom();
          return undefined;
        },
      }),
      searchWeb: createSearchTool(options),
    },
  });
}

function createDisconnectRoom(
  session: voice.AgentSession<ProcessUserData>,
  room: JobContext<ProcessUserData>['room'],
): () => Promise<void> {
  let disconnecting: Promise<void> | null = null;

  return async () => {
    if (disconnecting) {
      return disconnecting;
    }

    disconnecting = (async () => {
      try {
        session.shutdown({
          drain: false,
          reason: 'user_initiated',
        });
      } catch (error) {
        console.error('Failed to shut down agent session during room disconnect.', error);
      }

      await room.disconnect();
    })().finally(() => {
      disconnecting = null;
    });

    return disconnecting;
  };
}

async function entry(ctx: JobContext<ProcessUserData>): Promise<void> {
  const { presetName, preset } = resolvePreset();
  const searchConfig = resolveSearchConfig();
  const prefactor = createPrefactorClient();
  let sessionTracer: ReturnType<LiveKitMiddleware['createSessionTracer']> | null = null;
  let tracingClosed = false;

  const closeTracing = async (): Promise<void> => {
    if (tracingClosed) {
      return;
    }

    tracingClosed = true;
    await sessionTracer?.close();
    await prefactor?.shutdown();
  };

  ctx.addShutdownCallback(closeTracing);

  const session = new voice.AgentSession<ProcessUserData>({
    llm: new inference.LLM({
      model: preset.llmModel,
      modelOptions: LLM_MODEL_OPTIONS,
    }),
    stt: new inference.STT({
      model: preset.sttModel,
      language: preset.sttLanguage,
    }),
    tts: new inference.TTS({
      model: preset.ttsModel,
      voice: preset.ttsVoice,
    }),
    vad: ctx.proc.userData.vad,
    userAwayTimeout: USER_AWAY_TIMEOUT_SECONDS,
    turnHandling: {
      turnDetection: new livekit.turnDetector.MultilingualModel(),
      preemptiveGeneration: {
        enabled: false,
      },
    },
  });

  const agent = createAgent({
    searchConfig,
    prefactor,
    disconnectRoom: createDisconnectRoom(session, ctx.room),
  });

  try {
    if (prefactor) {
      try {
        await prefactor.withSpan(
          {
            name: 'session_setup',
            spanType: 'example:session_setup',
            inputs: {
              preset: presetName,
              searchProvider: 'exa',
              tracingEnabled: true,
            },
          },
          async () => ({ status: 'ready' }),
        );

        sessionTracer = prefactor.getMiddleware().createSessionTracer();
        await sessionTracer.start(session, {
          agent,
          room: ctx.room,
        });
      } catch (error) {
        console.error('Prefactor tracing setup failed, continuing without tracing.', error);
        await closeTracing();
        await session.start({
          agent,
          room: ctx.room,
        });
      }
    } else {
      await session.start({
        agent,
        room: ctx.room,
      });
    }

    session.say(WELCOME_MESSAGE, {
      allowInterruptions: true,
    });
  } catch (error) {
    await closeTracing();
    throw error;
  }
}

async function prewarm(proc: JobProcess<ProcessUserData>): Promise<void> {
  proc.userData.vad = await silero.VAD.load();
}

export default defineAgent<ProcessUserData>({
  entry,
  prewarm,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: DEFAULT_PREFACTOR_AGENT_ID,
    }),
  );
}
