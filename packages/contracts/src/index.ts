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
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'https:' || protocol === 'http:';
      } catch {
        return false;
      }
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
const StoredNonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Stored text cannot be blank');

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
    scope: z.enum([
      'code',
      'runtime',
      'weights',
      'voice',
      'dataset',
      'service',
      'sample',
      'generated-output',
    ]),
    name: z.string().trim().min(1),
    spdxId: z.string().trim().min(1).optional(),
    exactUpstreamTerms: z.string().trim().min(1).optional(),
    evidenceUrl: HttpUrlSchema,
    evidenceSha256: Sha256Schema.optional(),
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
      'official-service-snapshot',
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
    languageTags: z
      .array(Bcp47LanguageTagSchema)
      .min(1)
      .refine(hasUniqueValues, 'Language tags must be unique'),
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

export const POCKET_SELECTOR_IDS = [
  'english',
  'english_2026-01',
  'english_2026-04',
  'french_24l',
  'german',
  'german_24l',
  'italian',
  'italian_24l',
  'portuguese',
  'portuguese_24l',
  'spanish',
  'spanish_24l',
] as const;

export const POCKET_LABELS = [
  'alba',
  'anna',
  'azelma',
  'bill_boerst',
  'caro_davy',
  'charles',
  'cosette',
  'eponine',
  'estelle',
  'eve',
  'fantine',
  'george',
  'giovanni',
  'jane',
  'javert',
  'jean',
  'juergen',
  'lola',
  'marius',
  'mary',
  'michael',
  'paul',
  'peter_yearsley',
  'rafael',
  'stuart_bell',
  'vera',
] as const;

export const POCKET_RIGHTS_FAMILIES = [
  'alba-mackenna',
  'unmute-estelle',
  'vctk',
  'voice-zero',
  'voice-donation',
  'expresso',
  'ears',
  'repository-level-unclear',
] as const;

export const POCKET_LISTING_POLICIES = [
  'catalog-only-runtime-candidate',
  'link-only-noncommercial',
  'link-only-provenance-pending',
] as const;

const PocketSelectorIdSchema = z.enum(POCKET_SELECTOR_IDS);
const PocketLabelSchema = z.enum(POCKET_LABELS);
const PocketRightsFamilySchema = z.enum(POCKET_RIGHTS_FAMILIES);
const PocketListingPolicySchema = z.enum(POCKET_LISTING_POLICIES);
const PocketLanguageTagSchema = z.enum(['en', 'fr', 'de', 'it', 'pt', 'es']);
const PocketRuntimeExclusionReasonSchema = z.enum([
  'assets-not-release-pinned',
  'noncommercial-source-terms',
  'per-clip-provenance-unresolved',
]);

const pocketSelectorLanguages = {
  english: 'en',
  'english_2026-01': 'en',
  'english_2026-04': 'en',
  french_24l: 'fr',
  german: 'de',
  german_24l: 'de',
  italian: 'it',
  italian_24l: 'it',
  portuguese: 'pt',
  portuguese_24l: 'pt',
  spanish: 'es',
  spanish_24l: 'es',
} as const;

const pocketPolicyReasons = {
  'catalog-only-runtime-candidate': 'assets-not-release-pinned',
  'link-only-noncommercial': 'noncommercial-source-terms',
  'link-only-provenance-pending': 'per-clip-provenance-unresolved',
} as const;

export const PocketPresetVariantSchema = z
  .object({
    id: StableIdSchema,
    engineId: z.literal('pocket'),
    upstreamId: UpstreamIdSchema,
    selectorId: PocketSelectorIdSchema,
    label: PocketLabelSchema,
    upstreamPath: z.string().min(1),
    languageTag: PocketLanguageTagSchema,
    countryCode: z.null(),
    gender: z.literal('unspecified'),
    rightsFamily: PocketRightsFamilySchema,
    listingPolicy: PocketListingPolicySchema,
    runtimeExclusionReason: PocketRuntimeExclusionReasonSchema,
    licenseIds: RecordIdsSchema,
    sourceIds: RecordIdsSchema,
    officialDemoId: z.literal('pocket-official-live-demo'),
  })
  .strict()
  .superRefine((variant, context) => {
    const expectedUpstreamId = `${variant.selectorId}.${variant.label}`;
    if (variant.id !== `pocket:${expectedUpstreamId}`) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Pocket variant ID must be derived from its selector and label',
      });
    }
    if (variant.upstreamId !== expectedUpstreamId) {
      context.addIssue({
        code: 'custom',
        path: ['upstreamId'],
        message: 'Pocket upstream ID must be derived from its selector and label',
      });
    }
    if (
      variant.upstreamPath !==
      `languages/${variant.selectorId}/embeddings/${variant.label}.safetensors`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['upstreamPath'],
        message: 'Pocket upstream path must be derived from its selector and label',
      });
    }
    if (variant.languageTag !== pocketSelectorLanguages[variant.selectorId]) {
      context.addIssue({
        code: 'custom',
        path: ['languageTag'],
        message: 'Pocket language tag must match its selector',
      });
    }
    if (variant.runtimeExclusionReason !== pocketPolicyReasons[variant.listingPolicy]) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeExclusionReason'],
        message: 'Pocket listing policy must use its exact runtime exclusion reason',
      });
    }
  });

const POCKET_OFFICIAL_LIVE_DEMO_RIGHTS_BASIS =
  'External live-generation page only; no conditioning audio or output is copied, proxied, cached, or redistributed.';

export const PocketOfficialLiveDemoSchema = z
  .object({
    id: z.literal('pocket-official-live-demo'),
    engineId: z.literal('pocket'),
    pageUrl: z.literal('https://kyutai.org/tts'),
    sourceIds: z.tuple([z.literal('pocket-official-live-demo-source')]),
    outputClipStatus: z.literal('no-stable-official-generated-output-found'),
    audioPublished: z.literal(false),
    offlineAvailable: z.literal(false),
    rightsBasis: z.literal(POCKET_OFFICIAL_LIVE_DEMO_RIGHTS_BASIS),
    reviewedAt: IsoDateTimeSchema,
  })
  .strict();

const PocketRevisionPinsSchema = z
  .object({
    stableCode: z.literal('058886528d0b6f2f2d4022de2e244a5260729e6e'),
    currentCodeAudit: z.literal('d108410d23eef7e01db282f9442891162dbc3db6'),
    fullModel: z.literal('4c8ad48f8a003909bc4f1122cbe88a4252124621'),
    noCloningModel: z.literal('e041936c75475d350b405bc870bcf7c22da4e9e6'),
    voiceRepository: z.literal('323332d33f997de8394f24a193e1a76df720e01a'),
    historicalPromptSnapshot: z.literal('64ab7d24c479d736a83b8cc666c4a776fca30fda'),
  })
  .strict();

const PocketLanguageCountsSchema = z
  .object({
    en: z.literal(78),
    fr: z.literal(26),
    de: z.literal(52),
    it: z.literal(52),
    pt: z.literal(52),
    es: z.literal(52),
  })
  .strict();

const PocketRightsCountsSchema = z
  .object({
    catalogOnlyRuntimeCandidate: z.literal(240),
    linkOnlyNonCommercial: z.literal(24),
    linkOnlyProvenancePending: z.literal(48),
  })
  .strict();

const PocketAuditSourceIdsSchema = z.tuple([
  z.literal('pocket-code-source'),
  z.literal('pocket-current-code-audit-source'),
  z.literal('pocket-full-model-source'),
  z.literal('pocket-weights-source'),
  z.literal('pocket-voice-source'),
  z.literal('pocket-historical-prompt-source'),
  z.literal('pocket-multilingual-announcement-source'),
  z.literal('pocket-official-live-demo-source'),
]);

