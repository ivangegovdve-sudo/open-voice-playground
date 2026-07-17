import { z } from 'zod';

import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
  SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES,
} from './index.js';

function freezeQualificationAnchor<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeQualificationAnchor(nested);
  Object.freeze(value);
  return value;
}

export const SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER = freezeQualificationAnchor([
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
] as const);

const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_BINDINGS = freezeQualificationAnchor({
  ar: {
    promptTextSha256: 'sha256:6e933e58d54a4fffaf730b06d75989f88594bc8f65db2389077b8f20e9d81941',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 9,
    minimumSampleFrames: 66_150,
    maximumSampleFrames: 617_400,
  },
  bg: {
    promptTextSha256: 'sha256:b5d6fe22082554dab7a3560bfca42b8f94374ffdcb201d910e99c04fd3e39aeb',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 11,
    minimumSampleFrames: 80_850,
    maximumSampleFrames: 735_000,
  },
  cs: {
    promptTextSha256: 'sha256:690776e2dbfdebd85e8ca85f818bb4d488deb52eed9e85022b1a8d9b0fb2833c',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  da: {
    promptTextSha256: 'sha256:5bfd5655dbd9285a30bf3a08ebe1c202c4482283d7254799f742f8c6106b61f6',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 11,
    minimumSampleFrames: 80_850,
    maximumSampleFrames: 735_000,
  },
  de: {
    promptTextSha256: 'sha256:89bea6b6e0f2f8214f5642eecc5920b9d90e36f9e8641361f7317971bd856c2d',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 12,
    minimumSampleFrames: 88_200,
    maximumSampleFrames: 793_800,
  },
  el: {
    promptTextSha256: 'sha256:9c342788a294b2f58e798f35418354beccdd446526c0e1ec521657033d72f5c3',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 13,
    minimumSampleFrames: 95_550,
    maximumSampleFrames: 852_600,
  },
  en: {
    promptTextSha256: 'sha256:3132aa0d6bcfcb3573e7ab433dca334c929db851bafd14ad84723fa80236c290',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 12,
    minimumSampleFrames: 88_200,
    maximumSampleFrames: 793_800,
  },
  es: {
    promptTextSha256: 'sha256:8a86e30b6424ded391c1c2e7ee06d8d5e22a35e36eb892a48471ecbb515585a0',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 16,
    minimumSampleFrames: 117_600,
    maximumSampleFrames: 1_029_000,
  },
  et: {
    promptTextSha256: 'sha256:79dfc0b2a262ebb26c8df5732bfca7092970dd2651ce21df3077a4e48b8de63a',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 9,
    minimumSampleFrames: 66_150,
    maximumSampleFrames: 617_400,
  },
  fi: {
    promptTextSha256: 'sha256:2d7f4ee6848677b8ea5d57e29e099a8cbd9143a5d9023ab66939ac87a81d8bce',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 9,
    minimumSampleFrames: 66_150,
    maximumSampleFrames: 617_400,
  },
  fr: {
    promptTextSha256: 'sha256:f6650ca5d70d3a9995f2a0f343a4fc81d5f96361133d5d1b134ab16f05326a59',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 15,
    minimumSampleFrames: 110_250,
    maximumSampleFrames: 970_200,
  },
  hi: {
    promptTextSha256: 'sha256:ab7a2fd4500a7a3766236542b228dc1268e0e48e5857733c10b71e1fea451def',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 16,
    minimumSampleFrames: 117_600,
    maximumSampleFrames: 1_029_000,
  },
  hr: {
    promptTextSha256: 'sha256:28a3e652c297ec3e5332661b323ea7eddda0fc862c18acc4c0e339265a6a188f',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  hu: {
    promptTextSha256: 'sha256:388a5aa0c3c2ae30297b037e496f69eb0880103f7235b88205e93293b61c17dc',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 12,
    minimumSampleFrames: 88_200,
    maximumSampleFrames: 793_800,
  },
  id: {
    promptTextSha256: 'sha256:69c5c7f74bb1786da38f806746a58dd155ddac5cfcc74875f763fe35453ecb83',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 11,
    minimumSampleFrames: 80_850,
    maximumSampleFrames: 735_000,
  },
  it: {
    promptTextSha256: 'sha256:f0606a41fbec010c49466fbd16243f322524567c300834d7d8c92561251a35c1',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 14,
    minimumSampleFrames: 102_900,
    maximumSampleFrames: 911_400,
  },
  ja: {
    promptTextSha256: 'sha256:0cbd8b3e5e8922d5aef4a99f369b3871f439cb38dabbc1c1beaf513312184119',
    speechUnitMethod: 'manual-japanese-lexical-v1',
    reviewedSpeechUnitCount: 14,
    minimumSampleFrames: 102_900,
    maximumSampleFrames: 911_400,
  },
  ko: {
    promptTextSha256: 'sha256:e4ec25b97b6bcd4a98a52416d7628e85cf17ee3be0f092dba5ffee7f26d6673a',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 9,
    minimumSampleFrames: 66_150,
    maximumSampleFrames: 617_400,
  },
  lt: {
    promptTextSha256: 'sha256:10c5c6b1c05a430086deef502c73e4c6249ea49ef28dc0235a26238c1d16957b',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  lv: {
    promptTextSha256: 'sha256:b74481d793b40ae0fb03d6073a3c4344735faeeb0e0871b2f41be9540dc836b8',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  nl: {
    promptTextSha256: 'sha256:ab66cd15b95a930254edf370221c7e645479bdbc905465d4540d4f6c77f6edf1',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 12,
    minimumSampleFrames: 88_200,
    maximumSampleFrames: 793_800,
  },
  pl: {
    promptTextSha256: 'sha256:7b9bb80133d901c3cee4634dbc922b7e01df38970c04e23f1f7f169d67d83263',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  pt: {
    promptTextSha256: 'sha256:7d7f5316ed236c0b06e140bb872d2b407531fac72639c19d5b5edcf48c035a38',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 14,
    minimumSampleFrames: 102_900,
    maximumSampleFrames: 911_400,
  },
  ro: {
    promptTextSha256: 'sha256:0840248134ad9a10dcd3fca950e290c82219d303f7e1e6b0148cff208379eacb',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 11,
    minimumSampleFrames: 80_850,
    maximumSampleFrames: 735_000,
  },
  ru: {
    promptTextSha256: 'sha256:3773918620c00458684b1cb3a6c13dfaa9c41f656572de361d6f81a464c8273a',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  sk: {
    promptTextSha256: 'sha256:5ab6401efbeb0e9be964fd0de43b6d83064b585aed10059ede07271725f9887f',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  sl: {
    promptTextSha256: 'sha256:576b4c7609f4a73952e670a1363c3944b4acc20ee2065f40d26d4316f033f41c',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  sv: {
    promptTextSha256: 'sha256:d45c556a6a4403819003f5bcfdc896ca4e873ad39c863ff19b2c0de909432362',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  tr: {
    promptTextSha256: 'sha256:7fa34b82eff48ba4eaeec9cf6dd5d5d28f7233df7c2180683c060d024ccda278',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 11,
    minimumSampleFrames: 80_850,
    maximumSampleFrames: 735_000,
  },
  uk: {
    promptTextSha256: 'sha256:715916ff409a39b539afb0da85e0aa3f19f7ded0356d6da4e1ea4bdcc65964bb',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 10,
    minimumSampleFrames: 73_500,
    maximumSampleFrames: 676_200,
  },
  vi: {
    promptTextSha256: 'sha256:505d659d746d4cdae0d9f0b522c3a466e58fdd9d0322a78c1209f3d3364e6893',
    speechUnitMethod: 'unicode-whitespace-token-count-v1',
    reviewedSpeechUnitCount: 20,
    minimumSampleFrames: 147_000,
    maximumSampleFrames: 1_264_200,
  },
} as const);

const additionalQualificationRuns = [
  ['supertonic:F1', 'en'],
  ['supertonic:F1', 'ja'],
  ['supertonic:F1', 'ar'],
  ['supertonic:F2', 'en'],
  ['supertonic:F3', 'en'],
  ['supertonic:F4', 'en'],
  ['supertonic:F5', 'en'],
  ['supertonic:M2', 'en'],
  ['supertonic:M3', 'en'],
  ['supertonic:M4', 'en'],
  ['supertonic:M5', 'en'],
] as const;

export const SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN = freezeQualificationAnchor(
  [
    ...SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER.map(
      (language) => ['supertonic:M1', language] as const,
    ),
    ...additionalQualificationRuns,
  ].map(([voiceId, language], index) => {
    const rowId = `supertonic-q${String(index + 1).padStart(2, '0')}-${voiceId.slice('supertonic:'.length).toLowerCase()}-${language}`;
    return {
      ordinal: index + 1,
      runId: rowId,
      voiceId,
      language,
      promptRowId: rowId,
      ...SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_BINDINGS[language],
    };
  }),
);

export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID =
  'pset:f80986ed67b59f520dc958cfb6730935' as const;
export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256 =
  'sha256:1c94e0a39e61e5e13316a56a6c2cf9fdecd46225a30f8b65b5cb852c07e6d284' as const;
export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES = 24_581 as const;

export const SUPERTONIC_BROWSER_QUALIFICATION_FAILURE_CASE_IDS = freezeQualificationAnchor([
  'cold-online',
  'warm-online',
  'warm-offline-hard-reload',
  'cold-offline',
  'corrupt-model-entry',
  'corrupt-runtime-wasm',
  'quota-minus-one',
  'cancel-download',
  'cancel-hash-store',
  'cancel-import-session',
  'cancel-synthesis',
  'restart-warm-offline',
  'webgpu-device-loss',
] as const);

export const SUPERTONIC_BROWSER_QUALIFICATION_LIFECYCLE_PLAN = freezeQualificationAnchor([
  'completed',
  'cancelled',
  'completed',
  'cancelled',
  'completed',
] as const);

export const SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2 = freezeQualificationAnchor({
  policyId: 'supertonic-browser-qualification-v2',
  wasmSmokeTimeoutMs: 180_000,
  synthesisTimeoutMs: 120_000,
  cancellationSettleTimeoutMs: 10_000,
  disposeAckTimeoutMs: 10_000,
  wavEvidence: {
    policyId: 'supertonic-pcm16-44100-evidence-v1',
    headerBytes: 44,
    audioFormat: 1,
    channelCount: 1,
    sampleRateHz: 44_100,
    byteRate: 88_200,
    blockAlignBytes: 2,
    bitsPerSample: 16,
    minimumSampleFrames: 15_435,
    maximumSampleFrames: 7_938_000,
    minimumNonZeroPpm: 10_000,
    minimumPeakPcm16: 328,
    minimumRmsSquarePcm16: 1_089,
    clippedAbsoluteFloorPcm16: 32_735,
    maximumClippedPpm: 50_000,
    maximumAbsoluteDcOffsetPcm16: 1_638,
  },
  maxSettledMemoryGrowthBytes: 256 * 1024 * 1024,
  initialJsGzipLimitBytes: 250 * 1024,
} as const);

const MODEL_REVISION = '3cadd1ee6394adea1bd021217a0e650ede09a323';
const REQUIRED_LICENSE_ID = 'supertone-weights-license';
const REQUIRED_TERMS_SHA256 =
  'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f';
const MODEL_PATHS = [
  'onnx/duration_predictor.onnx',
  'onnx/text_encoder.onnx',
  'onnx/tts.json',
  'onnx/unicode_indexer.json',
  'onnx/vector_estimator.onnx',
  'onnx/vocoder.onnx',
  'voice_styles/F1.json',
  'voice_styles/F2.json',
  'voice_styles/F3.json',
  'voice_styles/F4.json',
  'voice_styles/F5.json',
  'voice_styles/M1.json',
  'voice_styles/M2.json',
  'voice_styles/M3.json',
  'voice_styles/M4.json',
  'voice_styles/M5.json',
] as const;
const MODEL_BYTES = SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.reduce(
  (total, identity) => total + identity.byteLength,
  0,
);
const LARGEST_MODEL_ASSET_BYTES = Math.max(
  ...SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.map((identity) => identity.byteLength),
);

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const GitObjectIdSchema = z.string().regex(/^[a-f0-9]{40}$/);
const EvidenceIdSchema = z.string().regex(/^stq2-[a-f0-9]{32}$/);
const SafeIntegerSchema = z.number().int().safe().nonnegative();
const PositiveSafeIntegerSchema = z.number().int().safe().positive();
const SignedSafeIntegerSchema = z.number().int().safe();
const BoundedTextSchema = z.string().trim().min(1).max(500);
const ReviewerIdSchema = z.string().regex(/^(?:operator|reviewer)-[a-z0-9][a-z0-9-]{1,62}$/);
const PromptSetIdSchema = z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID);
const StrictIsoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => new Date(value).toISOString() === value, 'Expected a canonical UTC timestamp');
const ExactHttpsOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.pathname === '/' &&
        url.search === '' &&
        url.hash === '' &&
        value === url.origin
      );
    } catch {
      return false;
    }
  }, 'Expected an exact HTTPS origin');
const ImmutableHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }, 'Expected an immutable HTTPS URL without credentials, query, or fragment');
const CanonicalModelRequestUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.origin === 'https://huggingface.co' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '?download=true' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  }, 'Expected the canonical immutable Hugging Face request URL');
const RedactedFinalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return value === `${url.origin}/<redacted>`;
    } catch {
      return false;
    }
  }, 'Expected an HTTPS origin followed by /<redacted>');
