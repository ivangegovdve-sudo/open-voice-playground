import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';
import { collectProtocolNames, hasForbiddenName } from '../scripts/protocol-name-policy.mjs';
import * as generated from '../src/generated/protocol.js';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface CorpusCase {
  id: string;
  schema: string;
  valid: boolean;
  category: string;
  value: JsonValue;
  native?: string;
}

interface ProtocolCorpus {
  version: number;
  description: string;
  expected: {
    voiceIds: string[];
    excludedVoiceIds: string[];
    scopes: string[];
    canonicalSecretTailAlphabet: string;
  };
  cases: CorpusCase[];
}

type SchemaObject = Record<string, unknown>;
type OpenApiDocument = Record<string, unknown> & {
  'x-forbidden-name-policy'?: {
    forbiddenLexemes: string[];
    contextualLexemes: string[];
    forbiddenPhrases: string[][];
  };
  paths: Record<string, Record<string, unknown>>;
  components: {
    parameters: Record<string, { name: string }>;
    responses: Record<string, Record<string, unknown>>;
    schemas: Record<string, SchemaObject>;
  };
};

const root = resolve(import.meta.dirname, '..');
const corpus = JSON.parse(
  readFileSync(resolve(root, 'openapi/fixtures/protocol-corpus.json'), 'utf8'),
) as ProtocolCorpus;
const runtime = generated as Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveResponse(
  document: OpenApiDocument,
  response: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof response.$ref !== 'string') return response;
  const name = response.$ref.replace('#/components/responses/', '');
  return document.components.responses[name]!;
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  ajv.addFormat('date-time', isCanonicalDateTime);
  ajv.addKeyword({
    keyword: 'x-maxUtf8Bytes',
    schemaType: 'number',
    type: 'string',
    errors: false,
    validate: (limit: number, data: string) => Buffer.byteLength(data, 'utf8') <= limit,
  });
  return ajv;
}

function isCanonicalDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return false;
  const zone = match[7]!;
  if (zone === '-00:00') return false;
  if (zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

function problemBranchTuple(branch: unknown): string | undefined {
  if (!isRecord(branch) || branch.type !== 'object' || branch.additionalProperties !== false) {
    return undefined;
  }
  const properties = branch.properties;
  if (!isRecord(properties)) return undefined;
  const code = properties.code;
  const status = properties.status;
  if (!isRecord(code) || typeof code.const !== 'string' || !isRecord(status)) return undefined;
  if (typeof status.const !== 'number') return undefined;
  return `${code.const}:${status.const}`;
}

function assertEveryObjectPropertyIsRequired(value: unknown, path = 'schemas'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertEveryObjectPropertyIsRequired(child, `${path}/${index}`));
    return;
  }
  if (!isRecord(value)) return;
  if (value.type === 'object') {
    expect(value.additionalProperties, `${path} is closed`).toBe(false);
    expect(isRecord(value.properties), `${path} properties`).toBe(true);
    expect(Array.isArray(value.required), `${path} required`).toBe(true);
    if (isRecord(value.properties) && Array.isArray(value.required)) {
      expect([...value.required].sort(), `${path} covers every property`).toEqual(
        Object.keys(value.properties).sort(),
      );
    }
  }
  for (const [key, child] of Object.entries(value)) {
    assertEveryObjectPropertyIsRequired(child, `${path}/${key}`);
  }
}

function containsOperationalOverclaim(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsOperationalOverclaim);
  if (!isRecord(value)) return ['ready', 'busy', 'degraded'].includes(String(value));
  if (value.operational === true || value.audioAvailable === true) return true;
  return Object.values(value).some((child) => containsOperationalOverclaim(child as JsonValue));
}

