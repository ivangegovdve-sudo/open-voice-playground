import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID,
  SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256,
  loadSupertonicBrowserQualificationPromptSet,
  parseSupertonicBrowserQualificationPromptCliMode,
  stableStringifySupertonicBrowserQualificationPromptSet,
  validateSupertonicBrowserQualificationPromptSet,
} from '../src/supertonic-browser-qualification-prompts.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const promptSetPath = join(
  packageRoot,
  'data',
  'supertonic-browser-qualification-prompts.public.json',
);
const integrityPath = join(
  packageRoot,
  'data',
  'supertonic-browser-qualification-prompts.integrity.json',
);
const temporaryDirectories: string[] = [];

const EXPECTED_PRIMARY_LANGUAGES = [
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

const EXPECTED_TRAILING_ROWS = [
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

const ENGLISH_PROMPT = 'Morning light fills the quiet garden, and small birds begin to sing.';
const JAPANESE_PROMPT = '朝の光が静かな庭を満たし、小鳥が歌い始めます。';
const ARABIC_PROMPT = 'يملأ ضوء الصباح الحديقة الهادئة، وتبدأ الطيور الصغيرة بالغناء.';

type MutablePromptRow = {
  rowId: string;
  voiceId: string;
  language: string;
  promptText: string;
  promptSha256: string;
  speechUnitMethod: string;
  speechUnitCount: number;
  speechUnitReviewStatus: string;
  minSampleFrames: number;
  maxSampleFrames: number;
  requiredReviewerLanguage: string;
  [key: string]: unknown;
};

type MutablePromptSet = {
  schemaVersion: number;
  kind: string;
  promptSetId: string;
  rows: MutablePromptRow[];
  [key: string]: unknown;
};

async function temporaryPaths(): Promise<{
  directory: string;
  promptSetPath: string;
  integrityPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'open-voice-supertonic-prompts-'));
  temporaryDirectories.push(directory);
  return {
    directory,
    promptSetPath: join(directory, 'prompts.json'),
    integrityPath: join(directory, 'integrity.json'),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Supertonic browser qualification prompt set', () => {
  it('accepts only one exact read-only CLI check mode', () => {
    expect(parseSupertonicBrowserQualificationPromptCliMode(['--check'])).toBe('check');
    for (const arguments_ of [[], ['--write'], ['--check', '--write'], ['--unknown']]) {
      expect(() => parseSupertonicBrowserQualificationPromptCliMode(arguments_)).toThrow(
        /exactly one.*--check/i,
      );
    }
  });

  it('loads the exact immutable canonical fixture and integrity sidecar', async () => {
    const [actualBytes, actualIntegrity, promptSet] = await Promise.all([
      readFile(promptSetPath, 'utf8'),
      readFile(integrityPath, 'utf8'),
      loadSupertonicBrowserQualificationPromptSet(),
    ]);

    expect(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_ID).toBe(
      'pset:f80986ed67b59f520dc958cfb6730935',
    );
    expect(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256).toBe(
      'sha256:1c94e0a39e61e5e13316a56a6c2cf9fdecd46225a30f8b65b5cb852c07e6d284',
    );
    expect(SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES).toBe(24_581);
    expect(actualBytes).toBe(stableStringifySupertonicBrowserQualificationPromptSet(promptSet));
    expect(Buffer.byteLength(actualBytes, 'utf8')).toBe(
      SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
    );
    expect(`sha256:${createHash('sha256').update(actualBytes, 'utf8').digest('hex')}`).toBe(
      SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256,
    );
    expect(actualIntegrity).toBe(
      `${JSON.stringify(
        {
          sha256: SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_SHA256,
          bytes: SUPERTONIC_BROWSER_QUALIFICATION_PROMPT_SET_BYTES,
        },
        null,
        2,
      )}\n`,
    );
    expect(Object.isFrozen(promptSet)).toBe(true);
    expect(Object.isFrozen(promptSet.rows)).toBe(true);
    expect(Object.isFrozen(promptSet.rows[0])).toBe(true);
  });

  it('freezes the exact 31-language M1 prefix and 11-row style suffix in canonical order', async () => {
    const promptSet = await loadSupertonicBrowserQualificationPromptSet();
    const expectedRows = [
      ...EXPECTED_PRIMARY_LANGUAGES.map((language, index) => ({
        rowId: `supertonic-q${String(index + 1).padStart(2, '0')}-m1-${language}`,
        voiceId: 'supertonic:M1',
        language,
      })),
      ...EXPECTED_TRAILING_ROWS.map(([voice, language], index) => ({
        rowId: `supertonic-q${String(index + 32).padStart(2, '0')}-${voice.toLowerCase()}-${language}`,
        voiceId: `supertonic:${voice}`,
        language,
      })),
    ];

    expect(promptSet.rows).toHaveLength(42);
    expect(
      promptSet.rows.map(({ rowId, voiceId, language }) => ({ rowId, voiceId, language })),
    ).toEqual(expectedRows);

    const voiceCounts = Object.fromEntries(
      [...new Set(promptSet.rows.map(({ voiceId }) => voiceId))].map((voiceId) => [
        voiceId,
        promptSet.rows.filter((row) => row.voiceId === voiceId).length,
      ]),
    );
    expect(voiceCounts).toEqual({
      'supertonic:M1': 31,
      'supertonic:F1': 3,
      'supertonic:F2': 1,
      'supertonic:F3': 1,
      'supertonic:F4': 1,
      'supertonic:F5': 1,
      'supertonic:M2': 1,
      'supertonic:M3': 1,
      'supertonic:M4': 1,
      'supertonic:M5': 1,
    });
  });

  it('uses one shared English style prompt and exact Japanese and Arabic M1/F1 pairs', async () => {
    const { rows } = await loadSupertonicBrowserQualificationPromptSet();
    const englishRows = rows.filter(({ language }) => language === 'en');
    const japaneseRows = rows.filter(({ language }) => language === 'ja');
    const arabicRows = rows.filter(({ language }) => language === 'ar');

    expect(englishRows).toHaveLength(10);
    expect(new Set(englishRows.map(({ voiceId }) => voiceId))).toEqual(
      new Set([
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
    );
    expect(englishRows.every(({ promptText }) => promptText === ENGLISH_PROMPT)).toBe(true);
    const promptBinding = ({
      promptText,
      promptSha256,
      speechUnitMethod,
      speechUnitCount,
      speechUnitReviewStatus,
      minSampleFrames,
      maxSampleFrames,
    }: (typeof rows)[number]) => ({
      promptText,
      promptSha256,
      speechUnitMethod,
      speechUnitCount,
      speechUnitReviewStatus,
      minSampleFrames,
      maxSampleFrames,
    });
    expect(englishRows.map(promptBinding)).toEqual(
      Array.from({ length: 10 }, () => promptBinding(englishRows[0]!)),
    );
    expect(japaneseRows.map(promptBinding)).toEqual([
      promptBinding(japaneseRows[0]!),
      promptBinding(japaneseRows[0]!),
    ]);
    expect(japaneseRows[0]?.promptText).toBe(JAPANESE_PROMPT);
    expect(arabicRows.map(promptBinding)).toEqual([
      promptBinding(arabicRows[0]!),
      promptBinding(arabicRows[0]!),
    ]);
    expect(arabicRows[0]?.promptText).toBe(ARABIC_PROMPT);
  });

  it('binds every candidate prompt to matching language-competent review without claiming approval', async () => {
    const promptSet = await loadSupertonicBrowserQualificationPromptSet();
    const languageCounts = Object.fromEntries(
      EXPECTED_PRIMARY_LANGUAGES.map((language) => [
        language,
        promptSet.rows.filter((row) => row.language === language).length,
      ]),
    );

    expect(languageCounts).toEqual({
      ar: 2,
      bg: 1,
      hr: 1,
      cs: 1,
      da: 1,
      nl: 1,
      en: 10,
      et: 1,
      fi: 1,
      fr: 1,
      de: 1,
      el: 1,
      hi: 1,
      hu: 1,
      id: 1,
      it: 1,
      ja: 2,
      ko: 1,
      lv: 1,
      lt: 1,
      pl: 1,
      pt: 1,
      ro: 1,
      ru: 1,
      sk: 1,
      sl: 1,
      es: 1,
      sv: 1,
      tr: 1,
      uk: 1,
      vi: 1,
    });
    expect(
      promptSet.rows.every(
        ({ language, requiredReviewerLanguage }) => language === requiredReviewerLanguage,
      ),
    ).toBe(true);
    for (const row of promptSet.rows) {
      const expectedUnits = row.language === 'ja' ? 14 : row.promptText.trim().split(/\s+/u).length;
      expect(row.promptSha256, row.rowId).toBe(
        `sha256:${createHash('sha256').update(row.promptText, 'utf8').digest('hex')}`,
      );
      expect(row.speechUnitMethod, row.rowId).toBe(
        row.language === 'ja' ? 'manual-japanese-lexical-v1' : 'unicode-whitespace-token-count-v1',
      );
      expect(row.speechUnitCount, row.rowId).toBe(expectedUnits);
      expect(row.speechUnitReviewStatus, row.rowId).toBe('candidate-pending-language-review');
      expect(row.minSampleFrames, row.rowId).toBe(Math.max(15_435, 7_350 * expectedUnits));
      expect(row.maxSampleFrames, row.rowId).toBe(
        Math.min(7_938_000, 88_200 + 58_800 * expectedUnits),
      );
    }
    expect(
      promptSet.rows.every(
        ({ promptText }) =>
          promptText === promptText.normalize('NFC') &&
          promptText === promptText.trim() &&
          [...promptText].every((character) => {
            const codePoint = character.codePointAt(0)!;
            return (
              codePoint !== 0xfffd &&
              codePoint !== 0x2028 &&
              codePoint !== 0x2029 &&
              codePoint > 0x1f &&
              !(codePoint >= 0x7f && codePoint <= 0x9f) &&
              !(codePoint >= 0xd800 && codePoint <= 0xdfff)
            );
          }) &&
          !/(?:https?:\/\/|www\.|x-amz-|credential|secret|[a-z]:\\|\/home\/|<[^>]*>)/iu.test(
            promptText,
          ),
      ),
    ).toBe(true);
    expect(promptSet.rows.every(({ promptText }) => !promptText.includes('?'))).toBe(true);
    expect(promptSet.rows.find(({ language }) => language === 'ar')?.promptText).toMatch(
      /[\u0600-\u06ff]/u,
    );
    expect(promptSet.rows.find(({ language }) => language === 'hi')?.promptText).toMatch(
      /[\u0900-\u097f]/u,
    );
    expect(promptSet.rows.find(({ language }) => language === 'ja')?.promptText).toMatch(
      /[\u3040-\u30ff\u4e00-\u9fff]/u,
    );
    expect(promptSet.rows.find(({ language }) => language === 'ko')?.promptText).toMatch(
      /[\uac00-\ud7af]/u,
    );
    expect(JSON.stringify(promptSet)).not.toMatch(/approved|reviewedAt|reviewerId/);
  });

  it('rejects row, order, text, reviewer, normalization, and unknown-field drift', async () => {
    const promptSet = await loadSupertonicBrowserQualificationPromptSet();
    const mutations: MutablePromptSet[] = [];

    const wrongRow = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongRow.rows[0]!.rowId = 'supertonic-q01-m1-bg';
    mutations.push(wrongRow);

    const reordered = structuredClone(promptSet) as unknown as MutablePromptSet;
    [reordered.rows[0], reordered.rows[1]] = [reordered.rows[1]!, reordered.rows[0]!];
    mutations.push(reordered);

    const changedText = structuredClone(promptSet) as unknown as MutablePromptSet;
    changedText.rows[6]!.promptText = `${changedText.rows[6]!.promptText}!`;
    mutations.push(changedText);

    const wrongPromptHash = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongPromptHash.rows[6]!.promptSha256 = `sha256:${'0'.repeat(64)}`;
    mutations.push(wrongPromptHash);

    const wrongUnitCount = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongUnitCount.rows[6]!.speechUnitCount += 1;
    mutations.push(wrongUnitCount);

    const wrongMinimum = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongMinimum.rows[6]!.minSampleFrames += 1;
    mutations.push(wrongMinimum);

    const wrongMaximum = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongMaximum.rows[6]!.maxSampleFrames += 1;
    mutations.push(wrongMaximum);

    const wrongReviewer = structuredClone(promptSet) as unknown as MutablePromptSet;
    wrongReviewer.rows[16]!.requiredReviewerLanguage = 'en';
    mutations.push(wrongReviewer);

    const nonNfc = structuredClone(promptSet) as unknown as MutablePromptSet;
    nonNfc.rows[9]!.promptText = nonNfc.rows[9]!.promptText.normalize('NFD');
    mutations.push(nonNfc);

    const extraField = structuredClone(promptSet) as unknown as MutablePromptSet;
    extraField.rows[0]!.approved = true;
    mutations.push(extraField);

    for (const mutation of mutations) {
      expect(() => validateSupertonicBrowserQualificationPromptSet(mutation)).toThrow();
    }
  });

  it.each([
    ['replacement character', '\uFFFD'],
    ['unpaired surrogate', String.fromCharCode(0xd800)],
    ['C1 control', '\u0085'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
  ])('rejects a %s before whole-fixture integrity validation', async (_label, unsafe) => {
    const promptSet = structuredClone(
      await loadSupertonicBrowserQualificationPromptSet(),
    ) as unknown as MutablePromptSet;
    const row = promptSet.rows[1]!;
    const insertionOffset = Math.floor(row.promptText.length / 2);
    row.promptText = `${row.promptText.slice(0, insertionOffset)}${unsafe}${row.promptText.slice(insertionOffset)}`;
    row.promptSha256 = `sha256:${createHash('sha256').update(row.promptText, 'utf8').digest('hex')}`;
    row.speechUnitCount = row.promptText.trim().split(/\s+/u).length;
    row.minSampleFrames = Math.max(15_435, 7_350 * row.speechUnitCount);
    row.maxSampleFrames = Math.min(7_938_000, 88_200 + 58_800 * row.speechUnitCount);

    expect(() => validateSupertonicBrowserQualificationPromptSet(promptSet)).toThrow(
      /valid printable Unicode|single line/i,
    );
  });

  it('fails closed on missing, malformed, noncanonical, and integrity-drifted files', async () => {
    const paths = await temporaryPaths();
    await expect(loadSupertonicBrowserQualificationPromptSet(paths)).rejects.toThrow();

    await Promise.all([
      writeFile(paths.promptSetPath, '{', 'utf8'),
      writeFile(paths.integrityPath, '{}\n', 'utf8'),
    ]);
    await expect(loadSupertonicBrowserQualificationPromptSet(paths)).rejects.toThrow(/parse|json/i);

    const [canonical, integrity] = await Promise.all([
      readFile(promptSetPath, 'utf8'),
      readFile(integrityPath, 'utf8'),
    ]);
    await Promise.all([
      writeFile(paths.promptSetPath, `${canonical}\n`, 'utf8'),
      writeFile(paths.integrityPath, integrity, 'utf8'),
    ]);
    await expect(loadSupertonicBrowserQualificationPromptSet(paths)).rejects.toThrow(
      /canonical|integrity|bytes|hash/i,
    );

    await Promise.all([
      writeFile(paths.promptSetPath, canonical, 'utf8'),
      writeFile(paths.integrityPath, integrity.replace('24581', '24582'), 'utf8'),
    ]);
    await expect(loadSupertonicBrowserQualificationPromptSet(paths)).rejects.toThrow(
      /integrity|bytes|hash/i,
    );
  });
});
