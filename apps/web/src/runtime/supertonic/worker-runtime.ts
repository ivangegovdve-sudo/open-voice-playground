import {
  SUPERTONIC_LANGUAGES,
  WorkerCommandSchema,
  type BrowserRuntimeBackend,
  type SupertonicPrepareWorkerCommand,
  type SupertonicVoiceId,
  type WorkerCommand,
} from '@open-voice/contracts';

import {
  encodeSupertonicWav,
  parseSupertonicConfig,
  parseSupertonicStyle,
  parseUnicodeIndexer,
  synthesizeSupertonic,
  validateSupertonicPcm,
  type SupertonicConfig,
  type SupertonicStyle,
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
  type SupertonicSessionTuple,
} from './ort-port';

export type SupertonicWorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  close(): void;
};

export type SupertonicOrtValueMetadataPort =
  | {
      readonly name: string;
      readonly isTensor: true;
      readonly type: string;
      readonly shape: readonly (number | string)[];
    }
  | { readonly name: string; readonly isTensor: false };

export type SupertonicOrtTensorPort = {
  readonly type: string;
  readonly dims: readonly number[];
  getData(releaseData?: boolean): Promise<unknown>;
  dispose(): void;
};

export type SupertonicOrtSessionPort = {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly inputMetadata: readonly SupertonicOrtValueMetadataPort[];
  readonly outputMetadata: readonly SupertonicOrtValueMetadataPort[];
  run(
    feeds: Readonly<Record<string, SupertonicOrtTensorPort>>,
  ): Promise<Readonly<Record<string, SupertonicOrtTensorPort>>>;
  release(): Promise<void>;
};

export type SupertonicOrtModulePort = {
  readonly env: {
    readonly wasm: {
      wasmBinary?: ArrayBufferLike | Uint8Array;
      numThreads?: number;
      proxy?: boolean;
    };
  };
  readonly InferenceSession: {
    create(
      model: ArrayBufferLike,
      options: {
        readonly executionProviders: readonly [BrowserRuntimeBackend];
        readonly graphOptimizationLevel: 'all';
      },
    ): Promise<SupertonicOrtSessionPort>;
  };
  readonly Tensor: new <T extends OrtTensorType>(
    type: T,
    data: OrtTensorData<T>,
    dims: readonly number[],
  ) => SupertonicOrtTensorPort;
};

export type SupertonicWorkerRuntimeDependencies = {
  parseCommand(value: unknown): WorkerCommand;
  parseConfig: typeof parseSupertonicConfig;
  parseIndexer: typeof parseUnicodeIndexer;
  parseStyle: typeof parseSupertonicStyle;
  prepareOrt: typeof prepareSupertonicOrtPort;
  synthesize: typeof synthesizeSupertonic;
  validatePcm: typeof validateSupertonicPcm;
  encodeWav: typeof encodeSupertonicWav;
};

export type SupertonicWorkerRuntimeOptions = {
  loadOrt(backend: BrowserRuntimeBackend): Promise<SupertonicOrtModulePort>;
  dependencies?: Partial<SupertonicWorkerRuntimeDependencies>;
};

type ManagedSession = {
  readonly raw: SupertonicOrtSessionPort;
  released: boolean;
};

type PreparedState = {
  readonly voiceId: SupertonicVoiceId;
  readonly backend: BrowserRuntimeBackend;
  readonly selectionId: string;
  readonly selectionDigest: string;
  readonly config: SupertonicConfig;
  readonly indexer: Int32Array;
  readonly styles: ReadonlyMap<SupertonicVoiceId, SupertonicStyle>;
  readonly ort: PreparedSupertonicOrtPort;
  readonly sessions: readonly ManagedSession[];
};

const INVALID_COMMAND_ERROR = 'Invalid Supertonic Worker command.';
const NOT_PREPARED_ERROR = 'Supertonic Worker is not prepared.';
const OPERATION_ERROR = 'Supertonic Worker operation failed.';
const DUPLICATE_OPERATION_ERROR = 'Supertonic Worker operation ID was already used.';
const DUPLICATE_PREPARE_ERROR = 'Supertonic Worker already has a preparation lifecycle.';
const WRONG_VOICE_ERROR = 'Prepared Supertonic voice does not match the synthesis request.';
const CONCURRENT_SYNTHESIS_ERROR = 'Supertonic Worker synthesis is already running.';

