import { describe, expect, test } from 'bun:test';
import { defineSpanType, registerSpanType, SpanType, spanTypeRegistry } from '../src/tracing/span';

describe('Branded span types', () => {
  test('should create built-in span types', () => {
    expect(SpanType.AGENT).toBeDefined();
    expect(SpanType.LLM).toBeDefined();
    expect(SpanType.TOOL).toBeDefined();
    expect(SpanType.CHAIN).toBeDefined();
    expect(SpanType.RETRIEVER).toBeDefined();
  });

  test('should create custom span types with defineSpanType', () => {
    const customType = defineSpanType('custom:operation');

    expect(customType).toBeDefined();
    expect(String(customType)).toBe('custom:operation');
  });

  test('should register custom span types with registerSpanType', () => {
    const registeredType = registerSpanType('registered:type');

    expect(spanTypeRegistry.isKnown(registeredType)).toBe(true);
  });

  test('should detect agent-type spans', () => {
    expect(spanTypeRegistry.isAgentSpanType(SpanType.AGENT)).toBe(true);

    const agentPrefix = defineSpanType('agent:task');
    expect(spanTypeRegistry.isAgentSpanType(agentPrefix)).toBe(true);

    const agentSuffix = defineSpanType('workflow:agent');
    expect(spanTypeRegistry.isAgentSpanType(agentSuffix)).toBe(true);

    const nonAgent = defineSpanType('custom:operation');
    expect(spanTypeRegistry.isAgentSpanType(nonAgent)).toBe(false);
  });
});