const POCKET_LANGUAGE_COUNTS = {
  en: 78,
  fr: 26,
  de: 52,
  it: 52,
  pt: 52,
  es: 52,
} as const;

const POCKET_RIGHTS_COUNTS = {
  'catalog-only-runtime-candidate': 240,
  'link-only-noncommercial': 24,
  'link-only-provenance-pending': 48,
} as const;

export const PocketCoverageManifestSchema = z
  .object({
    id: z.literal('pocket-multilingual-coverage'),
    engineId: z.literal('pocket'),
    revisionPins: PocketRevisionPinsSchema,
    inventorySha256: Sha256Schema,
    selectorCount: z.literal(12),
    labelCount: z.literal(26),
    totalEmbeddings: z.literal(312),
    languageCounts: PocketLanguageCountsSchema,
    rightsCounts: PocketRightsCountsSchema,
    publishedOutputClipCount: z.literal(0),
    auditSourceIds: PocketAuditSourceIdsSchema,
    variants: z.array(PocketPresetVariantSchema).length(312),
    officialDemo: PocketOfficialLiveDemoSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const variantIds = manifest.variants.map(({ id }) => id);
    if (!hasUniqueValues(variantIds)) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Pocket variant IDs must be unique',
      });
    }

    const upstreamPaths = manifest.variants.map(({ upstreamPath }) => upstreamPath);
    if (!hasUniqueValues(upstreamPaths)) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Pocket variant upstream paths must be unique',
      });
    }

    const selectorIds = new Set(manifest.variants.map(({ selectorId }) => selectorId));
    const labels = new Set(manifest.variants.map(({ label }) => label));
    if (selectorIds.size !== manifest.selectorCount || labels.size !== manifest.labelCount) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Pocket variants must close over exactly 12 selectors and 26 labels',
      });
    }

    const languageCounts = Object.fromEntries(
      Object.keys(POCKET_LANGUAGE_COUNTS).map((languageTag) => [languageTag, 0]),
    ) as Record<keyof typeof POCKET_LANGUAGE_COUNTS, number>;
    const rightsCounts = Object.fromEntries(
      Object.keys(POCKET_RIGHTS_COUNTS).map((listingPolicy) => [listingPolicy, 0]),
    ) as Record<keyof typeof POCKET_RIGHTS_COUNTS, number>;
    for (const variant of manifest.variants) {
      languageCounts[variant.languageTag] += 1;
      rightsCounts[variant.listingPolicy] += 1;
      if (variant.officialDemoId !== manifest.officialDemo.id) {
        context.addIssue({
          code: 'custom',
          path: ['variants'],
          message: 'Pocket variants must join the exact official live demo',
        });
      }
    }

    if (
      Object.entries(POCKET_LANGUAGE_COUNTS).some(
        ([languageTag, expected]) =>
          languageCounts[languageTag as keyof typeof POCKET_LANGUAGE_COUNTS] !== expected,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Pocket variant language totals must match the exact coverage closure',
      });
    }
    if (
      Object.entries(POCKET_RIGHTS_COUNTS).some(
        ([listingPolicy, expected]) =>
          rightsCounts[listingPolicy as keyof typeof POCKET_RIGHTS_COUNTS] !== expected,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Pocket variant rights totals must match the exact coverage closure',
      });
    }
  });

export const RELEASE_GATE_REASONS = [
  'terms-not-cleared',
  'asset-unavailable',
  'companion-not-connected',
  'feature-disabled',
  'consent-required',
  'license-acceptance-required',
  'unsupported-browser',
] as const;

export const ReleaseGateSchema = z
  .object({
    status: z.enum(['enabled', 'unavailable']),
    reason: z.enum(RELEASE_GATE_REASONS).nullable(),
    detail: z.string().trim().min(1),
  })
  .strict()
  .superRefine((gate, context) => {
    if ((gate.status === 'enabled') !== (gate.reason === null)) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Enabled gates require a null reason; unavailable gates require a reason',
      });
    }
  });

const SafeHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username.length > 0 ||
        url.password.length > 0 ||
        /(?:^|\/)main(?:\/|$)/i.test(url.pathname) ||
        /refs(?:%2f|\/)heads/i.test(url.pathname)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, 'Expected a credential-free HTTPS URL without a mutable branch reference');

const ImmutableHttpsUrlSchema = SafeHttpsUrlSchema.refine(
  (value) => /[a-f0-9]{40}/.test(new URL(value).pathname),
  'Expected an immutable HTTPS URL containing a pinned revision',
);

const CanonicalImmutableAssetUrlSchema = ImmutableHttpsUrlSchema.refine((value) => {
  const queryDelimiterIndex = value.indexOf('?');
  return (
    !value.includes('#') &&
    (queryDelimiterIndex === -1 || value.slice(queryDelimiterIndex) === '?download=true')
  );
}, 'Expected no query or the exact reviewed ?download=true query and no fragment');

const ExactHttpsOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username.length === 0 &&
        url.password.length === 0 &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }, 'Expected an exact credential-free HTTPS origin without a path, query, or fragment');

export const AssetAcceptanceSchema = z
  .object({
    licenseId: RecordIdSchema,
    termsHash: Sha256Schema,
  })
  .strict();

const CacheKeySchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/,
    'Expected a safe namespaced cache key',
  );

export const BrowserRuntimeBackendSchema = z.enum(['webgpu', 'wasm']);

const ONNXRUNTIME_WEB_TARBALL_URL =
  'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.27.0.tgz';
const ONNXRUNTIME_WEB_TARBALL_INTEGRITY =
  'sha512-ogDLsqIozHZwifPuN37OproAo0byX6t43/bP8GzeZWBWD6MOGExswFAx3up4NS/vvWBOg2u2PXomDt3rMmdQSg==';
const ONNXRUNTIME_WEB_TARBALL_SHA1 = 'sha1:3cfdf3e5f5d554098b5a729b7603d7686d2f69b4';
const ONNXRUNTIME_WEB_RUNTIME_PATHS = {
  webgpu: 'dist/ort-wasm-simd-threaded.jsep.wasm',
  wasm: 'dist/ort-wasm-simd-threaded.wasm',
} as const;

export const BrowserRuntimeArtifactSchema = z
  .object({
    id: RecordIdSchema,
    backend: BrowserRuntimeBackendSchema,
    packageName: z.literal('onnxruntime-web'),
    packageVersion: z.literal('1.27.0'),
    tarballUrl: z.literal(ONNXRUNTIME_WEB_TARBALL_URL),
    tarballIntegrity: z.literal(ONNXRUNTIME_WEB_TARBALL_INTEGRITY),
    tarballSha1: z.literal(ONNXRUNTIME_WEB_TARBALL_SHA1),
    packagePath: z.enum([ONNXRUNTIME_WEB_RUNTIME_PATHS.webgpu, ONNXRUNTIME_WEB_RUNTIME_PATHS.wasm]),
    sha256: Sha256Schema,
    bytes: z.number().int().positive().max(2_147_483_648),
    mediaType: z.literal('application/wasm'),
    cacheKey: CacheKeySchema,
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.packagePath !== ONNXRUNTIME_WEB_RUNTIME_PATHS[artifact.backend]) {
      context.addIssue({
        code: 'custom',
        path: ['packagePath'],
        message: 'Runtime package path must match its exact backend binary',
      });
    }
  });

export const BrowserRuntimeArtifactsSchema = z
  .array(BrowserRuntimeArtifactSchema)
  .min(1)
  .refine(
    (artifacts) => hasUniqueValues(artifacts.map(({ id }) => id)),
    'Browser runtime artifact IDs must be unique',
  );

