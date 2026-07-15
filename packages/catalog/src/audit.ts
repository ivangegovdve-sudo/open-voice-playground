import { readFile } from 'node:fs/promises';

import { SourceRecordSchema, type SourceRecord } from '@open-voice/contracts';
import { z } from 'zod';

const ApprovedAuditCategorySchema = z.enum([
  'tts',
  'voice-conversion',
  'stt',
  'voice-agent-infrastructure',
]);
const AuditRuntimeModeSchema = z.enum([
  'browser',
  'online',
  'companion',
  'sample-only',
  'not-applicable',
  'needs-review',
]);
const RecordIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase record slug');
const IsoDateTimeSchema = z.string().datetime({ offset: true });

type IsoInstantParts = {
  epochSecond: number;
  fractionalSecond: string;
};

function parseIsoInstantParts(value: string): IsoInstantParts | undefined {
  const match = /^(.*?)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (match === null) {
    return undefined;
  }
  const epochMilliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(epochMilliseconds)) {
    return undefined;
  }
  return {
    epochSecond: epochMilliseconds / 1_000,
    fractionalSecond: match[2] ?? '',
  };
}

function compareIsoInstants(left: string, right: string): number {
  const leftParts = parseIsoInstantParts(left);
  const rightParts = parseIsoInstantParts(right);
  if (leftParts === undefined || rightParts === undefined) {
    return 0;
  }
  if (leftParts.epochSecond !== rightParts.epochSecond) {
    return leftParts.epochSecond < rightParts.epochSecond ? -1 : 1;
  }
  const precision = Math.max(leftParts.fractionalSecond.length, rightParts.fractionalSecond.length);
  for (let index = 0; index < precision; index += 1) {
    const leftDigit =
      index < leftParts.fractionalSecond.length ? leftParts.fractionalSecond.charCodeAt(index) : 48;
    const rightDigit =
      index < rightParts.fractionalSecond.length
        ? rightParts.fractionalSecond.charCodeAt(index)
        : 48;
    if (leftDigit !== rightDigit) {
      return leftDigit < rightDigit ? -1 : 1;
    }
  }
  return 0;
}

function parseCanonicalPublicGitHubUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      value !== url.href ||
      url.protocol !== 'https:' ||
      url.host !== 'github.com' ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function githubPathSegments(value: string): string[] | undefined {
  const url = parseCanonicalPublicGitHubUrl(value);
  if (url === undefined || !url.pathname.startsWith('/')) {
    return undefined;
  }
  const segments = url.pathname.slice(1).split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    return undefined;
  }
  return segments;
}

function hasExactGitHubPath(value: string, expectedSegments: readonly string[]): boolean {
  const actualSegments = githubPathSegments(value);
  return (
    actualSegments !== undefined &&
    actualSegments.length === expectedSegments.length &&
    actualSegments.every((segment, index) => segment === expectedSegments[index]) &&
    value === `https://github.com/${expectedSegments.join('/')}`
  );
}

const ApprovedPublicGitHubUrlSchema = z
  .string()
  .url()
  .refine((value) => githubPathSegments(value) !== undefined, {
    message:
      'Expected a canonical credential-free public GitHub HTTPS URL without port, query, fragment, encoding, or normalized path segments',
  });

const GitHubRepositoryUrlSchema = ApprovedPublicGitHubUrlSchema.refine(
  (value) => {
    const segments = githubPathSegments(value);
    return (
      segments !== undefined &&
      segments.length === 2 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(segments[0] ?? '') &&
      hasExactGitHubPath(value, segments)
    );
  },
  { message: 'Expected a canonical public GitHub repository URL' },
);

const LicenseDecisionSchema = z
  .object({
    scope: z.enum(['code', 'weights', 'voice', 'sample']),
    name: z.string().trim().min(1),
    spdxId: z.string().trim().min(1).optional(),
    exactUpstreamTerms: z.string().trim().min(1).optional(),
    evidenceUrl: ApprovedPublicGitHubUrlSchema,
    reviewStatus: z.enum(['verified', 'restricted', 'needs-review']),
  })
  .strict()
  .refine(
    (decision) =>
      decision.reviewStatus === 'needs-review' ||
      decision.spdxId !== undefined ||
      decision.exactUpstreamTerms !== undefined,
    { message: 'Reviewed license decisions require SPDX or exact upstream terms' },
  );

