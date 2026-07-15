import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourceRecordSchema } from '@open-voice/contracts';

import * as catalog from '../src/index.js';

const api = catalog as Record<string, unknown>;
const temporaryDirectories: string[] = [];
const fixtureRevision = '0123456789abcdef0123456789abcdef01234567';
const execFileAsync = promisify(execFile);

type AuditApi = {
  buildSourceRecordCatalogFromAudit: (input: unknown) => unknown;
  importSourceRecordsFromAudit: (input: unknown) => Array<{ id: string }>;
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
          evidenceUrl: `https://github.com/example/fixture-tts/blob/${fixtureRevision}/LICENSE`,
          reviewStatus: 'verified',
        },
        {
          scope: 'weights',
          name: 'Upstream terms require review',
          exactUpstreamTerms: 'No separate weights grant was verified for this fixture.',
          evidenceUrl: `https://github.com/example/fixture-tts/blob/${fixtureRevision}/README.md`,
          reviewStatus: 'needs-review',
        },
      ],
      provenanceEvidenceUrl: `https://github.com/example/fixture-tts/commit/${fixtureRevision}`,
      sourceClass: 'official-repository',
      upstreamRevision: fixtureRevision,
      retrievedAt: '2026-07-15T00:00:00.000Z',
      lastVerifiedAt: '2026-07-15T00:00:00.000Z',
      health: 'healthy',
    },
  ],
};

function cloneAudit(): typeof publicAudit {
  return structuredClone(publicAudit);
}

function sourceFixture(id: string, repository: string, revision: string) {
  const source = structuredClone(publicAudit.approvedPublicSources[0]!);
  source.id = id;
  source.ownerRepositoryUrl = `https://github.com/example/${repository}-copy`;
  source.canonicalUrl = `https://github.com/example/${repository}`;
  source.upstreamRevision = revision;
  source.provenanceEvidenceUrl = `${source.canonicalUrl}/commit/${revision}`;
  source.licenseDecisions[0]!.evidenceUrl = `${source.canonicalUrl}/blob/${revision}/LICENSE`;
  source.licenseDecisions[1]!.evidenceUrl = `${source.canonicalUrl}/blob/${revision}/README.md`;
  return source;
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
          upstreamRevision: fixtureRevision,
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
        upstreamRevision: fixtureRevision,
        retrievedAt: '2026-07-15T00:00:00.000Z',
        lastVerifiedAt: '2026-07-15T00:00:00.000Z',
        health: 'healthy',
      },
    ]);
    expect(sources.every((source) => SourceRecordSchema.safeParse(source).success)).toBe(true);
  });

  it('sorts multiple source records by code units without locale-sensitive collation', () => {
    const { importSourceRecordsFromAudit } = auditApi();
    const audit = cloneAudit();
    audit.approvedPublicSources = [
      sourceFixture('z-source', 'z-repository', 'a'.repeat(40)),
      sourceFixture('a-source', 'a-repository', 'b'.repeat(40)),
      sourceFixture('m-source', 'm-repository', 'c'.repeat(40)),
    ];
    const localeCompare = vi.spyOn(String.prototype, 'localeCompare').mockReturnValue(-1);

    try {
      expect(importSourceRecordsFromAudit(audit).map(({ id }) => id)).toEqual([
        'a-source',
        'm-source',
        'z-source',
      ]);
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
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
        (typeof publicAudit.approvedPublicSources)[number] & { internalRepositoryName?: string }
      >;
    };
    leakingRecord.approvedPublicSources[0]!.internalRepositoryName = 'must-not-leak';
    expect(() => validatePublicRepositoryAudit(leakingRecord)).toThrow(/unrecognized|internal/i);
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

  it('rejects credentials, fragments, non-GitHub hosts, and malformed evidence URLs', () => {
    const { validatePublicRepositoryAudit } = auditApi();
    const invalidAudits = [
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.ownerRepositoryUrl =
          'https://user:secret@github.com/example/fixture-tts-copy';
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.licenseDecisions[0]!.evidenceUrl = `https://github.com/example/fixture-tts/blob/${fixtureRevision}/LICENSE#terms`;
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.licenseDecisions[0]!.evidenceUrl =
          'https://licenses.example.com/fixture-tts';
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.provenanceEvidenceUrl = `https://github.com/example/fixture-tts/commit/${fixtureRevision}?diff=split`;
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.provenanceEvidenceUrl = 'not a URL';
        return audit;
      })(),
    ];

    for (const audit of invalidAudits) {
      expect(() => validatePublicRepositoryAudit(audit)).toThrow(/github|url|evidence/i);
    }
  });

  it('requires upstream revisions to be exactly 40 hexadecimal characters', () => {
    const { validatePublicRepositoryAudit } = auditApi();
    for (const upstreamRevision of [
      'main',
      '0123456789abcdef0123456789abcdef0123456',
      '0123456789abcdef0123456789abcdef012345678',
      'g123456789abcdef0123456789abcdef01234567',
    ]) {
      const audit = cloneAudit();
      audit.approvedPublicSources[0]!.upstreamRevision = upstreamRevision;

      expect(() => validatePublicRepositoryAudit(audit)).toThrow(/revision|40|hex/i);
    }
  });

  it('binds provenance and license evidence to the canonical repository and revision', () => {
    const { validatePublicRepositoryAudit } = auditApi();
    const otherRevision = '1123456789abcdef0123456789abcdef01234567';
    const invalidAudits = [
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.provenanceEvidenceUrl = `https://github.com/other/fixture-tts/commit/${fixtureRevision}`;
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.provenanceEvidenceUrl = `https://github.com/example/fixture-tts/commit/${otherRevision}`;
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.licenseDecisions[0]!.evidenceUrl = `https://github.com/other/fixture-tts/blob/${fixtureRevision}/LICENSE`;
        return audit;
      })(),
      (() => {
        const audit = cloneAudit();
        audit.approvedPublicSources[0]!.licenseDecisions[0]!.evidenceUrl = `https://github.com/example/fixture-tts/blob/${otherRevision}/LICENSE`;
        return audit;
      })(),
    ];

    for (const audit of invalidAudits) {
      expect(() => validatePublicRepositoryAudit(audit)).toThrow(
        /canonical|revision|provenance|license|evidence/i,
      );
    }
  });

  it('exposes only the public-safe approved-source envelope', () => {
    const { validatePublicRepositoryAudit } = auditApi();

    expect(Object.keys(validatePublicRepositoryAudit(cloneAudit())).sort()).toEqual([
      'approvedPublicSources',
      'generatedAt',
      'schemaVersion',
    ]);
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

  it('regenerates the committed SourceRecord artifact byte-for-byte through the CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'open-voice-audit-cli-'));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, 'source-records.public.json');
    const cliPath = fileURLToPath(new URL('../src/audit-cli.ts', import.meta.url));
    const tsxPath = fileURLToPath(
      new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url),
    );
    const auditPath = fileURLToPath(
      new URL('../data/repository-audit.public.json', import.meta.url),
    );
    const committedOutputPath = fileURLToPath(
      new URL('../data/source-records.public.json', import.meta.url),
    );

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      tsxPath,
      cliPath,
      auditPath,
      outputPath,
    ]);

    expect(stderr).toBe('');
    expect(stdout).toMatch(/Wrote 15 public source records/);
    expect(await readFile(outputPath, 'utf8')).toBe(await readFile(committedOutputPath, 'utf8'));
  });
});
