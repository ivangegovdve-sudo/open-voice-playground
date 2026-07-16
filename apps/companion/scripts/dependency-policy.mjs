import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

export const POLICY = Object.freeze({
  nodeCiVersion: '22.13.0',
  npmVersion: '11.16.0',
  rustVersion: '1.97',
  rustToolchain: '1.97.0',
  cargoManifest: 'apps/companion/src-tauri/Cargo.toml',
  cargoLock: 'apps/companion/src-tauri/Cargo.lock',
  windowsTarget: 'x86_64-pc-windows-msvc',
});

const DIRECT_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

const EXACT_NPM_REQUIREMENT =
  /^(?:workspace:)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)))*)?$/;
const EXACT_REGISTRY_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)))*)?$/;
const EXACT_CARGO_REQUIREMENT =
  /^=(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)))*)?$/;
const CRATES_IO_SOURCE = 'registry+https://github.com/rust-lang/crates.io-index';
const WINDOWS_FEATURES = Object.freeze([
  'Win32_Foundation',
  'Win32_Networking_WinSock',
  'Win32_System_Com',
  'Win32_UI_Controls',
  'Win32_UI_WindowsAndMessaging',
]);

const WALK_EXCLUSIONS = new Set([
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
]);

/** @typedef {{code: string, path: string, detail: string}} PolicyViolation */

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function comparePolicyText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * @param {PolicyViolation[]} violations
 * @returns {PolicyViolation[]}
 */
function sortViolations(violations) {
  return violations.sort(
    (left, right) =>
      comparePolicyText(left.code, right.code) ||
      comparePolicyText(left.path, right.path) ||
      comparePolicyText(left.detail, right.detail),
  );
}

/**
 * @param {string} value
 * @returns {string}
 */
function toPosix(value) {
  return value.replaceAll('\\', '/');
}

/**
 * @param {unknown} pattern
 * @returns {{pattern?: string, category?: string}}
 */
function normalizeWorkspacePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return { category: 'empty' };
  if (pattern.includes('\0')) return { category: 'nul' };
  const normalized = toPosix(pattern);
  if (isAbsolute(normalized) || win32.isAbsolute(normalized)) return { category: 'absolute' };
  if (normalized.startsWith('!')) return { category: 'negated' };
  if (normalized.includes('{') || normalized.includes('}')) return { category: 'brace' };
  const segments = normalized.split('/');
  if (segments.includes('..')) return { category: 'parent' };
  if (segments.some((segment) => segment.length === 0)) return { category: 'empty' };
  return { pattern: normalized };
}

/**
 * @param {string} segment
 * @returns {RegExp}
 */
function workspaceSegmentExpression(segment) {
  let source = '^';
  for (const character of segment) {
    if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`${source}$`, 'u');
}

/**
 * @param {string[]} pathSegments
 * @param {string[]} patternSegments
 * @param {number} pathIndex
 * @param {number} patternIndex
 * @returns {boolean}
 */
function workspaceSegmentsMatch(pathSegments, patternSegments, pathIndex = 0, patternIndex = 0) {
  if (patternIndex === patternSegments.length) return pathIndex === pathSegments.length;
  const pattern = patternSegments[patternIndex];
  if (pattern === '**') {
    return (
      workspaceSegmentsMatch(pathSegments, patternSegments, pathIndex, patternIndex + 1) ||
      (pathIndex < pathSegments.length &&
        workspaceSegmentsMatch(pathSegments, patternSegments, pathIndex + 1, patternIndex))
    );
  }
  return (
    pathIndex < pathSegments.length &&
    workspaceSegmentExpression(pattern).test(pathSegments[pathIndex]) &&
    workspaceSegmentsMatch(pathSegments, patternSegments, pathIndex + 1, patternIndex + 1)
  );
}

/**
 * @param {string} workspacePath
 * @param {string} pattern
 * @returns {boolean}
 */
