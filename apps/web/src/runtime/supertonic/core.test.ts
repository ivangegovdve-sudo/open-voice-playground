import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SUPERTONIC_SAMPLE_RATE,
  SUPPORTED_SUPERTONIC_LANGUAGES,
  createSupertonicRandom,
  encodeSupertonicWav,
  parseSupertonicConfig,
  parseSupertonicStyle,
  parseUnicodeIndexer,
  prepareSupertonicText,
  synthesizeSupertonic,
  validateSupertonicPcm,
} from './core';
import {
  prepareSupertonicOrtPort,
  type OrtSessionPort,
  type OrtTensorData,
  type OrtTensorLease,
  type OrtTensorMetadata,
  type OrtTensorType,
  type PreparedSupertonicOrtPort,
  type SupertonicOrtPort,
} from './ort-port';

const textEncoder = new TextEncoder();
const currentDirectory = dirname(fileURLToPath(import.meta.url));

function validConfigJson(): string {
  return JSON.stringify({
    tts_version: 'v1.7.3',
    split: 'opensource-multilingual',
    ttl: { latent_dim: 24, chunk_compress_factor: 6 },
    ae: { sample_rate: 44_100, base_chunk_size: 512, ldim: 24 },
    dp: { latent_dim: 24, chunk_compress_factor: 6 },
  });
}

function validIndexerJson(): string {
  const index = new Array<number>(65_536).fill(-1);
  for (let value = 0; value <= 8_320; value += 1) index[value] = value;
  return JSON.stringify(index);
}

function tensorJson(rows: number, columns: number): unknown {
  const matrix: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    matrix.push(new Array<number>(columns).fill((row + 1) / 100));
  }
  return [matrix];
}

function validStyleValue(sourceSampleRate = 24_000): Record<string, unknown> {
  return {
    style_ttl: {
      data: tensorJson(50, 256),
      dims: [1, 50, 256],
      type: 'float32',
    },
    style_dp: {
      data: tensorJson(8, 16),
      dims: [1, 8, 16],
      type: 'float32',
    },
    metadata: {
      source_file: 'M1.wav',
      source_sample_rate: sourceSampleRate,
      target_sample_rate: 44_100,
      extracted_at: '2026-04-28T10:39:35.994767',
    },
  };
}

function validStyleJson(sourceSampleRate = 24_000): string {
  return JSON.stringify(validStyleValue(sourceSampleRate));
}

function scalarLength(value: string): number {
  let length = 0;
  for (const _scalar of value) length += 1;
  return length;
}

class FakeTensor<T extends OrtTensorType = OrtTensorType> implements OrtTensorLease<T> {
  readonly getDataCalls: boolean[] = [];
  disposeCalls = 0;

  constructor(
    readonly type: T,
    readonly dims: readonly number[],
    private readonly value: OrtTensorData<T>,
  ) {}

