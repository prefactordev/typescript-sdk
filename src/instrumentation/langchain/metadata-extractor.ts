import type { TokenUsage } from '../../tracing/span.js';

/**
 * Extract token usage information from LLM responses.
 *
 * Handles multiple response formats from different LLM providers and LangChain versions.
 *
 * @param response - The LLM response object
 * @returns TokenUsage object or null if no usage data found
 *
 * @example
 * ```typescript
 * const response = await model.invoke(messages);
 * const tokenUsage = extractTokenUsage(response);
 * if (tokenUsage) {
 *   console.log(`Tokens used: ${tokenUsage.totalTokens}`);
 * }
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: LLM response structure varies by provider
export function extractTokenUsage(response: any): TokenUsage | null {
  try {
    // Try token_usage field (common format)
    const tokenUsage = response?.token_usage ?? response?.usage;
    if (tokenUsage) {
      return {
        promptTokens: tokenUsage.prompt_tokens ?? 0,
        completionTokens: tokenUsage.completion_tokens ?? 0,
        totalTokens: tokenUsage.total_tokens ?? 0,
      };
    }

    // Try usage_metadata field (LangChain format)
    const usageMetadata = response?.usage_metadata;
    if (usageMetadata) {
      return {
        promptTokens: usageMetadata.input_tokens ?? 0,
        completionTokens: usageMetadata.output_tokens ?? 0,
        totalTokens: usageMetadata.total_tokens ?? 0,
      };
    }

    // Try response_metadata.token_usage (nested format)
    const responseMetadata = response?.response_metadata;
    if (responseMetadata?.token_usage) {
      return {
        promptTokens: responseMetadata.token_usage.prompt_tokens ?? 0,
        completionTokens: responseMetadata.token_usage.completion_tokens ?? 0,
        totalTokens: responseMetadata.token_usage.total_tokens ?? 0,
      };
    }

    return null;
  } catch {
    return null;
  }
}