const RepoPathSchema = z
  .string()
  .regex(/^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._/-]+$/)
  .refine(
    (value) => /[a-f0-9]{64}\.[a-z0-9]+$/.test(value),
    'Artifact path must be content-addressed',
  );

const ContentArtifactSchema = z
  .object({
    path: RepoPathSchema,
    sha256: Sha256Schema,
    bytes: PositiveSafeIntegerSchema,
    mediaType: z.enum(['application/json', 'image/png', 'text/plain']),
  })
  .strict();

const FailureSchema = z
  .object({
    failureId: z.string().regex(/^failure-[0-9]{3}$/),
    gateId: z.enum([
      'build',
      'security',
      'environment',
      'consent',
      'pre-consent',
      'closure',
      'storage',
      'wasm-smoke',
      'runs',
      'failures',
      'lifecycle',
      'ui',
      'human-review',
    ]),
    reasonCode: z.enum([
      'build-gate-failed',
      'security-gate-failed',
      'environment-gate-failed',
      'consent-gate-failed',
      'preconsent-inference-io',
      'closure-gate-failed',
      'storage-gate-failed',
      'wasm-smoke-failed',
      'positive-run-failed',
      'negative-case-failed',
      'lifecycle-gate-failed',
      'ui-gate-failed',
      'independent-review-rejected',
    ]),
    observedAt: StrictIsoDateTimeSchema,
    traceSequence: SafeIntegerSchema,
    messageSha256: Sha256Schema,
  })
  .strict();

const EvidenceReferenceSchema = z
  .object({
    evidenceId: EvidenceIdSchema,
    path: RepoPathSchema,
    sha256: Sha256Schema,
    bytes: PositiveSafeIntegerSchema,
    tupleId: z.enum(['chrome-webgpu', 'chrome-wasm', 'edge-webgpu', 'edge-wasm']),
    decision: z.literal('passed'),
  })
  .strict();

const QualificationPolicySchema = z
  .object({
    policyId: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.policyId),
    policySha256: Sha256Schema,
    wasmSmokeTimeoutMs: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wasmSmokeTimeoutMs),
    synthesisTimeoutMs: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.synthesisTimeoutMs),
    cancellationSettleTimeoutMs: z.literal(
      SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.cancellationSettleTimeoutMs,
    ),
    disposeAckTimeoutMs: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.disposeAckTimeoutMs),
    wavEvidence: z
      .object({
        policyId: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.policyId),
        headerBytes: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.headerBytes),
        audioFormat: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.audioFormat),
        channelCount: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.channelCount,
        ),
        sampleRateHz: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.sampleRateHz,
        ),
        byteRate: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.byteRate),
        blockAlignBytes: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.blockAlignBytes,
        ),
        bitsPerSample: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.bitsPerSample,
        ),
        minimumSampleFrames: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.minimumSampleFrames,
        ),
        maximumSampleFrames: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.maximumSampleFrames,
        ),
        minimumNonZeroPpm: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.minimumNonZeroPpm,
        ),
        minimumPeakPcm16: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.minimumPeakPcm16,
        ),
        minimumRmsSquarePcm16: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.minimumRmsSquarePcm16,
        ),
        clippedAbsoluteFloorPcm16: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.clippedAbsoluteFloorPcm16,
        ),
        maximumClippedPpm: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.maximumClippedPpm,
        ),
        maximumAbsoluteDcOffsetPcm16: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.maximumAbsoluteDcOffsetPcm16,
        ),
      })
      .strict(),
    maxSettledMemoryGrowthBytes: z.literal(
      SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.maxSettledMemoryGrowthBytes,
    ),
    initialJsGzipLimitBytes: z.literal(
      SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.initialJsGzipLimitBytes,
    ),
  })
  .strict();

const CandidateSchema = z
  .object({
    qualificationPhase: z.enum(['pre-enable-disabled', 'post-enable-enabled']),
    operatorId: ReviewerIdSchema,
    gitCommit: GitObjectIdSchema,
    gitTree: GitObjectIdSchema,
    dirty: z.literal(false),
    buildDigest: Sha256Schema,
    catalogSha256: Sha256Schema,
    deployment: z
      .object({
        provider: z.literal('vercel'),
        deploymentId: z.string().regex(/^dpl_[A-Za-z0-9_-]{8,100}$/),
        immutableUrl: ExactHttpsOriginSchema,
        deployedAt: StrictIsoDateTimeSchema,
        httpStatus: z.literal(200),
      })
      .strict(),
    promptSetId: PromptSetIdSchema,
    promptSetManifestSha256: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256),
    promptSetBytes: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES),
    preEnableEvidence: EvidenceReferenceSchema.nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (
      (candidate.qualificationPhase === 'pre-enable-disabled') !==
      (candidate.preEnableEvidence === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preEnableEvidence'],
        message: 'Only a final enabled candidate must bind one passed pre-enable evidence record',
      });
    }
  });

const TestedOsSchema = z
  .object({
    family: z.enum(['windows', 'macos', 'linux']),
    version: BoundedTextSchema,
    build: BoundedTextSchema,
    architecture: z.enum(['x86_64', 'arm64']),
  })
  .strict();

