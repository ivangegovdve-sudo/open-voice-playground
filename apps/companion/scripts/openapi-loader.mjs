import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  hasSchema,
  registerSchema,
  unregisterSchema,
  validate,
} from '@hyperjump/json-schema/draft-2020-12';
import { isAlias, isPair, isScalar, parseAllDocuments, visit } from 'yaml';

const root = resolve(import.meta.dirname, '..');

export const OPENAPI_SOURCE_PATH = resolve(root, 'openapi/openapi.yaml');
export const OAS_SCHEMA_PATH = resolve(root, 'openapi/vendor/oas-3.1-schema-2025-11-23.json');
export const OAS_SCHEMA_ID = 'https://spec.openapis.org/oas/3.1/schema/2025-11-23';
export const OAS_SCHEMA_BYTES = 33_452;
export const OAS_SCHEMA_SHA256 = '1b8ccc6e34234b17536f2dd0eb3597142a32bd108438cd42471a5fca4c1a07ef';

const draft202012 = 'https://json-schema.org/draft/2020-12/schema';
const structuralWrapperId = 'urn:ovp:oas-3.1-draft-2020-12';
const referenceKeywords = new Set(['$ref', '$dynamicRef', '$recursiveRef', 'operationRef']);
let structuralValidatorPromise;

export class OpenApiDocumentError extends Error {
  constructor(code, sourceName) {
    super(`OpenAPI document rejected (${code}) in ${sourceName}.`);
    this.name = 'OpenApiDocumentError';
    this.code = code;
    this.sourceName = sourceName;
  }
}

function reject(code, sourceName) {
  throw new OpenApiDocumentError(code, sourceName);
}

function parseYaml(source, sourceName) {
  const documents = parseAllDocuments(source, {
    customTags: [],
    logLevel: 'silent',
    merge: false,
    resolveKnownTags: false,
    schema: 'core',
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: '1.2',
  });
  if (documents.length !== 1) reject('yaml-invalid', sourceName);
  const [document] = documents;

  if (document === undefined || document.errors.length > 0 || document.warnings.length > 0) {
    reject('yaml-invalid', sourceName);
  }

  let unsafeFeature = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) unsafeFeature = true;
    if (
      node !== null &&
      typeof node === 'object' &&
      ('anchor' in node || 'tag' in node) &&
      (node.anchor !== undefined || node.tag !== undefined)
    ) {
      unsafeFeature = true;
    }
    if (
      isPair(node) &&
      isScalar(node.key) &&
      typeof node.key.value === 'string' &&
      node.key.value === '<<'
    ) {
      unsafeFeature = true;
    }
  });
  if (unsafeFeature) reject('yaml-unsafe-feature', sourceName);

  let value;
  try {
    value = document.toJS({ maxAliasCount: 0, mapAsMap: false });
  } catch {
    reject('yaml-invalid', sourceName);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('openapi-structure-invalid', sourceName);
  }
  return value;
}

function decodePointerSegment(segment, sourceName) {
  if (segment.length === 0 || segment.includes('%') || !/^(?:[^~]|~[01])+$/.test(segment)) {
    reject('reference-invalid', sourceName);
  }
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveLocalReference(document, reference, sourceName) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) {
    reject('reference-invalid', sourceName);
  }
  const segments = reference
    .slice(2)
    .split('/')
    .map((segment) => decodePointerSegment(segment, sourceName));
  let current = document;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) reject('reference-invalid', sourceName);
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        reject('reference-unresolved', sourceName);
      }
      current = current[index];
      continue;
    }
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      reject('reference-unresolved', sourceName);
    }
    current = current[segment];
  }
}

function validateReferences(document, sourceName) {
  const stack = [document];
  const seen = new Set();
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (referenceKeywords.has(key)) resolveLocalReference(document, child, sourceName);
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
}

async function readVerifiedStructuralSchema() {
  const bytes = await readFile(OAS_SCHEMA_PATH);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== OAS_SCHEMA_BYTES || digest !== OAS_SCHEMA_SHA256) {
    throw new Error('Vendored OAS structural schema failed its fixed integrity check.');
  }
  const schema = JSON.parse(bytes.toString('utf8'));
  if (schema.$id !== OAS_SCHEMA_ID) {
    throw new Error('Vendored OAS structural schema has an unexpected identifier.');
  }
  return schema;
}

async function getStructuralValidator() {
  const schema = await readVerifiedStructuralSchema();
  if (structuralValidatorPromise === undefined) {
    if (hasSchema(OAS_SCHEMA_ID)) unregisterSchema(OAS_SCHEMA_ID);
    if (hasSchema(structuralWrapperId)) unregisterSchema(structuralWrapperId);
    registerSchema(schema, OAS_SCHEMA_ID);
    registerSchema(
      {
        $schema: draft202012,
        $id: structuralWrapperId,
        $ref: OAS_SCHEMA_ID,
        properties: {
          jsonSchemaDialect: { const: draft202012 },
        },
        required: ['jsonSchemaDialect'],
        $defs: {
          schema: {
            $dynamicAnchor: 'meta',
            $ref: draft202012,
            properties: {
              $schema: { const: draft202012 },
            },
          },
        },
      },
      structuralWrapperId,
    );
    structuralValidatorPromise = validate(structuralWrapperId);
  }
  return structuralValidatorPromise;
}

export async function loadOpenApiDocumentFromText(source, sourceName = '<memory>') {
  const document = parseYaml(source, sourceName);
  validateReferences(document, sourceName);

  let result;
  try {
    const validator = await getStructuralValidator();
    result = validator(document);
  } catch (error) {
    if (error instanceof OpenApiDocumentError) throw error;
    throw new OpenApiDocumentError('openapi-validator-failed', sourceName);
  }
  if (!result.valid) reject('openapi-structure-invalid', sourceName);
  return document;
}

export async function loadOpenApiDocument() {
  return loadOpenApiDocumentFromText(
    await readFile(OPENAPI_SOURCE_PATH, 'utf8'),
    'openapi/openapi.yaml',
  );
}
