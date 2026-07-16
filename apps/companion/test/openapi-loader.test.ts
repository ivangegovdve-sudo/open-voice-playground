import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const fileIoTripwires = vi.hoisted(() => ({
  createReadStream: vi.fn(),
  lstat: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    createReadStream: (...args: Parameters<typeof original.createReadStream>) => {
      fileIoTripwires.createReadStream(args[0]);
      return original.createReadStream(...args);
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    lstat: (...args: Parameters<typeof original.lstat>) => {
      fileIoTripwires.lstat(args[0]);
      return original.lstat(...args);
    },
    readFile: (...args: Parameters<typeof original.readFile>) => {
      fileIoTripwires.readFile(args[0]);
      return original.readFile(...args);
    },
    readlink: (...args: Parameters<typeof original.readlink>) => {
      fileIoTripwires.readlink(args[0]);
      return original.readlink(...args);
    },
  };
});

import {
  OpenApiDocumentError,
  loadOpenApiDocument,
  loadOpenApiDocumentFromText,
} from '../scripts/openapi-loader.mjs';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'openapi/openapi.yaml');
const structuralSchemaPath = resolve(root, 'openapi/vendor/oas-3.1-schema-2025-11-23.json');

async function authoritativeSource(): Promise<string> {
  return readFile(sourcePath, 'utf8');
}

function replaceFirstReference(source: string, reference: string): string {
  return source.replace(
    "$ref: '#/components/parameters/Origin'",
    `$ref: ${JSON.stringify(reference)}`,
  );
}

async function expectCode(source: string, code: string): Promise<void> {
  await expect(loadOpenApiDocumentFromText(source, '<fixture>')).rejects.toEqual(
    expect.objectContaining({ code }),
  );
}