const TestedTupleSchema = z
  .object({
    tupleId: z.enum(['chrome-webgpu', 'chrome-wasm', 'edge-webgpu', 'edge-wasm']),
    engineId: z.literal('supertonic'),
    browserFamily: z.enum(['chrome', 'edge']),
    browserBrand: z.enum(['Google Chrome', 'Microsoft Edge']),
    browserChannel: z.literal('stable'),
    browserVersion: z.string().regex(/^\d+\.\d+\.\d+\.\d+$/),
    browserMajor: z.number().int().safe().positive(),
    backend: z.enum(['webgpu', 'wasm']),
    selectionId: z.enum([
      SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
      SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
    ]),
    selectionDigest: Sha256Schema,
    runtimeArtifactId: z.enum([
      SUPERTONIC_RUNTIME_IDENTITIES.webgpu.artifactId,
      SUPERTONIC_RUNTIME_IDENTITIES.wasm.artifactId,
    ]),
    runtimeSha256: Sha256Schema,
    runtimeBytes: PositiveSafeIntegerSchema,
    assetSetId: z.literal(SUPERTONIC_ASSET_SET_ID),
    manifestDigest: z.literal(SUPERTONIC_MANIFEST_DIGEST),
    os: TestedOsSchema,
  })
  .strict()
  .superRefine((tuple, context) => {
    const expectedTupleId = `${tuple.browserFamily}-${tuple.backend}`;
    const expectedBrand = tuple.browserFamily === 'chrome' ? 'Google Chrome' : 'Microsoft Edge';
    const runtime = SUPERTONIC_RUNTIME_IDENTITIES[tuple.backend];
    const expectedMajor = Number(tuple.browserVersion.split('.')[0]);
    const mismatches: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ['tupleId', tuple.tupleId, expectedTupleId],
      ['browserBrand', tuple.browserBrand, expectedBrand],
      ['browserMajor', tuple.browserMajor, expectedMajor],
      ['selectionId', tuple.selectionId, runtime.selectionId],
      ['selectionDigest', tuple.selectionDigest, runtime.selectionDigest],
      ['runtimeArtifactId', tuple.runtimeArtifactId, runtime.artifactId],
      ['runtimeSha256', tuple.runtimeSha256, runtime.sha256],
      ['runtimeBytes', tuple.runtimeBytes, runtime.byteLength],
    ];
    for (const [field, observed, expected] of mismatches) {
      if (observed !== expected) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Tested tuple ${field} does not match the exact branded backend identity`,
        });
      }
    }
  });

const BrowserFlagsSchema = z
  .object({
    forcedGc: z.boolean(),
    unsafeWebgpu: z.boolean(),
    ignoreGpuBlocklist: z.boolean(),
    otherNonDefaultCount: SafeIntegerSchema,
  })
  .strict();

const RuntimeConfigurationSchema = z
  .object({
    packageName: z.literal('onnxruntime-web'),
    packageVersion: z.literal('1.27.0'),
    numThreads: z.number().int().safe(),
    proxy: z.boolean(),
    wasmBinaryTransferred: z.boolean(),
    requestedExecutionProvider: z.enum(['webgpu', 'wasm']),
    observedExecutionProvider: z.enum(['webgpu', 'wasm']),
    selectedBackendImportCount: SafeIntegerSchema,
    unselectedBackendImportCount: SafeIntegerSchema,
    fallbackAttemptCount: SafeIntegerSchema,
  })
  .strict();

const WasmWebGpuEnvironmentSchema = z
  .object({
    status: z.literal('not-requested'),
    reasonCode: z.literal('wasm-backend'),
  })
  .strict();

const PassedWebGpuEnvironmentSchema = z
  .object({
    status: z.literal('passed'),
    adapterVendor: BoundedTextSchema,
    adapterArchitecture: BoundedTextSchema,
    adapterDevice: BoundedTextSchema,
    adapterDescription: BoundedTextSchema,
    requiredFeatures: z.tuple([]),
    deviceLimitsSha256: Sha256Schema,
    deviceLostBeforeTestCount: z.literal(0),
  })
  .strict();

const EnvironmentSchema = z
  .object({
    status: z.literal('passed'),
    capturedAt: StrictIsoDateTimeSchema,
    pageOrigin: ExactHttpsOriginSchema,
    secureContext: z.boolean(),
    crossOriginIsolated: z.boolean(),
    browserFlags: BrowserFlagsSchema,
    cpu: z
      .object({
        model: BoundedTextSchema,
        logicalProcessors: PositiveSafeIntegerSchema,
        architecture: z.enum(['x86_64', 'arm64']),
      })
      .strict(),
    ramBytes: PositiveSafeIntegerSchema,
    gpu: z
      .object({
        vendor: BoundedTextSchema,
        device: BoundedTextSchema,
        driverVersion: BoundedTextSchema,
      })
      .strict(),
    webgpu: z.union([WasmWebGpuEnvironmentSchema, PassedWebGpuEnvironmentSchema]),
    runtime: RuntimeConfigurationSchema,
    failure: z.null(),
  })
  .strict()
  .superRefine((environment, context) => {
    if (
      !environment.secureContext ||
      !environment.crossOriginIsolated ||
      environment.browserFlags.forcedGc ||
      environment.browserFlags.unsafeWebgpu ||
      environment.browserFlags.ignoreGpuBlocklist ||
      environment.browserFlags.otherNonDefaultCount !== 0 ||
      environment.runtime.numThreads !== 1 ||
      environment.runtime.proxy ||
      !environment.runtime.wasmBinaryTransferred ||
      environment.runtime.selectedBackendImportCount !== 1 ||
      environment.runtime.unselectedBackendImportCount !== 0 ||
      environment.runtime.fallbackAttemptCount !== 0
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A passing environment requires secure isolated default-flag execution with one exact backend and no fallback',
      });
    }
  });

const ConsentSchema = z
  .object({
    status: z.literal('passed'),
    selectionId: z.enum([
      SUPERTONIC_RUNTIME_IDENTITIES.webgpu.selectionId,
      SUPERTONIC_RUNTIME_IDENTITIES.wasm.selectionId,
    ]),
    selectionDigest: Sha256Schema,
    assetSetId: z.literal(SUPERTONIC_ASSET_SET_ID),
    manifestDigest: z.literal(SUPERTONIC_MANIFEST_DIGEST),
    requiredLicenseIds: z.tuple([z.literal(REQUIRED_LICENSE_ID)]),
    acceptedLicenseIds: z.tuple([z.literal(REQUIRED_LICENSE_ID)]),
    requiredTermsHashes: z.tuple([z.literal(REQUIRED_TERMS_SHA256)]),
    acceptedTermsHashes: z.tuple([z.literal(REQUIRED_TERMS_SHA256)]),
    disclosureSha256: Sha256Schema,
    receiptSha256: Sha256Schema,
    acceptedAt: StrictIsoDateTimeSchema,
    userGesture: z.literal(true),
    failure: z.null(),
  })
  .strict();

const ForbiddenPreConsentCountsSchema = z
  .object({
    modelFetchCount: SafeIntegerSchema,
    runtimeFetchCount: SafeIntegerSchema,
    ortModuleImportCount: SafeIntegerSchema,
    workerCreateCount: SafeIntegerSchema,
    workerResumeCount: SafeIntegerSchema,
    opfsOperationCount: SafeIntegerSchema,
    cacheStorageInferenceOperationCount: SafeIntegerSchema,
    xhrInferenceRequestCount: SafeIntegerSchema,
    importScriptsInferenceRequestCount: SafeIntegerSchema,
    dynamicModuleInferenceRequestCount: SafeIntegerSchema,
    webgpuDeviceCreateCount: SafeIntegerSchema,
    sessionCreateCount: SafeIntegerSchema,
    inferenceExecuteCount: SafeIntegerSchema,
  })
  .strict();

const PreConsentSchema = z
  .object({
    status: z.literal('passed'),
    windowStartedAt: StrictIsoDateTimeSchema,
    windowEndedAt: StrictIsoDateTimeSchema,
    instrumentation: z
      .object({
        pageInstalledBeforeFirstApplicationScript: z.boolean(),
        workerInstalledBeforeResume: z.boolean(),
        trace: ContentArtifactSchema,
        eventCount: SafeIntegerSchema,
        droppedEventCount: SafeIntegerSchema,
      })
      .strict(),
    allowed: z
      .object({ shellFetchCount: SafeIntegerSchema, catalogFetchCount: SafeIntegerSchema })
      .strict(),
    forbidden: ForbiddenPreConsentCountsSchema,
    forbiddenInferenceEventCount: SafeIntegerSchema,
    firstForbiddenEvent: z.null(),
    failure: z.null(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const exactForbiddenCount = Object.values(evidence.forbidden).reduce(
      (total, count) => total + count,
      0,
    );
    if (
      !evidence.instrumentation.pageInstalledBeforeFirstApplicationScript ||
      !evidence.instrumentation.workerInstalledBeforeResume ||
      evidence.instrumentation.droppedEventCount !== 0 ||
      evidence.forbiddenInferenceEventCount !== exactForbiddenCount ||
      exactForbiddenCount !== 0 ||
      evidence.instrumentation.eventCount <
        evidence.allowed.shellFetchCount + evidence.allowed.catalogFetchCount
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Passing pre-consent evidence requires complete early instrumentation and zero inference I/O',
      });
    }
  });

const PassedClosureObservationBase = z.object({
  result: z.literal('passed'),
  ordinal: z.number().int().safe().min(1).max(17),
  artifactId: z.string().trim().min(1).max(100),
  cacheKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]+$/),
  expectedBytes: PositiveSafeIntegerSchema,
  observedBytes: PositiveSafeIntegerSchema,
  expectedSha256: Sha256Schema,
  observedSha256: Sha256Schema,
  mediaType: z.enum(['application/onnx', 'application/json', 'application/wasm']),
  finalOrigin: ExactHttpsOriginSchema,
  finalUrlRedacted: RedactedFinalUrlSchema,
  finalUrlSha256: Sha256Schema,
  httpStatus: z.literal(200),
  networkTransferBytes: PositiveSafeIntegerSchema,
  signedQueryPersisted: z.literal(false),
});

const PassedModelClosureObservationSchema = PassedClosureObservationBase.extend({
  kind: z.literal('model'),
  requestUrl: CanonicalModelRequestUrlSchema,
  responseType: z.literal('cors'),
  storage: z.literal('opfs'),
  opfsCommitted: z.literal(true),
}).strict();

const PassedRuntimeClosureObservationSchema = PassedClosureObservationBase.extend({
  kind: z.literal('runtime'),
  requestUrl: ImmutableHttpsUrlSchema,
  responseType: z.literal('basic'),
  storage: z.literal('browser-http-cache'),
  opfsCommitted: z.literal(false),
  browserCacheObserved: z.literal(true),
}).strict();

const ClosureSchema = z
  .object({
    status: z.literal('passed'),
    mode: z.literal('cold-online'),
    modelBytes: z.literal(MODEL_BYTES),
    runtimeBytes: PositiveSafeIntegerSchema,
    selectedBytes: PositiveSafeIntegerSchema,
    observations: z
      .array(
        z.discriminatedUnion('kind', [
          PassedModelClosureObservationSchema,
          PassedRuntimeClosureObservationSchema,
        ]),
      )
      .length(17),
    failure: z.null(),
  })
  .strict()
  .superRefine((closure, context) => {
    const runtime = closure.observations[16];
    const selectedRuntime =
      runtime?.kind === 'runtime'
        ? Object.values(SUPERTONIC_RUNTIME_IDENTITIES).find(
            (identity) => identity.artifactId === runtime.artifactId,
          )
        : undefined;
    if (
      closure.observations.filter(({ kind }) => kind === 'model').length !== 16 ||
      runtime?.kind !== 'runtime' ||
      selectedRuntime === undefined ||
      runtime.ordinal !== 17 ||
      runtime.expectedBytes !== selectedRuntime.byteLength ||
      runtime.observedBytes !== selectedRuntime.byteLength ||
      runtime.expectedSha256 !== selectedRuntime.sha256 ||
      runtime.observedSha256 !== selectedRuntime.sha256 ||
      runtime.mediaType !== selectedRuntime.mediaType ||
      runtime.networkTransferBytes !== selectedRuntime.byteLength ||
      new URL(runtime.requestUrl).origin !== runtime.finalOrigin ||
      runtime.finalUrlRedacted !== `${runtime.finalOrigin}/<redacted>` ||
      runtime.cacheKey !== new URL(runtime.requestUrl).pathname.slice(1) ||
      closure.runtimeBytes !== selectedRuntime.byteLength ||
      closure.selectedBytes !== closure.modelBytes + closure.runtimeBytes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Closure must contain the exact ordered 16-model plus one-runtime selection',
      });
    }
    for (const [index, identity] of SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.entries()) {
      const observation = closure.observations[index];
      if (observation?.kind !== 'model') continue;
      const expectedFinalOrigin =
        identity.mediaType === 'application/onnx'
          ? 'https://cas-bridge.xethub.hf.co'
          : 'https://huggingface.co';
      const expectedRequestUrl = `https://huggingface.co/Supertone/supertonic-3/resolve/${MODEL_REVISION}/${MODEL_PATHS[index]}?download=true`;
      const expectedCacheKey = `supertonic/${identity.assetId}/${MODEL_REVISION}/${identity.sha256.slice('sha256:'.length)}`;
      if (
        observation.ordinal !== index + 1 ||
        observation.artifactId !== identity.assetId ||
        observation.cacheKey !== expectedCacheKey ||
        observation.expectedBytes !== identity.byteLength ||
        observation.observedBytes !== identity.byteLength ||
        observation.expectedSha256 !== identity.sha256 ||
        observation.observedSha256 !== identity.sha256 ||
        observation.mediaType !== identity.mediaType ||
        observation.requestUrl !== expectedRequestUrl ||
        observation.finalOrigin !== expectedFinalOrigin ||
        observation.finalUrlRedacted !== `${expectedFinalOrigin}/<redacted>` ||
        observation.networkTransferBytes !== identity.byteLength
      ) {
        context.addIssue({
          code: 'custom',
          path: ['observations', index],
          message: `Closure model observation ${identity.assetId} is not exact`,
        });
      }
    }
  });

const PersistenceObservationSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('observed'), value: z.boolean(), reasonCode: z.null() }).strict(),
  z
    .object({
      state: z.literal('unavailable'),
      value: z.null(),
      reasonCode: z.enum(['api-not-exposed', 'browser-denied']),
    })
    .strict(),
]);

const StorageSnapshotSchema = z
  .object({
    capturedAt: StrictIsoDateTimeSchema,
    quotaBytes: SafeIntegerSchema,
    usageBytes: SafeIntegerSchema,
    persistence: PersistenceObservationSchema,
    opfsItemCount: SafeIntegerSchema,
    opfsVerifiedBytes: SafeIntegerSchema,
    browserCachedRuntimeBytes: SafeIntegerSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.usageBytes > snapshot.quotaBytes) {
      context.addIssue({ code: 'custom', message: 'Storage usage cannot exceed quota' });
    }
  });

const StorageSchema = z
  .object({
    status: z.literal('passed'),
    selectedBytes: PositiveSafeIntegerSchema,
    modelBytes: z.literal(MODEL_BYTES),
    runtimeBytes: PositiveSafeIntegerSchema,
    largestAssetBytes: z.literal(LARGEST_MODEL_ASSET_BYTES),
    safetyMarginBytes: PositiveSafeIntegerSchema,
    upperBoundBytes: PositiveSafeIntegerSchema,
    retainedModelBytes: SafeIntegerSchema,
    candidateModelBytes: SafeIntegerSchema,
    candidateRuntimeCacheBytes: SafeIntegerSchema,
    largestTemporaryBytes: SafeIntegerSchema,
    additionalRequiredBytes: SafeIntegerSchema,
    requiredCapacityBytes: SafeIntegerSchema,
    availableBytesBefore: SafeIntegerSchema,
    before: StorageSnapshotSchema,
    after: StorageSnapshotSchema,
    failure: z.null(),
  })
  .strict()
  .superRefine((storage, context) => {
    const expectedSelected = storage.modelBytes + storage.runtimeBytes;
    const expectedUpper =
      storage.selectedBytes + storage.largestAssetBytes + storage.safetyMarginBytes;
    const expectedAdditional =
      storage.candidateModelBytes === 0 && storage.candidateRuntimeCacheBytes === 0
        ? 0
        : storage.candidateModelBytes +
          storage.candidateRuntimeCacheBytes +
          storage.largestTemporaryBytes +
          storage.safetyMarginBytes;
    const expectedRequired = storage.retainedModelBytes + expectedAdditional;
    if (
      ![expectedSelected, expectedUpper, expectedAdditional, expectedRequired].every(
        Number.isSafeInteger,
      ) ||
      storage.selectedBytes !== expectedSelected ||
      storage.upperBoundBytes !== expectedUpper ||
      storage.additionalRequiredBytes !== expectedAdditional ||
      storage.requiredCapacityBytes !== expectedRequired ||
      storage.availableBytesBefore !== storage.before.quotaBytes - storage.before.usageBytes ||
      storage.availableBytesBefore < storage.requiredCapacityBytes ||
      storage.retainedModelBytes + storage.candidateModelBytes !== storage.modelBytes ||
      storage.candidateRuntimeCacheBytes !== storage.runtimeBytes ||
      storage.after.opfsItemCount !== 16 ||
      storage.after.opfsVerifiedBytes !== storage.modelBytes ||
      storage.after.browserCachedRuntimeBytes !== storage.runtimeBytes
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Passing storage evidence must preserve exact S0 arithmetic and sufficient capacity',
      });
    }
  });

const PassedWasmSmokeSchema = z
  .object({
    status: z.literal('passed'),
    runId: z.literal('smoke-m1-en'),
    voiceId: z.literal('supertonic:M1'),
    language: z.literal('en'),
    promptRowId: z.literal('supertonic-q07-m1-en'),
    promptTextSha256: Sha256Schema,
    startedAt: StrictIsoDateTimeSchema,
    finishedAt: StrictIsoDateTimeSchema,
    elapsedMs: z.number().finite().nonnegative(),
    peakMemoryBytes: PositiveSafeIntegerSchema,
    timeoutMs: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wasmSmokeTimeoutMs),
    audioSha256: Sha256Schema,
    failure: z.null(),
  })
  .strict()
  .superRefine((smoke, context) => {
    if (smoke.elapsedMs > smoke.timeoutMs) {
      context.addIssue({
        code: 'custom',
        message: 'Passing WASM smoke evidence exceeded its timeout',
      });
    }
  });

const NotApplicableWasmSmokeSchema = z
  .object({
    status: z.literal('not-applicable'),
    reasonCode: z.literal('tuple-is-not-chrome-wasm'),
  })
  .strict();

const PromptFixtureSchema = z
  .object({
    ordinal: z.number().int().safe().min(1).max(42),
    rowId: z.string().regex(/^supertonic-q[0-9]{2}-[fm][1-5]-[a-z]{2}$/),
    voiceId: z.enum([
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
    ]),
    language: z.enum(SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER),
    path: RepoPathSchema,
    promptTextSha256: Sha256Schema,
    utf8Bytes: PositiveSafeIntegerSchema,
    codePointCount: PositiveSafeIntegerSchema,
    speechUnitMethod: z.enum(['unicode-whitespace-token-count-v1', 'manual-japanese-lexical-v1']),
    reviewedSpeechUnitCount: PositiveSafeIntegerSchema,
    minimumSampleFrames: PositiveSafeIntegerSchema,
    maximumSampleFrames: PositiveSafeIntegerSchema,
    projectAuthored: z.literal(true),
    reviewedAt: StrictIsoDateTimeSchema,
    reviewerId: ReviewerIdSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    const wavPolicy = SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence;
    const expectedMinimum = Math.max(
      wavPolicy.minimumSampleFrames,
      fixture.reviewedSpeechUnitCount * 7_350,
    );
    const expectedMaximum = Math.min(
      wavPolicy.maximumSampleFrames,
      88_200 + fixture.reviewedSpeechUnitCount * 58_800,
    );
    const expectedPath = `packages/contracts/evidence-assets/prompts/${fixture.rowId}-${fixture.promptTextSha256.slice('sha256:'.length)}.txt`;
    if (
      fixture.path !== expectedPath ||
      fixture.minimumSampleFrames !== expectedMinimum ||
      fixture.maximumSampleFrames !== expectedMaximum ||
      fixture.maximumSampleFrames < fixture.minimumSampleFrames
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Prompt fixture must bind the exact reviewed speech-unit duration band',
      });
    }
  });

const PlaybackDeviceSchema = z
  .object({
    kind: z.enum(['headphones', 'speakers']),
    manufacturer: BoundedTextSchema,
    model: BoundedTextSchema,
    connection: z.enum(['wired', 'usb', 'bluetooth', 'built-in']),
    outputSampleRateHz: PositiveSafeIntegerSchema,
  })
  .strict();

const PassedRunReviewSchema = z
  .object({
    reviewerId: ReviewerIdSchema,
    languageCompetence: z.enum(['native', 'professional', 'fluent']),
    playbackDevice: PlaybackDeviceSchema,
    reviewedAt: StrictIsoDateTimeSchema,
    intelligibility: z.literal('pass'),
    languageMatch: z.literal('pass'),
    skips: z.literal('none'),
    repeats: z.literal('none'),
    artifacts: z.literal('none'),
    clipping: z.literal('none'),
    styleDistinct: z.enum(['pass', 'not-applicable']),
    decision: z.literal('pass'),
  })
  .strict();

const PassedAudioSchema = z
  .object({
    mimeType: z.literal('audio/wav'),
    filename: z.string().regex(/^ai-generated-supertonic-[a-z0-9-]+\.wav$/),
    workerResultSha256: Sha256Schema,
    blobSha256: Sha256Schema,
    playerSha256: Sha256Schema,
    downloadSha256: Sha256Schema,
    policyId: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.policyId),
    fileBytes: PositiveSafeIntegerSchema,
    header: z
      .object({
        riffChunkSizeBytes: PositiveSafeIntegerSchema,
        fmtChunkSizeBytes: z.literal(16),
        audioFormat: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.audioFormat),
        channelCount: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.channelCount,
        ),
        sampleRateHz: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.sampleRateHz,
        ),
        byteRate: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.byteRate),
        blockAlignBytes: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.blockAlignBytes,
        ),
        bitsPerSample: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.bitsPerSample,
        ),
        dataOffsetBytes: z.literal(
          SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence.headerBytes,
        ),
        pcmBytes: PositiveSafeIntegerSchema,
      })
      .strict(),
    sampleFrames: PositiveSafeIntegerSchema,
    durationMicrosFloor: PositiveSafeIntegerSchema,
    promptBand: z
      .object({
        minimumSampleFrames: PositiveSafeIntegerSchema,
        maximumSampleFrames: PositiveSafeIntegerSchema,
      })
      .strict(),
    signal: z
      .object({
        minPcm16: z.number().int().min(-32_768).max(32_767),
        maxPcm16: z.number().int().min(-32_768).max(32_767),
        peakPcm16: SafeIntegerSchema.max(32_768),
        sampleSumPcm16: SignedSafeIntegerSchema,
        sampleSquareSumPcm16: SafeIntegerSchema,
        nonZeroFrames: SafeIntegerSchema,
        nonZeroPpmFloor: SafeIntegerSchema.max(1_000_000),
        clippedFrames: SafeIntegerSchema,
        clippedPpmFloor: SafeIntegerSchema.max(1_000_000),
        rmsPcm16MilliFloor: SafeIntegerSchema,
        dcOffsetPcm16MilliTrunc: SignedSafeIntegerSchema,
      })
      .strict(),
    validation: z.literal('passed'),
    sha256: Sha256Schema,
  })
  .strict()
  .superRefine((audio, context) => {
    const policy = SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.wavEvidence;
    const expectedNonZeroPpm = Math.floor(
      (audio.signal.nonZeroFrames * 1_000_000) / audio.sampleFrames,
    );
    const expectedClippedPpm = Math.floor(
      (audio.signal.clippedFrames * 1_000_000) / audio.sampleFrames,
    );
    const expectedRmsMilli = Math.floor(
      Math.sqrt(audio.signal.sampleSquareSumPcm16 / audio.sampleFrames) * 1_000,
    );
    const expectedDcMilli = Math.trunc((audio.signal.sampleSumPcm16 * 1_000) / audio.sampleFrames);
    if (
      new Set([
        audio.workerResultSha256,
        audio.blobSha256,
        audio.playerSha256,
        audio.downloadSha256,
        audio.sha256,
      ]).size !== 1 ||
      audio.fileBytes !== audio.header.riffChunkSizeBytes + 8 ||
      audio.fileBytes !== audio.header.pcmBytes + policy.headerBytes ||
      audio.header.pcmBytes !== audio.sampleFrames * policy.blockAlignBytes ||
      audio.durationMicrosFloor !==
        Math.floor((audio.sampleFrames * 1_000_000) / policy.sampleRateHz) ||
      audio.sampleFrames < policy.minimumSampleFrames ||
      audio.sampleFrames > policy.maximumSampleFrames ||
      audio.promptBand.minimumSampleFrames > audio.sampleFrames ||
      audio.promptBand.maximumSampleFrames < audio.sampleFrames ||
      audio.promptBand.minimumSampleFrames < policy.minimumSampleFrames ||
      audio.promptBand.maximumSampleFrames > policy.maximumSampleFrames ||
      audio.signal.minPcm16 > audio.signal.maxPcm16 ||
      audio.signal.peakPcm16 !==
        Math.max(Math.abs(audio.signal.minPcm16), Math.abs(audio.signal.maxPcm16)) ||
      audio.signal.nonZeroFrames > audio.sampleFrames ||
      audio.signal.clippedFrames > audio.signal.nonZeroFrames ||
      audio.signal.sampleSquareSumPcm16 < audio.signal.peakPcm16 ** 2 ||
      audio.signal.nonZeroPpmFloor !== expectedNonZeroPpm ||
      audio.signal.clippedPpmFloor !== expectedClippedPpm ||
      audio.signal.rmsPcm16MilliFloor !== expectedRmsMilli ||
      audio.signal.dcOffsetPcm16MilliTrunc !== expectedDcMilli ||
      audio.signal.nonZeroFrames * 1_000_000 < policy.minimumNonZeroPpm * audio.sampleFrames ||
      audio.signal.peakPcm16 < policy.minimumPeakPcm16 ||
      audio.signal.sampleSquareSumPcm16 < policy.minimumRmsSquarePcm16 * audio.sampleFrames ||
      audio.signal.clippedFrames * 1_000_000 > policy.maximumClippedPpm * audio.sampleFrames ||
      Math.abs(audio.signal.sampleSumPcm16) >
        policy.maximumAbsoluteDcOffsetPcm16 * audio.sampleFrames
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Passing WAV evidence failed exact identity, RIFF, PCM, duration, or signal gates',
      });
    }
  });

