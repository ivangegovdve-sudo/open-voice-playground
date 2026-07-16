import { describe, expect, it, vi } from 'vitest';

import {
  COMPANION_API_ORIGIN,
  COMPANION_CLIENT_VERSION,
  CompanionHttpError,
  CompanionProtocolError,
  createCompanionClient,
  parseCanonicalUuid,
  parseJobCreateRequest,
  parseOpaqueSecret,
  parsePackActionRequest,
  parsePackId,
  parsePairingChallengeRequest,
  parseRedeemRequest,
} from '../src/generated/protocol.js';
import type {
  CompanionClient,
  CompanionClientOperationId,
  CompanionFetch,
  CompanionRequestInit,
  CompanionProtocolErrorReason,
} from '../src/generated/protocol.js';

const encoder = new TextEncoder();
const uuidText = '123e4567-e89b-12d3-a456-426614174000';
const timestamp = '2028-02-29T23:59:59.123+03:00';
const tokenText = `${'S'.repeat(42)}A`;
const verifierText = `${'V'.repeat(42)}E`;
const requestId = parseCanonicalUuid(uuidText);
const token = parseOpaqueSecret(tokenText);
const packId = parsePackId('pocket-companion-pack');
const scopes = [
  'health:read',
  'runtime:read',
  'synthesis:create',
  'jobs:read',
  'jobs:cancel',
  'audio:read',
  'packs:request',
] as const;
const voiceIds = [
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

const jobRequest = parseJobCreateRequest({ voiceId: 'pocket:alba', text: 'Exact text' });
const challengeRequest = parsePairingChallengeRequest({
  state: tokenText,
  verifierHash: verifierText,
  clientLabel: 'Browser playground',
  scopes,
});
const redeemRequest = parseRedeemRequest({ verifier: verifierText });
const packActionRequest = parsePackActionRequest({ action: 'install' });

const pairing = {
  id: uuidText,
  clientLabel: 'Browser playground',
  scopes,
  createdAt: timestamp,
  lastUsedAt: timestamp,
};
const engine = {
  id: 'pocket',
  state: 'pack-unverified',
  operational: false,
};
const pack = {
  id: 'pocket-companion-pack',
  state: 'pack-unverified',
  verified: false,
  operational: false,
};
const voices = voiceIds.map((id) => ({
  id,
  engineId: 'pocket',
  availableInPack: true,
  operational: false,
}));
const health = {
  app: 'open-voice-companion',
  protocolMajor: 1,
  listenerState: 'listening',
};
const job = {
  id: uuidText,
  voiceId: 'pocket:alba',
  state: 'queued',
  audioAvailable: false,
  createdAt: timestamp,
};

function problem(
  code:
    'schema-invalid' | 'rate-limited' | 'queue-full' | 'runtime-unavailable' | 'listener-conflict',
): Record<string, unknown> {
  const catalog = {
    'schema-invalid': {
      title: 'Invalid request',
      status: 400,
      detail: 'The request body does not match the protocol schema.',
    },
    'rate-limited': {
      title: 'Rate limit exceeded',
      status: 429,
      detail: 'The request rate limit has been reached.',
    },
    'queue-full': {
      title: 'Request rejected',
      status: 503,
      detail: 'The synthesis queue is at capacity.',
    },
    'runtime-unavailable': {
      title: 'Runtime unavailable',
      status: 503,
      detail: 'The synthesis runtime is unavailable.',
    },
    'listener-conflict': {
      title: 'Listener unavailable',
      status: 503,
      detail: 'The fixed loopback port is already in use.',
    },
  } as const;
  return {
    type: `urn:ovp:problem:${code}`,
    ...catalog[code],
    instance: `urn:uuid:${uuidText}`,
    code,
    requestId: uuidText,
  };
}

type ResponseOptions = Readonly<{
  url: string;
  status: number;
  json?: unknown;
  rawBytes?: Uint8Array;
  contentType?: string | null;
  contentLength?: string | null;
  headers?: Readonly<Record<string, string>>;
  type?: ResponseType;
  redirected?: boolean;
  nullBody?: boolean;
  chunks?: Iterable<Uint8Array>;
  onPull?: (index: number) => void;
}>;

type ObservedResponse = Response & {
  readonly highLevel: Readonly<{
    arrayBuffer: ReturnType<typeof vi.fn>;
    blob: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    text: ReturnType<typeof vi.fn>;
  }>;
  readonly cancelSpy: ReturnType<typeof vi.fn>;
};

function responseBytes(options: ResponseOptions): Uint8Array {
  if (options.rawBytes !== undefined) return options.rawBytes;
  if (options.json !== undefined) return encoder.encode(JSON.stringify(options.json));
  return new Uint8Array();
}

function corsResponse(options: ResponseOptions): ObservedResponse {
  const bytes = responseBytes(options);
  const contentType =
    options.contentType === undefined
      ? options.json === undefined
        ? null
        : 'application/json'
      : options.contentType;
  const contentLength =
    options.contentLength === undefined ? String(bytes.byteLength) : options.contentLength;
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Request-Id': uuidText,
    ...options.headers,
  });
  if (contentType !== null) {
    try {
      headers.set('Content-Type', contentType);
    } catch {
      // The structural response double below preserves adversarial visible values
      // that the native Node Headers helper refuses to construct.
    }
  }
  if (contentLength !== null) headers.set('Content-Length', contentLength);
  const exactValues = new Map<string, string>();
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    exactValues.set(name.toLowerCase(), value);
  }
  if (contentType !== null) exactValues.set('content-type', contentType);
  if (contentLength !== null) exactValues.set('content-length', contentLength);
  const observableHeaders = {
    get(name: string): string | null {
      const exact = exactValues.get(name.toLowerCase());
      return exact ?? headers.get(name);
    },
  };

  const cancelSpy = vi.fn();
  let body: ReadableStream<Uint8Array> | null = null;
  if (options.nullBody !== true) {
    const chunks = options.chunks ?? [bytes];
    const iterator = chunks[Symbol.iterator]();
    let index = 0;
    body = new ReadableStream<Uint8Array>({
      pull(controller) {
        options.onPull?.(index);
        index += 1;
        const next = iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel: cancelSpy,
    });
  }

  const highLevel = {
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    json: vi.fn(),
    text: vi.fn(),
  };
  return {
    body,
    bodyUsed: false,
    headers: observableHeaders,
    ok: options.status >= 200 && options.status < 300,
    redirected: options.redirected ?? false,
    status: options.status,
    statusText: '',
    type: options.type ?? 'cors',
    url: options.url,
    ...highLevel,
    clone: vi.fn(),
    formData: vi.fn(),
    bytes: vi.fn(),
    highLevel,
    cancelSpy,
  } as unknown as ObservedResponse;
}

