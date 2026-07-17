import { describe, expect, it, vi } from 'vitest';

import {
  SUPERTONIC_ASSET_SET_ID,
  SUPERTONIC_MANIFEST_DIGEST,
  SUPERTONIC_RUNTIME_IDENTITIES,
  SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES,
  WorkerCommandSchema,
  type BrowserRuntimeBackend,
  type SupertonicPrepareWorkerCommand,
  type WorkerCommand,
} from '@open-voice/contracts';

import type { SupertonicConfig, SupertonicStyle } from './core';
import type { PreparedSupertonicOrtPort, SupertonicOrtPort } from './ort-port';
import {
  installSupertonicWorkerRuntime,
  type SupertonicOrtModulePort,
  type SupertonicOrtSessionPort,
  type SupertonicWorkerRuntimeDependencies,
  type SupertonicWorkerScope,
} from './worker-runtime';

class FakeWorkerScope implements SupertonicWorkerScope {
  private listener: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly messages: unknown[] = [];
  readonly transfers: Transferable[][] = [];
  closed = false;
  closeCalls = 0;

  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void {
    this.listener = listener;
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.messages.push(message);
    this.transfers.push([...transfer]);
  }

  close(): void {
    this.closeCalls += 1;
    this.closed = true;
  }

  emit(message: unknown): void {
    this.listener?.(new MessageEvent('message', { data: message }));
  }
}

class ThrowingResponseWorkerScope extends FakeWorkerScope {
  constructor(private readonly responseType: 'ready' | 'result') {
    super();
  }

  override postMessage(message: unknown, transfer: Transferable[] = []): void {
    if ((message as { type?: unknown }).type === this.responseType) {
      throw new Error(`fixture ${this.responseType} post failure`);
    }
    super.postMessage(message, transfer);
  }
}

async function flushRuntime(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const CONFIG: SupertonicConfig = {
  ttsVersion: 'v1.7.3',
  split: 'opensource-multilingual',
  sampleRate: 44_100,
  baseChunkSize: 512,
  compression: 6,
  latentDimension: 24,
  latentHop: 3_072,
  latentChannels: 144,
};

const STYLE: SupertonicStyle = {
  ttl: new Float32Array(12_800).fill(0.01),
  dp: new Float32Array(128).fill(0.02),
  metadata: {
    sourceFile: 'fixture.wav',
    sourceSampleRate: 44_100,
    targetSampleRate: 44_100,
    extractedAt: '2026-07-17T00:00:00Z',
  },
};

type TinyPrepareFixture = {
  command: SupertonicPrepareWorkerCommand;
  buffers: ArrayBuffer[];
  byAssetId: ReadonlyMap<string, ArrayBuffer>;
  runtimeBuffer: ArrayBuffer;
};

function makeTinyPrepare(
  operationId = 1,
  backend: BrowserRuntimeBackend = 'wasm',
  voiceId = 'supertonic:F1',
): TinyPrepareFixture {
  const runtime = SUPERTONIC_RUNTIME_IDENTITIES[backend];
  const assets = SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.map((identity, index) => ({
    ...identity,
    bytes: new Uint8Array([index + 1, 2, 3, 4]).buffer,
  }));
  const runtimeBuffer = new Uint8Array([0, 97, 115, 109]).buffer;
  const command = {
    command: 'prepare',
    operationId,
    engineId: 'supertonic',
    voiceId,
    selectionId: runtime.selectionId,
    selectionDigest: runtime.selectionDigest,
    backend,
    assetSetId: SUPERTONIC_ASSET_SET_ID,
    manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
    runtimeArtifactId: runtime.artifactId,
    assets,
    runtimeArtifact: {
      artifactId: runtime.artifactId,
      sha256: runtime.sha256,
      byteLength: runtime.byteLength,
      mediaType: runtime.mediaType,
      bytes: runtimeBuffer,
    },
  } as unknown as SupertonicPrepareWorkerCommand;
  return {
    command,
    buffers: [...assets.map(({ bytes }) => bytes), runtimeBuffer],
    byAssetId: new Map(assets.map(({ assetId, bytes }) => [assetId, bytes])),
    runtimeBuffer,
  };
}

function injectedCommandParser(value: unknown): WorkerCommand {
  return value as WorkerCommand;
}

function prepareBypassCommandParser(value: unknown): WorkerCommand {
  if (typeof value === 'object' && value !== null && Reflect.get(value, 'command') === 'prepare') {
    return value as WorkerCommand;
  }
  return WorkerCommandSchema.parse(value);
}

function baseDependencies(
  overrides: Partial<SupertonicWorkerRuntimeDependencies> = {},
): SupertonicWorkerRuntimeDependencies {
  return {
    parseCommand: injectedCommandParser,
    parseConfig: () => CONFIG,
    parseIndexer: () => new Int32Array(65_536),
    parseStyle: () => STYLE,
    prepareOrt: (port: SupertonicOrtPort) => port as PreparedSupertonicOrtPort,
    synthesize: async () => new Float32Array([0.25, -0.25]),
    validatePcm: (pcm: Float32Array) => pcm,
    encodeWav: () => new Uint8Array([82, 73, 70, 70]).buffer,
    ...overrides,
  };
}

type FakeOrtState = {
  readonly module: SupertonicOrtModulePort;
  readonly createCalls: Array<{
    buffer: ArrayBufferLike;
    options: unknown;
    runtimeBinary: ArrayBufferLike | Uint8Array | undefined;
  }>;
  readonly releaseOrder: string[];
  readonly sessions: readonly SupertonicOrtSessionPort[];
};

function makeOrtState(options: { failAt?: number; events?: string[] } = {}): FakeOrtState {
  const createCalls: FakeOrtState['createCalls'] = [];
  const releaseOrder: string[] = [];
  const sessionNames = ['duration', 'text', 'vector', 'vocoder'];
  const env = { wasm: {} as Record<string, unknown> };
  const sessions = sessionNames.map(
    (name) =>
      ({
        inputNames: [],
        outputNames: [],
        inputMetadata: [],
        outputMetadata: [],
        run: vi.fn(async () => ({})),
        release: vi.fn(async () => {
          releaseOrder.push(name);
          options.events?.push(`release:${name}`);
        }),
      }) satisfies SupertonicOrtSessionPort,
  );
  const module = {
    env,
    InferenceSession: {
      create: vi.fn(async (buffer: ArrayBufferLike, sessionOptions: unknown) => {
        const callNumber = createCalls.length + 1;
        createCalls.push({
          buffer,
          options: sessionOptions,
          runtimeBinary: env.wasm['wasmBinary'] as ArrayBufferLike | Uint8Array | undefined,
        });
        options.events?.push(`session:${callNumber}`);
        if (options.failAt === callNumber) throw new Error('raw session failure');
        return sessions[callNumber - 1]!;
      }),
    },
    Tensor: class {
      readonly type: string;
      readonly dims: readonly number[];
      readonly data: Float32Array | BigInt64Array;

      constructor(type: string, data: Float32Array | BigInt64Array, dims: readonly number[]) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }

      async getData(): Promise<Float32Array | BigInt64Array> {
        return this.data;
      }

      dispose(): void {}
    },
  } as unknown as SupertonicOrtModulePort;
  return { module, createCalls, releaseOrder, sessions };
}