describe('offline OpenAPI document loader', () => {
  it('loads the authoritative document through the same strict path used by generation', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is forbidden during OpenAPI loading');
    });
    vi.stubGlobal('fetch', fetchSpy);
    let document: Awaited<ReturnType<typeof loadOpenApiDocument>>;
    try {
      document = await loadOpenApiDocument();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(document).toMatchObject({
      openapi: '3.1.2',
      info: { version: '1.0.0' },
      'x-protocol-major': 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('vendors the exact official OAS 3.1 structural schema bytes', async () => {
    const bytes = await readFile(structuralSchemaPath);

    expect(bytes).toHaveLength(33_452);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '1b8ccc6e34234b17536f2dd0eb3597142a32bd108438cd42471a5fca4c1a07ef',
    );
    expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
      $id: 'https://spec.openapis.org/oas/3.1/schema/2025-11-23',
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    });
  });

  it('rejects duplicate mapping keys instead of accepting last-value-wins YAML', async () => {
    const source = await authoritativeSource();
    await expectCode(`openapi: 3.1.2\n${source}`, 'yaml-invalid');
  });

  it.each([
    ['alias', 'x-source: &shared [health]\nx-copy: *shared\npaths:'],
    ['unused anchor', 'x-source: &shared [health]\npaths:'],
    ['merge key', 'x-copy:\n  <<: {safe: true}\npaths:'],
  ])('rejects YAML %s constructs', async (_name, insertion) => {
    const source = (await authoritativeSource()).replace('paths:', insertion);
    await expectCode(source, 'yaml-unsafe-feature');
  });

  it('rejects custom YAML tags and all parser warnings', async () => {
    const source = (await authoritativeSource()).replace(
      'title: Open Voice Playground Companion API',
      'title: !untrusted Open Voice Playground Companion API',
    );
    await expectCode(source, 'yaml-invalid');
  });

  it('rejects multiple YAML documents', async () => {
    await expectCode(`${await authoritativeSource()}\n---\nopenapi: 3.1.2\n`, 'yaml-invalid');
  });

  it('rejects a syntactically valid but structurally invalid OpenAPI document', async () => {
    const source = (await authoritativeSource()).replace('openapi: 3.1.2', 'openapi: invalid');
    await expectCode(source, 'openapi-structure-invalid');
  });

  it('validates every embedded Schema Object against the declared Draft 2020-12 dialect', async () => {
    const source = (await authoritativeSource()).replace('maxLength: 2000', 'maxLength: invalid');
    await expectCode(source, 'openapi-structure-invalid');
  });

  it('rejects a different or missing JSON Schema dialect', async () => {
    const source = await authoritativeSource();
    await expectCode(
      source.replace(
        'https://json-schema.org/draft/2020-12/schema',
        'https://json-schema.org/draft/2019-09/schema',
      ),
      'openapi-structure-invalid',
    );
    await expectCode(
      source.replace('jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema\n', ''),
      'openapi-structure-invalid',
    );
  });

  it.each([
    'https://attacker.invalid/schema.yaml#/Thing',
    'http://attacker.invalid/schema.yaml#/Thing',
    'file:///C:/private/schema.yaml#/Thing',
    '../schema.yaml#/Thing',
    './schema.yaml#/Thing',
    'schema.yaml#/Thing',
    '//attacker.invalid/schema.yaml#/Thing',
    '#/components/schemas/Voice%49d',
  ])('rejects external or noncanonical reference %s', async (reference) => {
    const source = replaceFirstReference(await authoritativeSource(), reference);
    for (const tripwire of Object.values(fileIoTripwires)) {
      tripwire.mockClear();
    }
    const fetchTripwire = vi.fn(() => {
      throw new Error('external references must not touch the network');
    });
    vi.stubGlobal('fetch', fetchTripwire);
    try {
      await expectCode(source, 'reference-invalid');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchTripwire).not.toHaveBeenCalled();
    for (const tripwire of Object.values(fileIoTripwires)) {
      expect(tripwire).not.toHaveBeenCalled();
    }
  });

  it.each(['x-bad space', 'x-bad#fragment', 'x-bad\\path', 'x-bad\tpath'])(
    'rejects raw non-URI character references even when the key %j exists',
    async (key) => {
      const source = replaceFirstReference(
        (await authoritativeSource()).replace('paths:', `${JSON.stringify(key)}: true\npaths:`),
        `#/${key}`,
      );
      await expectCode(source, 'reference-invalid');
    },
  );

  it.each(['$dynamicRef', '$recursiveRef', 'operationRef'])(
    'rejects external %s references without trying to resolve them',
    async (keyword) => {
      const source = (await authoritativeSource()).replace(
        'paths:',
        `x-reference:\n  ${keyword}: https://attacker.invalid/schema.yaml#/Thing\npaths:`,
      );
      await expectCode(source, 'reference-invalid');
    },
  );

  it('rejects non-string, invalid-pointer, and dangling local references', async () => {
    const source = await authoritativeSource();
    await expectCode(
      source.replace("$ref: '#/components/parameters/Origin'", '$ref: 42'),
      'reference-invalid',
    );
    await expectCode(
      replaceFirstReference(source, '#/components/schemas/Voice~2Id'),
      'reference-invalid',
    );
    await expectCode(
      replaceFirstReference(source, '#/components/schemas/DoesNotExist'),
      'reference-unresolved',
    );
  });

  it.each([
    ['$id', 'https://attacker.invalid/schema.json'],
    ['$id', '../schema.json'],
    ['$id', '#rebased'],
    ['$anchor', 'rebased'],
    ['$dynamicAnchor', 'rebased'],
    ['$recursiveAnchor', 'true'],
  ])('rejects nested %s values that can rebase or retarget references', async (keyword, value) => {
    const source = (await authoritativeSource()).replace(
      '    JobCreateRequest:\n      type: object',
      `    JobCreateRequest:\n      ${keyword}: ${JSON.stringify(value)}\n      type: object`,
    );
    await expectCode(source, 'reference-base-forbidden');
  });

  it('allows only the declared Draft 2020-12 $schema identifier in owned schemas', async () => {
    const source = await authoritativeSource();
    const insert = (dialect: string): string =>
      source.replace(
        '    JobCreateRequest:\n      type: object',
        `    JobCreateRequest:\n      $schema: ${dialect}\n      type: object`,
      );

    await expect(
      loadOpenApiDocumentFromText(
        insert('https://json-schema.org/draft/2020-12/schema'),
        '<fixture>',
      ),
    ).resolves.toMatchObject({ openapi: '3.1.2' });
    await expectCode(insert('https://attacker.invalid/dialect/schema'), 'reference-base-forbidden');
  });

  it('reports errors without leaking source contents', async () => {
    const secretMarker = 'plaintext-secret-must-not-escape';
    let caught: unknown;
    try {
      await loadOpenApiDocumentFromText(
        `${await authoritativeSource()}\n${secretMarker}: !unsafe value\n`,
        'fixture-with-secret.yaml',
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OpenApiDocumentError);
    expect(String(caught)).not.toContain(secretMarker);
  });
});
