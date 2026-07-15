import { z } from 'zod';

export const RUNTIME_MODES = ['browser', 'online', 'companion', 'sample-only'] as const;
export const RuntimeModeSchema = z.enum(RUNTIME_MODES);

export const GENDERS = ['female', 'male', 'neutral', 'unspecified'] as const;
export const GenderSchema = z.enum(GENDERS);

const EngineIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase engine slug');
const UpstreamIdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
    'Expected a path-free upstream identifier',
  );
const RecordIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Expected a lowercase record slug');
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'https:' || protocol === 'http:';
    },
    { message: 'Expected an HTTP(S) URL' },
  );

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const RuntimeModesSchema = z
  .array(RuntimeModeSchema)
  .min(1)
  .refine(hasUniqueValues, 'Runtime modes must be unique');
const RecordIdsSchema = z
  .array(RecordIdSchema)
  .min(1)
  .refine(hasUniqueValues, 'Record references must be unique');

export const StableIdSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?:[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
    'Expected <engine>:<upstream-id>',
  );

export const Bcp47LanguageTagSchema = z.string().refine(
  (value) => {
    if (value.length === 0 || value.trim() !== value || value.includes('_')) {
      return false;
    }

    try {
      return Intl.getCanonicalLocales(value).length === 1;
    } catch {
      return false;
    }
  },
  { message: 'Expected a valid BCP-47 language tag' },
);

export const LicenseRecordSchema = z
  .object({
    id: RecordIdSchema,
    scope: z.enum(['code', 'weights', 'voice', 'sample']),
    name: z.string().trim().min(1),
    spdxId: z.string().trim().min(1).optional(),
    exactUpstreamTerms: z.string().trim().min(1).optional(),
    evidenceUrl: HttpUrlSchema,
    attribution: z.string().trim().min(1),
    permitsRedistribution: z.boolean(),
    permitsCommercialUse: z.boolean(),
    reviewedAt: IsoDateTimeSchema,
    reviewStatus: z.enum(['verified', 'restricted', 'needs-review']),
  })
  .strict()
  .refine((record) => record.spdxId !== undefined || record.exactUpstreamTerms !== undefined, {
    message: 'A SPDX ID or exact upstream terms are required',
  });

export const SourceRecordSchema = z
  .object({
    id: RecordIdSchema,
    canonicalUrl: HttpUrlSchema,
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

export const EngineManifestSchema = z
  .object({
    id: EngineIdSchema,
    displayName: z.string().trim().min(1),
    classification: z.enum([
      'open-weight-local',
      'open-source-client-external-service',
      'sample-only',
    ]),
    runtimeModes: RuntimeModesSchema,
    languageTags: z
      .array(Bcp47LanguageTagSchema)
      .min(1)
      .refine(hasUniqueValues, 'Language tags must be unique'),
    licenseIds: RecordIdsSchema,
    sourceIds: RecordIdsSchema,
  })
  .strict()
  .superRefine((engine, context) => {
    const isSampleOnly = engine.classification === 'sample-only';
    const hasSampleOnlyMode = engine.runtimeModes.includes('sample-only');
    if (isSampleOnly !== hasSampleOnlyMode) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeModes'],
        message: 'Sample-only classification and runtime mode must agree',
      });
    }
    if (hasSampleOnlyMode && engine.runtimeModes.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeModes'],
        message: 'Sample-only cannot be mixed with runnable modes',
      });
    }
  });

export const VoicePresetSchema = z
  .object({
    id: StableIdSchema,
    engineId: EngineIdSchema,
    upstreamId: UpstreamIdSchema,
    displayName: z.string().trim().min(1),
    locale: Bcp47LanguageTagSchema,
    gender: GenderSchema,
    runtimeModes: RuntimeModesSchema,
    styleTags: z
      .array(z.string().trim().min(1))
      .refine(hasUniqueValues, 'Style tags must be unique'),
    licenseIds: RecordIdsSchema,
    sourceIds: RecordIdsSchema,
  })
  .strict()
  .superRefine((voice, context) => {
    if (voice.id !== `${voice.engineId}:${voice.upstreamId}`) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Voice ID must equal <engineId>:<upstreamId>',
      });
    }
    if (voice.runtimeModes.includes('sample-only') && voice.runtimeModes.length !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeModes'],
        message: 'Sample-only cannot be mixed with runnable modes',
      });
    }
  });

export const SampleManifestSchema = z
  .object({
    id: StableIdSchema,
    engineId: EngineIdSchema,
    voiceId: StableIdSchema.optional(),
    transcript: z.string().trim().min(1),
    locale: Bcp47LanguageTagSchema,
    durationSeconds: z.number().positive(),
    officialAudioUrl: HttpUrlSchema,
    officialPageUrl: HttpUrlSchema,
    licenseId: RecordIdSchema,
    sourceId: RecordIdSchema,
    verifiedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((sample, context) => {
    if (!sample.id.startsWith(`${sample.engineId}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Sample ID must use the engine prefix',
      });
    }
    if (sample.voiceId !== undefined && !sample.voiceId.startsWith(`${sample.engineId}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['voiceId'],
        message: 'Sample voice must belong to the same engine',
      });
    }
  });

export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;
export type Gender = z.infer<typeof GenderSchema>;
export type EngineManifest = z.infer<typeof EngineManifestSchema>;
export type VoicePreset = z.infer<typeof VoicePresetSchema>;
export type SampleManifest = z.infer<typeof SampleManifestSchema>;
export type LicenseRecord = z.infer<typeof LicenseRecordSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
