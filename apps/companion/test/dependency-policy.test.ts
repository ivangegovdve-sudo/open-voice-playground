import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  auditCargoManifest,
  auditNpmRepository,
  discoverNpmWorkspaceManifests,
} from '../scripts/dependency-policy.mjs';

const root = resolve(import.meta.dirname, '../../..');

function writeJson(path: string, value: unknown): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createNpmFixture(): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'open-voice-c10-npm-'));
  const rootManifest = {
    name: 'fixture-root',
    version: '1.0.0',
    private: true,
    packageManager: 'npm@11.16.0',
    engines: { node: '>=22.13.0' },
    workspaces: ['apps/*'],
  };
  const knownManifest = {
    name: '@fixture/known',
    version: '1.0.0',
    private: true,
  };
  const newManifest = {
    name: '@fixture/new',
    version: '1.0.0',
    private: true,
    peerDependencies: { react: '^19.0.0' },
  };
  writeJson(resolve(fixture, 'package.json'), rootManifest);
  writeJson(resolve(fixture, 'apps/known/package.json'), knownManifest);
  writeJson(resolve(fixture, 'apps/new/package.json'), newManifest);
  writeJson(resolve(fixture, 'package-lock.json'), {
    name: rootManifest.name,
    version: rootManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': rootManifest,
      'apps/known': knownManifest,
      'apps/new': newManifest,
      'node_modules/@fixture/known': { resolved: 'apps/known', link: true },
      'node_modules/@fixture/new': { resolved: 'apps/new', link: true },
    },
  });
  return fixture;
}

function createWorkspaceDiscoveryFixture(
  workspaces: string[] | { packages: string[] },
  workspacePaths: string[],
): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'open-voice-c10-workspaces-'));
  writeJson(resolve(fixture, 'package.json'), {
    name: 'fixture-root',
    version: '1.0.0',
    private: true,
    packageManager: 'npm@11.16.0',
    engines: { node: '>=22.13.0' },
    workspaces,
  });
  for (const [index, path] of workspacePaths.entries()) {
    writeJson(resolve(fixture, path, 'package.json'), {
      name: `@fixture/workspace-${index}`,
      version: '1.0.0',
      private: true,
    });
  }
  writeJson(resolve(fixture, 'package-lock.json'), {
    name: 'fixture-root',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {},
  });
  return fixture;
}

function createRequirementFixture(section: string, requirement: string): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'open-voice-c10-requirement-'));
  const internal = requirement.startsWith('workspace:');
  const dependencyName = internal ? '@fixture/internal' : 'external';
  const rootManifest = {
    name: 'fixture-root',
    version: '1.0.0',
    private: true,
    packageManager: 'npm@11.16.0',
    engines: { node: '>=22.13.0' },
    workspaces: ['apps/*'],
  };
  const appManifest = {
    name: '@fixture/app',
    version: '1.0.0',
    private: true,
    [section]: { [dependencyName]: requirement },
  };
  const packages: Record<string, unknown> = {
    '': rootManifest,
    'apps/app': appManifest,
    'node_modules/@fixture/app': { resolved: 'apps/app', link: true },
  };
  if (internal) {
    const internalManifest = {
      name: '@fixture/internal',
      version: requirement.slice('workspace:'.length),
      private: true,
    };
    packages['apps/internal'] = internalManifest;
    packages['node_modules/@fixture/internal'] = { resolved: 'apps/internal', link: true };
    writeJson(resolve(fixture, 'apps/internal/package.json'), internalManifest);
  } else if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requirement)) {
    packages['node_modules/external'] = {
      version: requirement,
      resolved: `https://registry.npmjs.org/external/-/external-${requirement}.tgz`,
      integrity: 'sha512-fixture',
    };
  }
  writeJson(resolve(fixture, 'package.json'), rootManifest);
  writeJson(resolve(fixture, 'apps/app/package.json'), appManifest);
  writeJson(resolve(fixture, 'package-lock.json'), {
    name: rootManifest.name,
    version: rootManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages,
  });
  return fixture;
}