describe('canonical companion protocol corpus', () => {
  it('is complete, versioned, deterministic, and covers every owned schema and fixed identifier', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    expect(corpus.version).toBe(1);
    expect(corpus.description).toContain('never credentials');
    expect(new Set(corpus.cases.map((entry) => entry.id)).size).toBe(corpus.cases.length);

    const owned = Object.keys(document.components.schemas).sort();
    const represented = [...new Set(corpus.cases.map((entry) => entry.schema))].sort();
    expect(represented).toEqual(owned);
    assertEveryObjectPropertyIsRequired(document.components.schemas);
    for (const name of owned) {
      const cases = corpus.cases.filter((entry) => entry.schema === name);
      expect(
        cases.some((entry) => entry.valid),
        `${name} positive coverage`,
      ).toBe(true);
      expect(
        cases.some((entry) => !entry.valid),
        `${name} negative coverage`,
      ).toBe(true);
    }

    expect(corpus.expected.voiceIds).toEqual(document.components.schemas.VoiceId?.enum);
    expect(
      corpus.cases
        .filter((entry) => entry.valid && entry.schema === 'VoiceId')
        .map((entry) => entry.value),
    ).toEqual(expect.arrayContaining(corpus.expected.voiceIds));
    expect(
      corpus.cases
        .filter((entry) => entry.category === 'excluded-voice')
        .map((entry) => entry.value),
    ).toEqual(corpus.expected.excludedVoiceIds);
    expect(corpus.expected.canonicalSecretTailAlphabet).toBe('AEIMQUYcgkosw048');
    expect(corpus.expected.scopes).toHaveLength(7);
    expect(document.components.schemas.ClientLabel?.['x-maxUtf8Bytes']).toBe(128);
    expect(document.components.schemas.SynthesisText?.['x-maxUtf8Bytes']).toBe(8_000);

    const base64UrlAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const canonicalTailCases = corpus.cases.filter(
      (entry) => entry.category === 'canonical-secret-final-bits',
    );
    const noncanonicalTailCases = corpus.cases.filter(
      (entry) => entry.category === 'secret-noncanonical-final-bits',
    );
    const assertTailCases = (cases: CorpusCase[], valid: boolean) => {
      for (const entry of cases) {
        expect(entry).toMatchObject({ schema: 'OpaqueSecret', valid, native: 'secret' });
        expect(typeof entry.value).toBe('string');
        if (typeof entry.value !== 'string') continue;
        expect(entry.value).toHaveLength(43);
        expect(entry.value.slice(0, 42)).toBe('A'.repeat(42));
        expect(entry.value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      }
    };
    assertTailCases(canonicalTailCases, true);
    assertTailCases(noncanonicalTailCases, false);
    const canonicalTails = canonicalTailCases.map((entry) => String(entry.value).at(-1)!);
    const noncanonicalTails = noncanonicalTailCases.map((entry) => String(entry.value).at(-1)!);
    expect(canonicalTails).toHaveLength(16);
    expect(new Set(canonicalTails).size).toBe(16);
    expect(noncanonicalTails).toHaveLength(48);
    expect(new Set(noncanonicalTails).size).toBe(48);
    expect(base64UrlAlphabet.split('').filter((tail) => canonicalTails.includes(tail))).toEqual(
      corpus.expected.canonicalSecretTailAlphabet.split(''),
    );
    expect(base64UrlAlphabet.split('').filter((tail) => noncanonicalTails.includes(tail))).toEqual(
      base64UrlAlphabet
        .split('')
        .filter((tail) => !corpus.expected.canonicalSecretTailAlphabet.includes(tail)),
    );

    const caseIds = new Set(corpus.cases.map((entry) => entry.id));
    const requiredBoundaryIds = [
      ...[
        ...Array.from({ length: 0x20 }, (_, index) => index),
        0x7f,
        ...Array.from({ length: 0x20 }, (_, index) => 0x80 + index),
        0x061c,
        0x200e,
        0x200f,
        ...Array.from({ length: 7 }, (_, index) => 0x2028 + index),
        ...Array.from({ length: 4 }, (_, index) => 0x2066 + index),
      ].map((codePoint) => `derived-label-forbidden-u-${codePoint.toString(16).padStart(4, '0')}`),
      ...[
        'less-than',
        'greater-than',
        'left-brace',
        'right-brace',
        'left-bracket',
        'right-bracket',
        'backtick',
      ].map((name) => `derived-label-forbidden-${name}`),
      ...[
        ...Array.from({ length: 9 }, (_, index) => index),
        ...Array.from({ length: 18 }, (_, index) => 0x0e + index),
      ].map((codePoint) => `derived-text-forbidden-u-${codePoint.toString(16).padStart(4, '0')}`),
      ...[0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x7f].map(
        (codePoint) => `derived-text-allowed-u-${codePoint.toString(16).padStart(4, '0')}`,
      ),
      ...Array.from(
        { length: 0x20 },
        (_, index) => `derived-text-allowed-u-${(0x80 + index).toString(16).padStart(4, '0')}`,
      ),
      'derived-version-exact-32-bytes',
      'derived-version-33-bytes',
      'derived-version-one-part',
      'derived-version-build-metadata',
      'derived-version-whitespace',
      'derived-version-unicode-digit',
      'derived-uuid-nil',
      'derived-uuid-braced',
      'derived-uuid-misplaced-hyphen',
      'derived-uuid-whitespace',
      ...[
        'length-11',
        'length-13',
        'lowercase',
        'forbidden-i',
        'forbidden-l',
        'forbidden-o',
        'forbidden-u',
        'separator',
        'whitespace',
      ].map((name) => `derived-manual-code-${name}`),
      'derived-pairing-challenge-manual-branch',
      'derived-pairing-challenge-hybrid',
      'derived-pairing-challenge-neither-branch',
      'derived-pending-redeem-problem-at-202',
      ...['token', 'pairing', 'detail', 'code'].map(
        (field) => `derived-pending-redeem-leaks-${field}`,
      ),
    ];
    for (const id of requiredBoundaryIds) expect(caseIds.has(id), id).toBe(true);

    const validActions = (schema: 'PackActionRequest' | 'PackActionResponse') =>
      corpus.cases
        .filter((entry) => entry.schema === schema && entry.valid && isRecord(entry.value))
        .map((entry) => (entry.value as Record<string, unknown>).action)
        .filter((action): action is string => typeof action === 'string');
    expect([...new Set(validActions('PackActionRequest'))].sort()).toEqual([
      'install',
      'remove',
      'repair',
      'update',
    ]);
    expect([...new Set(validActions('PackActionResponse'))].sort()).toEqual([
      'install',
      'remove',
      'repair',
      'update',
    ]);
    expect(
      [
        ...new Set(
          corpus.cases
            .filter(
              (entry) => entry.schema === 'JobResponse' && entry.valid && isRecord(entry.value),
            )
            .map((entry) => (entry.value as Record<string, unknown>).state),
        ),
      ].sort(),
    ).toEqual(['cancelled', 'cancelling', 'expired', 'failed', 'queued']);

    const nativeBySchema: Record<string, string> = {
      CanonicalUuid: 'uuid',
      ClientLabel: 'label',
      ClientVersion: 'version',
      JobCreateRequest: 'job',
      OpaqueSecret: 'secret',
      Problem: 'problem',
      ProblemCode: 'problem-code',
      Scope: 'scope',
      ScopeList: 'scope-list',
      SynthesisText: 'text',
      VoiceId: 'voice-id',
    };
    const nativeCases = corpus.cases.filter((entry) => entry.native !== undefined);
    expect([...new Set(nativeCases.map((entry) => entry.native))].sort()).toEqual(
      Object.values(nativeBySchema).sort(),
    );
    for (const [schema, marker] of Object.entries(nativeBySchema)) {
      const cases = nativeCases.filter(
        (entry) => entry.schema === schema && entry.native === marker,
      );
      expect(
        cases.some((entry) => entry.valid),
        `${marker} native positive coverage`,
      ).toBe(true);
      expect(
        cases.some((entry) => !entry.valid),
        `${marker} native negative coverage`,
      ).toBe(true);
    }
    for (const entry of nativeCases) {
      expect(entry.native, `${entry.id} native marker`).toBe(nativeBySchema[entry.schema]);
    }
    expect(
      corpus.cases
        .filter((entry) => entry.category.startsWith('derived-problem-'))
        .every((entry) => entry.native === 'problem'),
    ).toBe(true);
    expect(
      corpus.cases
        .filter((entry) => entry.id.startsWith('derived-job-create-request-'))
        .every((entry) => entry.native === 'job'),
    ).toBe(true);
  });

  it('makes authoritative schemas and generated guards agree on every positive and negative case', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const ajv = createAjv();
    const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      validators.set(name, ajv.compile({ ...schema, components: document.components }));
    }

    for (const entry of corpus.cases) {
      const validator = validators.get(entry.schema);
      expect(validator, `${entry.id}: authoritative schema exists`).toBeTypeOf('function');
      const guard = runtime[`is${entry.schema}`];
      const parser = runtime[`parse${entry.schema}`];
      expect(guard, `${entry.id}: generated guard exists`).toBeTypeOf('function');
      expect(parser, `${entry.id}: generated parser exists`).toBeTypeOf('function');
      if (!validator || typeof guard !== 'function' || typeof parser !== 'function') continue;
      expect(validator(entry.value), `${entry.id}: authoritative schema`).toBe(entry.valid);
      expect(guard(entry.value), `${entry.id}: generated guard`).toBe(entry.valid);
      if (entry.valid) {
        const parsed = parser(entry.value) as JsonValue;
        expect(JSON.stringify(parsed), `${entry.id}: exact JSON round trip`).toBe(
          JSON.stringify(entry.value),
        );
      } else {
        expect(() => parser(entry.value), `${entry.id}: parser rejection`).toThrow();
      }
    }
  });

  it('makes the Ajv UTF-8 extension enforce bytes independently from scalar length', () => {
    const validator = createAjv().compile({ type: 'string', 'x-maxUtf8Bytes': 3 });
    expect(validator('€')).toBe(true);
    expect(validator('😀')).toBe(false);
  });

  it('pins an invalid interior secret character independently from canonical final bits', () => {
    const value = `${'A'.repeat(21)}+${'A'.repeat(21)}`;
    expect(value).toHaveLength(43);
    expect(value.at(-1)).toBe('A');
    expect(
      corpus.cases.find((entry) => entry.id === 'derived-secret-invalid-interior-plus'),
    ).toEqual({
      id: 'derived-secret-invalid-interior-plus',
      schema: 'OpaqueSecret',
      valid: false,
      category: 'secret-interior-alphabet',
      value,
      native: 'secret',
    });
  });

  it('pins the client-version byte limit at exact and one-over boundaries', () => {
    const exact = `1.${'1'.repeat(14)}.${'2'.repeat(15)}`;
    const oneOver = `1.${'1'.repeat(14)}.${'2'.repeat(16)}`;
    expect(Buffer.byteLength(exact, 'utf8')).toBe(32);
    expect(Buffer.byteLength(oneOver, 'utf8')).toBe(33);
    expect(
      corpus.cases.find((entry) => entry.id === 'derived-version-exact-32-bytes'),
    ).toMatchObject({
      schema: 'ClientVersion',
      valid: true,
      value: exact,
      native: 'version',
    });
    expect(corpus.cases.find((entry) => entry.id === 'derived-version-33-bytes')).toEqual({
      id: 'derived-version-33-bytes',
      schema: 'ClientVersion',
      valid: false,
      category: 'version-fixed-boundary',
      value: oneOver,
      native: 'version',
    });
  });

  it('binds every problem code/status tuple and keeps every positive fail-closed', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const problem = document.components.schemas.Problem;
    const branches = problem?.oneOf;
    expect(Array.isArray(branches)).toBe(true);
    if (!Array.isArray(branches)) return;
    const expected = branches.map(problemBranchTuple);
    expect(expected.every((tuple) => tuple !== undefined)).toBe(true);
    const branchCodes = branches.map((branch) => {
      const properties = isRecord(branch) && isRecord(branch.properties) ? branch.properties : {};
      const code = isRecord(properties.code) ? properties.code.const : undefined;
      return code;
    });
    expect(branchCodes.every((code) => typeof code === 'string')).toBe(true);
    const problemCodeEnum = document.components.schemas.ProblemCode?.enum;
    expect(Array.isArray(problemCodeEnum)).toBe(true);
    const corpusCodes = corpus.cases
      .filter((entry) => entry.schema === 'ProblemCode' && entry.valid)
      .map((entry) => entry.value);
    expect([...branchCodes].sort()).toEqual([...(problemCodeEnum ?? [])].sort());
    expect([...corpusCodes].sort()).toEqual([...(problemCodeEnum ?? [])].sort());
    const covered = corpus.cases
      .filter((entry) => entry.valid && entry.schema === 'Problem' && isRecord(entry.value))
      .map(
        (entry) =>
          `${String((entry.value as Record<string, unknown>).code)}:${String((entry.value as Record<string, unknown>).status)}`,
      );
    expect(covered.sort()).toEqual(expected.sort());
    expect(
      corpus.cases
        .filter((entry) => entry.valid)
        .some((entry) => containsOperationalOverclaim(entry.value)),
    ).toBe(false);
  });

  it('pins every closed Problem root mutation to one catalog baseline', () => {
    const baselineEntry = corpus.cases.find(
      (entry) => entry.schema === 'Problem' && entry.valid && entry.category === 'problem-catalog',
    );
    expect(baselineEntry).toBeDefined();
    if (!baselineEntry || !isRecord(baselineEntry.value)) return;
    const baseline = baselineEntry.value as Record<string, JsonValue>;
    const fields = ['type', 'title', 'status', 'detail', 'instance', 'code', 'requestId'];
    expect(Object.keys(baseline).sort()).toEqual([...fields].sort());
    const code = String(baseline.code);

    const unknown = corpus.cases.find(
      (entry) => entry.id === `derived-problem-${code}-root-unknown-property`,
    );
    expect(unknown).toMatchObject({ schema: 'Problem', valid: false, native: 'problem' });
    expect(unknown?.value).toEqual({ ...baseline, unexpectedCorpusField: true });

    for (const field of fields) {
      const omitted = corpus.cases.find(
        (entry) => entry.id === `derived-problem-${code}-root-omit-${field}`,
      );
      const expectedOmitted = structuredClone(baseline);
      delete expectedOmitted[field];
      expect(omitted, `omitted Problem.${field}`).toMatchObject({
        schema: 'Problem',
        valid: false,
        native: 'problem',
        value: expectedOmitted,
      });

      const wrongKind = corpus.cases.find(
        (entry) => entry.id === `derived-problem-${code}-root-wrong-kind-${field}`,
      );
      const expectedWrongKind = structuredClone(baseline);
      expectedWrongKind[field] = field === 'status' ? 'wrong-json-kind' : {};
      expect(wrongKind, `wrong-kind Problem.${field}`).toMatchObject({
        schema: 'Problem',
        valid: false,
        native: 'problem',
        value: expectedWrongKind,
      });
    }

    const outOfRange = corpus.cases.find(
      (entry) => entry.id === `derived-problem-${code}-status-out-of-range`,
    );
    expect(outOfRange).toMatchObject({
      schema: 'Problem',
      valid: false,
      native: 'problem',
      value: { ...baseline, status: 399 },
    });
  });

  it('pins the repeated-label anti-spoof boundary at exactly 32 scalars', () => {
    expect(corpus.cases.find((entry) => entry.id === 'positive-label-128-bytes')).toEqual({
      id: 'positive-label-128-bytes',
      schema: 'ClientLabel',
      valid: true,
      category: 'utf8-byte-limit',
      value: '😀'.repeat(32),
      native: 'label',
    });
    expect(corpus.cases.find((entry) => entry.id === 'derived-label-32-identical-ascii')).toEqual({
      id: 'derived-label-32-identical-ascii',
      schema: 'ClientLabel',
      valid: true,
      category: 'label-repeated-scalar-boundary',
      value: 'a'.repeat(32),
      native: 'label',
    });
    expect(corpus.cases.find((entry) => entry.id === 'derived-label-33-identical-ascii')).toEqual({
      id: 'derived-label-33-identical-ascii',
      schema: 'ClientLabel',
      valid: false,
      category: 'label-repeated-scalar-boundary',
      value: 'a'.repeat(33),
      native: 'label',
    });
  });

  it('pins the label UTF-8 byte limit without a scalar or repeated-scalar confounder', () => {
    const oneOver = `${Array.from({ length: 32 }, (_, index) => (index % 2 === 0 ? '😀' : '😁')).join('')}a`;
    expect(Array.from(oneOver)).toHaveLength(33);
    expect(Buffer.byteLength(oneOver, 'utf8')).toBe(129);
    expect(
      corpus.cases.find((entry) => entry.id === 'derived-label-byte-over-nonrepeated'),
    ).toEqual({
      id: 'derived-label-byte-over-nonrepeated',
      schema: 'ClientLabel',
      valid: false,
      category: 'label-utf8-byte-boundary',
      value: oneOver,
      native: 'label',
    });
  });

  it('pins symmetric canonical date-time precision, year, and second boundaries', () => {
    const expected = [
      ['derived-date-time-nine-fraction-z', true, '2028-02-29T23:59:59.123456789Z'],
      ['derived-date-time-ten-fraction-z', false, '2028-02-29T23:59:59.1234567890Z'],
      ['derived-date-time-nine-fraction-offset', true, '2028-02-29T23:59:59.123456789+03:00'],
      ['derived-date-time-ten-fraction-offset', false, '2028-02-29T23:59:59.1234567890+03:00'],
      ['derived-date-time-year-zero', false, '0000-01-01T00:00:00Z'],
      ['derived-date-time-leap-second', false, '2028-02-29T23:59:60Z'],
    ] as const;
    for (const [id, valid, value] of expected) {
      expect(
        corpus.cases.find((entry) => entry.id === id),
        id,
      ).toEqual({
        id,
        schema: 'CanonicalDateTime',
        valid,
        category: 'date-time-canonical-boundary',
        value,
      });
    }
  });

  it('pins list cardinality and isolates the 20-voice uniqueness boundary', () => {
    const representative = (schema: string, field: string): JsonValue[] => {
      const entry = corpus.cases.find(
        (candidate) =>
          candidate.schema === schema &&
          candidate.valid &&
          candidate.category === 'representative' &&
          isRecord(candidate.value),
      );
      expect(entry, `${schema} representative`).toBeDefined();
      const value = entry && isRecord(entry.value) ? entry.value[field] : undefined;
      expect(Array.isArray(value), `${schema}.${field}`).toBe(true);
      return Array.isArray(value) ? value : [];
    };
    const engines = representative('EngineListResponse', 'engines');
    const packs = representative('PackListResponse', 'packs');
    const voices = representative('VoiceListResponse', 'voices');
    const expected = [
      ['derived-engine-list-length-0', 'EngineListResponse', 'engines', []],
      ['derived-engine-list-length-2', 'EngineListResponse', 'engines', [engines[0], engines[0]]],
      ['derived-pack-list-length-0', 'PackListResponse', 'packs', []],
      ['derived-pack-list-length-2', 'PackListResponse', 'packs', [packs[0], packs[0]]],
      ['derived-voice-list-length-19', 'VoiceListResponse', 'voices', voices.slice(0, 19)],
      // With exactly 20 valid voice values, length 21 necessarily also duplicates an item.
      ['derived-voice-list-length-21', 'VoiceListResponse', 'voices', [...voices, voices[0]]],
      [
        'derived-voice-list-length-20-duplicate',
        'VoiceListResponse',
        'voices',
        [...voices.slice(0, 19), voices[0]],
      ],
    ] as const;
    for (const [id, schema, field, items] of expected) {
      expect(
        corpus.cases.find((entry) => entry.id === id),
        id,
      ).toEqual({
        id,
        schema,
        valid: false,
        category: id.endsWith('duplicate')
          ? 'list-unique-items-boundary'
          : 'list-cardinality-boundary',
        value: { [field]: items },
      });
    }
    expect(voices).toHaveLength(20);
    expect(new Set(voices.map((voice) => JSON.stringify(voice))).size).toBe(20);
    const duplicateCase = corpus.cases.find(
      (entry) => entry.id === 'derived-voice-list-length-20-duplicate',
    );
    const duplicateVoices =
      duplicateCase && isRecord(duplicateCase.value) && Array.isArray(duplicateCase.value.voices)
        ? duplicateCase.value.voices
        : [];
    expect(duplicateVoices).toHaveLength(20);
    expect(new Set(duplicateVoices.map((voice) => JSON.stringify(voice))).size).toBe(19);
  });

  it('models pending redemption and bounded WAV as non-Problem, raw response boundaries', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const redeem = document.paths['/v1/pairings/challenges/{id}/redeem']?.post as Record<
      string,
      unknown
    >;
    const responses = redeem.responses as Record<string, Record<string, unknown>>;
    expect(resolveResponse(document, responses['202']!).content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/RedeemPendingResponse' } },
    });
    const audio = document.paths['/v1/jobs/{id}/audio']?.get as Record<string, unknown>;
    const audioResponses = audio.responses as Record<string, Record<string, unknown>>;
    expect(resolveResponse(document, audioResponses['200']!).content).toEqual({
      'audio/wav': { 'x-maxBodyBytes': 67_108_864 },
    });
  });

  it('tokenizes forbidden concepts across naming styles without substring false positives', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const policy = document['x-forbidden-name-policy'];
    expect(policy).toBeDefined();
    if (!policy) return;
    expect(collectProtocolNames(document).filter((name) => hasForbiddenName(name, policy))).toEqual(
      [],
    );
    for (const name of [
      'voiceClone',
      'voice_clone',
      'voice-cloning',
      'voice cloning',
      'voicecloning',
      'audioUpload',
      'referencePrompt',
      'modelControl',
      'filesystemPath',
      'remote_url',
      'shell-command',
      'model control',
      'outputName',
      'referenceaudio',
      'referenceAudio',
      'reference_audio',
      'reference-audio',
      'reference audio',
      'output_name',
      'output-name',
      'output name',
    ]) {
      expect(hasForbiddenName(name, policy), name).toBe(true);
    }
    for (const name of [
      'cycloneState',
      'pathologyCode',
      'curlingState',
      'promptlyHandled',
      'commandmentId',
      'controller',
      'uploadingness',
      'uncontrolledGrowth',
      'audioAvailable',
    ]) {
      expect(hasForbiddenName(name, policy), name).toBe(false);
    }

    const injections = [
      ['schema', 'VoiceClone'],
      ['property', 'voice_upload'],
      ['operation', 'reference-prompt'],
      ['component-parameter', 'model control'],
      ['wire-parameter', 'outputname'],
      ['operation-inline-parameter', 'reference audio'],
      ['path-inline-parameter', 'output name'],
    ] as const;
    for (const [position, name] of injections) {
      const injected = JSON.parse(JSON.stringify(document)) as OpenApiDocument;
      if (position === 'schema') injected.components.schemas[name] = { type: 'string' };
      if (position === 'property') {
        const health = injected.components.schemas.HealthResponse as Record<string, unknown>;
        (health.properties as Record<string, unknown>)[name] = { type: 'string' };
      }
      if (position === 'operation') {
        (injected.paths['/v1/health']!.get as Record<string, unknown>).operationId = name;
      }
      if (position === 'component-parameter') {
        injected.components.parameters[name] = { name: 'Origin' };
      }
      if (position === 'wire-parameter') injected.components.parameters.Origin!.name = name;
      if (position === 'operation-inline-parameter') {
        const operation = injected.paths['/v1/health']!.get as Record<string, unknown>;
        operation.parameters = [
          ...(operation.parameters as unknown[]),
          { in: 'query', name, schema: { type: 'string' } },
        ];
      }
      if (position === 'path-inline-parameter') {
        injected.paths['/v1/health']!.parameters = [
          { in: 'query', name, schema: { type: 'string' } },
        ];
      }
      expect(
        collectProtocolNames(injected).some((candidate) => hasForbiddenName(candidate, policy)),
        `${position}:${name}`,
      ).toBe(true);
    }
  });
});
