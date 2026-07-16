const supportedSchemaKeywords = new Set([
  '$ref',
  '$schema',
  'additionalProperties',
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
]);

const allowedTypes = new Set(['array', 'boolean', 'integer', 'number', 'object', 'string']);
const allowedFormats = new Set(['date-time', 'uuid']);
const methods = new Set(['delete', 'get', 'options', 'post']);
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
  if (schema.oneOf !== undefined) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length === 0) {
      fail(`${path}.oneOf must be a nonempty array.`);
    }
    schema.oneOf.forEach((branch, index) =>
      validateSchema(branch, `${path}.oneOf[${index}]`, schemas),
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
    schema.oneOf === undefined
  ) {
    fail(`${path} has no supported validation assertion.`);
  }
}

function assertAcyclicReferences(schemas) {
  const edges = new Map();
  function collect(schema, names) {
    if (schema.$ref !== undefined) names.add(referenceName(schema.$ref, schemas, '$ref'));
    if (Array.isArray(schema.oneOf)) for (const branch of schema.oneOf) collect(branch, names);
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
    } else if (key === 'oneOf') {
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

function collectRoutes(document) {
  if (!isPlainObject(document.paths)) fail('paths must be an object.');
  const routes = [];
  const operationIds = new Set();
  for (const [path, item] of sortedEntries(document.paths)) {
    if (!isPlainObject(item)) fail(`path ${path} is invalid.`);
    for (const [method, operation] of sortedEntries(item)) {
      if (!methods.has(method)) continue;
      if (!isPlainObject(operation) || typeof operation.operationId !== 'string') {
        fail(`${method.toUpperCase()} ${path} has no operationId.`);
      }
      if (!/^[a-z][A-Za-z0-9]*$/u.test(operation.operationId)) {
        fail(`operationId ${operation.operationId} is not a safe identifier.`);
      }
      if (operationIds.has(operation.operationId)) {
        fail(`duplicate operationId ${operation.operationId}.`);
      }
      operationIds.add(operation.operationId);
      routes.push([operation.operationId, `${method.toUpperCase()} ${path}`]);
    }
  }
  routes.sort(([left], [right]) => compareCodeUnits(left, right));
  return Object.fromEntries(routes);
}

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

export function generateProtocol(document) {
  if (!isPlainObject(document) || !isPlainObject(document.components)) {
    fail('OpenAPI document or components are missing.');
  }
  const schemas = document.components.schemas;
  if (!isPlainObject(schemas) || Object.keys(schemas).length === 0)
    fail('owned schemas are missing.');
  for (const [name, schema] of sortedEntries(schemas)) {
    if (!/^[A-Z][A-Za-z0-9]*$/u.test(name)) fail(`schema identifier ${name} is invalid.`);
    if (reservedSchemaNames.has(name)) fail(`schema identifier ${name} is reserved.`);
    validateSchema(schema, `components.schemas.${name}`, schemas);
  }
  assertAcyclicReferences(schemas);
  const routes = collectRoutes(document);
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
    `export const COMPANION_API_ORIGIN = ${JSON.stringify(server)} as const;`,
    `export const CLIENT_VERSION = ${JSON.stringify(version)} as const;`,
    `export const PROTOCOL_MAJOR = ${JSON.stringify(protocolMajor)} as const;`,
    `export const ROUTES = ${JSON.stringify(routes, null, 2)} as const;`,
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
    `export type OwnedSchemaName = ${schemaNames.map((name) => JSON.stringify(name)).join(' | ')};`,
    '',
    runtimeSource.trim(),
    '',
    `const SCHEMAS = JSON.parse(${JSON.stringify(JSON.stringify(sortedSchemas))}) as Readonly<Record<OwnedSchemaName, RuntimeSchema>>;`,
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
  return `${lines.join('\n').trimEnd()}\n`;
}