async function protocolFailure(
  promise: Promise<unknown>,
  reason: CompanionProtocolErrorReason,
): Promise<CompanionProtocolError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CompanionProtocolError);
  expect(caught).toMatchObject({ reason });
  return caught as CompanionProtocolError;
}

function healthClient(response: Response): CompanionClient {
  return createCompanionClient(async () => response);
}

function healthResponse(overrides: Partial<ResponseOptions> = {}): ObservedResponse {
  return corsResponse({
    url: `${COMPANION_API_ORIGIN}/v1/health`,
    status: 200,
    json: health,
    ...overrides,
  });
}

function repeatedChunks(count: number, size: number): Iterable<Uint8Array> {
  return {
    *[Symbol.iterator]() {
      const chunk = new Uint8Array(size);
      for (let index = 0; index < count; index += 1) yield chunk;
    },
  };
}

const methodNames = [
  'cancelJob',
  'createJob',
  'createPairingChallenge',
  'getCurrentPairing',
  'getHealth',
  'getJob',
  'getJobAudio',
  'getRuntime',
  'listEngines',
  'listPacks',
  'listVoices',
  'redeemPairingChallenge',
  'requestPackAction',
  'revokeCurrentPairing',
] as const satisfies readonly CompanionClientOperationId[];

type OperationCase = Readonly<{
  operationId: CompanionClientOperationId;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  requestBody?: unknown;
  bearer: boolean;
  status: number;
  responseBody?: unknown;
  responseContentType?: string | null;
  responseHeaders?: Readonly<Record<string, string>>;
  nullBody?: boolean;
  invoke: (client: CompanionClient) => Promise<unknown>;
}>;