const STYLE_ASSETS = [
  ['supertonic:F1', 'voice-styles-f1-json'],
  ['supertonic:F2', 'voice-styles-f2-json'],
  ['supertonic:F3', 'voice-styles-f3-json'],
  ['supertonic:F4', 'voice-styles-f4-json'],
  ['supertonic:F5', 'voice-styles-f5-json'],
  ['supertonic:M1', 'voice-styles-m1-json'],
  ['supertonic:M2', 'voice-styles-m2-json'],
  ['supertonic:M3', 'voice-styles-m3-json'],
  ['supertonic:M4', 'voice-styles-m4-json'],
  ['supertonic:M5', 'voice-styles-m5-json'],
] as const satisfies readonly (readonly [SupertonicVoiceId, string])[];

const MODEL_ASSET_IDS = [
  'onnx-duration-predictor-onnx',
  'onnx-text-encoder-onnx',
  'onnx-vector-estimator-onnx',
  'onnx-vocoder-onnx',
] as const;

const RAW_TENSOR = Symbol('supertonic-raw-ort-tensor');

type AdaptedTensorLease<T extends OrtTensorType = OrtTensorType> = OrtTensorLease<T> & {
  readonly [RAW_TENSOR]: SupertonicOrtTensorPort;
};

function operationIdFrom(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const candidate = Reflect.get(value, 'operationId');
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0 ? (candidate as number) : 0;
}

function collectArrayBuffers(
  value: unknown,
  result: Set<ArrayBuffer> = new Set<ArrayBuffer>(),
  visited: Set<object> = new Set<object>(),
): Set<ArrayBuffer> {
  if (value instanceof ArrayBuffer) {
    result.add(value);
    return result;
  }
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value)) return result;
  if (visited.has(value)) return result;
  visited.add(value);
  for (const nested of Object.values(value)) collectArrayBuffers(nested, result, visited);
  return result;
}

function detachArrayBuffer(buffer: ArrayBuffer): void {
  if (buffer.byteLength === 0) return;
  structuredClone(buffer, { transfer: [buffer] });
}

function detachMessageBuffers(value: unknown): void {
  for (const buffer of collectArrayBuffers(value)) detachArrayBuffer(buffer);
}

function metadata(metadata: SupertonicOrtValueMetadataPort): OrtTensorMetadata {
  if (
    metadata.isTensor &&
    (metadata.type === 'float32' || metadata.type === 'int64') &&
    Array.isArray(metadata.shape)
  ) {
    return {
      name: metadata.name,
      isTensor: true,
      type: metadata.type,
      shape: [...metadata.shape],
    };
  }
  return { name: metadata.name, isTensor: false };
}

function adaptTensor<T extends OrtTensorType>(raw: SupertonicOrtTensorPort): AdaptedTensorLease<T> {
  let disposed = false;
  return {
    type: raw.type as T,
    dims: [...raw.dims],
    async getData(_releaseData: true): Promise<OrtTensorData<T>> {
      return (await raw.getData(true)) as OrtTensorData<T>;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      raw.dispose();
    },
    [RAW_TENSOR]: raw,
  };
}

function adaptSession(session: ManagedSession): OrtSessionPort {
  return {
    inputNames: [...session.raw.inputNames],
    outputNames: [...session.raw.outputNames],
    inputMetadata: session.raw.inputMetadata.map(metadata),
    outputMetadata: session.raw.outputMetadata.map(metadata),
    async run(
      feeds: Readonly<Record<string, OrtTensorLease>>,
    ): Promise<Readonly<Record<string, OrtTensorLease>>> {
      const rawFeeds: Record<string, SupertonicOrtTensorPort> = {};
      for (const [name, lease] of Object.entries(feeds)) {
        if (!(RAW_TENSOR in lease)) throw new Error('Supertonic ORT tensor ownership is invalid.');
        rawFeeds[name] = (lease as AdaptedTensorLease)[RAW_TENSOR];
      }
      const outputs = await session.raw.run(rawFeeds);
      return Object.fromEntries(
        Object.entries(outputs).map(([name, tensor]) => [name, adaptTensor(tensor)]),
      );
    },
  };
}

