# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript SDK for Prefactor that provides automatic observability for LangChain.js agents. The SDK captures distributed traces of LLM calls, tool executions, and agent workflows with minimal integration effort.

## Development Environment

This project uses **Bun** as the runtime, package manager, and test runner, with **devenv** (Nix-based) and **direnv** for reproducible development environments.

### Setup
```bash
# Environment activates automatically via direnv when entering directory
# If needed manually: direnv allow

# Install dependencies
just install
# or: bun install
```

## Key Commands

All commands use the `just` command runner (see `justfile`):

```bash
# Development
just install          # Install dependencies
just build            # Build ESM and CJS bundles
just test             # Run all tests
just test-watch       # Run tests in watch mode
just typecheck        # Type check without emitting
just lint             # Lint with Biome
just format           # Format code with Biome
just check            # Run typecheck + lint + test
just clean            # Remove dist and node_modules

# Run single test file
bun test tests/tracing/tracer.test.ts

# Run tests matching pattern
bun test --test-name-pattern "should create span"
```

## Architecture

The SDK is organized into five layered components:

### 1. Tracing Layer (`src/tracing/`)
- **span.ts**: Core data models (SpanType, SpanStatus, TokenUsage, ErrorInfo, Span interfaces)
- **tracer.ts**: Manages span lifecycle (creation, completion, emission). Emits AGENT spans immediately for real-time tracking
- **context.ts**: Async-safe context propagation using Node.js `AsyncLocalStorage`

**Critical Pattern**: Context propagation differs from Python SDK:
```typescript
// Node.js requires wrapping execution in runAsync()
await SpanContext.runAsync(span, async () => {
  // Inside this, getCurrent() returns the span
  return handler(request);
});
```

### 2. Transport Layer (`src/transport/`)
- **base.ts**: Transport interface (strategy pattern)
- **stdio.ts**: Newline-delimited JSON to stdout, promise-based write locking
- **http.ts**: HTTP API with queue-based async processing, exponential backoff retry, span ID mapping

**HTTP Transport Architecture**:
- Array-based queue with setTimeout polling (100ms)
- No worker threads needed (Node.js event loop handles async)
- Maintains SDK span_id → backend span_id mapping
- Agent instance lifecycle management

### 3. Instrumentation Layer (`src/instrumentation/langchain/`)
- **middleware.ts**: LangChain.js middleware (modern API only, no legacy callbacks)
- **metadata-extractor.ts**: Extracts token usage from various LLM provider formats

**Middleware Integration**: Wraps model/tool calls in context to enable automatic parent-child span relationships.

### 4. Configuration (`src/config.ts`)
- Zod-based validation with environment variable fallbacks
- Supports stdio (default) and http transports
- All settings configurable via code or env vars (see README for list)

### 5. Utilities (`src/utils/`)
- **logging.ts**: Configurable log levels, namespaced loggers
- **serialization.ts**: JSON serialization with string truncation for large payloads

## Code Patterns and Conventions

### Type Safety
- Use `unknown` instead of `any` where possible
- LangChain integration layer legitimately uses `any` types (with `// biome-ignore` comments) because LangChain request/response structures are dynamic and vary by provider
- All `any` usage in middleware is intentional for runtime flexibility

### Error Handling
- **Never throw errors from instrumentation code**
- Log errors with `console.error()` and continue gracefully
- User code must never be affected by SDK failures
- This is critical for zero-overhead observability

### Agent Span Lifecycle
Special handling for AGENT spans:
1. Emitted immediately on `startSpan()` with `endTime: null`
2. Completed later via `finishSpan()` API call
3. Enables real-time tracking in UI

### Testing
- Use Bun's built-in test runner (Jest-compatible API)
- Mock transports for unit tests (see `tests/tracing/tracer.test.ts`)
- Test structure mirrors source structure

## Build System

Build produces dual ESM/CJS outputs:
- `scripts/build.ts`: Uses TypeScript compiler + Bun bundler
- Outputs: `dist/index.js` (ESM) and `dist/index.cjs` (CJS)
- Externals: `@langchain/core`, `zod` (peer dependencies)

## Important Implementation Notes

### Context Propagation
Python's `contextvars` allows direct get/set. Node.js `AsyncLocalStorage` requires wrapping execution in `run()`. All handler calls in middleware must be wrapped in `SpanContext.runAsync()`.

### Span ID Mapping
HTTP transport maintains a `Map<string, string>` mapping SDK-generated span IDs to backend-assigned IDs. Required for parent-child relationships in backend API.

### Queue Processing
HTTP transport uses simple array-based queue with setTimeout polling. No worker threads or complex async patterns needed—Node.js event loop handles it naturally.

### Type Assertions
In `http.ts` switch statement, queue item data is cast to specific types (`as Span`, `as { spanId: string; timestamp: string }`). This is safe because queue items are only created internally with known types.

## Dependencies

Production: `@langchain/core` (^0.3.0), `zod` (^3.23.0)
Dev: `typescript` (^5.3.0), `@biomejs/biome` (2.3.11), `@types/node` (^20.0.0), `bun-types`

## Related Files

- `README.md`: User-facing documentation with examples
- `package.json`: Note the dual ESM/CJS exports configuration
- `tsconfig.json`: Configured for library development with strict mode
