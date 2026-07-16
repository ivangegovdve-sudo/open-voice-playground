import type { AssetSetManifest } from '@open-voice/contracts';

import type { CatalogVoice, RuntimeMode } from '../catalog/filters';
import {
  MAX_SYNTHESIS_CHARACTERS,
  UnavailableRuntimeAdapter,
  validateSynthesisText,
  type RuntimeAdapter,
  type RuntimeCapability,
  type RuntimeOperationContext,
  type SynthesisOutput,
  type SynthesisRequest,
} from './runtime';

export type WorkerPort = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  terminate(): void;
};

type WorkerRuntimeAdapterOptions = {
  engineId: string;
  voices: readonly CatalogVoice[];
  assetSets: readonly AssetSetManifest[];
  prepareAssets: (
    assetSet: AssetSetManifest,
    voice: CatalogVoice,
    context: RuntimeOperationContext,
  ) => Promise<void>;
  workerFactory: () => WorkerPort;
  browserRuntimeEnabled: boolean;
  cancelTimeoutMs?: number;
};

type WorkerResponse =
  | { type: 'ready'; operationId: number }
  | { type: 'progress'; operationId: number; phase: string; percent: number }
  | { type: 'result'; operationId: number; audio: ArrayBuffer; mimeType?: string }
  | { type: 'error'; operationId: number; message: string }
  | { type: 'cancelled'; operationId: number };

type PendingWorkerOperationBase = {
  reject: (reason: unknown) => void;
  context: RuntimeOperationContext;
  voiceId: string;
};

type PendingWorkerOperation =
  | (PendingWorkerOperationBase & {
      kind: 'prepare';
      resolve: () => void;
    })
  | (PendingWorkerOperationBase & {
      kind: 'synthesize';
      resolve: (value: SynthesisOutput) => void;
    });

function abortError(message = 'The synthesis operation was cancelled.'): DOMException {
  return new DOMException(message, 'AbortError');
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Number.isSafeInteger(candidate.operationId) || typeof candidate.type !== 'string') {
    return false;
  }
  return ['ready', 'progress', 'result', 'error', 'cancelled'].includes(candidate.type);
}

function assertRequest(adapterEngineId: string, request: SynthesisRequest): void {
  if (request.voice.engineId !== adapterEngineId) {
    throw new Error(`Voice ${request.voice.id} does not belong to ${adapterEngineId}.`);
  }
  if (!request.voice.runtimeModes.includes(request.mode)) {
    throw new Error(`Voice ${request.voice.id} does not support ${request.mode}.`);
  }
  const validation = validateSynthesisText(request.text);
  if (!validation.valid) throw new Error(validation.message ?? 'Invalid synthesis text.');
  if (request.text.trim().length === 0) throw new Error('Text is required.');
  if (request.text.length > MAX_SYNTHESIS_CHARACTERS) {
    throw new Error('Text must be 2,000 characters or fewer.');
  }
  for (const [id, value] of Object.entries(request.controls)) {
    if (
      id.length === 0 ||
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new Error(`Control ${id || '(empty)'} must be a finite scalar value.`);
    }
  }
}

function safeFilenamePart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe.length > 0 ? safe : 'voice';
}

class WorkerRuntimeAdapter implements RuntimeAdapter {
  readonly engineId: string;
  private readonly voices: readonly CatalogVoice[];
  private readonly voicesById: ReadonlyMap<string, CatalogVoice>;
  private readonly assetSetsById: ReadonlyMap<string, AssetSetManifest>;
  private readonly prepareAssets: WorkerRuntimeAdapterOptions['prepareAssets'];
  private readonly workerFactory: WorkerRuntimeAdapterOptions['workerFactory'];
  private readonly browserRuntimeEnabled: boolean;
  private readonly cancelTimeoutMs: number;
  private worker: WorkerPort | null = null;
  private nextOperationId = 0;
  private readonly pending = new Map<number, PendingWorkerOperation>();

  constructor(options: WorkerRuntimeAdapterOptions) {
    this.engineId = options.engineId;
    this.voices = [...options.voices];
    this.voicesById = new Map(this.voices.map((voice) => [voice.id, voice]));
    this.assetSetsById = new Map(options.assetSets.map((assetSet) => [assetSet.id, assetSet]));
    this.prepareAssets = options.prepareAssets;
    this.workerFactory = options.workerFactory;
    this.browserRuntimeEnabled = options.browserRuntimeEnabled;
    this.cancelTimeoutMs = options.cancelTimeoutMs ?? 2_000;
  }

