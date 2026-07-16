const concreteMethodOrder = ['GET', 'POST', 'DELETE'];
const conditionValues = new Set([
  'validated-origin',
  'legacy-private-network-requested',
  'queue-full-problem',
]);

const operationSpecs = [
  [
    'getHealth',
    '/v1/health',
    'GET',
    [200, 400, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'origin-only',
    null,
    'none',
    null,
    null,
  ],
  [
    'createPairingChallenge',
    '/v1/pairings/challenges',
    'POST',
    [201, 400, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504],
    'origin-only',
    null,
    'none',
    'PairingChallengeRequest',
    null,
  ],
  [
    'redeemPairingChallenge',
    '/v1/pairings/challenges/{id}/redeem',
    'POST',
    [200, 202, 400, 403, 404, 405, 408, 409, 410, 413, 414, 415, 426, 429, 431, 503, 504],
    'origin-only',
    null,
    'none',
    'RedeemRequest',
    'CanonicalUuid',
  ],
  [
    'getCurrentPairing',
    '/v1/pairings/current',
    'GET',
    [200, 400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    null,
    'token-self',
    null,
    null,
  ],
  [
    'revokeCurrentPairing',
    '/v1/pairings/current',
    'DELETE',
    [204, 400, 401, 403, 405, 408, 413, 414, 426, 431, 503, 504],
    'bearer',
    null,
    'token-self',
    null,
    null,
  ],
  [
    'getRuntime',
    '/v1/runtime',
    'GET',
    [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'runtime:read',
    'none',
    null,
    null,
  ],
  [
    'listEngines',
    '/v1/engines',
    'GET',
    [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'runtime:read',
    'none',
    null,
    null,
  ],
  [
    'listVoices',
    '/v1/voices',
    'GET',
    [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'runtime:read',
    'none',
    null,
    null,
  ],
  [
    'listPacks',
    '/v1/packs',
    'GET',
    [200, 400, 401, 403, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'runtime:read',
    'none',
    null,
    null,
  ],
  [
    'createJob',
    '/v1/jobs',
    'POST',
    [202, 400, 401, 403, 405, 408, 413, 414, 415, 426, 429, 431, 503, 504],
    'bearer',
    'synthesis:create',
    'none',
    'JobCreateRequest',
    null,
  ],
  [
    'getJob',
    '/v1/jobs/{id}',
    'GET',
    [200, 400, 401, 403, 404, 405, 408, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'jobs:read',
    'job-owner',
    null,
    'CanonicalUuid',
  ],
  [
    'cancelJob',
    '/v1/jobs/{id}',
    'DELETE',
    [202, 400, 401, 403, 404, 405, 408, 413, 414, 426, 431, 503, 504],
    'bearer',
    'jobs:cancel',
    'job-owner',
    null,
    'CanonicalUuid',
  ],
  [
    'getJobAudio',
    '/v1/jobs/{id}/audio',
    'GET',
    [200, 400, 401, 403, 404, 405, 408, 409, 410, 413, 414, 426, 429, 431, 503, 504],
    'bearer',
    'audio:read',
    'job-owner',
    null,
    'CanonicalUuid',
  ],
  [
    'requestPackAction',
    '/v1/packs/{id}/actions',
    'POST',
    [202, 400, 401, 403, 404, 405, 408, 409, 413, 414, 415, 426, 429, 431, 503, 504],
    'bearer',
    'packs:request',
    'none',
    'PackActionRequest',
    'PackId',
  ],
].map(([id, path, method, statuses, auth, scope, ownership, bodySchema, pathSchema]) => ({
  id,
  path,
  method,
  statuses,
  access: { auth, scope, ownership },
  bodySchema,
  pathSchema,
}));

const preflightIds = {
  '/v1/health': 'preflightHealth',
  '/v1/pairings/challenges': 'preflightPairingChallenges',
  '/v1/pairings/challenges/{id}/redeem': 'preflightPairingChallengeRedeem',
  '/v1/pairings/current': 'preflightCurrentPairing',
  '/v1/runtime': 'preflightRuntime',
  '/v1/engines': 'preflightEngines',
  '/v1/voices': 'preflightVoices',
  '/v1/packs': 'preflightPacks',
  '/v1/jobs': 'preflightJobs',
  '/v1/jobs/{id}': 'preflightJob',
  '/v1/jobs/{id}/audio': 'preflightJobAudio',
  '/v1/packs/{id}/actions': 'preflightPackActions',
};

const expectedProblemCodes = [
  'host-invalid',
  'origin-missing',
  'origin-denied',
  'version-missing',
  'version-unsupported',
  'auth-missing',
  'auth-invalid',
  'auth-origin-mismatch',
  'scope-denied',
  'rate-limited',
  'request-line-too-large',
  'headers-too-large',
  'body-too-large',
  'body-timeout',
  'header-timeout',
  'schema-invalid',
  'queue-full',
  'ownership-denied',
  'resource-not-found',
  'conflict',
  'handler-timeout',
  'listener-conflict',
  'pairing-not-found',
  'pairing-denied',
  'pairing-expired',
  'pairing-consumed',
  'pairing-attempts-exhausted',
  'pack-unverified',
  'runtime-unavailable',
  'method-not-allowed',
  'content-type-unsupported',
  'transfer-encoding-invalid',
  'duplicate-header',
  'text-invalid',
  'action-invalid',
];

const expectedServers = [{ url: 'http://127.0.0.1:17843' }];
const expectedSecuritySchemes = {
  bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'OVP-43' },
};
const componentKeys = ['securitySchemes', 'parameters', 'headers', 'responses', 'schemas'];

const expectedSourcePolicy = {
  version: 1,
  allowedOriginSource: 'compiled-exact-allowlist',
  credentials: 'prohibited',
  actual: {
    allowOrigin: 'validated-origin',
    exposeHeaders: ['ETag', 'Location', 'Retry-After', 'X-Request-Id'],
    vary: ['Origin'],
  },
  preflight: {
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-OVP-Client-Version'],
    maxAgeSeconds: 600,
    requestedHeaderComparison: 'ascii-case-insensitive-exact-set',
    requiresDeclaredConcreteTarget: true,
    rejectsBody: true,
    rejectsCredentials: true,
    rejectsOptionsTarget: true,
    failureMap: {
      'admission-overload': { status: 503, code: 'queue-full' },
      'denied-origin': { status: 403, code: 'origin-denied' },
      'duplicate-preflight-header': { status: 400, code: 'duplicate-header' },
      'header-timeout': { status: 408, code: 'header-timeout' },
      'headers-too-large': { status: 431, code: 'headers-too-large' },
      'invalid-preflight-shape': { status: 400, code: 'schema-invalid' },
      'missing-origin': { status: 400, code: 'origin-missing' },
      'oversize-body': { status: 413, code: 'body-too-large' },
      'request-line-too-large': { status: 414, code: 'request-line-too-large' },
      'unsupported-route-method': { status: 405, code: 'method-not-allowed' },
    },
    legacyPrivateNetwork: {
      requestHeader: 'Access-Control-Request-Private-Network',
      requestValue: 'true',
      responseHeader: 'Access-Control-Allow-Private-Network',
      responseValue: 'true',
      varyToken: 'Access-Control-Request-Private-Network',
      emitIffRequested: true,
    },
  },
  unknownRoute: { status: 404, code: 'resource-not-found' },
  retryAfter: {
    kind: 'delay-seconds',
    minimum: 1,
    maximum: 3600,
    httpDateAllowed: false,
    queueFullProblemCode: 'queue-full',
    queueFullResponseCondition: 'queue-full-problem',
  },
  problemCodes: {
    http: [
      'host-invalid',
      'origin-missing',
      'origin-denied',
      'version-missing',
      'version-unsupported',
      'auth-missing',
      'auth-invalid',
      'auth-origin-mismatch',
      'scope-denied',
      'rate-limited',
      'request-line-too-large',
      'headers-too-large',
      'body-too-large',
      'body-timeout',
      'header-timeout',
      'schema-invalid',
      'queue-full',
      'ownership-denied',
      'resource-not-found',
      'conflict',
      'handler-timeout',
      'pairing-not-found',
      'pairing-denied',
      'pairing-expired',
      'pairing-consumed',
      'pairing-attempts-exhausted',
      'pack-unverified',
      'runtime-unavailable',
      'method-not-allowed',
      'content-type-unsupported',
      'transfer-encoding-invalid',
      'duplicate-header',
      'text-invalid',
      'action-invalid',
    ],
    nonHttp: ['listener-conflict'],
  },
  accessByOperation: Object.fromEntries(operationSpecs.map((spec) => [spec.id, spec.access])),
};

function fail(message) {
  throw new Error(`HTTP contract generation failed: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
  }
  return value;
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
}

function sortedRecord(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => compareCodeUnits(left, right)));
}

function jsonEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftEntries = sortedEntries(left);
    const rightEntries = sortedEntries(right);
    return (
      leftEntries.length === rightEntries.length &&
      leftEntries.every(
        ([key, value], index) =>
          rightEntries[index]?.[0] === key && jsonEqual(value, rightEntries[index]?.[1]),
      )
    );
  }
  return false;
}

function assertKeys(value, keys, path) {
  if (
    !isObject(value) ||
    !jsonEqual(Object.keys(value).sort(compareCodeUnits), [...keys].sort(compareCodeUnits))
  ) {
    fail(`${path} has an unsupported shape.`);
  }
}

function assertSourceClosure(document) {
  if (Object.prototype.hasOwnProperty.call(document, 'webhooks')) {
    fail('root webhooks are not owned by the HTTP contract.');
  }
  if (!jsonEqual(document.servers, expectedServers)) {
    fail('root servers do not match the exact loopback authority.');
  }
  assertKeys(document.components, componentKeys, 'components');
  for (const key of componentKeys) {
    if (!isObject(document.components[key])) fail(`components.${key} must be an object.`);
  }
  if (!jsonEqual(document.components.securitySchemes, expectedSecuritySchemes)) {
    fail('components.securitySchemes does not match the exact bearer scheme.');
  }
}

function canonicalRefName(reference, namespace, document, path) {
  const prefix = `#/components/${namespace}/`;
  if (typeof reference !== 'string' || !reference.startsWith(prefix)) {
    fail(`${path} has a wrong-kind or external reference.`);
  }
  const name = reference.slice(prefix.length);
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name) || reference !== `${prefix}${name}`) {
    fail(`${path} has a noncanonical reference.`);
  }
  const namespaceObject = document.components?.[namespace];
  if (!isObject(namespaceObject) || !Object.prototype.hasOwnProperty.call(namespaceObject, name)) {
    fail(`${path} has a dangling reference.`);
  }
  return name;
}

function resolveComponent(document, candidate, namespace, path, stack = []) {
  if (!isObject(candidate)) fail(`${path} is not an object.`);
  if (!Object.prototype.hasOwnProperty.call(candidate, '$ref')) return candidate;
  assertKeys(candidate, ['$ref'], path);
  const name = canonicalRefName(candidate.$ref, namespace, document, `${path}.$ref`);
  const reference = `#/components/${namespace}/${name}`;
  if (stack.includes(reference)) fail(`${path} contains a reference cycle.`);
  if (stack.length >= 16) fail(`${path} exceeds the reference depth limit.`);
  return resolveComponent(
    document,
    document.components[namespace][name],
    namespace,
    `components.${namespace}.${name}`,
    [...stack, reference],
  );
}

function schemaRef(candidate, document, path) {
  assertKeys(candidate, ['$ref'], path);
  return canonicalRefName(candidate.$ref, 'schemas', document, `${path}.$ref`);
}

function normalizeHeaderSchema(candidate, document, path) {
  if (!isObject(candidate)) fail(`${path} is not a Header schema.`);
  if ('$ref' in candidate)
    return { kind: 'schema-ref', schemaRef: schemaRef(candidate, document, path) };
  if ('const' in candidate) {
    assertKeys(candidate, ['type', 'const'], path);
    if (!['string', 'integer'].includes(candidate.type)) fail(`${path} has an invalid const type.`);
    if (candidate.type === 'string' && typeof candidate.const !== 'string')
      fail(`${path} has an invalid string const.`);
    if (candidate.type === 'integer' && !Number.isSafeInteger(candidate.const))
      fail(`${path} has an invalid integer const.`);
    return { kind: 'const', type: candidate.type, value: candidate.const };
  }
  if ('enum' in candidate) {
    assertKeys(candidate, ['type', 'enum'], path);
    if (
      !['string', 'integer'].includes(candidate.type) ||
      !Array.isArray(candidate.enum) ||
      candidate.enum.length === 0
    ) {
      fail(`${path} has an invalid enum.`);
    }
    if (
      !candidate.enum.every((value) =>
        candidate.type === 'string' ? typeof value === 'string' : Number.isSafeInteger(value),
      )
    ) {
      fail(`${path} has an enum/type mismatch.`);
    }
    return { kind: 'enum', type: candidate.type, values: [...candidate.enum] };
  }
  if (candidate.type === 'string') {
    assertKeys(candidate, ['type', 'minLength', 'maxLength'], path);
    if (
      !Number.isSafeInteger(candidate.minLength) ||
      !Number.isSafeInteger(candidate.maxLength) ||
      candidate.minLength < 0 ||
      candidate.maxLength < candidate.minLength
    ) {
      fail(`${path} has invalid string bounds.`);
    }
    return {
      kind: 'bounded-string',
      minLength: candidate.minLength,
      maxLength: candidate.maxLength,
    };
  }
  if (candidate.type === 'integer') {
    assertKeys(candidate, ['type', 'minimum', 'maximum'], path);
    if (
      !Number.isSafeInteger(candidate.minimum) ||
      !Number.isSafeInteger(candidate.maximum) ||
      candidate.maximum < candidate.minimum
    ) {
      fail(`${path} has invalid integer bounds.`);
    }
    return { kind: 'bounded-integer', minimum: candidate.minimum, maximum: candidate.maximum };
  }
  fail(`${path} is not a complete supported Header schema.`);
}

function normalizeParameter(document, candidate, path) {
  const parameter = resolveComponent(document, candidate, 'parameters', path);
  assertKeys(parameter, ['name', 'in', 'required', 'schema'], path);
  if (
    typeof parameter.name !== 'string' ||
    !['header', 'path'].includes(parameter.in) ||
    typeof parameter.required !== 'boolean'
  ) {
    fail(`${path} has invalid Parameter metadata.`);
  }
  if (parameter.in === 'path') {
    if (parameter.required !== true) fail(`${path} path parameter must be required.`);
    return {
      kind: 'path',
      name: parameter.name,
      required: true,
      schemaRef: schemaRef(parameter.schema, document, `${path}.schema`),
    };
  }
  return {
    kind: 'header',
    name: parameter.name,
    required: parameter.required,
    schema: normalizeHeaderSchema(parameter.schema, document, `${path}.schema`),
  };
}

function normalizeResponseHeader(document, name, candidate, path) {
  const header = resolveComponent(document, candidate, 'headers', path);
  const condition = header['x-ovp-condition'];
  const keys =
    condition === undefined ? ['required', 'schema'] : ['required', 'schema', 'x-ovp-condition'];
  assertKeys(header, keys, path);
  if (typeof header.required !== 'boolean') fail(`${path}.required must be a boolean.`);
  if (condition === undefined && header.required !== true)
    fail(`${path} is optional without a condition.`);
  if (condition !== undefined && (header.required !== false || !conditionValues.has(condition))) {
    fail(`${path} has an invalid conditional Header.`);
  }
  return {
    name,
    required: header.required,
    schema: normalizeHeaderSchema(header.schema, document, `${path}.schema`),
    condition: condition ?? null,
  };
}

function normalizeBody(document, response, path) {
  if (response.content === undefined) return { kind: 'empty' };
  if (!isObject(response.content) || Object.keys(response.content).length !== 1)
    fail(`${path}.content must have one media type.`);
  const [mediaType, media] = Object.entries(response.content)[0];
  if (!isObject(media)) fail(`${path}.content.${mediaType} is invalid.`);
  if (mediaType === 'audio/wav') {
    assertKeys(media, ['x-maxBodyBytes'], `${path}.content.${mediaType}`);
    if (media['x-maxBodyBytes'] !== 67_108_864) fail(`${path} has an invalid audio boundary.`);
    return { kind: 'audio', mediaType, maxBytes: media['x-maxBodyBytes'] };
  }
  if (!['application/json', 'application/problem+json'].includes(mediaType))
    fail(`${path} has an unsupported media type.`);
  assertKeys(media, ['schema'], `${path}.content.${mediaType}`);
  return {
    kind: 'json',
    mediaType,
    schemaRef: schemaRef(media.schema, document, `${path}.content.${mediaType}.schema`),
  };
}

function normalizeResponse(document, candidate, status, path) {
  const response = resolveComponent(document, candidate, 'responses', path);
  const allowedKeys =
    response.content === undefined
      ? ['description', 'headers']
      : ['description', 'headers', 'content'];
  assertKeys(response, allowedKeys, path);
  if (typeof response.description !== 'string' || !isObject(response.headers))
    fail(`${path} lacks a description or headers.`);
  const headers = sortedEntries(response.headers).map(([name, value]) =>
    normalizeResponseHeader(document, name, value, `${path}.headers.${name}`),
  );
  return { status, body: normalizeBody(document, response, path), headers };
}

function normalizeResponses(document, responses, path) {
  if (!isObject(responses) || Object.keys(responses).length === 0)
    fail(`${path} has no responses.`);
  return Object.entries(responses)
    .map(([key, response]) => {
      if (!/^[1-5][0-9]{2}$/u.test(key))
        fail(`${path} contains default, range, or invalid response ${key}.`);
      return normalizeResponse(document, response, Number(key), `${path}.${key}`);
    })
    .sort((left, right) => left.status - right.status);
}

function normalizeRequestBody(document, candidate, path) {
  if (candidate === undefined) return { kind: 'none' };
  assertKeys(candidate, ['required', 'content'], path);
  if (
    candidate.required !== true ||
    !isObject(candidate.content) ||
    !jsonEqual(Object.keys(candidate.content), ['application/json'])
  ) {
    fail(`${path} must be one required JSON body.`);
  }
  const media = candidate.content['application/json'];
  assertKeys(media, ['schema'], `${path}.content.application/json`);
  return {
    kind: 'json',
    required: true,
    mediaType: 'application/json',
    schemaRef: schemaRef(media.schema, document, `${path}.content.application/json.schema`),
  };
}

function assertOperationSourceKeys(operation, hasRequestBody, path) {
  assertKeys(
    operation,
    [
      'operationId',
      'tags',
      'security',
      'parameters',
      'responses',
      ...(hasRequestBody ? ['requestBody'] : []),
    ],
    path,
  );
}

function assertSecurity(operation, access, path) {
  if (!Object.prototype.hasOwnProperty.call(operation, 'security'))
    fail(`${path} must declare security explicitly.`);
  const expected = access.auth === 'bearer' ? [{ bearerAuth: [] }] : [];
  if (!jsonEqual(operation.security, expected)) fail(`${path} has invalid security.`);
}

function operationParameters(document, pathItem, operation, path) {
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
  if (!Array.isArray(pathItem.parameters ?? []) || !Array.isArray(operation.parameters ?? []))
    fail(`${path} parameters are invalid.`);
  const normalized = parameters.map((parameter, index) =>
    normalizeParameter(document, parameter, `${path}.parameters[${index}]`),
  );
  const seen = new Set();
  for (const parameter of normalized) {
    const key = `${parameter.kind}:${parameter.name}`;
    if (seen.has(key)) fail(`${path} duplicates parameter ${parameter.name}.`);
    seen.add(key);
  }
  return normalized;
}

function requestedHeaders(operation, access, requestBody, requestHeaders) {
  const headers = [];
  if (access.auth === 'bearer') headers.push('Authorization');
  if (requestBody.kind === 'json') headers.push('Content-Type');
  if (requestHeaders.some((header) => header.name === 'X-OVP-Client-Version'))
    headers.push('X-OVP-Client-Version');
  return headers;
}

function normalizePolicy(document) {
  const policy = document['x-ovp-http-policy'];
  if (!jsonEqual(policy, expectedSourcePolicy))
    fail('x-ovp-http-policy does not match the closed policy.');
  const problemCodes = document.components?.schemas?.ProblemCode?.enum;
  if (!Array.isArray(problemCodes)) fail('ProblemCode enum is missing.');
  const { http, nonHttp } = policy.problemCodes;
  if (
    !jsonEqual(problemCodes, expectedProblemCodes) ||
    !jsonEqual(
      problemCodes.filter((code) => http.includes(code)),
      http,
    ) ||
    !jsonEqual(
      problemCodes.filter((code) => nonHttp.includes(code)),
      nonHttp,
    ) ||
    problemCodes.some((code) => Number(http.includes(code)) + Number(nonHttp.includes(code)) !== 1)
  ) {
    fail('problem code HTTP partition is not exact, ordered, disjoint, and exhaustive.');
  }
  return {
    version: policy.version,
    allowedOriginSource: policy.allowedOriginSource,
    credentials: policy.credentials,
    actual: {
      allowOrigin: policy.actual.allowOrigin,
      exposeHeaders: [...policy.actual.exposeHeaders],
      vary: [...policy.actual.vary],
    },
    preflight: {
      allowMethods: [...policy.preflight.allowMethods],
      allowHeaders: [...policy.preflight.allowHeaders],
      maxAgeSeconds: policy.preflight.maxAgeSeconds,
      requestedHeaderComparison: policy.preflight.requestedHeaderComparison,
      requiresDeclaredConcreteTarget: policy.preflight.requiresDeclaredConcreteTarget,
      rejectsBody: policy.preflight.rejectsBody,
      rejectsCredentials: policy.preflight.rejectsCredentials,
      rejectsOptionsTarget: policy.preflight.rejectsOptionsTarget,
      failureMap: sortedRecord(
        Object.entries(policy.preflight.failureMap).map(([name, value]) => [
          name,
          { status: value.status, code: value.code },
        ]),
      ),
      legacyPrivateNetwork: {
        requestHeader: policy.preflight.legacyPrivateNetwork.requestHeader,
        requestValue: policy.preflight.legacyPrivateNetwork.requestValue,
        responseHeader: policy.preflight.legacyPrivateNetwork.responseHeader,
        responseValue: policy.preflight.legacyPrivateNetwork.responseValue,
        varyToken: policy.preflight.legacyPrivateNetwork.varyToken,
        emitIffRequested: policy.preflight.legacyPrivateNetwork.emitIffRequested,
      },
    },
    unknownRoute: {
      status: policy.unknownRoute.status,
      code: policy.unknownRoute.code,
    },
    retryAfter: {
      kind: policy.retryAfter.kind,
      minimum: policy.retryAfter.minimum,
      maximum: policy.retryAfter.maximum,
      httpDateAllowed: policy.retryAfter.httpDateAllowed,
      queueFullProblemCode: policy.retryAfter.queueFullProblemCode,
      queueFullResponseCondition: policy.retryAfter.queueFullResponseCondition,
    },
    problemCodes: {
      http: [...policy.problemCodes.http],
      nonHttp: [...policy.problemCodes.nonHttp],
    },
  };
}

function validateConditionLocations(document) {
  const headerObjects = new Set();
  for (const header of Object.values(document.components?.headers ?? {}))
    if (isObject(header)) headerObjects.add(header);
  const visitResponses = (responses) => {
    if (!isObject(responses)) return;
    for (const response of Object.values(responses)) {
      if (!isObject(response) || !isObject(response.headers)) continue;
      for (const header of Object.values(response.headers))
        if (isObject(header)) headerObjects.add(header);
    }
  };
  visitResponses(document.components?.responses);
  for (const item of Object.values(document.paths ?? {})) {
    if (!isObject(item)) continue;
    for (const operation of Object.values(item))
      if (isObject(operation)) visitResponses(operation.responses);
  }
  const seen = new Set();
  const visit = (value) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (
      isObject(value) &&
      Object.prototype.hasOwnProperty.call(value, 'x-ovp-condition') &&
      !headerObjects.has(value)
    ) {
      fail('x-ovp-condition appears outside a Header Object.');
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(document);
}

function prevalidateComponents(document) {
  for (const [name, parameter] of sortedEntries(document.components.parameters ?? {})) {
    normalizeParameter(document, parameter, `components.parameters.${name}`);
  }
  for (const [name, header] of sortedEntries(document.components.headers ?? {})) {
    normalizeResponseHeader(document, name, header, `components.headers.${name}`);
  }
  for (const [name, response] of sortedEntries(document.components.responses ?? {})) {
    normalizeResponse(document, response, 200, `components.responses.${name}`);
  }
}

function collectSameNamespaceReferences(document, candidate, namespace, reachable, path) {
  if (!isObject(candidate) || !Object.prototype.hasOwnProperty.call(candidate, '$ref')) return;
  assertKeys(candidate, ['$ref'], path);
  const name = canonicalRefName(candidate.$ref, namespace, document, `${path}.$ref`);
  if (reachable.has(name)) return;
  reachable.add(name);
  collectSameNamespaceReferences(
    document,
    document.components[namespace][name],
    namespace,
    reachable,
    `components.${namespace}.${name}`,
  );
}

function collectResponseReferences(document, candidate, responses, headers, path) {
  if (!isObject(candidate)) return;
  if (Object.prototype.hasOwnProperty.call(candidate, '$ref')) {
    assertKeys(candidate, ['$ref'], path);
    const name = canonicalRefName(candidate.$ref, 'responses', document, `${path}.$ref`);
    if (responses.has(name)) return;
    responses.add(name);
    collectResponseReferences(
      document,
      document.components.responses[name],
      responses,
      headers,
      `components.responses.${name}`,
    );
    return;
  }
  if (!isObject(candidate.headers)) return;
  for (const [name, header] of sortedEntries(candidate.headers)) {
    collectSameNamespaceReferences(document, header, 'headers', headers, `${path}.headers.${name}`);
  }
}

function collectParameterList(document, candidates, reachable, path) {
  if (candidates === undefined) return;
  if (!Array.isArray(candidates)) fail(`${path} must be an array.`);
  candidates.forEach((candidate, index) =>
    collectSameNamespaceReferences(
      document,
      candidate,
      'parameters',
      reachable,
      `${path}[${index}]`,
    ),
  );
}

function assertNamespaceClosure(document, namespace, reachable, expectedCount) {
  const names = Object.keys(document.components[namespace]);
  if (
    names.length !== expectedCount ||
    reachable.size !== expectedCount ||
    names.some((name) => !reachable.has(name))
  ) {
    fail(
      `components.${namespace} reference closure must contain exactly ${expectedCount} standard-slot-reachable components.`,
    );
  }
}

function assertExactComponentReferenceClosures(document) {
  const parameters = new Set();
  const headers = new Set();
  const responses = new Set();
  for (const path of Object.keys(preflightIds)) {
    const pathItem = document.paths[path];
    collectParameterList(document, pathItem.parameters, parameters, `${path}.parameters`);
    const methods = [
      ...operationSpecs
        .filter((spec) => spec.path === path)
        .map((spec) => spec.method.toLowerCase()),
      'options',
    ];
    for (const method of methods) {
      const operation = pathItem[method];
      collectParameterList(
        document,
        operation.parameters,
        parameters,
        `${method.toUpperCase()} ${path}.parameters`,
      );
      for (const [status, response] of Object.entries(operation.responses)) {
        collectResponseReferences(
          document,
          response,
          responses,
          headers,
          `${method.toUpperCase()} ${path}.responses.${status}`,
        );
      }
    }
  }
  assertNamespaceClosure(document, 'parameters', parameters, 10);
  assertNamespaceClosure(document, 'headers', headers, 21);
  assertNamespaceClosure(document, 'responses', responses, 28);
}

function expectedSuccessBody(id, status) {
  const bodies = {
    getHealth: { 200: ['json', 'application/json', 'HealthResponse'] },
    createPairingChallenge: { 201: ['json', 'application/json', 'PairingChallengeResponse'] },
    redeemPairingChallenge: {
      200: ['json', 'application/json', 'RedeemResponse'],
      202: ['json', 'application/json', 'RedeemPendingResponse'],
    },
    getCurrentPairing: { 200: ['json', 'application/json', 'PairingResponse'] },
    revokeCurrentPairing: { 204: ['empty'] },
    getRuntime: { 200: ['json', 'application/json', 'RuntimeResponse'] },
    listEngines: { 200: ['json', 'application/json', 'EngineListResponse'] },
    listVoices: { 200: ['json', 'application/json', 'VoiceListResponse'] },
    listPacks: { 200: ['json', 'application/json', 'PackListResponse'] },
    createJob: { 202: ['json', 'application/json', 'JobResponse'] },
    getJob: { 200: ['json', 'application/json', 'JobResponse'] },
    cancelJob: { 202: ['json', 'application/json', 'JobResponse'] },
    getJobAudio: { 200: ['audio', 'audio/wav', 67_108_864] },
    requestPackAction: { 202: ['json', 'application/json', 'PackActionResponse'] },
  };
  const value = bodies[id]?.[status];
  if (value?.[0] === 'empty') return { kind: 'empty' };
  if (value?.[0] === 'audio') return { kind: 'audio', mediaType: value[1], maxBytes: value[2] };
  if (value?.[0] === 'json') return { kind: 'json', mediaType: value[1], schemaRef: value[2] };
  return undefined;
}

function expectedHeader(name, required, schema, condition = null) {
  return { name, required, schema, condition };
}

function commonHeaders() {
  return [
    expectedHeader('Cache-Control', true, { kind: 'const', type: 'string', value: 'no-store' }),
    expectedHeader('X-Content-Type-Options', true, {
      kind: 'const',
      type: 'string',
      value: 'nosniff',
    }),
    expectedHeader('X-Request-Id', true, { kind: 'schema-ref', schemaRef: 'CanonicalUuid' }),
  ];
}

function actualHeaders() {
  return [
    expectedHeader(
      'Access-Control-Allow-Origin',
      false,
      { kind: 'bounded-string', minLength: 1, maxLength: 256 },
      'validated-origin',
    ),
    expectedHeader(
      'Access-Control-Expose-Headers',
      false,
      { kind: 'const', type: 'string', value: 'ETag, Location, Retry-After, X-Request-Id' },
      'validated-origin',
    ),
    expectedHeader(
      'Vary',
      false,
      { kind: 'const', type: 'string', value: 'Origin' },
      'validated-origin',
    ),
  ];
}

function allowFor(path) {
  return [
    ...operationSpecs
      .filter((spec) => spec.path === path)
      .sort(
        (left, right) =>
          concreteMethodOrder.indexOf(left.method) - concreteMethodOrder.indexOf(right.method),
      )
      .map((spec) => spec.method),
    'OPTIONS',
  ];
}

function expectedConcreteHeaders(spec, status) {
  const headers = [...commonHeaders(), ...actualHeaders()];
  if (status === 401)
    headers.push(
      expectedHeader('WWW-Authenticate', true, {
        kind: 'const',
        type: 'string',
        value: 'Bearer realm="open-voice-companion"',
      }),
    );
  if (status === 405)
    headers.push(
      expectedHeader('Allow', true, {
        kind: 'const',
        type: 'string',
        value: allowFor(spec.path).join(', '),
      }),
    );
  if (status === 429 || (spec.id === 'redeemPairingChallenge' && status === 202))
    headers.push(
      expectedHeader('Retry-After', true, { kind: 'bounded-integer', minimum: 1, maximum: 3600 }),
    );
  if (status === 503)
    headers.push(
      expectedHeader(
        'Retry-After',
        false,
        { kind: 'bounded-integer', minimum: 1, maximum: 3600 },
        'queue-full-problem',
      ),
    );
  if (
    (spec.id === 'createPairingChallenge' && status === 201) ||
    (spec.id === 'createJob' && status === 202) ||
    (spec.id === 'requestPackAction' && status === 202)
  ) {
    headers.push(
      expectedHeader('Location', true, { kind: 'bounded-string', minLength: 1, maxLength: 256 }),
    );
  }
  if (
    status === 200 &&
    ['getRuntime', 'listEngines', 'listVoices', 'listPacks', 'getJobAudio'].includes(spec.id)
  ) {
    headers.push(
      expectedHeader('ETag', true, { kind: 'bounded-string', minLength: 3, maxLength: 128 }),
    );
  }
  return headers.sort((left, right) => compareCodeUnits(left.name, right.name));
}

function expectedPreflightHeaders(path, status) {
  const headers =
    status === 204
      ? [
          ...commonHeaders(),
          expectedHeader('Access-Control-Allow-Headers', true, {
            kind: 'const',
            type: 'string',
            value: 'Authorization, Content-Type, X-OVP-Client-Version',
          }),
          expectedHeader('Access-Control-Allow-Methods', true, {
            kind: 'const',
            type: 'string',
            value: 'GET, POST, DELETE, OPTIONS',
          }),
          expectedHeader('Access-Control-Allow-Origin', true, {
            kind: 'bounded-string',
            minLength: 1,
            maxLength: 256,
          }),
          expectedHeader(
            'Access-Control-Allow-Private-Network',
            false,
            { kind: 'const', type: 'string', value: 'true' },
            'legacy-private-network-requested',
          ),
          expectedHeader('Access-Control-Max-Age', true, {
            kind: 'const',
            type: 'integer',
            value: 600,
          }),
          expectedHeader('Vary', true, {
            kind: 'enum',
            type: 'string',
            values: [
              'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
              'Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
            ],
          }),
        ]
      : [
          ...commonHeaders(),
          expectedHeader('Vary', true, {
            kind: 'const',
            type: 'string',
            value: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
          }),
        ];
  if (status === 405)
    headers.push(
      expectedHeader('Allow', true, {
        kind: 'const',
        type: 'string',
        value: allowFor(path).join(', '),
      }),
    );
  if (status === 503)
    headers.push(
      expectedHeader('Retry-After', true, { kind: 'bounded-integer', minimum: 1, maximum: 3600 }),
    );
  return headers.sort((left, right) => compareCodeUnits(left.name, right.name));
}

function assertExactOperation(operation, spec) {
  const expectedRequestHeaders = [
    {
      name: 'Origin',
      required: true,
      schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
    },
    {
      name: 'X-OVP-Client-Version',
      required: true,
      schema: { kind: 'schema-ref', schemaRef: 'ClientVersion' },
    },
  ];
  const expectedPathParameters = spec.pathSchema
    ? [{ name: 'id', required: true, schemaRef: spec.pathSchema }]
    : [];
  const expectedBody = spec.bodySchema
    ? { kind: 'json', required: true, mediaType: 'application/json', schemaRef: spec.bodySchema }
    : { kind: 'none' };
  if (
    !jsonEqual(operation.allow, allowFor(spec.path)) ||
    !jsonEqual(operation.access, spec.access) ||
    !jsonEqual(operation.pathParameters, expectedPathParameters) ||
    !jsonEqual(operation.request, { headers: expectedRequestHeaders, body: expectedBody }) ||
    operation.preflight !== null ||
    operation.clientCallable !== true
  ) {
    fail(`concrete operation ${spec.id} does not match its exact request/access contract.`);
  }
  if (
    !jsonEqual(
      operation.responses.map((response) => response.status),
      spec.statuses,
    )
  )
    fail(`${spec.id} has an incorrect status set.`);
  for (const response of operation.responses) {
    const expectedBodyValue =
      response.status >= 400
        ? { kind: 'json', mediaType: 'application/problem+json', schemaRef: 'Problem' }
        : expectedSuccessBody(spec.id, response.status);
    if (
      !jsonEqual(response.body, expectedBodyValue) ||
      !jsonEqual(response.headers, expectedConcreteHeaders(spec, response.status))
    ) {
      fail(`${spec.id} ${response.status} has an incorrect body or Header contract.`);
    }
  }
}

function assertExactPreflight(operation, path) {
  const pathSpecs = operationSpecs
    .filter((spec) => spec.path === path)
    .sort(
      (left, right) =>
        concreteMethodOrder.indexOf(left.method) - concreteMethodOrder.indexOf(right.method),
    );
  const pathSchema = pathSpecs.find((spec) => spec.pathSchema)?.pathSchema;
  const expectedPathParameters = pathSchema
    ? [{ name: 'id', required: true, schemaRef: pathSchema }]
    : [];
  const expectedHeaders = [
    {
      name: 'Access-Control-Request-Headers',
      required: true,
      schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
    },
    {
      name: 'Access-Control-Request-Method',
      required: true,
      schema: { kind: 'enum', type: 'string', values: allowFor(path) },
    },
    {
      name: 'Access-Control-Request-Private-Network',
      required: false,
      schema: { kind: 'const', type: 'string', value: 'true' },
    },
    {
      name: 'Origin',
      required: true,
      schema: { kind: 'bounded-string', minLength: 1, maxLength: 256 },
    },
  ];
  const expectedRequested = sortedRecord(
    pathSpecs.map((spec) => [
      spec.method,
      [
        ...(spec.access.auth === 'bearer' ? ['Authorization'] : []),
        ...(spec.bodySchema ? ['Content-Type'] : []),
        'X-OVP-Client-Version',
      ],
    ]),
  );
  const expectedPreflight = {
    concreteMethods: pathSpecs.map((spec) => spec.method),
    requestedHeadersByMethod: expectedRequested,
  };
  if (
    operation.clientCallable !== false ||
    !jsonEqual(operation.allow, allowFor(path)) ||
    !jsonEqual(operation.access, { auth: 'preflight', scope: null, ownership: 'none' }) ||
    !jsonEqual(operation.pathParameters, expectedPathParameters) ||
    !jsonEqual(operation.request, { headers: expectedHeaders, body: { kind: 'none' } }) ||
    !jsonEqual(operation.preflight, expectedPreflight)
  ) {
    fail(`${preflightIds[path]} does not match its exact request/preflight contract.`);
  }
  const statuses = [204, 400, 403, 405, 408, 413, 414, 431, 503];
  if (
    !jsonEqual(
      operation.responses.map((response) => response.status),
      statuses,
    )
  )
    fail(`${preflightIds[path]} has an incorrect status set.`);
  for (const response of operation.responses) {
    const body =
      response.status === 204
        ? { kind: 'empty' }
        : { kind: 'json', mediaType: 'application/problem+json', schemaRef: 'Problem' };
    if (
      !jsonEqual(response.body, body) ||
      !jsonEqual(response.headers, expectedPreflightHeaders(path, response.status))
    ) {
      fail(`${preflightIds[path]} ${response.status} has an incorrect body or Header contract.`);
    }
  }
}

export function buildHttpContract(document) {
  if (!isObject(document) || !isObject(document.paths) || !isObject(document.components))
    fail('document roots are missing.');
  assertSourceClosure(document);
  validateConditionLocations(document);
  prevalidateComponents(document);
  const policy = normalizePolicy(document);
  const expectedPaths = Object.keys(preflightIds).sort(compareCodeUnits);
  if (!jsonEqual(Object.keys(document.paths).sort(compareCodeUnits), expectedPaths))
    fail('path inventory is not exact.');
  const operations = [];
  const paths = [];
  const seenIds = new Set();
  for (const path of expectedPaths) {
    const pathItem = document.paths[path];
    if (!isObject(pathItem)) fail(`${path} is not a Path Item.`);
    const pathSpecs = operationSpecs
      .filter((spec) => spec.path === path)
      .sort(
        (left, right) =>
          concreteMethodOrder.indexOf(left.method) - concreteMethodOrder.indexOf(right.method),
      );
    const allowedPathKeys = [
      ...pathSpecs.map((spec) => spec.method.toLowerCase()),
      'options',
      ...(pathSpecs.some((spec) => spec.pathSchema) ? ['parameters'] : []),
    ];
    if (
      !jsonEqual(
        Object.keys(pathItem).sort(compareCodeUnits),
        allowedPathKeys.sort(compareCodeUnits),
      )
    )
      fail(`${path} has an unsupported Path Item shape.`);
    const allow = allowFor(path);
    for (const spec of pathSpecs) {
      const operation = pathItem[spec.method.toLowerCase()];
      if (!isObject(operation) || operation.operationId !== spec.id)
        fail(`${spec.method} ${path} has the wrong operationId.`);
      if (seenIds.has(spec.id)) fail(`duplicate operationId ${spec.id}.`);
      seenIds.add(spec.id);
      assertOperationSourceKeys(operation, spec.bodySchema !== null, `${spec.method} ${path}`);
      assertSecurity(operation, spec.access, `${spec.method} ${path}`);
      const parameters = operationParameters(
        document,
        pathItem,
        operation,
        `${spec.method} ${path}`,
      );
      const requestHeaders = parameters
        .filter((parameter) => parameter.kind === 'header')
        .map(({ kind: _kind, ...header }) => header)
        .sort((left, right) => compareCodeUnits(left.name, right.name));
      const pathParameters = parameters
        .filter((parameter) => parameter.kind === 'path')
        .map(({ kind: _kind, ...parameter }) => parameter)
        .sort((left, right) => compareCodeUnits(left.name, right.name));
      const body = normalizeRequestBody(
        document,
        operation.requestBody,
        `${spec.method} ${path}.requestBody`,
      );
      const normalized = {
        path,
        method: spec.method,
        clientCallable: true,
        allow,
        access: cloneJson(spec.access),
        pathParameters,
        request: { headers: requestHeaders, body },
        preflight: null,
        responses: normalizeResponses(
          document,
          operation.responses,
          `${spec.method} ${path}.responses`,
        ),
      };
      assertExactOperation(normalized, spec);
      operations.push([spec.id, normalized]);
    }
    const optionSource = pathItem.options;
    const optionId = preflightIds[path];
    if (!isObject(optionSource) || optionSource.operationId !== optionId || seenIds.has(optionId))
      fail(`OPTIONS ${path} has the wrong or duplicate operationId.`);
    seenIds.add(optionId);
    assertOperationSourceKeys(optionSource, false, `OPTIONS ${path}`);
    assertSecurity(optionSource, { auth: 'preflight' }, `OPTIONS ${path}`);
    const methodParameter =
      pathSpecs.length === 2
        ? 'PreflightGetDeleteMethod'
        : pathSpecs[0].method === 'GET'
          ? 'PreflightGetMethod'
          : 'PreflightPostMethod';
    const expectedOptionParameters = [
      { $ref: '#/components/parameters/Origin' },
      { $ref: `#/components/parameters/${methodParameter}` },
      { $ref: '#/components/parameters/PreflightHeaders' },
      { $ref: '#/components/parameters/PreflightPrivateNetwork' },
    ];
    if (!jsonEqual(optionSource.parameters, expectedOptionParameters)) {
      fail(`OPTIONS ${path} does not use the exact preflight Parameter component mapping.`);
    }
    const optionParameters = operationParameters(
      document,
      pathItem,
      optionSource,
      `OPTIONS ${path}`,
    );
    const optionHeaders = optionParameters
      .filter((parameter) => parameter.kind === 'header')
      .map(({ kind: _kind, ...header }) => header)
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    const optionPathParameters = optionParameters
      .filter((parameter) => parameter.kind === 'path')
      .map(({ kind: _kind, ...parameter }) => parameter)
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    const concreteMethods = pathSpecs.map((spec) => spec.method);
    const requestedHeadersByMethod = sortedRecord(
      pathSpecs.map((spec) => {
        const source = pathItem[spec.method.toLowerCase()];
        const parameters = operationParameters(
          document,
          pathItem,
          source,
          `${spec.method} ${path}`,
        );
        const headers = parameters.filter((parameter) => parameter.kind === 'header');
        const body = normalizeRequestBody(
          document,
          source.requestBody,
          `${spec.method} ${path}.requestBody`,
        );
        return [spec.method, requestedHeaders(source, spec.access, body, headers)];
      }),
    );
    const normalizedOption = {
      path,
      method: 'OPTIONS',
      clientCallable: false,
      allow,
      access: { auth: 'preflight', scope: null, ownership: 'none' },
      pathParameters: optionPathParameters,
      request: {
        headers: optionHeaders,
        body: normalizeRequestBody(
          document,
          optionSource.requestBody,
          `OPTIONS ${path}.requestBody`,
        ),
      },
      preflight: { concreteMethods, requestedHeadersByMethod },
      responses: normalizeResponses(document, optionSource.responses, `OPTIONS ${path}.responses`),
    };
    assertExactPreflight(normalizedOption, path);
    operations.push([optionId, normalizedOption]);
    paths.push([
      path,
      {
        allow,
        concreteOperationIds: pathSpecs.map((spec) => spec.id),
        preflightOperationId: optionId,
      },
    ]);
  }
  if (seenIds.size !== 26) fail('operation inventory is not exactly twenty-six.');
  assertExactComponentReferenceClosures(document);
  return {
    version: 1,
    policy,
    paths: sortedRecord(paths),
    operations: sortedRecord(operations),
  };
}