export const BrowserRuntimeSelectionSchema = z
  .object({
    id: RecordIdSchema,
    engineId: EngineIdSchema,
    backend: BrowserRuntimeBackendSchema,
    assetSetId: RecordIdSchema,
    runtimeArtifactId: RecordIdSchema,
    selectionDigest: Sha256Schema,
  })
  .strict();

export const BrowserRuntimeSelectionsSchema = z
  .array(BrowserRuntimeSelectionSchema)
  .min(1)
  .refine(
    (selections) => hasUniqueValues(selections.map(({ id }) => id)),
    'Browser runtime selection IDs must be unique',
  );

export const ImmutableAssetSchema = z
  .object({
    id: RecordIdSchema,
    url: CanonicalImmutableAssetUrlSchema,
    approvedFinalOrigins: z
      .array(ExactHttpsOriginSchema)
      .min(1)
      .refine(hasUniqueValues, 'Approved final origins must be unique'),
    revision: GitRevisionSchema,
    sha256: Sha256Schema,
    bytes: z.number().int().positive().max(2_147_483_648),
    cacheKey: CacheKeySchema,
    mediaType: z.string().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/),
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
    requiredAcceptance: AssetAcceptanceSchema.nullable(),
  })
  .strict()
  .refine((asset) => asset.url.includes(asset.revision), {
    path: ['url'],
    message: 'Asset URL must contain the pinned revision',
  });