type NpmLockFixture = {
  rootManifest: Record<string, unknown>;
  appManifest: Record<string, unknown>;
  internalManifest: Record<string, unknown>;
  lock: { packages: Record<string, Record<string, unknown>> } & Record<string, unknown>;
};

function createNpmLockFixture(mutate?: (fixture: NpmLockFixture) => void): string {
  const fixture = mkdtempSync(resolve(tmpdir(), 'open-voice-c10-lock-'));
  const rootManifest = {
    name: 'fixture-root',
    version: '1.0.0',
    private: true,
    packageManager: 'npm@11.16.0',
    engines: { node: '>=22.13.0' },
    workspaces: ['apps/*'],
    devDependencies: { ajv: '6.15.0' },
  };
  const appManifest = {
    name: '@fixture/app',
    version: '1.0.0',
    private: true,
    devDependencies: { '@fixture/internal': '1.0.0', ajv: '8.20.0' },
  };
  const internalManifest = {
    name: '@fixture/internal',
    version: '1.0.0',
    private: true,
  };
  const lock: NpmLockFixture['lock'] = {
    name: rootManifest.name,
    version: rootManifest.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: rootManifest.name,
        version: rootManifest.version,
        workspaces: rootManifest.workspaces,
        devDependencies: rootManifest.devDependencies,
        engines: rootManifest.engines,
      },
      'apps/app': {
        name: appManifest.name,
        version: appManifest.version,
        devDependencies: appManifest.devDependencies,
      },
      'apps/internal': {
        name: internalManifest.name,
        version: internalManifest.version,
      },
      'node_modules/@fixture/app': { resolved: 'apps/app', link: true },
      'node_modules/@fixture/internal': { resolved: 'apps/internal', link: true },
      'node_modules/ajv': {
        version: '6.15.0',
        resolved: 'https://registry.npmjs.org/ajv/-/ajv-6.15.0.tgz',
        integrity: 'sha512-root-ajv',
      },
      'apps/app/node_modules/ajv': {
        version: '8.20.0',
        resolved: 'https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz',
        integrity: 'sha512-app-ajv',
      },
    },
  };
  const values = { rootManifest, appManifest, internalManifest, lock };
  mutate?.(values);
  writeJson(resolve(fixture, 'package.json'), rootManifest);
  writeJson(resolve(fixture, 'apps/app/package.json'), appManifest);
  writeJson(resolve(fixture, 'apps/internal/package.json'), internalManifest);
  writeJson(resolve(fixture, 'package-lock.json'), lock);
  return fixture;
}