function adaptOrtModule(
  ort: SupertonicOrtModulePort,
  sessions: readonly ManagedSession[],
): SupertonicOrtPort {
  const adaptedSessions = sessions.map(adaptSession) as unknown as SupertonicSessionTuple;
  return {
    createTensor<T extends OrtTensorType>(
      type: T,
      data: OrtTensorData<T>,
      dims: readonly number[],
    ): OrtTensorLease<T> {
      return adaptTensor<T>(new ort.Tensor(type, data, dims));
    },
    sessions: adaptedSessions,
  };
}

async function releaseSessionsReverse(sessions: readonly ManagedSession[]): Promise<void> {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    if (session === undefined || session.released) continue;
    session.released = true;
    try {
      await session.raw.release();
    } catch {
      // Continue releasing the remaining owned sessions in deterministic order.
    }
  }
}

function assetBytes(command: SupertonicPrepareWorkerCommand, assetId: string): ArrayBuffer {
  const asset = command.assets.find((candidate) => candidate.assetId === assetId);
  if (asset === undefined) throw new Error('Supertonic transferred asset is missing.');
  return asset.bytes;
}

function hasValidSynthesisControls(
  command: Extract<WorkerCommand, { command: 'synthesize' }>,
): boolean {
  if (
    command.engineId !== 'supertonic' ||
    typeof command.text !== 'string' ||
    command.text.length < 1 ||
    command.text.length > 2_000 ||
    command.text.trim().length === 0
  ) {
    return false;
  }
  const controls = command.controls as { language?: unknown; speed?: unknown };
  if (
    typeof controls.language !== 'string' ||
    !(SUPERTONIC_LANGUAGES as readonly string[]).includes(controls.language) ||
    typeof controls.speed !== 'number' ||
    !Number.isFinite(controls.speed)
  ) {
    return false;
  }
  const scaled = Math.round(controls.speed * 100);
  return (
    controls.speed >= 0.75 &&
    controls.speed <= 1.25 &&
    controls.speed === scaled / 100 &&
    scaled % 5 === 0
  );
}

