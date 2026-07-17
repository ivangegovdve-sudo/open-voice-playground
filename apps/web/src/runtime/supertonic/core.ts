/*
 * Adapted from Supertone Supertonic web/helper.js at
 * dff55dc00064c398736080c78195f577527832ae.
 *
 * MIT License
 *
 * Copyright (c) 2025 Supertone Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Safety changes in this port: scalar-aware Unicode validation and chunking,
 * closed bounded JSON parsing, injected sessions and deterministic randomness,
 * flat typed-array tensor ownership, per-chunk trimming, fail-closed PCM checks,
 * and explicit little-endian WAV encoding. No upstream loader or ambient runtime
 * initialization is included.
 */

import type {
  OrtTensorData,
  OrtTensorLease,
  OrtTensorType,
  PreparedSupertonicOrtPort,
} from './ort-port';
import { assertPreparedSupertonicOrtPort } from './ort-port';

export const SUPERTONIC_SAMPLE_RATE = 44_100;
export const SUPERTONIC_LATENT_HOP = 3_072;
export const SUPERTONIC_LATENT_CHANNELS = 144;

const RAW_SCALAR_CAP = 2_000;
const CHUNK_CAP = 32;
const DENOISING_STEPS = 8;
const INTER_CHUNK_SILENCE_SAMPLES = 13_230;
const TOTAL_SAMPLE_CAP = 7_938_000;
const TTS_JSON_CAP = 16 * 1_024;
const INDEX_JSON_CAP = 320 * 1_024;
const STYLE_JSON_CAP = 320 * 1_024;

export const SUPPORTED_SUPERTONIC_LANGUAGES = [
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
] as const;

export type SupertonicLanguage = (typeof SUPPORTED_SUPERTONIC_LANGUAGES)[number];

export type SupertonicConfig = {
  readonly ttsVersion: 'v1.7.3';
  readonly split: 'opensource-multilingual';
  readonly sampleRate: 44_100;
  readonly baseChunkSize: 512;
  readonly compression: 6;
  readonly latentDimension: 24;
  readonly latentHop: 3_072;
  readonly latentChannels: 144;
};

export type SupertonicStyle = {
  readonly ttl: Float32Array;
  readonly dp: Float32Array;
  readonly metadata: {
    readonly sourceFile: string;
    readonly sourceSampleRate: number;
    readonly targetSampleRate: 44_100;
    readonly extractedAt: string;
  };
};

export type PreparedSupertonicTextChunk = {
  readonly text: string;
  readonly textIds: BigInt64Array;
  readonly textMask: Float32Array;
};

export type SupertonicRandom = {
  nextUint32(): number;
  nextNormal(): number;
};

export type SupertonicSynthesisOptions = {
  readonly text: string;
  readonly language: string;
  readonly speed: number;
  readonly config: SupertonicConfig;
  readonly indexer: Int32Array;
  readonly style: SupertonicStyle;
  readonly ort: PreparedSupertonicOrtPort;
  readonly onProgress?: (completed: number, total: number) => void;
};

type JsonInput = string | Uint8Array | ArrayBuffer;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

function decodeJsonInput(
  input: JsonInput,
  cap: number,
  capError: string,
  parseError: string,
): unknown {
  let byteLength: number;
  let text: string;
  try {
    if (typeof input === 'string') {
      byteLength = new TextEncoder().encode(input).byteLength;
      text = input;
    } else {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      byteLength = bytes.byteLength;
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    throw new Error(parseError);
  }
  if (byteLength > cap) throw new Error(capError);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(parseError);
  }
}

