import { Buffer } from 'node:buffer';

import { assertProtocolNamePolicy } from './protocol-name-policy.mjs';
import { buildHttpContract } from './http-contract.mjs';

const supportedSchemaKeywords = new Set([
  '$ref',
  '$schema',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contentEncoding',
  'contentMediaType',
  'default',
  'deprecated',
  'description',
  'enum',
  'examples',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'oneOf',
  'pattern',
  'properties',
  'readOnly',
  'required',
  'title',
  'type',
  'uniqueItems',
  'writeOnly',
  'x-maxUtf8Bytes',
]);

const runtimeSchemaKeywords = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'oneOf',
  'pattern',
  'properties',
  'required',
  'type',
  'uniqueItems',
  'x-maxUtf8Bytes',
]);

const reservedSchemaNames = new Set([
  'Array',
  'Brand',
  'CompanionClient',
  'CompanionClientOperationId',
  'CompanionFetch',
  'CompanionHttpError',
  'CompanionHttpStatus',
  'CompanionProtocolError',
  'CompanionProtocolErrorReason',
  'CompanionRequestHeaderName',
  'CompanionRequestInit',
  'CompanionResponseHeaders',
  'CompanionResult',
  'CompanionWav',
  'Error',
  'JSON',
  'JsonValue',
  'Number',
  'Object',
  'OwnedSchemaName',
  'ProtocolValidationError',
  'Readonly',
  'Record',
  'Reflect',
  'RegExp',
  'RuntimeSchema',
  'SCHEMAS',
  'Set',
  'ValidationResult',
  'createCompanionClient',
]);

const allowedTypes = new Set(['array', 'boolean', 'integer', 'number', 'object', 'string']);
const allowedFormats = new Set(['date-time', 'uuid']);
const draft202012 = 'https://json-schema.org/draft/2020-12/schema';
const schemaReferencePrefix = '#/components/schemas/';