function jsonBuffer(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function validConfigJson(): unknown {
  return {
    tts_version: 'v1.7.3',
    split: 'opensource-multilingual',
    ttl: { latent_dim: 24, chunk_compress_factor: 6 },
    ae: { sample_rate: 44_100, base_chunk_size: 512, ldim: 24 },
    dp: { latent_dim: 24, chunk_compress_factor: 6 },
  };
}

function validIndexerJson(): number[] {
  return Array.from({ length: 65_536 }, (_value, index) => (index <= 8_320 ? index : -1));
}

function validStyleJson(sourceFile: string): unknown {
  return {
    style_ttl: {
      type: 'float32',
      dims: [1, 50, 256],
      data: [Array.from({ length: 50 }, () => Array.from({ length: 256 }, () => 0.01))],
    },
    style_dp: {
      type: 'float32',
      dims: [1, 8, 16],
      data: [Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => 0.02))],
    },
    metadata: {
      source_file: sourceFile,
      source_sample_rate: 44_100,
      target_sample_rate: 44_100,
      extracted_at: '2026-07-17T00:00:00Z',
    },
  };
}

function makeParsedJsonPrepare(corruptStyleAssetId: string | null = null): TinyPrepareFixture {
  const fixture = makeTinyPrepare();
  const assets = fixture.command.assets.map((asset) => {
    let bytes = asset.bytes;
    if (asset.assetId === 'onnx-tts-json') bytes = jsonBuffer(validConfigJson());
    if (asset.assetId === 'onnx-unicode-indexer-json') bytes = jsonBuffer(validIndexerJson());
    if (asset.assetId.startsWith('voice-styles-')) {
      bytes =
        asset.assetId === corruptStyleAssetId
          ? new TextEncoder().encode('{corrupt').buffer
          : jsonBuffer(validStyleJson(`${asset.assetId}.wav`));
    }
    return { ...asset, bytes };
  });
  const command = { ...fixture.command, assets } as SupertonicPrepareWorkerCommand;
  return {
    command,
    buffers: [...assets.map(({ bytes }) => bytes), fixture.runtimeBuffer],
    byAssetId: new Map(assets.map(({ assetId, bytes }) => [assetId, bytes])),
    runtimeBuffer: fixture.runtimeBuffer,
  };
}

function paddedJsonBuffer(value: unknown, byteLength: number): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > byteLength) throw new Error('Exact JSON fixture exceeds frozen bytes.');
  const buffer = new ArrayBuffer(byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.fill(0x20);
  bytes.set(encoded);
  return buffer;
}

