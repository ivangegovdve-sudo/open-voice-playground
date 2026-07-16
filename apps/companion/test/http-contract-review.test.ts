import { describe, expect, it } from 'vitest';

import { buildHttpContract } from '../scripts/http-contract.mjs';
import { loadOpenApiDocument } from '../scripts/openapi-loader.mjs';
import { generateProtocol } from '../scripts/protocol-generator.mjs';

type JsonRecord = Record<string, unknown>;
type Namespace = 'parameters' | 'headers' | 'responses';

type OpenApiDocument = JsonRecord & {
  paths: Record<string, JsonRecord>;
  components: JsonRecord & {
    parameters: Record<string, unknown>;
    headers: Record<string, unknown>;
    responses: Record<string, unknown>;
    schemas: Record<string, JsonRecord>;
  };
};

async function sourceDocument(): Promise<OpenApiDocument> {
  return structuredClone((await loadOpenApiDocument()) as OpenApiDocument);
}

function record(value: unknown, label = 'value'): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is not a record`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label = 'value'): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} is not an array`);
  return value;
}

function operation(document: OpenApiDocument, path: string, method: string): JsonRecord {
  return record(record(document.paths[path], path)[method], `${method} ${path}`);
}

function componentMap(document: OpenApiDocument, namespace: Namespace): Record<string, unknown> {
  return document.components[namespace];
}

function healthResponseHeaders(document: OpenApiDocument): JsonRecord {
  const response = record(document.components.responses.HealthOkResponse, 'HealthOkResponse');
  return record(response.headers, 'HealthOkResponse.headers');
}

function activeReference(document: OpenApiDocument, namespace: Namespace): string {
  if (namespace === 'parameters') {
    const parameters = array(operation(document, '/v1/health', 'get').parameters);
    return String(record(parameters[0]).$ref);
  }
  if (namespace === 'headers') {
    return String(record(healthResponseHeaders(document)['Cache-Control']).$ref);
  }
  const responses = record(operation(document, '/v1/health', 'get').responses);
  return String(record(responses['400']).$ref);
}

function setActiveReference(
  document: OpenApiDocument,
  namespace: Namespace,
  candidate: JsonRecord,
): void {
  if (namespace === 'parameters') {
    const parameters = array(operation(document, '/v1/health', 'get').parameters);
    parameters[0] = candidate;
    return;
  }
  if (namespace === 'headers') {
    healthResponseHeaders(document)['Cache-Control'] = candidate;
    return;
  }
  const responses = record(operation(document, '/v1/health', 'get').responses);
  responses['400'] = candidate;
}

function wrongKindReference(namespace: Namespace): string {
  return namespace === 'headers'
    ? '#/components/parameters/Origin'
    : '#/components/headers/NoSniff';
}

function missingReference(namespace: Namespace): string {
  const singular =
    namespace === 'parameters' ? 'Parameter' : namespace === 'headers' ? 'Header' : 'Response';
  return `#/components/${namespace}/Missing${singular}`;
}

function addActiveReferenceChain(
  document: OpenApiDocument,
  namespace: Namespace,
  prefix: string,
  totalDepth: number,
): JsonRecord {
  if (totalDepth < 2) return { $ref: activeReference(document, namespace) };
  const components = componentMap(document, namespace);
  const terminal = activeReference(document, namespace);
  const aliasCount = totalDepth - 1;
  for (let index = 0; index < aliasCount; index += 1) {
    components[`${prefix}${index}`] = {
      $ref: index === aliasCount - 1 ? terminal : `#/components/${namespace}/${prefix}${index + 1}`,
    };
  }
  return { $ref: `#/components/${namespace}/${prefix}0` };
}

function addUnusedReferenceChain(
  document: OpenApiDocument,
  namespace: Namespace,
  prefix: string,
  depth: number,
): void {
  const components = componentMap(document, namespace);
  const terminal = activeReference(document, namespace);
  for (let index = 0; index < depth; index += 1) {
    components[`${prefix}${index}`] = {
      $ref: index === depth - 1 ? terminal : `#/components/${namespace}/${prefix}${index + 1}`,
    };
  }
}