const PassedRunSchema = z
  .object({
    ordinal: z.number().int().safe().min(1).max(42),
    runId: z.string().regex(/^supertonic-q[0-9]{2}-[fm][1-5]-[a-z]{2}$/),
    voiceId: z.enum([
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
    ]),
    language: z.enum(SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER),
    promptRowId: z.string().regex(/^supertonic-q[0-9]{2}-[fm][1-5]-[a-z]{2}$/),
    status: z.literal('passed'),
    promptTextSha256: Sha256Schema,
    speed: z.literal(1),
    workerGeneration: PositiveSafeIntegerSchema,
    operationId: SafeIntegerSchema,
    startedAt: StrictIsoDateTimeSchema,
    finishedAt: StrictIsoDateTimeSchema,
    prepareMs: z.number().finite().nonnegative(),
    synthesisMs: z
      .number()
      .finite()
      .nonnegative()
      .max(SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.synthesisTimeoutMs),
    totalMs: z.number().finite().nonnegative(),
    audio: PassedAudioSchema,
    review: PassedRunReviewSchema,
  })
  .strict()
  .superRefine((run, context) => {
    if (
      Math.abs(run.totalMs - run.prepareMs - run.synthesisMs) > 0.01 ||
      Date.parse(run.finishedAt) < Date.parse(run.startedAt)
    ) {
      context.addIssue({ code: 'custom', message: 'Run timing total is inconsistent' });
    }
  });

const RunsSchema = z
  .object({
    status: z.literal('passed'),
    promptSet: z
      .object({
        promptSetId: PromptSetIdSchema,
        manifestSha256: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256),
        bytes: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES),
        fixtures: z.array(PromptFixtureSchema).length(42),
      })
      .strict(),
    rows: z.array(PassedRunSchema).length(42),
    plannedCount: z.literal(42),
    passedCount: z.literal(42),
    failedCount: z.literal(0),
    blockedCount: z.literal(0),
    failure: z.null(),
  })
  .strict()
  .superRefine((runs, context) => {
    for (const [index, plan] of SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN.entries()) {
      const fixture = runs.promptSet.fixtures[index];
      if (
        fixture?.ordinal !== plan.ordinal ||
        fixture.rowId !== plan.promptRowId ||
        fixture.voiceId !== plan.voiceId ||
        fixture.language !== plan.language ||
        fixture.promptTextSha256 !== plan.promptTextSha256 ||
        fixture.speechUnitMethod !== plan.speechUnitMethod ||
        fixture.reviewedSpeechUnitCount !== plan.reviewedSpeechUnitCount ||
        fixture.minimumSampleFrames !== plan.minimumSampleFrames ||
        fixture.maximumSampleFrames !== plan.maximumSampleFrames
      ) {
        context.addIssue({
          code: 'custom',
          path: ['promptSet', 'fixtures', index],
          message: 'Prompt fixtures must use the exact canonical 42-row order and identity',
        });
      }
    }
    const fixtureById = new Map(
      runs.promptSet.fixtures.map((fixture) => [fixture.rowId, fixture] as const),
    );
    for (const [index, plan] of SUPERTONIC_BROWSER_QUALIFICATION_RUN_PLAN.entries()) {
      const row = runs.rows[index];
      const fixture = row === undefined ? undefined : fixtureById.get(row.promptRowId);
      if (
        row === undefined ||
        row.ordinal !== plan.ordinal ||
        row.runId !== plan.runId ||
        row.voiceId !== plan.voiceId ||
        row.language !== plan.language ||
        row.promptRowId !== plan.promptRowId ||
        fixture === undefined ||
        row.promptTextSha256 !== fixture.promptTextSha256 ||
        row.audio.promptBand.minimumSampleFrames !== fixture.minimumSampleFrames ||
        row.audio.promptBand.maximumSampleFrames !== fixture.maximumSampleFrames
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Qualification run does not match its exact plan, prompt, or duration band',
        });
      }
    }
    const englishStyleRows = runs.rows.filter(({ language }) => language === 'en');
    const hashes = englishStyleRows.map(({ audio }) => audio.workerResultSha256);
    const rowByIdentity = new Map(
      runs.rows.map((row) => [`${row.voiceId}:${row.language}`, row] as const),
    );
    const styleDistinctMustPass = new Set([
      'supertonic:F1:en',
      'supertonic:F2:en',
      'supertonic:F3:en',
      'supertonic:F4:en',
      'supertonic:F5:en',
      'supertonic:M2:en',
      'supertonic:M3:en',
      'supertonic:M4:en',
      'supertonic:M5:en',
      'supertonic:F1:ja',
      'supertonic:F1:ar',
    ]);
    const incorrectStyleReview = runs.rows.some((row) => {
      const identity = `${row.voiceId}:${row.language}`;
      return (
        row.review.styleDistinct !==
        (styleDistinctMustPass.has(identity) ? 'pass' : 'not-applicable')
      );
    });
    if (
      englishStyleRows.length !== 10 ||
      new Set(hashes).size !== 10 ||
      incorrectStyleReview ||
      rowByIdentity.get('supertonic:M1:ja')?.audio.workerResultSha256 ===
        rowByIdentity.get('supertonic:F1:ja')?.audio.workerResultSha256 ||
      rowByIdentity.get('supertonic:M1:ar')?.audio.workerResultSha256 ===
        rowByIdentity.get('supertonic:F1:ar')?.audio.workerResultSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'English styles and M1/F1 Japanese/Arabic outputs must have distinct hashes',
      });
    }
  });

const FailureCasePassedBase = z.object({
  ordinal: z.number().int().safe().min(1).max(13),
  status: z.literal('passed'),
  startedAt: StrictIsoDateTimeSchema,
  finishedAt: StrictIsoDateTimeSchema,
  trace: ContentArtifactSchema,
});

const ColdOnlineCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('cold-online'),
  freshProfile: z.literal(true),
  initialOpfsItemCount: z.literal(0),
  initialCacheMatchCount: z.literal(0),
  initialServiceWorkerRegistrationCount: z.literal(0),
  modelRequestCount: z.literal(16),
  runtimeRequestCount: z.literal(1),
  duplicateRequestCount: z.literal(0),
  downloadedClosureItemCount: z.literal(17),
}).strict();

const WarmOnlineCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('warm-online'),
  verifiedOpfsItemCount: z.literal(16),
  modelNetworkRequestCount: z.literal(0),
  runtimeNetworkRequestCount: z.literal(0),
  modelNetworkTransferBytes: z.literal(0),
  runtimeNetworkTransferBytes: z.literal(0),
  synthesisAudioSha256: Sha256Schema,
}).strict();

const WarmOfflineHardReloadCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('warm-offline-hard-reload'),
  hardReload: z.literal(true),
  offline: z.literal(true),
  shellSource: z.literal('browser-http-cache'),
  verifiedOpfsItemCount: z.literal(16),
  modelNetworkTransferBytes: z.literal(0),
  runtimeNetworkTransferBytes: z.literal(0),
  synthesisAudioSha256: Sha256Schema,
}).strict();

const ColdOfflineCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('cold-offline'),
  offline: z.literal(true),
  initialOpfsItemCount: z.literal(0),
  terminalErrorCode: z.literal('offline-closure-unavailable'),
  failureStage: z.literal('before-worker-construction'),
  workerCreatedCount: z.literal(0),
  sessionCreatedCount: z.literal(0),
  audioAcceptedCount: z.literal(0),
}).strict();

function createCorruptionCaseSchema(
  caseId: 'corrupt-model-entry' | 'corrupt-runtime-wasm',
  artifactId: 'onnx-vector-estimator-onnx' | 'onnxruntime-web-wasm-runtime',
  modelRedownloadCount: 0 | 1,
  runtimeRedownloadCount: 0 | 1,
) {
  return FailureCasePassedBase.extend({
    caseId: z.literal(caseId),
    artifactId: z.literal(artifactId),
    byteOffset: SafeIntegerSchema,
    originalByte: z.number().int().min(0).max(255),
    corruptByte: z.number().int().min(0).max(255),
    hashRejected: z.literal(true),
    exactKeyEvictionCount: z.literal(1),
    modelRedownloadCount: z.literal(modelRedownloadCount),
    runtimeRedownloadCount: z.literal(runtimeRedownloadCount),
    otherArtifactRedownloadCount: z.literal(0),
    reverified: z.literal(true),
  })
    .strict()
    .superRefine((evidence, context) => {
      if (evidence.originalByte === evidence.corruptByte) {
        context.addIssue({ code: 'custom', message: 'Corruption must change the selected byte' });
      }
    });
}

