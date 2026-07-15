import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import * as contracts from '../src/index.js';

const api = contracts as Record<string, unknown>;

function schema(name: string): ZodType {
  expect(api[name], `${name} should be exported`).toBeDefined();
  return api[name] as ZodType;
}

const licenseRecord = {
  id: 'fixture-code-license',
  scope: 'code',
  name: 'MIT License',
  spdxId: 'MIT',
  evidenceUrl: 'https://opensource.org/license/mit',
  attribution: 'Fixture author',
  permitsRedistribution: true,
  permitsCommercialUse: true,
  reviewedAt: '2026-07-15T00:00:00.000Z',
  reviewStatus: 'verified',
};

const sourceRecord = {
  id: 'fixture-browser-source',
  canonicalUrl: 'https://example.invalid/fixture-browser',
  sourceClass: 'official-repository',
  upstreamRevision: 'fixture-v1',
  retrievedAt: '2026-07-15T00:00:00.000Z',
  lastVerifiedAt: '2026-07-15T00:00:00.000Z',
  health: 'healthy',
};

const engineManifest = {
  id: 'fixture-browser',
  displayName: 'Fixture Browser Engine',
  classification: 'open-weight-local',
  runtimeModes: ['browser'],
  languageTags: ['en-US'],
  licenseIds: ['fixture-code-license'],
  sourceIds: ['fixture-browser-source'],
};

const voicePreset = {
  id: 'fixture-browser:voice-a',
  engineId: 'fixture-browser',
  upstreamId: 'voice-a',
  displayName: 'Fixture Voice A',
  locale: 'en-US',
  gender: 'unspecified',
  runtimeModes: ['browser'],
  styleTags: ['neutral'],
  licenseIds: ['fixture-code-license'],
  sourceIds: ['fixture-browser-source'],
};

const sampleManifest = {
  id: 'fixture-browser:sample-a',
  engineId: 'fixture-browser',
  voiceId: 'fixture-browser:voice-a',
  transcript: 'A deterministic fixture sample.',
  locale: 'en-US',
  durationSeconds: 1.5,
  officialAudioUrl: 'https://example.invalid/fixture-browser/sample-a.wav',
  officialPageUrl: 'https://example.invalid/fixture-browser/demo',
  licenseId: 'fixture-code-license',
  sourceId: 'fixture-browser-source',
  verifiedAt: '2026-07-15T00:00:00.000Z',
};

describe('runtime and identity contracts', () => {
  it('exposes exactly the four canonical runtime modes', () => {
    expect(api.RUNTIME_MODES, 'RUNTIME_MODES should be exported').toEqual([
      'browser',
      'online',
      'companion',
      'sample-only',
    ]);

    const runtimeModeSchema = schema('RuntimeModeSchema');
    for (const mode of ['browser', 'online', 'companion', 'sample-only']) {
      expect(runtimeModeSchema.safeParse(mode).success).toBe(true);
    }
    for (const mode of ['desktop', 'sample', 'local', 'browser-only']) {
      expect(runtimeModeSchema.safeParse(mode).success).toBe(false);
    }
  });

  it('accepts only stable engine-prefixed preset IDs', () => {
    const stableIdSchema = schema('StableIdSchema');

    expect(stableIdSchema.safeParse('kokoro:af-heart').success).toBe(true);
    expect(stableIdSchema.safeParse('edge:en-US-AvaNeural').success).toBe(true);
    expect(stableIdSchema.safeParse('missing-prefix').success).toBe(false);
    expect(stableIdSchema.safeParse('Kokoro:af-heart').success).toBe(false);
    expect(stableIdSchema.safeParse('kokoro:../../voice').success).toBe(false);
    expect(stableIdSchema.safeParse('kokoro:voice:variant').success).toBe(false);
  });

  it('validates BCP-47 language tags', () => {
    const languageTagSchema = schema('Bcp47LanguageTagSchema');

    for (const tag of ['en', 'en-US', 'zh-Hant-TW', 'bg-BG']) {
      expect(languageTagSchema.safeParse(tag).success).toBe(true);
    }
    for (const tag of ['', 'en_US', 'en--US', 'en/US']) {
      expect(languageTagSchema.safeParse(tag).success).toBe(false);
    }
  });

  it('includes explicit unspecified gender and requires it on voices', () => {
    const genderSchema = schema('GenderSchema');
    const voiceSchema = schema('VoicePresetSchema');

    for (const gender of ['female', 'male', 'neutral', 'unspecified']) {
      expect(genderSchema.safeParse(gender).success).toBe(true);
    }
    expect(genderSchema.safeParse('unknown').success).toBe(false);
    expect(voiceSchema.safeParse(voicePreset).success).toBe(true);

    const { gender: _gender, ...withoutGender } = voicePreset;
    expect(voiceSchema.safeParse(withoutGender).success).toBe(false);
  });
});

describe('catalog record contracts', () => {
  it('validates engine, voice, sample, license, and source records', () => {
    expect(schema('EngineManifestSchema').safeParse(engineManifest).success).toBe(true);
    expect(schema('VoicePresetSchema').safeParse(voicePreset).success).toBe(true);
    expect(schema('SampleManifestSchema').safeParse(sampleManifest).success).toBe(true);
    expect(schema('LicenseRecordSchema').safeParse(licenseRecord).success).toBe(true);
    expect(schema('SourceRecordSchema').safeParse(sourceRecord).success).toBe(true);
  });

  it('requires license and source evidence', () => {
    const licenseSchema = schema('LicenseRecordSchema');
    const sourceSchema = schema('SourceRecordSchema');

    const { evidenceUrl: _evidenceUrl, ...licenseWithoutEvidence } = licenseRecord;
    const { upstreamRevision: _upstreamRevision, ...sourceWithoutRevision } = sourceRecord;

    expect(licenseSchema.safeParse(licenseWithoutEvidence).success).toBe(false);
    expect(sourceSchema.safeParse(sourceWithoutRevision).success).toBe(false);
  });

  it('requires a voice ID to match its engine and upstream IDs', () => {
    const voiceSchema = schema('VoicePresetSchema');

    expect(voiceSchema.safeParse({ ...voicePreset, id: 'fixture-browser:different' }).success).toBe(
      false,
    );
    expect(voiceSchema.safeParse({ ...voicePreset, engineId: 'another-engine' }).success).toBe(
      false,
    );
  });

  it('rejects cloning, reference-audio, arbitrary-model, command, and path fields', () => {
    const engineSchema = schema('EngineManifestSchema');
    const voiceSchema = schema('VoicePresetSchema');
    const sampleSchema = schema('SampleManifestSchema');

    expect(voiceSchema.safeParse({ ...voicePreset, cloneFrom: 'speaker-a' }).success).toBe(false);
    expect(
      voiceSchema.safeParse({ ...voicePreset, referenceAudio: 'data:audio/wav;base64,AA==' })
        .success,
    ).toBe(false);
    expect(
      engineSchema.safeParse({ ...engineManifest, modelUrl: 'https://untrusted.invalid/model' })
        .success,
    ).toBe(false);
    expect(engineSchema.safeParse({ ...engineManifest, command: 'run-engine' }).success).toBe(
      false,
    );
    expect(
      sampleSchema.safeParse({ ...sampleManifest, audioPath: 'C:\\private\\sample.wav' }).success,
    ).toBe(false);
  });
});
