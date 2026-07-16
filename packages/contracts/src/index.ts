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
    url: ImmutableHttpsUrlSchema,
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

const BrowserRuntimeS0CacheHitEvidenceSchema = BrowserRuntimeS0AssetEvidenceBase.extend({
  disposition: z.literal('cache-hit'),
  requestUrl: z.null(),
  finalUrl: z.null(),
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
  requestUrl: SafeHttpsUrlSchema,
  finalUrl: SafeHttpsUrlSchema,
  finalOrigin: ExactHttpsOriginSchema,
  responseType: z.literal('cors'),
  status: z.literal(200),
})
  .strict()
  .superRefine((asset, context) => {
    if (
      asset.expectedBytes !== asset.observedBytes ||
      asset.expectedSha256 !== asset.observedSha256 ||
      new URL(asset.finalUrl).origin !== asset.finalOrigin
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Downloaded evidence must preserve exact identity and final URL origin',
      });
    }
  });

export const BrowserRuntimeS0EvidenceStructureSchema = z
  .object({
    schemaVersion: z.literal(1),
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
const WORKER_ENGINE_IDS = ['kokoro', 'kitten', 'supertonic', 'piper'] as const;
const WorkerEngineIdSchema = z.enum(WORKER_ENGINE_IDS);
const WorkerVoiceIdSchema = StableIdSchema;

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
    engineId: WorkerEngineIdSchema,
    voiceId: WorkerVoiceIdSchema,
  })
  .strict()
  .superRefine(addWorkerVoiceBindingIssue);

const SpeedWorkerControlsSchema = z
  .object({ speed: z.number().finite().min(0.75).max(1.25) })
  .strict();

const WORKER_CONTROL_SCHEMAS = {
  kokoro: SpeedWorkerControlsSchema,
  kitten: SpeedWorkerControlsSchema,
  supertonic: SpeedWorkerControlsSchema,
  piper: SpeedWorkerControlsSchema,
} as const;

function synthesizeWorkerCommandSchema<EngineId extends (typeof WORKER_ENGINE_IDS)[number]>(
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

const SynthesizeWorkerCommandSchemas = WORKER_ENGINE_IDS.map((engineId) =>
  synthesizeWorkerCommandSchema(engineId),
) as [
  ReturnType<typeof synthesizeWorkerCommandSchema>,
  ReturnType<typeof synthesizeWorkerCommandSchema>,
  ReturnType<typeof synthesizeWorkerCommandSchema>,
  ReturnType<typeof synthesizeWorkerCommandSchema>,
];
const LifecycleWorkerCommandSchema = z
  .object({
    command: z.enum(['cancel', 'dispose']),
    operationId: OperationIdSchema,
  })
  .strict();

export const WorkerCommandSchema = z.union([
  PrepareWorkerCommandSchema,
  ...SynthesizeWorkerCommandSchemas,
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

export const WorkerResponseSchema = z.discriminatedUnion('type', [
  ReadyWorkerResponseSchema,
  ProgressWorkerResponseSchema,
  ResultWorkerResponseSchema,
  ErrorWorkerResponseSchema,
  CancelledWorkerResponseSchema,
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
