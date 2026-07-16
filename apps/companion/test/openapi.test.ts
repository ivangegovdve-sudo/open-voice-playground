import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const openApiPath = resolve(root, 'openapi/openapi.yaml');

type SchemaObject = Record<string, unknown> & { enum?: unknown[] };

interface OpenApiDocument {
  openapi: string;
  jsonSchemaDialect: string;
  servers: { url: string }[];
  'x-protocol-major': number;
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, SchemaObject> & {
      JobCreateRequest: SchemaObject;
      ProblemCode: SchemaObject;
      VoiceId: SchemaObject;
    };
  };
}

const expectedVoices = [
  'pocket:alba',
  'pocket:estelle',
  'pocket:anna',
  'pocket:vera',
  'pocket:fantine',
  'pocket:charles',
  'pocket:paul',
  'pocket:eponine',
  'pocket:azelma',
  'pocket:george',
  'pocket:mary',
  'pocket:jane',
  'pocket:michael',
  'pocket:eve',
  'pocket:bill_boerst',
  'pocket:caro_davy',
  'pocket:peter_yearsley',
  'pocket:stuart_bell',
  'pocket:marius',
  'pocket:javert',
] as const;

const requiredRoutes = [
  'GET /v1/health',
  'POST /v1/pairings/challenges',
  'POST /v1/pairings/challenges/{id}/redeem',
  'GET /v1/pairings/current',
  'DELETE /v1/pairings/current',
  'GET /v1/runtime',
  'GET /v1/engines',
  'GET /v1/voices',
  'GET /v1/packs',
  'POST /v1/jobs',
  'GET /v1/jobs/{id}',
  'DELETE /v1/jobs/{id}',
  'GET /v1/jobs/{id}/audio',
  'POST /v1/packs/{id}/actions',
];

const requiredProblemCodes = [
  'host-invalid',
  'origin-denied',
  'version-unsupported',
  'auth-invalid',
  'rate-limited',
  'body-too-large',
  'schema-invalid',
  'queue-full',
  'ownership-denied',
  'resource-not-found',
  'conflict',
  'handler-timeout',
  'listener-conflict',
  'pairing-denied',
  'pairing-expired',
  'pack-unverified',
  'runtime-unavailable',
];

function collectPropertyNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectPropertyNames(item, names);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.properties !== null && typeof record.properties === 'object') {
      for (const name of Object.keys(record.properties as object)) names.add(name);
    }
    for (const child of Object.values(record)) collectPropertyNames(child, names);
  }
  return names;
}

function assertStrictObjects(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertStrictObjects(item);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.type === 'object') expect(record.additionalProperties).toBe(false);
  for (const child of Object.values(record)) assertStrictObjects(child);
}

describe('authoritative companion OpenAPI', () => {
  it('defines the strict fail-closed v1 surface and validates shared fixtures', () => {
    expect(existsSync(openApiPath), 'authoritative OpenAPI document is missing').toBe(true);
    const document = parse(readFileSync(openApiPath, 'utf8')) as OpenApiDocument;
    expect(document.openapi).toBe('3.1.2');
    expect(document.jsonSchemaDialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(document.servers).toEqual([{ url: 'http://127.0.0.1:17843' }]);
    expect(document['x-protocol-major']).toBe(1);

    assertStrictObjects(document.components.schemas);
    const routes = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.keys(item as object)
        .filter((method) => ['get', 'post', 'delete', 'options'].includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(routes).toEqual(expect.arrayContaining(requiredRoutes));
    expect(document.components.schemas.VoiceId.enum).toEqual(expectedVoices);
    expect(document.components.schemas.ProblemCode.enum).toEqual(
      expect.arrayContaining(requiredProblemCodes),
    );

    const forbidden = new Set([
      'control',
      'controls',
      'path',
      'url',
      'command',
      'model',
      'outputname',
      'prompt',
      'referenceaudio',
      'upload',
      'cloning',
    ]);
    expect(
      [...collectPropertyNames(document.components.schemas)].filter((name) =>
        forbidden.has(name.toLowerCase()),
      ),
    ).toEqual([]);

    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const createJob = ajv.compile({
      ...document.components.schemas.JobCreateRequest,
      components: document.components,
    });
    const validFixture = JSON.parse(
      readFileSync(resolve(root, 'openapi/fixtures/job-create.valid.json'), 'utf8'),
    );
    const invalidFixtures = JSON.parse(
      readFileSync(resolve(root, 'openapi/fixtures/job-create.invalid.json'), 'utf8'),
    ) as unknown[];
    expect(createJob(validFixture)).toBe(true);
    for (const fixture of invalidFixtures) expect(createJob(fixture)).toBe(false);
  });
});