function replaceReferences(value: unknown, reference: string, replacement: JsonRecord): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = value[index];
      if (recordOrUndefined(child)?.$ref === reference) {
        value[index] = structuredClone(replacement);
      } else {
        replaceReferences(child, reference, replacement);
      }
    }
    return;
  }
  const parent = value as JsonRecord;
  for (const [key, child] of Object.entries(parent)) {
    if (recordOrUndefined(child)?.$ref === reference) {
      parent[key] = structuredClone(replacement);
    } else {
      replaceReferences(child, reference, replacement);
    }
  }
}

function recordOrUndefined(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function renameComponent(
  document: OpenApiDocument,
  namespace: 'headers' | 'responses',
  from: string,
  to: string,
): void {
  const components = componentMap(document, namespace);
  components[to] = components[from];
  delete components[from];
  replaceReferences(document, `#/components/${namespace}/${from}`, {
    $ref: `#/components/${namespace}/${to}`,
  });
}

function policyProblemCodes(document: OpenApiDocument): {
  http: string[];
  nonHttp: string[];
} {
  const policy = record(document['x-ovp-http-policy'], 'x-ovp-http-policy');
  return record(policy.problemCodes, 'problemCodes') as {
    http: string[];
    nonHttp: string[];
  };
}

describe('C4 source closure review repair', () => {
  it.each([
    ['empty', {}],
    [
      'nested operation',
      {
        incoming: {
          '/review': {
            get: { operationId: 'hiddenWebhook', responses: {} },
          },
        },
      },
    ],
  ])('rejects root webhooks, including %s webhooks', async (_name, webhooks) => {
    const document = await sourceDocument();
    document.webhooks = webhooks;
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it.each(['callbacks', 'pathItems', 'requestBodies', 'examples', 'links', 'x-review'])(
    'rejects non-owned components namespace %s',
    async (namespace) => {
      const document = await sourceDocument();
      document.components[namespace] = {};
      expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
    },
  );

  it('rejects a missing owned Components namespace', async () => {
    const document = await sourceDocument();
    delete (document.components as JsonRecord).headers;
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it.each([
    ['empty callbacks', 'callbacks', {}],
    [
      'nested callbacks',
      'callbacks',
      { complete: { '{$request.body#/url}': { post: { operationId: 'hiddenCallback' } } } },
    ],
    ['operation servers', 'servers', [{ url: 'http://127.0.0.1:17844' }]],
    ['summary', 'summary', 'hidden semantic override'],
    ['description', 'description', 'hidden semantic override'],
    ['external docs', 'externalDocs', { url: 'https://example.invalid' }],
    ['deprecation', 'deprecated', false],
    ['extension', 'x-review-semantic', true],
    [
      'undeclared request body',
      'requestBody',
      {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/JobCreateRequest' } },
        },
      },
    ],
  ])('rejects source-open Operation key %s', async (_name, key, value) => {
    const document = await sourceDocument();
    operation(document, '/v1/health', 'get')[key] = value;
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it.each([
    ['alternate server', [{ url: 'http://127.0.0.1:17844' }]],
    ['second server', [{ url: 'http://127.0.0.1:17843' }, { url: 'http://127.0.0.1:17844' }]],
  ])('rejects an %s authority', async (_name, servers) => {
    const document = await sourceDocument();
    document.servers = servers;
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it.each([
    ['changed type', (scheme: JsonRecord) => (scheme.type = 'apiKey')],
    ['changed scheme', (scheme: JsonRecord) => (scheme.scheme = 'basic')],
    ['changed bearer format', (scheme: JsonRecord) => (scheme.bearerFormat = 'JWT')],
    ['missing bearer format', (scheme: JsonRecord) => delete scheme.bearerFormat],
    ['extra bearer field', (scheme: JsonRecord) => (scheme.description = 'extra')],
  ])('rejects bearer security scheme with %s', async (_name, mutate) => {
    const document = await sourceDocument();
    const schemes = record(document.components.securitySchemes, 'securitySchemes');
    mutate(record(schemes.bearerAuth, 'bearerAuth'));
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it('rejects an extra security scheme', async () => {
    const document = await sourceDocument();
    const schemes = record(document.components.securitySchemes, 'securitySchemes');
    schemes.extraAuth = { type: 'http', scheme: 'bearer', bearerFormat: 'OVP-43' };
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });

  it('rejects a missing bearer security scheme', async () => {
    const document = await sourceDocument();
    const schemes = record(document.components.securitySchemes, 'securitySchemes');
    delete schemes.bearerAuth;
    expect(() => buildHttpContract(document)).toThrow(/HTTP contract/iu);
  });
});

describe('C4 exact standard-slot component closure', () => {
  it.each([
    [
      'Parameter',
      'parameters',
      'ReviewOrphanParameter',
      {
        name: 'X-Review',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 8 },
      },
    ],
    [
      'Header',
      'headers',
      'ReviewOrphanHeader',
      { required: true, schema: { type: 'string', const: 'review' } },
    ],
    ['Response', 'responses', 'ReviewOrphanResponse', { description: 'review', headers: {} }],
  ] as const)('rejects a valid orphan %s component', async (_label, namespace, name, value) => {
    const document = await sourceDocument();
    componentMap(document, namespace)[name] = structuredClone(value);
    expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
  });

  it.each([
    [
      'Set-Cookie response',
      'responses',
      'DisconnectedCookieResponse',
      {
        description: 'disconnected',
        headers: {
          'Set-Cookie': {
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    ],
    [
      'wildcard allow-origin response',
      'responses',
      'DisconnectedWildcardOriginResponse',
      {
        description: 'disconnected',
        headers: {
          'Access-Control-Allow-Origin': {
            required: true,
            schema: { type: 'string', const: '*' },
          },
        },
      },
    ],
    [
      'altered expose response',
      'responses',
      'DisconnectedAlteredExposeResponse',
      {
        description: 'disconnected',
        headers: {
          'Access-Control-Expose-Headers': {
            required: true,
            schema: {
              type: 'string',
              const: 'ETag, Location, Retry-After, X-Extra, X-Request-Id',
            },
          },
        },
      },
    ],
  ] as const)('rejects disconnected unsafe profile: %s', async (_label, namespace, name, value) => {
    const document = await sourceDocument();
    componentMap(document, namespace)[name] = structuredClone(value);
    expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
  });

  it.each(['parameters', 'headers', 'responses'] as const)(
    'does not launder an orphan %s component through an extension $ref',
    async (namespace) => {
      const document = await sourceDocument();
      const name = `Laundered${namespace === 'parameters' ? 'Parameter' : namespace === 'headers' ? 'Header' : 'Response'}`;
      const value =
        namespace === 'parameters'
          ? {
              name: 'X-Laundered',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 8 },
            }
          : namespace === 'headers'
            ? { required: true, schema: { type: 'string', const: 'laundered' } }
            : { description: 'laundered', headers: {} };
      componentMap(document, namespace)[name] = value;
      record(document.info, 'info')['x-review-reachability'] = {
        $ref: `#/components/${namespace}/${name}`,
      };
      expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
    },
  );

  it.each(['parameters', 'headers', 'responses'] as const)(
    'rejects an extra but standard-slot-reachable %s alias',
    async (namespace) => {
      const document = await sourceDocument();
      const terminal = activeReference(document, namespace);
      const name = `Reachable${namespace === 'parameters' ? 'Parameter' : namespace === 'headers' ? 'Header' : 'Response'}Alias`;
      componentMap(document, namespace)[name] = { $ref: terminal };
      setActiveReference(document, namespace, { $ref: `#/components/${namespace}/${name}` });
      expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
    },
  );

  it.each([
    ['parameters', 'ClientVersion', documentPaths],
    ['headers', 'NoSniff', documentResponses],
    ['responses', 'UnauthorizedResponse', documentPaths],
  ] as const)('rejects a semantically inlined removal from %s', async (namespace, name, root) => {
    const document = await sourceDocument();
    const components = componentMap(document, namespace);
    const terminal = record(components[name], `${namespace}.${name}`);
    replaceReferences(root(document), `#/components/${namespace}/${name}`, terminal);
    delete components[name];
    expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
  });

  it.each([
    [
      'parameters',
      'ClientVersion',
      documentPaths,
      {
        name: 'X-Detached',
        in: 'header',
        required: true,
        schema: { type: 'string', minLength: 1, maxLength: 8 },
      },
    ],
    [
      'headers',
      'NoSniff',
      documentResponses,
      { required: true, schema: { type: 'string', const: 'detached' } },
    ],
    ['responses', 'UnauthorizedResponse', documentPaths, { description: 'detached', headers: {} }],
  ] as const)(
    'rejects a disconnected existing %s component without changing namespace count',
    async (namespace, name, root, detached) => {
      const document = await sourceDocument();
      const components = componentMap(document, namespace);
      const terminal = record(components[name], `${namespace}.${name}`);
      replaceReferences(root(document), `#/components/${namespace}/${name}`, terminal);
      components[name] = structuredClone(detached);
      expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
    },
  );
});

function documentPaths(document: OpenApiDocument): unknown {
  return document.paths;
}

function documentResponses(document: OpenApiDocument): unknown {
  return document.components.responses;
}

describe('C4 reference validation symmetry and boundary', () => {
  const namespaces = ['parameters', 'headers', 'responses'] as const;
  const failureKinds = ['wrong-kind', 'dangling', 'sibling', 'cycle', 'over-depth'] as const;

  it.each(
    namespaces.flatMap((namespace) => failureKinds.map((kind) => [namespace, kind] as const)),
  )('rejects active %s %s reference', async (namespace, kind) => {
    const document = await sourceDocument();
    const terminal = activeReference(document, namespace);
    if (kind === 'wrong-kind') {
      setActiveReference(document, namespace, { $ref: wrongKindReference(namespace) });
    } else if (kind === 'dangling') {
      setActiveReference(document, namespace, { $ref: missingReference(namespace) });
    } else if (kind === 'sibling') {
      setActiveReference(document, namespace, { $ref: terminal, description: 'sibling' });
    } else if (kind === 'cycle') {
      const components = componentMap(document, namespace);
      components.ActiveReviewCycleA = { $ref: `#/components/${namespace}/ActiveReviewCycleB` };
      components.ActiveReviewCycleB = { $ref: `#/components/${namespace}/ActiveReviewCycleA` };
      setActiveReference(document, namespace, {
        $ref: `#/components/${namespace}/ActiveReviewCycleA`,
      });
    } else {
      setActiveReference(
        document,
        namespace,
        addActiveReferenceChain(document, namespace, 'ActiveReviewDepth', 17),
      );
    }
    expect(() => buildHttpContract(document)).toThrow(
      kind === 'wrong-kind'
        ? /wrong-kind/iu
        : kind === 'dangling'
          ? /dangling/iu
          : kind === 'sibling'
            ? /unsupported shape/iu
            : kind === 'cycle'
              ? /cycle/iu
              : /depth/iu,
    );
  });

  it.each(
    namespaces.flatMap((namespace) => failureKinds.map((kind) => [namespace, kind] as const)),
  )('rejects unused %s %s reference during prevalidation', async (namespace, kind) => {
    const document = await sourceDocument();
    const components = componentMap(document, namespace);
    const terminal = activeReference(document, namespace);
    if (kind === 'wrong-kind') {
      components.UnusedReviewWrongKind = { $ref: wrongKindReference(namespace) };
    } else if (kind === 'dangling') {
      components.UnusedReviewDangling = { $ref: missingReference(namespace) };
    } else if (kind === 'sibling') {
      components.UnusedReviewSibling = { $ref: terminal, description: 'sibling' };
    } else if (kind === 'cycle') {
      components.UnusedReviewCycleA = { $ref: `#/components/${namespace}/UnusedReviewCycleB` };
      components.UnusedReviewCycleB = { $ref: `#/components/${namespace}/UnusedReviewCycleA` };
    } else {
      addUnusedReferenceChain(document, namespace, 'UnusedReviewDepth', 17);
    }
    expect(() => buildHttpContract(document)).toThrow(
      kind === 'wrong-kind'
        ? /wrong-kind/iu
        : kind === 'dangling'
          ? /dangling/iu
          : kind === 'sibling'
            ? /unsupported shape/iu
            : kind === 'cycle'
              ? /cycle/iu
              : /depth/iu,
    );
  });

  it.each(namespaces)(
    'resolves exactly sixteen active %s refs before applying exact closure',
    async (namespace) => {
      const document = await sourceDocument();
      setActiveReference(
        document,
        namespace,
        addActiveReferenceChain(document, namespace, 'BoundaryDepth', 16),
      );
      expect(() => buildHttpContract(document)).toThrow(/reference closure/iu);
    },
  );
});

describe('C4 symbolic names and Problem partition evidence', () => {
  it('uses NoStore as the safe symbolic Header key', async () => {
    const document = await sourceDocument();
    expect(Object.keys(document.components.headers)).toContain('NoStore');
    expect(Object.keys(document.components.headers)).not.toContain('CacheControl');
  });

  it.each([
    ['Header', 'headers', 'NoStore', 'CacheControl'],
    ['Header', 'headers', 'NoSniff', 'VoiceControl'],
    ['Response', 'responses', 'HealthOkResponse', 'VoiceControlResponse'],
  ] as const)(
    'rejects forbidden symbolic %s component key',
    async (_label, namespace, from, to) => {
      const document = await sourceDocument();
      renameComponent(document, namespace, from, to);
      expect(() => generateProtocol(document)).toThrow(/forbidden name/iu);
    },
  );

  it.each([
    [
      'HTTP addition',
      (document: OpenApiDocument) => policyProblemCodes(document).http.push('listener-conflict'),
    ],
    ['HTTP removal', (document: OpenApiDocument) => policyProblemCodes(document).http.pop()],
    ['HTTP reorder', (document: OpenApiDocument) => policyProblemCodes(document).http.reverse()],
    [
      'non-HTTP addition',
      (document: OpenApiDocument) => policyProblemCodes(document).nonHttp.push('action-invalid'),
    ],
    ['non-HTTP removal', (document: OpenApiDocument) => policyProblemCodes(document).nonHttp.pop()],
    [
      'non-HTTP redistribution/reorder',
      (document: OpenApiDocument) => {
        const codes = policyProblemCodes(document);
        codes.http = codes.http.filter((code) => code !== 'action-invalid');
        codes.nonHttp = ['action-invalid', 'listener-conflict'];
      },
    ],
    [
      'partition overlap',
      (document: OpenApiDocument) => policyProblemCodes(document).nonHttp.push('host-invalid'),
    ],
    [
      'partition omission',
      (document: OpenApiDocument) => {
        policyProblemCodes(document).http = policyProblemCodes(document).http.filter(
          (code) => code !== 'host-invalid',
        );
      },
    ],
    [
      'partition duplicate',
      (document: OpenApiDocument) => policyProblemCodes(document).http.push('host-invalid'),
    ],
    [
      'non-exhaustive enum addition',
      (document: OpenApiDocument) => {
        const problemCode = document.components.schemas.ProblemCode;
        array(problemCode.enum).push('review-unclassified');
      },
    ],
    [
      'authoritative enum omission',
      (document: OpenApiDocument) => {
        const problemCode = document.components.schemas.ProblemCode;
        problemCode.enum = array(problemCode.enum).filter((code) => code !== 'host-invalid');
      },
    ],
    [
      'authoritative enum duplicate',
      (document: OpenApiDocument) => {
        const problemCode = document.components.schemas.ProblemCode;
        array(problemCode.enum).push('host-invalid');
      },
    ],
    [
      'authoritative enum cross-partition reorder',
      (document: OpenApiDocument) => {
        const problemCode = document.components.schemas.ProblemCode;
        const values = array(problemCode.enum).filter((code) => code !== 'listener-conflict');
        values.push('listener-conflict');
        problemCode.enum = values;
      },
    ],
  ])('rejects Problem mutation: %s', async (_name, mutate) => {
    const document = await sourceDocument();
    mutate(document);
    expect(() => buildHttpContract(document)).toThrow(/problem|policy/iu);
  });
});