function fail(message) {
  throw new Error(`Protocol schema generation failed: ${message}`);
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sortedEntries(record) {
  return Object.entries(record).sort(([left], [right]) => compareCodeUnits(left, right));
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isJsonValue(value, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return isWellFormedUnicode(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  let valid;
  if (Array.isArray(value)) {
    valid = value.every((item) => isJsonValue(item, ancestors));
  } else if (isPlainObject(value)) {
    valid = sortedEntries(value).every(
      ([key, child]) => isWellFormedUnicode(key) && isJsonValue(child, ancestors),
    );
  } else {
    valid = false;
  }
  ancestors.delete(value);
  return valid;
}

function jsonEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
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

function assertNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${path} must be a non-negative integer.`);
}

function assertFiniteNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(`${path} must be a finite number.`);
}

function referenceName(reference, schemas, path) {
  if (typeof reference !== 'string' || !reference.startsWith(schemaReferencePrefix)) {
    fail(`${path} has a non-component schema reference.`);
  }
  const name = reference.slice(schemaReferencePrefix.length);
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(name) || reference !== `${schemaReferencePrefix}${name}`) {
    fail(`${path} has a noncanonical schema reference.`);
  }
  if (!Object.prototype.hasOwnProperty.call(schemas, name)) {
    fail(`${path} has an unresolved schema reference.`);
  }
  return name;
}

function validateSchema(schema, path, schemas) {
  if (!isPlainObject(schema)) fail(`${path} is not an object schema.`);
  for (const key of Object.keys(schema)) {
    if (!supportedSchemaKeywords.has(key)) fail(`${path} uses unsupported schema keyword ${key}.`);
  }
  if (schema.$schema !== undefined && schema.$schema !== draft202012) {
    fail(`${path} uses an unsupported schema dialect.`);
  }
  if (schema.$ref !== undefined) referenceName(schema.$ref, schemas, `${path}.$ref`);
  if (schema.type !== undefined) {
    if (typeof schema.type !== 'string' || !allowedTypes.has(schema.type)) {
      fail(`${path}.type is unsupported.`);
    }
  }
  if (schema.format !== undefined) {
    if (typeof schema.format !== 'string' || !allowedFormats.has(schema.format)) {
      fail(`${path}.format is unsupported.`);
    }
    if (schema.type !== 'string' && schema.$ref === undefined) {
      fail(`${path}.format requires a string schema or reference.`);
    }
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') fail(`${path}.pattern must be a string.`);
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      fail(`${path}.pattern is not a valid Unicode regular expression.`);
    }
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems', 'x-maxUtf8Bytes']) {
    if (schema[keyword] !== undefined)
      assertNonNegativeInteger(schema[keyword], `${path}.${keyword}`);
  }
  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    if (schema.minLength > schema.maxLength) fail(`${path} has inverted string bounds.`);
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined) {
    if (schema.minItems > schema.maxItems) fail(`${path} has inverted array bounds.`);
  }
  if (
    schema['x-maxUtf8Bytes'] !== undefined &&
    schema.type !== 'string' &&
    schema.$ref === undefined
  ) {
    fail(`${path}.x-maxUtf8Bytes requires a string schema or reference.`);
  }
  for (const keyword of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
    if (schema[keyword] !== undefined) assertFiniteNumber(schema[keyword], `${path}.${keyword}`);
  }
  if (
    schema.minimum !== undefined &&
    schema.maximum !== undefined &&
    schema.minimum > schema.maximum
  ) {
    fail(`${path} has inverted numeric bounds.`);
  }
  if (schema.const !== undefined && !isJsonValue(schema.const)) {
    fail(`${path}.const is not a finite, well-formed JSON value.`);
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0)
      fail(`${path}.enum must be nonempty.`);
    for (const value of schema.enum) {
      if (!isJsonValue(value)) fail(`${path}.enum contains a non-JSON value.`);
    }
    for (let left = 0; left < schema.enum.length; left += 1) {
      for (let right = left + 1; right < schema.enum.length; right += 1) {
        if (jsonEqual(schema.enum[left], schema.enum[right]))
          fail(`${path}.enum contains duplicates.`);
      }
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
    if (schema[keyword] === undefined) continue;
    if (!Array.isArray(schema[keyword]) || schema[keyword].length === 0) {
      fail(`${path}.${keyword} must be a nonempty array.`);
    }
    schema[keyword].forEach((branch, index) =>
      validateSchema(branch, `${path}.${keyword}[${index}]`, schemas),
    );
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) fail(`${path} must be a closed object schema.`);
    if (!isPlainObject(schema.properties)) fail(`${path}.properties must be an object.`);
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some((name) => typeof name !== 'string')) {
      fail(`${path}.required must be a string array.`);
    }
    if (new Set(required).size !== required.length) fail(`${path}.required contains duplicates.`);
    for (const name of required) {
      if (!Object.prototype.hasOwnProperty.call(schema.properties, name)) {
        fail(`${path}.required names an unknown property.`);
      }
    }
    for (const [name, property] of sortedEntries(schema.properties)) {
      validateSchema(property, `${path}.properties.${name}`, schemas);
    }
  } else if (
    schema.properties !== undefined ||
    schema.required !== undefined ||
    schema.additionalProperties !== undefined
  ) {
    fail(`${path} uses object keywords without type object.`);
  }
  if (schema.type === 'array') {
    if (!isPlainObject(schema.items)) fail(`${path}.items must be a schema object.`);
    if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') {
      fail(`${path}.uniqueItems must be boolean.`);
    }
    if (schema.uniqueItems === true && schema.maxItems === undefined) {
      fail(`${path}.uniqueItems requires a finite maxItems bound.`);
    }
    validateSchema(schema.items, `${path}.items`, schemas);
  } else if (
    schema.items !== undefined ||
    schema.minItems !== undefined ||
    schema.maxItems !== undefined ||
    schema.uniqueItems !== undefined
  ) {
    fail(`${path} uses array keywords without type array.`);
  }
  if (
    schema.$ref === undefined &&
    schema.type === undefined &&
    schema.const === undefined &&
    schema.enum === undefined &&
    schema.oneOf === undefined &&
    schema.anyOf === undefined &&
    schema.allOf === undefined
  ) {
    fail(`${path} has no supported validation assertion.`);
  }
}

function assertAcyclicReferences(schemas) {
  const edges = new Map();
  function collect(schema, names) {
    if (schema.$ref !== undefined) names.add(referenceName(schema.$ref, schemas, '$ref'));
    for (const keyword of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(schema[keyword])) {
        for (const branch of schema[keyword]) collect(branch, names);
      }
    }
    if (isPlainObject(schema.properties)) {
      for (const property of Object.values(schema.properties)) collect(property, names);
    }
    if (isPlainObject(schema.items)) collect(schema.items, names);
  }
  for (const [name, schema] of sortedEntries(schemas)) {
    const names = new Set();
    collect(schema, names);
    edges.set(name, [...names].sort(compareCodeUnits));
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) fail(`schema reference cycle reaches ${name}.`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const target of edges.get(name) ?? []) visit(target);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of [...edges.keys()].sort(compareCodeUnits)) visit(name);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      sortedEntries(value).map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

function compareCanonicalJson(left, right) {
  return compareCodeUnits(JSON.stringify(left), JSON.stringify(right));
}

function canonicalJsonSet(values) {
  return values.map(canonicalJson).sort(compareCanonicalJson);
}

function sortedSchemaSet(schemas) {
  return schemas
    .map((schema) => ({ schema, canonical: canonicalRuntimeSchema(schema) }))
    .sort((left, right) => compareCanonicalJson(left.canonical, right.canonical))
    .map(({ schema }) => schema);
}

function canonicalRuntimeSchema(schema) {
  const entries = [];
  for (const [key, value] of sortedEntries(schema)) {
    if (!runtimeSchemaKeywords.has(key)) continue;
    if (key === 'properties') {
      entries.push([
        key,
        Object.fromEntries(
          sortedEntries(value).map(([name, child]) => [name, canonicalRuntimeSchema(child)]),
        ),
      ]);
    } else if (key === 'items') {
      entries.push([key, canonicalRuntimeSchema(value)]);
    } else if (key === 'enum') {
      entries.push([key, canonicalJsonSet(value)]);
    } else if (key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
      entries.push([key, value.map(canonicalRuntimeSchema).sort(compareCanonicalJson)]);
    } else if (key === 'required') {
      entries.push([key, [...value].sort(compareCodeUnits)]);
    } else {
      entries.push([key, canonicalJson(value)]);
    }
  }
  return Object.fromEntries(entries);
}

function literalType(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `readonly [${value.map(literalType).join(', ')}]`;
  return `{ ${sortedEntries(value)
    .map(([key, child]) => `readonly ${JSON.stringify(key)}: ${literalType(child)};`)
    .join(' ')} }`;
}

function schemaType(schema, path) {
  const assertions = [];
  if (schema.$ref !== undefined) {
    assertions.push(schema.$ref.slice(schemaReferencePrefix.length));
  }
  if (schema.const !== undefined) {
    assertions.push(literalType(schema.const));
  }
  if (schema.enum !== undefined) {
    assertions.push(canonicalJsonSet(schema.enum).map(literalType).join(' | '));
  }
  if (schema.oneOf !== undefined) {
    assertions.push(
      sortedSchemaSet(schema.oneOf)
        .map((branch, index) => schemaType(branch, `${path}.oneOf${index}`))
        .join(' | '),
    );
  }
  if (schema.anyOf !== undefined) {
    assertions.push(
      sortedSchemaSet(schema.anyOf)
        .map((branch, index) => schemaType(branch, `${path}.anyOf${index}`))
        .join(' | '),
    );
  }
  if (schema.allOf !== undefined) {
    assertions.push(
      sortedSchemaSet(schema.allOf)
        .map((branch, index) => schemaType(branch, `${path}.allOf${index}`))
        .join(' & '),
    );
  }
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    assertions.push('object');
    assertions.push(
      `{ ${sortedEntries(schema.properties)
        .map(
          ([name, property]) =>
            `readonly ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${schemaType(property, `${path}.${name}`)};`,
        )
        .join(' ')} }`,
    );
  } else if (schema.type === 'array') {
    assertions.push(`readonly (${schemaType(schema.items, `${path}.item`)})[]`);
  } else if (schema.type === 'integer' || schema.type === 'number') {
    assertions.push('number');
  } else if (schema.type === 'boolean') {
    assertions.push('boolean');
  } else if (schema.type === 'string') {
    assertions.push('string');
  }
  if (assertions.length === 0) fail(`${path} cannot be represented as TypeScript.`);
  const base = assertions.map((assertion) => `(${assertion})`).join(' & ');
  const constrained =
    schema.type === 'integer' ||
    schema.type === 'number' ||
    [
      'exclusiveMaximum',
      'exclusiveMinimum',
      'format',
      'maxItems',
      'maxLength',
      'maximum',
      'minItems',
      'minLength',
      'minimum',
      'pattern',
      'uniqueItems',
      'x-maxUtf8Bytes',
    ].some((key) => schema[key] !== undefined);
  return constrained ? `(${base}) & Brand<${JSON.stringify(path)}>` : base;
}

function safeAdd(left, right, path) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) fail(`${path} JSON byte cap exceeds the safe integer range.`);
  return result;
}

function safeMultiply(left, right, path) {
  const result = left * right;
  if (!Number.isSafeInteger(result)) fail(`${path} JSON byte cap exceeds the safe integer range.`);
  return result;
}

function serializedByteLength(value) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== 'string') fail('JSON byte cap encountered an unserializable value.');
  return Buffer.byteLength(serialized, 'utf8');
}

function schemaJsonByteCap(schema, schemas, path, memo = new Map(), visiting = new Set()) {
  const candidates = [];
  if (schema.$ref !== undefined) {
    const name = referenceName(schema.$ref, schemas, `${path}.$ref`);
    let cap = memo.get(name);
    if (cap === undefined) {
      if (visiting.has(name)) fail(`${path} JSON byte cap reaches a reference cycle.`);
      visiting.add(name);
      cap = schemaJsonByteCap(schemas[name], schemas, `components.schemas.${name}`, memo, visiting);
      visiting.delete(name);
      memo.set(name, cap);
    }
    if (cap !== null) candidates.push(cap);
  }
  if (schema.const !== undefined) candidates.push(serializedByteLength(schema.const));
  if (schema.enum !== undefined) {
    candidates.push(Math.max(...schema.enum.map((value) => serializedByteLength(value))));
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    if (schema[keyword] === undefined) continue;
    const branchCaps = schema[keyword].map((branch, index) =>
      schemaJsonByteCap(branch, schemas, `${path}.${keyword}[${index}]`, memo, visiting),
    );
    if (branchCaps.every((cap) => cap !== null)) candidates.push(Math.max(...branchCaps));
  }
  if (schema.allOf !== undefined) {
    const branchCaps = schema.allOf
      .map((branch, index) =>
        schemaJsonByteCap(branch, schemas, `${path}.allOf[${index}]`, memo, visiting),
      )
      .filter((cap) => cap !== null);
    if (branchCaps.length > 0) candidates.push(Math.min(...branchCaps));
  }

  if (schema.type === 'boolean') {
    candidates.push(5);
  } else if (schema.type === 'string') {
    const limits = [schema.maxLength, schema['x-maxUtf8Bytes']].filter(
      (limit) => limit !== undefined,
    );
    if (limits.length > 0) {
      candidates.push(safeAdd(2, safeMultiply(6, Math.min(...limits), path), path));
    }
  } else if (schema.type === 'array') {
    if (schema.maxItems !== undefined) {
      const itemCap = schemaJsonByteCap(schema.items, schemas, `${path}.items`, memo, visiting);
      if (itemCap !== null) {
        const items = safeMultiply(schema.maxItems, itemCap, path);
        const commas = Math.max(0, schema.maxItems - 1);
        candidates.push(safeAdd(2, safeAdd(items, commas, path), path));
      }
    }
  } else if (schema.type === 'object') {
    let total = 2;
    let bounded = true;
    const properties = sortedEntries(schema.properties);
    for (const [name, property] of properties) {
      const propertyCap = schemaJsonByteCap(
        property,
        schemas,
        `${path}.properties.${name}`,
        memo,
        visiting,
      );
      if (propertyCap === null) {
        bounded = false;
        break;
      }
      total = safeAdd(total, serializedByteLength(name), path);
      total = safeAdd(total, 1, path);
      total = safeAdd(total, propertyCap, path);
    }
    if (bounded) {
      total = safeAdd(total, Math.max(0, properties.length - 1), path);
      candidates.push(total);
    }
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}

function collectClientOperations(httpContract, schemas) {
  if (!isPlainObject(httpContract.operations)) fail('HTTP contract operations are missing.');
  const operations = sortedEntries(httpContract.operations).filter(
    ([, operation]) => operation.clientCallable === true,
  );
  if (operations.length !== 14) fail('client operation inventory is not exactly fourteen.');
  for (const [operationId, operation] of operations) {
    if (!/^[a-z][A-Za-z0-9]*$/u.test(operationId) || !isPlainObject(operation)) {
      fail('client operation identifier or shape is invalid.');
    }
    if (!['DELETE', 'GET', 'POST'].includes(operation.method)) {
      fail(`client operation ${operationId} uses an unsupported method.`);
    }
    if (
      typeof operation.path !== 'string' ||
      !operation.path.startsWith('/') ||
      operation.path.includes('?') ||
      operation.path.includes('#') ||
      operation.preflight !== null
    ) {
      fail(`client operation ${operationId} uses an unsupported path or preflight shape.`);
    }
    if (
      !isPlainObject(operation.access) ||
      !['bearer', 'origin-only'].includes(operation.access.auth) ||
      !['job-owner', 'none', 'token-self'].includes(operation.access.ownership) ||
      !(operation.access.scope === null || typeof operation.access.scope === 'string')
    ) {
      fail(`client operation ${operationId} uses an unsupported access shape.`);
    }
    if (!Array.isArray(operation.pathParameters)) {
      fail(`client operation ${operationId} path parameters are invalid.`);
    }
    const placeholders = [...operation.path.matchAll(/\{([^{}]+)\}/gu)].map((match) => match[1]);
    if (operation.path.replaceAll(/\{[^{}]+\}/gu, '').match(/[{}]/u)) {
      fail(`client operation ${operationId} has malformed placeholders.`);
    }
    const parameters = operation.pathParameters.map((parameter) => {
      if (
        !isPlainObject(parameter) ||
        typeof parameter.name !== 'string' ||
        parameter.required !== true ||
        !['CanonicalUuid', 'PackId'].includes(parameter.schemaRef) ||
        !Object.prototype.hasOwnProperty.call(schemas, parameter.schemaRef)
      ) {
        fail(`client operation ${operationId} has an unsupported owned path parameter.`);
      }
      return parameter.name;
    });
    if (
      new Set(placeholders).size !== placeholders.length ||
      new Set(parameters).size !== parameters.length ||
      !jsonEqual([...placeholders].sort(compareCodeUnits), [...parameters].sort(compareCodeUnits))
    ) {
      fail(`client operation ${operationId} placeholders do not match owned path parameters.`);
    }
    if (
      !isPlainObject(operation.request) ||
      !Array.isArray(operation.request.headers) ||
      !isPlainObject(operation.request.body)
    ) {
      fail(`client operation ${operationId} request shape is invalid.`);
    }
    const requestHeaderNames = operation.request.headers
      .map((header) => header?.name)
      .sort(compareCodeUnits);
    if (!jsonEqual(requestHeaderNames, ['Origin', 'X-OVP-Client-Version'])) {
      fail(`client operation ${operationId} has unsupported caller-visible request headers.`);
    }
    const requestBody = operation.request.body;
    if (
      requestBody.kind !== 'none' &&
      !(
        requestBody.kind === 'json' &&
        requestBody.required === true &&
        requestBody.mediaType === 'application/json' &&
        typeof requestBody.schemaRef === 'string' &&
        Object.prototype.hasOwnProperty.call(schemas, requestBody.schemaRef)
      )
    ) {
      fail(`client operation ${operationId} uses an unsupported request body.`);
    }
    if (!Array.isArray(operation.responses) || operation.responses.length === 0) {
      fail(`client operation ${operationId} responses are missing.`);
    }
    const statuses = new Set();
    for (const response of operation.responses) {
      if (
        !isPlainObject(response) ||
        !Number.isSafeInteger(response.status) ||
        statuses.has(response.status) ||
        !isPlainObject(response.body) ||
        !Array.isArray(response.headers)
      ) {
        fail(`client operation ${operationId} has an invalid response descriptor.`);
      }
      statuses.add(response.status);
      const successful = response.status >= 200 && response.status < 300;
      const body = response.body;
      const supportedJson =
        body.kind === 'json' &&
        body.mediaType === (successful ? 'application/json' : 'application/problem+json') &&
        typeof body.schemaRef === 'string' &&
        Object.prototype.hasOwnProperty.call(schemas, body.schemaRef) &&
        (successful || body.schemaRef === 'Problem');
      const supportedAudio =
        successful &&
        body.kind === 'audio' &&
        body.mediaType === 'audio/wav' &&
        Number.isSafeInteger(body.maxBytes) &&
        body.maxBytes >= 0;
      const supportedEmpty = successful && response.status === 204 && body.kind === 'empty';
      if (!supportedJson && !supportedAudio && !supportedEmpty) {
        fail(`client operation ${operationId} has an unsupported response body.`);
      }
      for (const header of response.headers) {
        if (!isPlainObject(header) || typeof header.name !== 'string') {
          fail(`client operation ${operationId} has an invalid response header.`);
        }
        if (
          ['Cache-Control', 'ETag', 'Location', 'Retry-After', 'X-Request-Id'].includes(
            header.name,
          ) &&
          header.condition !== null &&
          header.condition !== 'queue-full-problem'
        ) {
          fail(`client operation ${operationId} has an unknown observable header condition.`);
        }
      }
    }
  }
  return operations;
}

function collectRoutes(clientOperations) {
  return Object.fromEntries(
    clientOperations.map(([operationId, operation]) => [
      operationId,
      `${operation.method} ${operation.path}`,
    ]),
  );
}

function collectJsonByteCaps(clientOperations, schemas) {
  const names = new Set();
  for (const [, operation] of clientOperations) {
    if (operation.request.body.kind === 'json') names.add(operation.request.body.schemaRef);
    for (const response of operation.responses) {
      if (response.body.kind === 'json') names.add(response.body.schemaRef);
    }
  }
  const memo = new Map();
  return Object.fromEntries(
    [...names].sort(compareCodeUnits).map((name) => {
      const cap = schemaJsonByteCap(
        schemas[name],
        schemas,
        `components.schemas.${name}`,
        memo,
        new Set([name]),
      );
      if (cap === null) fail(`client-reachable schema ${name} has an unbounded JSON byte cap.`);
      return [name, cap];
    }),
  );
}

function clientOptionType(operation) {
  const fields = [];
  for (const parameter of operation.pathParameters) {
    fields.push(`readonly ${parameter.name}: ${parameter.schemaRef};`);
  }
  if (operation.request.body.kind === 'json') {
    fields.push(`readonly body: ${operation.request.body.schemaRef};`);
  }
  if (operation.access.auth === 'bearer') fields.push('readonly token: OpaqueSecret;');
  fields.push('readonly signal?: AbortSignal;');
  return `Readonly<{ ${fields.join(' ')} }>`;
}

function clientResponseBodyType(body) {
  if (body.kind === 'json') return body.schemaRef;
  if (body.kind === 'audio') return 'CompanionWav';
  if (body.kind === 'empty') return 'undefined';
  fail('client response body type is unsupported.');
}

function clientResultType(operation) {
  return operation.responses
    .filter((response) => response.status >= 200 && response.status < 300)
    .map(
      (response) => `CompanionResult<${response.status}, ${clientResponseBodyType(response.body)}>`,
    )
    .join(' | ');
}

function clientTypeSource(clientOperations, httpContract) {
  const errorStatuses = [
    ...new Set(
      clientOperations.flatMap(([, operation]) =>
        operation.responses
          .filter((response) => response.status < 200 || response.status >= 300)
          .map((response) => response.status),
      ),
    ),
  ].sort((left, right) => left - right);
  const requestHeaderNames = httpContract.policy?.preflight?.allowHeaders;
  if (
    !Array.isArray(requestHeaderNames) ||
    !jsonEqual([...requestHeaderNames].sort(compareCodeUnits), [
      'Authorization',
      'Content-Type',
      'X-OVP-Client-Version',
    ])
  ) {
    fail('client request header policy is unsupported.');
  }
  const lines = [
    'export type CompanionClientOperationId = keyof typeof ROUTES;',
    '',
    'export type CompanionHttpStatus =',
    ...errorStatuses.map(
      (status, index) => `  | ${status}${index === errorStatuses.length - 1 ? ';' : ''}`,
    ),
    '',
    'export type CompanionRequestHeaderName =',
    ...[...requestHeaderNames]
      .sort(compareCodeUnits)
      .map(
        (name, index, names) =>
          `  | ${JSON.stringify(name)}${index === names.length - 1 ? ';' : ''}`,
      ),
    '',
    'export type CompanionRequestInit = Readonly<{',
    '  method: "GET" | "POST" | "DELETE";',
    '  mode: "cors";',
    '  credentials: "omit";',
    '  cache: "no-store";',
    '  redirect: "error";',
    '  targetAddressSpace: "loopback";',
    '  headers: Readonly<Partial<Record<CompanionRequestHeaderName, string>>>;',
    '  body?: string;',
    '  signal?: AbortSignal;',
    '}>;',
    '',
    'export type CompanionFetch = (',
    '  input: string,',
    '  init: CompanionRequestInit,',
    ') => Promise<Response>;',
    '',
    'export type CompanionResponseHeaders = Readonly<{',
    '  requestId: CanonicalUuid;',
    '  etag: string | null;',
    '  location: string | null;',
    '  retryAfterSeconds: number | null;',
    '}>;',
    '',
    'export type CompanionWav = Readonly<{',
    '  mediaType: "audio/wav";',
    '  bytes: Uint8Array;',
    '}>;',
    '',
    'export type CompanionResult<S extends number, B> = Readonly<{',
    '  status: S;',
    '  body: B;',
    '  headers: CompanionResponseHeaders;',
    '}>;',
    '',
    'export type CompanionProtocolErrorReason =',
    ...[
      'invalid-response',
      'redirected-response',
      'response-url-mismatch',
      'response-type-mismatch',
      'unknown-status',
      'invalid-response-header',
      'content-type-mismatch',
      'invalid-content-length',
      'body-too-large',
      'content-length-mismatch',
      'unexpected-body',
      'body-unreadable',
      'invalid-utf8',
      'invalid-json',
      'schema-mismatch',
      'non-http-problem-code',
      'problem-status-mismatch',
    ].map(
      (reason, index, reasons) =>
        `  | ${JSON.stringify(reason)}${index === reasons.length - 1 ? ';' : ''}`,
    ),
    '',
    'export type CompanionClient = Readonly<{',
    ...clientOperations.map(
      ([operationId, operation]) =>
        `  readonly ${operationId}: (options: ${clientOptionType(operation)}) => Promise<${clientResultType(operation)}>;`,
    ),
    '}>;',
  ];
  return lines.join('\n');
}

function clientFactorySource(clientOperations) {
  const wrappers = clientOperations.flatMap(([operationId, operation]) => {
    const options = clientOptionType(operation);
    const result = clientResultType(operation);
    return [
      `    ${operationId}: (options: ${options}): Promise<${result}> =>`,
      `      executeClientOperation<${result}>(${JSON.stringify(operationId)}, options, fetchImpl),`,
    ];
  });
  return [
    'export function createCompanionClient(fetchImpl: CompanionFetch): CompanionClient {',
    '  if (typeof fetchImpl !== "function") throw new TypeError("Companion fetch implementation is required.");',
    '  const wrappers: CompanionClient = {',
    ...wrappers,
    '  };',
    '  const client = Object.assign(Object.create(null) as object, wrappers);',
    '  return Object.freeze(client);',
    '}',
  ].join('\n');
}

const freezeSource = `
function recursivelyFreeze<Value>(value: Value): Value {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value as object)) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key);
    if (descriptor !== undefined && "value" in descriptor) recursivelyFreeze(descriptor.value);
  }
  Object.freeze(value as object);
  return value;
}
`;

const runtimeSource = `
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type RuntimeSchema = {
  readonly $ref?: string;
  readonly additionalProperties?: false;
  readonly allOf?: readonly RuntimeSchema[];
  readonly anyOf?: readonly RuntimeSchema[];
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
  readonly exclusiveMaximum?: number;
  readonly exclusiveMinimum?: number;
  readonly format?: "date-time" | "uuid";
  readonly items?: RuntimeSchema;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly minLength?: number;
  readonly minimum?: number;
  readonly oneOf?: readonly RuntimeSchema[];
  readonly pattern?: string;
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly required?: readonly string[];
  readonly type?: "array" | "boolean" | "integer" | "number" | "object" | "string";
  readonly uniqueItems?: boolean;
  readonly "x-maxUtf8Bytes"?: number;
};

