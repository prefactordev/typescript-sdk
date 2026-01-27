/**
 * @fileoverview Type definitions for AI SDK middleware integration.
 *
 * This module defines the configuration options and data structures
 * used by the Prefactor middleware for Vercel AI SDK.
 *
 * @module types
 * @packageDocumentation
 */

import type { TokenUsage } from '@prefactor/core';

/**
 * Configuration options for the Prefactor middleware.
 */
export interface MiddlewareConfig {
  /**
   * Whether to capture prompt and response content in span inputs/outputs.
   * Set to false to reduce data volume or for privacy reasons.
   * @default true
   */
  captureContent?: boolean;

  /**
   * Whether to capture tool call information.
   * @default true
   */
  captureTools?: boolean;

  /**
   * Whether to create AGENT spans for multi-step workflows.
   * When enabled, the middleware will automatically detect multi-step conversations
   * and create a root AGENT span to establish proper hierarchy.
   * @default true
   */
  enableWorkflowTracking?: boolean;
}

/**
 * Data extracted from a generate or stream call.
 * Used internally for building span data.
 */
export interface CallData {
  /** The model identifier (e.g., 'claude-3-haiku-20240307') */
  modelId: string;

  /** The provider name (e.g., 'anthropic', 'openai') */
  provider: string;

  /** Start timestamp in milliseconds */
  startTime: number;

  /** End timestamp in milliseconds */
  endTime: number;

  /** Duration in milliseconds */
  durationMs: number;

  /** Input data (prompt, settings, etc.) */
  inputs: Record<string, unknown>;

  /** Output data (response content, etc.) */
  outputs: Record<string, unknown>;

  /** Token usage statistics */
  tokenUsage?: TokenUsage;

  /** Reason the generation finished */
  finishReason?: string;

  /** Error if the call failed */
  error?: Error;
}

/**
 * LanguageModelV3Middleware type
 */
export type { LanguageModelMiddleware } from 'ai';

/**
 * Workflow state for tracking multi-step conversations.
 */
export interface WorkflowState {
  /** The root AGENT span for this workflow */
  agentSpan?: import('@prefactor/core').Span;

  /** Timestamp when workflow was created */
  createdAt: number;

  /** Timestamp of last activity in this workflow */
  lastActivityAt: number;

  /** Number of LLM calls in this workflow */
  callCount: number;

  /** Unique identifier for this workflow */
  workflowId: string;
}

/**
 * Tool call extracted from AI SDK response.
 */
export interface ToolCallInfo {
  /** Name of the tool */
  toolName: string;

  /** Tool call ID */
  toolCallId: string;

  /** Input parameters for the tool */
  input?: unknown;

  /** Output from the tool (if available) */
  output?: unknown;
}
