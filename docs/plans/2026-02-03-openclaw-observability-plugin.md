# OpenClaw Observability Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `@prefactor/openclaw` package that registers an OpenClaw plugin and emits Prefactor spans for agent runs, tool calls, and message IO.

**Architecture:** The plugin is a thin OpenClaw hook adapter that initializes a Prefactor core runtime, maps hook events to spans (AGENT/TOOL/CHAIN), and shuts down cleanly. Configuration is provided via OpenClaw plugin config with env fallbacks for credentials.

**Tech Stack:** TypeScript, Bun (bun test/build), `@prefactor/core` tracing utilities, OpenClaw plugin hooks.

---

### Task 1: Scaffold the new package and build wiring

**Files:**
- Create: `packages/openclaw/package.json`
- Create: `packages/openclaw/tsconfig.json`
- Create: `packages/openclaw/src/index.ts`
- Create: `packages/openclaw/src/types.ts`
- Create: `packages/openclaw/src/config.ts`
- Create: `packages/openclaw/src/init.ts`
- Create: `packages/openclaw/src/instrumentation.ts`
- Create: `packages/openclaw/README.md`
- Modify: `scripts/build.ts`
- Modify: `tsconfig.json`
- Modify: `package.json`

**Step 1: Create package.json (minimal metadata + OpenClaw manifest)**

```json
{
  "name": "@prefactor/openclaw",
  "version": "0.2.0",
  "description": "OpenClaw plugin for Prefactor observability",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "keywords": ["prefactor", "observability", "openclaw", "tracing", "plugin"],
  "author": "Prefactor",
  "license": "MIT",
  "dependencies": {
    "@prefactor/core": "workspace:*",
    "@prefactor/pfid": "^0.1.0"
  },
  "openclaw": {
    "extensions": ["./dist/index.js"],
    "configSchema": {
      "type": "object",
      "properties": {
        "transportType": { "type": "string", "enum": ["stdio", "http"] },
        "sampleRate": { "type": "number", "minimum": 0, "maximum": 1 },
        "captureInputs": { "type": "boolean" },
        "captureOutputs": { "type": "boolean" },
        "maxInputLength": { "type": "number", "minimum": 1 },
        "maxOutputLength": { "type": "number", "minimum": 1 },
        "httpConfig": {
          "type": "object",
          "properties": {
            "apiUrl": { "type": "string" },
            "apiToken": { "type": "string" },
            "agentId": { "type": "string" },
            "agentIdentifier": { "type": "string" },
            "agentName": { "type": "string" },
            "agentDescription": { "type": "string" },
            "schemaName": { "type": "string" },
            "schemaIdentifier": { "type": "string" },
            "agentSchemaIdentifier": { "type": "string" },
            "skipSchema": { "type": "boolean" }
          }
        }
      }
    }
  },
  "engines": { "node": ">=24.0.0" }
}
```

**Step 2: Add tsconfig for the package**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true,
    "paths": {
      "@prefactor/core": ["../core/src/index.ts"]
    }
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

**Step 3: Wire build + references**

- Add `@prefactor/openclaw` to `scripts/build.ts` packages list after `@prefactor/langchain` with `external: ['@prefactor/core', '@prefactor/pfid']`.
- Add `{ "path": "./packages/openclaw" }` to root `tsconfig.json` references.
- Add `"@prefactor/openclaw": "workspace:*"` to root `package.json` devDependencies.

**Step 4: Add placeholder exports**

```ts
// packages/openclaw/src/index.ts
export { init, shutdown, getTracer, register } from './init.js';
export type { PluginConfig, OpenClawPluginApi } from './types.js';
export default register;
```

**Step 5: Commit**

```bash
git add packages/openclaw package.json scripts/build.ts tsconfig.json
git commit -m "feat: scaffold openclaw package"
```

---

### Task 2: Config resolution with env fallbacks

