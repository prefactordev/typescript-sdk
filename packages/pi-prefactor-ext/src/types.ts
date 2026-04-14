/**
 * Shared types for pi-prefactor-ext
 *
 * @module
 */

import type { z } from 'zod';
import type { configSchema } from './config.js';

/**
 * Configuration type from Zod schema (with isConfigured added).
 */
export type Config = z.infer<typeof configSchema> & { isConfigured: boolean };

/**
 * Log level for structured logging
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface
 */
export type { Logger } from './logger.js';

/**
 * Validation result for configuration
 */
export interface ValidationResult {
  ok: boolean;
  error?: string;
  missing?: string[];
}

/**
 * Configuration summary (safe to log, hides sensitive values)
 */
export interface ConfigSummary {
  apiUrl: string;
  agentId: string;
  logLevel: string;
  captureInputs: boolean;
  captureOutputs: boolean;
  maxOutputLength: number;
  apiToken?: string; // Masked
}

/**
 * Span context for async tracing
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Basic span data structure
 */
export interface SpanData {
  name: string;
  kind: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: 'ok' | 'error' | 'unset';
  errorMessage?: string;
}

/**
 * Event types for extension lifecycle
 */
export type ExtensionEvent =
  | 'session_start'
  | 'session_end'
  | 'llm_start'
  | 'llm_end'
  | 'tool_start'
  | 'tool_end'
  | 'error';

/**
 * Extension event payload
 */
export interface ExtensionEventPayload {
  type: ExtensionEvent;
  timestamp: number;
  data: Record<string, unknown>;
}
