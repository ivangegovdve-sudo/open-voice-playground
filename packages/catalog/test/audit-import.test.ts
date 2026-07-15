import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SourceRecordSchema } from '@open-voice/contracts';

import * as catalog from '../src/index.js';

const api = catalog as Record<string, unknown>;
const temporaryDirectories: string[] = [];

type AuditApi = {
  buildSourceRecordCatalogFromAudit: (input: unknown) => unknown;
  importSourceRecordsFromAudit: (input: unknown) => unknown[];
  loadPublicRepositoryAudit: (path: string) => Promise<unknown>;
  validatePublicRepositoryAudit: (input: unknown) => {
    approvedPublicSources: unknown[];
  };
};

function auditApi(): AuditApi {
  for (const exportName of [
    'buildSourceRecordCatalogFromAudit',
    'importSourceRecordsFromAudit',
    'loadPublicRepositoryAudit',
    'validatePublicRepositoryAudit',
  ]) {
    expect(api[exportName], `${exportName} should be exported`).toBeTypeOf('function');
  }

  return api as unknown as AuditApi;
}

const publicAudit = {
  schemaVersion: 1,
  generatedAt: '2026-07-15T00:00:00.000Z',
  inventorySummary: {
    accessibleRepositories: 2,
    publicRepositories: 1,
    privateRepositories: 1,
    classifiedRepositories: 2,
    indexLookupStatus: 'confirmed-absent',
    indexMdMatches: 0,
  },
  classificationSummary: {
    tts: 1,
    'voice-conversion': 0,
    stt: 0,
    'voice-agent-infrastructure': 0,
    'unrelated-false-positive': 0,
    'needs-review': 1,
  },
  approvedPublicSources: [
    {
      id: 'fixture-tts-source',
      ownerRepositoryUrl: 'https://github.com/example/fixture-tts-copy',
      canonicalUrl: 'https://github.com/example/fixture-tts',
      visibility: 'public',
      approvalStatus: 'approved-public',
      category: 'tts',
      relevance: 'Synthetic public TTS repository used only by the audit importer test.',
      runtimeModes: ['browser', 'companion'],
      reuseDecision: 'candidate-engine',
      licenseRisk: 'needs-review',
      licenseDecisions: [
        {
          scope: 'code',
          name: 'MIT License',
          spdxId: 'MIT',
          evidenceUrl: 'https://github.com/example/fixture-tts/blob/main/LICENSE',
          reviewStatus: 'verified',
        },
        {
          scope: 'weights',
          name: 'Upstream terms require review',
          exactUpstreamTerms: 'No separate weights grant was verified for this fixture.',
          evidenceUrl: 'https://github.com/example/fixture-tts#readme',
          reviewStatus: 'needs-review',
        },
      ],
      provenanceEvidenceUrl: 'https://github.com/example/fixture-tts',
      sourceClass: 'official-repository',
      upstreamRevision: '0123456789abcdef0123456789abcdef01234567',
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
  ],
};

function cloneAudit(): typeof publicAudit {
  return structuredClone(publicAudit);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('public repository audit import', () => {
  it('builds the deterministic source-record JSON envelope used by the import CLI', () => {
    const { buildSourceRecordCatalogFromAudit } = auditApi();

    expect(buildSourceRecordCatalogFromAudit(cloneAudit())).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-07-15T00:00:00.000Z',
      sources: [
        {
          id: 'fixture-tts-source',
          canonicalUrl: 'https://github.com/example/fixture-tts',
          sourceClass: 'official-repository',
          upstreamRevision: '0123456789abcdef0123456789abcdef01234567',
          retrievedAt: '2026-07-15T00:00:00.000Z',
          lastVerifiedAt: '2026-07-15T00:00:00.000Z',
          health: 'healthy',
        },
      ],
    });
  });

  it('converts approved public records into strict SourceRecord entries', () => {
    const { importSourceRecordsFromAudit } = auditApi();

    const sources = importSourceRecordsFromAudit(cloneAudit());

    expect(sources).toEqual([
      {
        id: 'fixture-tts-source',
        canonicalUrl: 'https://github.com/example/fixture-tts',
        sourceClass: 'official-repository',
        upstreamRevision: '0123456789abcdef0123456789abcdef01234567',
        retrievedAt: '2026-07-15T00:00:00.000Z',
        lastVerifiedAt: '2026-07-15T00:00:00.000Z',
        health: 'healthy',
      },
    ]);
    expect(sources.every((source) => SourceRecordSchema.safeParse(source).success)).toBe(true);
  });

  it('rejects records that are private, unapproved, or contain non-public fields', () => {
    const { validatePublicRepositoryAudit } = auditApi();

    const privateRecord = cloneAudit();
    privateRecord.approvedPublicSources[0]!.visibility = 'private' as 'public';
    expect(() => validatePublicRepositoryAudit(privateRecord)).toThrow(/visibility|public/i);

    const unapprovedRecord = cloneAudit();
    unapprovedRecord.approvedPublicSources[0]!.approvalStatus = 'needs-review' as 'approved-public';
    expect(() => validatePublicRepositoryAudit(unapprovedRecord)).toThrow(/approval|approved/i);

    const leakingRecord = cloneAudit() as typeof publicAudit & {
      approvedPublicSources: Array<
        (typeof publicAudit.approvedPublicSources)[number] & { privateRepositoryName?: string }
      >;
    };
    leakingRecord.approvedPublicSources[0]!.privateRepositoryName = 'must-not-leak';
    expect(() => validatePublicRepositoryAudit(leakingRecord)).toThrow(/unrecognized|private/i);
  });

  it('accepts only canonical public GitHub repository URLs for source records', () => {
    const { validatePublicRepositoryAudit } = auditApi();

    for (const canonicalUrl of [
      'https://example.com/example/fixture-tts',
      'http://github.com/example/fixture-tts',
      'https://github.com/example/fixture-tts/issues/1',
      'https://github.com/example/fixture-tts?tab=readme',
    ]) {
      const audit = cloneAudit();
      audit.approvedPublicSources[0]!.canonicalUrl = canonicalUrl;

      expect(() => validatePublicRepositoryAudit(audit)).toThrow(/github|repository|url/i);
    }
  });

  it('requires reconciled inventory and classification counts', () => {
    const { validatePublicRepositoryAudit } = auditApi();
    const audit = cloneAudit();
    audit.inventorySummary.classifiedRepositories = 1;

    expect(() => validatePublicRepositoryAudit(audit)).toThrow(/count|classified|inventory/i);
  });

  it('loads and validates a sanitized audit from disk', async () => {
    const { loadPublicRepositoryAudit } = auditApi();
    const directory = await mkdtemp(join(tmpdir(), 'open-voice-public-audit-'));
    temporaryDirectories.push(directory);
    const auditPath = join(directory, 'repository-audit.public.json');
    await writeFile(auditPath, JSON.stringify(publicAudit), 'utf8');

    const loaded = (await loadPublicRepositoryAudit(auditPath)) as {
      approvedPublicSources: unknown[];
    };

    expect(loaded.approvedPublicSources).toHaveLength(1);
  });
});
