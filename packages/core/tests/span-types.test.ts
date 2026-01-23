import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  defineSpanType,
  registerSpanType,
  registerSpanTypeWithSchema,
  spanTypeRegistry,
} from '../src/tracing/span';

describe('Branded span types', () => {
  test('should create branded type using defineSpanType', () => {
    const customType = defineSpanType('custom:type');
    expect(customType).toBe('custom:type');
  });

  test('should allow creating multiple branded types', () => {
    const type1 = defineSpanType('type:one');
    const type2 = defineSpanType('type:two');
    expect(type1).not.toBe(type2);
  });

  test('should register span type without schema', () => {
    const customType = registerSpanType('registered:type');
    expect(customType).toBe('registered:type');
  });

  test('should register span type with schema', () => {
    const schema = z.object({ test: z.string() });
    const typedSchema = { input: schema } as const;

    const customType = registerSpanTypeWithSchema('type:with-schema', typedSchema);
    expect(customType).toBe('type:with-schema');
  });
});

describe('SpanTypeRegistry schema support', () => {
  test('should retrieve schema for registered span type', () => {
    const inputSchema = z.object({ field: z.string() });
    const outputSchema = z.object({ result: z.number() });

    const MY_TYPE = registerSpanTypeWithSchema('type:schema', {
      input: inputSchema,
      output: outputSchema,
    });

    const schema = spanTypeRegistry.getSchema(MY_TYPE);
    expect(schema).toBeDefined();
    expect(schema?.input).toBe(inputSchema);
    expect(schema?.output).toBe(outputSchema);
  });

  test('should return undefined for span type without schema', () => {
    const NO_SCHEMA = registerSpanType('type:no-schema');

    const schema = spanTypeRegistry.getSchema(NO_SCHEMA);
    expect(schema).toBeUndefined();
  });

  test('should validate data against input schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const MY_TYPE = registerSpanTypeWithSchema('type:input-validation', { input: schema });

    // Valid data
    const validResult = spanTypeRegistry.validate(MY_TYPE, { name: 'John', age: 30 }, 'input');
    expect(validResult.success).toBe(true);

    // Invalid data
    const invalidResult = spanTypeRegistry.validate(MY_TYPE, { name: 'John' }, 'input');
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toBeDefined();
  });

  test('should validate data against output schema', () => {
    const schema = z.object({
      status: z.enum(['success', 'error']),
      code: z.number(),
    });

    const MY_TYPE = registerSpanTypeWithSchema('type:output-validation', { output: schema });

    // Valid data
    const validResult = spanTypeRegistry.validate(
      MY_TYPE,
      { status: 'success', code: 200 },
      'output'
    );
    expect(validResult.success).toBe(true);

    // Invalid data
    const invalidResult = spanTypeRegistry.validate(
      MY_TYPE,
      { status: 'invalid', code: 200 },
      'output'
    );
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toBeDefined();
  });

  test('should return success for span type without schema', () => {
    const NO_SCHEMA = registerSpanType('type:validate-no-schema');

    const result = spanTypeRegistry.validate(NO_SCHEMA, { any: 'data' }, 'input');
    expect(result.success).toBe(true);
  });

  test('should return success for phase without schema', () => {
    const inputSchema = z.object({ field: z.string() });
    const MY_TYPE = registerSpanTypeWithSchema('type:partial-schema', { input: inputSchema });

    // Output doesn't have schema - should succeed
    const result = spanTypeRegistry.validate(MY_TYPE, { any: 'data' }, 'output');
    expect(result.success).toBe(true);
  });
});