const operationCases: readonly OperationCase[] = [
  {
    operationId: 'cancelJob',
    method: 'DELETE',
    path: `/v1/jobs/${uuidText}`,
    bearer: true,
    status: 202,
    responseBody: job,
    invoke: (client) => client.cancelJob({ id: requestId, token }),
  },
  {
    operationId: 'createJob',
    method: 'POST',
    path: '/v1/jobs',
    requestBody: jobRequest,
    bearer: true,
    status: 202,
    responseBody: job,
    responseHeaders: { Location: `/v1/jobs/${uuidText}` },
    invoke: (client) => client.createJob({ body: jobRequest, token }),
  },
  {
    operationId: 'createPairingChallenge',
    method: 'POST',
    path: '/v1/pairings/challenges',
    requestBody: challengeRequest,
    bearer: false,
    status: 201,
    responseBody: { id: uuidText, state: 'pending', expiresAt: timestamp },
    responseHeaders: { Location: `/v1/pairings/challenges/${uuidText}` },
    invoke: (client) => client.createPairingChallenge({ body: challengeRequest }),
  },
  {
    operationId: 'getCurrentPairing',
    method: 'GET',
    path: '/v1/pairings/current',
    bearer: true,
    status: 200,
    responseBody: pairing,
    invoke: (client) => client.getCurrentPairing({ token }),
  },
  {
    operationId: 'getHealth',
    method: 'GET',
    path: '/v1/health',
    bearer: false,
    status: 200,
    responseBody: health,
    invoke: (client) => client.getHealth({}),
  },
  {
    operationId: 'getJob',
    method: 'GET',
    path: `/v1/jobs/${uuidText}`,
    bearer: true,
    status: 200,
    responseBody: job,
    invoke: (client) => client.getJob({ id: requestId, token }),
  },
  {
    operationId: 'getJobAudio',
    method: 'GET',
    path: `/v1/jobs/${uuidText}/audio`,
    bearer: true,
    status: 200,
    responseContentType: 'audio/wav',
    responseHeaders: { ETag: '"audio-etag"' },
    invoke: (client) => client.getJobAudio({ id: requestId, token }),
  },
  {
    operationId: 'getRuntime',
    method: 'GET',
    path: '/v1/runtime',
    bearer: true,
    status: 200,
    responseBody: {
      engineId: 'pocket',
      state: 'pack-unverified',
      operational: false,
      reason: 'pack-unverified',
    },
    responseHeaders: { ETag: '"runtime-etag"' },
    invoke: (client) => client.getRuntime({ token }),
  },
  {
    operationId: 'listEngines',
    method: 'GET',
    path: '/v1/engines',
    bearer: true,
    status: 200,
    responseBody: { engines: [engine] },
    responseHeaders: { ETag: '"engine-etag"' },
    invoke: (client) => client.listEngines({ token }),
  },
  {
    operationId: 'listPacks',
    method: 'GET',
    path: '/v1/packs',
    bearer: true,
    status: 200,
    responseBody: { packs: [pack] },
    responseHeaders: { ETag: '"pack-etag"' },
    invoke: (client) => client.listPacks({ token }),
  },
  {
    operationId: 'listVoices',
    method: 'GET',
    path: '/v1/voices',
    bearer: true,
    status: 200,
    responseBody: { voices },
    responseHeaders: { ETag: '"voice-etag"' },
    invoke: (client) => client.listVoices({ token }),
  },
  {
    operationId: 'redeemPairingChallenge',
    method: 'POST',
    path: `/v1/pairings/challenges/${uuidText}/redeem`,
    requestBody: redeemRequest,
    bearer: false,
    status: 200,
    responseBody: { token: tokenText, pairing },
    invoke: (client) => client.redeemPairingChallenge({ id: requestId, body: redeemRequest }),
  },
  {
    operationId: 'requestPackAction',
    method: 'POST',
    path: '/v1/packs/pocket-companion-pack/actions',
    requestBody: packActionRequest,
    bearer: true,
    status: 202,
    responseBody: {
      id: uuidText,
      packId: 'pocket-companion-pack',
      action: 'install',
      state: 'pending-native-decision',
    },
    responseHeaders: { Location: `/v1/pack-actions/${uuidText}` },
    invoke: (client) => client.requestPackAction({ id: packId, body: packActionRequest, token }),
  },
  {
    operationId: 'revokeCurrentPairing',
    method: 'DELETE',
    path: '/v1/pairings/current',
    bearer: true,
    status: 204,
    responseContentType: null,
    nullBody: true,
    invoke: (client) => client.revokeCurrentPairing({ token }),
  },
];