export function parseSupertonicConfig(input: JsonInput): SupertonicConfig {
  const value = decodeJsonInput(
    input,
    TTS_JSON_CAP,
    'Supertonic tts.json exceeds 16 KiB.',
    'Supertonic tts.json is invalid JSON.',
  );
  if (!isRecord(value) || !hasExactKeys(value, ['tts_version', 'split', 'ttl', 'ae', 'dp'])) {
    throw new Error('Supertonic tts.json top-level keys are invalid.');
  }
  const ttl = value.ttl;
  const ae = value.ae;
  const dp = value.dp;
  if (
    value.tts_version !== 'v1.7.3' ||
    value.split !== 'opensource-multilingual' ||
    !isRecord(ttl) ||
    ttl.latent_dim !== 24 ||
    ttl.chunk_compress_factor !== 6 ||
    !isRecord(ae) ||
    ae.sample_rate !== SUPERTONIC_SAMPLE_RATE ||
    ae.base_chunk_size !== 512 ||
    ae.ldim !== 24 ||
    !isRecord(dp) ||
    dp.latent_dim !== 24 ||
    dp.chunk_compress_factor !== 6
  ) {
    throw new Error('Supertonic tts.json pinned model invariants are invalid.');
  }
  return {
    ttsVersion: 'v1.7.3',
    split: 'opensource-multilingual',
    sampleRate: SUPERTONIC_SAMPLE_RATE,
    baseChunkSize: 512,
    compression: 6,
    latentDimension: 24,
    latentHop: SUPERTONIC_LATENT_HOP,
    latentChannels: SUPERTONIC_LATENT_CHANNELS,
  };
}

export function parseUnicodeIndexer(input: JsonInput): Int32Array {
  const value = decodeJsonInput(
    input,
    INDEX_JSON_CAP,
    'Supertonic unicode_indexer.json exceeds 320 KiB.',
    'Supertonic unicode_indexer.json is invalid JSON.',
  );
  if (!Array.isArray(value) || value.length !== 65_536) {
    throw new Error('Supertonic unicode index length is invalid.');
  }
  const result = new Int32Array(65_536);
  const seen = new Uint8Array(8_321);
  let unknownCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!Number.isInteger(entry) || (entry !== -1 && (entry < 0 || entry > 8_320))) {
      throw new Error('Supertonic unicode index values are invalid.');
    }
    if (entry === -1) {
      unknownCount += 1;
    } else {
      if (seen[entry] !== 0) {
        throw new Error('Supertonic unicode index permutation is invalid.');
      }
      seen[entry] = 1;
    }
    result[index] = entry;
  }
  if (unknownCount !== 57_215) {
    throw new Error('Supertonic unicode index sentinel count is invalid.');
  }
  for (let valueIndex = 0; valueIndex < seen.length; valueIndex += 1) {
    if (seen[valueIndex] !== 1) {
      throw new Error('Supertonic unicode index permutation is invalid.');
    }
  }
  return result;
}

function parseStyleTensor(
  value: unknown,
  rows: number,
  columns: number,
  invariant: string,
): Float32Array {
  const nested = isRecord(value) ? value['data'] : undefined;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['data', 'dims', 'type']) ||
    value.type !== 'float32' ||
    !Array.isArray(value.dims) ||
    value.dims.length !== 3 ||
    value.dims[0] !== 1 ||
    value.dims[1] !== rows ||
    value.dims[2] !== columns ||
    !Array.isArray(nested) ||
    nested.length !== 1 ||
    !Array.isArray(nested[0]) ||
    nested[0].length !== rows
  ) {
    throw new Error(invariant);
  }
  const result = new Float32Array(rows * columns);
  const matrix = nested[0];
  let offset = 0;
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    const row = matrix[rowIndex];
    if (!Array.isArray(row) || row.length !== columns) throw new Error(invariant);
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const entry = row[columnIndex];
      if (typeof entry !== 'number' || !Number.isFinite(entry)) throw new Error(invariant);
      result[offset] = entry;
      if (!Number.isFinite(result[offset])) throw new Error(invariant);
      offset += 1;
    }
  }
  return result;
}

