# SDK Refactor vNext Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the TypeScript SDK into a queue-driven core with stack-based span parenting and separate adapter packages (`packages/langchain`, `packages/ai`), allowing breaking changes.

**Architecture:** Core owns queue, transport worker, schema registration, agent instance lifecycle, and tracer; adapters translate framework events into core calls. All outbound actions are queued and drained by transport with retry/backoff.

**Tech Stack:** TypeScript, Bun, AsyncLocalStorage, fetch, Zod

---

### Task 1: Add queue action types + in-memory queue

**Files:**
- Create: `packages/core/src/queue/actions.ts`
- Create: `packages/core/src/queue/base.ts`
- Create: `packages/core/src/queue/in-memory.ts`
- Create: `packages/core/tests/queue/in-memory-queue.test.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

`packages/core/tests/queue/in-memory-queue.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';

describe('InMemoryQueue', () => {
  test('enqueue/dequeue preserves FIFO order', () => {
    const queue = new InMemoryQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);

    expect(queue.dequeueBatch(2)).toEqual([1, 2]);
    expect(queue.dequeueBatch(2)).toEqual([3]);
    expect(queue.dequeueBatch(1)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/queue/in-memory-queue.test.ts`
Expected: FAIL (module not found)

**Step 3: Write minimal implementation**

`packages/core/src/queue/base.ts`

```ts
export interface Queue<T> {
  enqueue(item: T): void;
  dequeueBatch(maxItems: number): T[];
  size(): number;
  flush(timeoutMs?: number): Promise<void>;
}
```

`packages/core/src/queue/in-memory.ts`

```ts
import type { Queue } from './base.js';

export class InMemoryQueue<T> implements Queue<T> {
  private items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeueBatch(maxItems: number): T[] {
    if (this.items.length === 0) return [];
    return this.items.splice(0, maxItems);
  }

  size(): number {
    return this.items.length;
  }

  async flush(): Promise<void> {
    return;
  }
}
```

`packages/core/src/queue/actions.ts`

```ts
import type { Span } from '../tracing/span.js';

export type SchemaRegistration = {
  schemaName: string;
  schemaVersion: string;
  schema: Record<string, unknown>;
};

export type AgentInstanceStart = {
  agentId?: string;
  agentVersion?: string;
  agentName?: string;
  agentDescription?: string;
  schemaName: string;
  schemaVersion: string;
};

export type AgentInstanceFinish = {};

export type QueueAction =
  | { type: 'schema_register'; data: SchemaRegistration }
  | { type: 'agent_start'; data: AgentInstanceStart }
  | { type: 'agent_finish'; data: AgentInstanceFinish }
  | { type: 'span_end'; data: Span }
  | { type: 'span_finish'; data: { spanId: string; endTime: number } };
```

`packages/core/src/index.ts` exports.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/queue/in-memory-queue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/queue packages/core/tests/queue packages/core/src/index.ts
git commit -m "feat: add queue interface and in-memory queue"
```

---

### Task 2: Add transport worker + update transport interface

**Files:**
- Create: `packages/core/src/transport/worker.ts`
- Modify: `packages/core/src/transport/base.ts`
- Modify: `packages/core/src/transport/stdio.ts`
- Create: `packages/core/tests/transport/worker.test.ts`

**Step 1: Write the failing test**

`packages/core/tests/transport/worker.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';
import type { QueueAction } from '../../src/queue/actions';
import { TransportWorker } from '../../src/transport/worker';

class MockTransport {
  public batches: QueueAction[][] = [];
  async processBatch(items: QueueAction[]): Promise<void> {
    this.batches.push(items);
  }
  async close(): Promise<void> {}
}

describe('TransportWorker', () => {
  test('drains queued actions in batches', async () => {
    const queue = new InMemoryQueue<QueueAction>();
    const transport = new MockTransport();
    const worker = new TransportWorker(queue, transport, { batchSize: 2, intervalMs: 1 });

    queue.enqueue({ type: 'agent_finish', data: {} });
    queue.enqueue({ type: 'agent_finish', data: {} });
    queue.enqueue({ type: 'agent_finish', data: {} });

    await worker.flush(100);

    expect(transport.batches.length).toBeGreaterThan(0);
    expect(transport.batches[0].length).toBeLessThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/transport/worker.test.ts`
Expected: FAIL (TransportWorker missing)

**Step 3: Write minimal implementation**

`packages/core/src/transport/base.ts`

```ts
import type { QueueAction } from '../queue/actions.js';

export interface Transport {
  processBatch(items: QueueAction[]): Promise<void>;
  close(): void | Promise<void>;
}
```

`packages/core/src/transport/worker.ts`

```ts
import type { Queue } from '../queue/base.js';
import type { QueueAction } from '../queue/actions.js';
import type { Transport } from './base.js';

type WorkerConfig = { batchSize: number; intervalMs: number };

export class TransportWorker {
  private closed = false;

  constructor(
    private queue: Queue<QueueAction>,
    private transport: Transport,
    private config: WorkerConfig
  ) {
    this.start();
  }

  private async start(): Promise<void> {
    while (!this.closed) {
      const batch = this.queue.dequeueBatch(this.config.batchSize);
      if (batch.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
        continue;
      }
      await this.transport.processBatch(batch);
    }
  }

  async flush(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (this.queue.size() > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.intervalMs));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.transport.close();
  }
}
```

Update `packages/core/src/transport/stdio.ts` to implement `processBatch(items)` by emitting newline-delimited JSON for each item.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/transport/worker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/transport packages/core/tests/transport
git commit -m "feat: add transport worker and batch interface"
```

---

### Task 3: Add schema registry + agent instance manager

**Files:**
- Create: `packages/core/src/agent/schema-registry.ts`
- Create: `packages/core/src/agent/instance-manager.ts`
- Create: `packages/core/tests/agent/instance-manager.test.ts`
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/index.ts`

**Step 1: Write the failing test**

`packages/core/tests/agent/instance-manager.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import { InMemoryQueue } from '../../src/queue/in-memory';
import { AgentInstanceManager } from '../../src/agent/instance-manager';

describe('AgentInstanceManager', () => {
  test('enqueues schema registration before agent start', () => {
    const queue = new InMemoryQueue();
    const manager = new AgentInstanceManager(queue, {
      schemaName: 'langchain:agent',
      schemaVersion: '1.0.0',
    });

    manager.registerSchema({ type: 'object' });
    manager.startInstance({ agentId: 'agent-1' });

    const items = queue.dequeueBatch(10);
    expect(items[0].type).toBe('schema_register');
    expect(items[1].type).toBe('agent_start');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/agent/instance-manager.test.ts`
Expected: FAIL (AgentInstanceManager missing)

**Step 3: Write minimal implementation**

`packages/core/src/agent/schema-registry.ts`

```ts
export class SchemaRegistry {
  private schemas = new Map<string, Record<string, unknown>>();

  register(name: string, version: string, schema: Record<string, unknown>): void {
    this.schemas.set(`${name}@${version}`, schema);
  }

  get(name: string, version: string): Record<string, unknown> | undefined {
    return this.schemas.get(`${name}@${version}`);
  }
}
```

`packages/core/src/agent/instance-manager.ts`

```ts
import type { Queue } from '../queue/base.js';
import type { QueueAction } from '../queue/actions.js';

type ManagerConfig = {
  schemaName: string;
  schemaVersion: string;
};

export class AgentInstanceManager {
  constructor(
    private queue: Queue<QueueAction>,
    private config: ManagerConfig
  ) {}

  registerSchema(schema: Record<string, unknown>): void {
    this.queue.enqueue({
      type: 'schema_register',
      data: {
        schemaName: this.config.schemaName,
        schemaVersion: this.config.schemaVersion,
        schema,
      },
    });
  }

  startInstance(options: {
    agentId?: string;
    agentVersion?: string;
    agentName?: string;
    agentDescription?: string;
  }): void {
    this.queue.enqueue({
      type: 'agent_start',
      data: {
        ...options,
        schemaName: this.config.schemaName,
        schemaVersion: this.config.schemaVersion,
      },
    });
  }

  finishInstance(): void {
    this.queue.enqueue({ type: 'agent_finish', data: {} });
  }
}
```

Update `packages/core/src/config.ts` to include required schema name/version for HTTP transport (e.g., `schemaName`, `schemaVersion`), and export them from `Config` so adapters can pass their namespace.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/agent/instance-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/agent packages/core/tests/agent packages/core/src/config.ts packages/core/src/index.ts
git commit -m "feat: add schema registry and agent instance manager"
```

---

### Task 4: Refactor SpanContext to be stack-based

**Files:**
- Modify: `packages/core/src/tracing/context.ts`
- Create: `packages/core/tests/tracing/context.test.ts`

**Step 1: Write the failing test**

`packages/core/tests/tracing/context.test.ts`

```ts
import { describe, expect, test } from 'bun:test';
import { SpanContext } from '../../src/tracing/context';

describe('SpanContext', () => {
  test('push/pop manages stack', () => {
    SpanContext.clear();
    expect(SpanContext.getCurrent()).toBeUndefined();

    SpanContext.enter({ spanId: '1' } as any);
    SpanContext.enter({ spanId: '2' } as any);

    expect(SpanContext.getCurrent()?.spanId).toBe('2');
    SpanContext.exit();
    expect(SpanContext.getCurrent()?.spanId).toBe('1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/tracing/context.test.ts`
Expected: FAIL (enter/exit missing)

**Step 3: Write minimal implementation**

`packages/core/src/tracing/context.ts`

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Span } from './span.js';

const spanStorage = new AsyncLocalStorage<Span[]>();

// biome-ignore lint/complexity/noStaticOnlyClass
export class SpanContext {
  static getCurrent(): Span | undefined {
    const stack = spanStorage.getStore() ?? [];
    return stack[stack.length - 1];
  }

  static getStack(): Span[] {
    return spanStorage.getStore() ?? [];
  }

  static enter(span: Span): void {
    const stack = [...(spanStorage.getStore() ?? []), span];
    spanStorage.enterWith(stack);
  }

  static exit(): void {
    const stack = [...(spanStorage.getStore() ?? [])];
    stack.pop();
    spanStorage.enterWith(stack);
  }

  static async runAsync<T>(span: Span, fn: () => Promise<T>): Promise<T> {
    const stack = [...(spanStorage.getStore() ?? []), span];
    return spanStorage.run(stack, fn);
  }

  static clear(): void {
    spanStorage.disable();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/tracing/context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/tracing/context.ts packages/core/tests/tracing/context.test.ts
git commit -m "feat: make span context stack-based"
```

---

### Task 5: Refactor Tracer to use context + queue actions

**Files:**
- Modify: `packages/core/src/tracing/tracer.ts`
- Modify: `packages/core/tests/tracing/tracer.test.ts`

**Step 1: Write the failing test**

Update `packages/core/tests/tracing/tracer.test.ts` to assert parent is derived from context, not passed explicitly:

```ts
test('derives parent span from SpanContext', async () => {
  const parent = tracer.startSpan({ name: 'parent', spanType: SpanType.AGENT, inputs: {} });

  await SpanContext.runAsync(parent, async () => {
    const child = tracer.startSpan({ name: 'child', spanType: SpanType.LLM, inputs: {} });
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.traceId).toBe(parent.traceId);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/tracing/tracer.test.ts`
Expected: FAIL (parentSpanId still required)

**Step 3: Write minimal implementation**

`packages/core/src/tracing/tracer.ts`

- Remove `parentSpanId` and `traceId` from `StartSpanOptions`.
- In `startSpan`, use `SpanContext.getCurrent()` for parent and trace IDs.
- Replace direct transport calls with queue actions:

```ts
this.queue.enqueue({ type: 'span_end', data: span });
```

- For agent spans, enqueue `span_finish` on end.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/tracing/tracer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/tracing/tracer.ts packages/core/tests/tracing/tracer.test.ts
git commit -m "feat: derive span parents from context and queue spans"
```

---

### Task 6: Update HTTP transport to process queued actions

**Files:**
- Modify: `packages/core/src/transport/http.ts`

**Step 1: Write the failing test**

Add a focused test in `packages/core/tests/transport/http.test.ts` for `processBatch` ordering (schema -> agent start -> span).

```ts
// minimal: assert HttpTransport.processBatch handles action types without throwing
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/transport/http.test.ts`
Expected: FAIL (processBatch not implemented)

**Step 3: Write minimal implementation**

`packages/core/src/transport/http.ts`

- Remove internal queue and processing loop.
- Implement `processBatch(items)` switch on `QueueAction` type.
- Extract registration to `registerSchemaHttp`, `startAgentInstanceHttp`, `finishAgentInstanceHttp`.
- Keep `spanIdMap` logic; map parent span IDs when sending spans.
- Keep retry/backoff logic in `sendSpan`.

**Note:** Confirm schema registration endpoint with backend. If unknown, add a single `const SCHEMA_ENDPOINT = '<TBD>'` and update once confirmed.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/transport/http.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/transport/http.ts packages/core/tests/transport/http.test.ts
git commit -m "feat: move http transport to queued batch processing"
```

---

### Task 7: Update adapter init + middleware to use new core APIs

**Files:**
- Modify: `packages/langchain/src/init.ts`
- Modify: `packages/langchain/src/middleware.ts`
- Modify: `packages/ai/src/init.ts`
- Modify: `packages/ai/src/middleware.ts`
- Modify: `packages/langchain/src/index.ts`
- Modify: `packages/ai/src/index.ts`

**Step 1: Write the failing test**

Add a small integration test in `packages/langchain/tests/middleware.test.ts` to ensure no `parentSpanId` is passed and context derives parent.

**Step 2: Run test to verify it fails**

Run: `bun test packages/langchain/tests/middleware.test.ts`
Expected: FAIL (context not used / APIs mismatched)

**Step 3: Write minimal implementation**

- Create a `createCore` helper in `packages/core` that returns `{ tracer, agentManager, worker, shutdown }` and hides queue/transport setup.
- Update adapters to call `agentManager.registerSchema(...)` + `agentManager.startInstance(...)` before agent execution.
- Update `PrefactorMiddleware` to remove `parentSpanId` and `traceId` inputs.
- Replace `SpanContext.runAsync` usage only where needed; use `SpanContext.enter`/`exit` in before/after agent hooks.

**Step 4: Run test to verify it passes**

Run: `bun test packages/langchain/tests/middleware.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/langchain packages/ai packages/core/src
git commit -m "feat: adapt middleware to queue-driven core"
```

---

### Task 8: Remove umbrella SDK package and update docs/examples

**Files:**
- Delete: `packages/sdk`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `examples/*` (imports)

**Step 1: Write the failing test**

Update `README.md` examples to import `@prefactor/core` + `@prefactor/langchain` or `@prefactor/ai`.

**Step 2: Run lint/typecheck (expected failures)**

Run: `bun run typecheck`
Expected: FAIL until imports updated

**Step 3: Write minimal implementation**

- Remove `packages/sdk` and workspace dependency `@prefactor/sdk`.
- Update examples and README import paths.

**Step 4: Run verification**

Run: `bun test`
Run: `bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add packages package.json README.md examples
git commit -m "feat: remove umbrella sdk package and update docs"
```

---

## Final Verification

Run:

```bash
bun test
bun run typecheck
bun run lint
```

Expected: All pass.