function workspacePathMatches(workspacePath, pattern) {
  return workspaceSegmentsMatch(workspacePath.split('/'), pattern.split('/'));
}

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
function findPackageManifests(rootDir) {
  /** @type {string[]} */
  const manifests = [];

  /** @param {string} directory */
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || WALK_EXCLUSIONS.has(entry.name))
        continue;
      const child = resolve(directory, entry.name);
      if (existsSync(resolve(child, 'package.json'))) {
        manifests.push(toPosix(relative(rootDir, resolve(child, 'package.json'))));
      }
      walk(child);
    }
  }

  walk(rootDir);
  return manifests.sort();
}

/**
 * @param {string} rootDir
 * @returns {{manifests: string[], violations: PolicyViolation[]}}
 */
function collectNpmWorkspaceManifests(rootDir) {
  const rootManifest = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
  const rawWorkspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages;
  /** @type {PolicyViolation[]} */
  const violations = [];
  if (!Array.isArray(rawWorkspaces)) {
    return {
      manifests: ['package.json'],
      violations: [{ code: 'npm-root-policy', path: 'package.json', detail: 'workspaces' }],
    };
  }

  /** @type {string[]} */
  const patterns = [];
  for (const rawPattern of rawWorkspaces) {
    const normalized = normalizeWorkspacePattern(rawPattern);
    if (normalized.pattern === undefined) {
      violations.push({
        code: 'npm-workspace-pattern',
        path: 'package.json',
        detail: normalized.category ?? 'invalid',
      });
    } else {
      patterns.push(normalized.pattern);
    }
  }

  const candidates = findPackageManifests(rootDir);
  /** @type {Map<string, number>} */
  const matchCounts = new Map();
  for (const pattern of patterns) {
    const matches = candidates.filter((manifest) =>
      workspacePathMatches(manifest.slice(0, -'/package.json'.length), pattern),
    );
    if (matches.length === 0) {
      violations.push({ code: 'npm-workspace-missing', path: 'package.json', detail: pattern });
    }
    for (const match of matches) matchCounts.set(match, (matchCounts.get(match) ?? 0) + 1);
  }

  for (const [manifest, count] of matchCounts) {
    if (count > 1) {
      violations.push({ code: 'npm-workspace-duplicate', path: manifest, detail: 'pattern' });
    }
  }

  const manifests = ['package.json', ...[...matchCounts.keys()].sort()];
  /** @type {Map<string, string>} */
  const names = new Map(
    typeof rootManifest.name === 'string' ? [[rootManifest.name, 'package.json']] : [],
  );
  for (const manifestPath of manifests.slice(1)) {
    const manifest = JSON.parse(readFileSync(resolve(rootDir, manifestPath), 'utf8'));
    if (typeof manifest.name !== 'string') continue;
    const prior = names.get(manifest.name);
    if (prior !== undefined) {
      violations.push({
        code: 'npm-workspace-duplicate',
        path: manifestPath,
        detail: `name ${manifest.name} also ${prior}`,
      });
    } else {
      names.set(manifest.name, manifestPath);
    }
  }

  return { manifests, violations: sortViolations(violations) };
}

/**
 * @param {unknown} value
 * @returns {Record<string, string> | undefined}
 */