export function parseSupertonicStyle(input: JsonInput): SupertonicStyle {
  const value = decodeJsonInput(
    input,
    STYLE_JSON_CAP,
    'Supertonic style JSON exceeds 320 KiB.',
    'Supertonic style JSON is invalid JSON.',
  );
  if (!isRecord(value) || !hasExactKeys(value, ['style_ttl', 'style_dp', 'metadata'])) {
    throw new Error('Supertonic style top-level keys are invalid.');
  }
  const metadata = value.metadata;
  if (
    !isRecord(metadata) ||
    !hasExactKeys(metadata, [
      'source_file',
      'source_sample_rate',
      'target_sample_rate',
      'extracted_at',
    ]) ||
    typeof metadata.source_file !== 'string' ||
    metadata.source_file.length === 0 ||
    !Number.isSafeInteger(metadata.source_sample_rate) ||
    (metadata.source_sample_rate as number) <= 0 ||
    metadata.target_sample_rate !== SUPERTONIC_SAMPLE_RATE ||
    typeof metadata.extracted_at !== 'string' ||
    metadata.extracted_at.length === 0
  ) {
    throw new Error('Supertonic style metadata invariant is invalid.');
  }
  return {
    ttl: parseStyleTensor(
      value.style_ttl,
      50,
      256,
      'Supertonic style TTL tensor invariant is invalid.',
    ),
    dp: parseStyleTensor(value.style_dp, 8, 16, 'Supertonic style DP tensor invariant is invalid.'),
    metadata: {
      sourceFile: metadata.source_file,
      sourceSampleRate: metadata.source_sample_rate as number,
      targetSampleRate: SUPERTONIC_SAMPLE_RATE,
      extractedAt: metadata.extracted_at,
    },
  };
}

function validateRawScalars(value: string): void {
  let scalars = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('Supertonic text contains an unpaired surrogate.');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('Supertonic text contains an unpaired surrogate.');
    }
    scalars += 1;
    if (scalars > RAW_SCALAR_CAP) {
      throw new Error('Supertonic text exceeds 2,000 Unicode scalars.');
    }
  }
}

function countScalars(value: string): number {
  let count = 0;
  for (const _scalar of value) count += 1;
  return count;
}

const EMOJI_PATTERN =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;
const SENTENCE_BOUNDARY =
  /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;
const TERMINAL_PUNCTUATION = /[.!?;:,'"')\]}…。」』】〉》›»]$/;

