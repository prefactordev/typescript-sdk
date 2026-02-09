/**
 * @fileoverview Prefactor AI Middleware - Vercel AI SDK integration via middleware.
 *
 * This package provides middleware for the Vercel AI SDK that captures telemetry
 * data and sends it to the Prefactor platform for observability.
 *
 * ## Quick Start
 *
 * ```ts
 * import { init, shutdown } from "@prefactor/ai";
 * import { generateText, wrapLanguageModel } from "ai";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * // Initialize with HTTP transport
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *   },
 * });
 *
 * // Or with HTTP transport for production
 * const middleware = init({
 *   transportType: 'http',
 *   httpConfig: {
 *     apiUrl: 'https://api.prefactor.ai',
 *     apiToken: process.env.PREFACTOR_API_TOKEN!,
 *   },
 * });
 *
 * // Wrap your model with the middleware
 * const model = wrapLanguageModel({
 *   model: anthropic("claude-3-haiku-20240307"),
 *   middleware,
 * });
 *
 * const result = await generateText({
 *   model,
 *   prompt: "Hello!",
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

export { shutdown } from '@prefactor/core';
export { getTracer, init, withSpan } from './init.js';

// ============================================================================
// Middleware Exports
// ============================================================================

export { createPrefactorMiddleware } from './middleware.js';

// ============================================================================
// Type Exports
// ============================================================================

export type { CallData, MiddlewareConfig } from './types.js';

// ============================================================================
// Re-exported Core Types
// ============================================================================

export type {
  Config,
  CoreRuntime,
  ErrorInfo,
  HttpTransportConfig,
  Span,
  TokenUsage,
} from '@prefactor/core';

export { SpanStatus, SpanType } from '@prefactor/core';