export const PinnedReleaseAssetEvidenceSchema = z
  .object({
    id: RecordIdSchema,
    voiceId: z
      .string({ error: 'Piper voice binding is required' })
      .pipe(StableIdSchema)
      .refine((value) => value.startsWith('piper:'), {
        message: 'Release evidence voice must be a Piper preset',
      }),
    provider: z.literal('github-release-asset'),
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    releaseId: z.number().int().positive(),
    assetId: z.number().int().positive(),
    assetName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    apiUrl: SafeHttpsUrlSchema,
    browserDownloadUrl: SafeHttpsUrlSchema,
    sha256: Sha256Schema,
    bytes: z.number().int().positive(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    corsReadable: z.literal(false),
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const api = new URL(evidence.apiUrl);
    const download = new URL(evidence.browserDownloadUrl);
    if (
      api.hostname !== 'api.github.com' ||
      api.pathname !== `/repos/${evidence.repository}/releases/assets/${evidence.assetId}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['apiUrl'],
        message: 'GitHub asset API URL must match repository and asset ID',
      });
    }
    if (
      download.hostname !== 'github.com' ||
      !download.pathname.startsWith(`/${evidence.repository}/releases/download/`) ||
      !download.pathname.endsWith(`/${evidence.assetName}`)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['browserDownloadUrl'],
        message: 'GitHub release URL must match repository and asset name',
      });
    }
  });

export const AssetDeliveryEvidenceSchema = z
  .object({
    id: RecordIdSchema,
    engineId: EngineIdSchema,
    assetSetIds: RecordIdsSchema,
    checkedAssetIds: RecordIdsSchema,
    scope: z.enum(['representative-assets', 'all-required-assets']),
    result: z.enum(['representative-pass', 'all-required-pass', 'failed']),
    checkedAt: IsoDateTimeSchema,
    browser: z.string().trim().min(1),
    origin: HttpUrlSchema,
    request: z
      .object({
        method: z.literal('GET'),
        rangeHeader: z.string().regex(/^bytes=\d+-\d+$/),
        mode: z.literal('cors'),
        credentials: z.literal('omit'),
        redirect: z.literal('follow'),
        cache: z.literal('no-store'),
      })
      .strict(),
    observations: z
      .array(
        z
          .object({
            assetId: RecordIdSchema,
            responseType: z.literal('cors'),
            status: z.literal(206),
            bytesRead: z.literal(1),
            contentRange: z.string().regex(/^bytes 0-0\/\d+$/),
          })
          .strict(),
      )
      .min(1),
    detail: z.string().trim().min(1),
  })
  .strict()
  .superRefine((evidence, context) => {
    const observedIds = evidence.observations.map(({ assetId }) => assetId);
    if (
      !hasUniqueValues(observedIds) ||
      JSON.stringify([...observedIds].sort()) !==
        JSON.stringify([...evidence.checkedAssetIds].sort())
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Checked asset IDs must match the unique browser observations',
      });
    }
    if (
      (evidence.scope === 'representative-assets') !==
        (evidence.result === 'representative-pass') &&
      evidence.result !== 'failed'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery result cannot claim broader coverage than its recorded scope',
      });
    }
  });

export const AssetSetManifestSchema = z
  .object({
    id: RecordIdSchema,
    engineId: EngineIdSchema,
    manifestDigest: Sha256Schema,
    assets: z.array(ImmutableAssetSchema).min(1),
    totalBytes: z.number().int().positive(),
    requiredAcceptanceLicenseIds: z
      .array(RecordIdSchema)
      .refine(hasUniqueValues, 'Acceptance licenses must be unique'),
    releaseGate: ReleaseGateSchema,
  })
  .strict()
  .superRefine((assetSet, context) => {
    const ids = assetSet.assets.map(({ id }) => id);
    if (!hasUniqueValues(ids)) {
      context.addIssue({ code: 'custom', path: ['assets'], message: 'Asset IDs must be unique' });
    }
    const byteTotal = assetSet.assets.reduce((total, asset) => total + asset.bytes, 0);
    if (byteTotal !== assetSet.totalBytes) {
      context.addIssue({
        code: 'custom',
        path: ['totalBytes'],
        message: 'Asset-set byte total must equal the sum of its assets',
      });
    }
  });

const EvidenceByteCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const PositiveEvidenceByteCountSchema = EvidenceByteCountSchema.refine(
  (value) => value > 0,
  'Expected a positive exact byte count',
);

const BrowserRuntimeS0ConsentSchema = z
  .object({
    assetSetId: RecordIdSchema,
    manifestDigest: Sha256Schema,
    acceptedLicenseIds: z
      .array(RecordIdSchema)
      .refine(hasUniqueValues, 'Accepted license IDs must be unique'),
    acceptedTermsHashes: z
      .array(Sha256Schema)
      .refine(hasUniqueValues, 'Accepted terms hashes must be unique'),
  })
  .strict();

const BrowserRuntimeS0StorageSchema = z
  .object({
    selectedBytes: PositiveEvidenceByteCountSchema,
    largestAssetBytes: PositiveEvidenceByteCountSchema,
    safetyMarginBytes: EvidenceByteCountSchema.min(8 * 1024 * 1024).max(64 * 1024 * 1024),
    upperBoundBytes: PositiveEvidenceByteCountSchema,
    persisted: z.boolean().nullable(),
    quotaBytes: EvidenceByteCountSchema.nullable(),
    usageBytes: EvidenceByteCountSchema.nullable(),
    retainedBytes: EvidenceByteCountSchema,
    candidateBytes: EvidenceByteCountSchema,
    largestTemporaryBytes: EvidenceByteCountSchema,
    additionalRequiredBytes: EvidenceByteCountSchema,
    requiredCapacityBytes: EvidenceByteCountSchema,
  })
  .strict()
  .superRefine((storage, context) => {
    const exactSum = (...values: number[]): number | null => {
      const total = values.reduce((sum, value) => sum + value, 0);
      return Number.isSafeInteger(total) ? total : null;
    };
    const expectedSelected = exactSum(storage.retainedBytes, storage.candidateBytes);
    const expectedUpperBound = exactSum(
      storage.selectedBytes,
      storage.largestAssetBytes,
      storage.safetyMarginBytes,
    );
    const expectedAdditional =
      storage.candidateBytes === 0
        ? 0
        : exactSum(
            storage.candidateBytes,
            storage.largestTemporaryBytes,
            storage.safetyMarginBytes,
          );
    const expectedRequired =
      expectedAdditional === null ? null : exactSum(storage.retainedBytes, expectedAdditional);
    if (
      expectedSelected !== storage.selectedBytes ||
      expectedUpperBound !== storage.upperBoundBytes ||
      expectedAdditional !== storage.additionalRequiredBytes ||
      expectedRequired !== storage.requiredCapacityBytes ||
      storage.largestAssetBytes > storage.selectedBytes ||
      storage.largestTemporaryBytes > storage.largestAssetBytes ||
      (storage.candidateBytes === 0 && storage.largestTemporaryBytes !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'S0 storage evidence arithmetic is inconsistent or unbounded',
      });
    }
  });

const BrowserRuntimeS0AssetEvidenceBase = z.object({
  assetId: RecordIdSchema,
  cacheKey: CacheKeySchema,
  expectedBytes: PositiveEvidenceByteCountSchema,
  observedBytes: PositiveEvidenceByteCountSchema,
  expectedSha256: Sha256Schema,
  observedSha256: Sha256Schema,
});

const BrowserRuntimeS0RedactedFinalUrlSchema = SafeHttpsUrlSchema.refine((value) => {
  try {
    const url = new URL(value);
    return value === `${url.origin}/<redacted>`;
  } catch {
    return false;
  }
}, 'Expected an HTTPS origin followed by the fixed /<redacted> path');

const BrowserRuntimeS0CacheHitEvidenceSchema = BrowserRuntimeS0AssetEvidenceBase.extend({
  disposition: z.literal('cache-hit'),
  requestUrl: z.null(),
  finalUrlRedacted: z.null(),
  finalUrlSha256: z.null(),
  finalOrigin: z.null(),
  responseType: z.null(),
  status: z.null(),
})
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.expectedBytes !== asset.observedBytes ||
      asset.expectedSha256 !== asset.observedSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Cache-hit evidence must preserve exact identity',
      });
    }
  });

const BrowserRuntimeS0DownloadEvidenceSchema = BrowserRuntimeS0AssetEvidenceBase.extend({
  disposition: z.literal('downloaded'),
  requestUrl: CanonicalImmutableAssetUrlSchema,
  finalUrlRedacted: BrowserRuntimeS0RedactedFinalUrlSchema,
  finalUrlSha256: Sha256Schema,
  finalOrigin: ExactHttpsOriginSchema,
  responseType: z.literal('cors'),
  status: z.literal(200),
})
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.expectedBytes !== asset.observedBytes ||
      asset.expectedSha256 !== asset.observedSha256 ||
      asset.finalUrlRedacted !== `${asset.finalOrigin}/<redacted>`
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Downloaded evidence must preserve exact identity and a redacted final URL origin',
      });
    }
  });

export const BrowserRuntimeS0EvidenceStructureSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal('open-voice-browser-runtime-s0'),
    assetSetId: RecordIdSchema,
    manifestDigest: Sha256Schema,
    consent: BrowserRuntimeS0ConsentSchema,
    storage: BrowserRuntimeS0StorageSchema,
    assets: z
      .array(
        z.discriminatedUnion('disposition', [
          BrowserRuntimeS0CacheHitEvidenceSchema,
          BrowserRuntimeS0DownloadEvidenceSchema,
        ]),
      )
      .min(1),
  })
  .strict()
  .superRefine((evidence, context) => {
    const assetIds = evidence.assets.map(({ assetId }) => assetId);
    const cacheKeys = evidence.assets.map(({ cacheKey }) => cacheKey);
    if (
      evidence.consent.assetSetId !== evidence.assetSetId ||
      evidence.consent.manifestDigest !== evidence.manifestDigest ||
      !hasUniqueValues(assetIds) ||
      !hasUniqueValues(cacheKeys)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'S0 evidence must bind exact consent and unique selected asset identities',
      });
    }
  });

export function parseBrowserRuntimeS0Evidence(
  value: unknown,
  trustedAssetSetInput: AssetSetManifest,
): BrowserRuntimeS0Evidence {
  const trustedAssetSet = AssetSetManifestSchema.parse(trustedAssetSetInput);
  const boundSchema = BrowserRuntimeS0EvidenceStructureSchema.superRefine((evidence, context) => {
    const addBindingIssue = (path: Array<string | number>, message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    if (evidence.assetSetId !== trustedAssetSet.id) {
      addBindingIssue(
        ['assetSetId'],
        'S0 evidence asset-set ID does not match the trusted manifest',
      );
    }
    if (evidence.manifestDigest !== trustedAssetSet.manifestDigest) {
      addBindingIssue(
        ['manifestDigest'],
        'S0 evidence digest does not match the trusted manifest digest',
      );
    }
    for (const licenseId of trustedAssetSet.requiredAcceptanceLicenseIds) {
      if (!evidence.consent.acceptedLicenseIds.includes(licenseId)) {
        addBindingIssue(
          ['consent', 'acceptedLicenseIds'],
          `S0 evidence is missing required license acceptance ${licenseId}`,
        );
      }
    }
    const requiredTermsHashes = [
      ...new Set(
        trustedAssetSet.assets.flatMap((asset) =>
          asset.requiredAcceptance === null ? [] : [asset.requiredAcceptance.termsHash],
        ),
      ),
    ];
    for (const termsHash of requiredTermsHashes) {
      if (!evidence.consent.acceptedTermsHashes.includes(termsHash)) {
        addBindingIssue(
          ['consent', 'acceptedTermsHashes'],
          `S0 evidence is missing required terms acceptance ${termsHash}`,
        );
      }
    }

    if (evidence.assets.length !== trustedAssetSet.assets.length) {
      addBindingIssue(
        ['assets'],
        'S0 evidence assets must have the exact trusted manifest length and order',
      );
    }
    for (const [index, trustedAsset] of trustedAssetSet.assets.entries()) {
      const assetEvidence = evidence.assets[index];
      if (assetEvidence === undefined) continue;
      const expectedIdentity = [
        ['assetId', assetEvidence.assetId, trustedAsset.id],
        ['cacheKey', assetEvidence.cacheKey, trustedAsset.cacheKey],
        ['expectedBytes', assetEvidence.expectedBytes, trustedAsset.bytes],
        ['observedBytes', assetEvidence.observedBytes, trustedAsset.bytes],
        ['expectedSha256', assetEvidence.expectedSha256, trustedAsset.sha256],
        ['observedSha256', assetEvidence.observedSha256, trustedAsset.sha256],
      ] as const;
      for (const [field, observed, expected] of expectedIdentity) {
        if (observed !== expected) {
          addBindingIssue(
            ['assets', index, field],
            `S0 evidence ${field} does not match trusted manifest asset ${trustedAsset.id}`,
          );
        }
      }
      if (assetEvidence.disposition === 'downloaded') {
        if (assetEvidence.requestUrl !== trustedAsset.url) {
          addBindingIssue(
            ['assets', index, 'requestUrl'],
            `S0 evidence request URL does not match trusted manifest asset ${trustedAsset.id}`,
          );
        }
        if (!trustedAsset.approvedFinalOrigins.includes(assetEvidence.finalOrigin)) {
          addBindingIssue(
            ['assets', index, 'finalOrigin'],
            `S0 evidence final origin is not approved for trusted manifest asset ${trustedAsset.id}`,
          );
        }
      }
    }

    const safetyMarginBytes = Math.min(
      64 * 1024 * 1024,
      Math.max(8 * 1024 * 1024, Math.ceil(trustedAssetSet.totalBytes * 0.05)),
    );
    const largestAssetBytes = Math.max(...trustedAssetSet.assets.map((asset) => asset.bytes));
    let retainedBytes = 0;
    let candidateBytes = 0;
    let largestTemporaryBytes = 0;
    for (const [index, trustedAsset] of trustedAssetSet.assets.entries()) {
      if (evidence.assets[index]?.disposition === 'cache-hit') {
        retainedBytes += trustedAsset.bytes;
      } else {
        candidateBytes += trustedAsset.bytes;
        largestTemporaryBytes = Math.max(largestTemporaryBytes, trustedAsset.bytes);
      }
    }
    const additionalRequiredBytes =
      candidateBytes === 0 ? 0 : candidateBytes + largestTemporaryBytes + safetyMarginBytes;
    const expectedStorage = {
      selectedBytes: trustedAssetSet.totalBytes,
      largestAssetBytes,
      safetyMarginBytes,
      upperBoundBytes: trustedAssetSet.totalBytes + largestAssetBytes + safetyMarginBytes,
      retainedBytes,
      candidateBytes,
      largestTemporaryBytes,
      additionalRequiredBytes,
      requiredCapacityBytes: retainedBytes + additionalRequiredBytes,
    } as const;
    for (const [field, expected] of Object.entries(expectedStorage)) {
      if (evidence.storage[field as keyof typeof expectedStorage] !== expected) {
        addBindingIssue(
          ['storage', field],
          `S0 storage ${field} does not match the trusted manifest and asset dispositions`,
        );
      }
    }
  });
  return boundSchema.parse(value);
}

export const FeatureFlagSchema = z
  .object({
    id: RecordIdSchema,
    enabled: z.boolean(),
    serverOnlyCredentials: z.boolean(),
    termsCleared: z.boolean(),
    monthlyBudgetUsd: z.number().nonnegative(),
    hardStop: z.boolean(),
    characterLimit: z.number().int().nonnegative(),
    spendLimitUsd: z.number().nonnegative(),
  })
  .strict()
  .superRefine((flag, context) => {
    if (
      flag.id === 'future-azure-inference' &&
      (flag.enabled ||
        !flag.serverOnlyCredentials ||
        flag.termsCleared ||
        flag.monthlyBudgetUsd !== 0 ||
        !flag.hardStop ||
        flag.characterLimit !== 0 ||
        flag.spendLimitUsd !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Future Azure inference must start hard-disabled, terms-gated, and zero-budget',
      });
    }
  });

const ScalarControlSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean()]);
const OperationIdSchema = z.number().int().safe().nonnegative();
const GENERIC_WORKER_ENGINE_IDS = ['kokoro', 'kitten', 'piper'] as const;
const WorkerVoiceIdSchema = StableIdSchema;

function freezeTrustAnchor<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeTrustAnchor(nested);
  Object.freeze(value);
  return value;
}

export const SUPERTONIC_VOICE_IDS = freezeTrustAnchor([
  'supertonic:F1',
  'supertonic:F2',
  'supertonic:F3',
  'supertonic:F4',
  'supertonic:F5',
  'supertonic:M1',
  'supertonic:M2',
  'supertonic:M3',
  'supertonic:M4',
  'supertonic:M5',
] as const);

export const SUPERTONIC_LANGUAGES = freezeTrustAnchor([
  'ar',
  'bg',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'et',
  'fi',
  'fr',
  'de',
  'el',
  'hi',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lv',
  'lt',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'es',
  'sv',
  'tr',
  'uk',
  'vi',
] as const);

export const SUPERTONIC_TRANSFERRED_ASSET_IDS = freezeTrustAnchor([
  'onnx-duration-predictor-onnx',
  'onnx-text-encoder-onnx',
  'onnx-tts-json',
  'onnx-unicode-indexer-json',
  'onnx-vector-estimator-onnx',
  'onnx-vocoder-onnx',
  'voice-styles-f1-json',
  'voice-styles-f2-json',
  'voice-styles-f3-json',
  'voice-styles-f4-json',
  'voice-styles-f5-json',
  'voice-styles-m1-json',
  'voice-styles-m2-json',
  'voice-styles-m3-json',
  'voice-styles-m4-json',
  'voice-styles-m5-json',
] as const);

export const SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES = freezeTrustAnchor([
  {
    assetId: 'onnx-duration-predictor-onnx',
    sha256: 'sha256:c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db',
    byteLength: 3_700_147,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-text-encoder-onnx',
    sha256: 'sha256:c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff',
    byteLength: 36_416_150,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-tts-json',
    sha256: 'sha256:42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09',
    byteLength: 8_253,
    mediaType: 'application/json',
  },
  {
    assetId: 'onnx-unicode-indexer-json',
    sha256: 'sha256:9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f',
    byteLength: 277_676,
    mediaType: 'application/json',
  },
  {
    assetId: 'onnx-vector-estimator-onnx',
    sha256: 'sha256:883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c',
    byteLength: 256_534_781,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'onnx-vocoder-onnx',
    sha256: 'sha256:085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba',
    byteLength: 101_424_195,
    mediaType: 'application/onnx',
  },
  {
    assetId: 'voice-styles-f1-json',
    sha256: 'sha256:bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2',
    byteLength: 292_046,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f2-json',
    sha256: 'sha256:7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6',
    byteLength: 292_423,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f3-json',
    sha256: 'sha256:12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab',
    byteLength: 290_794,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f4-json',
    sha256: 'sha256:c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b',
    byteLength: 291_808,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-f5-json',
    sha256: 'sha256:45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d',
    byteLength: 291_479,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m1-json',
    sha256: 'sha256:e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b',
    byteLength: 291_748,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m2-json',
    sha256: 'sha256:b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50',
    byteLength: 292_055,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m3-json',
    sha256: 'sha256:ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b',
    byteLength: 290_198,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m4-json',
    sha256: 'sha256:ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303',
    byteLength: 291_522,
    mediaType: 'application/json',
  },
  {
    assetId: 'voice-styles-m5-json',
    sha256: 'sha256:dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2',
    byteLength: 291_469,
    mediaType: 'application/json',
  },
] as const);

export const SUPERTONIC_ASSET_SET_ID = 'supertonic-browser-assets' as const;
export const SUPERTONIC_MANIFEST_DIGEST =
  'sha256:551c3d087981bdce978531d8b93610e295ca58bb28341d64ca7d61a58f4dd8b6' as const;

const SupertonicVoiceIdSchema = z.enum(SUPERTONIC_VOICE_IDS);
const SupertonicLanguageSchema = z.enum(SUPERTONIC_LANGUAGES);
const SupertonicTransferredAssetIdSchema = z.enum(SUPERTONIC_TRANSFERRED_ASSET_IDS);

function isOwnedArrayBuffer(value: unknown): value is ArrayBuffer {
  if (!(value instanceof ArrayBuffer)) return false;
  try {
    ArrayBuffer.prototype.slice.call(value, 0, 0);
    return true;
  } catch {
    return false;
  }
}

const OwnedArrayBufferSchema = z.custom<ArrayBuffer>(isOwnedArrayBuffer, {
  message: 'Expected an attached ArrayBuffer owned by the sender',
});

const supertonicAssetIdentityById = new Map(
  SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.map((identity) => [identity.assetId, identity]),
);

export const SupertonicTransferredAssetSchema = z
  .object({
    assetId: SupertonicTransferredAssetIdSchema,
    sha256: Sha256Schema,
    byteLength: z.number().int().positive().safe(),
    mediaType: z.enum(['application/onnx', 'application/json']),
    bytes: OwnedArrayBufferSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    const expected = supertonicAssetIdentityById.get(asset.assetId)!;
    for (const field of ['sha256', 'byteLength', 'mediaType'] as const) {
      if (asset[field] !== expected[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Transferred Supertonic ${field} does not match the frozen asset`,
        });
      }
    }
    if (asset.bytes.byteLength !== expected.byteLength) {
      context.addIssue({
        code: 'custom',
        path: ['bytes'],
        message: 'Transferred Supertonic bytes do not match the frozen asset length',
      });
    }
  });

