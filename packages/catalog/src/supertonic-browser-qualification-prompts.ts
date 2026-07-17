import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPERTONIC_LANGUAGES, SUPERTONIC_VOICE_IDS } from '@open-voice/contracts';
import { z } from 'zod';

export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID =
  'pset:f80986ed67b59f520dc958cfb6730935' as const;
export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256 =
  'sha256:1c94e0a39e61e5e13316a56a6c2cf9fdecd46225a30f8b65b5cb852c07e6d284' as const;
export const SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES = 24_581 as const;

// These bytes are a deterministic project-authored candidate set. Language review and approval
// belong to later qualification evidence and are deliberately not represented by this fixture.

const PROMPT_SET_KIND = 'open-voice-supertonic-browser-qualification-prompt-set' as const;
const PRIMARY_LANGUAGE_ORDER = [
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
] as const;
const TRAILING_ROWS = [
  ['F1', 'en'],
  ['F1', 'ja'],
  ['F1', 'ar'],
  ['F2', 'en'],
  ['F3', 'en'],
  ['F4', 'en'],
  ['F5', 'en'],
  ['M2', 'en'],
  ['M3', 'en'],
  ['M4', 'en'],
  ['M5', 'en'],
] as const;

const expectedRows = [
  ...PRIMARY_LANGUAGE_ORDER.map((language, index) => ({
    rowId: `supertonic-q${String(index + 1).padStart(2, '0')}-m1-${language}`,
    voiceId: 'supertonic:M1',
    language,
  })),
  ...TRAILING_ROWS.map(([voice, language], index) => ({
    rowId: `supertonic-q${String(index + 32).padStart(2, '0')}-${voice.toLowerCase()}-${language}`,
    voiceId: `supertonic:${voice}`,
    language,
  })),
] as const;

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultPaths = {
  promptSetPath: resolve(
    packageRoot,
    'data',
    'supertonic-browser-qualification-prompts.public.json',
  ),
  integrityPath: resolve(
    packageRoot,
    'data',
    'supertonic-browser-qualification-prompts.integrity.json',
  ),
} as const;

const LanguageSchema = z.enum(SUPERTONIC_LANGUAGES);
const VoiceIdSchema = z.enum(SUPERTONIC_VOICE_IDS);
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CandidatePromptTextSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value === value.trim(), 'Candidate prompt must not have outer whitespace')
  .refine((value) => value === value.normalize('NFC'), 'Candidate prompt must use NFC Unicode')
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0)!;
        return (
          codePoint !== 0xfffd &&
          codePoint !== 0x2028 &&
          codePoint !== 0x2029 &&
          codePoint > 0x1f &&
          !(codePoint >= 0x7f && codePoint <= 0x9f) &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        );
      }),
    'Candidate prompt must contain valid printable Unicode on a single line',
  )
  .refine(
    (value) =>
      !/(?:https?:\/\/|www\.|x-amz-|credential|secret|[a-z]:\\|\/home\/|<[^>]*>)/iu.test(value),
    'Candidate prompt must not contain URLs, markup, credentials, secrets, or machine paths',
  );

const PromptRowSchema = z
  .object({
    rowId: z.string().regex(/^supertonic-q(?:0[1-9]|[1-3][0-9]|4[0-2])-[fm][1-5]-[a-z]{2}$/),
    voiceId: VoiceIdSchema,
    language: LanguageSchema,
    promptText: CandidatePromptTextSchema,
    promptSha256: Sha256Schema,
    speechUnitMethod: z.enum(['unicode-whitespace-token-count-v1', 'manual-japanese-lexical-v1']),
    speechUnitCount: z.number().int().min(1).max(1_080),
    speechUnitReviewStatus: z.literal('candidate-pending-language-review'),
    minSampleFrames: z.number().int().positive().safe(),
    maxSampleFrames: z.number().int().positive().safe(),
    requiredReviewerLanguage: LanguageSchema,
  })
  .strict()
  .superRefine((row, context) => {
    if (row.requiredReviewerLanguage !== row.language) {
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewerLanguage'],
        message: 'Candidate prompt review must require the exact prompt language',
      });
    }
    if (row.promptSha256 !== sha256(row.promptText)) {
      context.addIssue({
        code: 'custom',
        path: ['promptSha256'],
        message: 'Candidate prompt hash must bind the exact UTF-8 prompt bytes',
      });
    }
    const expectedMethod =
      row.language === 'ja' ? 'manual-japanese-lexical-v1' : 'unicode-whitespace-token-count-v1';
    const expectedUnits = row.language === 'ja' ? 14 : row.promptText.trim().split(/\s+/u).length;
    if (row.speechUnitMethod !== expectedMethod || row.speechUnitCount !== expectedUnits) {
      context.addIssue({
        code: 'custom',
        path: ['speechUnitCount'],
        message: 'Candidate speech-unit method or count drifted',
      });
    }
    if (
      row.minSampleFrames !== Math.max(15_435, 7_350 * expectedUnits) ||
      row.maxSampleFrames !== Math.min(7_938_000, 88_200 + 58_800 * expectedUnits)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minSampleFrames'],
        message: 'Candidate prompt-relative sample-frame bounds drifted',
      });
    }
  })
  .readonly();

const PromptSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(PROMPT_SET_KIND),
    promptSetId: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID),
    rows: z.array(PromptRowSchema).length(42).readonly(),
  })
  .strict()
  .superRefine((promptSet, context) => {
    for (const [index, expected] of expectedRows.entries()) {
      const actual = promptSet.rows[index];
      if (
        actual?.rowId !== expected.rowId ||
        actual.voiceId !== expected.voiceId ||
        actual.language !== expected.language
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Qualification prompt row identity or order drifted',
        });
      }
    }

    const primaryPromptByLanguage = new Map(
      promptSet.rows.slice(0, PRIMARY_LANGUAGE_ORDER.length).map((row) => [row.language, row]),
    );
    for (const [index, row] of promptSet.rows.entries()) {
      if (index < PRIMARY_LANGUAGE_ORDER.length) continue;
      const primary = primaryPromptByLanguage.get(row.language);
      if (
        primary === undefined ||
        row.promptText !== primary.promptText ||
        row.promptSha256 !== primary.promptSha256 ||
        row.speechUnitMethod !== primary.speechUnitMethod ||
        row.speechUnitCount !== primary.speechUnitCount ||
        row.speechUnitReviewStatus !== primary.speechUnitReviewStatus ||
        row.minSampleFrames !== primary.minSampleFrames ||
        row.maxSampleFrames !== primary.maxSampleFrames
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index, 'promptText'],
          message: 'Style rows must reuse the exact primary-language candidate prompt bytes',
        });
      }
    }
  })
  .readonly();

const IntegrityRecordSchema = z
  .object({
    sha256: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256),
    bytes: z.literal(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES),
  })
  .strict();

export type SupertonicBrowserQualificationPromptRow = z.infer<typeof PromptRowSchema>;
export type SupertonicBrowserQualificationPromptSet = z.infer<typeof PromptSetSchema>;

export type SupertonicBrowserQualificationPromptPaths = {
  promptSetPath: string;
  integrityPath: string;
};

export class SupertonicBrowserQualificationPromptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupertonicBrowserQualificationPromptValidationError';
  }
}

function sha256(bytes: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`;
}

function schemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'promptSet'}: ${issue.message}`)
    .join('; ');
}

function parsePromptSetStructure(input: unknown): SupertonicBrowserQualificationPromptSet {
  const parsed = PromptSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new SupertonicBrowserQualificationPromptValidationError(
      `Supertonic qualification prompt schema failed: ${schemaIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

function parseJson(bytes: string, label: string): unknown {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new SupertonicBrowserQualificationPromptValidationError(
      `Unable to parse Supertonic qualification ${label} JSON`,
    );
  }
}

export function stableStringifySupertonicBrowserQualificationPromptSet(
  input: SupertonicBrowserQualificationPromptSet,
): string {
  return `${JSON.stringify(parsePromptSetStructure(input), null, 2)}\n`;
}

export function validateSupertonicBrowserQualificationPromptSet(
  input: unknown,
): SupertonicBrowserQualificationPromptSet {
  const promptSet = parsePromptSetStructure(input);
  const canonical = stableStringifySupertonicBrowserQualificationPromptSet(promptSet);
  if (
    Buffer.byteLength(canonical, 'utf8') !== SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES ||
    sha256(canonical) !== SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256
  ) {
    throw new SupertonicBrowserQualificationPromptValidationError(
      'Supertonic qualification prompt set drifted from the frozen candidate bytes',
    );
  }
  return promptSet;
}

export async function loadSupertonicBrowserQualificationPromptSet(
  paths: SupertonicBrowserQualificationPromptPaths = defaultPaths,
): Promise<SupertonicBrowserQualificationPromptSet> {
  const [actual, actualIntegrity] = await Promise.all([
    readFile(paths.promptSetPath, 'utf8'),
    readFile(paths.integrityPath, 'utf8'),
  ]);
  const promptSet = validateSupertonicBrowserQualificationPromptSet(
    parseJson(actual, 'prompt set'),
  );
  const parsedIntegrity = IntegrityRecordSchema.safeParse(
    parseJson(actualIntegrity, 'prompt integrity'),
  );
  if (!parsedIntegrity.success) {
    throw new SupertonicBrowserQualificationPromptValidationError(
      `Supertonic qualification prompt integrity failed: ${schemaIssues(parsedIntegrity.error)}`,
    );
  }

  const expected = stableStringifySupertonicBrowserQualificationPromptSet(promptSet);
  const expectedIntegrity = `${JSON.stringify(parsedIntegrity.data, null, 2)}\n`;
  if (
    actual !== expected ||
    actualIntegrity !== expectedIntegrity ||
    Buffer.byteLength(actual, 'utf8') !== SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES ||
    sha256(actual) !== SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256
  ) {
    throw new SupertonicBrowserQualificationPromptValidationError(
      'Supertonic qualification prompt bytes or integrity sidecar are noncanonical',
    );
  }
  return promptSet;
}

export function parseSupertonicBrowserQualificationPromptCliMode(
  arguments_: readonly string[],
): 'check' {
  if (arguments_.length !== 1 || arguments_[0] !== '--check') {
    throw new SupertonicBrowserQualificationPromptValidationError(
      'Expected exactly one Supertonic qualification prompt mode: --check',
    );
  }
  return 'check';
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  parseSupertonicBrowserQualificationPromptCliMode(process.argv.slice(2));
  await loadSupertonicBrowserQualificationPromptSet();
  process.stdout.write(
    `Supertonic qualification prompt bytes and integrity are canonical: ${defaultPaths.promptSetPath}\n`,
  );
}