type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly path: string };

const validResult: ValidationResult = { valid: true };
const maximumJsonNodes = 10_000;
const maximumJsonDepth = 64;
const maximumSchemaDepth = 64;

function invalid(path: string): ValidationResult {
  return { valid: false, path };
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isSafeJson(
  value: unknown,
  budget: { remaining: number },
  ancestors: Set<object>,
  depth: number,
): boolean {
  if (depth > maximumJsonDepth || budget.remaining <= 0) return false;
  budget.remaining -= 1;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return isWellFormedUnicode(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > budget.remaining) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) return false;
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        !isSafeJson(descriptor.value, budget, ancestors, depth + 1)
      ) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  }
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > budget.remaining || keys.some((key) => typeof key !== "string")) return false;
  ancestors.add(value);
  for (const key of keys as string[]) {
    if (!isWellFormedUnicode(key)) {
      ancestors.delete(value);
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      !isSafeJson(descriptor.value, budget, ancestors, depth + 1)
    ) {
      ancestors.delete(value);
      return false;
    }
  }
  ancestors.delete(value);
  return true;
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]!));
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Readonly<Record<string, JsonValue>>;
    const rightRecord = right as Readonly<Record<string, JsonValue>>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          rightKeys[index] === key &&
          jsonEqual(leftRecord[key]!, rightRecord[key]!),
      )
    );
  }
  return false;
}

function codePointLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) index += 1;
    length += 1;
  }
  return length;
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function matchesCanonicalUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function matchesCanonicalDateTime(value: string): boolean {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return false;
  const zone = match[7]!;
  if (zone === "-00:00") return false;
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

function propertyPath(path: string, property: string): string {
  return path + "/" + property.replaceAll("~", "~0").replaceAll("/", "~1");
}

function validateSchema(
  schema: RuntimeSchema,
  value: JsonValue,
  path: string,
  depth: number,
): ValidationResult {
  if (depth > maximumSchemaDepth) return invalid(path);
  if (schema.$ref !== undefined) {
    const name = schema.$ref.slice("#/components/schemas/".length) as OwnedSchemaName;
    const referenced = SCHEMAS[name] as RuntimeSchema | undefined;
    if (referenced === undefined) return invalid(path);
    const result = validateSchema(referenced, value, path, depth + 1);
    if (!result.valid) return result;
  }
  if (schema.allOf !== undefined) {
    for (const branch of schema.allOf) {
      const result = validateSchema(branch, value, path, depth + 1);
      if (!result.valid) return result;
    }
  }
  if (schema.anyOf !== undefined) {
    let matches = false;
    for (const branch of schema.anyOf) {
      if (validateSchema(branch, value, path, depth + 1).valid) matches = true;
    }
    if (!matches) return invalid(path);
  }
  if (schema.oneOf !== undefined) {
    let matches = 0;
    for (const branch of schema.oneOf) {
      if (validateSchema(branch, value, path, depth + 1).valid) matches += 1;
    }
    if (matches !== 1) return invalid(path);
  }
  if (schema.const !== undefined && !jsonEqual(value, schema.const)) return invalid(path);
  if (schema.enum !== undefined && !schema.enum.some((item) => jsonEqual(value, item))) {
    return invalid(path);
  }
  if (schema.type === "string" && typeof value !== "string") return invalid(path);
  if (schema.type === "boolean" && typeof value !== "boolean") return invalid(path);
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    return invalid(path);
  }
  if (
    schema.type === "integer" &&
    (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value))
  ) {
    return invalid(path);
  }
  if (schema.type === "array" && !Array.isArray(value)) return invalid(path);
  if (
    schema.type === "object" &&
    (value === null || typeof value !== "object" || Array.isArray(value))
  ) {
    return invalid(path);
  }
  if (typeof value === "string") {
    const length = codePointLength(value);
    if (schema.minLength !== undefined && length < schema.minLength) return invalid(path);
    if (schema.maxLength !== undefined && length > schema.maxLength) return invalid(path);
    if (schema["x-maxUtf8Bytes"] !== undefined && utf8Length(value) > schema["x-maxUtf8Bytes"]!) {
      return invalid(path);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) {
      return invalid(path);
    }
    if (schema.format === "uuid" && !matchesCanonicalUuid(value)) return invalid(path);
    if (schema.format === "date-time" && !matchesCanonicalDateTime(value)) return invalid(path);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return invalid(path);
    if (schema.maximum !== undefined && value > schema.maximum) return invalid(path);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return invalid(path);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return invalid(path);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return invalid(path);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return invalid(path);
    if (schema.uniqueItems === true) {
      for (let left = 0; left < value.length; left += 1) {
        for (let right = left + 1; right < value.length; right += 1) {
          if (jsonEqual(value[left]!, value[right]!)) return invalid(path);
        }
      }
    }
    if (schema.items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        const result = validateSchema(schema.items, value[index]!, path + "/" + index, depth + 1);
        if (!result.valid) return result;
      }
    }
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    schema.properties !== undefined
  ) {
    const record = value as Readonly<Record<string, JsonValue>>;
    const keys = Object.keys(record);
    if (
      schema.additionalProperties === false &&
      keys.some((key) => !Object.prototype.hasOwnProperty.call(schema.properties, key))
    ) {
      return invalid(path);
    }
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, required)) return invalid(path);
    }
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (!Object.prototype.hasOwnProperty.call(record, name)) continue;
      const result = validateSchema(
        propertySchema,
        record[name]!,
        propertyPath(path, name),
        depth + 1,
      );
      if (!result.valid) return result;
    }
  }
  return validResult;
}