function sanitizeText(value: string): string {
  let text = value.normalize('NFKD').replace(EMOJI_PATTERN, '');
  const replacements: readonly (readonly [string, string])[] = [
    ['–', '-'],
    ['‑', '-'],
    ['—', '-'],
    ['_', ' '],
    ['“', '"'],
    ['”', '"'],
    ['‘', "'"],
    ['’', "'"],
    ['´', "'"],
    ['`', "'"],
    ['[', ' '],
    [']', ' '],
    ['|', ' '],
    ['/', ' '],
    ['#', ' '],
    ['→', ' '],
    ['←', ' '],
  ];
  for (const [source, replacement] of replacements) {
    text = text.replaceAll(source, replacement);
  }
  text = text.replace(/[♥☆♡©\\]/g, '');
  const expressions: readonly (readonly [string, string])[] = [
    ['@', ' at '],
    ['e.g.,', 'for example, '],
    ['i.e.,', 'that is, '],
  ];
  for (const [source, replacement] of expressions) {
    text = text.replaceAll(source, replacement);
  }
  text = text
    .replace(/ ,/g, ',')
    .replace(/ \./g, '.')
    .replace(/ !/g, '!')
    .replace(/ \?/g, '?')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')
    .replace(/ '/g, "'");
  while (text.includes('""')) text = text.replace('""', '"');
  while (text.includes("''")) text = text.replace("''", "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function finalizedText(value: string): string {
  return TERMINAL_PUNCTUATION.test(value) ? value : `${value}.`;
}

function hardSplitSanitized(value: string, scalarCap: number): string[] {
  if (countScalars(finalizedText(value)) <= scalarCap) return [value];
  const pieces: string[] = [];
  const contentCap = scalarCap - 1;
  let piece = '';
  let pieceLength = 0;
  for (const scalar of value) {
    if (pieceLength === contentCap) {
      pieces.push(piece);
      piece = '';
      pieceLength = 0;
    }
    piece += scalar;
    pieceLength += 1;
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}

function pushChunk(chunks: string[], value: string): void {
  const finalized = finalizedText(value);
  if (finalized.length === 0) return;
  chunks.push(finalized);
  if (chunks.length > CHUNK_CAP) {
    throw new Error('Supertonic text exceeds 32 sanitized chunks.');
  }
}

function chunkSanitizedText(text: string, scalarCap: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.trim().split(/\n\s*\n+/);
  for (const rawParagraph of paragraphs) {
    if (rawParagraph.trim().length === 0) continue;
    const sentences = rawParagraph.trim().split(SENTENCE_BOUNDARY);
    let current = '';
    for (const rawSentence of sentences) {
      const sanitized = sanitizeText(rawSentence);
      if (sanitized.length === 0) continue;
      const pieces = hardSplitSanitized(sanitized, scalarCap);
      for (const piece of pieces) {
        const candidate = current.length === 0 ? piece : `${current} ${piece}`;
        if (countScalars(finalizedText(candidate)) <= scalarCap) {
          current = candidate;
        } else {
          if (current.length > 0) pushChunk(chunks, current);
          current = piece;
        }
      }
    }
    if (current.length > 0) pushChunk(chunks, current);
  }
  return chunks;
}

function isSupportedLanguage(value: string): value is SupertonicLanguage {
  return (SUPPORTED_SUPERTONIC_LANGUAGES as readonly string[]).includes(value);
}

export function prepareSupertonicText(
  text: string,
  language: string,
  indexer: Int32Array,
): readonly PreparedSupertonicTextChunk[] {
  if (!isSupportedLanguage(language)) {
    throw new Error('Unsupported Supertonic language.');
  }
  if (typeof text !== 'string') {
    throw new Error('Supertonic text must be a string.');
  }
  validateRawScalars(text);
  if (!(indexer instanceof Int32Array) || indexer.length !== 65_536) {
    throw new Error('Supertonic unicode index length is invalid.');
  }
  const scalarCap = language === 'ja' || language === 'ko' ? 120 : 300;
  const tokenCap = language === 'ja' || language === 'ko' ? 130 : 310;
  const sanitizedChunks = chunkSanitizedText(text, scalarCap);
  if (sanitizedChunks.length === 0) {
    throw new Error('Supertonic text is empty after sanitation.');
  }
  const result: PreparedSupertonicTextChunk[] = [];
  for (const sanitized of sanitizedChunks) {
    const tagged = `<${language}>${sanitized}</${language}>`;
    const tokenLength = countScalars(tagged);
    if (tokenLength > tokenCap) {
      throw new Error('Supertonic tagged token cap is invalid.');
    }
    const textIds = new BigInt64Array(tokenLength);
    const textMask = new Float32Array(tokenLength);
    let offset = 0;
    for (const scalar of tagged) {
      const codePoint = scalar.codePointAt(0);
      if (codePoint === undefined) throw new Error('Supertonic scalar encoding invariant failed.');
      const mapped = codePoint < indexer.length ? indexer[codePoint] : -1;
      textIds[offset] = BigInt(mapped ?? -1);
      textMask[offset] = 1;
      offset += 1;
    }
    result.push({ text: tagged, textIds, textMask });
  }
  return result;
}

export function createSupertonicRandom(seed = 42): SupertonicRandom {
  let state = seed >>> 0;
  let spare: number | undefined;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };

  const nextNormal = (): number => {
    if (spare !== undefined) {
      const cached = spare;
      spare = undefined;
      return cached;
    }
    const first = (nextUint32() + 0.5) / 4_294_967_296;
    const second = (nextUint32() + 0.5) / 4_294_967_296;
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    spare = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };

  return { nextUint32, nextNormal };
}

function assertConfig(config: SupertonicConfig): void {
  if (
    config.ttsVersion !== 'v1.7.3' ||
    config.split !== 'opensource-multilingual' ||
    config.sampleRate !== SUPERTONIC_SAMPLE_RATE ||
    config.baseChunkSize !== 512 ||
    config.compression !== 6 ||
    config.latentDimension !== 24 ||
    config.latentHop !== SUPERTONIC_LATENT_HOP ||
    config.latentChannels !== SUPERTONIC_LATENT_CHANNELS
  ) {
    throw new Error('Supertonic parsed configuration invariant is invalid.');
  }
}

function assertStyle(style: SupertonicStyle): void {
  if (
    !(style.ttl instanceof Float32Array) ||
    style.ttl.length !== 12_800 ||
    !(style.dp instanceof Float32Array) ||
    style.dp.length !== 128 ||
    style.metadata.targetSampleRate !== SUPERTONIC_SAMPLE_RATE
  ) {
    throw new Error('Supertonic parsed style invariant is invalid.');
  }
  for (let index = 0; index < style.ttl.length; index += 1) {
    if (!Number.isFinite(style.ttl[index])) {
      throw new Error('Supertonic parsed style invariant is invalid.');
    }
  }
  for (let index = 0; index < style.dp.length; index += 1) {
    if (!Number.isFinite(style.dp[index])) {
      throw new Error('Supertonic parsed style invariant is invalid.');
    }
  }
}

function assertSpeed(speed: number): void {
  const scaled = Math.round(speed * 100);
  if (
    !Number.isFinite(speed) ||
    speed < 0.75 ||
    speed > 1.25 ||
    speed !== scaled / 100 ||
    scaled % 5 !== 0
  ) {
    throw new Error('Supertonic speed must be 0.75..1.25 in 0.05 steps.');
  }
}

function exactDims(actual: readonly number[], expected: readonly number[]): boolean {
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) return false;
  }
  return true;
}

