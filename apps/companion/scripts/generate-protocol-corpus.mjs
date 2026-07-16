import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const corpusPath = resolve(import.meta.dirname, '../openapi/fixtures/protocol-corpus.json');

function slug(value) {
  return value
    .replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`)
    .replace(/^-/u, '')
    .replaceAll('_', '-')
    .replaceAll(':', '-');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function wrongJsonKind(value) {
  if (Array.isArray(value)) return {};
  if (value !== null && typeof value === 'object') return 'wrong-json-kind';
  if (typeof value === 'string') return {};
  if (typeof value === 'boolean' || typeof value === 'number') return 'wrong-json-kind';
  return false;
}

function valueAt(root, path) {
  let value = root;
  for (const part of path) value = value[part];
  return value;
}

function objectPaths(value, path = [], result = []) {
  if (value === null || typeof value !== 'object') return result;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      objectPaths(value[index], [...path, index], result);
    }
  } else {
    result.push(path);
    for (const [key, child] of Object.entries(value)) objectPaths(child, [...path, key], result);
  }
  return result;
}

function scalarId(codePoint) {
  return `u-${codePoint.toString(16).padStart(4, '0')}`;
}

function derivedCases(baseCases) {
  const derived = [];
  const add = (id, schema, category, value, native) => {
    const entry = { id, schema, valid: false, category, value };
    if (native !== undefined) entry.native = native;
    derived.push(entry);
  };
  const addPositive = (id, schema, category, value, native) => {
    const entry = { id, schema, valid: true, category, value };
    if (native !== undefined) entry.native = native;
    derived.push(entry);
  };
  const representative = (schema) => {
    const entry = baseCases.find(
      (candidate) =>
        candidate.schema === schema && candidate.valid && candidate.category === 'representative',
    );
    if (entry === undefined) throw new Error(`Missing representative corpus case for ${schema}`);
    return entry.value;
  };

  const problems = baseCases.filter(
    (entry) => entry.schema === 'Problem' && entry.valid && entry.category === 'problem-catalog',
  );
  for (let index = 0; index < problems.length; index += 1) {
    const value = problems[index].value;
    const other = problems[(index + 1) % problems.length].value;
    const mutations = {
      code: { ...value, code: other.code },
      type: { ...value, type: other.type },
      title: { ...value, title: `${value.title} (mismatch)` },
      detail: { ...value, detail: `${value.detail} (mismatch)` },
      status: { ...value, status: value.status === 400 ? 401 : 400 },
    };
    for (const [field, mutation] of Object.entries(mutations)) {
      add(
        `derived-problem-${value.code}-mismatch-${field}`,
        'Problem',
        `derived-problem-${field}-mismatch`,
        mutation,
        'problem',
      );
    }
    if (index === 0) {
      for (const [field, candidate, suffix] of [
        ['instance', 'urn:uuid:not-a-uuid', 'malformed'],
        ['instance', String(value.instance).toUpperCase(), 'uppercase'],
        ['requestId', 'not-a-uuid', 'malformed'],
        ['requestId', String(value.requestId).toUpperCase(), 'uppercase'],
      ]) {
        add(`derived-problem-${field}-${suffix}`, 'Problem', 'problem-identifier-boundary', {
          ...value,
          [field]: candidate,
        });
      }
    }
  }

  for (const codePoint of [
    ...Array.from({ length: 0x20 }, (_, index) => index),
    0x7f,
    ...Array.from({ length: 0x20 }, (_, index) => 0x80 + index),
    0x061c,
    0x200e,
    0x200f,
    ...Array.from({ length: 7 }, (_, index) => 0x2028 + index),
    ...Array.from({ length: 4 }, (_, index) => 0x2066 + index),
  ]) {
    add(
      `derived-label-forbidden-${scalarId(codePoint)}`,
      'ClientLabel',
      'label-forbidden-scalar',
      `safe${String.fromCodePoint(codePoint)}label`,
      'label',
    );
  }
  for (const [name, character] of [
    ['less-than', '<'],
    ['greater-than', '>'],
    ['left-brace', '{'],
    ['right-brace', '}'],
    ['left-bracket', '['],
    ['right-bracket', ']'],
    ['backtick', '`'],
  ]) {
    add(
      `derived-label-forbidden-${name}`,
      'ClientLabel',
      'label-forbidden-punctuation',
      `safe${character}label`,
      'label',
    );
  }

  for (const codePoint of [
    ...Array.from({ length: 9 }, (_, index) => index),
    ...Array.from({ length: 18 }, (_, index) => 0x0e + index),
  ]) {
    add(
      `derived-text-forbidden-${scalarId(codePoint)}`,
      'SynthesisText',
      'text-forbidden-c0',
      `safe${String.fromCodePoint(codePoint)}text`,
      'text',
    );
  }
  for (const codePoint of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x7f]) {
    addPositive(
      `derived-text-allowed-${scalarId(codePoint)}`,
      'SynthesisText',
      'text-allowed-control-boundary',
      `safe${String.fromCodePoint(codePoint)}text`,
      'text',
    );
  }
  for (const codePoint of Array.from({ length: 0x20 }, (_, index) => 0x80 + index)) {
    addPositive(
      `derived-text-allowed-${scalarId(codePoint)}`,
      'SynthesisText',
      'text-allowed-c1',
      `safe${String.fromCodePoint(codePoint)}text`,
      'text',
    );
  }

  addPositive(
    'derived-version-exact-32-bytes',
    'ClientVersion',
    'version-fixed-boundary',
    `1.${'1'.repeat(14)}.${'2'.repeat(15)}`,
    'version',
  );
  for (const [suffix, value] of [
    ['one-part', '1'],
    ['build-metadata', '1.0.0+build'],
    ['whitespace', ' 1.0.0'],
    ['unicode-digit', '1.٠.0'],
  ]) {
    add(`derived-version-${suffix}`, 'ClientVersion', 'version-fixed-boundary', value, 'version');
  }

  const canonicalUuid = representative('CanonicalUuid');
  addPositive(
    'derived-uuid-nil',
    'CanonicalUuid',
    'uuid-fixed-boundary',
    '00000000-0000-0000-0000-000000000000',
    'uuid',
  );
  for (const [suffix, value] of [
    ['braced', `{${canonicalUuid}}`],
    ['misplaced-hyphen', '123e4567e-89b-42d3-a456-426614174000'],
    ['whitespace', ` ${canonicalUuid}`],
  ]) {
    add(`derived-uuid-${suffix}`, 'CanonicalUuid', 'uuid-fixed-boundary', value, 'uuid');
  }

  const packActionRequest = representative('PackActionRequest');
  const packActionResponse = representative('PackActionResponse');
  for (const action of ['update', 'repair', 'remove']) {
    addPositive(
      `derived-pack-action-request-${action}`,
      'PackActionRequest',
      'pack-action-fixed-boundary',
      { ...packActionRequest, action },
    );
    addPositive(
      `derived-pack-action-response-${action}`,
      'PackActionResponse',
      'pack-action-fixed-boundary',
      { ...packActionResponse, action },
    );
  }
  for (const [suffix, action] of [
    ['unknown', 'rebuild'],
    ['case-variant', 'Install'],
  ]) {
    add(
      `derived-pack-action-request-${suffix}`,
      'PackActionRequest',
      'pack-action-fixed-boundary',
      { ...packActionRequest, action },
    );
    add(
      `derived-pack-action-response-${suffix}`,
      'PackActionResponse',
      'pack-action-fixed-boundary',
      { ...packActionResponse, action },
    );
  }

  const manualChallenge = representative('ManualChallengeRequest');
  for (const [suffix, code] of [
    ['length-11', '23456789ABC'],
    ['length-13', '23456789ABCDE'],
    ['lowercase', '23456789abcd'],
    ['forbidden-i', '23456789ABCI'],
    ['forbidden-l', '23456789ABCL'],
    ['forbidden-o', '23456789ABCO'],
    ['forbidden-u', '23456789ABCU'],
    ['separator', '2345-6789ABC'],
    ['whitespace', '2345 6789ABC'],
  ]) {
    add(`derived-manual-code-${suffix}`, 'ManualChallengeRequest', 'manual-code-fixed-boundary', {
      ...manualChallenge,
      code,
    });
  }

  const deepLinkChallenge = representative('PairingChallengeRequest');
  addPositive(
    'derived-pairing-challenge-manual-branch',
    'PairingChallengeRequest',
    'pairing-union-fixed-boundary',
    manualChallenge,
  );
  add(
    'derived-pairing-challenge-hybrid',
    'PairingChallengeRequest',
    'pairing-union-fixed-boundary',
    { ...deepLinkChallenge, code: manualChallenge.code },
  );
  const neitherBranch = clone(deepLinkChallenge);
  delete neitherBranch.state;
  add(
    'derived-pairing-challenge-neither-branch',
    'PairingChallengeRequest',
    'pairing-union-fixed-boundary',
    neitherBranch,
  );

  const jobResponse = representative('JobResponse');
  for (const state of ['cancelling', 'cancelled', 'failed', 'expired']) {
    addPositive(`derived-job-response-state-${state}`, 'JobResponse', 'job-state-fixed-boundary', {
      ...jobResponse,
      state,
    });
  }

  const pendingRedeem = representative('RedeemPendingResponse');
  add(
    'derived-pending-redeem-problem-at-202',
    'RedeemPendingResponse',
    'pending-redeem-fixed-boundary',
    { ...problems[0].value, status: 202 },
  );
  for (const [field, value] of [
    ['token', 'A'.repeat(43)],
    ['pairing', {}],
    ['detail', 'still pending'],
    ['code', 'pairing-pending'],
  ]) {
    add(
      `derived-pending-redeem-leaks-${field}`,
      'RedeemPendingResponse',
      'pending-redeem-fixed-boundary',
      { ...pendingRedeem, [field]: value },
    );
  }

  const baselines = baseCases.filter(
    (entry) =>
      entry.valid &&
      entry.category === 'representative' &&
      entry.schema !== 'Problem' &&
      entry.value !== null &&
      typeof entry.value === 'object' &&
      !Array.isArray(entry.value),
  );
  for (const baseline of baselines) {
    const schemaSlug = slug(baseline.schema);
    for (const path of objectPaths(baseline.value)) {
      const object = valueAt(baseline.value, path);
      const pathSlug =
        path.length === 0 ? 'root' : `p-${path.map((part) => slug(String(part))).join('-')}`;

      const unknown = clone(baseline.value);
      valueAt(unknown, path).unexpectedCorpusField = true;
      add(
        `derived-${schemaSlug}-${pathSlug}-unknown-property`,
        baseline.schema,
        'derived-unknown-property',
        unknown,
        baseline.schema === 'JobCreateRequest' ? 'job' : undefined,
      );

      for (const key of Object.keys(object)) {
        const keySlug = slug(key);
        const omitted = clone(baseline.value);
        delete valueAt(omitted, path)[key];
        add(
          `derived-${schemaSlug}-${pathSlug}-omit-${keySlug}`,
          baseline.schema,
          'derived-required-omission',
          omitted,
          baseline.schema === 'JobCreateRequest' ? 'job' : undefined,
        );

        const wrongKind = clone(baseline.value);
        valueAt(wrongKind, path)[key] = wrongJsonKind(object[key]);
        add(
          `derived-${schemaSlug}-${pathSlug}-wrong-kind-${keySlug}`,
          baseline.schema,
          'derived-wrong-json-kind',
          wrongKind,
          baseline.schema === 'JobCreateRequest' ? 'job' : undefined,
        );
      }
    }
  }
  return derived;
}

const current = readFileSync(corpusPath, 'utf8');
const corpus = JSON.parse(current);
const baseCases = corpus.cases
  .filter((entry) => !entry.id.startsWith('derived-'))
  .map((entry) => (entry.schema === 'ProblemCode' ? { ...entry, native: 'problem-code' } : entry));
corpus.description =
  'Deterministic companion protocol corpus with fixed vectors and schema-derived boundary mutations. Values are public test data, never credentials.';
corpus.cases = [...baseCases, ...derivedCases(baseCases)];

const ids = new Set();
for (const entry of corpus.cases) {
  if (ids.has(entry.id)) throw new Error(`Duplicate protocol corpus case id: ${entry.id}`);
  ids.add(entry.id);
}
const output = `${JSON.stringify(corpus, null, 2)}\n`;

if (process.argv.includes('--write')) {
  writeFileSync(corpusPath, output, 'utf8');
} else if (process.argv.includes('--check')) {
  if (current !== output) {
    throw new Error('Protocol corpus derived cases are stale; run npm run corpus:generate.');
  }
} else {
  process.stdout.write(output);
}