function directMap(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, requirement]) => [name, String(requirement)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function directMapsEqual(left, right) {
  const leftMap = directMap(left);
  const rightMap = directMap(right);
  if (leftMap === undefined || rightMap === undefined) {
    if (leftMap === undefined && rightMap === undefined) return true;
  }
  const comparableLeft = { ...(leftMap ?? {}) };
  const comparableRight = { ...(rightMap ?? {}) };
  let ignoredInvalidRequirement = false;
  for (const [name, requirement] of Object.entries(comparableLeft)) {
    if (!EXACT_NPM_REQUIREMENT.test(requirement)) {
      delete comparableLeft[name];
      delete comparableRight[name];
      ignoredInvalidRequirement = true;
    }
  }
  if (
    ignoredInvalidRequirement &&
    Object.keys(comparableLeft).length === 0 &&
    Object.keys(comparableRight).length === 0
  ) {
    return true;
  }
  if ((leftMap === undefined) !== (rightMap === undefined)) return false;
  return JSON.stringify(comparableLeft) === JSON.stringify(comparableRight);
}

/**
 * @param {string} manifestPath
 * @returns {string}
 */
function manifestDirectory(manifestPath) {
  return manifestPath === 'package.json' ? '' : manifestPath.slice(0, -'/package.json'.length);
}

/**
 * @param {string} directory
 * @returns {string}
 */
function parentPosixDirectory(directory) {
  const separator = directory.lastIndexOf('/');
  return separator === -1 ? '' : directory.slice(0, separator);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNpmRegistryTarball(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'registry.npmjs.org' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.endsWith('.tgz')
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} rootDir
 * @param {string[]} manifests
 * @returns {{lockedRegistryPackages: number, violations: PolicyViolation[]}}
 */
function auditNpmLock(rootDir, manifests) {
  /** @type {PolicyViolation[]} */
  const violations = [];
  const path = 'package-lock.json';
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'));
  } catch {
    return {
      lockedRegistryPackages: 0,
      violations: [{ code: 'npm-lock-version', path, detail: 'json' }],
    };
  }
  if (lock.lockfileVersion !== 3) {
    violations.push({ code: 'npm-lock-version', path, detail: 'lockfileVersion' });
  }
  if (lock.requires !== true) {
    violations.push({ code: 'npm-lock-version', path, detail: 'requires' });
  }
  const packages = lock.packages;
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
    violations.push({ code: 'npm-lock-version', path, detail: 'packages' });
    return { lockedRegistryPackages: 0, violations: sortViolations(violations) };
  }

  const manifestRecords = manifests.map((manifestPath) => ({
    manifestPath,
    directory: manifestDirectory(manifestPath),
    manifest: JSON.parse(readFileSync(resolve(rootDir, manifestPath), 'utf8')),
  }));
  const rootRecord = manifestRecords[0];
  const rootLock = packages[''];
  const workspacePatterns = Array.isArray(rootRecord.manifest.workspaces)
    ? rootRecord.manifest.workspaces
    : rootRecord.manifest.workspaces?.packages;
  if (
    lock.name !== rootRecord.manifest.name ||
    lock.version !== rootRecord.manifest.version ||
    rootLock === undefined ||
    rootLock.name !== rootRecord.manifest.name ||
    rootLock.version !== rootRecord.manifest.version ||
    JSON.stringify(rootLock.workspaces) !== JSON.stringify(workspacePatterns)
  ) {
    violations.push({ code: 'npm-lock-manifest-drift', path, detail: 'root' });
  }
  if (rootLock !== undefined) {
    for (const section of DIRECT_SECTIONS) {
      if (!directMapsEqual(rootRecord.manifest[section], rootLock[section])) {
        violations.push({
          code: 'npm-lock-manifest-drift',
          path: 'package.json',
          detail: section,
        });
      }
    }
  }

  /** @type {Map<string, {manifestPath: string, directory: string, manifest: any}>} */
  const workspaceByName = new Map();
  /** @type {Map<string, {manifestPath: string, directory: string, manifest: any}>} */
  const workspaceByDirectory = new Map();
  for (const record of manifestRecords.slice(1)) {
    workspaceByName.set(record.manifest.name, record);
    workspaceByDirectory.set(record.directory, record);
    const lockedWorkspace = packages[record.directory];
    if (lockedWorkspace === undefined) {
      violations.push({
        code: 'npm-lock-manifest-drift',
        path: record.directory,
        detail: 'missing workspace',
      });
    } else {
      if (
        lockedWorkspace.name !== record.manifest.name ||
        lockedWorkspace.version !== record.manifest.version
      ) {
        violations.push({
          code: 'npm-lock-manifest-drift',
          path: record.directory,
          detail: 'identity',
        });
      }
      for (const section of DIRECT_SECTIONS) {
        if (!directMapsEqual(record.manifest[section], lockedWorkspace[section])) {
          violations.push({
            code: 'npm-lock-manifest-drift',
            path: record.directory,
            detail: section,
          });
        }
      }
    }

    const linkPath = `node_modules/${record.manifest.name}`;
    const link = packages[linkPath];
    if (
      link?.link !== true ||
      link?.resolved !== record.directory ||
      JSON.stringify(Object.keys(link ?? {}).sort()) !== JSON.stringify(['link', 'resolved'])
    ) {
      violations.push({
        code: 'npm-lock-workspace-link',
        path: linkPath,
        detail: record.directory,
      });
    }
  }

  for (const [packagePath, entry] of Object.entries(packages)) {
    if (
      packagePath !== '' &&
      !packagePath.includes('node_modules') &&
      !workspaceByDirectory.has(packagePath)
    ) {
      violations.push({
        code: 'npm-lock-workspace-link',
        path: packagePath,
        detail: 'stale workspace',
      });
    }
    if (entry?.link === true) {
      const record = [...workspaceByDirectory.values()].find(
        (workspace) => `node_modules/${workspace.manifest.name}` === packagePath,
      );
      if (record === undefined) {
        violations.push({
          code: 'npm-lock-workspace-link',
          path: packagePath,
          detail: 'stale link',
        });
      }
    }
  }

  for (const record of manifestRecords) {
    for (const section of DIRECT_SECTIONS) {
      for (const [name, requirementValue] of Object.entries(record.manifest[section] ?? {})) {
        if (typeof requirementValue !== 'string' || !EXACT_NPM_REQUIREMENT.test(requirementValue)) {
          continue;
        }
        const requirement = requirementValue.startsWith('workspace:')
          ? requirementValue.slice('workspace:'.length)
          : requirementValue;
        const workspace = workspaceByName.get(name);
        if (workspace !== undefined) {
          if (workspace.manifest.version !== requirement) {
            violations.push({
              code: 'npm-lock-direct',
              path: record.manifestPath,
              detail: `${section} ${name}=${requirementValue} workspace=${workspace.manifest.version}`,
            });
          }
          continue;
        }

        let directory = record.directory;
        let locked;
        let lockedPath = '';
        while (true) {
          const candidate = `${directory.length > 0 ? `${directory}/` : ''}node_modules/${name}`;
          if (packages[candidate] !== undefined) {
            locked = packages[candidate];
            lockedPath = candidate;
            break;
          }
          if (directory.length === 0) break;
          directory = parentPosixDirectory(directory);
        }
        if (locked === undefined || locked.link === true || locked.version !== requirement) {
          violations.push({
            code: 'npm-lock-direct',
            path: record.manifestPath,
            detail: `${section} ${name}=${requirementValue} locked=${locked?.version ?? 'missing'}${
              lockedPath.length > 0 ? ` at ${lockedPath}` : ''
            }`,
          });
        }
      }
    }
  }

  let lockedRegistryPackages = 0;
  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!packagePath.includes('node_modules') || entry?.link === true) continue;
    lockedRegistryPackages += 1;
    for (const workspaceName of workspaceByName.keys()) {
      const workspaceSuffix = `node_modules/${workspaceName}`;
      if (packagePath === workspaceSuffix || packagePath.endsWith(`/${workspaceSuffix}`)) {
        violations.push({
          code: 'npm-lock-direct',
          path: packagePath,
          detail: `registry shadows workspace ${workspaceName}`,
        });
      }
    }
    if (typeof entry?.version !== 'string' || !EXACT_REGISTRY_VERSION.test(entry.version)) {
      violations.push({ code: 'npm-lock-source', path: packagePath, detail: 'version' });
    }
    if (!isNpmRegistryTarball(entry?.resolved)) {
      violations.push({ code: 'npm-lock-source', path: packagePath, detail: 'resolved' });
    }
    if (typeof entry?.integrity !== 'string' || !entry.integrity.startsWith('sha512-')) {
      violations.push({ code: 'npm-lock-integrity', path: packagePath, detail: 'integrity' });
    }
  }

  return { lockedRegistryPackages, violations: sortViolations(violations) };
}

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
export function discoverNpmWorkspaceManifests(rootDir) {
  return collectNpmWorkspaceManifests(rootDir).manifests;
}