  async getData(releaseData: true): Promise<OrtTensorData<T>> {
    this.getDataCalls.push(releaseData);
    return this.value;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

type SessionRun = (
  feeds: Readonly<Record<string, OrtTensorLease>>,
) => Promise<Readonly<Record<string, OrtTensorLease>>>;

function tensorMetadata(
  name: string,
  type: OrtTensorType,
  shape: readonly (number | string)[],
): OrtTensorMetadata {
  return { name, isTensor: true, type, shape };
}

class FakeSession implements OrtSessionPort {
  readonly calls: Readonly<Record<string, OrtTensorLease>>[] = [];

  constructor(
    readonly inputNames: readonly string[],
    readonly outputNames: readonly string[],
    readonly inputMetadata: readonly OrtTensorMetadata[],
    readonly outputMetadata: readonly OrtTensorMetadata[],
    private readonly execute: SessionRun,
  ) {}

  async run(
    feeds: Readonly<Record<string, OrtTensorLease>>,
  ): Promise<Readonly<Record<string, OrtTensorLease>>> {
    this.calls.push(feeds);
    return this.execute(feeds);
  }
}

function officialMetadata(): readonly [
  Pick<OrtSessionPort, 'inputNames' | 'outputNames' | 'inputMetadata' | 'outputMetadata'>,
  Pick<OrtSessionPort, 'inputNames' | 'outputNames' | 'inputMetadata' | 'outputMetadata'>,
  Pick<OrtSessionPort, 'inputNames' | 'outputNames' | 'inputMetadata' | 'outputMetadata'>,
  Pick<OrtSessionPort, 'inputNames' | 'outputNames' | 'inputMetadata' | 'outputMetadata'>,
] {
  return [
    {
      inputNames: ['text_ids', 'style_dp', 'text_mask'],
      outputNames: ['duration'],
      inputMetadata: [
        tensorMetadata('text_ids', 'int64', ['batch_size', 'text_length']),
        tensorMetadata('style_dp', 'float32', ['batch_size', 8, 16]),
        tensorMetadata('text_mask', 'float32', ['batch_size', 1, 'text_length']),
      ],
      outputMetadata: [tensorMetadata('duration', 'float32', ['duration_batch'])],
    },
    {
      inputNames: ['text_ids', 'style_ttl', 'text_mask'],
      outputNames: ['text_emb'],
      inputMetadata: [
        tensorMetadata('text_ids', 'int64', ['batch_size', 'text_length']),
        tensorMetadata('style_ttl', 'float32', ['batch_size', 50, 256]),
        tensorMetadata('text_mask', 'float32', ['batch_size', 1, 'text_length']),
      ],
      outputMetadata: [
        tensorMetadata('text_emb', 'float32', ['Multext_emb_dim_0', 256, 'Multext_emb_dim_2']),
      ],
    },
    {
      inputNames: [
        'noisy_latent',
        'text_emb',
        'style_ttl',
        'latent_mask',
        'text_mask',
        'current_step',
        'total_step',
      ],
      outputNames: ['denoised_latent'],
      inputMetadata: [
        tensorMetadata('noisy_latent', 'float32', ['batch_size', 144, 'latent_length']),
        tensorMetadata('text_emb', 'float32', ['batch_size', 256, 'text_length']),
        tensorMetadata('style_ttl', 'float32', ['batch_size', 50, 256]),
        tensorMetadata('latent_mask', 'float32', ['batch_size', 1, 'latent_length']),
        tensorMetadata('text_mask', 'float32', ['batch_size', 1, 'text_length']),
        tensorMetadata('current_step', 'float32', ['batch_size']),
        tensorMetadata('total_step', 'float32', ['batch_size']),
      ],
      outputMetadata: [
        tensorMetadata('denoised_latent', 'float32', ['batch_size', 144, 'latent_length']),
      ],
    },
    {
      inputNames: ['latent'],
      outputNames: ['wav_tts'],
      inputMetadata: [tensorMetadata('latent', 'float32', ['batch_size', 144, 'latent_length'])],
      outputMetadata: [tensorMetadata('wav_tts', 'float32', ['wav_batch', 'wav_samples'])],
    },
  ];
}

type FakeRuntime = {
  readonly port: PreparedSupertonicOrtPort;
  readonly unprepared: SupertonicOrtPort;
  readonly sessions: readonly [FakeSession, FakeSession, FakeSession, FakeSession];
  readonly tensors: FakeTensor[];
  readonly outputs: FakeTensor[];
};

function makeFakeRuntime(
  options: { duration?: number; failVectorStep?: number; failCreateAt?: number } = {},
): FakeRuntime {
  const metadata = officialMetadata();
  const tensors: FakeTensor[] = [];
  const outputs: FakeTensor[] = [];
  const duration = options.duration ?? 0.1;
  let vectorStep = 0;
  let createCall = 0;

  const output = <T extends OrtTensorType>(
    type: T,
    dims: readonly number[],
    value: OrtTensorData<T>,
  ): FakeTensor<T> => {
    const tensor = new FakeTensor(type, dims, value);
    outputs.push(tensor);
    return tensor;
  };
  const sessions = [
    new FakeSession(
      metadata[0].inputNames,
      metadata[0].outputNames,
      metadata[0].inputMetadata,
      metadata[0].outputMetadata,
      async () => ({ duration: output('float32', [1], new Float32Array([duration])) }),
    ),
    new FakeSession(
      metadata[1].inputNames,
      metadata[1].outputNames,
      metadata[1].inputMetadata,
      metadata[1].outputMetadata,
      async (feeds) => {
        const tokenLength = feeds.text_ids?.dims[1] ?? 0;
        return {
          text_emb: output('float32', [1, 256, tokenLength], new Float32Array(256 * tokenLength)),
        };
      },
    ),
    new FakeSession(
      metadata[2].inputNames,
      metadata[2].outputNames,
      metadata[2].inputMetadata,
      metadata[2].outputMetadata,
      async (feeds) => {
        vectorStep += 1;
        if (vectorStep === options.failVectorStep) throw new Error('vector failed');
        const latentLength = feeds.noisy_latent?.dims[2] ?? 0;
        return {
          denoised_latent: output(
            'float32',
            [1, 144, latentLength],
            new Float32Array(144 * latentLength).fill(vectorStep / 100),
          ),
        };
      },
    ),
    new FakeSession(
      metadata[3].inputNames,
      metadata[3].outputNames,
      metadata[3].inputMetadata,
      metadata[3].outputMetadata,
      async (feeds) => {
        const latentLength = feeds.latent?.dims[2] ?? 0;
        const wav = new Float32Array(latentLength * 3_072);
        for (let index = 0; index < wav.length; index += 1) {
          wav[index] = index % 2 === 0 ? 0.25 : -0.25;
        }
        return { wav_tts: output('float32', [1, wav.length], wav) };
      },
    ),
  ] as const;
  const unprepared: SupertonicOrtPort = {
    createTensor<T extends OrtTensorType>(
      type: T,
      data: OrtTensorData<T>,
      dims: readonly number[],
    ): OrtTensorLease<T> {
      createCall += 1;
      if (createCall === options.failCreateAt) {
        throw new Error('Supertonic test tensor allocation failed.');
      }
      const tensor = new FakeTensor(type, dims, data);
      tensors.push(tensor);
      return tensor;
    },
    sessions,
  };

  return {
    port: prepareSupertonicOrtPort(unprepared),
    unprepared,
    sessions,
    tensors,
    outputs,
  };
}

type MetadataTransform = (
  sessionIndex: number,
  direction: 'input' | 'output',
  name: string,
  shape: readonly (number | string)[],
) => readonly (number | string)[];

function prepareTransformedMetadata(transform: MetadataTransform): PreparedSupertonicOrtPort {
  const runtime = makeFakeRuntime();
  const sessions = officialMetadata().map(
    (metadata, sessionIndex) =>
      new FakeSession(
        metadata.inputNames,
        metadata.outputNames,
        metadata.inputMetadata.map((entry) =>
          entry.isTensor
            ? {
                ...entry,
                shape: transform(sessionIndex, 'input', entry.name, entry.shape),
              }
            : entry,
        ),
        metadata.outputMetadata.map((entry) =>
          entry.isTensor
            ? {
                ...entry,
                shape: transform(sessionIndex, 'output', entry.name, entry.shape),
              }
            : entry,
        ),
        async () => ({}),
      ),
  ) as unknown as readonly [FakeSession, FakeSession, FakeSession, FakeSession];

  return prepareSupertonicOrtPort({
    createTensor: runtime.unprepared.createTensor,
    sessions,
  });
}

function replaceShapeAxis(
  shape: readonly (number | string)[],
  axis: number,
  value: number | string,
): readonly (number | string)[] {
  const replaced = shape.slice();
  replaced[axis] = value;
  return replaced;
}

const parsedConfig = () => parseSupertonicConfig(validConfigJson());
const parsedIndexer = () => parseUnicodeIndexer(validIndexerJson());
const parsedStyle = () => parseSupertonicStyle(validStyleJson());

describe('Supertonic text boundary', () => {
  it('exposes exactly the reviewed 31-language selector allowlist and rejects na', () => {
    expect(SUPPORTED_SUPERTONIC_LANGUAGES).toEqual([
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
    ]);
    expect(() => prepareSupertonicText('hello', 'na', parsedIndexer())).toThrow(
      'Unsupported Supertonic language.',
    );
  });

  it('normalizes with NFKD, sanitizes reviewed emoji/symbols/expressions, and wraps tags', () => {
    const [chunk] = prepareSupertonicText(
      'Caf\u00e9 😀 — test@example.com ♥',
      'en',
      parsedIndexer(),
    );

    expect(chunk?.text).toBe('<en>Cafe\u0301 - test at example.com.</en>');
  });

  it('adds terminal punctuation and rejects empty or sanitized-empty aggregates', () => {
    expect(prepareSupertonicText('hello', 'en', parsedIndexer())[0]?.text).toBe('<en>hello.</en>');
    for (const text of ['', ' \n\t ', '😀 ♥']) {
      expect(() => prepareSupertonicText(text, 'en', parsedIndexer())).toThrow(
        'Supertonic text is empty after sanitation.',
      );
    }
  });

  it('rejects unpaired surrogates and more than 2,000 raw Unicode scalars', () => {
    expect(() => prepareSupertonicText('\ud800', 'en', parsedIndexer())).toThrow(
      'Supertonic text contains an unpaired surrogate.',
    );
    expect(() => prepareSupertonicText('\udc00', 'en', parsedIndexer())).toThrow(
      'Supertonic text contains an unpaired surrogate.',
    );
    expect(() => prepareSupertonicText('a'.repeat(2_001), 'en', parsedIndexer())).toThrow(
      'Supertonic text exceeds 2,000 Unicode scalars.',
    );
  });

  it('traverses an astral scalar exactly once and maps an out-of-index code point to -1', () => {
    const [chunk] = prepareSupertonicText('A\u{10400}B', 'en', parsedIndexer());

    expect(chunk).toBeDefined();
    expect(chunk?.textIds).toHaveLength(scalarLength(chunk?.text ?? ''));
    expect([...chunk!.textIds].filter((value) => value === -1n)).toHaveLength(1);
  });

  it.each([
    ['ja' as const, 'あ', 120, 130],
    ['ko' as const, '한', 120, 130],
    ['en' as const, 'a', 300, 310],
  ])(
    'hard-splits overlong %s sentences under scalar and tagged-token caps',
    (language, scalar, cap, tokenCap) => {
      const chunks = prepareSupertonicText(scalar.repeat(cap + 1), language, parsedIndexer());

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        const inner = chunk.text.slice(`<${language}>`.length, -`</${language}>`.length);
        expect(scalarLength(inner)).toBeLessThanOrEqual(cap);
        expect(chunk.textIds.length).toBeLessThanOrEqual(tokenCap);
      }
    },
  );

  it('preserves paragraph and abbreviation-aware sentence order while packing', () => {
    const chunks = prepareSupertonicText(
      `Dr. Ada arrived. ${'x'.repeat(285)}!\n\nSecond paragraph.`,
      'en',
      parsedIndexer(),
    );

    expect(chunks.map(({ text }) => text)).toEqual([
      '<en>Dr. Ada arrived.</en>',
      `<en>${'x'.repeat(285)}!</en>`,
      '<en>Second paragraph.</en>',
    ]);
  });

  it('rejects more than 32 nonempty paragraph chunks', () => {
    expect(() =>
      prepareSupertonicText(
        new Array<string>(33).fill('paragraph').join('\n\n'),
        'en',
        parsedIndexer(),
      ),
    ).toThrow('Supertonic text exceeds 32 sanitized chunks.');
  });
});

describe('Supertonic closed JSON parsers', () => {
  it('parses only the exact pinned configuration invariants', () => {
    expect(parsedConfig()).toEqual({
      ttsVersion: 'v1.7.3',
      split: 'opensource-multilingual',
      sampleRate: 44_100,
      baseChunkSize: 512,
      compression: 6,
      latentDimension: 24,
      latentHop: 3_072,
      latentChannels: 144,
    });

    const wrong = JSON.parse(validConfigJson()) as Record<string, unknown>;
    wrong.extra = true;
    expect(() => parseSupertonicConfig(JSON.stringify(wrong))).toThrow(
      'Supertonic tts.json top-level keys are invalid.',
    );
    expect(() => parseSupertonicConfig(`{"tts_version":"ATTACK_SENTINEL"}`)).not.toThrow(
      /ATTACK_SENTINEL/,
    );
  });

  it('enforces the 16 KiB configuration parse cap before parsing', () => {
    expect(() => parseSupertonicConfig(' '.repeat(16 * 1_024 + 1))).toThrow(
      'Supertonic tts.json exceeds 16 KiB.',
    );
  });

  it('requires the exact 65,536-entry index permutation and preserves unknown sentinels', () => {
    const index = parsedIndexer();

    expect(index).toBeInstanceOf(Int32Array);
    expect(index).toHaveLength(65_536);
    expect(index[0]).toBe(0);
    expect(index[8_320]).toBe(8_320);
    expect(index[65_535]).toBe(-1);

    const duplicate = JSON.parse(validIndexerJson()) as number[];
    duplicate[0] = 1;
    expect(() => parseUnicodeIndexer(JSON.stringify(duplicate))).toThrow(
      'Supertonic unicode index permutation is invalid.',
    );
  });

  it('enforces the 320 KiB index parse cap and fixed safe errors', () => {
    expect(() => parseUnicodeIndexer(' '.repeat(320 * 1_024 + 1))).toThrow(
      'Supertonic unicode_indexer.json exceeds 320 KiB.',
    );
    expect(() => parseUnicodeIndexer('["ATTACK_SENTINEL"]')).not.toThrow(/ATTACK_SENTINEL/);
  });

  it('parses one exact single-batch float32 style without requiring a 44.1 kHz source', () => {
    const style = parsedStyle();

    expect(style.ttl).toBeInstanceOf(Float32Array);
    expect(style.ttl).toHaveLength(12_800);
    expect(style.dp).toBeInstanceOf(Float32Array);
    expect(style.dp).toHaveLength(128);
    expect(style.metadata).toEqual({
      sourceFile: 'M1.wav',
      sourceSampleRate: 24_000,
      targetSampleRate: 44_100,
      extractedAt: '2026-04-28T10:39:35.994767',
    });
  });

  it.each([
    ['unknown top-level field', (style: Record<string, unknown>) => (style.extra = true)],
    [
      'wrong TTL dimensions',
      (style: Record<string, unknown>) =>
        (((style.style_ttl as Record<string, unknown>).dims as number[])[1] = 49),
    ],
    [
      'nonfinite value',
      (style: Record<string, unknown>) =>
        (((style.style_dp as { data: number[][][] }).data[0]![0]![0] as number) = Infinity),
    ],
    [
      'wrong target rate',
      (style: Record<string, unknown>) =>
        ((style.metadata as Record<string, unknown>).target_sample_rate = 48_000),
    ],
  ])('rejects a style with %s', (_label, mutate) => {
    const style = validStyleValue();
    mutate(style);
    expect(() => parseSupertonicStyle(JSON.stringify(style))).toThrow(/Supertonic style/);
  });

  it('enforces the 320 KiB style cap and never echoes attacker-controlled content', () => {
    const oversized = JSON.stringify({ sentinel: 'ATTACK_SENTINEL'.repeat(30_000) });
    expect(textEncoder.encode(oversized).byteLength).toBeGreaterThan(320 * 1_024);
    expect(() => parseSupertonicStyle(oversized)).toThrow('Supertonic style JSON exceeds 320 KiB.');
    expect(() => parseSupertonicStyle('{"ATTACK_SENTINEL":true}')).not.toThrow(/ATTACK_SENTINEL/);
  });
});

describe('Supertonic deterministic random source', () => {
  it('matches the pinned Mulberry32 unsigned integer sequence', () => {
    const random = createSupertonicRandom(42);
    expect(new Array<number>(6).fill(0).map(() => random.nextUint32())).toEqual([
      2_581_720_956, 1_925_393_290, 3_661_312_704, 2_876_485_805, 750_819_978, 2_261_697_747,
    ]);
  });

  it('matches open-uniform Box-Muller normals and carries the cached spare across a boundary', () => {
    const random = createSupertonicRandom(42);
    const first = random.nextNormal();
    const boundary = [random.nextNormal(), random.nextNormal()];
    const rest = [random.nextNormal(), random.nextNormal(), random.nextNormal()];

    expect([first, ...boundary, ...rest]).toEqual([
      expect.closeTo(-0.9561622294378207, 14),
      expect.closeTo(0.3220702485608626, 14),
      expect.closeTo(-0.27302610440398517, 14),
      expect.closeTo(-0.4946727576648158, 14),
      expect.closeTo(-1.8416271842047995, 14),
      expect.closeTo(-0.310605741022902, 14),
    ]);
  });
});

describe('Supertonic ORT port', () => {
  it('accepts official differing dynamic symbols across encoder output and vector input', () => {
    expect(
      prepareTransformedMetadata((_session, _direction, _name, shape) => shape).sessions,
    ).toHaveLength(4);
  });

  it('fails closed when session order or a fixed ABI axis differs', () => {
    const runtime = makeFakeRuntime();
    expect(() =>
      prepareSupertonicOrtPort({
        createTensor: runtime.port.createTensor,
        sessions: [
          runtime.sessions[1],
          runtime.sessions[0],
          runtime.sessions[2],
          runtime.sessions[3],
        ],
      }),
    ).toThrow('Supertonic duration predictor ABI is invalid.');

    const metadata = officialMetadata();
    const badVector = new FakeSession(
      metadata[2].inputNames,
      metadata[2].outputNames,
      metadata[2].inputMetadata.map((entry) =>
        entry.name === 'noisy_latent'
          ? tensorMetadata('noisy_latent', 'float32', ['batch_size', 143, 'latent_length'])
          : entry,
      ),
      metadata[2].outputMetadata,
      async () => ({}),
    );
    expect(() =>
      prepareSupertonicOrtPort({
        createTensor: runtime.port.createTensor,
        sessions: [runtime.sessions[0], runtime.sessions[1], badVector, runtime.sessions[3]],
      }),
    ).toThrow('Supertonic vector estimator ABI is invalid.');
  });

  it('rejects mismatched text axes across duration, encoder, and vector sessions', () => {
    const runtime = makeFakeRuntime();
    const metadata = officialMetadata();
    const badVector = new FakeSession(
      metadata[2].inputNames,
      metadata[2].outputNames,
      metadata[2].inputMetadata.map((entry) =>
        entry.name === 'text_mask'
          ? tensorMetadata('text_mask', 'float32', ['batch_size', 1, 'other_text_length'])
          : entry,
      ),
      metadata[2].outputMetadata,
      async () => ({}),
    );

    expect(() =>
      prepareSupertonicOrtPort({
        createTensor: runtime.unprepared.createTensor,
        sessions: [runtime.sessions[0], runtime.sessions[1], badVector, runtime.sessions[3]],
      }),
    ).toThrow('Supertonic vector estimator ABI is invalid.');
  });

  it('rejects mismatched latent axes across vector inputs/output and the vocoder', () => {
    const runtime = makeFakeRuntime();
    const metadata = officialMetadata();
    const badVocoder = new FakeSession(
      metadata[3].inputNames,
      metadata[3].outputNames,
      [tensorMetadata('latent', 'float32', ['batch_size', 144, 'other_latent_length'])],
      metadata[3].outputMetadata,
      async () => ({}),
    );

    expect(() =>
      prepareSupertonicOrtPort({
        createTensor: runtime.unprepared.createTensor,
        sessions: [runtime.sessions[0], runtime.sessions[1], runtime.sessions[2], badVocoder],
      }),
    ).toThrow('Supertonic vocoder ABI is invalid.');
  });

  it('rejects fixed encoder output batch two against dynamic vector batch metadata', () => {
    expect(() =>
      prepareTransformedMetadata((session, direction, name, shape) =>
        session === 1 && direction === 'output' && name === 'text_emb' ? [2, 256, 99] : shape,
      ),
    ).toThrow('Supertonic text encoder ABI is invalid.');
  });

  it('rejects conflicting concrete text lengths across encoder input, output, and vector input', () => {
    expect(() =>
      prepareTransformedMetadata((session, direction, name, shape) => {
        if (session === 1 && direction === 'output' && name === 'text_emb') {
          return replaceShapeAxis(shape, 2, 8);
        }
        const isTextInput =
          direction === 'input' &&
          ((session <= 1 && (name === 'text_ids' || name === 'text_mask')) ||
            (session === 2 && (name === 'text_emb' || name === 'text_mask')));
        return isTextInput ? replaceShapeAxis(shape, shape.length - 1, 7) : shape;
      }),
    ).toThrow('Supertonic text encoder ABI is invalid.');
  });

  it('accepts compatible concrete batch and text axes throughout the joined sessions', () => {
    expect(() =>
      prepareTransformedMetadata((session, direction, name, shape) => {
        let compatible = replaceShapeAxis(shape, 0, 1);
        const isTextAxis =
          (session === 1 && direction === 'output' && name === 'text_emb') ||
          (direction === 'input' &&
            ((session <= 1 && (name === 'text_ids' || name === 'text_mask')) ||
              (session === 2 && (name === 'text_emb' || name === 'text_mask'))));
        if (isTextAxis) compatible = replaceShapeAxis(compatible, compatible.length - 1, 7);
        return compatible;
      }),
    ).not.toThrow();
  });

  it('rejects conflicting concrete encoder-output and vector-input batch axes', () => {
    expect(() =>
      prepareTransformedMetadata((session, direction, name, shape) => {
        const batch = session === 1 && direction === 'output' && name === 'text_emb' ? 2 : 1;
        return replaceShapeAxis(shape, 0, batch);
      }),
    ).toThrow('Supertonic text encoder ABI is invalid.');
  });

  it('rejects a fixed non-unit batch even when every session agrees on it', () => {
    expect(() =>
      prepareTransformedMetadata((_session, _direction, _name, shape) =>
        replaceShapeAxis(shape, 0, 2),
      ),
    ).toThrow('Supertonic text encoder ABI is invalid.');
  });
});

describe('Supertonic synthesis lifecycle', () => {
  it('rejects a structurally identical port that did not pass ABI preparation', async () => {
    const runtime = makeFakeRuntime();
    await expect(
      synthesizeSupertonic({
        text: 'Preparation boundary.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: runtime.unprepared as PreparedSupertonicOrtPort,
      }),
    ).rejects.toThrow('Supertonic ORT port has not passed ABI preparation.');
    expect(runtime.sessions.every(({ calls }) => calls.length === 0)).toBe(true);
    expect(runtime.tensors).toHaveLength(0);
  });

  it('rejects a reflective clone of a prepared port even when every own key is copied', async () => {
    const runtime = makeFakeRuntime();
    const forged = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors(runtime.port),
    ) as PreparedSupertonicOrtPort;

    await expect(
      synthesizeSupertonic({
        text: 'Unforgeable preparation boundary.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: forged,
      }),
    ).rejects.toThrow('Supertonic ORT port has not passed ABI preparation.');
    expect(runtime.sessions.every(({ calls }) => calls.length === 0)).toBe(true);
    expect(runtime.tensors).toHaveLength(0);
  });

  it('disposes style TTL when the following style DP allocation throws', async () => {
    const runtime = makeFakeRuntime({ failCreateAt: 2 });
    const progress: Array<readonly [number, number]> = [];

    await expect(
      synthesizeSupertonic({
        text: 'Style allocation failure.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: runtime.port,
        onProgress: (completed, total) => progress.push([completed, total]),
      }),
    ).rejects.toThrow('Supertonic test tensor allocation failed.');

    expect(runtime.tensors).toHaveLength(1);
    expect(runtime.tensors[0]?.disposeCalls).toBe(1);
    expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([0, 0, 0, 0]);
    expect(progress).toEqual([]);
  });

  it('disposes styles and text IDs when the following text-mask allocation throws', async () => {
    const runtime = makeFakeRuntime({ failCreateAt: 4 });
    const progress: Array<readonly [number, number]> = [];

    await expect(
      synthesizeSupertonic({
        text: 'Text allocation failure.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: runtime.port,
        onProgress: (completed, total) => progress.push([completed, total]),
      }),
    ).rejects.toThrow('Supertonic test tensor allocation failed.');

    expect(runtime.tensors).toHaveLength(3);
    for (const tensor of runtime.tensors) expect(tensor.disposeCalls).toBe(1);
    expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([0, 0, 0, 0]);
    expect(progress).toEqual([]);
  });

  it('disposes prior leases when the first denoising step allocation pair is interrupted', async () => {
    const runtime = makeFakeRuntime({ failCreateAt: 9 });
    const progress: Array<readonly [number, number]> = [];

    await expect(
      synthesizeSupertonic({
        text: 'Denoising allocation failure.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: runtime.port,
        onProgress: (completed, total) => progress.push([completed, total]),
      }),
    ).rejects.toThrow('Supertonic test tensor allocation failed.');

    expect(runtime.tensors).toHaveLength(8);
    for (const tensor of runtime.tensors) expect(tensor.disposeCalls).toBe(1);
    for (const tensor of runtime.outputs) expect(tensor.disposeCalls).toBe(1);
    expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([1, 1, 0, 0]);
    expect(progress).toEqual([
      [1, 11],
      [2, 11],
    ]);
  });

  it('runs exact feeds in duration/text/eight-vector/vocoder order with bounded flat allocation', async () => {
    const runtime = makeFakeRuntime({ duration: 60 });
    const progress: Array<readonly [number, number]> = [];
    const pcm = await synthesizeSupertonic({
      text: 'Bounded allocation.',
      language: 'en',
      speed: 1,
      config: parsedConfig(),
      indexer: parsedIndexer(),
      style: parsedStyle(),
      ort: runtime.port,
      onProgress: (completed, total) => progress.push([completed, total]),
    });

    expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([1, 1, 8, 1]);
    expect(Object.keys(runtime.sessions[0].calls[0] ?? {})).toEqual([
      'text_ids',
      'style_dp',
      'text_mask',
    ]);
    expect(Object.keys(runtime.sessions[1].calls[0] ?? {})).toEqual([
      'text_ids',
      'style_ttl',
      'text_mask',
    ]);
    expect(Object.keys(runtime.sessions[2].calls[0] ?? {})).toEqual([
      'noisy_latent',
      'text_emb',
      'style_ttl',
      'latent_mask',
      'text_mask',
      'current_step',
      'total_step',
    ]);
    expect(Object.keys(runtime.sessions[3].calls[0] ?? {})).toEqual(['latent']);
    const initialLatent = runtime.sessions[2].calls[0]?.noisy_latent;
    expect(initialLatent?.dims).toEqual([1, 144, 862]);
    expect((initialLatent?.dims[1] ?? 0) * (initialLatent?.dims[2] ?? 0)).toBe(124_128);
    expect(pcm).toHaveLength(2_646_000);
    expect(progress).toEqual(new Array<number>(11).fill(0).map((_, index) => [index + 1, 11]));
  });

  it('trims every padded chunk before inserting exact inter-chunk silence', async () => {
    const runtime = makeFakeRuntime({ duration: 0.1 });
    const progress: Array<readonly [number, number]> = [];
    const sentence = 'a'.repeat(299) + '.';
    const pcm = await synthesizeSupertonic({
      text: `${sentence} ${sentence}`,
      language: 'en',
      speed: 1,
      config: parsedConfig(),
      indexer: parsedIndexer(),
      style: parsedStyle(),
      ort: runtime.port,
      onProgress: (completed, total) => progress.push([completed, total]),
    });

    expect(runtime.sessions[3].calls).toHaveLength(2);
    expect(runtime.sessions[3].calls[0]?.latent?.dims).toEqual([1, 144, 2]);
    expect(pcm).toHaveLength(22_050);
    expect(pcm.slice(4_410, 4_410 + 13_230).every((sample) => sample === 0)).toBe(true);
    expect(progress).toEqual(new Array<number>(22).fill(0).map((_, index) => [index + 1, 22]));
  });

  it('claims every output with ownership transfer and disposes every tensor exactly once', async () => {
    const runtime = makeFakeRuntime();
    await synthesizeSupertonic({
      text: 'Lifecycle.',
      language: 'en',
      speed: 1,
      config: parsedConfig(),
      indexer: parsedIndexer(),
      style: parsedStyle(),
      ort: runtime.port,
    });

    expect(runtime.outputs.length).toBe(11);
    for (const tensor of runtime.outputs) {
      expect(tensor.getDataCalls).toEqual([true]);
      expect(tensor.disposeCalls).toBe(1);
    }
    for (const tensor of runtime.tensors) expect(tensor.disposeCalls).toBe(1);
  });

  it('aborts later stages on first failure while disposing everything already created', async () => {
    const runtime = makeFakeRuntime({ failVectorStep: 3 });
    await expect(
      synthesizeSupertonic({
        text: 'Failure boundary.',
        language: 'en',
        speed: 1,
        config: parsedConfig(),
        indexer: parsedIndexer(),
        style: parsedStyle(),
        ort: runtime.port,
      }),
    ).rejects.toThrow('vector failed');

    expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([1, 1, 3, 0]);
    for (const tensor of runtime.outputs) expect(tensor.disposeCalls).toBe(1);
    for (const tensor of runtime.tensors) expect(tensor.disposeCalls).toBe(1);
  });

  it.each([0.7, 0.8 + Number.EPSILON, 1.3, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid speed %s before inference',
    async (speed) => {
      const runtime = makeFakeRuntime();
      await expect(
        synthesizeSupertonic({
          text: 'Speed.',
          language: 'en',
          speed,
          config: parsedConfig(),
          indexer: parsedIndexer(),
          style: parsedStyle(),
          ort: runtime.port,
        }),
      ).rejects.toThrow('Supertonic speed must be 0.75..1.25 in 0.05 steps.');
      expect(runtime.sessions.every(({ calls }) => calls.length === 0)).toBe(true);
    },
  );

  it.each([0.049, 60.001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid post-speed duration %s before later inference',
    async (duration) => {
      const runtime = makeFakeRuntime({ duration });
      await expect(
        synthesizeSupertonic({
          text: 'Duration.',
          language: 'en',
          speed: 1,
          config: parsedConfig(),
          indexer: parsedIndexer(),
          style: parsedStyle(),
          ort: runtime.port,
        }),
      ).rejects.toThrow('Supertonic chunk duration must be finite and within 0.05..60 seconds.');
      expect(runtime.sessions.map(({ calls }) => calls.length)).toEqual([1, 0, 0, 0]);
    },
  );
});

describe('Supertonic PCM and WAV boundary', () => {
  it('accepts finite non-silent bounded PCM with no more than five percent clipped samples', () => {
    const pcm = new Float32Array(100).fill(0.1);
    pcm.fill(1, 0, 5);
    expect(validateSupertonicPcm(pcm)).toBe(pcm);
  });

  it.each([
    ['empty', new Float32Array()],
    ['nonfinite', new Float32Array([0.1, Number.NaN])],
    ['peak', new Float32Array(100).fill(0.000_009)],
    [
      'rms',
      (() => {
        const pcm = new Float32Array(1_000);
        pcm[0] = 0.000_01;
        return pcm;
      })(),
    ],
    ['absolute bound', new Float32Array([4.01, 0.1])],
    [
      'clipping ratio',
      (() => {
        const pcm = new Float32Array(100).fill(0.1);
        pcm.fill(1, 0, 6);
        return pcm;
      })(),
    ],
  ])('rejects %s PCM with a fixed invariant error', (_label, pcm) => {
    expect(() => validateSupertonicPcm(pcm)).toThrow(/Supertonic PCM/);
  });

  it('writes exact explicit little-endian signed PCM16 values without mutating input', () => {
    const pcm = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const before = pcm.slice();
    const wav = encodeSupertonicWav(pcm);
    const view = new DataView(wav);

    expect(pcm).toEqual(before);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
      -32_768, -16_384, 0, 16_384, 32_767,
    ]);
  });

  it('writes a mono 44.1 kHz RIFF/WAVE/fmt/data header with exact lengths', () => {
    const wav = encodeSupertonicWav(new Float32Array([0.25, -0.25]));
    const bytes = new Uint8Array(wav);
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...bytes.slice(offset, offset + length));

    expect(ascii(0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(40);
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(SUPERTONIC_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(88_200);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(4);
    expect(wav.byteLength).toBe(48);
  });
});

describe('Supertonic source safety boundary', () => {
  it('keeps the core network-free, ORT-injected, flat, deterministic, and fully attributed', async () => {
    const [coreSource, portSource] = await Promise.all([
      readFile(join(currentDirectory, 'core.ts'), 'utf8'),
      readFile(join(currentDirectory, 'ort-port.ts'), 'utf8'),
    ]);
    const productionSource = `${coreSource}\n${portSource}`;

    expect(productionSource).toContain('dff55dc00064c398736080c78195f577527832ae');
    expect(productionSource).toContain('Copyright (c) 2025 Supertone Inc.');
    expect(productionSource).toContain(
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
    );
    expect(productionSource).toContain(
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
    );
    expect(productionSource).not.toMatch(/\bfetch\s*\(/);
    expect(productionSource).not.toMatch(/\bXMLHttpRequest\b|\bimportScripts\b/);
    expect(productionSource).not.toMatch(/from ['"]onnxruntime-web|import\(['"]onnxruntime-web/);
    expect(productionSource).not.toMatch(/Math\s*\.\s*random/);
    expect(productionSource).not.toMatch(/\.flat\s*\(|Array\.from\s*\(/);
    expect(productionSource).not.toMatch(/\.data\b/);
  });
});