function finiteFloatData(data: Float32Array, error: string): void {
  for (let index = 0; index < data.length; index += 1) {
    if (!Number.isFinite(data[index])) throw new Error(error);
  }
}

async function claimFloatOutput(
  outputs: Readonly<Record<string, OrtTensorLease>>,
  name: string,
  dims: readonly number[],
  error: string,
  requireFinite = true,
): Promise<Float32Array> {
  const keys = Object.keys(outputs);
  const unique = new Set<OrtTensorLease>();
  for (const key of keys) {
    const output = outputs[key];
    if (output !== undefined) unique.add(output);
  }
  try {
    const output = outputs[name];
    if (
      keys.length !== 1 ||
      keys[0] !== name ||
      output === undefined ||
      output.type !== 'float32' ||
      !exactDims(output.dims, dims)
    ) {
      throw new Error(error);
    }
    const data = await (output as OrtTensorLease<'float32'>).getData(true);
    let expectedLength = 1;
    for (const dimension of dims) expectedLength *= dimension;
    if (!(data instanceof Float32Array) || data.length !== expectedLength) throw new Error(error);
    if (requireFinite) finiteFloatData(data, error);
    return data;
  } finally {
    for (const output of unique) output.dispose();
  }
}

function disposeTensors(tensors: readonly OrtTensorLease[]): void {
  for (let index = tensors.length - 1; index >= 0; index -= 1) tensors[index]?.dispose();
}

function makeTensor<T extends OrtTensorType>(
  ort: PreparedSupertonicOrtPort,
  owned: OrtTensorLease[],
  type: T,
  data: OrtTensorData<T>,
  dims: readonly number[],
): OrtTensorLease<T> {
  const tensor = ort.createTensor(type, data, dims);
  owned.push(tensor);
  return tensor;
}

