---
title: TypeScript SDK
description: Get started with the Prefactor TypeScript SDK.
---

The Prefactor TypeScript SDK provides a focused tracing layer for agent and LLM applications. It is designed to be small enough to drop into an existing codebase quickly while still giving you direct control when you need custom instrumentation behavior.

## Prefactor SDK overview

Prefactor ships with provider integrations for LangChain and the Vercel AI SDK, so most teams can start by installing one package and wiring middleware into existing model calls. For teams with custom orchestration layers, the `@prefactor/core` package exposes the same primitives used by the integrations, including runtime configuration, tracer lifecycle management, span context propagation, and manual span APIs.

The generated API docs are organized in the same order most projects adopt in practice: start with integration setup, understand core concepts, and then move into package-level APIs.

## Installation

Install the core package first:

```bash
npm install @prefactor/core
```

Then install the provider package that matches your stack:

```bash
npm install @prefactor/langchain
npm install @prefactor/ai
```

## Quick Start

Most applications begin with a provider integration. The example below shows the LangChain setup pattern, where you initialize Prefactor once and attach the middleware to your agent.

```typescript
import { init as initLangChain } from '@prefactor/langchain';

const middleware = initLangChain({
  transportType: 'http',
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});
```

If you need lower-level control, initialize `@prefactor/core` directly and use the tracer APIs for manual instrumentation.

```typescript
import { createCore } from '@prefactor/core';

const prefactor = createCore({
  transportType: 'http',
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
  },
});
```

## Usage Examples

### Tracing

Use `withSpan` to wrap application logic and record custom spans with consistent input and output fields.

```typescript
import { withSpan } from '@prefactor/core';

const result = await withSpan(
  { name: 'my-function', spanType: 'app:task' },
  async () => {
    // your logic here
    return 'result';
  }
);
```

### LangChain Integration

LangChain support captures model and tool execution with provider-prefixed span types and context propagation across async boundaries.

```typescript
import { init } from '@prefactor/langchain';

const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});

// Add middleware to your LangChain agent config
```

### AI SDK Integration

AI SDK support captures both non-streaming and streaming model calls, including tool activity when available.

```typescript
import { init } from '@prefactor/ai';

const middleware = init({
  transportType: 'http',
  httpConfig: {
    apiUrl: process.env.PREFACTOR_API_URL!,
    apiToken: process.env.PREFACTOR_API_TOKEN!,
    agentIdentifier: '1.0.0',
  },
});
```

## API Reference

The complete package APIs are documented in the generated references for core runtime primitives and each provider adapter.

Core runtime APIs are documented in [Core SDK](/sdks/typescript-sdk/api/core), LangChain integration APIs are documented in [LangChain Package](/sdks/typescript-sdk/api/packages/langchain), and Vercel AI SDK integration APIs are documented in [AI SDK Package](/sdks/typescript-sdk/api/packages/ai).
