import { createHash } from 'node:crypto';

import type { EdgeVoiceSnapshotRecord } from './launch-data.js';

type UnknownRecord = Record<string, unknown>;

export type EdgeSnapshotReview = {
  hash: `sha256:${string}`;
  count: number;
  added: string[];
  removed: string[];
  changed: string[];
};

function object(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function gender(value: unknown): EdgeVoiceSnapshotRecord['gender'] {
  const normalized = text(value, 'gender').toLowerCase();
  if (
    normalized !== 'female' &&
    normalized !== 'male' &&
    normalized !== 'neutral' &&
    normalized !== 'unspecified'
  ) {
    throw new Error(`Unsupported source-published gender: ${normalized}.`);
  }
  return normalized;
}

function styleValues(record: UnknownRecord): string[] {
  const voiceTag = record.VoiceTag === undefined ? undefined : object(record.VoiceTag, 'VoiceTag');
  const raw = record.styles ?? voiceTag?.ContentCategories ?? [];
  if (!Array.isArray(raw)) {
    throw new Error('styles/VoiceTag.ContentCategories must be an array.');
  }
  const styles = raw.map((value) => text(value, 'style'));
  return [...new Set(styles)];
}

/**
 * Converts a maintainer-supplied raw service export into the public snapshot
 * shape. This function deliberately has no fetch path and does not synthesize.
 * Upstream ordering and source-published style ordering are preserved so that
 * service changes remain visible in review rather than silently reordered.
 */
export function normalizeEdgeSnapshot(input: unknown): EdgeVoiceSnapshotRecord[] {
  if (!Array.isArray(input)) {
    throw new Error('The Edge voice export must be a JSON array.');
  }
  const seen = new Set<string>();
  return input.map((value, index) => {
    const record = object(value, `Voice record ${index}`);
    const upstreamId = text(record.upstreamId ?? record.ShortName, 'upstreamId/ShortName');
    if (seen.has(upstreamId)) {
      throw new Error(`Duplicate Edge voice ID: ${upstreamId}.`);
    }
    seen.add(upstreamId);
    const locale = text(record.locale ?? record.Locale, 'locale/Locale');
    try {
      new Intl.Locale(locale);
    } catch {
      throw new Error(`Invalid source-published locale: ${locale}.`);
    }
    return {
      upstreamId,
      locale,
      gender: gender(record.gender ?? record.Gender),
      styles: styleValues(record),
    };
  });
}

function canonicalHash(snapshot: readonly EdgeVoiceSnapshotRecord[]): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`;
}

export function computeEdgeSnapshotReview(
  current: readonly EdgeVoiceSnapshotRecord[],
  candidate: readonly EdgeVoiceSnapshotRecord[],
): EdgeSnapshotReview {
  const currentById = new Map(current.map((record) => [record.upstreamId, record]));
  const candidateById = new Map(candidate.map((record) => [record.upstreamId, record]));
  return {
    hash: canonicalHash(candidate),
    count: candidate.length,
    added: [...candidateById.keys()].filter((id) => !currentById.has(id)).sort(),
    removed: [...currentById.keys()].filter((id) => !candidateById.has(id)).sort(),
    changed: [...candidateById.entries()]
      .filter(
        ([id, record]) =>
          currentById.has(id) && JSON.stringify(currentById.get(id)) !== JSON.stringify(record),
      )
      .map(([id]) => id)
      .sort(),
  };
}

export function renderEdgeSnapshotModule(snapshot: readonly EdgeVoiceSnapshotRecord[]): string {
  const header =
    "export type EdgeVoiceSnapshotRecord = { upstreamId: string; locale: string; gender: 'female' | 'male' | 'neutral' | 'unspecified'; styles: string[] };";
  const records = snapshot.map((record) => `  ${JSON.stringify(record)},`).join('\n');
  return `${header}\n\nexport const EDGE_VOICE_SNAPSHOT: EdgeVoiceSnapshotRecord[] = [\n${records}\n];\n`;
}
