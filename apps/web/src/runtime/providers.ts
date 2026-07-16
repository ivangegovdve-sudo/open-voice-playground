import {
  WorkerCommandSchema,
  WorkerResponseSchema,
  type AssetSetManifest,
  type WorkerCommand,
  type WorkerResponse,
} from '@open-voice/contracts';

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
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener): void;
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

type PendingWorkerOperationBase = {
  reject: (reason: unknown) => void;
  context: RuntimeOperationContext;
  generationId: number;
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

type WorkerGeneration = {
  id: number;
  port: WorkerPort;
  pendingIds: Set<number>;
  preparedVoiceId: string | null;
  detached: boolean;
  terminated: boolean;
  onMessage: EventListener;
  onError: EventListener;
  onMessageError: EventListener;
};

type ActivePreparation = {
  controller: AbortController;
  generation: WorkerGeneration | null;
  cancellation: Promise<void> | null;
};

function abortError(message = 'The synthesis operation was cancelled.'): DOMException {
  return new DOMException(message, 'AbortError');
}

function assertRequest(canonicalVoice: CatalogVoice, request: SynthesisRequest): void {
  if (!canonicalVoice.runtimeModes.includes(request.mode)) {
    throw new Error(`Voice ${canonicalVoice.id} does not support ${request.mode}.`);
  }
  const validation = validateSynthesisText(request.text);
  if (!validation.valid) throw new Error(validation.message ?? 'Invalid synthesis text.');
  if (request.text.trim().length === 0) throw new Error('Text is required.');
  if (request.text.length > MAX_SYNTHESIS_CHARACTERS) {
    throw new Error('Text must be 2,000 characters or fewer.');
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
  private generation: WorkerGeneration | null = null;
  private nextGenerationId = 0;
  private nextOperationId = 0;
  private readonly pending = new Map<number, PendingWorkerOperation>();
  private activePreparation: ActivePreparation | null = null;
  private readonly retiringGenerations = new Map<
    number,
    { generation: WorkerGeneration; completion: Promise<void> }
  >();

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
    const canonicalVoice = this.voicesById.get(voice.id);
    if (canonicalVoice === undefined) {
      return { available: false, mode, reason: 'unknown-preset', controls: [] };
    }
    if (mode !== 'browser' || !canonicalVoice.runtimeModes.includes(mode)) {
      return { available: false, mode, reason: 'runtime-mode-unavailable', controls: [] };
    }
    if (canonicalVoice.releaseGate?.status === 'unavailable') {
      return { available: false, mode, reason: canonicalVoice.releaseGate.reason, controls: [] };
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
    const canonicalVoice = this.resolveCanonicalVoice(request.voice.id);
    assertRequest(canonicalVoice, request);
    if (this.activePreparation !== null && !this.activePreparation.controller.signal.aborted) {
      throw new Error('A preset preparation is already in progress.');
    }
    const preparation: ActivePreparation = {
      controller: new AbortController(),
      generation: null,
      cancellation: null,
    };
    this.activePreparation = preparation;
    const abortPreparation = () => {
      void this.cancelPreparation(preparation, abortError());
    };
    context.signal?.addEventListener('abort', abortPreparation, { once: true });
    if (context.signal?.aborted) abortPreparation();
    let rejectAborted: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = () => reject(abortError());
      if (preparation.controller.signal.aborted) rejectAborted();
      else preparation.controller.signal.addEventListener('abort', rejectAborted, { once: true });
    });

    try {
      const capability = await Promise.race([
        this.checkCapability(canonicalVoice, request.mode),
        aborted,
      ]);
      if (preparation.controller.signal.aborted || this.activePreparation !== preparation) {
        throw abortError();
      }
      if (!capability.available) throw new Error(capability.reason ?? 'Runtime unavailable.');

      const assetSetId = canonicalVoice.assetSetId;
      const assetSet =
        assetSetId === null || assetSetId === undefined
          ? undefined
          : this.assetSetsById.get(assetSetId);
      if (assetSet === undefined || assetSet.engineId !== this.engineId) {
        throw new Error(`No immutable asset set is registered for ${canonicalVoice.id}.`);
      }

      await Promise.race([
        this.prepareAssets(assetSet, canonicalVoice, {
          ...context,
          signal: preparation.controller.signal,
        }),
        aborted,
      ]);
      if (preparation.controller.signal.aborted || this.activePreparation !== preparation) {
        throw abortError();
      }

      const generation = this.ensureGeneration();
      preparation.generation = generation;
      const operationId = ++this.nextOperationId;
      const command = WorkerCommandSchema.parse({
        command: 'prepare',
        operationId,
        engineId: this.engineId,
        voiceId: canonicalVoice.id,
      });
      await new Promise<void>((resolve, reject) => {
        this.pending.set(operationId, {
          kind: 'prepare',
          resolve,
          reject,
          context,
          generationId: generation.id,
          voiceId: canonicalVoice.id,
        });
        generation.pendingIds.add(operationId);
        this.postCommand(generation, command);
      });
    } catch (error) {
      if (preparation.controller.signal.aborted) throw abortError();
      throw error;
    } finally {
      if (rejectAborted !== null) {
        preparation.controller.signal.removeEventListener('abort', rejectAborted);
      }
      context.signal?.removeEventListener('abort', abortPreparation);
      if (this.activePreparation === preparation) this.activePreparation = null;
    }
  }

  async synthesize(
    request: SynthesisRequest,
    context: RuntimeOperationContext,
  ): Promise<SynthesisOutput> {
    const canonicalVoice = this.resolveCanonicalVoice(request.voice.id);
    assertRequest(canonicalVoice, request);
    if (context.signal?.aborted) throw abortError();
    const generation = this.generation;
    if (generation === null || generation.preparedVoiceId !== canonicalVoice.id) {
      throw new Error('Prepare the selected preset before synthesis.');
    }

    const operationId = ++this.nextOperationId;
    const command = WorkerCommandSchema.parse({
      command: 'synthesize',
      operationId,
      engineId: this.engineId,
      voiceId: canonicalVoice.id,
      text: request.text,
      controls: { ...request.controls },
    });
    return await new Promise<SynthesisOutput>((resolve, reject) => {
      const abort = () => {
        void this.startGenerationCancellation(generation, abortError());
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
        generationId: generation.id,
        voiceId: canonicalVoice.id,
      });
      generation.pendingIds.add(operationId);
      this.postCommand(generation, command);
    });
  }

  async cancel(): Promise<void> {
    const generation = this.generation;
    const preparation = this.activePreparation;
    const cancellations = new Set<Promise<void>>();
    if (preparation !== null) {
      cancellations.add(this.cancelPreparation(preparation, abortError()));
    }
    if (generation !== null && generation !== preparation?.generation) {
      cancellations.add(this.startGenerationCancellation(generation, abortError()));
    }
    for (const retirement of this.retiringGenerations.values()) {
      cancellations.add(retirement.completion);
    }
    await Promise.all(cancellations);
  }

  async dispose(): Promise<void> {
    const preparation = this.activePreparation;
    preparation?.controller.abort();
    const generations = new Map<number, WorkerGeneration>();
    if (this.generation !== null) generations.set(this.generation.id, this.generation);
    if (preparation?.generation !== null && preparation?.generation !== undefined) {
      generations.set(preparation.generation.id, preparation.generation);
    }
    for (const retirement of this.retiringGenerations.values()) {
      generations.set(retirement.generation.id, retirement.generation);
    }
    const failures: unknown[] = [];
    for (const generation of generations.values()) {
      this.detachGeneration(generation);
      this.rejectGeneration(generation, abortError('The runtime was disposed.'));
      try {
        const command = WorkerCommandSchema.parse({
          command: 'dispose',
          operationId: ++this.nextOperationId,
        });
        generation.port.postMessage(command);
      } catch (error) {
        failures.push(error);
      } finally {
        this.terminateGeneration(generation);
        this.retiringGenerations.delete(generation.id);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more Worker generations could not be disposed.', {
        cause: failures[0],
      });
    }
  }

  private resolveCanonicalVoice(voiceId: string): CatalogVoice {
    const voice = this.voicesById.get(voiceId);
    if (voice === undefined || voice.engineId !== this.engineId) {
      throw new Error(`Unknown preset ${voiceId} for ${this.engineId}.`);
    }
    return voice;
  }

  private ensureGeneration(): WorkerGeneration {
    if (this.generation !== null) return this.generation;
    const port = this.workerFactory();
    const generation = {
      id: ++this.nextGenerationId,
      port,
      pendingIds: new Set<number>(),
      preparedVoiceId: null,
      detached: false,
      terminated: false,
      onMessage: (() => undefined) as EventListener,
      onError: (() => undefined) as EventListener,
      onMessageError: (() => undefined) as EventListener,
    } satisfies WorkerGeneration;
    generation.onMessage = ((event: MessageEvent) => {
      this.handleWorkerMessage(generation, event.data);
    }) as EventListener;
    generation.onError = (() => {
      this.failGeneration(generation, new Error('Worker execution failed.'));
    }) as EventListener;
    generation.onMessageError = (() => {
      this.failGeneration(generation, new Error('Worker message decoding failed.'));
    }) as EventListener;
    port.addEventListener('message', generation.onMessage);
    port.addEventListener('error', generation.onError);
    port.addEventListener('messageerror', generation.onMessageError);
    this.generation = generation;
    return generation;
  }

  private postCommand(generation: WorkerGeneration, command: WorkerCommand): void {
    try {
      generation.port.postMessage(WorkerCommandSchema.parse(command));
    } catch (error) {
      this.failGeneration(generation, error);
    }
  }

  private handleWorkerMessage(generation: WorkerGeneration, value: unknown): void {
    if (generation.detached) return;
    const parsed = WorkerResponseSchema.safeParse(value);
    if (!parsed.success) {
      this.failGeneration(generation, new Error('Malformed worker response.'));
      return;
    }
    const message: WorkerResponse = parsed.data;
    const operation = this.pending.get(message.operationId);
    if (operation === undefined || operation.generationId !== generation.id) return;

    if (message.type === 'progress') {
      operation.context.onProgress?.({ phase: message.phase, percent: message.percent });
      return;
    }

    if (message.type === 'error') {
      this.removePending(generation, message.operationId);
      if (operation.kind === 'prepare') generation.preparedVoiceId = null;
      operation.reject(new Error(message.message));
      return;
    }
    if (message.type === 'cancelled') {
      this.removePending(generation, message.operationId);
      generation.preparedVoiceId = null;
      operation.reject(abortError());
      return;
    }
    if (message.type === 'ready' && operation.kind === 'prepare') {
      this.removePending(generation, message.operationId);
      generation.preparedVoiceId = operation.voiceId;
      operation.resolve();
      return;
    }
    if (message.type === 'result' && operation.kind === 'synthesize') {
      this.removePending(generation, message.operationId);
      const blob = new Blob([message.audio], { type: message.mimeType });
      operation.resolve({
        blob,
        mimeType: message.mimeType,
        filename: `${safeFilenamePart(operation.voiceId)}.wav`,
      });
      return;
    }
    this.failGeneration(generation, new Error('Worker returned an unexpected lifecycle response.'));
  }

  private removePending(generation: WorkerGeneration, operationId: number): void {
    this.pending.delete(operationId);
    generation.pendingIds.delete(operationId);
  }

  private rejectGeneration(generation: WorkerGeneration, reason: unknown): void {
    for (const operationId of [...generation.pendingIds]) {
      const operation = this.pending.get(operationId);
      this.removePending(generation, operationId);
      operation?.reject(reason);
    }
  }

  private detachGeneration(generation: WorkerGeneration): void {
    if (generation.detached) return;
    generation.detached = true;
    generation.preparedVoiceId = null;
    generation.port.removeEventListener('message', generation.onMessage);
    generation.port.removeEventListener('error', generation.onError);
    generation.port.removeEventListener('messageerror', generation.onMessageError);
    if (this.generation === generation) this.generation = null;
  }

  private terminateGeneration(generation: WorkerGeneration): void {
    if (generation.terminated) return;
    generation.terminated = true;
    generation.port.terminate();
  }

  private failGeneration(generation: WorkerGeneration, reason: unknown): void {
    this.detachGeneration(generation);
    this.rejectGeneration(generation, reason);
    this.terminateGeneration(generation);
  }

  private cancelPreparation(preparation: ActivePreparation, reason: unknown): Promise<void> {
    preparation.controller.abort();
    if (preparation.cancellation !== null) return preparation.cancellation;
    if (preparation.generation === null) return Promise.resolve();
    const cancellation = this.startGenerationCancellation(preparation.generation, reason);
    preparation.cancellation = cancellation;
    return cancellation;
  }

  private startGenerationCancellation(
    generation: WorkerGeneration,
    reason: unknown,
  ): Promise<void> {
    const active = this.retiringGenerations.get(generation.id);
    if (active !== undefined) return active.completion;
    const completion = this.cancelGeneration(generation, reason);
    const retirement = { generation, completion };
    this.retiringGenerations.set(generation.id, retirement);
    void completion.then(
      () => {
        if (this.retiringGenerations.get(generation.id) === retirement) {
          this.retiringGenerations.delete(generation.id);
        }
      },
      () => {
        if (this.retiringGenerations.get(generation.id) === retirement) {
          this.retiringGenerations.delete(generation.id);
        }
      },
    );
    return completion;
  }

  private async cancelGeneration(generation: WorkerGeneration, reason: unknown): Promise<void> {
    if (generation.detached) return;
    const operationIds = [...generation.pendingIds];
    this.detachGeneration(generation);
    this.rejectGeneration(generation, reason);
    for (const operationId of operationIds) {
      try {
        generation.port.postMessage(WorkerCommandSchema.parse({ command: 'cancel', operationId }));
      } catch {
        // The detached generation is terminated below regardless of acknowledgement.
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, this.cancelTimeoutMs));
    this.terminateGeneration(generation);
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