/**
 * @param {string} rootDir
 * @returns {{manifests: string[], lockedRegistryPackages: number, violations: PolicyViolation[]}}
 */
export function auditNpmRepository(rootDir) {
  const discovery = collectNpmWorkspaceManifests(rootDir);
  const manifests = discovery.manifests;
  const violations = [...discovery.violations];

  const rootManifest = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
  if (rootManifest.packageManager !== `npm@${POLICY.npmVersion}`) {
    violations.push({ code: 'npm-root-policy', path: 'package.json', detail: 'packageManager' });
  }
  if (rootManifest.engines?.node !== `>=${POLICY.nodeCiVersion}`) {
    violations.push({ code: 'npm-root-policy', path: 'package.json', detail: 'engines.node' });
  }

  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(resolve(rootDir, path), 'utf8'));
    for (const section of DIRECT_SECTIONS) {
      for (const [name, requirement] of Object.entries(manifest[section] ?? {})) {
        if (typeof requirement !== 'string' || !EXACT_NPM_REQUIREMENT.test(requirement)) {
          violations.push({
            code: 'npm-floating-direct',
            path,
            detail: `${section} ${name}=${String(requirement)}`,
          });
        }
      }
    }
  }

  const lock =
    discovery.violations.length === 0
      ? auditNpmLock(rootDir, manifests)
      : { lockedRegistryPackages: 0, violations: [] };
  violations.push(...lock.violations);

  return {
    manifests,
    lockedRegistryPackages: lock.lockedRegistryPackages,
    violations: sortViolations(violations),
  };
}

