import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';
import * as generatorModule from '../scripts/protocol-generator.mjs';

type OpenApiDocument = Record<string, unknown> & {
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

type RuntimeModule = Record<string, unknown> & {
  ProtocolValidationError: new (...args: never[]) => Error;
};

const generator = generatorModule as {
  generateProtocol: (document: OpenApiDocument) => string;
};

let importNonce = 0;

async function sourceDocument(): Promise<OpenApiDocument> {
  return structuredClone((await loadOpenApiDocument()) as OpenApiDocument);
}

async function importGenerated(source: string): Promise<RuntimeModule> {
  const javascript = transpileModule(source, {
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022,
    },
  }).outputText;
  const encoded = Buffer.from(javascript, 'utf8').toString('base64');
  importNonce += 1;
  return import(`data:text/javascript;base64,${encoded}#${importNonce}`) as Promise<RuntimeModule>;
}

function reverseRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse());
}

function is(runtime: RuntimeModule, name: string, value: unknown): boolean {
  return (runtime[`is${name}`] as (candidate: unknown) => boolean)(value);
}

function parse(runtime: RuntimeModule, name: string, value: unknown): unknown {
  return (runtime[`parse${name}`] as (candidate: unknown) => unknown)(value);
}

function jsonObject(source: string): Record<string, unknown> {
  return JSON.parse(source) as Record<string, unknown>;
}

async function syntheticRuntime(): Promise<RuntimeModule> {
  const document = await sourceDocument();
  Object.assign(document.components.schemas, {
    ArrayConstProbe: {
      const: ['safe', { alpha: 1 }],
    },
    ConstProbe: {
      const: { alpha: 1, nested: ['safe', 2] },
    },
    DangerousConstProbe: {
      const: jsonObject('{"nested":{"__proto__":{"constructor":{"prototype":"constant"}}}}'),
    },
    DangerousEnumProbe: {
      enum: [jsonObject('{"nested":{"constructor":{"prototype":{"__proto__":"enum"}}}}')],
    },
    DangerousObjectProbe: {
      type: 'object',
      additionalProperties: false,
      required: ['__proto__', 'constructor', 'prototype'],
      properties: jsonObject(
        '{"__proto__":{"const":"proto"},"constructor":{"const":"ctor"},"prototype":{"const":"prototype"}}',
      ),
    },
    EnumProbe: {
      enum: [{ alpha: 1, beta: 2 }, ['safe', 2]],
    },
    IntegerProbe: {
      type: 'integer',
      minimum: 0,
      maximum: 10,
    },
    ExclusiveNumberProbe: {
      type: 'number',
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
    },
    OneOfProbe: {
      oneOf: [
        { type: 'integer', minimum: 0 },
        { type: 'integer', maximum: 10 },
      ],
    },
    RefSiblingProbe: {
      $ref: '#/components/schemas/VoiceId',
      enum: ['pocket:alba'],
    },
    SafeObjectProbe: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 32 },
      },
    },
    UniqueProbe: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['alpha', 'beta'],
        properties: {
          alpha: { type: 'integer' },
          beta: { type: 'integer' },
        },
      },
    },
    Utf8Probe: {
      type: 'string',
      minLength: 2,
      maxLength: 2,
      'x-maxUtf8Bytes': 4,
    },
  });
  return importGenerated(generator.generateProtocol(document));
}