function validateOwned(name: OwnedSchemaName, value: unknown): ValidationResult {
  try {
    if (!isSafeJson(value, { remaining: maximumJsonNodes }, new Set(), 0)) return invalid("$");
    return validateSchema(SCHEMAS[name] as RuntimeSchema, value as JsonValue, "$", 0);
  } catch {
    return invalid("$");
  }
}

export class ProtocolValidationError extends Error {
  readonly schema: OwnedSchemaName;
  readonly path: string;

  constructor(schema: OwnedSchemaName, path: string) {
    super("Invalid " + schema + " value at " + path + ".");
    this.name = "ProtocolValidationError";
    this.schema = schema;
    this.path = path;
  }
}
`;

const clientRuntimeSource = `
type ClientPathParameter = Readonly<{
  name: string;
  required: true;
  schemaRef: OwnedSchemaName;
}>;

type ClientRequestBody =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "json";
      required: true;
      mediaType: "application/json";
      schemaRef: OwnedSchemaName;
    }>;

type ClientResponseBody =
  | Readonly<{
      kind: "json";
      mediaType: "application/json" | "application/problem+json";
      schemaRef: OwnedSchemaName;
    }>
  | Readonly<{ kind: "audio"; mediaType: "audio/wav"; maxBytes: number }>
  | Readonly<{ kind: "empty" }>;

type ClientHeaderSchema = Readonly<{
  kind: string;
  value?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  schemaRef?: OwnedSchemaName;
}>;

type ClientResponseHeaderDescriptor = Readonly<{
  name: string;
  required: boolean;
  condition: string | null;
  schema: ClientHeaderSchema;
}>;

type ClientResponseDescriptor = Readonly<{
  status: number;
  body: ClientResponseBody;
  headers: readonly ClientResponseHeaderDescriptor[];
}>;

type ClientOperationContract = Readonly<{
  path: string;
  method: "GET" | "POST" | "DELETE";
  access: Readonly<{
    auth: "bearer" | "origin-only";
    scope: string | null;
    ownership: "job-owner" | "none" | "token-self";
  }>;
  pathParameters: readonly ClientPathParameter[];
  request: Readonly<{ body: ClientRequestBody }>;
  responses: readonly ClientResponseDescriptor[];
}>;

type ClientHeaderSnapshot = Readonly<{
  cacheControl: string | null;
  contentLength: string | null;
  contentType: string | null;
  etag: string | null;
  location: string | null;
  retryAfter: string | null;
  requestId: string | null;
}>;

const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  "byteLength",
)?.get;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

export class CompanionProtocolError extends Error {
  readonly operationId: CompanionClientOperationId;
  readonly reason: CompanionProtocolErrorReason;
  readonly status: number | null;

  constructor(
    operationId: CompanionClientOperationId,
    reason: CompanionProtocolErrorReason,
    status: number | null,
  ) {
    super("Companion response failed protocol validation.");
    Object.defineProperty(this, "name", { value: "CompanionProtocolError", configurable: true });
    this.operationId = operationId;
    this.reason = reason;
    this.status = status;
  }
}

export class CompanionHttpError extends Error {
  readonly operationId: CompanionClientOperationId;
  readonly status: CompanionHttpStatus;
  readonly problem: Problem;
  readonly headers: CompanionResponseHeaders;

  constructor(
    operationId: CompanionClientOperationId,
    status: CompanionHttpStatus,
    problem: Problem,
    headers: CompanionResponseHeaders,
  ) {
    super("Companion request failed with a declared HTTP error.");
    Object.defineProperty(this, "name", { value: "CompanionHttpError", configurable: true });
    this.operationId = operationId;
    this.status = status;
    this.problem = problem;
    this.headers = headers;
  }
}

function clientOperationContract(operationId: CompanionClientOperationId): ClientOperationContract {
  return (
    HTTP_CONTRACT.operations as unknown as Readonly<
      Record<CompanionClientOperationId, ClientOperationContract>
    >
  )[operationId];
}

function throwIfClientAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined) AbortSignal.prototype.throwIfAborted.call(signal);
}

function throwProtocol(
  operationId: CompanionClientOperationId,
  reason: CompanionProtocolErrorReason,
  status: number | null,
  signal: AbortSignal | undefined,
): never {
  throwIfClientAborted(signal);
  throw new CompanionProtocolError(operationId, reason, status);
}