const CorruptModelCaseSchema = createCorruptionCaseSchema(
  'corrupt-model-entry',
  'onnx-vector-estimator-onnx',
  1,
  0,
);
const CorruptRuntimeCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('corrupt-runtime-wasm'),
  artifactId: z.enum([
    SUPERTONIC_RUNTIME_IDENTITIES.webgpu.artifactId,
    SUPERTONIC_RUNTIME_IDENTITIES.wasm.artifactId,
  ]),
  byteOffset: SafeIntegerSchema,
  originalByte: z.number().int().min(0).max(255),
  corruptByte: z.number().int().min(0).max(255),
  hashRejected: z.literal(true),
  exactKeyEvictionCount: z.literal(1),
  modelRedownloadCount: z.literal(0),
  runtimeRedownloadCount: z.literal(1),
  otherArtifactRedownloadCount: z.literal(0),
  reverified: z.literal(true),
})
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.originalByte === evidence.corruptByte) {
      context.addIssue({ code: 'custom', message: 'Corruption must change the selected byte' });
    }
  });

const QuotaMinusOneCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('quota-minus-one'),
  requiredCapacityBytes: PositiveSafeIntegerSchema,
  forcedAvailableBytes: SafeIntegerSchema,
  terminalErrorCode: z.literal('quota-exceeded'),
  networkRequestCount: z.literal(0),
  workerCreatedCount: z.literal(0),
  sessionCreatedCount: z.literal(0),
})
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.forcedAvailableBytes !== evidence.requiredCapacityBytes - 1) {
      context.addIssue({
        code: 'custom',
        message: 'Quota rejection must be exercised at exactly S0 required capacity minus one byte',
      });
    }
  });

function createCancellationCaseSchema<
  const CaseId extends
    'cancel-download' | 'cancel-hash-store' | 'cancel-import-session' | 'cancel-synthesis',
  const Stage extends 'download' | 'hash-store' | 'import-session' | 'synthesis',
>(caseId: CaseId, injectionStage: Stage) {
  return FailureCasePassedBase.extend({
    caseId: z.literal(caseId),
    injectionStage: z.literal(injectionStage),
    terminalCancellationCount: z.literal(1),
    lateAcceptedEventCount: z.literal(0),
    lateAudioCount: z.literal(0),
    lateDownloadCount: z.literal(0),
    temporaryArtifactCountAfter: z.literal(0),
    recoveryWorkerGeneration: PositiveSafeIntegerSchema,
    recoveryAudioSha256: Sha256Schema,
  }).strict();
}

const CancelDownloadCaseSchema = createCancellationCaseSchema('cancel-download', 'download');
const CancelHashStoreCaseSchema = createCancellationCaseSchema('cancel-hash-store', 'hash-store');
const CancelImportSessionCaseSchema = createCancellationCaseSchema(
  'cancel-import-session',
  'import-session',
);
const CancelSynthesisCaseSchema = createCancellationCaseSchema('cancel-synthesis', 'synthesis');

const RestartWarmOfflineCaseSchema = FailureCasePassedBase.extend({
  caseId: z.literal('restart-warm-offline'),
  sameProfile: z.literal(true),
  browserRestartCount: z.literal(1),
  offline: z.literal(true),
  verifiedOpfsItemCount: z.literal(16),
  modelNetworkTransferBytes: z.literal(0),
  runtimeNetworkTransferBytes: z.literal(0),
  synthesisAudioSha256: Sha256Schema,
}).strict();

const WebGpuDeviceLossPassedSchema = FailureCasePassedBase.extend({
  caseId: z.literal('webgpu-device-loss'),
  deviceLostEventCount: z.literal(1),
  terminalErrorCode: z.literal('webgpu-device-lost'),
  fallbackAttemptCount: z.literal(0),
  survivingSessionCount: z.literal(0),
  recoveryWorkerGeneration: PositiveSafeIntegerSchema,
  recoveryAudioSha256: Sha256Schema,
}).strict();

const WebGpuDeviceLossNotApplicableSchema = z
  .object({
    caseId: z.literal('webgpu-device-loss'),
    ordinal: z.literal(13),
    status: z.literal('not-applicable'),
    reasonCode: z.literal('wasm-backend-has-no-webgpu-device'),
  })
  .strict();

const FailuresSchema = z
  .object({
    status: z.literal('passed'),
    cases: z.tuple([
      ColdOnlineCaseSchema,
      WarmOnlineCaseSchema,
      WarmOfflineHardReloadCaseSchema,
      ColdOfflineCaseSchema,
      CorruptModelCaseSchema,
      CorruptRuntimeCaseSchema,
      QuotaMinusOneCaseSchema,
      CancelDownloadCaseSchema,
      CancelHashStoreCaseSchema,
      CancelImportSessionCaseSchema,
      CancelSynthesisCaseSchema,
      RestartWarmOfflineCaseSchema,
      z.union([WebGpuDeviceLossPassedSchema, WebGpuDeviceLossNotApplicableSchema]),
    ]),
    plannedCount: z.literal(13),
    passedCount: z.union([z.literal(12), z.literal(13)]),
    notApplicableCount: z.union([z.literal(0), z.literal(1)]),
    failedCount: z.literal(0),
    blockedCount: z.literal(0),
    failure: z.null(),
  })
  .strict()
  .superRefine((evidence, context) => {
    for (const [index, caseId] of SUPERTONIC_BROWSER_QUALIFICATION_FAILURE_CASE_IDS.entries()) {
      const failureCase = evidence.cases[index];
      if (failureCase?.caseId !== caseId || failureCase.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['cases', index],
          message: 'Failure and recovery cases must use the exact canonical order',
        });
      }
    }
    const passedCount = evidence.cases.filter(({ status }) => status === 'passed').length;
    const notApplicableCount = evidence.cases.length - passedCount;
    if (
      evidence.passedCount !== passedCount ||
      evidence.notApplicableCount !== notApplicableCount
    ) {
      context.addIssue({ code: 'custom', message: 'Failure-case accounting is inconsistent' });
    }
  });

const UserAgentSpecificMemorySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('observed'),
      bytes: PositiveSafeIntegerSchema,
      reasonCode: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unavailable'),
      bytes: z.null(),
      reasonCode: z.enum(['api-not-exposed', 'permission-denied']),
    })
    .strict(),
]);

const LifecycleCycleSchema = z
  .object({
    cycle: z.number().int().safe().min(1).max(5),
    status: z.literal('passed'),
    plannedTerminal: z.enum(['completed', 'cancelled']),
    workerGeneration: PositiveSafeIntegerSchema,
    prepareOperationId: SafeIntegerSchema,
    synthesisOperationId: SafeIntegerSchema,
    disposeOperationId: SafeIntegerSchema,
    workerCreatedAt: StrictIsoDateTimeSchema,
    terminalAt: StrictIsoDateTimeSchema,
    disposeAcknowledgedAt: StrictIsoDateTimeSchema,
    workerTerminatedAt: StrictIsoDateTimeSchema,
    terminalResponse: z.enum(['completed', 'cancelled']),
    disposeAcknowledged: z.literal(true),
    survivingWorkerCount: z.literal(0),
    survivingSessionCount: z.literal(0),
    opfsItemCount: z.literal(16),
    opfsVerifiedBytes: z.literal(MODEL_BYTES),
    cdpMemory: z
      .object({
        beforeBytes: PositiveSafeIntegerSchema,
        peakBytes: PositiveSafeIntegerSchema,
        settledBytes: PositiveSafeIntegerSchema,
      })
      .strict(),
    userAgentSpecificMemory: UserAgentSpecificMemorySchema,
    forcedGc: z.literal(false),
    webgpuFlags: z.literal(false),
  })
  .strict()
  .superRefine((cycle, context) => {
    if (
      cycle.terminalResponse !== cycle.plannedTerminal ||
      new Set([cycle.prepareOperationId, cycle.synthesisOperationId, cycle.disposeOperationId])
        .size !== 3 ||
      cycle.cdpMemory.peakBytes < cycle.cdpMemory.beforeBytes ||
      cycle.cdpMemory.peakBytes < cycle.cdpMemory.settledBytes ||
      cycle.cdpMemory.settledBytes - cycle.cdpMemory.beforeBytes >
        SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.maxSettledMemoryGrowthBytes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Lifecycle cycle did not terminate, dispose, or settle memory exactly',
      });
    }
  });

const LifecycleSchema = z
  .object({
    status: z.literal('passed'),
    cycles: z.array(LifecycleCycleSchema).length(5),
    plannedCount: z.literal(5),
    passedCount: z.literal(5),
    failedCount: z.literal(0),
    blockedCount: z.literal(0),
    failure: z.null(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const operationIds = new Set<number>();
    const generations = new Set<number>();
    for (const [
      index,
      expectedTerminal,
    ] of SUPERTONIC_BROWSER_QUALIFICATION_LIFECYCLE_PLAN.entries()) {
      const cycle = evidence.cycles[index];
      if (cycle?.cycle !== index + 1 || cycle.plannedTerminal !== expectedTerminal) {
        context.addIssue({
          code: 'custom',
          path: ['cycles', index],
          message: 'Lifecycle cycles must follow the exact completed/cancelled plan',
        });
      }
      if (cycle !== undefined) {
        generations.add(cycle.workerGeneration);
        operationIds.add(cycle.prepareOperationId);
        operationIds.add(cycle.synthesisOperationId);
        operationIds.add(cycle.disposeOperationId);
      }
    }
    if (generations.size !== 5 || operationIds.size !== 15) {
      context.addIssue({
        code: 'custom',
        message: 'Every lifecycle cycle must use a fresh worker and unique operations',
      });
    }
  });

const UiViewportSchema = z
  .object({
    viewportWidth: PositiveSafeIntegerSchema,
    viewportHeight: PositiveSafeIntegerSchema,
    screenshot: ContentArtifactSchema,
    accessibilitySnapshot: ContentArtifactSchema,
  })
  .strict();

const UiSchema = z
  .object({
    status: z.literal('passed'),
    preConsentWarning: z
      .object({
        text: z.literal(
          'Nonconsensual impersonation is prohibited. Use preset voices responsibly.',
        ),
        visible: z.literal(true),
        visibleAt: StrictIsoDateTimeSchema,
      })
      .strict(),
    machineGeneratedDisclosure: z
      .object({
        text: z.literal('Machine-generated audio — not a human recording.'),
        visible: z.literal(true),
      })
      .strict(),
    sharedDownloadDisclosure: z
      .object({
        text: z.literal(
          'Shared copies need an AI-generated disclosure and applicable notices. Nonconsensual impersonation is prohibited.',
        ),
        visible: z.literal(true),
      })
      .strict(),
    filename: z.string().regex(/^ai-generated-supertonic-[a-z0-9-]+\.wav$/),
    accessibility: z
      .object({
        audioName: z.literal('Generated audio'),
        downloadName: z.literal('Download WAV'),
        audioDescribedByIds: z.tuple([
          z.literal('machine-generated-audio-notice'),
          z.literal('shared-audio-disclosure-notice'),
        ]),
        downloadDescribedByIds: z.tuple([
          z.literal('machine-generated-audio-notice'),
          z.literal('shared-audio-disclosure-notice'),
        ]),
      })
      .strict(),
    desktop: UiViewportSchema,
    mobile: UiViewportSchema,
    failure: z.null(),
  })
  .strict()
  .superRefine((ui, context) => {
    if (
      ui.desktop.viewportWidth !== 1_440 ||
      ui.desktop.viewportHeight !== 900 ||
      ui.mobile.viewportWidth !== 390 ||
      ui.mobile.viewportHeight !== 844 ||
      ui.desktop.screenshot.mediaType !== 'image/png' ||
      ui.mobile.screenshot.mediaType !== 'image/png' ||
      ui.desktop.accessibilitySnapshot.mediaType !== 'application/json' ||
      ui.mobile.accessibilitySnapshot.mediaType !== 'application/json'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'UI evidence must contain exact desktop/mobile screenshots and accessibility snapshots',
      });
    }
  });