describe('direct dependency policy', () => {
  it('discovers new workspaces and rejects floating peers', () => {
    const fixture = createNpmFixture();
    try {
      expect(discoverNpmWorkspaceManifests(fixture)).toEqual([
        'package.json',
        'apps/known/package.json',
        'apps/new/package.json',
      ]);
      expect(auditNpmRepository(fixture).violations).toEqual([
        {
          code: 'npm-floating-direct',
          path: 'apps/new/package.json',
          detail: 'peerDependencies react=^19.0.0',
        },
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('normalizes array and object workspace patterns with literal wildcards', () => {
    const arrayFixture = createWorkspaceDiscoveryFixture(
      ['apps/*', 'tools/tool?', 'nested/**'],
      ['apps/one', 'tools/tool1', 'nested/deep/package'],
    );
    const objectFixture = createWorkspaceDiscoveryFixture({ packages: ['packages/*'] }, [
      'packages/one',
      'packages/two',
    ]);
    try {
      expect(discoverNpmWorkspaceManifests(arrayFixture)).toEqual([
        'package.json',
        'apps/one/package.json',
        'nested/deep/package/package.json',
        'tools/tool1/package.json',
      ]);
      expect(discoverNpmWorkspaceManifests(objectFixture)).toEqual([
        'package.json',
        'packages/one/package.json',
        'packages/two/package.json',
      ]);
    } finally {
      rmSync(arrayFixture, { recursive: true, force: true });
      rmSync(objectFixture, { recursive: true, force: true });
    }
  });

  it('never descends into excluded directories or directory symlinks', () => {
    const fixture = createWorkspaceDiscoveryFixture(['**'], ['apps/kept']);
    const external = mkdtempSync(resolve(tmpdir(), 'open-voice-c10-symlink-target-'));
    const excluded = [
      '.git',
      '.superpowers',
      'node_modules',
      'target',
      'dist',
      'coverage',
      '.vercel',
      '.vite',
      'playwright-report',
      'test-results',
    ];
    try {
      for (const directory of excluded) {
        writeJson(resolve(fixture, directory, 'hidden/package.json'), {
          name: `@fixture/hidden-${directory}`,
          version: '1.0.0',
        });
      }
      writeJson(resolve(external, 'package.json'), {
        name: '@fixture/symlinked',
        version: '1.0.0',
      });
      mkdirSync(resolve(fixture, 'links'), { recursive: true });
      symlinkSync(
        external,
        resolve(fixture, 'links/external'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      expect(discoverNpmWorkspaceManifests(fixture)).toEqual([
        'package.json',
        'apps/kept/package.json',
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });

  it('reports unmatched and overlapping workspace declarations deterministically', () => {
    const missing = createWorkspaceDiscoveryFixture(['missing/*'], ['apps/kept']);
    const overlap = createWorkspaceDiscoveryFixture(['apps/*', '**'], ['apps/kept']);
    const duplicateName = createWorkspaceDiscoveryFixture(
      ['apps/*'],
      ['apps/first', 'apps/second'],
    );
    writeJson(resolve(duplicateName, 'apps/second/package.json'), {
      name: '@fixture/workspace-0',
      version: '1.0.0',
      private: true,
    });
    try {
      expect(auditNpmRepository(missing).violations).toEqual([
        {
          code: 'npm-workspace-missing',
          path: 'package.json',
          detail: 'missing/*',
        },
      ]);
      expect(auditNpmRepository(overlap).violations).toEqual([
        {
          code: 'npm-workspace-duplicate',
          path: 'apps/kept/package.json',
          detail: 'pattern',
        },
      ]);
      expect(auditNpmRepository(duplicateName).violations).toEqual([
        {
          code: 'npm-workspace-duplicate',
          path: 'apps/second/package.json',
          detail: 'name @fixture/workspace-0 also apps/first/package.json',
        },
      ]);
    } finally {
      rmSync(missing, { recursive: true, force: true });
      rmSync(overlap, { recursive: true, force: true });
      rmSync(duplicateName, { recursive: true, force: true });
    }
  });

  it.each([
    ['', 'empty'],
    ['/apps/*', 'absolute'],
    ['C:\\apps\\*', 'absolute'],
    ['!apps/*', 'negated'],
    ['../apps/*', 'parent'],
    ['apps/../*', 'parent'],
    ['apps/{one,two}', 'brace'],
    [`apps/\0`, 'nul'],
  ])('rejects invalid workspace pattern %s', (pattern, category) => {
    const fixture = createWorkspaceDiscoveryFixture([pattern], []);
    try {
      expect(auditNpmRepository(fixture).violations).toEqual([
        {
          code: 'npm-workspace-pattern',
          path: 'package.json',
          detail: category,
        },
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('accepts only exact npm requirements in every direct section', () => {
    const sections = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ];
    const forbidden = [
      '^1.0.0',
      '~1.0.0',
      '>=1.0.0',
      '1.0.0 || 2.0.0',
      '*',
      'latest',
      'workspace:*',
      'workspace:^1.0.0',
      'npm:other@1.0.0',
      'file:../x',
      'link:../x',
      'git+https://example.invalid/x',
      'https://example.invalid/x.tgz',
    ];
    const accepted = ['1.0.0', '1.0.0-rc.1', 'workspace:1.0.0', 'workspace:1.0.0-rc.1'];

    for (const section of sections) {
      for (const requirement of forbidden) {
        const fixture = createRequirementFixture(section, requirement);
        try {
          const dependencyName = requirement.startsWith('workspace:')
            ? '@fixture/internal'
            : 'external';
          expect(auditNpmRepository(fixture).violations, `${section}:${requirement}`).toEqual([
            {
              code: 'npm-floating-direct',
              path: 'apps/app/package.json',
              detail: `${section} ${dependencyName}=${requirement}`,
            },
          ]);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
      for (const requirement of accepted) {
        const fixture = createRequirementFixture(section, requirement);
        try {
          expect(auditNpmRepository(fixture).violations, `${section}:${requirement}`).toEqual([]);
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
      }
    }
  });

  it('audits package-lock parity, direct resolution, source, and integrity', () => {
    const cases: Array<{
      label: string;
      mutate: (fixture: NpmLockFixture) => void;
      code: string;
    }> = [
      {
        label: 'missing workspace entry',
        mutate: ({ lock }) => {
          delete lock.packages['apps/app'];
        },
        code: 'npm-lock-manifest-drift',
      },
      {
        label: 'stale workspace direct map',
        mutate: ({ lock }) => {
          lock.packages['apps/app'].devDependencies = { ajv: '7.0.0' };
        },
        code: 'npm-lock-manifest-drift',
      },
      {
        label: 'broken workspace link',
        mutate: ({ lock }) => {
          lock.packages['node_modules/@fixture/app'].resolved = 'apps/internal';
        },
        code: 'npm-lock-workspace-link',
      },
      {
        label: 'external direct version mismatch',
        mutate: ({ lock }) => {
          lock.packages['apps/app/node_modules/ajv'].version = '8.19.0';
        },
        code: 'npm-lock-direct',
      },
      {
        label: 'HTTP registry source',
        mutate: ({ lock }) => {
          lock.packages['node_modules/ajv'].resolved =
            'http://registry.npmjs.org/ajv/-/ajv-6.15.0.tgz';
        },
        code: 'npm-lock-source',
      },
      {
        label: 'git registry source',
        mutate: ({ lock }) => {
          lock.packages['node_modules/ajv'].resolved = 'git+https://example.invalid/ajv.git';
        },
        code: 'npm-lock-source',
      },
      {
        label: 'non-tarball registry URL',
        mutate: ({ lock }) => {
          lock.packages['node_modules/ajv'].resolved = 'https://registry.npmjs.org/ajv/latest';
        },
        code: 'npm-lock-source',
      },
      {
        label: 'missing sha512 integrity',
        mutate: ({ lock }) => {
          delete lock.packages['node_modules/ajv'].integrity;
        },
        code: 'npm-lock-integrity',
      },
      {
        label: 'nonexact locked version',
        mutate: ({ lock }) => {
          lock.packages['node_modules/ajv'].version = '^6.15.0';
        },
        code: 'npm-lock-source',
      },
      {
        label: 'stale undiscovered workspace link',
        mutate: ({ lock }) => {
          lock.packages['apps/stale'] = { name: '@fixture/stale', version: '1.0.0' };
          lock.packages['node_modules/@fixture/stale'] = { resolved: 'apps/stale', link: true };
        },
        code: 'npm-lock-workspace-link',
      },
    ];

    for (const testCase of cases) {
      const fixture = createNpmLockFixture(testCase.mutate);
      try {
        const violations = auditNpmRepository(fixture).violations;
        expect(
          violations.map(({ code }) => code),
          testCase.label,
        ).toContain(testCase.code);
        expect(violations, `${testCase.label}: sorted`).toEqual(
          [...violations].sort(
            (left, right) =>
              left.code.localeCompare(right.code) ||
              left.path.localeCompare(right.path) ||
              left.detail.localeCompare(right.detail),
          ),
        );
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  it('resolves external direct requirements from the nearest ancestor', () => {
    const fixture = createNpmLockFixture();
    try {
      const result = auditNpmRepository(fixture);
      expect(result.violations).toEqual([]);
      expect(result.lockedRegistryPackages).toBe(2);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects lock version, root drift, internal mismatch, and workspace-name registry shadows', () => {
    const cases: Array<{
      label: string;
      mutate: (fixture: NpmLockFixture) => void;
      code: string;
    }> = [
      {
        label: 'lockfile version',
        mutate: ({ lock }) => {
          lock.lockfileVersion = 2;
        },
        code: 'npm-lock-version',
      },
      {
        label: 'requires flag',
        mutate: ({ lock }) => {
          lock.requires = false;
        },
        code: 'npm-lock-version',
      },
      {
        label: 'root identity',
        mutate: ({ lock }) => {
          lock.name = 'wrong-root';
        },
        code: 'npm-lock-manifest-drift',
      },
      {
        label: 'root workspace list',
        mutate: ({ lock }) => {
          lock.packages[''].workspaces = ['packages/*'];
        },
        code: 'npm-lock-manifest-drift',
      },
      {
        label: 'internal direct version mismatch',
        mutate: ({ appManifest, lock }) => {
          (appManifest.devDependencies as Record<string, string>)['@fixture/internal'] = '2.0.0';
          (lock.packages['apps/app'].devDependencies as Record<string, string>)[
            '@fixture/internal'
          ] = '2.0.0';
        },
        code: 'npm-lock-direct',
      },
      {
        label: 'registry package shadows workspace name',
        mutate: ({ lock }) => {
          lock.packages['apps/app/node_modules/@fixture/internal'] = {
            version: '1.0.0',
            resolved: 'https://registry.npmjs.org/@fixture/internal/-/internal-1.0.0.tgz',
            integrity: 'sha512-shadow',
          };
        },
        code: 'npm-lock-direct',
      },
    ];

    for (const testCase of cases) {
      const fixture = createNpmLockFixture(testCase.mutate);
      try {
        expect(
          auditNpmRepository(fixture).violations.map(({ code }) => code),
          testCase.label,
        ).toContain(testCase.code);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  it('audits the complete actual npm repository', () => {
    const result = auditNpmRepository(root);
    expect(result.manifests).toEqual([
      'package.json',
      'apps/companion/package.json',
      'apps/web/package.json',
      'packages/catalog/package.json',
      'packages/contracts/package.json',
    ]);
    expect(result.lockedRegistryPackages).toBe(295);
    expect(result.violations).toEqual([]);
  });

  it('pins the root package manager and Node policy', () => {
    const packageManagerFixture = createNpmLockFixture(({ rootManifest }) => {
      rootManifest.packageManager = 'npm@11.15.0';
    });
    const engineFixture = createNpmLockFixture(({ rootManifest }) => {
      rootManifest.engines = { node: '>=22.0.0' };
    });
    try {
      expect(auditNpmRepository(packageManagerFixture).violations).toContainEqual({
        code: 'npm-root-policy',
        path: 'package.json',
        detail: 'packageManager',
      });
      expect(auditNpmRepository(engineFixture).violations).toContainEqual({
        code: 'npm-root-policy',
        path: 'package.json',
        detail: 'engines.node',
      });
    } finally {
      rmSync(packageManagerFixture, { recursive: true, force: true });
      rmSync(engineFixture, { recursive: true, force: true });
    }
  });

  it('uses exact npm dependency versions in every workspace manifest', () => {
    expect(auditNpmRepository(root).violations).toEqual([]);
  });

  it('uses exact Cargo requirements for the Tauri crate', () => {
    const manifestPath = resolve(root, 'apps/companion/src-tauri/Cargo.toml');
    expect(existsSync(manifestPath), 'Tauri Cargo.toml is missing').toBe(true);
    expect(auditCargoManifest(root).violations).toEqual([]);
  });

  it('pins the Tauri CLI used by the companion scaffold', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'apps/companion/package.json'), 'utf8'),
    ) as { devDependencies?: Record<string, string> };
    expect(manifest.devDependencies?.['@tauri-apps/cli']).toBe('2.11.4');
  });
});