describe('generated companion loopback client', () => {
  it('is a frozen null-prototype object with exactly fourteen enumerable operation functions', () => {
    const fetchImpl: CompanionFetch = async () => {
      throw new Error('not called');
    };
    const client = createCompanionClient(fetchImpl);
    expect(Object.getPrototypeOf(client)).toBeNull();
    expect(Object.isFrozen(client)).toBe(true);
    expect(Object.keys(client)).toEqual(methodNames);
    for (const name of methodNames) {
      expect(Object.prototype.propertyIsEnumerable.call(client, name)).toBe(true);
      expect(client[name]).toBeTypeOf('function');
    }
    expect(client).not.toHaveProperty('request');
    expect(client).not.toHaveProperty('options');
    expect(client).not.toHaveProperty('preflight');
  });

  it('requires an injected fetch and neither construction nor operation-free use performs I/O', () => {
    const globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
    try {
      expect(() => createCompanionClient(undefined as unknown as CompanionFetch)).toThrow(
        TypeError,
      );
      const injected = vi.fn<CompanionFetch>();
      createCompanionClient(injected);
      expect(injected).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('emits the exact literal URL, init, headers, body, and correlated result for all operations', async () => {
    for (const testCase of operationCases) {
      const url = `${COMPANION_API_ORIGIN}${testCase.path}`;
      const response = corsResponse({
        url,
        status: testCase.status,
        json: testCase.responseBody,
        contentType: testCase.responseContentType,
        headers: testCase.responseHeaders,
        nullBody: testCase.nullBody,
        contentLength: testCase.status === 204 ? null : undefined,
      });
      const calls: Array<readonly [string, CompanionRequestInit]> = [];
      const fetchImpl: CompanionFetch = async (input, init) => {
        calls.push([input, init]);
        return response;
      };
      const result = (await testCase.invoke(createCompanionClient(fetchImpl))) as {
        readonly status: number;
        readonly body: unknown;
        readonly headers: {
          readonly requestId: string;
          readonly etag: string | null;
          readonly location: string | null;
          readonly retryAfterSeconds: number | null;
        };
      };

      expect(calls).toHaveLength(1);
      const [input, init] = calls[0]!;
      expect(input).toBe(url);
      expect(init).toMatchObject({
        method: testCase.method,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        targetAddressSpace: 'loopback',
      });
      expect(init.headers).toEqual({
        'X-OVP-Client-Version': COMPANION_CLIENT_VERSION,
        ...(testCase.requestBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(testCase.bearer ? { Authorization: `Bearer ${tokenText}` } : {}),
      });
      expect(init).not.toHaveProperty('signal');
      if (testCase.requestBody === undefined) {
        expect(init).not.toHaveProperty('body');
        expect(init.headers).not.toHaveProperty('Content-Type');
      } else {
        expect(init.body).toBe(JSON.stringify(testCase.requestBody));
      }
      expect(init.headers).not.toHaveProperty('Origin');
      expect(init.method).not.toBe('OPTIONS');

      expect(result.status).toBe(testCase.status);
      if (testCase.responseContentType === 'audio/wav') {
        expect(result.body).toMatchObject({ mediaType: 'audio/wav' });
        expect((result.body as { bytes: Uint8Array }).bytes).toEqual(new Uint8Array());
      } else if (testCase.status === 204) {
        expect(result.body).toBeUndefined();
      } else {
        expect(result.body).toEqual(testCase.responseBody);
      }
      expect(result.headers).toEqual({
        requestId: uuidText,
        etag: testCase.responseHeaders?.ETag ?? null,
        location: testCase.responseHeaders?.Location ?? null,
        retryAfterSeconds: null,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.headers)).toBe(true);
      for (const helper of Object.values(response.highLevel)) expect(helper).not.toHaveBeenCalled();
    }
  });

  it('preserves redeem 202 status/body/header correlation', async () => {
    const url = `${COMPANION_API_ORIGIN}/v1/pairings/challenges/${uuidText}/redeem`;
    const response = corsResponse({
      url,
      status: 202,
      json: { state: 'pending' },
      headers: { 'Retry-After': '7' },
    });
    const client = createCompanionClient(async () => response);
    await expect(
      client.redeemPairingChallenge({ id: requestId, body: redeemRequest }),
    ).resolves.toEqual({
      status: 202,
      body: { state: 'pending' },
      headers: { requestId: uuidText, etag: null, location: null, retryAfterSeconds: 7 },
    });
  });

  it('accepts null-prototype options but rejects every inexact or unsafe options envelope', async () => {
    const response = healthResponse();
    const fetchImpl = vi.fn<CompanionFetch>(async () => response);
    const client = createCompanionClient(fetchImpl);
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    await expect(
      (client.getHealth as unknown as (options: unknown) => Promise<unknown>)(nullPrototype),
    ).resolves.toMatchObject({ status: 200 });

    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'signal', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return undefined;
      },
    });
    const invalidHealthOptions: readonly unknown[] = [
      undefined,
      null,
      [],
      new Date(),
      { signal: undefined },
      { signal: {} },
      {
        signal: new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error('signal-proxy-sentinel');
            },
          },
        ),
      },
      { url: 'http://attacker.invalid/' },
      { baseUrl: COMPANION_API_ORIGIN },
      { method: 'POST' },
      { headers: {} },
      { query: 'x=1' },
      { fragment: 'stolen' },
      { token },
      { [Symbol('private')]: true },
      accessor,
    ];
    for (const options of invalidHealthOptions) {
      await expect(
        (client.getHealth as unknown as (value: unknown) => Promise<unknown>)(options),
      ).rejects.toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);

    const rawGetJob = client.getJob as unknown as (options: unknown) => Promise<unknown>;
    await expect(rawGetJob({ id: requestId })).rejects.toThrow();
    await expect(rawGetJob({ id: 'not-a-uuid', token })).rejects.toThrow();
    await expect(rawGetJob({ id: requestId, token: 'plaintext-secret' })).rejects.toThrow();
    await expect(rawGetJob({ id: requestId, token, extra: true })).rejects.toThrow(TypeError);
    let descriptorCalls = 0;
    const changingProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => Object.prototype,
        ownKeys: () => ['id', 'token'],
        getOwnPropertyDescriptor(_target, name) {
          descriptorCalls += 1;
          if (descriptorCalls > 2) throw new Error('options-proxy-sentinel');
          return {
            configurable: true,
            enumerable: true,
            value: name === 'id' ? requestId : token,
          };
        },
      },
    );
    await expect(rawGetJob(changingProxy)).rejects.toThrow(TypeError);
    const rawCreate = client.createJob as unknown as (options: unknown) => Promise<unknown>;
    await expect(rawCreate({ token })).rejects.toThrow();
    await expect(
      rawCreate({ body: { voiceId: 'pocket:alba', text: 'hello', extra: true }, token }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes the identical signal, gives pre-abort precedence, and preserves fetch rejection identity', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const response = healthResponse();
    const client = createCompanionClient(async (_input, init) => {
      observedSignal = init.signal;
      return response;
    });
    await client.getHealth({ signal: controller.signal });
    expect(observedSignal).toBe(controller.signal);

    const abortReason = { code: 'user-cancelled' };
    const aborted = new AbortController();
    aborted.abort(abortReason);
    const fetchImpl = vi.fn<CompanionFetch>();
    const abortedClient = createCompanionClient(fetchImpl);
    let caught: unknown;
    try {
      await (abortedClient.getJob as unknown as (options: unknown) => Promise<unknown>)({
        id: 'invalid-before-abort-check',
        token: 'invalid-before-abort-check',
        signal: aborted.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(abortReason);
    expect(fetchImpl).not.toHaveBeenCalled();

    const fetchError = new Error('fetch rejection identity');
    const rejectingClient = createCompanionClient(async () => Promise.reject(fetchError));
    caught = undefined;
    try {
      await rejectingClient.getHealth({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(fetchError);
  });

  it('preserves an abort reason that occurs between streamed body reads', async () => {
    const controller = new AbortController();
    const reason = { code: 'mid-stream' };
    const response = healthResponse({
      chunks: [encoder.encode('{'), encoder.encode('}')],
      contentLength: '2',
      onPull(index) {
        if (index === 1) controller.abort(reason);
      },
    });
    const client = createCompanionClient(async () => response);
    let caught: unknown;
    try {
      await client.getHealth({ signal: controller.signal });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(reason);
  });
});

describe('generated client response provenance and error model', () => {
  it.each([
    ['response-type-mismatch', { type: 'default' as ResponseType }],
    ['response-url-mismatch', { url: `${COMPANION_API_ORIGIN}/v1/runtime` }],
    ['redirected-response', { redirected: true }],
  ] as const)(
    'rejects %s before status/body handling and cancels best-effort',
    async (reason, patch) => {
      const response = healthResponse(patch);
      const error = await protocolFailure(healthClient(response).getHealth({}), reason);
      expect(error.status).toBeNull();
      expect(response.cancelSpy).toHaveBeenCalledOnce();
    },
  );

  it('rejects invalid response objects and unknown statuses without using response.ok', async () => {
    const invalidClient = createCompanionClient(async () => null as unknown as Response);
    await protocolFailure(invalidClient.getHealth({}), 'invalid-response');

    for (const status of [199, 600, 200.5]) {
      await protocolFailure(
        healthClient(healthResponse({ status })).getHealth({}),
        'invalid-response',
      );
    }

    const unknown = healthResponse({ status: 418 });
    const error = await protocolFailure(healthClient(unknown).getHealth({}), 'unknown-status');
    expect(error.status).toBe(418);
    expect(unknown.cancelSpy).toHaveBeenCalledOnce();
  });

  it('throws a typed fixed-message HTTP error for a declared non-success response', async () => {
    const response = healthResponse({
      status: 400,
      json: problem('schema-invalid'),
      contentType: 'application/problem+json',
    });
    let caught: unknown;
    try {
      await healthClient(response).getHealth({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompanionHttpError);
    expect(caught).toMatchObject({
      operationId: 'getHealth',
      status: 400,
      problem: problem('schema-invalid'),
      headers: { requestId: uuidText, etag: null, location: null, retryAfterSeconds: null },
    });
    expect((caught as Error).message).not.toContain(tokenText);
    expect((caught as Error).message).not.toContain('The request body');
  });

  it.each([
    ['schema-mismatch', { ...health, x: 0 }],
    ['schema-mismatch', { app: 'wrong', protocolMajor: 1, listenerState: 'listening' }],
  ] as const)('rejects success payloads with %s', async (reason, json) => {
    await protocolFailure(healthClient(healthResponse({ json })).getHealth({}), reason);
  });

  it('rejects malformed Problems, mismatched status, and non-HTTP Problem codes', async () => {
    await protocolFailure(
      healthClient(
        healthResponse({
          status: 400,
          json: { ...problem('schema-invalid'), extra: true },
          contentType: 'application/problem+json',
        }),
      ).getHealth({}),
      'schema-mismatch',
    );
    await protocolFailure(
      healthClient(
        healthResponse({
          status: 400,
          json: problem('rate-limited'),
          contentType: 'application/problem+json',
        }),
      ).getHealth({}),
      'problem-status-mismatch',
    );
    await protocolFailure(
      healthClient(
        healthResponse({
          status: 503,
          json: problem('listener-conflict'),
          contentType: 'application/problem+json',
        }),
      ).getHealth({}),
      'non-http-problem-code',
    );
  });

  it('exposes only safe protocol-error fields and never raw values, bodies, or causes', async () => {
    const rawBodySentinel = 'raw-body-sentinel-must-not-escape';
    const error = await protocolFailure(
      healthClient(
        healthResponse({ rawBytes: encoder.encode(rawBodySentinel), contentLength: null }),
      ).getHealth({}),
      'invalid-json',
    );
    expect(Object.keys(error).sort()).toEqual(['operationId', 'reason', 'status']);
    expect(error).toMatchObject({ operationId: 'getHealth', status: 200 });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain(rawBodySentinel);
    expect(String(error)).not.toContain(tokenText);
  });
});

describe('generated client MIME and observable response headers', () => {
  const acceptedJson = [
    'application/json',
    'APPLICATION/JSON',
    'application/json;charset=utf-8',
    'application/json ; charset = UTF-8',
    'Application/Json\t;\tCharset\t=\t"utf-8"',
  ];
  const rejectedJson = [
    'text/json',
    'application/jſon',
    'application/json; charſet=utf-8',
    'application/json; CHARſET="UTF-8"',
    'application/json, application/json',
    'application/json; charset=utf-8; charset=utf-8',
    'application/json; charset=latin1',
    'application/json; profile=safe',
    'application/json; charset="unterminated',
    'application/json; charset="utf-8" trailing',
    'application/json ',
  ];

  it.each(acceptedJson)('accepts strict JSON MIME value %s', async (contentType) => {
    await expect(
      healthClient(healthResponse({ contentType })).getHealth({}),
    ).resolves.toMatchObject({
      status: 200,
    });
  });

  it.each(rejectedJson)('rejects noncanonical JSON MIME value %s', async (contentType) => {
    await protocolFailure(
      healthClient(healthResponse({ contentType })).getHealth({}),
      'content-type-mismatch',
    );
  });

  it.each(
    acceptedJson.map((value) => value.replace(/application\/json/iu, 'application/problem+json')),
  )('accepts strict Problem MIME value %s', async (contentType) => {
    const response = healthResponse({
      status: 400,
      json: problem('schema-invalid'),
      contentType,
    });
    await expect(healthClient(response).getHealth({})).rejects.toBeInstanceOf(CompanionHttpError);
  });

  it.each(
    rejectedJson.map((value) => value.replace(/application\/json/gi, 'application/problem+json')),
  )('rejects noncanonical Problem MIME value %s', async (contentType) => {
    await protocolFailure(
      healthClient(
        healthResponse({ status: 400, json: problem('schema-invalid'), contentType }),
      ).getHealth({}),
      'content-type-mismatch',
    );
  });

  it.each([
    ['missing no-store', { 'Cache-Control': '' }],
    ['wrong no-store', { 'Cache-Control': 'private' }],
    ['missing request ID', { 'X-Request-Id': '' }],
    ['malformed request ID', { 'X-Request-Id': uuidText.toUpperCase() }],
  ])('rejects %s', async (_name, headers) => {
    await protocolFailure(
      healthClient(healthResponse({ headers })).getHealth({}),
      'invalid-response-header',
    );
  });

  it('requires and prohibits ETag and Location exactly where declared', async () => {
    const runtimeUrl = `${COMPANION_API_ORIGIN}/v1/runtime`;
    const runtimeBody = {
      engineId: 'pocket',
      state: 'pack-unverified',
      operational: false,
      reason: 'pack-unverified',
    };
    const missingEtag = corsResponse({ url: runtimeUrl, status: 200, json: runtimeBody });
    await protocolFailure(
      createCompanionClient(async () => missingEtag).getRuntime({ token }),
      'invalid-response-header',
    );
    await protocolFailure(
      healthClient(healthResponse({ headers: { ETag: '"forbidden"' } })).getHealth({}),
      'invalid-response-header',
    );
    await protocolFailure(
      healthClient(healthResponse({ headers: { Location: '/forbidden' } })).getHealth({}),
      'invalid-response-header',
    );

    const createUrl = `${COMPANION_API_ORIGIN}/v1/jobs`;
    const missingLocation = corsResponse({ url: createUrl, status: 202, json: job });
    await protocolFailure(
      createCompanionClient(async () => missingLocation).createJob({ body: jobRequest, token }),
      'invalid-response-header',
    );
    const shortEtag = corsResponse({
      url: runtimeUrl,
      status: 200,
      json: runtimeBody,
      headers: { ETag: 'xx' },
    });
    await protocolFailure(
      createCompanionClient(async () => shortEtag).getRuntime({ token }),
      'invalid-response-header',
    );
  });

  it('enforces Retry-After for 429, redeem 202, and queue-full 503 only', async () => {
    const rateLimited = healthResponse({
      status: 429,
      json: problem('rate-limited'),
      contentType: 'application/problem+json',
    });
    await protocolFailure(healthClient(rateLimited).getHealth({}), 'invalid-response-header');

    for (const retryAfter of ['0', '01', '3601', '1, 2', '+1', ' 1']) {
      const response = healthResponse({
        status: 429,
        json: problem('rate-limited'),
        contentType: 'application/problem+json',
        headers: { 'Retry-After': retryAfter },
      });
      await protocolFailure(healthClient(response).getHealth({}), 'invalid-response-header');
    }

    const queueWithoutRetry = healthResponse({
      status: 503,
      json: problem('queue-full'),
      contentType: 'application/problem+json',
    });
    await protocolFailure(healthClient(queueWithoutRetry).getHealth({}), 'invalid-response-header');
    const nonQueueWithRetry = healthResponse({
      status: 503,
      json: problem('runtime-unavailable'),
      contentType: 'application/problem+json',
      headers: { 'Retry-After': '2' },
    });
    await protocolFailure(healthClient(nonQueueWithRetry).getHealth({}), 'invalid-response-header');
    const queue = healthResponse({
      status: 503,
      json: problem('queue-full'),
      contentType: 'application/problem+json',
      headers: { 'Retry-After': '3600' },
    });
    let caught: unknown;
    try {
      await healthClient(queue).getHealth({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CompanionHttpError);
    expect(caught).toMatchObject({ headers: { retryAfterSeconds: 3600 } });
  });
});

describe('generated client bounded streaming bodies', () => {
  it.each(['', '-1', '+1', '01', '1.0', '1, 2', String(Number.MAX_SAFE_INTEGER + 1)])(
    'rejects invalid Content-Length %s',
    async (contentLength) => {
      await protocolFailure(
        healthClient(healthResponse({ contentLength })).getHealth({}),
        'invalid-content-length',
      );
    },
  );

  it('rejects Content-Length above the schema cap before body parsing', async () => {
    const response = healthResponse({ rawBytes: encoder.encode('{'), contentLength: '85' });
    await protocolFailure(healthClient(response).getHealth({}), 'body-too-large');
  });

  it('detects truncated and extra streamed bytes against Content-Length', async () => {
    const bytes = encoder.encode(JSON.stringify(health));
    await protocolFailure(
      healthClient(
        healthResponse({ rawBytes: bytes, contentLength: String(bytes.length + 1) }),
      ).getHealth({}),
      'content-length-mismatch',
    );
    await protocolFailure(
      healthClient(
        healthResponse({ rawBytes: bytes, contentLength: String(bytes.length - 1) }),
      ).getHealth({}),
      'content-length-mismatch',
    );
  });

  it('applies the JSON cap before parse and rejects fatal UTF-8 and a UTF-8 BOM', async () => {
    await protocolFailure(
      healthClient(
        healthResponse({ rawBytes: encoder.encode('x'.repeat(85)), contentLength: null }),
      ).getHealth({}),
      'body-too-large',
    );
    await protocolFailure(
      healthClient(
        healthResponse({ rawBytes: new Uint8Array([0xff]), contentLength: null }),
      ).getHealth({}),
      'invalid-utf8',
    );
    await protocolFailure(
      healthClient(
        healthResponse({
          rawBytes: new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(JSON.stringify(health))]),
          contentLength: null,
        }),
      ).getHealth({}),
      'invalid-utf8',
    );
  });

  it('drains 204 responses with a zero-byte cap and rejects every visible byte', async () => {
    const url = `${COMPANION_API_ORIGIN}/v1/pairings/current`;
    for (const contentLength of [null, '0']) {
      const response = corsResponse({
        url,
        status: 204,
        rawBytes: new Uint8Array([1]),
        contentType: null,
        contentLength,
      });
      await protocolFailure(
        createCompanionClient(async () => response).revokeCurrentPairing({ token }),
        'unexpected-body',
      );
    }
    const lyingLength = corsResponse({
      url,
      status: 204,
      rawBytes: new Uint8Array(),
      contentType: null,
      contentLength: '1',
    });
    await protocolFailure(
      createCompanionClient(async () => lyingLength).revokeCurrentPairing({ token }),
      'invalid-content-length',
    );
    const typed204 = corsResponse({
      url,
      status: 204,
      rawBytes: new Uint8Array(),
      contentType: 'application/json',
      contentLength: '0',
    });
    await protocolFailure(
      createCompanionClient(async () => typed204).revokeCurrentPairing({ token }),
      'content-type-mismatch',
    );
  });

  it.each(['audio/wav', 'AUDIO/WAV'])(
    'accepts WAV essence %s without parameters',
    async (contentType) => {
      const url = `${COMPANION_API_ORIGIN}/v1/jobs/${uuidText}/audio`;
      const bytes = new Uint8Array([1, 2, 3]);
      const response = corsResponse({
        url,
        status: 200,
        rawBytes: bytes,
        contentType,
        headers: { ETag: '"wav"' },
      });
      await expect(
        createCompanionClient(async () => response).getJobAudio({ id: requestId, token }),
      ).resolves.toMatchObject({ status: 200, body: { mediaType: 'audio/wav', bytes } });
    },
  );

  it.each(['audio/wav; charset=utf-8', 'audio/wav, audio/wav', 'audio/x-wav', 'audio/wav '])(
    'rejects WAV MIME value %s',
    async (contentType) => {
      const url = `${COMPANION_API_ORIGIN}/v1/jobs/${uuidText}/audio`;
      const response = corsResponse({
        url,
        status: 200,
        rawBytes: new Uint8Array(),
        contentType,
        headers: { ETag: '"wav"' },
      });
      await protocolFailure(
        createCompanionClient(async () => response).getJobAudio({ id: requestId, token }),
        'content-type-mismatch',
      );
    },
  );

  it('accepts the inclusive WAV cap with and without Content-Length using repeated small chunks', async () => {
    const url = `${COMPANION_API_ORIGIN}/v1/jobs/${uuidText}/audio`;
    const cap = 67_108_864;
    for (const contentLength of [String(cap), null]) {
      const response = corsResponse({
        url,
        status: 200,
        rawBytes: new Uint8Array(),
        chunks: repeatedChunks(1024, 65_536),
        contentType: 'audio/wav',
        contentLength,
        headers: { ETag: '"wav-boundary"' },
      });
      const result = await createCompanionClient(async () => response).getJobAudio({
        id: requestId,
        token,
      });
      expect(result.body.bytes.byteLength).toBe(cap);
    }
  }, 30_000);

  it('rejects WAV bodies over the inclusive cap using repeated small chunks', async () => {
    const url = `${COMPANION_API_ORIGIN}/v1/jobs/${uuidText}/audio`;
    const response = corsResponse({
      url,
      status: 200,
      rawBytes: new Uint8Array(),
      chunks: repeatedChunks(1025, 65_536),
      contentType: 'audio/wav',
      contentLength: null,
      headers: { ETag: '"wav-overflow"' },
    });
    await protocolFailure(
      createCompanionClient(async () => response).getJobAudio({ id: requestId, token }),
      'body-too-large',
    );
  });

  it('wraps non-abort stream failures without a raw cause and never calls high-level body helpers', async () => {
    const rawSentinel = 'raw-stream-error-sentinel';
    const response = healthResponse();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(rawSentinel);
      },
    });
    Object.defineProperty(response, 'body', { value: body });
    const error = await protocolFailure(healthClient(response).getHealth({}), 'body-unreadable');
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toContain(rawSentinel);
    for (const helper of Object.values(response.highLevel)) expect(helper).not.toHaveBeenCalled();
  });

  it('wraps adversarial reader-result accessors without executing a raw exception path', async () => {
    const rawSentinel = 'reader-result-accessor-sentinel';
    const response = healthResponse();
    const result = Object.defineProperty({}, 'done', {
      get() {
        throw new Error(rawSentinel);
      },
    });
    const reader = {
      read: vi.fn(async () => result),
      cancel: vi.fn(async () => undefined),
    };
    Object.defineProperty(response, 'body', {
      value: { getReader: () => reader },
    });
    const error = await protocolFailure(healthClient(response).getHealth({}), 'body-unreadable');
    expect(String(error)).not.toContain(rawSentinel);
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'byteLength measurement',
      (rawSentinel: string): Uint8Array =>
        Object.defineProperty(new Uint8Array([1]), 'byteLength', {
          get() {
            throw new Error(rawSentinel);
          },
        }),
      'invalid-json',
      0,
    ],
    [
      'concatenation',
      (_rawSentinel: string): Uint8Array => {
        const detached = new Uint8Array([1]);
        structuredClone(detached.buffer, { transfer: [detached.buffer] });
        return detached;
      },
      'body-unreadable',
      1,
    ],
  ] as const)(
    'handles hostile Uint8Array %s without leaking raw failures',
    async (_label, chunk, reason, cancellations) => {
      const rawSentinel = 'hostile-chunk-sentinel';
      const response = healthResponse({ contentLength: null });
      let reads = 0;
      const reader = {
        read: vi.fn(async () =>
          reads++ === 0
            ? { done: false, value: chunk(rawSentinel) }
            : { done: true, value: undefined },
        ),
        cancel: vi.fn(async () => undefined),
      };
      Object.defineProperty(response, 'body', { value: { getReader: () => reader } });

      const error = await protocolFailure(healthClient(response).getHealth({}), reason);
      expect(String(error)).not.toContain(rawSentinel);
      expect(error).not.toHaveProperty('cause');
      expect(reader.cancel).toHaveBeenCalledTimes(cancellations);
    },
  );

  it.each([
    ['declared length', 1, (length: number) => String(length), 'content-length-mismatch'],
    ['derived cap', 9, () => null, 'body-too-large'],
  ] as const)(
    'does not let forged chunk lengths bypass the %s',
    async (_label, hiddenBytes, declared, reason) => {
      const validHealth = encoder.encode(JSON.stringify(health));
      const hiddenPrefix = Object.defineProperty(
        new Uint8Array(hiddenBytes).fill(0x58),
        'byteLength',
        {
          value: 0,
        },
      );
      const response = healthResponse({
        rawBytes: new Uint8Array(),
        chunks: [hiddenPrefix, validHealth],
        contentLength: declared(validHealth.byteLength),
      });

      await protocolFailure(healthClient(response).getHealth({}), reason);
    },
  );

  it('rejects an oversized measured chunk before allocating or copying retained bytes', async () => {
    const response = healthResponse({
      rawBytes: new Uint8Array(),
      chunks: [new Uint8Array(85)],
      contentLength: null,
    });
    const originalUint8Array = globalThis.Uint8Array;
    let retainedAllocations = 0;
    const observedUint8Array = new Proxy(originalUint8Array, {
      construct(target, argumentsList, newTarget) {
        retainedAllocations += 1;
        return Reflect.construct(target, argumentsList, newTarget);
      },
    });
    globalThis.Uint8Array = observedUint8Array;
    try {
      await protocolFailure(healthClient(response).getHealth({}), 'body-too-large');
    } finally {
      globalThis.Uint8Array = originalUint8Array;
    }
    expect(retainedAllocations).toBe(0);
  });

  it('preserves abort precedence when hostile chunk validation triggers an abort', async () => {
    const controller = new AbortController();
    const abortReason = { code: 'hostile-copy-abort' };
    const response = healthResponse({ contentLength: null });
    const chunk = new Proxy(new Uint8Array([1]), {
      getPrototypeOf() {
        controller.abort(abortReason);
        throw new Error('hostile-chunk-raw-sentinel');
      },
    });
    let reads = 0;
    const reader = {
      read: vi.fn(async () =>
        reads++ === 0 ? { done: false, value: chunk } : { done: true, value: undefined },
      ),
      cancel: vi.fn(async () => undefined),
    };
    Object.defineProperty(response, 'body', { value: { getReader: () => reader } });

    let caught: unknown;
    try {
      await healthClient(response).getHealth({ signal: controller.signal });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(abortReason);
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it('preserves abort identity when the signal aborts at the EOF await boundary', async () => {
    const controller = new AbortController();
    const abortReason = { code: 'eof-boundary-abort' };
    const cancelSpy = vi.fn();
    const response = corsResponse({
      url: `${COMPANION_API_ORIGIN}/v1/jobs/${uuidText}/audio`,
      status: 200,
      rawBytes: new Uint8Array(),
      contentType: 'audio/wav',
      contentLength: '0',
      headers: { ETag: '"eof-abort"' },
    });
    let bodyAccesses = 0;
    Object.defineProperty(response, 'body', {
      get() {
        bodyAccesses += 1;
        if (bodyAccesses === 1) {
          return new ReadableStream<Uint8Array>({
            pull(streamController) {
              streamController.close();
              queueMicrotask(() => controller.abort(abortReason));
            },
          });
        }
        return new ReadableStream<Uint8Array>({ cancel: cancelSpy });
      },
    });

    let caught: unknown;
    try {
      await createCompanionClient(async () => response).getJobAudio({
        id: requestId,
        token,
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(abortReason);
    expect(cancelSpy).toHaveBeenCalledOnce();
  });
});