export const SUPERTONIC_RUNTIME_IDENTITIES = freezeTrustAnchor({
  webgpu: {
    selectionId: 'supertonic-webgpu',
    selectionDigest: 'sha256:7190a762b081736eed0573efb7cd4ba7ebbeea9ebfc3afbc0ccf546331ce380e',
    artifactId: 'onnxruntime-web-webgpu-jsep-wasm',
    sha256: 'sha256:78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48',
    byteLength: 26_827_543,
    mediaType: 'application/wasm',
  },
  wasm: {
    selectionId: 'supertonic-wasm',
    selectionDigest: 'sha256:8d6cd80556261b7d1dd56e2796b7113febee04037f97f5de298e5e7b5a35feb9',
    artifactId: 'onnxruntime-web-wasm-runtime',
    sha256: 'sha256:d1ab1b94b16a65b29d710d0b587b29e7bed336827577623913479b8afe8113e6',
    byteLength: 13_479_978,
    mediaType: 'application/wasm',
  },
} as const);

const SupertonicRuntimeArtifactIdSchema = z.enum([
  SUPERTONIC_RUNTIME_IDENTITIES.webgpu.artifactId,
  SUPERTONIC_RUNTIME_IDENTITIES.wasm.artifactId,
]);

export const SupertonicTransferredRuntimeArtifactSchema = z
  .object({
    artifactId: SupertonicRuntimeArtifactIdSchema,
    sha256: Sha256Schema,
    byteLength: z.number().int().positive().safe(),
    mediaType: z.literal('application/wasm'),
    bytes: OwnedArrayBufferSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const expected =
      artifact.artifactId === SUPERTONIC_RUNTIME_IDENTITIES.webgpu.artifactId
        ? SUPERTONIC_RUNTIME_IDENTITIES.webgpu
        : SUPERTONIC_RUNTIME_IDENTITIES.wasm;
    for (const field of ['sha256', 'byteLength', 'mediaType'] as const) {
      if (artifact[field] !== expected[field]) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Transferred runtime ${field} does not match the frozen artifact`,
        });
      }
    }
    if (artifact.bytes.byteLength !== expected.byteLength) {
      context.addIssue({
        code: 'custom',
        path: ['bytes'],
        message: 'Transferred runtime bytes do not match the frozen artifact length',
      });
    }
  });

function addWorkerVoiceBindingIssue(
  value: { engineId: string; voiceId: string },
  context: z.RefinementCtx,
): void {
  if (!value.voiceId.startsWith(`${value.engineId}:`)) {
    context.addIssue({
      code: 'custom',
      path: ['voiceId'],
      message: 'Worker voice ID must belong to the selected engine',
    });
  }
}

const PrepareWorkerCommandSchema = z
  .object({
    command: z.literal('prepare'),
    operationId: OperationIdSchema,
    engineId: z.enum(GENERIC_WORKER_ENGINE_IDS),
    voiceId: WorkerVoiceIdSchema,
  })
  .strict()
  .superRefine(addWorkerVoiceBindingIssue);

export const SupertonicPrepareWorkerCommandSchema = z
  .object({
    command: z.literal('prepare'),
    operationId: OperationIdSchema,
    engineId: z.literal('supertonic'),
    voiceId: SupertonicVoiceIdSchema,
    selectionId: z.enum([
      SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
      SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
    ]),
    selectionDigest: Sha256Schema,
    backend: BrowserRuntimeBackendSchema,
    assetSetId: z.literal(SUPERTONIC_ASSET_SET_ID),
    manifestDigest: z.literal(SUPERTONIC_MANIFEST_DIGEST),
    runtimeArtifactId: SupertonicRuntimeArtifactIdSchema,
    assets: z
      .array(SupertonicTransferredAssetSchema)
      .length(SUPERTONIC_TRANSFERRED_ASSET_IDS.length),
    runtimeArtifact: SupertonicTransferredRuntimeArtifactSchema,
  })
  .strict()
  .superRefine((command, context) => {
    const expected = SUPERTONIC_RUNTIME_IDENTITIES[command.backend];
    for (const field of ['selectionId', 'selectionDigest', 'runtimeArtifactId'] as const) {
      const expectedValue = field === 'runtimeArtifactId' ? expected.artifactId : expected[field];
      if (command[field] !== expectedValue) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Supertonic ${field} does not match the selected backend`,
        });
      }
    }
    if (command.runtimeArtifact.artifactId !== expected.artifactId) {
      context.addIssue({
        code: 'custom',
        path: ['runtimeArtifact', 'artifactId'],
        message: 'Transferred runtime artifact does not match the selected backend',
      });
    }
    for (const [index, expectedAssetId] of SUPERTONIC_TRANSFERRED_ASSET_IDS.entries()) {
      if (command.assets[index]?.assetId !== expectedAssetId) {
        context.addIssue({
          code: 'custom',
          path: ['assets', index, 'assetId'],
          message: 'Transferred Supertonic assets must use canonical asset-set order',
        });
      }
    }
    const buffers = [...command.assets.map(({ bytes }) => bytes), command.runtimeArtifact.bytes];
    if (new Set(buffers).size !== buffers.length) {
      context.addIssue({
        code: 'custom',
        path: ['assets'],
        message: 'Every transferred Supertonic buffer must have one unique owner',
      });
    }
  });

