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
import Exa from 'exa-js';
import { z } from 'zod';

const DEFAULT_PRESET = 'budget';
const DEFAULT_EXA_MAX_RESULTS = 5;
const DEFAULT_EXA_SEARCH_TYPE = 'auto';
const MAX_EXA_RESULTS = 5;
const SEARCH_RESULT_TEXT_CHAR_LIMIT = 1600;
const DEFAULT_PREFACTOR_AGENT_ID = 'web-research-agent';
const DEFAULT_PREFACTOR_AGENT_NAME = 'Web Research Agent';
const WELCOME_MESSAGE =
  'Hi there, I am a web research agent that can search the web with up to date information. ' +
  "Please tell me what you'd like to search today!";
const SEARCH_ACKNOWLEDGEMENT =
  'Let me check that for you. Please wait while I search the web.';
const SEARCH_ERROR_MESSAGE =
  'I hit a problem while searching the web just now. Please try again.';
const SEARCH_NO_RESULTS_MESSAGE =
  'I could not find enough reliable web results to answer that.';

const SMALL_TALK_MESSAGES = new Set([
  'bye',
  'goodbye',
  'good morning',
  'good afternoon',
  'good evening',
  'hello',
  'hey',
  'hi',
  'how are you',
  'how are you doing',
  'thanks',
  'thank you',
  'who are you',
]);

const END_CALL_PHRASES = [
  'hang up',
  'hang up now',
  'hang up the call',
  'please hang up',
  'end the call',
  'end call',
  'disconnect',
  'thats all',
  'that is all',
  'nothing else',
  'no thats enough',
  'no that is enough',
];

const DIRECT_RESPONSE_PHRASES = [
  'can you hear me',
  'help me',
  'repeat that',
  'say that again',
  'speak louder',
  'slow down',
  'stop',
  'wait',
];

const SEARCH_TRIGGER_PREFIXES = [
  'what ',
  'whats ',
  "what's ",
  'who ',
  'whos ',
  "who's ",
  'when ',
  'where ',
  'which ',
  'why ',
  'how ',
  'tell me about ',
  'explain ',
  'compare ',
  'find ',
  'search ',
  'look up ',
  'check ',
];

const SEARCH_TRIGGER_SUBSTRINGS = [
  'latest',
  'today',
  'current',
  'currently',
  'recent',
  'recently',
  'news',
  'price',
  'weather',
  'score',
  'stock',
  'market cap',
  'release date',
  'update on',
  'what happened',
  'search the web',
  'look it up',
  'on the web',
  'online',
];

const EXA_SEARCH_TYPES = [
  'auto',
  'deep',
  'deep-lite',
  'deep-max',
  'deep-reasoning',
  'fast',
  'hybrid',
  'instant',
  'keyword',
  'magic',
  'neural',
] as const;

type ExaSearchType = (typeof EXA_SEARCH_TYPES)[number];

const VALID_EXA_SEARCH_TYPES = new Set<ExaSearchType>(EXA_SEARCH_TYPES);

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
You are the voice front-end for a web research assistant.

Runtime context:
- Current local datetime: {currentDatetime}
- Current timezone: {currentTimezone}

Behavior rules:
- Answer simple greetings, thanks, and conversational remarks directly.
- If the user asks to end the call, hang up, disconnect, or says they are done, use the end call tool immediately.
- Keep conversational replies short and easy to follow in voice.
- Keep every direct reply under 80 words.
- Do not claim you searched the web unless search findings were explicitly provided to you.
`;

const SUBAGENT_INSTRUCTIONS = `\
You are a background web research subagent for a live voice assistant.

Use only the provided web search results.