export function installSupertonicWorkerRuntime(
  scope: SupertonicWorkerScope,
  options: SupertonicWorkerRuntimeOptions,
): void {
  const dependencies: SupertonicWorkerRuntimeDependencies = {
    parseCommand: (value) => WorkerCommandSchema.parse(value),
    parseConfig: parseSupertonicConfig,
    parseIndexer: parseUnicodeIndexer,
    parseStyle: parseSupertonicStyle,
    prepareOrt: prepareSupertonicOrtPort,
    synthesize: synthesizeSupertonic,
    validatePcm: validateSupertonicPcm,
    encodeWav: encodeSupertonicWav,
    ...options.dependencies,
  };
  let phase: 'unprepared' | 'preparing' | 'prepared' | 'synthesizing' | 'failed' | 'terminal' =
    'unprepared';
  let epoch = 0;
  let prepared: PreparedState | null = null;
  let activePrepareCleanup: (() => Promise<void>) | null = null;
  let activePrepareCompletion: Promise<void> | null = null;
  let activeSynthesisCompletion: Promise<void> | null = null;
  const seenOperationIds = new Set<number>();

  const postError = (operationId: number, message: string): void => {
    if (phase !== 'terminal') scope.postMessage({ type: 'error', operationId, message });
  };

  const prepare = async (
    command: SupertonicPrepareWorkerCommand,
    operationEpoch: number,
  ): Promise<void> => {
    const owned = new Set<ArrayBuffer>([
      ...command.assets.map(({ bytes }) => bytes),
      command.runtimeArtifact.bytes,
    ]);
    const sessions: ManagedSession[] = [];
    let ort: SupertonicOrtModulePort | null = null;
    const detachOwned = (buffer: ArrayBuffer): void => {
      try {
        detachArrayBuffer(buffer);
      } finally {
        owned.delete(buffer);
      }
    };
    const discardAll = (): void => {
      for (const buffer of [...owned]) detachOwned(buffer);
    };
    const cleanup = async (): Promise<void> => {
      if (ort !== null) delete ort.env.wasm.wasmBinary;
      discardAll();
      await releaseSessionsReverse(sessions);
    };
    activePrepareCleanup = cleanup;
    try {
      const configBytes = assetBytes(command, 'onnx-tts-json');
      const config = dependencies.parseConfig(configBytes);
      detachOwned(configBytes);

      const indexBytes = assetBytes(command, 'onnx-unicode-indexer-json');
      const indexer = dependencies.parseIndexer(indexBytes);
      detachOwned(indexBytes);

      const styles = new Map<SupertonicVoiceId, SupertonicStyle>();
      for (const [voiceId, assetId] of STYLE_ASSETS) {
        const bytes = assetBytes(command, assetId);
        styles.set(voiceId, dependencies.parseStyle(bytes));
        detachOwned(bytes);
      }

      if (operationEpoch !== epoch || phase !== 'preparing') {
        await cleanup();
        return;
      }
      ort = await options.loadOrt(command.backend);
      if (operationEpoch !== epoch || phase !== 'preparing') {
        await cleanup();
        return;
      }
      ort.env.wasm.wasmBinary = command.runtimeArtifact.bytes;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const sessionOptions = {
        executionProviders: [command.backend] as readonly [BrowserRuntimeBackend],
        graphOptimizationLevel: 'all' as const,
      };
      for (let index = 0; index < MODEL_ASSET_IDS.length; index += 1) {
        const modelBytes = assetBytes(command, MODEL_ASSET_IDS[index]!);
        const raw = await ort.InferenceSession.create(modelBytes, sessionOptions);
        const managed = { raw, released: false } satisfies ManagedSession;
        sessions.push(managed);
        detachOwned(modelBytes);
        if (index === 0) {
          delete ort.env.wasm.wasmBinary;
          detachOwned(command.runtimeArtifact.bytes);
        }
        if (operationEpoch !== epoch || phase !== 'preparing') {
          await cleanup();
          return;
        }
      }

      const ortPort = dependencies.prepareOrt(adaptOrtModule(ort, sessions));
      if (operationEpoch !== epoch || phase !== 'preparing') {
        await cleanup();
        return;
      }
      discardAll();
      const nextPrepared = {
        voiceId: command.voiceId,
        backend: command.backend,
        selectionId: command.selectionId,
        selectionDigest: command.selectionDigest,
        config,
        indexer,
        styles,
        ort: ortPort,
        sessions,
      } satisfies PreparedState;
      scope.postMessage({ type: 'ready', operationId: command.operationId });
      prepared = nextPrepared;
      if (activePrepareCleanup === cleanup) activePrepareCleanup = null;
      phase = 'prepared';
    } catch {
      await cleanup();
      if (activePrepareCleanup === cleanup) activePrepareCleanup = null;
      if (operationEpoch === epoch && phase === 'preparing') {
        prepared = null;
        phase = 'failed';
        postError(command.operationId, OPERATION_ERROR);
      }
    }
  };

  const finishLifecycle = (
    command: Extract<WorkerCommand, { command: 'cancel' | 'dispose' }>,
  ): void => {
    ++epoch;
    phase = 'terminal';
    const prepareCleanup = activePrepareCleanup;
    activePrepareCleanup = null;
    const prepareCompletion = activePrepareCompletion;
    activePrepareCompletion = null;
    const synthesisCompletion = activeSynthesisCompletion;
    activeSynthesisCompletion = null;
    const state = prepared;
    prepared = null;
    void (async () => {
      if (prepareCleanup !== null) await prepareCleanup();
      if (command.command === 'dispose') {
        if (prepareCompletion !== null) await prepareCompletion;
        if (synthesisCompletion !== null) await synthesisCompletion;
        if (prepareCleanup !== null) await prepareCleanup();
      }
      if (state !== null) await releaseSessionsReverse(state.sessions);
      scope.postMessage({
        type: command.command === 'cancel' ? 'cancelled' : 'disposed',
        operationId: command.operationId,
      });
      scope.close();
    })();
  };

  const synthesize = async (
    command: Extract<WorkerCommand, { command: 'synthesize'; engineId: 'supertonic' }>,
    state: PreparedState,
    operationEpoch: number,
  ): Promise<void> => {
    let lastPercent = -1;
    const emitProgress = (completed: number, total: number): void => {
      if (
        operationEpoch !== epoch ||
        phase !== 'synthesizing' ||
        !Number.isFinite(completed) ||
        !Number.isFinite(total) ||
        total <= 0
      ) {
        return;
      }
      const percent = Math.max(0, Math.min(100, (completed / total) * 100));
      if (percent <= lastPercent) return;
      lastPercent = percent;
      scope.postMessage({
        type: 'progress',
        operationId: command.operationId,
        phase: 'synthesis',
        percent,
      });
    };
    try {
      const style = state.styles.get(state.voiceId);
      if (style === undefined) throw new Error('Prepared Supertonic style is missing.');
      const pcm = await dependencies.synthesize({
        text: command.text,
        language: command.controls.language,
        speed: command.controls.speed,
        config: state.config,
        indexer: state.indexer,
        style,
        ort: state.ort,
        onProgress: emitProgress,
      });
      if (operationEpoch !== epoch || phase !== 'synthesizing' || prepared !== state) return;
      const validated = dependencies.validatePcm(pcm);
      const wav = dependencies.encodeWav(validated);
      emitProgress(1, 1);
      if (operationEpoch !== epoch || phase !== 'synthesizing' || prepared !== state) return;
      scope.postMessage(
        {
          type: 'result',
          operationId: command.operationId,
          audio: wav,
          mimeType: 'audio/wav',
        },
        [wav],
      );
      phase = 'prepared';
    } catch {
      if (operationEpoch !== epoch || phase !== 'synthesizing' || prepared !== state) return;
      await releaseSessionsReverse(state.sessions);
      if (operationEpoch !== epoch || phase !== 'synthesizing' || prepared !== state) return;
      prepared = null;
      phase = 'failed';
      postError(command.operationId, OPERATION_ERROR);
    }
  };

  const dispatch = (value: unknown): void => {
    let command: WorkerCommand;
    try {
      command = dependencies.parseCommand(value);
    } catch {
      detachMessageBuffers(value);
      postError(operationIdFrom(value), INVALID_COMMAND_ERROR);
      return;
    }
    if (phase === 'terminal') {
      detachMessageBuffers(value);
      return;
    }
    if (seenOperationIds.has(command.operationId)) {
      detachMessageBuffers(value);
      postError(command.operationId, DUPLICATE_OPERATION_ERROR);
      return;
    }
    seenOperationIds.add(command.operationId);

    if (command.command === 'prepare') {
      if (command.engineId !== 'supertonic' || phase !== 'unprepared') {
        detachMessageBuffers(value);
        postError(command.operationId, DUPLICATE_PREPARE_ERROR);
        return;
      }
      phase = 'preparing';
      const operationEpoch = ++epoch;
      const completion = prepare(command, operationEpoch);
      activePrepareCompletion = completion;
      void completion.then(() => {
        if (activePrepareCompletion === completion) activePrepareCompletion = null;
      });
      return;
    }
    if (command.command === 'synthesize') {
      if (!hasValidSynthesisControls(command)) {
        postError(command.operationId, INVALID_COMMAND_ERROR);
        return;
      }
      if (phase === 'synthesizing') {
        postError(command.operationId, CONCURRENT_SYNTHESIS_ERROR);
        return;
      }
      if (command.engineId !== 'supertonic' || prepared === null || phase !== 'prepared') {
        postError(command.operationId, NOT_PREPARED_ERROR);
        return;
      }
      if (command.voiceId !== prepared.voiceId) {
        postError(command.operationId, WRONG_VOICE_ERROR);
        return;
      }
      const operationEpoch = ++epoch;
      const state = prepared;
      phase = 'synthesizing';
      const completion = synthesize(command, state, operationEpoch);
      activeSynthesisCompletion = completion;
      void completion.then(() => {
        if (activeSynthesisCompletion === completion) activeSynthesisCompletion = null;
      });
      return;
    }
    if (command.command === 'cancel' || command.command === 'dispose') {
      finishLifecycle(command);
      return;
    }
    postError(command.operationId, INVALID_COMMAND_ERROR);
  };

  scope.addEventListener('message', (event) => {
    dispatch(event.data);
  });
}