const ApprovedPublicSourceSchema = z
  .object({
    id: RecordIdSchema,
    ownerRepositoryUrl: GitHubRepositoryUrlSchema,
    canonicalUrl: GitHubRepositoryUrlSchema,
    visibility: z.literal('public'),
    approvalStatus: z.literal('approved-public'),
    category: ApprovedAuditCategorySchema,
    relevance: z.string().trim().min(1),
    runtimeModes: z
      .array(AuditRuntimeModeSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, 'Runtime modes must be unique'),
    reuseDecision: z.enum(['candidate-engine', 'reference-only']),
    licenseRisk: z.enum(['low', 'medium', 'high', 'needs-review']),
    licenseDecisions: z
      .array(LicenseDecisionSchema)
      .min(1)
      .refine(
        (decisions) => new Set(decisions.map(({ scope }) => scope)).size === decisions.length,
        'License decision scopes must be unique',
      ),
    provenanceEvidenceUrl: ApprovedPublicGitHubUrlSchema,
    sourceClass: z.enum([
      'official-repository',
      'model-card',
      'maintainer-demo',
      'official-space',
      'official-documentation',
    ]),
    upstreamRevision: z
      .string()
      .regex(/^[0-9a-fA-F]{40}$/, 'Expected an exact 40-hex Git commit revision'),
    retrievedAt: IsoDateTimeSchema,
    contentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    lastVerifiedAt: IsoDateTimeSchema,
    health: z.enum(['healthy', 'degraded', 'unavailable']),
  })
  .strict()
  .superRefine((source, context) => {
    if (compareIsoInstants(source.lastVerifiedAt, source.retrievedAt) < 0) {
      context.addIssue({
        code: 'custom',
        path: ['lastVerifiedAt'],
        message: 'lastVerifiedAt cannot be before retrievedAt',
      });
    }

    const canonicalSegments = githubPathSegments(source.canonicalUrl);
    if (canonicalSegments === undefined || canonicalSegments.length !== 2) {
      return;
    }

    if (
      !hasExactGitHubPath(source.provenanceEvidenceUrl, [
        ...canonicalSegments,
        'commit',
        source.upstreamRevision,
      ])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provenanceEvidenceUrl'],
        message: 'Provenance evidence must bind the canonical repository to the exact revision',
      });
    }

    source.licenseDecisions.forEach((decision, index) => {
      const evidenceSegments = githubPathSegments(decision.evidenceUrl);
      const evidencePath = evidenceSegments?.slice(4);
      if (
        evidenceSegments === undefined ||
        evidencePath === undefined ||
        evidencePath.length === 0 ||
        !hasExactGitHubPath(decision.evidenceUrl, [
          ...canonicalSegments,
          'blob',
          source.upstreamRevision,
          ...evidencePath,
        ])
      ) {
        context.addIssue({
          code: 'custom',
          path: ['licenseDecisions', index, 'evidenceUrl'],
          message: 'License evidence must bind the canonical repository to the exact revision',
        });
      }
    });
  });

export const PublicRepositoryAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDateTimeSchema,
    approvedPublicSources: z.array(ApprovedPublicSourceSchema),
  })
  .strict()
  .superRefine((audit, context) => {
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    audit.approvedPublicSources.forEach((source, index) => {
      if (seenIds.has(source.id)) {
        context.addIssue({
          code: 'custom',
          path: ['approvedPublicSources', index, 'id'],
          message: `Duplicate approved source ID: ${source.id}`,
        });
      }
      seenIds.add(source.id);
      if (seenUrls.has(source.canonicalUrl)) {
        context.addIssue({
          code: 'custom',
          path: ['approvedPublicSources', index, 'canonicalUrl'],
          message: `Duplicate approved canonical URL: ${source.canonicalUrl}`,
        });
      }
      seenUrls.add(source.canonicalUrl);
    });
  });

export type PublicRepositoryAudit = z.infer<typeof PublicRepositoryAuditSchema>;

export class PublicAuditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicAuditValidationError';
  }
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'audit'}: ${issue.message}`)
    .join('; ');
}

export function validatePublicRepositoryAudit(input: unknown): PublicRepositoryAudit {
  const parsed = PublicRepositoryAuditSchema.safeParse(input);
  if (!parsed.success) {
    throw new PublicAuditValidationError(
      `Public repository audit validation failed: ${formatSchemaIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

function compareSourceRecordIds(left: SourceRecord, right: SourceRecord): number {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export function importSourceRecordsFromAudit(input: unknown): SourceRecord[] {
  const audit = validatePublicRepositoryAudit(input);
  return audit.approvedPublicSources
    .map((record): SourceRecord => {
      const source = {
        id: record.id,
        canonicalUrl: record.canonicalUrl,
        sourceClass: record.sourceClass,
        upstreamRevision: record.upstreamRevision,
        retrievedAt: record.retrievedAt,
        lastVerifiedAt: record.lastVerifiedAt,
        health: record.health,
        ...(record.contentHash === undefined ? {} : { contentHash: record.contentHash }),
      };
      return SourceRecordSchema.parse(source);
    })
    .sort(compareSourceRecordIds);
}

export type SourceRecordCatalog = {
  schemaVersion: 1;
  generatedAt: string;
  sources: SourceRecord[];
};

export function buildSourceRecordCatalogFromAudit(input: unknown): SourceRecordCatalog {
  const audit = validatePublicRepositoryAudit(input);
  return {
    schemaVersion: 1,
    generatedAt: audit.generatedAt,
    sources: importSourceRecordsFromAudit(audit),
  };
}

export async function loadPublicRepositoryAudit(path: string): Promise<PublicRepositoryAudit> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new PublicAuditValidationError(
      `Unable to read public repository audit ${path}: ${reason}`,
    );
  }
  return validatePublicRepositoryAudit(decoded);
}
