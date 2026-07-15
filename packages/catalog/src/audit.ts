import { readFile } from 'node:fs/promises';

import { SourceRecordSchema, type SourceRecord } from '@open-voice/contracts';
import { z } from 'zod';

export const AUDIT_CATEGORIES = [
  'tts',
  'voice-conversion',
  'stt',
  'voice-agent-infrastructure',
  'unrelated-false-positive',
  'needs-review',
] as const;

const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);
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

const HttpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        return new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Expected an HTTPS URL' },
  );

const GitHubRepositoryUrlSchema = HttpsUrlSchema.refine(
  (value) => {
    const url = new URL(value);
    const segments = url.pathname.split('/').filter(Boolean);
    return (
      url.hostname.toLowerCase() === 'github.com' &&
      segments.length === 2 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
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
    evidenceUrl: HttpsUrlSchema,
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
    category: AuditCategorySchema.exclude(['unrelated-false-positive', 'needs-review']),
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
    provenanceEvidenceUrl: HttpsUrlSchema,
    sourceClass: z.enum([
      'official-repository',
      'model-card',
      'maintainer-demo',
      'official-space',
      'official-documentation',
    ]),
    upstreamRevision: z.string().trim().min(1),
    retrievedAt: IsoDateTimeSchema,
    contentHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    lastVerifiedAt: IsoDateTimeSchema,
    health: z.enum(['healthy', 'degraded', 'unavailable']),
  })
  .strict();

const InventorySummarySchema = z
  .object({
    accessibleRepositories: z.number().int().nonnegative(),
    publicRepositories: z.number().int().nonnegative(),
    privateRepositories: z.number().int().nonnegative(),
    classifiedRepositories: z.number().int().nonnegative(),
    indexLookupStatus: z.enum(['found', 'confirmed-absent']),
    indexMdMatches: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((summary, context) => {
    if (
      summary.publicRepositories + summary.privateRepositories !==
      summary.accessibleRepositories
    ) {
      context.addIssue({
        code: 'custom',
        path: ['accessibleRepositories'],
        message: 'Public and private inventory counts must equal the accessible count',
      });
    }
    if (summary.classifiedRepositories !== summary.accessibleRepositories) {
      context.addIssue({
        code: 'custom',
        path: ['classifiedRepositories'],
        message: 'Classified count must equal the accessible inventory count',
      });
    }
    const expectedIndexMatches = summary.indexLookupStatus === 'found' ? 1 : 0;
    if (
      (expectedIndexMatches === 0 && summary.indexMdMatches !== 0) ||
      (expectedIndexMatches === 1 && summary.indexMdMatches < 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['indexMdMatches'],
        message: 'Index lookup status and match count must agree',
      });
    }
  });

const ClassificationSummarySchema = z
  .object({
    tts: z.number().int().nonnegative(),
    'voice-conversion': z.number().int().nonnegative(),
    stt: z.number().int().nonnegative(),
    'voice-agent-infrastructure': z.number().int().nonnegative(),
    'unrelated-false-positive': z.number().int().nonnegative(),
    'needs-review': z.number().int().nonnegative(),
  })
  .strict();

export const PublicRepositoryAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: IsoDateTimeSchema,
    inventorySummary: InventorySummarySchema,
    classificationSummary: ClassificationSummarySchema,
    approvedPublicSources: z.array(ApprovedPublicSourceSchema),
  })
  .strict()
  .superRefine((audit, context) => {
    const classificationCount = AUDIT_CATEGORIES.reduce(
      (sum, category) => sum + audit.classificationSummary[category],
      0,
    );
    if (classificationCount !== audit.inventorySummary.classifiedRepositories) {
      context.addIssue({
        code: 'custom',
        path: ['classificationSummary'],
        message: 'Classification counts must equal the classified inventory count',
      });
    }

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
    .sort((left, right) => left.id.localeCompare(right.id));
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
