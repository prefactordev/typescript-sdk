# Python-Structure Transport Port Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port Python SDK transport strengths and structure into the TypeScript core package with a queue/executor pipeline, centralized HTTP client + retry policy, and endpoint clients.

**Architecture:** Replace monolithic HTTP transport internals with composable modules: queue layer (`Queue` + `TaskExecutor`), transport actions, a shared HTTP client with retry/jitter and status-based retry policy, and endpoint clients for agent instance/span APIs. Keep public `HttpTransport` behavior compatible where practical, while allowing deep internal restructuring.

**Tech Stack:** TypeScript (ESM), Bun test, fetch API, Zod config.

---

### Task 1: Add queue primitives and executor

**Files:**
- Create: `packages/core/src/queue/base.ts`
- Create: `packages/core/src/queue/in-memory-queue.ts`
- Create: `packages/core/src/queue/task-executor.ts`
- Test: `packages/core/tests/queue/task-executor.test.ts`

**Step 1: Write the failing test**

```ts
test('processes queued items in insertion order with one worker', async () => {
  const queue = new InMemoryQueue<string>();
  const seen: string[] = [];
  const executor = new TaskExecutor(queue, async (item) => {
    seen.push(item);
  }, { workerCount: 1 });

  executor.start();
  await queue.put('a');
  await queue.put('b');
  await executor.stop();

  expect(seen).toEqual(['a', 'b']);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/queue/task-executor.test.ts`
Expected: FAIL (queue/executor not implemented).

**Step 3: Write minimal implementation**

Implement `Queue<T>` interface, unbounded `InMemoryQueue<T>`, and `TaskExecutor<T>` with graceful stop and retry for handler failures.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/queue/task-executor.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/queue packages/core/tests/queue/task-executor.test.ts
git commit -m "feat(core): add queue and task executor primitives"
```

### Task 2: Add HTTP retry policy + centralized client

**Files:**
- Create: `packages/core/src/transport/http/retry-policy.ts`
- Create: `packages/core/src/transport/http/http-client.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/tests/transport/http-client.test.ts`

**Step 1: Write the failing test**

```ts
test('retries retryable HTTP status codes with backoff', async () => {
  // mock fetch: 500, 500, 200
  // expect 3 calls and successful response
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/transport/http-client.test.ts`
Expected: FAIL (client/retry policy missing).

**Step 3: Write minimal implementation**

Implement reusable request client with:
- Authorization + JSON headers
- status-code-based retry (`429`, `5xx` defaults)
- exponential backoff + jitter
- parsed JSON responses + transport-safe errors

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/transport/http-client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/transport/http packages/core/src/config.ts packages/core/tests/transport/http-client.test.ts
git commit -m "feat(core): add reusable HTTP client with retry policy"
```

### Task 3: Add endpoint clients and action types

**Files:**
- Create: `packages/core/src/queue/actions.ts`
- Create: `packages/core/src/transport/http/agent-instance-client.ts`
- Create: `packages/core/src/transport/http/agent-span-client.ts`
- Test: `packages/core/tests/transport/http-endpoints.test.ts`

**Step 1: Write the failing test**

```ts
test('agent span client posts create and finish to expected endpoints', async () => {
  // mock fetch and assert endpoint paths + payload shapes
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/transport/http-endpoints.test.ts`
Expected: FAIL (endpoint clients not implemented).

**Step 3: Write minimal implementation**

Implement endpoint wrappers around `HttpClient` request method for:
- register/start/finish agent instance
- create/finish span

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/transport/http-endpoints.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/queue/actions.ts packages/core/src/transport/http packages/core/tests/transport/http-endpoints.test.ts
git commit -m "feat(core): add typed HTTP endpoint clients"
```

### Task 4: Refactor `HttpTransport` to orchestrate queue + endpoint clients

**Files:**
- Modify: `packages/core/src/transport/http.ts`
- Modify: `packages/core/src/create-core.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/transport/http.test.ts`
- Test: `packages/core/tests/transport/http-transport-retry.test.ts`

**Step 1: Write the failing test**

```ts
test('retries agent lifecycle requests via shared client policy', async () => {
  // fail start endpoint once with 503 then succeed
  // expect call count > 1 and no throw
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/tests/transport/http-transport-retry.test.ts`
Expected: FAIL (current transport retries only span create).

**Step 3: Write minimal implementation**

Refactor transport internals:
- enqueue `TransportAction` items into `InMemoryQueue`
- process in `TaskExecutor` worker
- route network calls through endpoint clients
- preserve span-id mapping, pending finishes, schema-change guard

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/tests/transport/http.test.ts packages/core/tests/transport/http-transport-retry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/transport/http.ts packages/core/src/create-core.ts packages/core/src/index.ts packages/core/tests/transport/http*.test.ts
git commit -m "refactor(core): split transport pipeline into queue and HTTP clients"
```

### Task 5: Verification and cleanup

**Files:**
- Modify: `packages/core/src/index.ts` (exports for new modules if needed)
- Modify: `packages/core/src/config.ts` (ensure env + schema parity)

**Step 1: Run targeted package verification**

Run: `bun run scripts/build.ts --filter @prefactor/core`
Expected: PASS.

**Step 2: Run core tests**

Run: `bun test packages/core/tests/`
Expected: PASS.

**Step 3: Run workspace verification**

Run: `bun run build && bun test`
Expected: PASS.

**Step 4: Refactor pass**

Keep only minimal comments, use `.js` import extensions, and tighten types (`unknown` preferred over `any`).

**Step 5: Commit**

```bash
git add packages/core/src packages/core/tests docs/plans/2026-02-09-python-structure-port.md
git commit -m "feat(core): port python transport structure and reliability patterns"
```
