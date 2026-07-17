import {
  WorkerCommandSchema,
  WorkerResponseSchema,
  type AssetSetManifest,
  type WorkerCommand,
  type WorkerResponse,
} from '@open-voice/contracts';

import type { CatalogVoice, RuntimeMode } from '../catalog/filters';
import { assertSupertonicRuntimeWav } from '../evidence/supertonic/wav-evidence';
import {
  MAX_SYNTHESIS_CHARACTERS,
  UnavailableRuntimeAdapter,
  validateSynthesisText,
  type EngineControl,
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

export type WorkerPreparePayload = {
  command: unknown;
  transferList: readonly Transferable[];
  preparedKey: string;
};

export type WorkerPreparePayloadBuilder = (input: {
  operationId: number;
  voice: CatalogVoice;
  request: SynthesisRequest;
  context: RuntimeOperationContext;
}) => WorkerPreparePayload | Promise<WorkerPreparePayload>;

export type WorkerRuntimeAdapterOptions = {
  engineId: string;
  voices: readonly CatalogVoice[];
  assetSets: readonly AssetSetManifest[];
  prepareAssets: (
    assetSet: AssetSetManifest,
    voice: CatalogVoice,
    context: RuntimeOperationContext,
  ) => Promise<void>;
  workerFactory: () => WorkerPort | Promise<WorkerPort>;
  browserRuntimeEnabled: boolean;
  cancelTimeoutMs?: number;
  preparePayloadBuilder?: WorkerPreparePayloadBuilder;
  preparedKeyBuilder?: (input: { voice: CatalogVoice; request: SynthesisRequest }) => string;
  synthesizeCommandBuilder?: (input: {
    operationId: number;
    voice: CatalogVoice;
    request: SynthesisRequest;
  }) => unknown;
  capabilityControls?: () => EngineControl[];
  cancellationPolicy?: 'delayed' | 'immediate';
  disposePolicy?: 'immediate' | 'acknowledged';
  disposeTimeoutMs?: number;
  replacementPolicy?: 'reuse-generation' | 'fresh-generation';
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
      preparedKey: string;
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
  preparedKey: string | null;
  detached: boolean;
  terminated: boolean;
  onMessage: EventListener;
  onError: EventListener;
  onMessageError: EventListener;
  disposeAcknowledgement: {
    operationId: number;
    resolve: () => void;
  } | null;
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

function collectArrayBuffers(value: unknown, result: ArrayBuffer[] = []): ArrayBuffer[] {
  if (value instanceof ArrayBuffer) {
    result.push(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectArrayBuffers(item, result);
    return result;
  }
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    for (const item of Object.values(value)) collectArrayBuffers(item, result);
  }
  return result;
}

function parsePreparePayload(
  payload: WorkerPreparePayload,
  expected: {
    operationId: number;
    engineId: string;
    voiceId: string;
    preparedKey: string;
  },
): { command: WorkerCommand; transferList: Transferable[]; preparedKey: string } {
  const command = WorkerCommandSchema.parse(payload.command);
  if (
    command.command !== 'prepare' ||
    command.operationId !== expected.operationId ||
    command.engineId !== expected.engineId ||
    command.voiceId !== expected.voiceId ||
    payload.preparedKey !== expected.preparedKey ||
    payload.preparedKey.length === 0
  ) {
    throw new Error('Engine-owned Worker prepare identity does not match the active request.');
  }
  const commandBuffers = collectArrayBuffers(command);
  const transferList = [...payload.transferList];
  if (
    commandBuffers.length !== transferList.length ||
    new Set(commandBuffers).size !== commandBuffers.length ||
    new Set(transferList).size !== transferList.length ||
    transferList.some((transfer, index) => transfer !== commandBuffers[index])
  ) {
    throw new Error('Worker transfer list must contain every parsed command buffer exactly once.');
  }
  return { command, transferList, preparedKey: payload.preparedKey };
}

function parseSynthesizeCommand(
  value: unknown,
  expected: { operationId: number; engineId: string; voiceId: string },
): WorkerCommand {
  const command = WorkerCommandSchema.parse(value);
  if (
    command.command !== 'synthesize' ||
    command.operationId !== expected.operationId ||
    command.engineId !== expected.engineId ||
    command.voiceId !== expected.voiceId
  ) {
    throw new Error('Engine-owned Worker synthesize identity does not match the active request.');
  }
  return command;
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
  private readonly preparePayloadBuilder: WorkerRuntimeAdapterOptions['preparePayloadBuilder'];
  private readonly preparedKeyBuilder: NonNullable<
    WorkerRuntimeAdapterOptions['preparedKeyBuilder']
  >;
  private readonly synthesizeCommandBuilder: WorkerRuntimeAdapterOptions['synthesizeCommandBuilder'];
  private readonly capabilityControls: NonNullable<
    WorkerRuntimeAdapterOptions['capabilityControls']
  >;
  private readonly cancellationPolicy: NonNullable<
    WorkerRuntimeAdapterOptions['cancellationPolicy']
  >;
  private readonly disposePolicy: NonNullable<WorkerRuntimeAdapterOptions['disposePolicy']>;
  private readonly disposeTimeoutMs: number;
  private readonly replacementPolicy: NonNullable<WorkerRuntimeAdapterOptions['replacementPolicy']>;
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
    this.preparePayloadBuilder = options.preparePayloadBuilder;
    this.preparedKeyBuilder =
      options.preparedKeyBuilder ?? (({ voice }: { voice: CatalogVoice }) => voice.id);
    this.synthesizeCommandBuilder = options.synthesizeCommandBuilder;
    this.capabilityControls =
      options.capabilityControls ??
      (() => [
        {
          id: 'speed',
          label: 'Speed',
          type: 'range',
          min: 0.75,
          max: 1.25,
          step: 0.05,
          defaultValue: 1,
        },
      ]);
    this.cancellationPolicy = options.cancellationPolicy ?? 'delayed';
    this.disposePolicy = options.disposePolicy ?? 'immediate';
    this.disposeTimeoutMs = options.disposeTimeoutMs ?? 500;
    this.replacementPolicy = options.replacementPolicy ?? 'reuse-generation';
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
      controls: this.capabilityControls(),
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

      if (this.replacementPolicy === 'fresh-generation' && this.generation !== null) {
        this.hardRetireGeneration(
          this.generation,
          abortError('The runtime generation was replaced by a fresh selection.'),
        );
      }

      let operationId: number;
      let payload:
        { command: WorkerCommand; transferList: Transferable[]; preparedKey: string } | undefined;
      const preparedKey = this.preparedKeyBuilder({ voice: canonicalVoice, request });
      if (this.preparePayloadBuilder !== undefined) {
        operationId = ++this.nextOperationId;
        const built = await Promise.race([
          Promise.resolve(
            this.preparePayloadBuilder({
              operationId,
              voice: canonicalVoice,
              request,
              context: { ...context, signal: preparation.controller.signal },
            }),
          ),
          aborted,
        ]);
        if (preparation.controller.signal.aborted || this.activePreparation !== preparation) {
          throw abortError();
        }
        payload = parsePreparePayload(built, {
          operationId,
          engineId: this.engineId,
          voiceId: canonicalVoice.id,
          preparedKey,
        });
      } else {
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
      }

      const generation = await this.ensureGeneration(preparation.controller.signal);
      preparation.generation = generation;
      if (preparation.controller.signal.aborted || this.activePreparation !== preparation) {
        await this.cancelPreparation(preparation, abortError());
        throw abortError();
      }
      if (payload === undefined) {
        operationId = ++this.nextOperationId;
        payload = parsePreparePayload(
          {
            command: {
              command: 'prepare',
              operationId,
              engineId: this.engineId,
              voiceId: canonicalVoice.id,
            },
            transferList: [],
            preparedKey,
          },
          {
            operationId,
            engineId: this.engineId,
            voiceId: canonicalVoice.id,
            preparedKey,
          },
        );
      }
      await new Promise<void>((resolve, reject) => {
        this.pending.set(operationId, {
          kind: 'prepare',
          preparedKey: payload.preparedKey,
          resolve,
          reject,
          context,
          generationId: generation.id,
          voiceId: canonicalVoice.id,
        });
        generation.pendingIds.add(operationId);
        this.postCommand(generation, payload.command, payload.transferList);
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
    if (this.activePreparation !== null) {
      throw new Error('Preset preparation is in progress; wait before synthesis.');
    }
    const generation = this.generation;
    const preparedKey = this.preparedKeyBuilder({ voice: canonicalVoice, request });
    if (generation === null || generation.preparedKey !== preparedKey) {
      throw new Error('Prepare the selected preset before synthesis.');
    }

    const operationId = ++this.nextOperationId;
    const command = parseSynthesizeCommand(
      this.synthesizeCommandBuilder?.({ operationId, voice: canonicalVoice, request }) ?? {
        command: 'synthesize',
        operationId,
        engineId: this.engineId,
        voiceId: canonicalVoice.id,
        text: request.text,
        controls: { ...request.controls },
      },
      { operationId, engineId: this.engineId, voiceId: canonicalVoice.id },
    );
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
    const generations = new Map<number, WorkerGeneration>();
    if (this.generation !== null) generations.set(this.generation.id, this.generation);
    if (preparation?.generation !== null && preparation?.generation !== undefined) {
      generations.set(preparation.generation.id, preparation.generation);
    }
    for (const retirement of this.retiringGenerations.values()) {
      generations.set(retirement.generation.id, retirement.generation);
    }
    const disposals = [...generations.values()].map((generation) =>
      this.startGenerationDisposal(generation),
    );
    preparation?.controller.abort();
    const results = await Promise.allSettled(disposals);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason as unknown);
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

  private async ensureGeneration(signal: AbortSignal): Promise<WorkerGeneration> {
    if (this.generation !== null) return this.generation;
    if (signal.aborted) throw abortError();

    let abortFactoryWait: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortFactoryWait = () => reject(abortError());
      if (signal.aborted) abortFactoryWait();
      else signal.addEventListener('abort', abortFactoryWait, { once: true });
    });
    const portPromise = Promise.resolve().then(() => {
      if (signal.aborted) throw abortError();
      return this.workerFactory();
    });
    void portPromise.then(
      (latePort) => {
        if (!signal.aborted) return;
        try {
          latePort.terminate();
        } catch {
          // A cancelled owner cannot recover a late port; termination is best effort.
        }
      },
      () => undefined,
    );

    let port: WorkerPort;
    try {
      port = await Promise.race([portPromise, aborted]);
    } finally {
      if (abortFactoryWait !== null) signal.removeEventListener('abort', abortFactoryWait);
    }
    if (signal.aborted) {
      port.terminate();
      throw abortError();
    }
    const generation = {
      id: ++this.nextGenerationId,
      port,
      pendingIds: new Set<number>(),
      preparedKey: null,
      detached: false,
      terminated: false,
      onMessage: (() => undefined) as EventListener,
      onError: (() => undefined) as EventListener,
      onMessageError: (() => undefined) as EventListener,
      disposeAcknowledgement: null,
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

  private postCommand(
    generation: WorkerGeneration,
    command: WorkerCommand,
    transferList: readonly Transferable[] = [],
  ): void {
    try {
      generation.port.postMessage(command, [...transferList]);
    } catch (error) {
      this.failGeneration(generation, error);
    }
  }

  private handleWorkerMessage(generation: WorkerGeneration, value: unknown): void {
    if (generation.detached) return;
    const parsed = WorkerResponseSchema.safeParse(value);
    if (!parsed.success) {
      if (generation.disposeAcknowledgement !== null) return;
      this.failGeneration(generation, new Error('Malformed worker response.'));
      return;
    }
    const message: WorkerResponse = parsed.data;
    if (message.type === 'disposed') {
      const acknowledgement = generation.disposeAcknowledgement;
      if (acknowledgement === null) {
        this.failGeneration(
          generation,
          new Error('Worker returned an unexpected lifecycle response.'),
        );
      } else if (acknowledgement.operationId === message.operationId) {
        acknowledgement.resolve();
      }
      return;
    }
    const operation = this.pending.get(message.operationId);
    if (operation === undefined || operation.generationId !== generation.id) return;

    if (message.type === 'progress') {
      operation.context.onProgress?.({ phase: message.phase, percent: message.percent });
      return;
    }

    if (message.type === 'error') {
      this.removePending(generation, message.operationId);
      if (operation.kind === 'prepare') generation.preparedKey = null;
      operation.reject(new Error(message.message));
      return;
    }
    if (message.type === 'cancelled') {
      this.removePending(generation, message.operationId);
      generation.preparedKey = null;
      operation.reject(abortError());
      return;
    }
    if (message.type === 'ready' && operation.kind === 'prepare') {
      this.removePending(generation, message.operationId);
      generation.preparedKey = operation.preparedKey;
      operation.resolve();
      return;
    }
    if (message.type === 'result' && operation.kind === 'synthesize') {
      if (this.engineId === 'supertonic') {
        try {
          assertSupertonicRuntimeWav(message.audio);
        } catch {
          this.failGeneration(
            generation,
            new Error('Supertonic Worker returned invalid WAV audio.'),
          );
          return;
        }
      }
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
    generation.preparedKey = null;
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

  private hardRetireGeneration(generation: WorkerGeneration, reason: unknown): void {
    this.detachGeneration(generation);
    this.rejectGeneration(generation, reason);
    this.terminateGeneration(generation);
  }

  private startGenerationDisposal(generation: WorkerGeneration): Promise<void> {
    return this.startGenerationRetirement(generation, () => this.disposeGeneration(generation));
  }

  private async disposeGeneration(generation: WorkerGeneration): Promise<void> {
    if (generation.terminated) return;
    this.rejectGeneration(generation, abortError('The runtime was disposed.'));
    generation.preparedKey = null;
    if (this.generation === generation) this.generation = null;
    const command = WorkerCommandSchema.parse({
      command: 'dispose',
      operationId: ++this.nextOperationId,
    });

    if (this.disposePolicy === 'immediate') {
      try {
        generation.port.postMessage(command);
      } finally {
        this.detachGeneration(generation);
        this.terminateGeneration(generation);
      }
      return;
    }

    let resolveAcknowledgement!: () => void;
    const acknowledged = new Promise<void>((resolve) => {
      resolveAcknowledgement = resolve;
    });
    generation.disposeAcknowledgement = {
      operationId: command.operationId,
      resolve: resolveAcknowledgement,
    };
    let postError: unknown;
    try {
      generation.port.postMessage(command);
    } catch (error) {
      postError = error;
    }
    try {
      if (postError === undefined) {
        await Promise.race([
          acknowledged,
          new Promise<void>((resolve) => setTimeout(resolve, this.disposeTimeoutMs)),
        ]);
      }
    } finally {
      generation.disposeAcknowledgement = null;
      this.detachGeneration(generation);
      this.terminateGeneration(generation);
    }
    if (postError !== undefined) throw postError;
  }

  private failGeneration(generation: WorkerGeneration, reason: unknown): void {
    this.detachGeneration(generation);
    this.rejectGeneration(generation, reason);
    this.terminateGeneration(generation);
  }

  private cancelPreparation(preparation: ActivePreparation, reason: unknown): Promise<void> {
    if (preparation.cancellation !== null) {
      preparation.controller.abort();
      return preparation.cancellation;
    }
    if (preparation.generation === null) {
      preparation.controller.abort();
      return Promise.resolve();
    }
    const cancellation = this.startGenerationCancellation(preparation.generation, reason);
    preparation.cancellation = cancellation;
    preparation.controller.abort();
    return cancellation;
  }

  private startGenerationCancellation(
    generation: WorkerGeneration,
    reason: unknown,
  ): Promise<void> {
    return this.startGenerationRetirement(generation, () =>
      this.cancelGeneration(generation, reason),
    );
  }

  private startGenerationRetirement(
    generation: WorkerGeneration,
    retire: () => Promise<void>,
  ): Promise<void> {
    const active = this.retiringGenerations.get(generation.id);
    if (active !== undefined) return active.completion;

    let resolveCompletion!: () => void;
    let rejectCompletion!: (reason: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const retirement = { generation, completion };
    this.retiringGenerations.set(generation.id, retirement);

    const removeRetirement = () => {
      if (this.retiringGenerations.get(generation.id) === retirement) {
        this.retiringGenerations.delete(generation.id);
      }
    };
    void completion.then(removeRetirement, removeRetirement);

    try {
      void retire().then(resolveCompletion, rejectCompletion);
    } catch (error) {
      rejectCompletion(error);
    }
    return completion;
  }

  private async cancelGeneration(generation: WorkerGeneration, reason: unknown): Promise<void> {
    if (generation.detached) return;
    const operationIds = [...generation.pendingIds];
    this.detachGeneration(generation);
    this.rejectGeneration(generation, reason);
    if (this.cancellationPolicy === 'immediate') {
      this.terminateGeneration(generation);
      return;
    }
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
