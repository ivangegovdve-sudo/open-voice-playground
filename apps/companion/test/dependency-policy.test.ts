import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const packageFiles = [
  'package.json',
  'apps/companion/package.json',
  'apps/web/package.json',
  'packages/catalog/package.json',
  'packages/contracts/package.json',
];

describe('direct dependency policy', () => {
  it('uses exact npm dependency versions in every workspace manifest', () => {
    const floating: string[] = [];
    for (const file of packageFiles) {
      const manifest = JSON.parse(readFileSync(resolve(root, file), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const [name, requirement] of Object.entries(manifest[section] ?? {})) {
          if (
            !/^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|workspace:\d+\.\d+\.\d+)$/.test(requirement)
          ) {
            floating.push(`${file}:${section}:${name}=${requirement}`);
          }
        }
      }
    }
    expect(floating).toEqual([]);
  });

  it('uses exact Cargo requirements for the Tauri crate', () => {
    const manifestPath = resolve(root, 'apps/companion/src-tauri/Cargo.toml');
    expect(existsSync(manifestPath), 'Tauri Cargo.toml is missing').toBe(true);
    const manifest = readFileSync(manifestPath, 'utf8');
    const unpinned = [
      ...manifest.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\{[^\n]*version\s*=\s*"([^"]+)"/gm),
    ]
      .filter(([, , requirement]) => !requirement?.startsWith('='))
      .map(([, name, requirement]) => `${name}=${requirement}`);
    expect(unpinned).toEqual([]);
  });

  it('pins the Tauri CLI used by the companion scaffold', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'apps/companion/package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };
    expect(manifest.devDependencies?.['@tauri-apps/cli']).toBe('2.11.4');
  });
});