Rules:
- Answer in plain text suitable for speech.
- Start with a short TLDR sentence.
- Then give 2 to 4 short supporting sentences.
- End with "Sources:" followed by 2 to 4 source titles or domains.
- Mention uncertainty, weak evidence, or conflicting reports explicitly.
- Never invent facts, sources, dates, quotes, or certainty.
- Keep the full answer under 170 words.
`;

type SearchConfig = {
  apiKey: string;
  maxResults: number;
  searchType: ExaSearchType;
  includeDomains: string[];
};

type SearchResult = {
  title: string | null;
  url: string | null;
  domain: string | null;
  publishedDate: string | null;
  author: string | null;
  text: string;
};

type SearchPayload = {
  query: string;
  resolvedSearchType: string | null;
  searchTimeMs: number | null;
  resultCount: number;
  results: SearchResult[];
};

type SearchReport = {
  status: 'ok' | 'no_results';
  query: string;
  searchPayload: SearchPayload;
  answer: string;
};

type AgentPreset = (typeof PRESETS)[keyof typeof PRESETS];
type ProcessUserData = {
  vad?: Awaited<ReturnType<typeof silero.VAD.load>>;
};

const EXAMPLE_AGENT_SCHEMA = {
  ...DEFAULT_LIVEKIT_AGENT_SCHEMA,
  external_identifier: 'livekit-web-research-example-v1',
  span_schemas: {
    ...(DEFAULT_LIVEKIT_AGENT_SCHEMA.span_schemas as Record<string, unknown>),
    'example:session_setup': {
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
      type: 'object',
      properties: {
        question: { type: 'string' },
        provider: { type: 'string' },
        numResults: { type: 'integer', minimum: 1 },
        searchType: { type: 'string' },
        includeDomains: {
          type: ['array', 'null'],
          items: { type: 'string' },
        },
      },
      required: ['question', 'provider', 'numResults', 'searchType'],
      additionalProperties: false,
    },
  },
  span_result_schemas: {
    ...(DEFAULT_LIVEKIT_AGENT_SCHEMA.span_result_schemas as Record<string, unknown>),
    'example:session_setup': {
      type: 'object',
      properties: {
        status: { type: 'string' },
      },
      required: ['status'],
      additionalProperties: false,
    },
    'example:web_search': {
      type: 'object',
      properties: {
        status: { type: 'string' },
        query: { type: 'string' },
        answer: { type: 'string' },
        searchPayload: {
          type: 'object',
          additionalProperties: true,
        },
      },
      required: ['status', 'query', 'answer', 'searchPayload'],
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

  const rawMaxResults = process.env.EXA_SEARCH_MAX_RESULTS?.trim() ?? '';
  const parsedMaxResults = Number.parseInt(rawMaxResults, 10);
  const maxResults = Number.isFinite(parsedMaxResults)
    ? parsedMaxResults
    : DEFAULT_EXA_MAX_RESULTS;

  const rawSearchType = process.env.EXA_SEARCH_TYPE?.trim() || DEFAULT_EXA_SEARCH_TYPE;
  const searchType = isExaSearchType(rawSearchType)
    ? rawSearchType
    : DEFAULT_EXA_SEARCH_TYPE;

  return {
    apiKey,
    maxResults: Math.min(Math.max(1, maxResults), MAX_EXA_RESULTS),
    searchType,
    includeDomains: (process.env.EXA_INCLUDE_DOMAINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function isExaSearchType(value: string): value is ExaSearchType {
  return VALID_EXA_SEARCH_TYPES.has(value as ExaSearchType);
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

function currentRuntimeContext(): { currentDatetime: string; currentTimezone: string } {
  const now = new Date();
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || 'local';

  return {
    currentDatetime: now.toISOString(),
    currentTimezone: timeZone,
  };
}

function buildAgentInstructions(): string {
  const { currentDatetime, currentTimezone } = currentRuntimeContext();
  return INSTRUCTIONS.replace('{currentDatetime}', currentDatetime).replace(
    '{currentTimezone}',
    currentTimezone,
  );
}

function normalizeUserText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => normalized.includes(phrase));
}

function shouldEndCall(value: string): boolean {
  const normalized = normalizeUserText(value);
  return normalized.length > 0 && containsPhrase(normalized, END_CALL_PHRASES);
}

function shouldBackgroundSearch(value: string): boolean {
  const normalized = normalizeUserText(value);
  if (!normalized) {
    return false;
  }

  if (SMALL_TALK_MESSAGES.has(normalized)) {
    return false;
  }

  if (containsPhrase(normalized, END_CALL_PHRASES)) {
    return false;
  }

  if (containsPhrase(normalized, DIRECT_RESPONSE_PHRASES)) {
    return false;
  }

  if (SEARCH_TRIGGER_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  return containsPhrase(normalized, SEARCH_TRIGGER_SUBSTRINGS);
}

function extractDomain(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function trimText(value: string | null, limit = SEARCH_RESULT_TEXT_CHAR_LIMIT): string {
  if (!value) {
    return '';
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, limit - 3).trimEnd()}...`;
}

