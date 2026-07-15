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

const ApprovedPublicGitHubUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          url.hostname.toLowerCase() === 'github.com' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    { message: 'Expected a credential-free public GitHub HTTPS URL without query or fragment' },
  );

const GitHubRepositoryUrlSchema = ApprovedPublicGitHubUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    return (
      segments.length === 2 &&
      segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment)) &&
      url.pathname === `/${segments[0]}/${segments[1]}`
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
    const expectedProvenanceUrl = `${source.canonicalUrl}/commit/${source.upstreamRevision}`;
    if (source.provenanceEvidenceUrl !== expectedProvenanceUrl) {
      context.addIssue({
        code: 'custom',
        path: ['provenanceEvidenceUrl'],
        message: 'Provenance evidence must bind the canonical repository to the exact revision',
      });
    }

    const licenseEvidencePrefix = `${source.canonicalUrl}/blob/${source.upstreamRevision}/`;
    source.licenseDecisions.forEach((decision, index) => {
      if (
        !decision.evidenceUrl.startsWith(licenseEvidencePrefix) ||
        decision.evidenceUrl.length === licenseEvidencePrefix.length
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
