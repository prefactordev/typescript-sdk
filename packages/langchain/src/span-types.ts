import { defineSpanType, registerSpanTypeWithSchema, type SpanType } from '@prefactor/core';
import { z } from 'zod';

/**
 * LangChain-specific span types
 *
 * These span types are prefixed with 'langchain:' to identify spans created
 * by the LangChain.js integration. Each type has optional schemas for validation.
 */

/**
 * Agent execution span type
 *
 * Represents the execution of a LangChain agent.
 */
export const LangChainAgentSpanType: SpanType = defineSpanType('langchain:agent');

/**
 * LLM call span type
 *
 * Represents a single LLM invocation made by a LangChain agent or chain.
 */
export const LangChainLLMSpanType: SpanType = defineSpanType('langchain:llm');

/**
 * Tool execution span type
 *
 * Represents the execution of a LangChain tool.
 */
export const LangChainToolSpanType: SpanType = defineSpanType('langchain:tool');

/**
 * All LangChain span types
 */
export const LangChainSpanTypes = {
  AGENT: LangChainAgentSpanType,
  LLM: LangChainLLMSpanType,
  TOOL: LangChainToolSpanType,
} as const;

/**
 * Register LangChain span types with optional schemas for validation
 *
 * Call this function at SDK initialization to register span types with schemas.
 * Schemas are optional - if provided, span inputs/outputs will be validated.
 *
 * @param enableValidation - Whether to enable schema validation (default: false)
 *
 * @example
 * ```typescript
 * import { registerLangChainSpanTypes } from '@prefactor/langchain';
 *
 * // Register without validation (recommended for production)
 * registerLangChainSpanTypes();
 *
 * // Register with validation (dev/testing)
 * registerLangChainSpanTypes(true);
 * ```
 */
export function registerLangChainSpanTypes(enableValidation = false): void {
  if (enableValidation) {
    // Register with schemas for validation
    registerSpanTypeWithSchema('langchain:agent', {
      input: z.object({
        messages: z.array(z.any()),
      }),
      output: z.object({
        messages: z.array(z.any()),
      }),
    });

    registerSpanTypeWithSchema('langchain:llm', {
      input: z.object({
        messages: z.array(z.any()).optional(),
      }),
      output: z
        .object({
          content: z.string(),
        })
        .optional(),
    });

    registerSpanTypeWithSchema('langchain:tool', {
      input: z.object({
        input: z.any(),
      }),
      output: z.any(),
    });
  } else {
    // Register without schemas (lightweight)
    defineSpanType('langchain:agent');
    defineSpanType('langchain:llm');
    defineSpanType('langchain:tool');
  }
}