async function synthesizeChunk(
  chunk: PreparedSupertonicTextChunk,
  speed: number,
  ort: PreparedSupertonicOrtPort,
  styleTtl: OrtTensorLease<'float32'>,
  styleDp: OrtTensorLease<'float32'>,
  random: SupertonicRandom,
  reportCompleted: () => void,
): Promise<{ readonly pcm: Float32Array; readonly trimSamples: number }> {
  const owned: OrtTensorLease[] = [];
  const tokenLength = chunk.textIds.length;
  try {
    const textIds = makeTensor(ort, owned, 'int64', chunk.textIds, [1, tokenLength]);
    const textMask = makeTensor(ort, owned, 'float32', chunk.textMask, [1, 1, tokenLength]);
    const durationOutputs = await ort.sessions[0].run({
      text_ids: textIds,
      style_dp: styleDp,
      text_mask: textMask,
    });
    const durationData = await claimFloatOutput(
      durationOutputs,
      'duration',
      [1],
      'Supertonic duration output invariant is invalid.',
      false,
    );
    const duration = (durationData[0] as number) / speed;
    if (!Number.isFinite(duration) || duration < 0.05 || duration > 60) {
      throw new Error('Supertonic chunk duration must be finite and within 0.05..60 seconds.');
    }
    reportCompleted();

    const textOutputs = await ort.sessions[1].run({
      text_ids: textIds,
      style_ttl: styleTtl,
      text_mask: textMask,
    });
    const textEmbeddingData = await claimFloatOutput(
      textOutputs,
      'text_emb',
      [1, 256, tokenLength],
      'Supertonic text embedding output invariant is invalid.',
    );
    const textEmbedding = makeTensor(ort, owned, 'float32', textEmbeddingData, [
      1,
      256,
      tokenLength,
    ]);
    reportCompleted();

    const trimSamples = Math.floor(duration * SUPERTONIC_SAMPLE_RATE);
    const latentLength = Math.ceil(trimSamples / SUPERTONIC_LATENT_HOP);
    const latentValues = SUPERTONIC_LATENT_CHANNELS * latentLength;
    if (latentLength < 1 || latentValues > 124_128) {
      throw new Error('Supertonic latent allocation invariant is invalid.');
    }
    let currentLatent: Float32Array = new Float32Array(latentValues);
    for (let index = 0; index < currentLatent.length; index += 1) {
      currentLatent[index] = random.nextNormal();
    }
    const latentMaskData = new Float32Array(latentLength).fill(1);
    const latentMask = makeTensor(ort, owned, 'float32', latentMaskData, [1, 1, latentLength]);
    const totalStep = makeTensor(ort, owned, 'float32', new Float32Array([DENOISING_STEPS]), [1]);

    for (let step = 0; step < DENOISING_STEPS; step += 1) {
      const stepOwned: OrtTensorLease[] = [];
      try {
        const noisyLatent = makeTensor(ort, stepOwned, 'float32', currentLatent, [
          1,
          SUPERTONIC_LATENT_CHANNELS,
          latentLength,
        ]);
        const currentStep = makeTensor(ort, stepOwned, 'float32', new Float32Array([step]), [1]);
        const vectorOutputs = await ort.sessions[2].run({
          noisy_latent: noisyLatent,
          text_emb: textEmbedding,
          style_ttl: styleTtl,
          latent_mask: latentMask,
          text_mask: textMask,
          current_step: currentStep,
          total_step: totalStep,
        });
        currentLatent = await claimFloatOutput(
          vectorOutputs,
          'denoised_latent',
          [1, SUPERTONIC_LATENT_CHANNELS, latentLength],
          'Supertonic denoised latent output invariant is invalid.',
        );
        reportCompleted();
      } finally {
        disposeTensors(stepOwned);
      }
    }

    const vocoderOwned: OrtTensorLease[] = [];
    const latent = makeTensor(ort, vocoderOwned, 'float32', currentLatent, [
      1,
      SUPERTONIC_LATENT_CHANNELS,
      latentLength,
    ]);
    try {
      const vocoderOutputs = await ort.sessions[3].run({ latent });
      const paddedSamples = latentLength * SUPERTONIC_LATENT_HOP;
      const wav = await claimFloatOutput(
        vocoderOutputs,
        'wav_tts',
        [1, paddedSamples],
        'Supertonic vocoder output invariant is invalid.',
      );
      const trimmed = wav.slice(0, trimSamples);
      reportCompleted();
      return { pcm: trimmed, trimSamples };
    } finally {
      disposeTensors(vocoderOwned);
    }
  } finally {
    disposeTensors(owned);
  }
}