/**
 * @param {string} rootDir
 * @returns {string[]}
 */
export function cargoMetadataArguments(rootDir) {
  void rootDir;
  return [
    'metadata',
    '--manifest-path',
    POLICY.cargoManifest,
    '--locked',
    '--no-deps',
    '--filter-platform',
    POLICY.windowsTarget,
    '--format-version',
    '1',
  ];
}

/**
 * @param {'signal' | 'exit' | 'stderr-only' | 'json' | 'package-count' | 'manifest'} category
 * @returns {Error}
 */
function cargoMetadataCommandError(category) {
  const error = new Error(`cargo-metadata-command ${category}`);
  error.cargoMetadataCategory = category;
  return error;
}

/**
 * @param {string} rootDir
 * @param {typeof spawnSync} spawn
 * @returns {object}
 */
export function loadCargoDirectMetadata(rootDir, spawn = spawnSync) {
  let result;
  try {
    result = spawn('cargo', cargoMetadataArguments(rootDir), {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch {
    throw cargoMetadataCommandError('exit');
  }
  if (result.signal !== null && result.signal !== undefined) {
    throw cargoMetadataCommandError('signal');
  }
  if (result.status !== 0) throw cargoMetadataCommandError('exit');
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  if (stdout.trim().length === 0 && stderr.trim().length > 0) {
    throw cargoMetadataCommandError('stderr-only');
  }
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw cargoMetadataCommandError('json');
  }
  if (!Array.isArray(metadata.packages) || metadata.packages.length !== 1) {
    throw cargoMetadataCommandError('package-count');
  }
  const expectedManifest = resolve(rootDir, POLICY.cargoManifest);
  if (resolve(metadata.packages[0]?.manifest_path ?? '') !== expectedManifest) {
    throw cargoMetadataCommandError('manifest');
  }
  return metadata;
}

/**
 * @param {object} metadata
 * @returns {PolicyViolation[]}
 */
export function auditCargoDirectMetadata(metadata) {
  if (!Array.isArray(metadata?.packages) || metadata.packages.length !== 1) {
    return [
      {
        code: 'cargo-package-policy',
        path: POLICY.cargoManifest,
        detail: 'package-count',
      },
    ];
  }
  const cargoPackage = metadata.packages[0];
  /** @type {PolicyViolation[]} */
  const violations = [];
  const publishIsClosed =
    cargoPackage.publish === false ||
    (Array.isArray(cargoPackage.publish) && cargoPackage.publish.length === 0);
  if (
    cargoPackage.name !== 'open-voice-companion' ||
    cargoPackage.version !== '0.1.0' ||
    cargoPackage.edition !== '2024' ||
    cargoPackage.rust_version !== POLICY.rustVersion ||
    !publishIsClosed
  ) {
    violations.push({
      code: 'cargo-package-policy',
      path: POLICY.cargoManifest,
      detail: 'identity',
    });
  }

  const dependencies = Array.isArray(cargoPackage.dependencies) ? cargoPackage.dependencies : [];
  for (const dependency of dependencies) {
    const kind = dependency.kind ?? 'normal';
    if (typeof dependency.req !== 'string' || !EXACT_CARGO_REQUIREMENT.test(dependency.req)) {
      violations.push({
        code: 'cargo-floating-direct',
        path: POLICY.cargoManifest,
        detail: `${kind} ${String(dependency.name)}=${String(dependency.req)}`,
      });
    }
    if (dependency.source !== CRATES_IO_SOURCE || dependency.registry !== null) {
      violations.push({
        code: 'cargo-direct-source',
        path: POLICY.cargoManifest,
        detail: `${kind} ${String(dependency.name)}`,
      });
    }
  }

  const windowsDependencies = dependencies.filter((dependency) => dependency.name === 'windows');
  const windowsDependency = windowsDependencies[0];
  const windowsFeatures = Array.isArray(windowsDependency?.features)
    ? [...windowsDependency.features].sort()
    : [];
  if (
    windowsDependencies.length !== 1 ||
    windowsDependency.req !== '=0.62.2' ||
    windowsDependency.kind !== null ||
    windowsDependency.target !== 'cfg(windows)' ||
    JSON.stringify(windowsFeatures) !== JSON.stringify([...WINDOWS_FEATURES].sort())
  ) {
    violations.push({
      code: 'cargo-windows-policy',
      path: POLICY.cargoManifest,
      detail: 'windows',
    });
  }

  return sortViolations(violations);
}

/**
 * @param {string} lockText
 * @returns {{packages: number, registryPackages: number, violations: PolicyViolation[]}}
 */
export function auditCargoLock(lockText) {
  const sections = lockText.split(/^\[\[package\]\]\s*$/mu);
  const header = sections[0] ?? '';
  const packageSections = sections.slice(1);
  /** @type {PolicyViolation[]} */
  const violations = [];
  const lockPath = POLICY.cargoLock;
  const versionMatch = /^version\s*=\s*(\d+)\s*$/mu.exec(header);
  if (versionMatch?.[1] !== '4') {
    violations.push({ code: 'cargo-lock-version', path: lockPath, detail: 'version' });
  }

  /**
   * @param {string} section
   * @param {string} field
   * @returns {string | undefined}
   */
  function stringField(section, field) {
    const line = section.split(/\r?\n/u).find((candidate) => candidate.startsWith(`${field} = `));
    if (line === undefined) return undefined;
    try {
      const value = JSON.parse(line.slice(`${field} = `.length));
      return typeof value === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  let registryPackages = 0;
  let localRoots = 0;
  for (const [index, section] of packageSections.entries()) {
    const name = stringField(section, 'name');
    const version = stringField(section, 'version');
    const source = stringField(section, 'source');
    const checksum = stringField(section, 'checksum');
    const packageDetail =
      name !== undefined && version !== undefined ? `${name}@${version}` : `package-${index + 1}`;
    if (name === undefined || version === undefined) {
      violations.push({ code: 'cargo-lock-package', path: lockPath, detail: packageDetail });
    }
    if (source === undefined) {
      if (name === 'open-voice-companion' && version === '0.1.0') {
        localRoots += 1;
      } else {
        violations.push({
          code: 'cargo-lock-package',
          path: lockPath,
          detail: `${packageDetail} local`,
        });
        violations.push({
          code: 'cargo-lock-source',
          path: lockPath,
          detail: packageDetail,
        });
      }
      continue;
    }

    registryPackages += 1;
    if (source !== CRATES_IO_SOURCE) {
      violations.push({ code: 'cargo-lock-source', path: lockPath, detail: packageDetail });
    }
    if (checksum === undefined || !/^[0-9a-f]{64}$/u.test(checksum)) {
      violations.push({ code: 'cargo-lock-checksum', path: lockPath, detail: packageDetail });
    }
  }
  if (localRoots !== 1) {
    violations.push({
      code: 'cargo-lock-package',
      path: lockPath,
      detail: `local-root=${localRoots}`,
    });
  }

  return {
    packages: packageSections.length,
    registryPackages,
    violations: sortViolations(violations),
  };
}

/**
 * @param {string} rootDir
 * @param {object} metadata
 * @returns {PolicyViolation[]}
 */
export function auditRustToolchain(rootDir, metadata) {
  /** @type {PolicyViolation[]} */
  const violations = [];
  const cargoPackage = Array.isArray(metadata?.packages) ? metadata.packages[0] : undefined;
  if (cargoPackage?.rust_version !== POLICY.rustVersion) {
    violations.push({
      code: 'rust-version-policy',
      path: POLICY.cargoManifest,
      detail: 'rust_version',
    });
  }

  const toolchainPath = 'rust-toolchain.toml';
  let contents;
  try {
    contents = readFileSync(resolve(rootDir, toolchainPath), 'utf8');
  } catch {
    violations.push({
      code: 'rust-toolchain-policy',
      path: toolchainPath,
      detail: 'missing',
    });
    return sortViolations(violations);
  }

  const lines = contents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  /** @type {Map<string, unknown>} */
  const values = new Map();
  let parseValid = lines[0] === '[toolchain]';
  for (const line of lines.slice(1)) {
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line);
    if (match === null || values.has(match[1])) {
      parseValid = false;
      continue;
    }
    try {
      values.set(match[1], JSON.parse(match[2]));
    } catch {
      parseValid = false;
    }
  }
  const keys = [...values.keys()].sort();
  const components = values.get('components');
  if (
    !parseValid ||
    JSON.stringify(keys) !== JSON.stringify(['channel', 'components', 'profile']) ||
    values.get('channel') !== POLICY.rustToolchain ||
    values.get('profile') !== 'minimal' ||
    !Array.isArray(components) ||
    JSON.stringify([...components].sort()) !== JSON.stringify(['clippy', 'rustfmt'])
  ) {
    violations.push({
      code: 'rust-toolchain-policy',
      path: toolchainPath,
      detail: 'toolchain',
    });
  }
  return sortViolations(violations);
}

/**
 * @param {string} rootDir
 * @param {{spawn?: typeof spawnSync}} options
 * @returns {{npmManifests: number, npmLockedRegistryPackages: number, cargoDirectRequirements: number, cargoLockedPackages: number, violations: PolicyViolation[]}}
 */
export function auditRepository(rootDir, options = {}) {
  const npm = auditNpmRepository(rootDir);
  let metadata;
  try {
    metadata = loadCargoDirectMetadata(rootDir, options.spawn ?? spawnSync);
  } catch (error) {
    const allowedCategories = new Set([
      'signal',
      'exit',
      'stderr-only',
      'json',
      'package-count',
      'manifest',
    ]);
    const category = allowedCategories.has(error?.cargoMetadataCategory)
      ? error.cargoMetadataCategory
      : 'exit';
    return {
      npmManifests: npm.manifests.length,
      npmLockedRegistryPackages: npm.lockedRegistryPackages,
      cargoDirectRequirements: 0,
      cargoLockedPackages: 0,
      violations: sortViolations([
        ...npm.violations,
        { code: 'cargo-metadata-command', path: POLICY.cargoManifest, detail: category },
      ]),
    };
  }
  const cargoPackage = metadata.packages[0];
  const cargoViolations = auditCargoDirectMetadata(metadata);
  let cargoLock;
  try {
    cargoLock = auditCargoLock(readFileSync(resolve(rootDir, POLICY.cargoLock), 'utf8'));
  } catch {
    cargoLock = {
      packages: 0,
      registryPackages: 0,
      violations: [{ code: 'cargo-lock-version', path: POLICY.cargoLock, detail: 'read' }],
    };
  }
  const rustViolations = auditRustToolchain(rootDir, metadata);
  return {
    npmManifests: npm.manifests.length,
    npmLockedRegistryPackages: npm.lockedRegistryPackages,
    cargoDirectRequirements: Array.isArray(cargoPackage.dependencies)
      ? cargoPackage.dependencies.length
      : 0,
    cargoLockedPackages: cargoLock.packages,
    violations: sortViolations([
      ...npm.violations,
      ...cargoViolations,
      ...cargoLock.violations,
      ...rustViolations,
    ]),
  };
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = auditRepository(resolve(import.meta.dirname, '../../..'));
  for (const violation of result.violations) {
    console.error(`${violation.code} ${violation.path} ${violation.detail}`);
  }
  if (result.violations.length > 0) process.exitCode = 1;
}