function invalidOptions(): never {
  throw new TypeError("Invalid companion client options.");
}

function isNativeAbortSignal(value: unknown): value is AbortSignal {
  try {
    return value instanceof AbortSignal;
  } catch {
    return false;
  }
}

function exactOptions(
  operation: ClientOperationContract,
  value: unknown,
): Readonly<{ record: Readonly<Record<string, unknown>>; signal: AbortSignal | undefined }> {
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalidOptions();
    prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidOptions();
    keys = Reflect.ownKeys(value);
  } catch {
    invalidOptions();
  }
  const record = value as Readonly<Record<string, unknown>>;
  const allowed = new Set<string>(operation.pathParameters.map((parameter) => parameter.name));
  const required = new Set<string>(allowed);
  if (operation.request.body.kind === "json") {
    allowed.add("body");
    required.add("body");
  }
  if (operation.access.auth === "bearer") {
    allowed.add("token");
    required.add("token");
  }
  allowed.add("signal");
  let signal: AbortSignal | undefined;
  const present = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.has(key)) invalidOptions();
    present.add(key);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch {
      invalidOptions();
    }
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      invalidOptions();
    }
    if (key === "signal") {
      if (!isNativeAbortSignal(descriptor.value)) invalidOptions();
      signal = descriptor.value;
    }
  }
  for (const name of required) {
    if (!present.has(name)) invalidOptions();
  }
  return { record, signal };
}

function optionValue(record: Readonly<Record<string, unknown>>, name: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (descriptor === undefined || !("value" in descriptor)) invalidOptions();
    return descriptor.value;
  } catch {
    invalidOptions();
  }
}

function parseClientOwned(name: OwnedSchemaName, value: unknown): JsonValue {
  const result = validateOwned(name, value);
  if (!result.valid) throw new ProtocolValidationError(name, result.path);
  return value as JsonValue;
}

function serializeClientBody(name: OwnedSchemaName, value: unknown): string {
  const validated = parseClientOwned(name, value);
  let serialized: string;
  try {
    const candidate = JSON.stringify(validated);
    if (typeof candidate !== "string") throw new TypeError();
    serialized = candidate;
  } catch {
    throw new TypeError("Invalid companion request body.");
  }
  const cap = (JSON_BYTE_CAPS as Readonly<Record<string, number>>)[name];
  if (cap === undefined || new TextEncoder().encode(serialized).byteLength > cap) {
    throw new TypeError("Invalid companion request body.");
  }
  let wireValue: unknown;
  try {
    wireValue = JSON.parse(serialized) as unknown;
  } catch {
    throw new TypeError("Invalid companion request body.");
  }
  const result = validateOwned(name, wireValue);
  if (!result.valid) throw new ProtocolValidationError(name, result.path);
  return serialized;
}

async function bestEffortCancelResponse(response: unknown): Promise<void> {
  try {
    if (response === null || typeof response !== "object") return;
    const body = (response as { readonly body?: unknown }).body;
    if (body === null || typeof body !== "object") return;
    const cancel = (body as { readonly cancel?: unknown }).cancel;
    if (typeof cancel === "function") await Reflect.apply(cancel, body, []);
  } catch {
    // Cancellation failures never mask the owned protocol failure.
  }
}

async function bestEffortCancelReader(reader: unknown): Promise<void> {
  try {
    if (reader === null || typeof reader !== "object") return;
    const cancel = (reader as { readonly cancel?: unknown }).cancel;
    if (typeof cancel === "function") await Reflect.apply(cancel, reader, []);
  } catch {
    // Cancellation failures never mask the owned protocol failure.
  }
}

function responseHeaders(
  response: Response,
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
): ClientHeaderSnapshot {
  const names = [
    ["cacheControl", "Cache-Control"],
    ["contentLength", "Content-Length"],
    ["contentType", "Content-Type"],
    ["etag", "ETag"],
    ["location", "Location"],
    ["retryAfter", "Retry-After"],
    ["requestId", "X-Request-Id"],
  ] as const;
  const values: Partial<Record<(typeof names)[number][0], string | null>> = {};
  try {
    const headers = response.headers;
    if (headers === null || typeof headers !== "object") throw new TypeError();
    const get = (headers as { readonly get?: unknown }).get;
    if (typeof get !== "function") throw new TypeError();
    for (const [field, name] of names) {
      const value = Reflect.apply(get, headers, [name]) as unknown;
      if (value !== null && typeof value !== "string") throw new TypeError();
      values[field] = value;
    }
  } catch {
    throwProtocol(operationId, "invalid-response-header", status, signal);
  }
  return values as ClientHeaderSnapshot;
}

function headerDescriptor(
  response: ClientResponseDescriptor,
  name: string,
): ClientResponseHeaderDescriptor | undefined {
  return response.headers.find((header) => header.name === name);
}

function canonicalDecimal(value: string, minimum: number, maximum: number): number | null {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) return null;
  return number;
}

function validExposedHeaderValue(value: string, schema: ClientHeaderSchema): boolean {
  if (schema.kind === "const") return value === schema.value;
  if (schema.kind === "bounded-string") {
    return (
      schema.minLength !== undefined &&
      schema.maxLength !== undefined &&
      value.length >= schema.minLength &&
      value.length <= schema.maxLength
    );
  }
  if (schema.kind === "bounded-integer") {
    return (
      schema.minimum !== undefined &&
      schema.maximum !== undefined &&
      canonicalDecimal(value, schema.minimum, schema.maximum) !== null
    );
  }
  if (schema.kind === "schema-ref" && schema.schemaRef !== undefined) {
    return validateOwned(schema.schemaRef, value).valid;
  }
  return false;
}

function validateExposedHeader(
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  response: ClientResponseDescriptor,
  name: "ETag" | "Location" | "Retry-After",
  value: string | null,
): number | string | null {
  const descriptor = headerDescriptor(response, name);
  if (descriptor === undefined) {
    if (value !== null) throwProtocol(operationId, "invalid-response-header", status, signal);
    return null;
  }
  if (value === null) {
    if (descriptor.required) throwProtocol(operationId, "invalid-response-header", status, signal);
    return null;
  }
  if (!validExposedHeaderValue(value, descriptor.schema)) {
    throwProtocol(operationId, "invalid-response-header", status, signal);
  }
  if (name === "Retry-After") return Number(value);
  return value;
}

function validateResponseHeaders(
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  descriptor: ClientResponseDescriptor,
  snapshot: ClientHeaderSnapshot,
): CompanionResponseHeaders {
  if (snapshot.cacheControl !== "no-store") {
    throwProtocol(operationId, "invalid-response-header", status, signal);
  }
  if (snapshot.requestId === null || !validateOwned("CanonicalUuid", snapshot.requestId).valid) {
    throwProtocol(operationId, "invalid-response-header", status, signal);
  }
  const etag = validateExposedHeader(
    operationId,
    status,
    signal,
    descriptor,
    "ETag",
    snapshot.etag,
  );
  const location = validateExposedHeader(
    operationId,
    status,
    signal,
    descriptor,
    "Location",
    snapshot.location,
  );
  const retryAfter = validateExposedHeader(
    operationId,
    status,
    signal,
    descriptor,
    "Retry-After",
    snapshot.retryAfter,
  );
  return Object.freeze({
    requestId: snapshot.requestId as CanonicalUuid,
    etag: etag as string | null,
    location: location as string | null,
    retryAfterSeconds: retryAfter as number | null,
  });
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return false;
  }
  return true;
}

function matchesJsonContentType(value: string, expected: string): boolean {
  if (!isAscii(value)) return false;
  const match = /^(application\\/json|application\\/problem\\+json)(?:[ \\t]*;[ \\t]*charset[ \\t]*=[ \\t]*(?:utf-8|"utf-8"))?$/i.exec(
    value,
  );
  return match !== null && match[1]!.toLowerCase() === expected;
}