function makeExactPrepare(): TinyPrepareFixture & { declaredBytes: number } {
  const runtime = SUPERTONIC_RUNTIME_IDENTITIES.wasm;
  const config = validConfigJson();
  const indexer = validIndexerJson();
  const style = validStyleJson('exact-fixture.wav');
  const assets = SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.map((identity) => {
    let bytes: ArrayBuffer;
    if (identity.assetId === 'onnx-tts-json') {
      bytes = paddedJsonBuffer(config, identity.byteLength);
    } else if (identity.assetId === 'onnx-unicode-indexer-json') {
      bytes = paddedJsonBuffer(indexer, identity.byteLength);
    } else if (identity.assetId.startsWith('voice-styles-')) {
      bytes = paddedJsonBuffer(style, identity.byteLength);
    } else {
      bytes = new ArrayBuffer(identity.byteLength);
    }
    return { ...identity, bytes };
  });
  const runtimeBuffer = new ArrayBuffer(runtime.byteLength);
  const command = {
    command: 'prepare',
    operationId: 1,
    engineId: 'supertonic',
    voiceId: 'supertonic:F1',
    selectionId: runtime.selectionId,
    selectionDigest: runtime.selectionDigest,
    backend: 'wasm',
    assetSetId: SUPERTONIC_ASSET_SET_ID,
    manifestDigest: SUPERTONIC_MANIFEST_DIGEST,
    runtimeArtifactId: runtime.artifactId,
    assets,
    runtimeArtifact: {
      artifactId: runtime.artifactId,
      sha256: runtime.sha256,
      byteLength: runtime.byteLength,
      mediaType: runtime.mediaType,
      bytes: runtimeBuffer,
    },
  } as SupertonicPrepareWorkerCommand;
  return {
    command,
    buffers: [...assets.map(({ bytes }) => bytes), runtimeBuffer],
    byAssetId: new Map(assets.map(({ assetId, bytes }) => [assetId, bytes])),
    runtimeBuffer,
    declaredBytes:
      SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.reduce<number>(
        (total, identity) => total + identity.byteLength,
        0,
      ) + runtime.byteLength,
  };
}

function synthesizeCommand(
  operationId: number,
  overrides: Partial<{
    voiceId: string;
    text: string;
    language: string;
    speed: number;
  }> = {},
): unknown {
  return {
    command: 'synthesize',
    operationId,
    engineId: 'supertonic',
    voiceId: overrides.voiceId ?? 'supertonic:F1',
    text: overrides.text ?? 'A real transferred WAV.',
    controls: {
      language: overrides.language ?? 'en',
      speed: overrides.speed ?? 1.05,
    },
  };
}

function tensorMetadata(
  name: string,
  type: 'float32' | 'int64',
  shape: readonly (number | string)[],
): SupertonicOrtSessionPort['inputMetadata'][number] {
  return { name, isTensor: true, type, shape };
}

function makeAbiOrtState(): FakeOrtState & {
  readonly getDataArguments: boolean[];
  readonly tensorDisposals: string[];
} {
  const createCalls: FakeOrtState['createCalls'] = [];
  const releaseOrder: string[] = [];
  const getDataArguments: boolean[] = [];
  const tensorDisposals: string[] = [];
  const env = { wasm: {} as Record<string, unknown> };

  class RawTensor {
    readonly type: string;
    readonly dims: readonly number[];
    readonly data: Float32Array | BigInt64Array;
    private disposed = false;

    constructor(type: string, data: Float32Array | BigInt64Array, dims: readonly number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }

    async getData(releaseData?: boolean): Promise<Float32Array | BigInt64Array> {
      getDataArguments.push(releaseData === true);
      return this.data;
    }

    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      tensorDisposals.push(`dispose:${this.type}:${this.dims.join('x')}`);
    }
  }

  const duration = {
    inputNames: ['text_ids', 'style_dp', 'text_mask'],
    outputNames: ['duration'],
    inputMetadata: [
      tensorMetadata('text_ids', 'int64', [1, 'text']),
      tensorMetadata('style_dp', 'float32', [1, 8, 16]),
      tensorMetadata('text_mask', 'float32', [1, 1, 'text']),
    ],
    outputMetadata: [tensorMetadata('duration', 'float32', [1])],
    run: vi.fn(async () => ({ duration: new RawTensor('float32', new Float32Array([0.1]), [1]) })),
    release: vi.fn(async () => {
      releaseOrder.push('duration');
    }),
  } satisfies SupertonicOrtSessionPort;
  const text = {
    inputNames: ['text_ids', 'style_ttl', 'text_mask'],
    outputNames: ['text_emb'],
    inputMetadata: [
      tensorMetadata('text_ids', 'int64', [1, 'text']),
      tensorMetadata('style_ttl', 'float32', [1, 50, 256]),
      tensorMetadata('text_mask', 'float32', [1, 1, 'text']),
    ],
    outputMetadata: [tensorMetadata('text_emb', 'float32', [1, 256, 'text'])],
    run: vi.fn(async () => ({})),
    release: vi.fn(async () => {
      releaseOrder.push('text');
    }),
  } satisfies SupertonicOrtSessionPort;
  const vector = {
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
      tensorMetadata('noisy_latent', 'float32', [1, 144, 'latent']),
      tensorMetadata('text_emb', 'float32', [1, 256, 'text']),
      tensorMetadata('style_ttl', 'float32', [1, 50, 256]),
      tensorMetadata('latent_mask', 'float32', [1, 1, 'latent']),
      tensorMetadata('text_mask', 'float32', [1, 1, 'text']),
      tensorMetadata('current_step', 'float32', [1]),
      tensorMetadata('total_step', 'float32', [1]),
    ],
    outputMetadata: [tensorMetadata('denoised_latent', 'float32', [1, 144, 'latent'])],
    run: vi.fn(async () => ({})),
    release: vi.fn(async () => {
      releaseOrder.push('vector');
    }),
  } satisfies SupertonicOrtSessionPort;
  const vocoder = {
    inputNames: ['latent'],
    outputNames: ['wav_tts'],
    inputMetadata: [tensorMetadata('latent', 'float32', [1, 144, 'latent'])],
    outputMetadata: [tensorMetadata('wav_tts', 'float32', [1, 'samples'])],
    run: vi.fn(async () => ({})),
    release: vi.fn(async () => {
      releaseOrder.push('vocoder');
    }),
  } satisfies SupertonicOrtSessionPort;
  const sessions = [duration, text, vector, vocoder];
  const module = {
    env,
    InferenceSession: {
      create: vi.fn(async (buffer: ArrayBufferLike, options: unknown) => {
        createCalls.push({
          buffer,
          options,
          runtimeBinary: env.wasm['wasmBinary'] as ArrayBufferLike | Uint8Array | undefined,
        });
        return sessions[createCalls.length - 1]!;
      }),
    },
    Tensor: RawTensor,
  } as unknown as SupertonicOrtModulePort;
  return { module, createCalls, releaseOrder, sessions, getDataArguments, tensorDisposals };
}

