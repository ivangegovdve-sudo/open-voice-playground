import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

function readManifest(path: string): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as {
    scripts: Record<string, string>;
  };
}

describe('root and companion policy', () => {
  it('wires complete root and companion gates', () => {
    const rootScripts = readManifest('package.json').scripts;
    const companionScripts = readManifest('apps/companion/package.json').scripts;

    expect(companionScripts.build).toBe(
      'npm run openapi:check && npm run corpus:check && tsc -p tsconfig.json',
    );
    expect(companionScripts['dependency:check']).toBe('node ./scripts/dependency-policy.mjs');

    expect(rootScripts.test).toBe(
      'npm run build:contracts && npm run build:catalog && npm run test:contracts && npm run test:catalog && npm run test:companion && npm run test:web && npm run rust:test',
    );
    expect(rootScripts['dependency:check']).toBe(
      'npm run dependency:check --workspace @open-voice/companion',
    );
    expect(rootScripts['companion:contract:check']).toBe(
      'npm run openapi:check --workspace @open-voice/companion && npm run corpus:check --workspace @open-voice/companion',
    );
    expect(rootScripts['rust:fmt:check']).toBe(
      'cargo fmt --manifest-path apps/companion/src-tauri/Cargo.toml -- --check',
    );
    expect(rootScripts['rust:clippy']).toBe(
      'cargo clippy --manifest-path apps/companion/src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings',
    );
    expect(rootScripts['rust:test']).toBe(
      'cargo test --manifest-path apps/companion/src-tauri/Cargo.toml --locked --all-targets --all-features -- --test-threads=1',
    );
    expect(rootScripts['rust:check:release']).toBe(
      'cargo check --manifest-path apps/companion/src-tauri/Cargo.toml --release --locked --lib',
    );
    expect(rootScripts['test:companion']).toBe('npm run test --workspace @open-voice/companion');

    expect(companionScripts.build.split(' && ')).toEqual([
      'npm run openapi:check',
      'npm run corpus:check',
      'tsc -p tsconfig.json',
    ]);

    const rootTestGates = rootScripts.test.split(' && ');
    expect(rootTestGates.slice(0, 2)).toEqual(['npm run build:contracts', 'npm run build:catalog']);
    expect(rootTestGates.findIndex((gate) => gate.startsWith('npm run test:'))).toBeGreaterThan(1);
    expect(rootTestGates).toContain('npm run test:companion');
    expect(rootTestGates.at(-1)).toBe('npm run rust:test');
  });
});