function validateContentType(
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  body: ClientResponseBody,
  value: string | null,
): void {
  let valid: boolean;
  if (body.kind === "empty") valid = value === null;
  else if (body.kind === "audio") {
    valid = value !== null && isAscii(value) && /^audio\\/wav$/i.test(value);
  }
  else valid = value !== null && matchesJsonContentType(value, body.mediaType);
  if (!valid) throwProtocol(operationId, "content-type-mismatch", status, signal);
}

function contentLength(
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  body: ClientResponseBody,
  value: string | null,
): number | null {
  if (value === null) return null;
  const parsed = canonicalDecimal(value, 0, Number.MAX_SAFE_INTEGER);
  if (parsed === null || (body.kind === "empty" && parsed !== 0)) {
    throwProtocol(operationId, "invalid-content-length", status, signal);
  }
  return parsed;
}

async function readBodyBytes(
  response: Response,
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  cap: number,
  declaredLength: number | null,
  emptyBody: boolean,
): Promise<Uint8Array> {
  if (declaredLength !== null && declaredLength > cap) {
    throwProtocol(operationId, "body-too-large", status, signal);
  }
  let body: ReadableStream<Uint8Array> | null;
  try {
    body = response.body;
  } catch {
    throwProtocol(operationId, "body-unreadable", status, signal);
  }
  if (body === null) {
    if (declaredLength !== null && declaredLength !== 0) {
      throwProtocol(operationId, "content-length-mismatch", status, signal);
    }
    return new Uint8Array();
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = body.getReader();
  } catch {
    throwProtocol(operationId, "body-unreadable", status, signal);
  }
  const chunks: Array<Readonly<{ value: Uint8Array; byteLength: number }>> = [];
  let total = 0;
  while (true) {
    throwIfClientAborted(signal);
    let part: ReadableStreamReadResult<Uint8Array>;
    try {
      part = await reader.read();
    } catch {
      throwIfClientAborted(signal);
      throwProtocol(operationId, "body-unreadable", status, signal);
    }
    throwIfClientAborted(signal);
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      if (part === null || typeof part !== "object") throw new TypeError();
      done = part.done;
      if (typeof done !== "boolean") throw new TypeError();
      if (!done) value = part.value;
    } catch {
      await bestEffortCancelReader(reader);
      throwProtocol(operationId, "body-unreadable", status, signal);
    }
    if (done) break;
    let valueByteLength: number;
    try {
      if (!(value instanceof Uint8Array) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) {
        throw new TypeError();
      }
      const measured = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as unknown;
      if (typeof measured !== "number" || !Number.isSafeInteger(measured) || measured < 0) {
        throw new TypeError();
      }
      valueByteLength = measured;
    } catch {
      await bestEffortCancelReader(reader);
      throwIfClientAborted(signal);
      throwProtocol(operationId, "body-unreadable", status, signal);
    }
    const nextTotal = total + valueByteLength;
    if (!Number.isSafeInteger(nextTotal) || nextTotal > cap) {
      await bestEffortCancelReader(reader);
      throwProtocol(
        operationId,
        emptyBody ? "unexpected-body" : "body-too-large",
        status,
        signal,
      );
    }
    if (declaredLength !== null && nextTotal > declaredLength) {
      await bestEffortCancelReader(reader);
      throwProtocol(operationId, "content-length-mismatch", status, signal);
    }
    let ownedValue: Uint8Array;
    try {
      ownedValue = new Uint8Array(valueByteLength);
      Reflect.apply(UINT8_ARRAY_SET, ownedValue, [value, 0]);
    } catch {
      await bestEffortCancelReader(reader);
      throwIfClientAborted(signal);
      throwProtocol(operationId, "body-unreadable", status, signal);
    }
    chunks.push({ value: ownedValue, byteLength: valueByteLength });
    total = nextTotal;
  }
  if (declaredLength !== null && total !== declaredLength) {
    throwProtocol(operationId, "content-length-mismatch", status, signal);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(total);
  } catch {
    await bestEffortCancelReader(reader);
    throwIfClientAborted(signal);
    throwProtocol(operationId, "body-unreadable", status, signal);
  }
  let offset = 0;
  for (const chunk of chunks) {
    try {
      Reflect.apply(UINT8_ARRAY_SET, bytes, [chunk.value, offset]);
      offset += chunk.byteLength;
    } catch {
      await bestEffortCancelReader(reader);
      throwIfClientAborted(signal);
      throwProtocol(operationId, "body-unreadable", status, signal);
    }
  }
  return bytes;
}

function parseResponseJson(
  operationId: CompanionClientOperationId,
  status: number,
  signal: AbortSignal | undefined,
  schemaRef: OwnedSchemaName,
  bytes: Uint8Array,
): JsonValue {
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throwProtocol(operationId, "invalid-utf8", status, signal);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throwIfClientAborted(signal);
    throwProtocol(operationId, "invalid-utf8", status, signal);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throwIfClientAborted(signal);
    throwProtocol(operationId, "invalid-json", status, signal);
  }
  const validation = validateOwned(schemaRef, value);
  if (!validation.valid) throwProtocol(operationId, "schema-mismatch", status, signal);
  return recursivelyFreeze(value as JsonValue);
}

async function validateClientResponse(
  operationId: CompanionClientOperationId,
  operation: ClientOperationContract,
  requestedUrl: string,
  response: unknown,
  signal: AbortSignal | undefined,
): Promise<Readonly<{ status: number; body: unknown; headers: CompanionResponseHeaders }>> {
  if (response === null || typeof response !== "object") {
    throwProtocol(operationId, "invalid-response", null, signal);
  }
  let type: unknown;
  let url: unknown;
  let redirected: unknown;
  try {
    type = (response as Response).type;
    url = (response as Response).url;
    redirected = (response as Response).redirected;
  } catch {
    throwProtocol(operationId, "invalid-response", null, signal);
  }
  if (type !== "cors") throwProtocol(operationId, "response-type-mismatch", null, signal);
  if (url !== requestedUrl) throwProtocol(operationId, "response-url-mismatch", null, signal);
  if (redirected !== false) throwProtocol(operationId, "redirected-response", null, signal);

  let status: unknown;
  try {
    status = (response as Response).status;
  } catch {
    throwProtocol(operationId, "invalid-response", null, signal);
  }
  if (
    typeof status !== "number" ||
    !Number.isSafeInteger(status) ||
    status < 200 ||
    status > 599
  ) {
    throwProtocol(operationId, "invalid-response", null, signal);
  }
  const numericStatus = status as number;
  const descriptor = operation.responses.find((candidate) => candidate.status === numericStatus);
  if (descriptor === undefined) throwProtocol(operationId, "unknown-status", numericStatus, signal);

  const snapshot = responseHeaders(response as Response, operationId, numericStatus, signal);
  const headers = validateResponseHeaders(
    operationId,
    numericStatus,
    signal,
    descriptor,
    snapshot,
  );
  validateContentType(operationId, numericStatus, signal, descriptor.body, snapshot.contentType);
  const declaredLength = contentLength(
    operationId,
    numericStatus,
    signal,
    descriptor.body,
    snapshot.contentLength,
  );
  const cap =
    descriptor.body.kind === "json"
      ? (JSON_BYTE_CAPS as Readonly<Record<string, number>>)[descriptor.body.schemaRef]
      : descriptor.body.kind === "audio"
        ? descriptor.body.maxBytes
        : 0;
  if (cap === undefined) throwProtocol(operationId, "invalid-response", numericStatus, signal);
  const bytes = await readBodyBytes(
    response as Response,
    operationId,
    numericStatus,
    signal,
    cap,
    declaredLength,
    descriptor.body.kind === "empty",
  );

  let body: unknown;
  if (descriptor.body.kind === "empty") {
    body = undefined;
  } else if (descriptor.body.kind === "audio") {
    body = Object.freeze({ mediaType: "audio/wav" as const, bytes });
  } else {
    body = parseResponseJson(
      operationId,
      numericStatus,
      signal,
      descriptor.body.schemaRef,
      bytes,
    );
  }

  const successful = numericStatus >= 200 && numericStatus < 300;
  if (!successful) {
    const problem = body as Problem;
    if (!(HTTP_CONTRACT.policy.problemCodes.http as readonly string[]).includes(problem.code)) {
      throwProtocol(operationId, "non-http-problem-code", numericStatus, signal);
    }
    if (problem.status !== numericStatus) {
      throwProtocol(operationId, "problem-status-mismatch", numericStatus, signal);
    }
    const retryDescriptor = headerDescriptor(descriptor, "Retry-After");
    if (retryDescriptor?.condition === "queue-full-problem") {
      const required = problem.code === HTTP_CONTRACT.policy.retryAfter.queueFullProblemCode;
      if ((headers.retryAfterSeconds !== null) !== required) {
        throwProtocol(operationId, "invalid-response-header", numericStatus, signal);
      }
    }
    throw new CompanionHttpError(
      operationId,
      numericStatus as CompanionHttpStatus,
      problem,
      headers,
    );
  }
  return Object.freeze({ status: numericStatus, body, headers });
}

