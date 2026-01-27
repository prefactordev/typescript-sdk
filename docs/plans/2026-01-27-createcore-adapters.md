# CreateCore + Adapter Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a core `createCore` helper and update adapters/middleware to use queue-driven core APIs with context-derived parent spans.

**Architecture:** Introduce `createCore` in `@prefactor/core` to create queue, transport, worker, tracer, and agent manager. Update LangChain + AI adapters to use this core factory, rely on `SpanContext` for parent/trace, and manage agent instances via `AgentInstanceManager`.

**Tech Stack:** TypeScript, Bun test runner, Prefactor core queue/transport worker.

---

### Task 1: Add failing LangChain middleware test (TDD RED)

**Files:**
- Create: `packages/langchain/tests/middleware.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryQueue, SpanContext, SpanStatus, SpanType, Tracer } from '@prefactor/core';
import type { QueueAction } from '@prefactor/core';
import { PrefactorMiddleware } from '../src/middleware.js';

class CaptureQueue extends InMemoryQueue<QueueAction> {
  items: QueueAction[] = [];

  override enqueue(item: QueueAction): void {
    this.items.push(item);
  }
}

describe('PrefactorMiddleware', () => {
  test('uses context parent for root span and nests child spans', async () => {
    const queue = new CaptureQueue();
    const tracer = new Tracer(queue);
    const middleware = new PrefactorMiddleware(tracer);

    const parentSpan = tracer.startSpan({
      name: 'external',
      spanType: SpanType.CHAIN,
      inputs: {},
    });

    await SpanContext.runAsync(parentSpan, async () => {
      await middleware.beforeAgent({ messages: ['hi'] });
      await middleware.wrapModelCall({ model: 'test' }, async () => ({ content: 'ok' }));
      await middleware.afterAgent({ messages: ['bye'] });
    });

    const agentSpan = queue.items.find(
      (item) => item.type === 'span_end' && item.data.spanType === SpanType.AGENT
    )?.data;
    const llmSpan = queue.items.find(
      (item) => item.type === 'span_end' && item.data.spanType === SpanType.LLM
    )?.data;

    expect(agentSpan?.parentSpanId).toBe(parentSpan.spanId);
    expect(agentSpan?.traceId).toBe(parentSpan.traceId);
    expect(llmSpan?.parentSpanId).toBe(agentSpan?.spanId);
    expect(llmSpan?.traceId).toBe(agentSpan?.traceId);
    expect(llmSpan?.status).toBe(SpanStatus.SUCCESS);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/langchain/tests/middleware.test.ts`

Expected: FAIL because the LLM span’s `parentSpanId` is not the agent span (root span is not entered into `SpanContext`).

---

### Task 2: Add createCore helper in core (GREEN)

**Files:**
- Create: `packages/core/src/create-core.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write minimal implementation**

```ts
import { extractPartition, type Partition } from '@prefactor/pfid';
import type { Config } from './config.js';
import { HttpTransportConfigSchema } from './config.js';
import { AgentInstanceManager } from './agent/instance-manager.js';
import { InMemoryQueue } from './queue/in-memory.js';
import { Tracer } from './tracing/tracer.js';
import { HttpTransport } from './transport/http.js';
import { StdioTransport } from './transport/stdio.js';
import { TransportWorker } from './transport/worker.js';
import type { Transport } from './transport/base.js';

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

  const queue = new InMemoryQueue();
  const worker = new TransportWorker(queue, transport, { batchSize: 25, intervalMs: 50 });
  const tracer = new Tracer(queue, partition);

  const schemaName = config.httpConfig?.schemaName ?? 'prefactor:agent';
  const schemaVersion = config.httpConfig?.schemaVersion ?? '1.0.0';
  const agentManager = new AgentInstanceManager(queue, { schemaName, schemaVersion });

  const shutdown = async (): Promise<void> => {
    await worker.close();
  };

  return { tracer, agentManager, worker, shutdown };
}
```

**Step 2: Re-export from core index**

```ts
export { createCore, type CoreRuntime } from './create-core.js';
```

**Step 3: Run tests (still failing until adapters are updated)**

Run: `bun test packages/langchain/tests/middleware.test.ts`

Expected: Still FAIL.

---

### Task 3: Update LangChain adapter and middleware (GREEN)

**Files:**
- Modify: `packages/langchain/src/init.ts`
- Modify: `packages/langchain/src/middleware.ts`
- Modify: `packages/langchain/src/index.ts`

**Step 1: Use createCore and agentManager**

- Replace transport/tracer setup with `createCore(createConfig(config))`.
- Keep globals for `coreRuntime` and `middleware`.
- Register schema via `agentManager.registerSchema(schema)` (use existing schema version defaults or a small basic schema object).
- Start/finish via `agentManager.startInstance(...)` and `agentManager.finishInstance()`.
- Update shutdown to call `coreRuntime.shutdown()`.

**Step 2: Remove parentSpanId/traceId arguments**

- Delete `parentSpanId` and `traceId` fields from all `tracer.startSpan` calls.

**Step 3: Place root agent span into SpanContext**

```ts
this.rootSpan = span;
SpanContext.enter(span);
```

And in `afterAgent`:

```ts
SpanContext.exit();
this.rootSpan = null;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/langchain/tests/middleware.test.ts`

Expected: PASS.

---

### Task 4: Update AI adapter and middleware (GREEN)

**Files:**
- Modify: `packages/ai/src/init.ts`
- Modify: `packages/ai/src/middleware.ts`
- Modify: `packages/ai/src/index.ts`

**Step 1: Use createCore in init**

- Replace transport/tracer setup with `createCore(createConfig(configWithHttp))`.
- Store global runtime, middleware, and tracer from runtime.
- Update shutdown to call runtime shutdown.

**Step 2: Remove parentSpanId/traceId arguments**

- Delete `parentSpanId` and `traceId` fields from `tracer.startSpan` and `createToolSpan` calls.

**Step 3: Ensure workflow agent span becomes context parent**

- When a workflow agent span is created, call `SpanContext.enter(workflow.agentSpan)` before creating the LLM span, and `SpanContext.exit()` after the LLM span is fully ended (including streaming wrapper completion).
- Ensure nested tool spans are created under the LLM span by using existing `SpanContext.runAsync(span, ...)` for the generation call.

**Step 4: Run the LangChain test again (smoke check)**

Run: `bun test packages/langchain/tests/middleware.test.ts`

Expected: PASS.

---

### Task 5: Commit

**Files:**
- Stage: updated core + adapters + test

**Step 1: Commit**

```bash
git add packages/core/src/create-core.ts packages/core/src/index.ts \
  packages/langchain/src/init.ts packages/langchain/src/middleware.ts packages/langchain/src/index.ts \
  packages/ai/src/init.ts packages/ai/src/middleware.ts packages/ai/src/index.ts \
  packages/langchain/tests/middleware.test.ts
git commit -m "feat: adapt middleware to queue-driven core"
```

---

### Notes

- TDD required: do not write production changes before the failing test is observed.
- If adapter schemas are required, use defaults in init (e.g., `langchain:agent` + `1.0.0`, `ai:agent` + `1.0.0`).
- Shutdown should call the core runtime shutdown to close worker + transport.