  async listVoices(): Promise<string[]> {
    return this.voices.map(({ id }) => id);
  }

  async checkCapability(voice: CatalogVoice, mode: RuntimeMode): Promise<RuntimeCapability> {
    if (voice.engineId !== this.engineId || !this.voicesById.has(voice.id)) {
      return { available: false, mode, reason: 'unknown-preset', controls: [] };
    }
    if (mode !== 'browser' || !voice.runtimeModes.includes(mode)) {
      return { available: false, mode, reason: 'runtime-mode-unavailable', controls: [] };
    }
    if (voice.releaseGate?.status === 'unavailable') {
      return { available: false, mode, reason: voice.releaseGate.reason, controls: [] };
    }
    if (!this.browserRuntimeEnabled) {
      return {
        available: false,
        mode,
        reason: 'runtime-verification-pending',
        controls: [],
      };
    }
    return {
      available: true,
      mode,
      reason: null,
      controls: [
        {
          id: 'speed',
          label: 'Speed',
          type: 'range',
          min: 0.75,
          max: 1.25,
          step: 0.05,
          defaultValue: 1,
        },
      ],
    };
  }

  async prepare(request: SynthesisRequest, context: RuntimeOperationContext = {}): Promise<void> {
    assertRequest(this.engineId, request);
    const capability = await this.checkCapability(request.voice, request.mode);
    if (!capability.available) throw new Error(capability.reason ?? 'Runtime unavailable.');

    const assetSetId = request.voice.assetSetId;
    const assetSet =
      assetSetId === null || assetSetId === undefined
        ? undefined
        : this.assetSetsById.get(assetSetId);
    if (assetSet === undefined) {
      throw new Error(`No immutable asset set is registered for ${request.voice.id}.`);
    }

    await this.prepareAssets(assetSet, request.voice, context);
    if (context.signal?.aborted) throw abortError();

    const worker = this.ensureWorker();
    const operationId = ++this.nextOperationId;
    await new Promise<void>((resolve, reject) => {
      this.pending.set(operationId, {
        kind: 'prepare',
        resolve,
        reject,
        context,
        voiceId: request.voice.id,
      });
      worker.postMessage({
        command: 'prepare',
        operationId,
        engineId: this.engineId,
        voiceId: request.voice.id,
      });
    });
  }

  async synthesize(
    request: SynthesisRequest,
    context: RuntimeOperationContext,
  ): Promise<SynthesisOutput> {
    assertRequest(this.engineId, request);
    if (context.signal?.aborted) throw abortError();
    const worker = this.worker;
    if (worker === null) {
      throw new Error('Prepare the selected preset before synthesis.');
    }

    const operationId = ++this.nextOperationId;
    return await new Promise<SynthesisOutput>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(operationId);
        reject(abortError());
      };
      context.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(operationId, {
        kind: 'synthesize',
        resolve: (value) => {
          context.signal?.removeEventListener('abort', abort);
          resolve(value);
        },
        reject: (reason) => {
          context.signal?.removeEventListener('abort', abort);
          reject(reason);
        },
        context,
        voiceId: request.voice.id,
      });
      worker.postMessage({
        command: 'synthesize',
        operationId,
        engineId: this.engineId,
        voiceId: request.voice.id,
        text: request.text,
        controls: { ...request.controls },
      });
    });
  }

  async cancel(): Promise<void> {
    const worker = this.worker;
    if (worker === null) return;

    const activeIds = [...this.pending.keys()];
    const cancellation = abortError();
    for (const operationId of activeIds) {
      const operation = this.pending.get(operationId);
      this.pending.delete(operationId);
      operation?.reject(cancellation);
      worker.postMessage({ command: 'cancel', operationId });
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, this.cancelTimeoutMs);
    });
    if (this.worker === worker) {
      this.detachAndTerminateWorker(worker);
    }
  }

  async dispose(): Promise<void> {
    const worker = this.worker;
    const disposed = abortError('The runtime was disposed.');
    for (const operation of this.pending.values()) operation.reject(disposed);
    this.pending.clear();
    if (worker !== null) {
      worker.postMessage({ command: 'dispose', operationId: ++this.nextOperationId });
      this.detachAndTerminateWorker(worker);
    }
  }

  private ensureWorker(): WorkerPort {
    if (this.worker === null) {
      this.worker = this.workerFactory();
      this.worker.addEventListener('message', this.onWorkerMessage);
    }
    return this.worker;
  }

  private readonly onWorkerMessage = (event: MessageEvent): void => {
    if (!isWorkerResponse(event.data)) return;
    const message = event.data;
    const operation = this.pending.get(message.operationId);
    if (operation === undefined) return;

    if (message.type === 'progress') {
      if (typeof message.phase === 'string' && typeof message.percent === 'number') {
        operation.context.onProgress?.({
          phase: message.phase,
          percent: Math.max(0, Math.min(100, message.percent)),
        });
      }
      return;
    }
    this.pending.delete(message.operationId);

    if (message.type === 'error') {
      operation.reject(
        new Error(typeof message.message === 'string' ? message.message : 'Worker error.'),
      );
      return;
    }
    if (message.type === 'cancelled') {
      operation.reject(abortError());
      return;
    }
    if (message.type === 'ready' && operation.kind === 'prepare') {
      operation.resolve();
      return;
    }
    if (message.type === 'result' && operation.kind === 'synthesize') {
      if (!(message.audio instanceof ArrayBuffer)) {
        operation.reject(new Error('Worker returned invalid audio bytes.'));
        return;
      }
      const blob = new Blob([message.audio], { type: 'audio/wav' });
      operation.resolve({
        blob,
        mimeType: 'audio/wav',
        filename: `${safeFilenamePart(operation.voiceId)}.wav`,
      });
      return;
    }
    operation.reject(new Error('Worker returned an unexpected lifecycle response.'));
  };

  private detachAndTerminateWorker(worker: WorkerPort): void {
    worker.removeEventListener('message', this.onWorkerMessage);
    worker.terminate();
    if (this.worker === worker) this.worker = null;
  }
}