describe('deterministic generated protocol runtime', () => {
  it('generates byte-identical output independent of object insertion order', async () => {
    const document = await sourceDocument();
    document.components.schemas.OrderProbe = {
      const: jsonObject('{"z":1,"a":{"z":2,"a":3}}'),
    };
    const expected = generator.generateProtocol(document);
    const reordered = structuredClone(document);
    reordered.paths = reverseRecord(reordered.paths);
    reordered.components.schemas = reverseRecord(reordered.components.schemas);
    for (const schema of Object.values(reordered.components.schemas)) {
      if (schema.properties !== null && typeof schema.properties === 'object') {
        schema.properties = reverseRecord(schema.properties as Record<string, unknown>);
      }
    }
    reordered.components.schemas.OrderProbe!.const = jsonObject('{"a":{"a":3,"z":2},"z":1}');

    expect(generator.generateProtocol(document)).toBe(expected);
    expect(generator.generateProtocol(reordered)).toBe(expected);
    expect(expected).not.toMatch(/generated at|[A-Z]:\\|localeCompare/iu);
  });

  it('imports without filesystem, network, Ajv, or Hyperjump runtime work', async () => {
    const document = await sourceDocument();
    const source = generator.generateProtocol(document);
    expect(source).not.toMatch(/(?:from\s+['"]|node:|readFile|fetch\s*\(|Ajv|Hyperjump)/u);

    const fetchSpy = vi.fn(() => {
      throw new Error('generated imports must not touch the network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await importGenerated(source);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('counts Unicode scalar values separately from UTF-8 bytes and rejects lone surrogates', async () => {
    const runtime = await syntheticRuntime();
    expect(is(runtime, 'Utf8Probe', 'éé')).toBe(true);
    expect(is(runtime, 'Utf8Probe', 'e\u0301')).toBe(true);
    expect(is(runtime, 'Utf8Probe', '😀')).toBe(false);
    expect(is(runtime, 'Utf8Probe', '😀a')).toBe(false);
    expect(is(runtime, 'Utf8Probe', '\ud800a')).toBe(false);
  });

  it('requires exactly one oneOf branch and honors $ref siblings', async () => {
    const runtime = await syntheticRuntime();
    expect(is(runtime, 'OneOfProbe', -1)).toBe(true);
    expect(is(runtime, 'OneOfProbe', 11)).toBe(true);
    expect(is(runtime, 'OneOfProbe', 5)).toBe(false);
    expect(is(runtime, 'RefSiblingProbe', 'pocket:alba')).toBe(true);
    expect(is(runtime, 'RefSiblingProbe', 'pocket:anna')).toBe(false);
  });

  it('uses deep JSON equality for const, enum, and uniqueItems independent of key order', async () => {
    const runtime = await syntheticRuntime();
    expect(is(runtime, 'ArrayConstProbe', ['safe', { alpha: 1 }])).toBe(true);
    expect(is(runtime, 'ArrayConstProbe', [{ alpha: 1 }, 'safe'])).toBe(false);
    expect(is(runtime, 'ConstProbe', { nested: ['safe', 2], alpha: 1 })).toBe(true);
    expect(is(runtime, 'ConstProbe', { nested: [2, 'safe'], alpha: 1 })).toBe(false);
    expect(is(runtime, 'EnumProbe', { beta: 2, alpha: 1 })).toBe(true);
    expect(is(runtime, 'EnumProbe', ['safe', 2])).toBe(true);
    expect(is(runtime, 'EnumProbe', { alpha: 1, beta: 3 })).toBe(false);
    expect(
      is(runtime, 'UniqueProbe', [
        { alpha: 1, beta: 2 },
        { beta: 2, alpha: 1 },
      ]),
    ).toBe(false);
  });

  it('preserves dangerous own keys in schemas and deep const/enum JSON without prototype semantics', async () => {
    const runtime = await syntheticRuntime();
    const objectValue = jsonObject(
      '{"__proto__":"proto","constructor":"ctor","prototype":"prototype"}',
    );
    const constValue = jsonObject(
      '{"nested":{"__proto__":{"constructor":{"prototype":"constant"}}}}',
    );
    const enumValue = jsonObject('{"nested":{"constructor":{"prototype":{"__proto__":"enum"}}}}');

    expect(Object.prototype.hasOwnProperty.call(objectValue, '__proto__')).toBe(true);
    expect(is(runtime, 'DangerousObjectProbe', objectValue)).toBe(true);
    expect(is(runtime, 'DangerousConstProbe', constValue)).toBe(true);
    expect(is(runtime, 'DangerousEnumProbe', enumValue)).toBe(true);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('enforces finite integers and inclusive numeric bounds', async () => {
    const runtime = await syntheticRuntime();
    expect(parse(runtime, 'IntegerProbe', 0)).toBe(0);
    expect(parse(runtime, 'IntegerProbe', 10)).toBe(10);
    for (const invalid of [-1, 11, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(is(runtime, 'IntegerProbe', invalid)).toBe(false);
    }
    expect(is(runtime, 'ExclusiveNumberProbe', 0.5)).toBe(true);
    expect(is(runtime, 'ExclusiveNumberProbe', 0)).toBe(false);
    expect(is(runtime, 'ExclusiveNumberProbe', 1)).toBe(false);
  });

  it('fails safely on accessors, symbols, cycles, and excessive unknown nesting', async () => {
    const runtime = await syntheticRuntime();
    let getterCalls = 0;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'text', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'unsafe';
      },
    });
    expect(is(runtime, 'SafeObjectProbe', accessor)).toBe(false);
    expect(getterCalls).toBe(0);

    const symbolValue = { text: 'safe', [Symbol('private')]: true };
    expect(is(runtime, 'SafeObjectProbe', symbolValue)).toBe(false);

    const cyclic: Record<string, unknown> = { text: 'safe' };
    cyclic.extra = cyclic;
    expect(is(runtime, 'SafeObjectProbe', cyclic)).toBe(false);

    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 100; index += 1) nested = { child: nested };
    expect(is(runtime, 'SafeObjectProbe', { text: 'safe', extra: nested })).toBe(false);
  });

  it('throws safe parser errors that never include rejected values', async () => {
    const runtime = await syntheticRuntime();
    const marker = 'plaintext-secret-must-not-escape';
    let caught: unknown;
    try {
      parse(runtime, 'SafeObjectProbe', { text: marker, extra: marker });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(runtime.ProtocolValidationError);
    expect(String(caught)).toContain('SafeObjectProbe');
    expect(String(caught)).not.toContain(marker);
  });

  it.each([
    ['unsupported keyword', (schema: Record<string, unknown>) => (schema.minProperties = 1)],
    ['unsupported format', (schema: Record<string, unknown>) => (schema.format = 'hostname')],
    ['invalid pattern', (schema: Record<string, unknown>) => (schema.pattern = '[')],
  ])('rejects %s at generation instead of silently weakening it', async (_name, mutate) => {
    const document = await sourceDocument();
    const schema = document.components.schemas.OpaqueSecret;
    expect(schema).toBeDefined();
    mutate(schema!);
    expect(() => generator.generateProtocol(document)).toThrow(/schema/iu);
  });

  it('rejects invalid or colliding schema identifiers and duplicate operation IDs', async () => {
    const invalidName = await sourceDocument();
    invalidName.components.schemas['Bad-Name'] = { type: 'string' };
    expect(() => generator.generateProtocol(invalidName)).toThrow(/identifier/iu);

    for (const name of [
      'Array',
      'Error',
      'JSON',
      'Number',
      'Object',
      'ProtocolValidationError',
      'Readonly',
      'Record',
      'Reflect',
      'RegExp',
      'SCHEMAS',
      'Set',
    ]) {
      const collision = await sourceDocument();
      collision.components.schemas[name] = { type: 'string' };
      expect(() => generator.generateProtocol(collision), name).toThrow(/reserved/iu);
    }

    const duplicateOperation = await sourceDocument();
    const operations = Object.values(duplicateOperation.paths).flatMap((path) =>
      Object.values(path).filter(
        (value): value is Record<string, unknown> =>
          value !== null && typeof value === 'object' && 'operationId' in value,
      ),
    );
    expect(operations.length).toBeGreaterThan(1);
    operations[1]!.operationId = operations[0]!.operationId;
    expect(() => generator.generateProtocol(duplicateOperation)).toThrow(/operationId/iu);
  });

  it('rejects unresolvable/non-component references and reference cycles', async () => {
    const externalShape = await sourceDocument();
    externalShape.components.schemas.BadRef = { $ref: '#/components/parameters/Origin' };
    expect(() => generator.generateProtocol(externalShape)).toThrow(/reference/iu);

    const cycle = await sourceDocument();
    cycle.components.schemas.CycleA = { $ref: '#/components/schemas/CycleB' };
    cycle.components.schemas.CycleB = { $ref: '#/components/schemas/CycleA' };
    expect(() => generator.generateProtocol(cycle)).toThrow(/cycle/iu);
  });
});