function standaloneSession(name: string, releaseOrder: string[]): SupertonicOrtSessionPort {
  return {
    inputNames: [],
    outputNames: [],
    inputMetadata: [],
    outputMetadata: [],
    run: vi.fn(async () => ({})),
    release: vi.fn(async () => {
      releaseOrder.push(name);
    }),
  };
}

function replaceSessionCreate(
  module: SupertonicOrtModulePort,
  create: SupertonicOrtModulePort['InferenceSession']['create'],
): void {
  (module as { InferenceSession: { create: typeof create } }).InferenceSession.create = create;
}

describe('Supertonic Worker runtime', () => {
  it('fails closed for malformed messages and synthesis before preparation without loading ORT', async () => {
    const scope = new FakeWorkerScope();
    const loadOrt = vi.fn();
    installSupertonicWorkerRuntime(scope, { loadOrt });

    scope.emit({ command: 'unknown', operationId: 7 });
    scope.emit({
      command: 'synthesize',
      operationId: 8,
      engineId: 'supertonic',
      voiceId: 'supertonic:F1',
      text: 'Preparation is required.',
      controls: { language: 'en', speed: 1.05 },
    });
    await flushRuntime();

    expect(scope.messages).toEqual([
      { type: 'error', operationId: 7, message: 'Invalid Supertonic Worker command.' },
      { type: 'error', operationId: 8, message: 'Supertonic Worker is not prepared.' },
    ]);
    expect(loadOrt).not.toHaveBeenCalled();
  });

  it('parses every small input before one backend import and creates four sessions in exact order', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const events: string[] = [];
    const ort = makeOrtState({ events });
    const jsonAssetIds = fixture.command.assets
      .filter(({ mediaType }) => mediaType === 'application/json')
      .map(({ assetId }) => assetId);
    let jsonDetachedAtLoad = false;
    const loadOrt = vi.fn(async (backend: BrowserRuntimeBackend) => {
      events.push(`load:${backend}`);
      jsonDetachedAtLoad = jsonAssetIds.every(
        (assetId) => fixture.byAssetId.get(assetId)?.byteLength === 0,
      );
      return ort.module;
    });
    const dependencies = baseDependencies({
      parseConfig: () => {
        events.push('parse:tts');
        return CONFIG;
      },
      parseIndexer: () => {
        events.push('parse:index');
        return new Int32Array(65_536);
      },
      parseStyle: (bytes) => {
        const assetId = fixture.command.assets.find((asset) => asset.bytes === bytes)?.assetId;
        events.push(`parse:${assetId ?? 'unknown-style'}`);
        return STYLE;
      },
    });
    installSupertonicWorkerRuntime(scope, { loadOrt, dependencies });

    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    expect(events.slice(0, 12)).toEqual([
      'parse:tts',
      'parse:index',
      'parse:voice-styles-f1-json',
      'parse:voice-styles-f2-json',
      'parse:voice-styles-f3-json',
      'parse:voice-styles-f4-json',
      'parse:voice-styles-f5-json',
      'parse:voice-styles-m1-json',
      'parse:voice-styles-m2-json',
      'parse:voice-styles-m3-json',
      'parse:voice-styles-m4-json',
      'parse:voice-styles-m5-json',
    ]);
    expect(events[12]).toBe('load:wasm');
    expect(jsonDetachedAtLoad).toBe(true);
    expect(loadOrt).toHaveBeenCalledExactlyOnceWith('wasm');
    const modelIds = [
      'onnx-duration-predictor-onnx',
      'onnx-text-encoder-onnx',
      'onnx-vector-estimator-onnx',
      'onnx-vocoder-onnx',
    ];
    expect(ort.createCalls.map(({ buffer }) => buffer)).toEqual(
      modelIds.map((assetId) => fixture.byAssetId.get(assetId)),
    );
    expect(ort.createCalls.map(({ options }) => options)).toEqual(
      Array.from({ length: 4 }, () => ({
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })),
    );
    expect(ort.createCalls[0]?.runtimeBinary).toBe(fixture.runtimeBuffer);
    expect(ort.createCalls.slice(1).every(({ runtimeBinary }) => runtimeBinary === undefined)).toBe(
      true,
    );
    expect(ort.module.env.wasm).toMatchObject({ numThreads: 1, proxy: false });
    expect(ort.module.env.wasm.wasmBinary).toBeUndefined();
    expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(ort.releaseOrder).toEqual([]);
  });

  it('rejects a corrupt unselected style before ORT import and detaches the full closure', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeParsedJsonPrepare('voice-styles-m5-json');
    const loadOrt = vi.fn();
    installSupertonicWorkerRuntime(scope, {
      loadOrt,
      dependencies: { parseCommand: injectedCommandParser },
    });

    scope.emit(fixture.command);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));

    expect(scope.messages).toEqual([
      { type: 'error', operationId: 1, message: 'Supertonic Worker operation failed.' },
    ]);
    expect(loadOrt).not.toHaveBeenCalled();
    expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
  });

  it.each([1, 2, 3, 4])(
    'stops after session %i failure, reverses prior cleanup, and discards every source buffer',
    async (failAt) => {
      const scope = new FakeWorkerScope();
      const fixture = makeTinyPrepare();
      const ort = makeOrtState({ failAt });
      installSupertonicWorkerRuntime(scope, {
        loadOrt: async () => ort.module,
        dependencies: baseDependencies(),
      });

      scope.emit(fixture.command);
      await vi.waitFor(() => expect(scope.messages).toHaveLength(1));

      expect(scope.messages).toEqual([
        { type: 'error', operationId: 1, message: 'Supertonic Worker operation failed.' },
      ]);
      expect(ort.createCalls).toHaveLength(failAt);
      expect(ort.releaseOrder).toEqual(
        ['duration', 'text', 'vector', 'vocoder'].slice(0, failAt - 1).reverse(),
      );
      expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
      expect(ort.module.env.wasm.wasmBinary).toBeUndefined();
    },
  );

  it('accepts one exact-size 16+1 closure, proves the declared envelope, and detaches every owner', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeExactPrepare();
    const ort = makeOrtState();
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: {
        prepareOrt: (port) => port as PreparedSupertonicOrtPort,
      },
    });

    expect(fixture.declaredBytes).toBe(414_756_722);
    expect(
      SUPERTONIC_TRANSFERRED_ASSET_IDENTITIES.reduce<number>(
        (total, identity) => total + identity.byteLength,
        SUPERTONIC_RUNTIME_IDENTITIES.webgpu.byteLength,
      ),
    ).toBe(428_104_287);
    scope.emit(fixture.command);
    await vi.waitFor(() => expect(scope.messages).toEqual([{ type: 'ready', operationId: 1 }]), {
      timeout: 10_000,
    });

    expect(ort.createCalls).toHaveLength(4);
    expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(ort.module.env.wasm.wasmBinary).toBeUndefined();
  });

  it('translates monotonic synthesis progress, validates PCM, and transfers the identical WAV', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    const wav = new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0]).buffer;
    const pcm = new Float32Array([0.25, -0.25]);
    const validatePcm = vi.fn((value: Float32Array) => value);
    const encodeWav = vi.fn(() => wav);
    const synthesize = vi.fn(
      async (options: Parameters<SupertonicWorkerRuntimeDependencies['synthesize']>[0]) => {
        options.onProgress?.(2, 4);
        options.onProgress?.(1, 4);
        options.onProgress?.(3, 4);
        options.onProgress?.(4, 4);
        return pcm;
      },
    );
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies({ synthesize, validatePcm, encodeWav }),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual(
        expect.objectContaining({ type: 'result', operationId: 2 }),
      ),
    );

    expect(scope.messages.slice(1)).toEqual([
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 50 },
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 75 },
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 100 },
      { type: 'result', operationId: 2, audio: wav, mimeType: 'audio/wav' },
    ]);
    expect(validatePcm).toHaveBeenCalledExactlyOnceWith(pcm);
    expect(encodeWav).toHaveBeenCalledExactlyOnceWith(pcm);
    const resultIndex = scope.messages.findIndex(
      (message) => (message as { type?: string }).type === 'result',
    );
    expect(scope.transfers[resultIndex]).toEqual([wav]);
    expect((scope.messages[resultIndex] as { audio: ArrayBuffer }).audio).toBe(
      scope.transfers[resultIndex]?.[0],
    );
    expect(ort.releaseOrder).toEqual([]);
  });

  it('fails closed and releases prepared sessions when posting ready throws', async () => {
    const scope = new ThrowingResponseWorkerScope('ready');
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies(),
    });

    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']),
    );

    expect(scope.messages).toEqual([
      { type: 'error', operationId: 1, message: 'Supertonic Worker operation failed.' },
    ]);
    expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    scope.emit(synthesizeCommand(2));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));
    expect(scope.messages[1]).toEqual({
      type: 'error',
      operationId: 2,
      message: 'Supertonic Worker is not prepared.',
    });
  });

  it('fails closed and releases prepared sessions when posting a synthesis result throws', async () => {
    const scope = new ThrowingResponseWorkerScope('result');
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies(),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    await vi.waitFor(() =>
      expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']),
    );

    expect(scope.messages.slice(1)).toEqual([
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 100 },
      { type: 'error', operationId: 2, message: 'Supertonic Worker operation failed.' },
    ]);
    scope.emit(synthesizeCommand(3));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(4));
    expect(scope.messages[3]).toEqual({
      type: 'error',
      operationId: 3,
      message: 'Supertonic Worker is not prepared.',
    });
  });

  it('keeps disposal as terminal owner when result-post cleanup is stalled', async () => {
    const scope = new ThrowingResponseWorkerScope('result');
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    const releaseStarted = deferred<void>();
    const releaseGate = deferred<void>();
    const vocoder = ort.sessions[3]!;
    (vocoder as { release: () => Promise<void> }).release = vi.fn(async () => {
      releaseStarted.resolve(undefined);
      await releaseGate.promise;
      ort.releaseOrder.push('vocoder');
    });
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies(),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    await releaseStarted.promise;
    scope.emit({ command: 'dispose', operationId: 3 });
    await flushRuntime();

    expect(scope.closed).toBe(false);
    expect(scope.closeCalls).toBe(0);
    expect(scope.messages.slice(1)).toEqual([
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 100 },
    ]);

    releaseGate.resolve(undefined);
    await vi.waitFor(() => expect(scope.closed).toBe(true));
    expect(scope.closeCalls).toBe(1);
    expect(scope.messages.slice(1)).toEqual([
      { type: 'progress', operationId: 2, phase: 'synthesis', percent: 100 },
      { type: 'disposed', operationId: 3 },
    ]);
    expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']);
    for (const session of ort.sessions) expect(session.release).toHaveBeenCalledOnce();
  });

  it('adapts real ORT tensors with getData(true) and idempotent disposal', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeAbiOrtState();
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: {
        parseCommand: prepareBypassCommandParser,
        parseConfig: () => CONFIG,
        parseIndexer: () => new Int32Array(65_536),
        parseStyle: () => STYLE,
        synthesize: async (options) => {
          const input = options.ort.createTensor('int64', new BigInt64Array([1n]), [1, 1]);
          const outputs = await options.ort.sessions[0].run({ text_ids: input });
          const duration = outputs['duration'];
          if (duration === undefined) throw new Error('missing duration');
          await duration.getData(true);
          duration.dispose();
          duration.dispose();
          input.dispose();
          input.dispose();
          return new Float32Array([0.2, -0.2]);
        },
        validatePcm: (value) => value,
        encodeWav: () => new ArrayBuffer(48),
      },
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual(
        expect.objectContaining({ type: 'result', operationId: 2 }),
      ),
    );

    expect(ort.getDataArguments).toEqual([true]);
    expect(ort.tensorDisposals).toHaveLength(2);
  });

  it('binds synthesis to the prepared voice and rejects invalid controls, duplicate prepare, and replay', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    const loadOrt = vi.fn(async () => ort.module);
    installSupertonicWorkerRuntime(scope, {
      loadOrt,
      dependencies: baseDependencies({ parseCommand: prepareBypassCommandParser }),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2, { voiceId: 'supertonic:M5' }));
    scope.emit(synthesizeCommand(3, { language: 'xx' }));
    scope.emit(synthesizeCommand(4, { speed: 1.01 }));
    scope.emit(synthesizeCommand(2, { voiceId: 'supertonic:M5' }));
    const duplicateFixture = makeTinyPrepare(5);
    scope.emit(duplicateFixture.command);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(6));

    expect(scope.messages.slice(1)).toEqual([
      {
        type: 'error',
        operationId: 2,
        message: 'Prepared Supertonic voice does not match the synthesis request.',
      },
      { type: 'error', operationId: 3, message: 'Invalid Supertonic Worker command.' },
      { type: 'error', operationId: 4, message: 'Invalid Supertonic Worker command.' },
      {
        type: 'error',
        operationId: 2,
        message: 'Supertonic Worker operation ID was already used.',
      },
      {
        type: 'error',
        operationId: 5,
        message: 'Supertonic Worker already has a preparation lifecycle.',
      },
    ]);
    expect(duplicateFixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(loadOrt).toHaveBeenCalledOnce();
  });

  it('rejects concurrent synthesis while permitting sequential reuse of the prepared sessions', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    const firstSynthesis = deferred<Float32Array>();
    let calls = 0;
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies({
        synthesize: async () => {
          calls += 1;
          return calls === 1 ? await firstSynthesis.promise : new Float32Array([0.3, -0.3]);
        },
      }),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    scope.emit(synthesizeCommand(3));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({
        type: 'error',
        operationId: 3,
        message: 'Supertonic Worker synthesis is already running.',
      }),
    );
    firstSynthesis.resolve(new Float32Array([0.2, -0.2]));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual(
        expect.objectContaining({ type: 'result', operationId: 2 }),
      ),
    );
    scope.emit(synthesizeCommand(4));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual(
        expect.objectContaining({ type: 'result', operationId: 4 }),
      ),
    );

    expect(calls).toBe(2);
    expect(ort.releaseOrder).toEqual([]);
  });

  it('releases all sessions after synthesis failure and refuses later synthesis in that Worker', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies({
        synthesize: async () => {
          throw new Error('private inference failure');
        },
      }),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit(synthesizeCommand(2));
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({
        type: 'error',
        operationId: 2,
        message: 'Supertonic Worker operation failed.',
      }),
    );
    scope.emit(synthesizeCommand(3));
    await vi.waitFor(() => expect(scope.messages).toHaveLength(3));

    expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']);
    expect(scope.messages[2]).toEqual({
      type: 'error',
      operationId: 3,
      message: 'Supertonic Worker is not prepared.',
    });
  });

  it('poisons a Worker after prepare failure so no later prepare is accepted in the same realm', async () => {
    const scope = new FakeWorkerScope();
    const first = makeTinyPrepare();
    const second = makeTinyPrepare(2);
    const ort = makeOrtState({ failAt: 1 });
    const loadOrt = vi.fn(async () => ort.module);
    installSupertonicWorkerRuntime(scope, {
      loadOrt,
      dependencies: baseDependencies(),
    });

    scope.emit(first.command);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(1));
    scope.emit(second.command);
    await vi.waitFor(() => expect(scope.messages).toHaveLength(2));

    expect(scope.messages[1]).toEqual({
      type: 'error',
      operationId: 2,
      message: 'Supertonic Worker already has a preparation lifecycle.',
    });
    expect(second.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
    expect(loadOrt).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'dispose'] as const)(
    '%s during backend import detaches all inputs and suppresses late import completion',
    async (command) => {
      const scope = new FakeWorkerScope();
      const fixture = makeTinyPrepare();
      const loader = deferred<SupertonicOrtModulePort>();
      const loadOrt = vi.fn(() => loader.promise);
      const ort = makeOrtState();
      installSupertonicWorkerRuntime(scope, {
        loadOrt,
        dependencies: baseDependencies(),
      });
      scope.emit(fixture.command);
      await vi.waitFor(() => expect(loadOrt).toHaveBeenCalledOnce());

      scope.emit({ command, operationId: 2 });
      await flushRuntime();
      expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
      if (command === 'dispose') {
        expect(scope.closed).toBe(false);
        expect(scope.messages).toEqual([]);
      } else {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(scope.messages).toEqual([{ type: 'cancelled', operationId: 2 }]);
      }

      loader.resolve(ort.module);
      if (command === 'dispose') {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(scope.messages).toEqual([{ type: 'disposed', operationId: 2 }]);
      } else {
        await flushRuntime();
      }
      expect(ort.createCalls).toHaveLength(0);
      expect(scope.messages).toHaveLength(1);
    },
  );

  it.each(['cancel', 'dispose'] as const)(
    '%s during session creation releases the late session and emits no late prepare response',
    async (command) => {
      const scope = new FakeWorkerScope();
      const fixture = makeTinyPrepare();
      const ort = makeOrtState();
      const late = deferred<SupertonicOrtSessionPort>();
      const lateReleaseOrder: string[] = [];
      const create = vi.fn(() => late.promise);
      replaceSessionCreate(ort.module, create);
      installSupertonicWorkerRuntime(scope, {
        loadOrt: async () => ort.module,
        dependencies: baseDependencies(),
      });
      scope.emit(fixture.command);
      await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());

      scope.emit({ command, operationId: 2 });
      await flushRuntime();
      expect(fixture.buffers.every((buffer) => buffer.byteLength === 0)).toBe(true);
      if (command === 'dispose') {
        expect(scope.closed).toBe(false);
        expect(scope.messages).toEqual([]);
      } else {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(scope.messages).toEqual([{ type: 'cancelled', operationId: 2 }]);
      }

      late.resolve(standaloneSession('late-duration', lateReleaseOrder));
      await vi.waitFor(() => expect(lateReleaseOrder).toEqual(['late-duration']));
      if (command === 'dispose') {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(scope.messages).toEqual([{ type: 'disposed', operationId: 2 }]);
      }
      expect(scope.messages).toHaveLength(1);
    },
  );

  it.each(['cancel', 'dispose'] as const)(
    '%s during inference releases sessions and suppresses late progress, result, and error',
    async (command) => {
      const scope = new FakeWorkerScope();
      const fixture = makeTinyPrepare();
      const ort = makeOrtState();
      const inference = deferred<Float32Array>();
      let progress: ((completed: number, total: number) => void) | undefined;
      installSupertonicWorkerRuntime(scope, {
        loadOrt: async () => ort.module,
        dependencies: baseDependencies({
          synthesize: async (options) => {
            progress = options.onProgress;
            return await inference.promise;
          },
        }),
      });
      scope.emit(fixture.command);
      await vi.waitFor(() =>
        expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
      );
      scope.emit(synthesizeCommand(2));
      await vi.waitFor(() => expect(progress).toBeTypeOf('function'));

      scope.emit({ command, operationId: 3 });
      await flushRuntime();
      if (command === 'dispose') {
        expect(scope.closed).toBe(false);
        expect(ort.releaseOrder).toEqual([]);
        expect(scope.messages.slice(1)).toEqual([]);
      } else {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']);
        expect(scope.messages.slice(1)).toEqual([{ type: 'cancelled', operationId: 3 }]);
      }

      progress?.(1, 2);
      inference.resolve(new Float32Array([0.3, -0.3]));
      if (command === 'dispose') {
        await vi.waitFor(() => expect(scope.closed).toBe(true));
        expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']);
        expect(scope.messages.slice(1)).toEqual([{ type: 'disposed', operationId: 3 }]);
      } else {
        await flushRuntime();
      }
      expect(scope.messages).toHaveLength(2);
    },
  );

  it('gives terminal cleanup one owner and acknowledges only after its stalled release finishes', async () => {
    const scope = new FakeWorkerScope();
    const fixture = makeTinyPrepare();
    const ort = makeOrtState();
    const releaseStarted = deferred<void>();
    const releaseGate = deferred<void>();
    const vocoder = ort.sessions[3]!;
    (vocoder as { release: () => Promise<void> }).release = vi.fn(async () => {
      releaseStarted.resolve(undefined);
      await releaseGate.promise;
      ort.releaseOrder.push('vocoder');
    });
    installSupertonicWorkerRuntime(scope, {
      loadOrt: async () => ort.module,
      dependencies: baseDependencies(),
    });
    scope.emit(fixture.command);
    await vi.waitFor(() =>
      expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
    );

    scope.emit({ command: 'dispose', operationId: 2 });
    await releaseStarted.promise;
    scope.emit({ command: 'cancel', operationId: 3 });
    await flushRuntime();

    expect(scope.closed).toBe(false);
    expect(scope.closeCalls).toBe(0);
    expect(scope.messages).toEqual([{ type: 'ready', operationId: 1 }]);

    releaseGate.resolve(undefined);
    await vi.waitFor(() => expect(scope.closed).toBe(true));
    expect(scope.closeCalls).toBe(1);
    expect(scope.messages.slice(1)).toEqual([{ type: 'disposed', operationId: 2 }]);
    expect(ort.releaseOrder).toEqual(['vocoder', 'vector', 'text', 'duration']);
  });

  it('starts successfully in a fresh application Worker after cancellation', async () => {
    const cancelledScope = new FakeWorkerScope();
    const cancelledFixture = makeTinyPrepare();
    const stalledLoader = deferred<SupertonicOrtModulePort>();
    installSupertonicWorkerRuntime(cancelledScope, {
      loadOrt: () => stalledLoader.promise,
      dependencies: baseDependencies(),
    });
    cancelledScope.emit(cancelledFixture.command);
    await flushRuntime();
    cancelledScope.emit({ command: 'cancel', operationId: 2 });
    await vi.waitFor(() => expect(cancelledScope.closed).toBe(true));

    const freshScope = new FakeWorkerScope();
    const freshFixture = makeTinyPrepare();
    const freshOrt = makeOrtState();
    installSupertonicWorkerRuntime(freshScope, {
      loadOrt: async () => freshOrt.module,
      dependencies: baseDependencies(),
    });
    freshScope.emit(freshFixture.command);
    await vi.waitFor(() =>
      expect(freshScope.messages).toEqual([{ type: 'ready', operationId: 1 }]),
    );

    expect(cancelledScope.messages).toEqual([{ type: 'cancelled', operationId: 2 }]);
    expect(freshOrt.createCalls).toHaveLength(4);
  });

  it('uses no ambient fetch, XHR, importScripts, Cache API, or uncontrolled loader on the injected path', async () => {
    const fetchSentinel = vi.fn(() => {
      throw new Error('ambient fetch forbidden');
    });
    const xhrSentinel = vi.fn();
    const importScriptsSentinel = vi.fn(() => {
      throw new Error('ambient importScripts forbidden');
    });
    const cacheSentinel = vi.fn(() => {
      throw new Error('ambient Cache API forbidden');
    });
    vi.stubGlobal('fetch', fetchSentinel);
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          xhrSentinel();
          throw new Error('ambient XHR forbidden');
        }
      },
    );
    vi.stubGlobal('importScripts', importScriptsSentinel);
    vi.stubGlobal('caches', {
      open: cacheSentinel,
      match: cacheSentinel,
      has: cacheSentinel,
      delete: cacheSentinel,
      keys: cacheSentinel,
    });
    try {
      const scope = new FakeWorkerScope();
      const fixture = makeTinyPrepare();
      const ort = makeOrtState();
      const loadOrt = vi.fn(async () => ort.module);
      installSupertonicWorkerRuntime(scope, {
        loadOrt,
        dependencies: baseDependencies(),
      });
      scope.emit(fixture.command);
      await vi.waitFor(() =>
        expect(scope.messages).toContainEqual({ type: 'ready', operationId: 1 }),
      );
      scope.emit(synthesizeCommand(2));
      await vi.waitFor(() =>
        expect(scope.messages).toContainEqual(
          expect.objectContaining({ type: 'result', operationId: 2 }),
        ),
      );

      expect(loadOrt).toHaveBeenCalledExactlyOnceWith('wasm');
      expect(fetchSentinel).not.toHaveBeenCalled();
      expect(xhrSentinel).not.toHaveBeenCalled();
      expect(importScriptsSentinel).not.toHaveBeenCalled();
      expect(cacheSentinel).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