const SpeedWorkerControlsSchema = z
  .object({ speed: z.number().finite().min(0.75).max(1.25) })
  .strict();

const WORKER_CONTROL_SCHEMAS = {
  kokoro: SpeedWorkerControlsSchema,
  kitten: SpeedWorkerControlsSchema,
  piper: SpeedWorkerControlsSchema,
} as const;

function synthesizeWorkerCommandSchema<EngineId extends (typeof GENERIC_WORKER_ENGINE_IDS)[number]>(
  engineId: EngineId,
) {
  return z
    .object({
      command: z.literal('synthesize'),
      operationId: OperationIdSchema,
      engineId: z.literal(engineId),
      voiceId: WorkerVoiceIdSchema,
      text: z
        .string()
        .min(1)
        .max(2_000)
        .refine((value) => value.trim().length > 0, 'Synthesis text cannot be blank'),
      controls: WORKER_CONTROL_SCHEMAS[engineId],
    })
    .strict()
    .superRefine(addWorkerVoiceBindingIssue);
}

const SynthesizeWorkerCommandSchemas = GENERIC_WORKER_ENGINE_IDS.map((engineId) =>
  synthesizeWorkerCommandSchema(engineId),
) as [
  ReturnType<typeof synthesizeWorkerCommandSchema>,
  ReturnType<typeof synthesizeWorkerCommandSchema>,
  ReturnType<typeof synthesizeWorkerCommandSchema>,
];

const SupertonicSpeedSchema = z
  .number()
  .finite()
  .min(0.75)
  .max(1.25)
  .refine((value) => Number.isInteger(value * 20), 'Supertonic speed must use the exact 0.05 grid');

