import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';

const WORKER_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const WORKER_SOURCE_PATH = join(WORKER_DIRECTORY, 'supertonic.worker.ts');
const WORKSPACE_ROOT = resolve(WORKER_DIRECTORY, '../../../../..');
const execFile = promisify(execFileCallback);

test('installs the verified runtime with exactly two literal lazy ORT backend imports', async () => {
  const source = await readFile(WORKER_SOURCE_PATH, 'utf8');
  const dynamicImportSpecifiers = [
    ...source.matchAll(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g),
  ].map((match) => match[2]);

  expect(source).toContain('installSupertonicWorkerRuntime');
  expect(source).not.toContain('installUnverifiedEngineBoundary');
  expect(dynamicImportSpecifiers).toEqual(['onnxruntime-web', 'onnxruntime-web/wasm']);
  expect(source).not.toMatch(/\b(?:import|export)\s+(?:type\s+)?[^;]*\bfrom\s*['"]onnxruntime-web/);
});

test.each([
  {
    label: 'plain WASM',
    bundleFile: 'ort.wasm.bundle.min.mjs',
    runtimeFile: 'ort-wasm-simd-threaded.wasm',
    backend: 'wasm',
    navigatorSetup: '',
    expectedError: /No graph was found in the protobuf/,
  },
  {
    label: 'WebGPU JSEP',
    bundleFile: 'ort.bundle.min.mjs',
    runtimeFile: 'ort-wasm-simd-threaded.jsep.wasm',
    backend: 'webgpu',
    navigatorSetup:
      "Object.defineProperty(globalThis, 'navigator', { value: { gpu: { requestAdapter: async () => null } }, configurable: true });",
    expectedError: /Failed to get GPU adapter|no available backend/is,
  },
])(
  'initializes the real $label embedded glue from accepted bytes without ambient fetch',
  async ({ bundleFile, runtimeFile, backend, navigatorSetup, expectedError }) => {
    const probe = `
      import { readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { pathToFileURL } from 'node:url';

      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls += 1;
        throw new Error('ambient fetch forbidden');
      };
      ${navigatorSetup}

      const distribution = join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist');
      const ort = await import(pathToFileURL(join(distribution, ${JSON.stringify(bundleFile)})).href);
      const binary = await readFile(join(distribution, ${JSON.stringify(runtimeFile)}));
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = binary.buffer.slice(
        binary.byteOffset,
        binary.byteOffset + binary.byteLength,
      );

      let message = '';
      try {
        await ort.InferenceSession.create(new Uint8Array([8, 1]), {
          executionProviders: [${JSON.stringify(backend)}],
          graphOptimizationLevel: 'all',
        });
      } catch (error) {
        message = String(error);
      }
      process.stdout.write('__SUPERTONIC_ORT_PROBE__' + JSON.stringify({ fetchCalls, message }));
    `;
    const { stdout } = await execFile(process.execPath, ['--input-type=module', '--eval', probe], {
      cwd: WORKSPACE_ROOT,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const marker = '__SUPERTONIC_ORT_PROBE__';
    const markerIndex = stdout.lastIndexOf(marker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    const result = JSON.parse(stdout.slice(markerIndex + marker.length)) as {
      fetchCalls: number;
      message: string;
    };

    expect(result.fetchCalls).toBe(0);
    expect(result.message).toMatch(expectedError);
  },
  45_000,
);