const BuildOutputPathSchema = z
  .string()
  .regex(/^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)assets\/[A-Za-z0-9._-]+$/);

const EmittedFileSchema = z
  .object({
    path: BuildOutputPathSchema,
    role: z.enum(['initial-js', 'supertonic-worker', 'selected-runtime-wasm']),
    sha256: Sha256Schema,
    bytes: PositiveSafeIntegerSchema,
    gzipBytes: PositiveSafeIntegerSchema,
    mediaType: z.enum(['text/javascript', 'application/wasm']),
  })
  .strict();

const BuildSchema = z
  .object({
    status: z.literal('passed'),
    sourceCommit: GitObjectIdSchema,
    sourceTree: GitObjectIdSchema,
    packageLockSha256: Sha256Schema,
    command: z.literal('npm.cmd run build:web'),
    nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    npmVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    viteVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    emittedGraphSha256: Sha256Schema,
    emittedFiles: z.array(EmittedFileSchema).length(3),
    initialJsGzipBytes: PositiveSafeIntegerSchema,
    initialJsGzipLimitBytes: z.literal(
      SUPERTONIC_BROWSER_QUALIFICATION_POLICY_V2.initialJsGzipLimitBytes,
    ),
    supertonicWorkerFileCount: z.literal(1),
    selectedRuntimeWasmFileCount: z.literal(1),
    modelFileCount: z.literal(0),
    shellPrecache: z
      .object({
        entryCount: SafeIntegerSchema,
        workerEntryCount: z.literal(0),
        ortEntryCount: z.literal(0),
        wasmEntryCount: z.literal(0),
        onnxEntryCount: z.literal(0),
        modelEntryCount: z.literal(0),
      })
      .strict(),
    fixtureScan: z
      .object({
        testToneReferenceCount: z.literal(0),
        hz440ReferenceCount: z.literal(0),
        unverifiedBoundaryReferenceCount: z.literal(0),
        testSwitchReferenceCount: z.literal(0),
        fixtureAssetReferenceCount: z.literal(0),
        report: ContentArtifactSchema,
      })
      .strict(),
    productionConsole: z
      .object({
        errorCount: z.literal(0),
        warningCount: z.literal(0),
        unhandledRejectionCount: z.literal(0),
      })
      .strict(),
    failure: z.null(),
  })
  .strict()
  .superRefine((build, context) => {
    const hashedJavaScriptPath = /^assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.js$/;
    const hashedWasmPath = /^assets\/[A-Za-z0-9._-]+-[A-Za-z0-9_-]{8,}\.wasm$/;
    const roles = build.emittedFiles.map(({ role }) => role);
    const initial = build.emittedFiles.find(({ role }) => role === 'initial-js');
    const worker = build.emittedFiles.find(({ role }) => role === 'supertonic-worker');
    const runtime = build.emittedFiles.find(({ role }) => role === 'selected-runtime-wasm');
    if (
      new Set(roles).size !== 3 ||
      initial?.mediaType !== 'text/javascript' ||
      !hashedJavaScriptPath.test(initial.path) ||
      worker?.mediaType !== 'text/javascript' ||
      !hashedJavaScriptPath.test(worker.path) ||
      runtime?.mediaType !== 'application/wasm' ||
      !hashedWasmPath.test(runtime.path) ||
      new Set(build.emittedFiles.map(({ path }) => path)).size !== 3 ||
      build.initialJsGzipBytes !== initial.gzipBytes ||
      build.initialJsGzipBytes > build.initialJsGzipLimitBytes
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Build evidence must contain one exact lazy worker/runtime graph under the JS limit',
      });
    }
  });

const SecuritySchema = z
  .object({
    status: z.literal('passed'),
    reportOnlyObservation: ContentArtifactSchema,
    csp: z
      .object({
        defaultSrc: z.tuple([z.literal("'none'")]),
        baseUri: z.tuple([z.literal("'none'")]),
        objectSrc: z.tuple([z.literal("'none'")]),
        frameAncestors: z.tuple([z.literal("'none'")]),
        formAction: z.tuple([z.literal("'none'")]),
        scriptSrc: z.tuple([z.literal("'self'"), z.literal("'wasm-unsafe-eval'")]),
        scriptSrcAttr: z.tuple([z.literal("'none'")]),
        workerSrc: z.tuple([z.literal("'self'")]),
        connectSrc: z.tuple([
          z.literal("'self'"),
          z.literal('https://huggingface.co'),
          z.literal('https://cas-bridge.xethub.hf.co'),
        ]),
        styleSrcElem: z.tuple([z.literal("'self'")]),
        styleSrcAttr: z.tuple([z.literal("'unsafe-inline'")]),
        imgSrc: z.tuple([z.literal("'self'"), z.literal('data:')]),
        fontSrc: z.tuple([z.literal("'self'")]),
        mediaSrc: z.tuple([z.literal("'self'"), z.literal('blob:')]),
        manifestSrc: z.tuple([z.literal("'self'")]),
      })
      .strict(),
    headers: z
      .object({
        contentSecurityPolicyMode: z.literal('enforced'),
        crossOriginOpenerPolicy: z.literal('same-origin'),
        crossOriginEmbedderPolicy: z.literal('require-corp'),
        crossOriginResourcePolicy: z.literal('same-origin'),
        originAgentCluster: z.literal('?1'),
        referrerPolicy: z.literal('no-referrer'),
        xContentTypeOptions: z.literal('nosniff'),
      })
      .strict(),
    cachePolicy: z
      .object({
        indexHtmlRevalidated: z.literal(true),
        serviceWorkerRevalidated: z.literal(true),
        catalogPointerRevalidated: z.literal(true),
        hashedAssetMaxAgeSeconds: z.literal(31_536_000),
        hashedAssetsImmutable: z.literal(true),
      })
      .strict(),
    mime: z
      .object({ javascript: z.literal('text/javascript'), wasm: z.literal('application/wasm') })
      .strict(),
    observedOrigins: z.tuple([
      ExactHttpsOriginSchema,
      z.literal('https://huggingface.co'),
      z.literal('https://cas-bridge.xethub.hf.co'),
    ]),
    cspViolationCount: z.literal(0),
    coopCoepViolationCount: z.literal(0),
    corsViolationCount: z.literal(0),
    mixedContentCount: z.literal(0),
    signedRedirectHygiene: z
      .object({
        rawResponseUrlPersistedCount: z.literal(0),
        signedQueryInOpfsCount: z.literal(0),
        signedQueryInCacheStorageCount: z.literal(0),
        signedQueryInHarCount: z.literal(0),
        signedQueryInScreenshotsCount: z.literal(0),
        signedQueryInLogsCount: z.literal(0),
        signedQueryInGitCount: z.literal(0),
        harCaptured: z.literal(false),
        scanReport: ContentArtifactSchema,
      })
      .strict(),
    failure: z.null(),
  })
  .strict();

const HumanReviewSchema = z
  .object({
    status: z.literal('approved'),
    operatorId: ReviewerIdSchema,
    qualificationReviewerId: ReviewerIdSchema,
    independentReviewerId: ReviewerIdSchema,
    reviewedAt: StrictIsoDateTimeSchema,
    exactDiff: z
      .object({
        baseCommit: GitObjectIdSchema,
        headCommit: GitObjectIdSchema,
        diffSha256: Sha256Schema,
      })
      .strict(),
    languageCoverage: z
      .array(
        z
          .object({
            language: z.enum(SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER),
            reviewerId: ReviewerIdSchema,
            competence: z.enum(['native', 'professional', 'fluent']),
          })
          .strict(),
      )
      .length(31),
    runReviewCount: z.literal(42),
    approvedRunReviewCount: z.literal(42),
    findingCount: z.literal(0),
    findings: z.tuple([]),
    decision: z.literal('approved-for-exact-tuple'),
  })
  .strict()
  .superRefine((review, context) => {
    for (const [index, language] of SUPERTONIC_BROWSER_QUALIFICATION_LANGUAGE_ORDER.entries()) {
      if (review.languageCoverage[index]?.language !== language) {
        context.addIssue({
          code: 'custom',
          path: ['languageCoverage', index],
          message: 'Human language review coverage must use the exact canonical order',
        });
      }
    }
    if (
      new Set([review.operatorId, review.qualificationReviewerId, review.independentReviewerId])
        .size !== 3
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Operator, qualification reviewer, and independent reviewer must be distinct',
      });
    }
  });

const PassedDecisionSchema = z.union([
  z
    .object({
      status: z.literal('passed'),
      scope: z.literal('pre-enable'),
      concludedAt: StrictIsoDateTimeSchema,
      terminalFailure: z.null(),
      operationalEnablement: z.object({ allowed: z.literal(false), tupleId: z.null() }).strict(),
    })
    .strict(),
  z
    .object({
      status: z.literal('passed'),
      scope: z.literal('final-enabled'),
      concludedAt: StrictIsoDateTimeSchema,
      terminalFailure: z.null(),
      operationalEnablement: z
        .object({
          allowed: z.literal(true),
          tupleId: z.enum(['chrome-webgpu', 'chrome-wasm', 'edge-webgpu', 'edge-wasm']),
        })
        .strict(),
    })
    .strict(),
]);

const PassedQualificationEvidenceSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal('open-voice-supertonic-browser-qualification-evidence'),
    evidenceId: EvidenceIdSchema,
    qualificationPolicy: QualificationPolicySchema,
    candidate: CandidateSchema,
    testedTuple: TestedTupleSchema,
    environment: EnvironmentSchema,
    consent: ConsentSchema,
    preConsent: PreConsentSchema,
    closure: ClosureSchema,
    storage: StorageSchema,
    wasmSmoke: z.union([PassedWasmSmokeSchema, NotApplicableWasmSmokeSchema]),
    runs: RunsSchema,
    failures: FailuresSchema,
    lifecycle: LifecycleSchema,
    ui: UiSchema,
    build: BuildSchema,
    security: SecuritySchema,
    humanReview: HumanReviewSchema,
    decision: PassedDecisionSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    const tuple = evidence.testedTuple;
    const runtime = SUPERTONIC_RUNTIME_IDENTITIES[tuple.backend];
    const runtimeObservation = evidence.closure.observations[16];
    const emittedRuntime = evidence.build.emittedFiles.find(
      ({ role }) => role === 'selected-runtime-wasm',
    );
    const expectedFailurePassedCount = tuple.backend === 'wasm' ? 12 : 13;
    const expectedFailureNotApplicableCount = tuple.backend === 'wasm' ? 1 : 0;
    const expectedDecisionScope =
      evidence.candidate.qualificationPhase === 'pre-enable-disabled'
        ? 'pre-enable'
        : 'final-enabled';
    const expectedEnablement = expectedDecisionScope === 'final-enabled';
    const reviewerByLanguage = new Map(
      evidence.humanReview.languageCoverage.map(({ language, reviewerId }) => [
        language,
        reviewerId,
      ]),
    );
    const promptOrReviewerMismatch = evidence.runs.rows.some((row, index) => {
      const fixture = evidence.runs.promptSet.fixtures[index];
      const expectedReviewer = reviewerByLanguage.get(row.language);
      return (
        fixture === undefined ||
        fixture.reviewerId !== expectedReviewer ||
        row.review.reviewerId !== expectedReviewer
      );
    });
    const crossGateMismatch =
      evidence.environment.pageOrigin !== evidence.candidate.deployment.immutableUrl ||
      evidence.environment.cpu.architecture !== tuple.os.architecture ||
      evidence.environment.runtime.requestedExecutionProvider !== tuple.backend ||
      evidence.environment.runtime.observedExecutionProvider !== tuple.backend ||
      evidence.environment.webgpu.status !==
        (tuple.backend === 'wasm' ? 'not-requested' : 'passed') ||
      evidence.consent.selectionId !== tuple.selectionId ||
      evidence.consent.selectionDigest !== tuple.selectionDigest ||
      evidence.candidate.promptSetId !== evidence.runs.promptSet.promptSetId ||
      evidence.candidate.promptSetManifestSha256 !== evidence.runs.promptSet.manifestSha256 ||
      evidence.candidate.promptSetBytes !== evidence.runs.promptSet.bytes ||
      evidence.closure.runtimeBytes !== tuple.runtimeBytes ||
      evidence.closure.selectedBytes !== evidence.storage.selectedBytes ||
      evidence.storage.modelBytes !== evidence.closure.modelBytes ||
      evidence.storage.runtimeBytes !== evidence.closure.runtimeBytes ||
      evidence.failures.cases[5].artifactId !== runtime.artifactId ||
      evidence.failures.passedCount !== expectedFailurePassedCount ||
      evidence.failures.notApplicableCount !== expectedFailureNotApplicableCount ||
      evidence.build.sourceCommit !== evidence.candidate.gitCommit ||
      evidence.build.sourceTree !== evidence.candidate.gitTree ||
      evidence.build.emittedGraphSha256 !== evidence.candidate.buildDigest ||
      evidence.security.observedOrigins[0] !== evidence.environment.pageOrigin ||
      evidence.ui.filename !== evidence.runs.rows[6]?.audio.filename ||
      promptOrReviewerMismatch ||
      evidence.humanReview.operatorId !== evidence.candidate.operatorId ||
      evidence.humanReview.exactDiff.headCommit !== evidence.candidate.gitCommit ||
      evidence.decision.scope !== expectedDecisionScope ||
      evidence.decision.operationalEnablement.allowed !== expectedEnablement ||
      (expectedEnablement && evidence.candidate.preEnableEvidence?.tupleId !== tuple.tupleId) ||
      (expectedEnablement && evidence.decision.operationalEnablement.tupleId !== tuple.tupleId) ||
      (!expectedEnablement && evidence.decision.operationalEnablement.tupleId !== null);
    if (crossGateMismatch) {
      context.addIssue({
        code: 'custom',
        message:
          'Passing gates are not bound to one exact candidate, tuple, deployment, and decision',
      });
    }
    if (
      runtimeObservation?.kind !== 'runtime' ||
      runtimeObservation.artifactId !== runtime.artifactId ||
      runtimeObservation.expectedSha256 !== runtime.sha256 ||
      runtimeObservation.observedSha256 !== runtime.sha256 ||
      runtimeObservation.expectedBytes !== runtime.byteLength ||
      runtimeObservation.observedBytes !== runtime.byteLength ||
      runtimeObservation.mediaType !== runtime.mediaType ||
      runtimeObservation.finalOrigin !== evidence.environment.pageOrigin ||
      runtimeObservation.networkTransferBytes !== runtime.byteLength ||
      emittedRuntime === undefined ||
      emittedRuntime.sha256 !== runtime.sha256 ||
      emittedRuntime.bytes !== runtime.byteLength ||
      runtimeObservation.cacheKey !== emittedRuntime.path ||
      runtimeObservation.requestUrl !== `${evidence.environment.pageOrigin}/${emittedRuntime.path}`
    ) {
      context.addIssue({
        code: 'custom',
        path: ['closure', 'observations', 16],
        message: 'Runtime closure observation is not exact for the selected tuple and build',
      });
    }
    if (
      (tuple.tupleId === 'chrome-wasm' && evidence.wasmSmoke.status !== 'passed') ||
      (tuple.tupleId !== 'chrome-wasm' && evidence.wasmSmoke.status !== 'not-applicable')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['wasmSmoke'],
        message: 'The extended smoke run is required only for the Chrome/WASM tuple',
      });
    }
    if (evidence.wasmSmoke.status === 'passed') {
      const smokePrompt = evidence.runs.promptSet.fixtures[6];
      if (
        smokePrompt === undefined ||
        evidence.wasmSmoke.promptTextSha256 !== smokePrompt.promptTextSha256
      ) {
        context.addIssue({
          code: 'custom',
          path: ['wasmSmoke', 'promptTextSha256'],
          message: 'WASM smoke must bind the reviewed M1 English prompt row',
        });
      }
    }
  });

const QUALIFICATION_GATE_ORDER = [
  'build',
  'security',
  'environment',
  'consent',
  'pre-consent',
  'closure',
  'storage',
  'wasm-smoke',
  'runs',
  'failures',
  'lifecycle',
  'ui',
  'human-review',
] as const;
const QualificationGateIdSchema = z.enum(QUALIFICATION_GATE_ORDER);
const QUALIFICATION_FAILURE_REASON_BY_GATE = {
  build: 'build-gate-failed',
  security: 'security-gate-failed',
  environment: 'environment-gate-failed',
  consent: 'consent-gate-failed',
  'pre-consent': 'preconsent-inference-io',
  closure: 'closure-gate-failed',
  storage: 'storage-gate-failed',
  'wasm-smoke': 'wasm-smoke-failed',
  runs: 'positive-run-failed',
  failures: 'negative-case-failed',
  lifecycle: 'lifecycle-gate-failed',
  ui: 'ui-gate-failed',
  'human-review': 'independent-review-rejected',
} as const satisfies Record<
  (typeof QUALIFICATION_GATE_ORDER)[number],
  z.infer<typeof FailureSchema>['reasonCode']
>;

const FailedQualificationEvidenceSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal('open-voice-supertonic-browser-qualification-evidence'),
    evidenceId: EvidenceIdSchema,
    qualificationPolicy: QualificationPolicySchema,
    candidate: CandidateSchema,
    testedTuple: TestedTupleSchema,
    attempt: z
      .object({
        status: z.literal('failed'),
        startedAt: StrictIsoDateTimeSchema,
        stoppedAt: StrictIsoDateTimeSchema,
        completedGates: z.array(
          z
            .object({
              gateId: QualificationGateIdSchema,
              status: z.literal('passed'),
              evidence: ContentArtifactSchema,
            })
            .strict(),
        ),
        failedGate: z
          .object({
            gateId: QualificationGateIdSchema,
            status: z.literal('failed'),
            failure: FailureSchema,
            evidence: ContentArtifactSchema,
          })
          .strict(),
      })
      .strict(),
    decision: z
      .object({
        status: z.literal('failed'),
        scope: z.literal('qualification-attempt'),
        concludedAt: StrictIsoDateTimeSchema,
        terminalFailure: FailureSchema,
        operationalEnablement: z.object({ allowed: z.literal(false), tupleId: z.null() }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const failedIndex = QUALIFICATION_GATE_ORDER.indexOf(evidence.attempt.failedGate.gateId);
    const exactPrefix = QUALIFICATION_GATE_ORDER.slice(0, failedIndex);
    const completedIds = evidence.attempt.completedGates.map(({ gateId }) => gateId);
    if (
      completedIds.length !== exactPrefix.length ||
      completedIds.some((gateId, index) => gateId !== exactPrefix[index]) ||
      evidence.attempt.failedGate.failure.gateId !== evidence.attempt.failedGate.gateId ||
      evidence.attempt.failedGate.failure.reasonCode !==
        QUALIFICATION_FAILURE_REASON_BY_GATE[evidence.attempt.failedGate.gateId] ||
      evidence.decision.terminalFailure.failureId !==
        evidence.attempt.failedGate.failure.failureId ||
      evidence.decision.terminalFailure.gateId !== evidence.attempt.failedGate.failure.gateId ||
      evidence.decision.terminalFailure.reasonCode !==
        evidence.attempt.failedGate.failure.reasonCode ||
      evidence.decision.terminalFailure.observedAt !==
        evidence.attempt.failedGate.failure.observedAt ||
      evidence.decision.terminalFailure.traceSequence !==
        evidence.attempt.failedGate.failure.traceSequence ||
      evidence.decision.terminalFailure.messageSha256 !==
        evidence.attempt.failedGate.failure.messageSha256
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Failed qualification must record the exact completed prefix and one terminal gate',
      });
    }
  });

export const SupertonicBrowserQualificationEvidenceV2Schema = z.union([
  PassedQualificationEvidenceSchema,
  FailedQualificationEvidenceSchema,
]);

export type SupertonicBrowserQualificationEvidenceV2 = z.infer<
  typeof SupertonicBrowserQualificationEvidenceV2Schema
>;