**Files:**
- Modify: `packages/openclaw/src/config.ts`
- Create: `packages/openclaw/tests/config.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { resolveConfig } from '../src/config.js';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('resolveConfig', () => {
  test('uses env http credentials when missing from config', () => {
    process.env.PREFACTOR_API_URL = 'https://api.prefactor.ai';
    process.env.PREFACTOR_API_TOKEN = 'env-token';

    const config = resolveConfig({ transportType: 'http' });

    expect(config?.httpConfig?.apiUrl).toBe('https://api.prefactor.ai');
    expect(config?.httpConfig?.apiToken).toBe('env-token');
  });

  test('prefers explicit httpConfig over env', () => {
    process.env.PREFACTOR_API_URL = 'https://api.prefactor.ai';
    process.env.PREFACTOR_API_TOKEN = 'env-token';

    const config = resolveConfig({
      transportType: 'http',
      httpConfig: { apiUrl: 'https://example.com', apiToken: 'config-token' },
    });

    expect(config?.httpConfig?.apiUrl).toBe('https://example.com');
    expect(config?.httpConfig?.apiToken).toBe('config-token');
  });

  test('returns null when http transport is missing credentials', () => {
    delete process.env.PREFACTOR_API_URL;
    delete process.env.PREFACTOR_API_TOKEN;

    const config = resolveConfig({ transportType: 'http' });

    expect(config).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/config.test.ts`
Expected: FAIL with "Cannot find module" or missing export

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/config.ts
import { type Config, createConfig } from '@prefactor/core';

export type PluginConfig = Partial<Config> & {
  httpConfig?: Config['httpConfig'];
};