export function createWorkerRuntimeAdapter(options: WorkerRuntimeAdapterOptions): RuntimeAdapter {
  return new WorkerRuntimeAdapter(options);
}

class MetadataOnlyAdapter extends UnavailableRuntimeAdapter {
  constructor(
    engineId: string,
    mode: RuntimeMode,
    reason: string,
    private readonly voices: readonly CatalogVoice[],
  ) {
    super(engineId, mode, reason);
  }

  override async listVoices(): Promise<string[]> {
    return this.voices.map(({ id }) => id);
  }
}

export function createEdgeMetadataAdapter(voices: readonly CatalogVoice[]): RuntimeAdapter {
  return new MetadataOnlyAdapter('edge', 'online', 'terms-not-cleared', voices);
}

export function createFutureAzureAdapter(): RuntimeAdapter {
  return new MetadataOnlyAdapter('future-azure', 'online', 'feature-disabled', []);
}

export type PocketCompanionAdapter = RuntimeAdapter & { packManifest: AssetSetManifest };

class DisconnectedPocketCompanionAdapter
  extends MetadataOnlyAdapter
  implements PocketCompanionAdapter
{
  constructor(
    voices: readonly CatalogVoice[],
    readonly packManifest: AssetSetManifest,
  ) {
    super('pocket', 'companion', 'companion-not-connected', voices);
  }
}

export function createPocketCompanionAdapter(
  voices: readonly CatalogVoice[],
  packManifest: AssetSetManifest,
): PocketCompanionAdapter {
  return new DisconnectedPocketCompanionAdapter(voices, packManifest);
}

function createTestToneWav(): Uint8Array<ArrayBuffer> {
  const sampleRate = 16_000;
  const sampleCount = Math.floor(sampleRate * 0.18);
  const bytes = new Uint8Array(new ArrayBuffer(44 + sampleCount * 2));
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.sin((Math.PI * index) / sampleCount);
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * envelope * 0.2;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }
  return bytes;
}

export function createTestOnlyPcmAdapter(
  engineId: string,
  voices: readonly CatalogVoice[],
  environment: 'test' | 'production',
): RuntimeAdapter {
  if (environment !== 'test') {
    throw new Error('The PCM tone adapter is test-only and cannot be used in production.');
  }
  return {
    engineId,
    async listVoices() {
      return voices.map(({ id }) => id);
    },
    async checkCapability(_voice, mode) {
      return { available: true, mode, reason: null, controls: [] };
    },
    async prepare() {},
    async synthesize(request) {
      const bytes = createTestToneWav();
      return {
        blob: new Blob([bytes], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        filename: `${safeFilenamePart(request.voice.id)}-test-only.wav`,
      };
    },
    async cancel() {},
    async dispose() {},
  };
}
