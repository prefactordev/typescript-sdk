import { describe, expect, test } from 'bun:test';
import { spanTypeRegistry } from '@prefactor/core';
import { LangChainSpanTypes, registerLangChainSpanTypes } from '../src/span-types';

describe('LangChain span types', () => {
  test('should register default span types without validation', () => {
    registerLangChainSpanTypes();

    expect(String(LangChainSpanTypes.AGENT)).toBe('langchain:agent');
    expect(String(LangChainSpanTypes.LLM)).toBe('langchain:llm');
    expect(String(LangChainSpanTypes.TOOL)).toBe('langchain:tool');
  });

  test('should register span types with validation when enabled', () => {
    registerLangChainSpanTypes(true);

    expect(String(LangChainSpanTypes.AGENT)).toBe('langchain:agent');
    expect(String(LangChainSpanTypes.LLM)).toBe('langchain:llm');
    expect(String(LangChainSpanTypes.TOOL)).toBe('langchain:tool');

    // Check that schemas are registered
    const agentSchema = spanTypeRegistry.getSchema(LangChainSpanTypes.AGENT);
    expect(agentSchema).toBeDefined();
  });

  test('should detect langchain:agent as agent-type', () => {
    registerLangChainSpanTypes();

    expect(spanTypeRegistry.isAgentSpanType(LangChainSpanTypes.AGENT)).toBe(true);
    expect(spanTypeRegistry.isAgentSpanType(LangChainSpanTypes.LLM)).toBe(false);
    expect(spanTypeRegistry.isAgentSpanType(LangChainSpanTypes.TOOL)).toBe(false);
  });
});
