import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';
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

function collectProtocolNames(document: OpenApiDocument): string[] {
  const names = new Set<string>(Object.keys(document.components.schemas));
  for (const [componentName, parameter] of Object.entries(document.components.parameters)) {
    names.add(componentName);
    names.add(parameter.name);
  }
  function visitSchema(value: unknown): void {
    if (Array.isArray(value)) {
      for (const child of value) visitSchema(child);
      return;
    }
    if (!isRecord(value)) return;
    if (isRecord(value.properties)) {
      for (const name of Object.keys(value.properties)) names.add(name);
    }
    for (const child of Object.values(value)) visitSchema(child);
  }
  visitSchema(document.components.schemas);
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      if (isRecord(operation) && typeof operation.operationId === 'string') {
        names.add(operation.operationId);
      }
      if (isRecord(operation) && Array.isArray(operation.parameters)) {
        for (const parameter of operation.parameters) {
          if (isRecord(parameter) && typeof parameter.name === 'string') names.add(parameter.name);
        }
      }
    }
  }
  return [...names];
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

function splitName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function tokenHasForbiddenConcept(
  token: string,
  forbidden: ReadonlySet<string>,
  contextual: ReadonlySet<string>,
): boolean {
  if (forbidden.has(token)) return true;
  const words = [...forbidden, ...contextual].sort((left, right) => right.length - left.length);
  const states = new Map<string, boolean>([['0', false]]);
  for (let index = 0; index < token.length; index += 1) {
    for (const seenForbidden of [false, true]) {
      if (!states.has(`${index}:${seenForbidden}`) && !(index === 0 && !seenForbidden)) continue;
      for (const word of words) {
        if (!token.startsWith(word, index)) continue;
        const nextSeen = seenForbidden || forbidden.has(word);
        states.set(`${index + word.length}:${nextSeen}`, true);
      }
    }
  }
  return states.has(`${token.length}:true`);
}

function hasForbiddenName(
  name: string,
  policy: NonNullable<OpenApiDocument['x-forbidden-name-policy']>,
): boolean {
  const forbidden = new Set(policy.forbiddenLexemes);
  const contextual = new Set(policy.contextualLexemes);
  const tokens = splitName(name);
  const containsForbiddenPhrase = policy.forbiddenPhrases.some((phrase) =>
    tokens.some((_, index) =>
      phrase.every((word, phraseIndex) => tokens[index + phraseIndex] === word),
    ),
  );
  return (
    containsForbiddenPhrase ||
    tokens.some((token) => tokenHasForbiddenConcept(token, forbidden, contextual)) ||
    tokenHasForbiddenConcept(tokens.join(''), forbidden, contextual)
  );
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

  it('models pending redemption and bounded WAV as non-Problem, raw response boundaries', async () => {
    const document = (await loadOpenApiDocument()) as OpenApiDocument;
    const redeem = document.paths['/v1/pairings/challenges/{id}/redeem']?.post as Record<
      string,
      unknown
    >;
    const responses = redeem.responses as Record<string, Record<string, unknown>>;
    expect(responses['202']?.content).toEqual({
      'application/json': { schema: { $ref: '#/components/schemas/RedeemPendingResponse' } },
    });
    const audio = document.paths['/v1/jobs/{id}/audio']?.get as Record<string, unknown>;
    const audioResponses = audio.responses as Record<string, Record<string, unknown>>;
    expect(audioResponses['200']?.content).toEqual({
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
      expect(
        collectProtocolNames(injected).some((candidate) => hasForbiddenName(candidate, policy)),
        `${position}:${name}`,
      ).toBe(true);
    }
  });
});