async function executeClientOperation<Result>(
  operationId: CompanionClientOperationId,
  rawOptions: unknown,
  fetchImpl: CompanionFetch,
): Promise<Result> {
  const operation = clientOperationContract(operationId);
  const { record, signal } = exactOptions(operation, rawOptions);
  throwIfClientAborted(signal);

  let path = operation.path;
  for (const parameter of operation.pathParameters) {
    const value = parseClientOwned(parameter.schemaRef, optionValue(record, parameter.name));
    path = path.replace("{" + parameter.name + "}", value as string);
  }
  const headers: Partial<Record<CompanionRequestHeaderName, string>> = {
    "X-OVP-Client-Version": COMPANION_CLIENT_VERSION,
  };
  let serializedBody: string | undefined;
  if (operation.request.body.kind === "json") {
    serializedBody = serializeClientBody(operation.request.body.schemaRef, optionValue(record, "body"));
    headers["Content-Type"] = "application/json";
  }
  if (operation.access.auth === "bearer") {
    const validatedToken = parseClientOwned("OpaqueSecret", optionValue(record, "token"));
    headers.Authorization = "Bearer " + (validatedToken as string);
  }
  const requestedUrl = COMPANION_API_ORIGIN + path;
  const init = Object.freeze({
    method: operation.method,
    mode: "cors" as const,
    credentials: "omit" as const,
    cache: "no-store" as const,
    redirect: "error" as const,
    targetAddressSpace: "loopback" as const,
    headers: Object.freeze(headers),
    ...(serializedBody === undefined ? {} : { body: serializedBody }),
    ...(signal === undefined ? {} : { signal }),
  }) satisfies CompanionRequestInit;

  const response = await fetchImpl(requestedUrl, init);
  try {
    throwIfClientAborted(signal);
  } catch (error) {
    await bestEffortCancelResponse(response);
    throw error;
  }
  try {
    const result = (await validateClientResponse(
      operationId,
      operation,
      requestedUrl,
      response,
      signal,
    )) as Result;
    throwIfClientAborted(signal);
    return result;
  } catch (error) {
    try {
      throwIfClientAborted(signal);
    } catch (abortError) {
      await bestEffortCancelResponse(response);
      throw abortError;
    }
    if (error instanceof CompanionProtocolError) {
      await bestEffortCancelResponse(response);
      throwIfClientAborted(signal);
    }
    throw error;
  }
}
`;

export function generateProtocol(document) {
  if (!isPlainObject(document) || !isPlainObject(document.components)) {
    fail('OpenAPI document or components are missing.');
  }
  const schemas = document.components.schemas;
  if (!isPlainObject(schemas) || Object.keys(schemas).length === 0)
    fail('owned schemas are missing.');
  assertProtocolNamePolicy(document);
  for (const [name, schema] of sortedEntries(schemas)) {
    if (!/^[A-Z][A-Za-z0-9]*$/u.test(name)) fail(`schema identifier ${name} is invalid.`);
    if (reservedSchemaNames.has(name)) fail(`schema identifier ${name} is reserved.`);
    validateSchema(schema, `components.schemas.${name}`, schemas);
  }
  assertAcyclicReferences(schemas);
  const httpContract = buildHttpContract(document);
  const clientOperations = collectClientOperations(httpContract, schemas);
  const routes = collectRoutes(clientOperations);
  const jsonByteCaps = collectJsonByteCaps(clientOperations, schemas);
  const server = document.servers?.[0]?.url;
  const version = document.info?.version;
  const protocolMajor = document['x-protocol-major'];
  if (
    typeof server !== 'string' ||
    typeof version !== 'string' ||
    !Number.isSafeInteger(protocolMajor)
  ) {
    fail('server, version, or protocol major metadata is invalid.');
  }

  const sortedSchemas = Object.fromEntries(
    sortedEntries(schemas).map(([name, schema]) => [name, canonicalRuntimeSchema(schema)]),
  );
  const schemaNames = sortedEntries(schemas).map(([name]) => name);
  const lines = [
    '// Generated from openapi/openapi.yaml. Do not edit by hand.',
    freezeSource.trim(),
    '',
    `export const COMPANION_API_ORIGIN = ${JSON.stringify(server)} as const;`,
    `export const CLIENT_VERSION = ${JSON.stringify(version)} as const;`,
    'export const COMPANION_CLIENT_VERSION = CLIENT_VERSION;',
    `export const PROTOCOL_MAJOR = ${JSON.stringify(protocolMajor)} as const;`,
    `export const HTTP_CONTRACT = recursivelyFreeze(${JSON.stringify(httpContract, null, 2)} as const);`,
    `export const ROUTES = recursivelyFreeze(${JSON.stringify(routes, null, 2)} as const);`,
    `const JSON_BYTE_CAPS = recursivelyFreeze(${JSON.stringify(jsonByteCaps, null, 2)} as const);`,
    '',
    'declare const protocolBrand: unique symbol;',
    'type Brand<Name extends string> = { readonly [protocolBrand]: { readonly [Key in Name]: true } };',
    '',
  ];
  for (const [name, schema] of sortedEntries(schemas)) {
    lines.push(
      `export type ${name} = (${schemaType(schema, name)}) & Brand<${JSON.stringify(name)}>;`,
      '',
    );
  }
  lines.push(
    clientTypeSource(clientOperations, httpContract),
    '',
    `export type OwnedSchemaName = ${schemaNames.map((name) => JSON.stringify(name)).join(' | ')};`,
    '',
    runtimeSource.trim(),
    '',
    `const SCHEMAS = recursivelyFreeze(JSON.parse(${JSON.stringify(JSON.stringify(sortedSchemas))}) as Readonly<Record<OwnedSchemaName, RuntimeSchema>>);`,
    '',
  );
  for (const [name] of sortedEntries(schemas)) {
    lines.push(
      `export function is${name}(value: unknown): value is ${name} {`,
      `  return validateOwned(${JSON.stringify(name)}, value).valid;`,
      '}',
      '',
      `export function parse${name}(value: unknown): ${name} {`,
      `  const result = validateOwned(${JSON.stringify(name)}, value);`,
      `  if (!result.valid) throw new ProtocolValidationError(${JSON.stringify(name)}, result.path);`,
      `  return value as ${name};`,
      '}',
      '',
    );
  }
  lines.push(clientRuntimeSource.trim(), '', clientFactorySource(clientOperations), '');
  return `${lines.join('\n').trimEnd()}\n`;
}
