import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * @param {PolicyViolation[]} violations
 * @returns {PolicyViolation[]}
 */
function sortViolations(violations) {
  return violations.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.path.localeCompare(right.path) ||
      left.detail.localeCompare(right.detail),
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
  const names = new Map();
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
  return JSON.stringify(directMap(left)) === JSON.stringify(directMap(right));
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
    if (link?.link !== true || link?.resolved !== record.directory) {
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
 * Temporary characterization seam removed when Cargo metadata becomes authoritative in Task 3.
 * @param {string} rootDir
 * @returns {{directRequirements: number, violations: PolicyViolation[]}}
 */
export function auditCargoManifest(rootDir) {
  const path = POLICY.cargoManifest;
  const manifestPath = resolve(rootDir, path);
  if (!existsSync(manifestPath)) {
    return {
      directRequirements: 0,
      violations: [{ code: 'cargo-package-policy', path, detail: 'manifest' }],
    };
  }

  const manifest = readFileSync(manifestPath, 'utf8');
  const requirements = [
    ...manifest.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\{[^\n]*version\s*=\s*"([^"]+)"/gm),
  ];
  const violations = requirements
    .filter(([, , requirement]) => !requirement?.startsWith('='))
    .map(([, name, requirement]) => ({
      code: 'cargo-floating-direct',
      path,
      detail: `${name}=${requirement}`,
    }));

  return { directRequirements: requirements.length, violations: sortViolations(violations) };
}

/**
 * @param {string} rootDir
 * @returns {{npmManifests: number, npmLockedRegistryPackages: number, cargoDirectRequirements: number, cargoLockedPackages: number, violations: PolicyViolation[]}}
 */
export function auditRepository(rootDir) {
  const npm = auditNpmRepository(rootDir);
  const cargo = auditCargoManifest(rootDir);
  return {
    npmManifests: npm.manifests.length,
    npmLockedRegistryPackages: npm.lockedRegistryPackages,
    cargoDirectRequirements: cargo.directRequirements,
    cargoLockedPackages: 0,
    violations: sortViolations([...npm.violations, ...cargo.violations]),
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