function buildSearchResult(rawResult: Record<string, unknown>): SearchResult {
  const url = readString(rawResult, 'url');
  return {
    title: readString(rawResult, 'title'),
    url,
    domain: extractDomain(url),
    publishedDate:
      readString(rawResult, 'publishedDate') ?? readString(rawResult, 'published_date'),
    author: readString(rawResult, 'author'),
    text: trimText(readString(rawResult, 'text')),
  };
}

async function runExaSearch(
  client: Exa,
  searchConfig: SearchConfig,
  question: string,
): Promise<SearchPayload> {
  const response = (await client.search(question, {
    type: searchConfig.searchType,
    numResults: searchConfig.maxResults,
    includeDomains: searchConfig.includeDomains.length > 0 ? searchConfig.includeDomains : undefined,
    contents: {
      text: true,
    },
  })) as unknown;

  const responseRecord = asRecord(response);
  const rawResults = readArray(responseRecord, 'results');
  const results = rawResults
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value !== null)
    .map(buildSearchResult);

  return {
    query: question,
    resolvedSearchType:
      readString(responseRecord, 'resolvedSearchType') ??
      readString(responseRecord, 'resolved_search_type') ??
      searchConfig.searchType,
    searchTimeMs:
      readNumber(responseRecord, 'searchTime') ?? readNumber(responseRecord, 'search_time'),
    resultCount: results.length,
    results,
  };
}

function formatSearchPayloadForPrompt(searchPayload: SearchPayload): string {
  if (searchPayload.results.length === 0) {
    return 'No search results were returned.';
  }

  return searchPayload.results
    .map((result, index) =>
      [
        `Result ${index + 1}`,
        `Title: ${result.title ?? 'Untitled'}`,
        `URL: ${result.url ?? 'N/A'}`,
        `Domain: ${result.domain ?? 'unknown'}`,
        `Published date: ${result.publishedDate ?? 'unknown'}`,
        `Author: ${result.author ?? 'unknown'}`,
        `Excerpt: ${trimText(result.text, 900) || 'No excerpt'}`,
      ].join('\n'),
    )
    .join('\n\n');
}

function buildResearchPrompt(question: string, searchPayload: SearchPayload): string {
  const { currentDatetime, currentTimezone } = currentRuntimeContext();
  return [
    `Current local datetime: ${currentDatetime}`,
    `Current timezone: ${currentTimezone}`,
    `Original user question: ${question}`,
    `Resolved search type: ${searchPayload.resolvedSearchType ?? 'unknown'}`,
    `Search time ms: ${searchPayload.searchTimeMs ?? 'unknown'}`,
    `Result count: ${searchPayload.resultCount}`,
    'Search results:',
    formatSearchPayloadForPrompt(searchPayload),
  ].join('\n\n');
}

async function collectLlmText(chat: AsyncIterable<llm.ChatChunk>): Promise<string> {
  const parts: string[] = [];
  for await (const chunk of chat) {
    if (chunk.delta?.content) {
      parts.push(chunk.delta.content);
    }
  }

  return parts.join('').trim();
}

class WebSearchSubagent {
  private readonly searchConfig: SearchConfig;
  private readonly exaClient: Exa;
  private readonly model: inference.LLM;
  private readonly prefactor: PrefactorClient<LiveKitMiddleware> | null;

  constructor(options: {
    searchConfig: SearchConfig;
    llmModel: string;
    prefactor: PrefactorClient<LiveKitMiddleware> | null;
  }) {
    this.searchConfig = options.searchConfig;
    this.exaClient = new Exa(options.searchConfig.apiKey);
    this.model = new inference.LLM({
      model: options.llmModel,
      modelOptions: {
        verbosity: 'low',
      },
    });
    this.prefactor = options.prefactor;
  }

  async close(): Promise<void> {
    await this.model.aclose();
  }