export function resolveConfig(config?: PluginConfig): Config | null {
  const transportType =
    config?.transportType ??
    (process.env.PREFACTOR_TRANSPORT as 'stdio' | 'http' | undefined) ??
    'stdio';

  let httpConfig = config?.httpConfig;
  if (transportType === 'http') {
    const apiUrl = httpConfig?.apiUrl ?? process.env.PREFACTOR_API_URL;
    const apiToken = httpConfig?.apiToken ?? process.env.PREFACTOR_API_TOKEN;

    if (!apiUrl || !apiToken) {
      return null;
    }

    httpConfig = {
      schemaName: 'openclaw:agent',
      ...httpConfig,
      apiUrl,
      apiToken,
    };
  }

  return createConfig({ ...config, transportType, httpConfig });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/config.ts packages/openclaw/tests/config.test.ts
git commit -m "feat: add openclaw config resolver"
```

---

### Task 3: Core init/shutdown lifecycle

**Files:**
- Modify: `packages/openclaw/src/init.ts`
- Create: `packages/openclaw/tests/init.test.ts`

**Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { init, shutdown } from '../src/init.js';

describe('init/shutdown', () => {
  afterEach(async () => {
    await shutdown();
  });

  test('returns null when http config missing credentials', () => {
    const plugin = init({ transportType: 'http' });
    expect(plugin).toBeNull();
  });

  test('returns runtime helpers when config is valid', () => {
    const plugin = init({
      transportType: 'http',
      httpConfig: { apiUrl: 'https://example.com', apiToken: 'token' },
    });

    expect(plugin?.tracer).toBeDefined();
    expect(plugin?.agentManager).toBeDefined();
    expect(plugin?.config.transportType).toBe('http');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/init.test.ts`
Expected: FAIL with missing exports

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/init.ts
import {
  type Config,
  type CoreRuntime,
  DEFAULT_AGENT_SCHEMA,
  createCore,
  getLogger,
} from '@prefactor/core';
import { resolveConfig, type PluginConfig } from './config.js';

const logger = getLogger('openclaw');

type OpenClawRuntime = CoreRuntime & { config: Config };

let runtime: OpenClawRuntime | null = null;

export type InitResult = OpenClawRuntime | null;

export function init(config?: PluginConfig): InitResult {
  if (runtime) {
    return runtime;
  }

  const resolved = resolveConfig(config);
  if (!resolved) {
    logger.error('OpenClaw Prefactor plugin: missing HTTP credentials');
    return null;
  }

  const core = createCore(resolved);
  runtime = { ...core, config: resolved };

  const httpConfig = resolved.httpConfig;
  if (httpConfig?.agentSchema) {
    runtime.agentManager.registerSchema(httpConfig.agentSchema);
  } else if (
    resolved.transportType === 'http' &&
    (httpConfig?.agentSchemaIdentifier || httpConfig?.skipSchema)
  ) {
    logger.debug('Skipping default schema registration based on httpConfig');
  } else {
    runtime.agentManager.registerSchema(DEFAULT_AGENT_SCHEMA);
  }

  return runtime;
}

export function getTracer() {
  return runtime?.tracer ?? null;
}

export async function shutdown(): Promise<void> {
  if (!runtime) return;
  await runtime.shutdown();
  runtime = null;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/init.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/init.ts packages/openclaw/tests/init.test.ts
git commit -m "feat: add openclaw init/shutdown"
```

---

### Task 4: Agent span instrumentation

**Files:**
- Modify: `packages/openclaw/src/instrumentation.ts`
- Create: `packages/openclaw/tests/agent-spans.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import { SpanStatus, SpanType, SpanContext } from '@prefactor/core';
import { createInstrumentation } from '../src/instrumentation.js';

class FakeTracer {
  spans: any[] = [];
  ended: any[] = [];
  startSpan(options: any) {
    const parent = SpanContext.getCurrent();
    const span = {
      spanId: `span-${this.spans.length + 1}`,
      parentSpanId: parent?.spanId ?? null,
      traceId: parent?.traceId ?? 'trace-1',
      name: options.name,
      spanType: options.spanType,
      startTime: Date.now(),
      endTime: null,
      status: SpanStatus.RUNNING,
      inputs: options.inputs,
      outputs: null,
      tokenUsage: null,
      error: null,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    };
    this.spans.push(span);
    return span;
  }
  endSpan(span: any, options?: any) {
    this.ended.push({ span, options });
  }
}

test('agent start/end creates AGENT span', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.beforeAgentStart({ agentId: 'main' }, { sessionKey: 'agent:main:main' });
  instrumentation.agentEnd({ status: 'ok' }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans[0].spanType).toBe(SpanType.AGENT);
  expect(tracer.ended.length).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/agent-spans.test.ts`
Expected: FAIL with missing export

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/instrumentation.ts
import { SpanContext, SpanType } from '@prefactor/core';
import { serializeValue } from '@prefactor/core';
import type { Config, Span, Tracer } from '@prefactor/core';

type HookContext = { sessionKey?: string; runId?: string; agentId?: string };

const toKey = (ctx: HookContext): string =>
  ctx.sessionKey ?? ctx.runId ?? ctx.agentId ?? 'unknown';

const sanitize = (value: unknown, maxLength: number): unknown =>
  serializeValue(value, maxLength);

export function createInstrumentation(tracer: Tracer, config: Config) {
  const agentSpans = new Map<string, Span>();

  const beforeAgentStart = (event: Record<string, unknown>, ctx: HookContext) => {
    const key = toKey(ctx);
    const inputs = config.captureInputs
      ? (sanitize(event, config.maxInputLength) as Record<string, unknown>)
      : {};

    const span = tracer.startSpan({
      name: `openclaw:${ctx.agentId ?? 'agent'}`,
      spanType: SpanType.AGENT,
      inputs,
    });
    agentSpans.set(key, span);
  };

  const agentEnd = (event: Record<string, unknown>, ctx: HookContext) => {
    const key = toKey(ctx);
    const span = agentSpans.get(key);
    if (!span) return;
    const outputs = config.captureOutputs
      ? (sanitize(event, config.maxOutputLength) as Record<string, unknown>)
      : undefined;
    tracer.endSpan(span, { outputs });
    agentSpans.delete(key);
  };

  return { beforeAgentStart, agentEnd, agentSpans };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/agent-spans.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/instrumentation.ts packages/openclaw/tests/agent-spans.test.ts
git commit -m "feat: add agent span instrumentation"
```

---

### Task 5: Tool call span instrumentation (FIFO pairing)

**Files:**
- Modify: `packages/openclaw/src/instrumentation.ts`
- Create: `packages/openclaw/tests/tool-spans.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import { SpanContext, SpanStatus, SpanType } from '@prefactor/core';
import { createInstrumentation } from '../src/instrumentation.js';

class FakeTracer {
  spans: any[] = [];
  ended: any[] = [];
  startSpan(options: any) {
    const parent = SpanContext.getCurrent();
    const span = {
      spanId: `span-${this.spans.length + 1}`,
      parentSpanId: parent?.spanId ?? null,
      traceId: parent?.traceId ?? 'trace-1',
      name: options.name,
      spanType: options.spanType,
      startTime: Date.now(),
      endTime: null,
      status: SpanStatus.RUNNING,
      inputs: options.inputs,
      outputs: null,
      tokenUsage: null,
      error: null,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    };
    this.spans.push(span);
    return span;
  }
  endSpan(span: any, options?: any) {
    this.ended.push({ span, options });
  }
}

test('tool spans are parented to agent span and paired FIFO', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.beforeAgentStart({ agentId: 'main' }, { sessionKey: 'agent:main:main' });
  instrumentation.beforeToolCall({ toolName: 'search', params: { q: 'hi' } }, { sessionKey: 'agent:main:main' });
  instrumentation.afterToolCall({ toolName: 'search', params: { q: 'hi' }, result: { ok: true } }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans.find((s) => s.spanType === SpanType.TOOL)).toBeDefined();
  const toolSpan = tracer.spans.find((s) => s.spanType === SpanType.TOOL);
  const agentSpan = tracer.spans.find((s) => s.spanType === SpanType.AGENT);
  expect(toolSpan.parentSpanId).toBe(agentSpan.spanId);
  expect(tracer.ended.length).toBeGreaterThanOrEqual(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/tool-spans.test.ts`
Expected: FAIL with missing export

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/instrumentation.ts (extend)
  const toolQueues = new Map<string, Span[]>();

  const beforeToolCall = (event: Record<string, unknown>, ctx: HookContext) => {
    const toolName = String(event.toolName ?? ctx.toolName ?? 'unknown');
    const key = `${toKey(ctx)}:${toolName}`;
    const inputs = config.captureInputs
      ? (sanitize(event, config.maxInputLength) as Record<string, unknown>)
      : {};
    const parent = agentSpans.get(toKey(ctx));
    const span = parent
      ? SpanContext.run(parent, () =>
          tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs })
        )
      : tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs });

    const queue = toolQueues.get(key) ?? [];
    queue.push(span);
    toolQueues.set(key, queue);
  };

  const afterToolCall = (event: Record<string, unknown>, ctx: HookContext) => {
    const toolName = String(event.toolName ?? ctx.toolName ?? 'unknown');
    const key = `${toKey(ctx)}:${toolName}`;
    const queue = toolQueues.get(key);
    const span = queue?.shift();
    const outputs = config.captureOutputs
      ? (sanitize(event, config.maxOutputLength) as Record<string, unknown>)
      : undefined;

    if (span) {
      tracer.endSpan(span, { outputs });
      return;
    }

    const fallback = tracer.startSpan({ name: toolName, spanType: SpanType.TOOL, inputs: {} });
    tracer.endSpan(fallback, { outputs });
  };

  return { ... , beforeToolCall, afterToolCall };
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/tool-spans.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/instrumentation.ts packages/openclaw/tests/tool-spans.test.ts
git commit -m "feat: add tool span instrumentation"
```

---

### Task 6: Message IO spans

**Files:**
- Modify: `packages/openclaw/src/instrumentation.ts`
- Create: `packages/openclaw/tests/message-spans.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from 'bun:test';
import { SpanContext, SpanStatus, SpanType } from '@prefactor/core';
import { createInstrumentation } from '../src/instrumentation.js';