export async function synthesizeSupertonic(
  options: SupertonicSynthesisOptions,
): Promise<Float32Array> {
  assertPreparedSupertonicOrtPort(options.ort);
  assertSpeed(options.speed);
  assertConfig(options.config);
  assertStyle(options.style);
  const chunks = prepareSupertonicText(options.text, options.language, options.indexer);
  const totalProgress = chunks.length * 11;
  let completed = 0;
  const reportCompleted = (): void => {
    completed += 1;
    options.onProgress?.(completed, totalProgress);
  };
  const random = createSupertonicRandom(42);
  const outerOwned: OrtTensorLease[] = [];
  const rendered: Float32Array[] = [];
  let totalSamples = 0;
  try {
    const styleTtl = makeTensor(
      options.ort,
      outerOwned,
      'float32',
      options.style.ttl,
      [1, 50, 256],
    );
    const styleDp = makeTensor(options.ort, outerOwned, 'float32', options.style.dp, [1, 8, 16]);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      if (chunk === undefined) throw new Error('Supertonic chunk sequence invariant failed.');
      const result = await synthesizeChunk(
        chunk,
        options.speed,
        options.ort,
        styleTtl,
        styleDp,
        random,
        reportCompleted,
      );
      const nextTotal =
        totalSamples + result.trimSamples + (chunkIndex === 0 ? 0 : INTER_CHUNK_SILENCE_SAMPLES);
      if (nextTotal > TOTAL_SAMPLE_CAP) {
        throw new Error('Supertonic synthesis exceeds the 180-second PCM cap.');
      }
      rendered.push(result.pcm);
      totalSamples = nextTotal;
    }
  } finally {
    disposeTensors(outerOwned);
  }

  const pcm = new Float32Array(totalSamples);
  let offset = 0;
  for (let chunkIndex = 0; chunkIndex < rendered.length; chunkIndex += 1) {
    if (chunkIndex > 0) offset += INTER_CHUNK_SILENCE_SAMPLES;
    const chunk = rendered[chunkIndex];
    if (chunk === undefined) throw new Error('Supertonic rendered chunk invariant failed.');
    pcm.set(chunk, offset);
    offset += chunk.length;
  }
  return validateSupertonicPcm(pcm);
}

export function validateSupertonicPcm(pcm: Float32Array): Float32Array {
  if (!(pcm instanceof Float32Array) || pcm.length === 0 || pcm.length > TOTAL_SAMPLE_CAP) {
    throw new Error('Supertonic PCM length invariant is invalid.');
  }
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  let quantizedPeak = 0;
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = pcm[index];
    if (sample === undefined || !Number.isFinite(sample)) {
      throw new Error('Supertonic PCM contains a non-finite sample.');
    }
    const absolute = Math.abs(sample);
    if (absolute > 4) throw new Error('Supertonic PCM absolute sample bound is invalid.');
    if (absolute > peak) peak = absolute;
    if (absolute >= 0.999) clipped += 1;
    sumSquares += sample * sample;
    const clamped = Math.max(-1, Math.min(1, sample));
    const quantized = clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    quantizedPeak = Math.max(quantizedPeak, Math.abs(quantized));
  }
  if (peak < 1e-5) throw new Error('Supertonic PCM peak is below the useful-signal floor.');
  const rms = Math.sqrt(sumSquares / pcm.length);
  if (rms < 1e-6) throw new Error('Supertonic PCM RMS is below the useful-signal floor.');
  if (clipped / pcm.length > 0.05) {
    throw new Error('Supertonic PCM clipping ratio exceeds five percent.');
  }
  if (quantizedPeak === 0) {
    throw new Error('Supertonic PCM quantizes to silence at the PCM16 boundary.');
  }
  return pcm;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function encodeSupertonicWav(pcm: Float32Array): ArrayBuffer {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) {
    throw new Error('Supertonic WAV input invariant is invalid.');
  }
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SUPERTONIC_SAMPLE_RATE, true);
  view.setUint32(28, SUPERTONIC_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < pcm.length; index += 1) {
    const source = pcm[index];
    if (source === undefined || !Number.isFinite(source)) {
      throw new Error('Supertonic WAV input contains a non-finite sample.');
    }
    const clamped = Math.max(-1, Math.min(1, source));
    const signed = clamped < 0 ? Math.round(clamped * 32_768) : Math.round(clamped * 32_767);
    view.setInt16(44 + index * 2, signed, true);
  }
  return buffer;
}
