/**
 * @fileoverview Prefactor AI SDK - OpenTelemetry-compatible telemetry for Vercel AI SDK.
 *
 * This package provides an adapter that bridges the Vercel AI SDK's
 * `experimental_telemetry` feature with the Prefactor platform for
 * observability and tracing of AI operations.
 *
 * ## Quick Start
 *
 * ```ts
 * import { init, shutdown } from "@prefactor/ai";
 * import { generateText } from "ai";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * // Initialize with defaults (stdio transport for development)
 * const tracer = init();
 *
 * // Or with HTTP transport for production
 * const tracer = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *   },
 * });
 *
 * const result = await generateText({
 *   model: anthropic("claude-haiku-4-5"),
 *   prompt: "Hello!",
 *   experimental_telemetry: {
 *     isEnabled: true,
 *     tracer,
 *   },
 * });
 *
 * await shutdown();
 * ```
 *
 * @module @prefactor/ai
 * @packageDocumentation
 */

// ============================================================================
// Initialization Exports
// ============================================================================

export { init, getTracer, shutdown } from './init.js';

// ============================================================================
// Adapter Exports
// ============================================================================

export { AiSpanAdapter, AiTracerAdapter } from './adapter.js';

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // OTEL-compatible types
  AiSpan,
  AiTracer,
  AiSpanContext,
  AiSpanOptions,
  AiSpanStatus,
} from './types.js';

export { AiSpanStatusCode } from './types.js';

// Re-export relevant core types for convenience
export type {
  Config,
  HttpTransportConfig,
  Span,
  TokenUsage,
  ErrorInfo,
} from '@prefactor/core';

export { SpanType, SpanStatus } from '@prefactor/core';