class FakeTracer {
  spans: any[] = [];
  ended: any[] = [];
  startSpan(options: any) {
    const span = {
      spanId: `span-${this.spans.length + 1}`,
      parentSpanId: null,
      traceId: 'trace-1',
      name: options.name,
      spanType: options.spanType,
      startTime: Date.now(),
      endTime: null,
      status: SpanStatus.RUNNING,
      inputs: options.inputs,
      outputs: null,
      tokenUsage: null,
      error: null,
      metadata: options.metadata ?? {},
      tags: options.tags ?? [],
    };
    this.spans.push(span);
    return span;
  }
  endSpan(span: any, options?: any) {
    this.ended.push({ span, options });
  }
}

test('message_received creates CHAIN span', () => {
  const tracer = new FakeTracer();
  const instrumentation = createInstrumentation(tracer as any, {
    captureInputs: true,
    captureOutputs: true,
    maxInputLength: 100,
    maxOutputLength: 100,
  });

  instrumentation.messageReceived({ content: 'hi' }, { sessionKey: 'agent:main:main' });

  expect(tracer.spans[0].spanType).toBe(SpanType.CHAIN);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/message-spans.test.ts`
Expected: FAIL with missing export

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/instrumentation.ts (extend)
  const messageReceived = (event: Record<string, unknown>, ctx: HookContext) => {
    const inputs = config.captureInputs
      ? (sanitize({ direction: 'inbound', ...event }, config.maxInputLength) as Record<string, unknown>)
      : {};
    const span = tracer.startSpan({ name: 'openclaw:message', spanType: SpanType.CHAIN, inputs });
    tracer.endSpan(span, { outputs: config.captureOutputs ? inputs : undefined });
  };

  const messageSent = (event: Record<string, unknown>, ctx: HookContext) => {
    const inputs = config.captureInputs
      ? (sanitize({ direction: 'outbound', ...event }, config.maxInputLength) as Record<string, unknown>)
      : {};
    const span = tracer.startSpan({ name: 'openclaw:message', spanType: SpanType.CHAIN, inputs });
    tracer.endSpan(span, { outputs: config.captureOutputs ? inputs : undefined });
  };

  return { ... , messageReceived, messageSent };
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/message-spans.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/instrumentation.ts packages/openclaw/tests/message-spans.test.ts
git commit -m "feat: add message span instrumentation"
```

---

### Task 7: OpenClaw plugin registration wiring

**Files:**
- Modify: `packages/openclaw/src/index.ts`
- Modify: `packages/openclaw/src/types.ts`
- Create: `packages/openclaw/tests/register.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import register from '../src/index.js';

test('register wires expected hooks', () => {
  const calls: string[] = [];
  const api = {
    on: (name: string, handler: () => void) => {
      calls.push(name);
      return handler;
    },
    config: { plugins: { entries: { 'prefactor-observability': { config: {} } } } },
    logger: { info: () => {}, error: () => {}, debug: () => {} },
  } as any;

  register(api);

  expect(calls).toContain('before_agent_start');
  expect(calls).toContain('after_tool_call');
  expect(calls).toContain('message_received');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/openclaw/tests/register.test.ts`
Expected: FAIL with missing hooks

**Step 3: Write minimal implementation**

```ts
// packages/openclaw/src/types.ts
export type OpenClawPluginApi = {
  on: (name: string, handler: (event: any, ctx: any) => void) => void;
  config?: Record<string, unknown>;
  logger?: { info: (msg: string, meta?: unknown) => void; error: (msg: string, meta?: unknown) => void; debug: (msg: string, meta?: unknown) => void };
};

// packages/openclaw/src/index.ts
import { init, shutdown } from './init.js';
import { createInstrumentation } from './instrumentation.js';
import type { OpenClawPluginApi } from './types.js';

export function register(api: OpenClawPluginApi) {
  const runtime = init(api.config as any);
  if (!runtime) {
    api.logger?.error('OpenClaw Prefactor plugin disabled due to missing config');
    return;
  }
  const instrumentation = createInstrumentation(runtime.tracer, runtime.config);

  api.on('before_agent_start', (event, ctx) => instrumentation.beforeAgentStart(event, ctx));
  api.on('agent_end', (event, ctx) => instrumentation.agentEnd(event, ctx));
  api.on('before_tool_call', (event, ctx) => instrumentation.beforeToolCall(event, ctx));
  api.on('after_tool_call', (event, ctx) => instrumentation.afterToolCall(event, ctx));
  api.on('message_received', (event, ctx) => instrumentation.messageReceived(event, ctx));
  api.on('message_sent', (event, ctx) => instrumentation.messageSent(event, ctx));
  api.on('gateway_stop', async () => shutdown());
}

export default register;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/openclaw/tests/register.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/openclaw/src/index.ts packages/openclaw/src/types.ts packages/openclaw/tests/register.test.ts
git commit -m "feat: wire openclaw plugin hooks"
```

---

### Task 8: Documentation updates

**Files:**
- Modify: `packages/openclaw/README.md`
- Modify: `README.md`

**Step 1: Update package README with usage**

```md
# @prefactor/openclaw

OpenClaw plugin for Prefactor observability. Captures agent runs, tool calls, and message IO.

## Installation

```bash
npm install @prefactor/openclaw
```

## OpenClaw Configuration

```json5
{
  plugins: {
    entries: {
      "prefactor-observability": {
        enabled: true,
        config: {
          transportType: "http",
          httpConfig: {
            apiUrl: "https://api.prefactor.ai",
            apiToken: "$ENV:PREFACTOR_API_TOKEN",
            agentIdentifier: "openclaw-main"
          }
        }
      }
    }
  }
}
```

Note: Prefer environment variables for tokens.
```

**Step 2: Update root README package list**

- Add `@prefactor/openclaw` in the Monorepo Structure table.
- Add a short install snippet.

**Step 3: Run a targeted doc check**

Run: `bun run lint` (optional)
Expected: PASS

**Step 4: Commit**

```bash
git add packages/openclaw/README.md README.md
git commit -m "docs: add openclaw plugin usage"
```

---

### Task 9: Full verification

**Files:**
- None

**Step 1: Build and run tests**

Run: `bun run build && bun test`
Expected: PASS

**Step 2: Commit**

```bash
git add -A
git commit -m "test: verify openclaw plugin"
```
