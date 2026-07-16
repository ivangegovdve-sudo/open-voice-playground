import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'openapi/openapi.yaml');
const outputPath = resolve(root, 'src/generated/protocol.ts');

function schemaType(schema) {
  if (schema.$ref) return schema.$ref.split('/').at(-1);
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum))
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(schemaType).join(' | ');
  if (schema.type === 'array') return `readonly (${schemaType(schema.items)})[]`;
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties ?? {}).map(
      ([name, value]) =>
        `readonly ${JSON.stringify(name)}${required.has(name) ? '' : '?'}: ${schemaType(value)};`,
    );
    return `{ ${fields.join(' ')} }`;
  }
  return 'string';
}

function generate(document) {
  const schemas = document.components?.schemas ?? {};
  const routeNames = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => ['get', 'post', 'delete', 'options'].includes(method))
      .map(([method, operation]) => [operation.operationId, `${method.toUpperCase()} ${path}`]),
  );
  const lines = [
    '// Generated from openapi/openapi.yaml. Do not edit by hand.',
    `export const COMPANION_API_ORIGIN = ${JSON.stringify(document.servers?.[0]?.url)} as const;`,
    `export const CLIENT_VERSION = ${JSON.stringify(document.info?.version)} as const;`,
    `export const PROTOCOL_MAJOR = ${JSON.stringify(document['x-protocol-major'])} as const;`,
    `export const ROUTES = ${JSON.stringify(Object.fromEntries(routeNames), null, 2)} as const;`,
    '',
  ];
  for (const [name, schema] of Object.entries(schemas).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`export type ${name} = ${schemaType(schema)};`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

const document = parse(await readFile(sourcePath, 'utf8'));
const output = generate(document);
if (process.argv.includes('--write')) {
  await mkdir(resolve(root, 'src/generated'), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
} else if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = await readFile(outputPath, 'utf8');
  } catch {
    // The mismatch below is intentionally stable for CI.
  }
  if (current !== output) {
    throw new Error('Generated OpenAPI TypeScript is stale; run npm run openapi:generate.');
  }
} else {
  process.stdout.write(output);
}