  async research(question: string): Promise<SearchReport> {
    const runSearch = async (): Promise<SearchReport> => {
      const searchPayload = await runExaSearch(this.exaClient, this.searchConfig, question);

      if (searchPayload.resultCount === 0) {
        return {
          status: 'no_results',
          query: question,
          searchPayload,
          answer: SEARCH_NO_RESULTS_MESSAGE,
        };
      }

      const chatCtx = llm.ChatContext.empty();
      chatCtx.addMessage({
        role: 'system',
        content: SUBAGENT_INSTRUCTIONS,
      });
      chatCtx.addMessage({
        role: 'user',
        content: buildResearchPrompt(question, searchPayload),
      });

      const answer =
        (await collectLlmText(this.model.chat({ chatCtx, toolChoice: 'none' }))) ||
        SEARCH_NO_RESULTS_MESSAGE;

      return {
        status: 'ok',
        query: question,
        searchPayload,
        answer,
      };
    };

    if (!this.prefactor) {
      return runSearch();
    }

    return this.prefactor.withSpan(
      {
        name: 'web_search',
        spanType: 'example:web_search',
        inputs: {
          question,
          provider: 'exa',
          numResults: this.searchConfig.maxResults,
          searchType: this.searchConfig.searchType,
          includeDomains:
            this.searchConfig.includeDomains.length > 0 ? this.searchConfig.includeDomains : null,
        },
      },
      runSearch,
    );
  }
}

class WebResearchAgent extends voice.Agent {
  private readonly subagent: WebSearchSubagent;
  private requestGeneration = 0;
  private pendingSearch: Promise<void> | null = null;
  private isClosed = false;

  constructor(options: {
    searchConfig: SearchConfig;
    llmModel: string;
    prefactor: PrefactorClient<LiveKitMiddleware> | null;
  }) {
    super({
      instructions: buildAgentInstructions(),
      tools: {
        endCall: llm.tool({
          description:
            'End the call only when the user clearly indicates they are done or asks to hang up.',
          parameters: z.object({}),
          execute: async (_args, opts) => {
            opts.ctx.session.shutdown({
              drain: true,
              reason: 'user_initiated',
            });
            return {
              status: 'ending_call',
            };
          },
        }),
      },
    });

    this.subagent = new WebSearchSubagent({
      searchConfig: options.searchConfig,
      llmModel: options.llmModel,
      prefactor: options.prefactor,
    });
  }

  override async onUserTurnCompleted(
    _turnCtx: llm.ChatContext,
    newMessage: llm.ChatMessage,
  ): Promise<void> {
    this.requestGeneration += 1;
    const requestGeneration = this.requestGeneration;

    const userText = newMessage.textContent?.trim() ?? '';
    if (!userText || shouldEndCall(userText)) {
      return;
    }

    if (!shouldBackgroundSearch(userText)) {
      return;
    }

    // StopResponse skips the normal persistence path, so keep the user turn in the session history.
    this._chatCtx.items.push(newMessage);
    this.session._conversationItemAdded(newMessage);

    this.session.say(SEARCH_ACKNOWLEDGEMENT, {
      allowInterruptions: true,
      addToChatCtx: false,
    });

    const task = this.runBackgroundSearch(requestGeneration, userText);
    this.pendingSearch = task.finally(() => {
      if (this.pendingSearch === task) {
        this.pendingSearch = null;
      }
    });

    throw new voice.StopResponse();
  }

  override async onExit(): Promise<void> {
    this.isClosed = true;
    this.requestGeneration += 1;
    await this.subagent.close();
  }

  private async runBackgroundSearch(
    requestGeneration: number,
    userText: string,
  ): Promise<void> {
    try {
      const report = await this.subagent.research(userText);
      if (this.isClosed || requestGeneration !== this.requestGeneration) {
        return;
      }

      this.session.say(report.answer, {
        allowInterruptions: true,
      });
    } catch {
      if (this.isClosed || requestGeneration !== this.requestGeneration) {
        return;
      }

      this.session.say(SEARCH_ERROR_MESSAGE, {
        allowInterruptions: true,
      });
    }
  }
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

  const session = new voice.AgentSession({
    llm: new inference.LLM({
      model: preset.llmModel,
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
    turnHandling: {
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    },
    preemptiveGeneration: false,
  });

  const agent = new WebResearchAgent({
    searchConfig,
    llmModel: preset.llmModel,
    prefactor,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readArray(record: Record<string, unknown> | null, key: string): unknown[] {
  const value = record?.[key];
  return Array.isArray(value) ? value : [];
}