export const SupertonicSynthesizeWorkerCommandSchema = z
  .object({
    command: z.literal('synthesize'),
    operationId: OperationIdSchema,
    engineId: z.literal('supertonic'),
    voiceId: SupertonicVoiceIdSchema,
    text: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => value.trim().length > 0, 'Synthesis text cannot be blank'),
    controls: z
      .object({
        language: SupertonicLanguageSchema,
        speed: SupertonicSpeedSchema,
      })
      .strict(),
  })
  .strict();
const LifecycleWorkerCommandSchema = z
  .object({
    command: z.enum(['cancel', 'dispose']),
    operationId: OperationIdSchema,
  })
  .strict();

export const WorkerCommandSchema = z.union([
  PrepareWorkerCommandSchema,
  SupertonicPrepareWorkerCommandSchema,
  ...SynthesizeWorkerCommandSchemas,
  SupertonicSynthesizeWorkerCommandSchema,
  LifecycleWorkerCommandSchema,
]);

const ReadyWorkerResponseSchema = z
  .object({ type: z.literal('ready'), operationId: OperationIdSchema })
  .strict();
const ProgressWorkerResponseSchema = z
  .object({
    type: z.literal('progress'),
    operationId: OperationIdSchema,
    phase: z.string().trim().min(1).max(100),
    percent: z.number().finite().min(0).max(100),
  })
  .strict();
const ResultWorkerResponseSchema = z
  .object({
    type: z.literal('result'),
    operationId: OperationIdSchema,
    audio: z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, {
      message: 'Worker result audio must be an ArrayBuffer',
    }),
    mimeType: z.literal('audio/wav'),
  })
  .strict();
const ErrorWorkerResponseSchema = z
  .object({
    type: z.literal('error'),
    operationId: OperationIdSchema,
    message: z.string().trim().min(1).max(1_000),
  })
  .strict();
const CancelledWorkerResponseSchema = z
  .object({ type: z.literal('cancelled'), operationId: OperationIdSchema })
  .strict();
const DisposedWorkerResponseSchema = z
  .object({ type: z.literal('disposed'), operationId: OperationIdSchema })
  .strict();

export const WorkerResponseSchema = z.discriminatedUnion('type', [
  ReadyWorkerResponseSchema,
  ProgressWorkerResponseSchema,
  ResultWorkerResponseSchema,
  ErrorWorkerResponseSchema,
  CancelledWorkerResponseSchema,
  DisposedWorkerResponseSchema,
]);

const ProvenanceParametersSchema = z.record(z.string(), ScalarControlSchema);
const DependencyRevisionsSchema = z.record(z.string().trim().min(1), GitRevisionSchema);
const UnresolvedDependenciesSchema = z
  .array(z.string().trim().min(1))
  .refine(hasUniqueValues, 'Unresolved dependencies must be unique');

const ApprovedHumanReviewSchema = z
  .object({
    status: z.literal('approved'),
    reviewedAt: IsoDateTimeSchema,
    reviewer: z.string().trim().min(1),
  })
  .strict();

const PendingReferenceLineageSchema = z
  .object({
    status: z.literal('pending'),
    generatorCandidateId: RecordIdSchema,
    promptText: StoredNonBlankTextSchema,
    audioSha256: z.null(),
    transcriptSha256: z.null(),
    rightsBasis: z.string().trim().min(1),
    humanReview: z.null(),
  })
  .strict();

const VerifiedReferenceLineageSchema = z
  .object({
    status: z.literal('verified'),
    generatorCandidateId: RecordIdSchema,
    promptText: StoredNonBlankTextSchema,
    audioSha256: Sha256Schema,
    transcriptSha256: Sha256Schema,
    rightsBasis: z.string().trim().min(1),
    humanReview: ApprovedHumanReviewSchema,
  })
  .strict();

export const ReferenceLineageSchema = z.discriminatedUnion('status', [
  PendingReferenceLineageSchema,
  VerifiedReferenceLineageSchema,
]);

const PendingRuntimeEnvironmentSchema = z
  .object({
    status: z.literal('pending'),
    requirements: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine(hasUniqueValues, 'Runtime-environment requirements must be unique'),
  })
  .strict();

const ExactPackageVersionSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => !/\b(?:latest|main|master|head)\b/i.test(value) && !/[\^~*]/.test(value),
    'Package versions must be exact rather than floating ranges',
  );

export const VerifiedRuntimeEnvironmentSchema = z
  .object({
    status: z.literal('verified'),
    pythonVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    packageVersions: z
      .record(z.string().trim().min(1), ExactPackageVersionSchema)
      .refine((value) => Object.keys(value).length > 0, 'At least one package version is required'),
    operatingSystem: z.string().trim().min(1),
    device: z.string().trim().min(1),
    dtype: z.string().trim().min(1),
    accelerator: z.string().trim().min(1).nullable(),
    dependencyLockSha256: Sha256Schema,
    runnerImageDigest: Sha256Schema.nullable(),
  })
  .strict();

export const RuntimeEnvironmentSchema = z.discriminatedUnion('status', [
  PendingRuntimeEnvironmentSchema,
  VerifiedRuntimeEnvironmentSchema,
]);

export const OfficialSampleSchema = z
  .object({
    id: RecordIdSchema,
    galleryId: RecordIdSchema,
    transcript: StoredNonBlankTextSchema,
    locale: Bcp47LanguageTagSchema,
    officialSamplePageUrl: HttpUrlSchema,
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
    redistributionStatus: z.enum(['redistribution-cleared', 'link-only', 'blocked']),
    corsStatus: z.enum(['verified-readable', 'blocked', 'not-tested']),
    audioUrl: ImmutableHttpsUrlSchema.nullable(),
    audioSha256: Sha256Schema.nullable(),
    audioBytes: z.number().int().positive().nullable(),
    rightsBasis: z.string().trim().min(1),
    humanReview: ApprovedHumanReviewSchema,
  })
  .strict()
  .superRefine((sample, context) => {
    const hasCompleteAudio =
      sample.audioUrl !== null && sample.audioSha256 !== null && sample.audioBytes !== null;
    if (
      sample.redistributionStatus === 'redistribution-cleared' &&
      (!hasCompleteAudio || sample.corsStatus !== 'verified-readable')
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Redistributable samples require an immutable URL, digest, byte size, and verified CORS access',
      });
    }
    if (sample.redistributionStatus !== 'redistribution-cleared' && hasCompleteAudio) {
      context.addIssue({
        code: 'custom',
        message: 'Link-only or blocked samples cannot expose an audio asset',
      });
    }
    if (
      sample.redistributionStatus !== 'redistribution-cleared' &&
      (sample.audioUrl !== null || sample.audioSha256 !== null || sample.audioBytes !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Partial audio provenance is not publishable',
      });
    }
  });

export const GalleryManifestSchema = z
  .object({
    id: RecordIdSchema,
    displayName: z.string().trim().min(1),
    mode: z.enum(['generation-candidate', 'source-only']),
    officialProjectUrl: HttpUrlSchema,
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
    candidateId: RecordIdSchema.nullable(),
    sampleIds: z.array(RecordIdSchema).refine(hasUniqueValues, 'Sample IDs must be unique'),
    generatedMediaIds: z.array(RecordIdSchema).refine(hasUniqueValues, 'Media IDs must be unique'),
    notice: z.string().trim().min(1),
  })
  .strict()
  .superRefine((gallery, context) => {
    if (
      gallery.mode === 'source-only' &&
      (gallery.candidateId !== null || gallery.generatedMediaIds.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source-only galleries cannot expose a candidate or generated media',
      });
    }
    if (gallery.mode === 'generation-candidate' && gallery.candidateId === null) {
      context.addIssue({
        code: 'custom',
        path: ['candidateId'],
        message: 'Generation galleries require a candidate',
      });
    }
  });

export const GenerationCandidateSchema = z
  .object({
    id: RecordIdSchema,
    galleryId: RecordIdSchema,
    transcript: StoredNonBlankTextSchema,
    locale: Bcp47LanguageTagSchema,
    modelRevision: GitRevisionSchema,
    codeRevision: GitRevisionSchema,
    parameters: ProvenanceParametersSchema,
    seed: z.number().int(),
    loadingStrategy: z.literal('pinned-local-snapshot'),
    dependencyRevisions: DependencyRevisionsSchema,
    unresolvedDependencies: UnresolvedDependenciesSchema,
    readiness: z.enum([
      'ready-for-generation',
      'recipe-ready-runtime-pending',
      'blocked-pending-reference',
      'blocked-pending-checkpoint-verification',
      'blocked-pending-dependency-pin',
    ]),
    readinessDetail: z.string().trim().min(1),
    runtimeEnvironment: RuntimeEnvironmentSchema,
    sourceIds: RecordIdsSchema,
    licenseIds: RecordIdsSchema,
    referenceLineage: ReferenceLineageSchema.nullable(),
    watermarkRequirement: z.enum(['none', 'preserve-perth']),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      candidate.readiness === 'blocked-pending-reference' &&
      candidate.referenceLineage?.status !== 'pending'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['referenceLineage'],
        message: 'Reference-blocked candidates require explicit pending reference lineage',
      });
    }
    if (
      candidate.readiness === 'ready-for-generation' &&
      (candidate.referenceLineage?.status === 'pending' ||
        candidate.runtimeEnvironment.status !== 'verified')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readiness'],
        message: 'Generation-ready candidates require verified reference and runtime lineage',
      });
    }
    if (
      candidate.readiness === 'ready-for-generation' &&
      candidate.unresolvedDependencies.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedDependencies'],
        message: 'Ready candidates cannot have unpinned dependencies',
      });
    }
    if (
      candidate.readiness === 'recipe-ready-runtime-pending' &&
      (candidate.runtimeEnvironment.status !== 'pending' ||
        candidate.referenceLineage?.status === 'pending' ||
        candidate.unresolvedDependencies.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['readiness'],
        message:
          'Recipe-ready candidates must have only the explicitly pending runtime environment',
      });
    }
    if (
      candidate.readiness === 'blocked-pending-dependency-pin' &&
      candidate.unresolvedDependencies.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['unresolvedDependencies'],
        message: 'Dependency-blocked candidates must name each unresolved dependency',
      });
    }
  });

export const GeneratedMediaProvenanceSchema = z
  .object({
    id: RecordIdSchema,
    candidateId: RecordIdSchema,
    audioUrl: ImmutableHttpsUrlSchema,
    audioSha256: Sha256Schema,
    audioBytes: z.number().int().positive(),
    transcriptSha256: Sha256Schema,
    generatedAt: IsoDateTimeSchema,
    generatorSourceId: RecordIdSchema,
    modelRevision: GitRevisionSchema,
    codeRevision: GitRevisionSchema,
    parameters: ProvenanceParametersSchema,
    seed: z.number().int(),
    loadingStrategy: z.literal('pinned-local-snapshot'),
    dependencyRevisions: DependencyRevisionsSchema,
    runtimeEnvironment: VerifiedRuntimeEnvironmentSchema,
    referenceLineage: VerifiedReferenceLineageSchema.nullable(),
    watermark: z.enum(['none', 'perth-preserved']),
    rightsBasis: z.string().trim().min(1),
    humanReview: ApprovedHumanReviewSchema,
    licenseIds: RecordIdsSchema,
    sourceIds: RecordIdsSchema,
  })
  .strict();

export const LAUNCH_BACKENDS = [
  'webgpu-wasm',
  'wasm',
  'companion',
  'external-service',
  'none',
] as const;
export const LaunchBackendSchema = z.enum(LAUNCH_BACKENDS);

export const LaunchEngineManifestSchema = EngineManifestSchema.safeExtend({
  backend: LaunchBackendSchema,
  releaseGate: ReleaseGateSchema,
  assetSetIds: z.array(RecordIdSchema).refine(hasUniqueValues, 'Asset-set IDs must be unique'),
});

export const LaunchVoicePresetSchema = VoicePresetSchema.safeExtend({
  backend: LaunchBackendSchema,
  releaseGate: ReleaseGateSchema,
  assetSetId: RecordIdSchema.nullable(),
  declaredDownloadBytes: z.number().int().nonnegative(),
  consentRequired: z.boolean(),
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
export type PocketPresetVariant = z.infer<typeof PocketPresetVariantSchema>;
export type PocketOfficialLiveDemo = z.infer<typeof PocketOfficialLiveDemoSchema>;
export type PocketCoverageManifest = z.infer<typeof PocketCoverageManifestSchema>;
export type SampleManifest = z.infer<typeof SampleManifestSchema>;
export type LicenseRecord = z.infer<typeof LicenseRecordSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type ReleaseGate = z.infer<typeof ReleaseGateSchema>;
export type BrowserRuntimeBackend = z.infer<typeof BrowserRuntimeBackendSchema>;
export type BrowserRuntimeArtifact = z.infer<typeof BrowserRuntimeArtifactSchema>;
export type BrowserRuntimeSelection = z.infer<typeof BrowserRuntimeSelectionSchema>;
export type ImmutableAsset = z.infer<typeof ImmutableAssetSchema>;
export type PinnedReleaseAssetEvidence = z.infer<typeof PinnedReleaseAssetEvidenceSchema>;
export type AssetDeliveryEvidence = z.infer<typeof AssetDeliveryEvidenceSchema>;
export type AssetSetManifest = z.infer<typeof AssetSetManifestSchema>;
export type BrowserRuntimeS0Evidence = z.infer<typeof BrowserRuntimeS0EvidenceStructureSchema>;
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
export type SupertonicVoiceId = (typeof SUPERTONIC_VOICE_IDS)[number];
export type SupertonicLanguage = (typeof SUPERTONIC_LANGUAGES)[number];
export type SupertonicTransferredAsset = z.infer<typeof SupertonicTransferredAssetSchema>;
export type SupertonicTransferredRuntimeArtifact = z.infer<
  typeof SupertonicTransferredRuntimeArtifactSchema
>;
export type SupertonicPrepareWorkerCommand = z.infer<typeof SupertonicPrepareWorkerCommandSchema>;
export type SupertonicSynthesizeWorkerCommand = z.infer<
  typeof SupertonicSynthesizeWorkerCommandSchema
>;
export type WorkerCommand = z.infer<typeof WorkerCommandSchema>;
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;
export type GalleryManifest = z.infer<typeof GalleryManifestSchema>;
export type OfficialSample = z.infer<typeof OfficialSampleSchema>;
export type GenerationCandidate = z.infer<typeof GenerationCandidateSchema>;
export type GeneratedMediaProvenance = z.infer<typeof GeneratedMediaProvenanceSchema>;
export type RuntimeEnvironment = z.infer<typeof RuntimeEnvironmentSchema>;
export type VerifiedRuntimeEnvironment = z.infer<typeof VerifiedRuntimeEnvironmentSchema>;
export type LaunchBackend = z.infer<typeof LaunchBackendSchema>;
export type LaunchEngineManifest = z.infer<typeof LaunchEngineManifestSchema>;
export type LaunchVoicePreset = z.infer<typeof LaunchVoicePresetSchema>;
