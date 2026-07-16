import { describe, expect, it, vi } from 'vitest';

import type { AssetSetManifest } from '@open-voice/contracts';

import type { CatalogVoice } from '../catalog/filters';
import {
  createEdgeMetadataAdapter,
  createFutureAzureAdapter,
  createPocketCompanionAdapter,
  createTestOnlyPcmAdapter,
  createWorkerRuntimeAdapter,
  type WorkerPort,
} from './providers';

function voice(engineId = 'kokoro'): CatalogVoice {
  return {
    id: `${engineId}:voice-a`,
    name: 'Voice A',
    engineId,
    engineName: engineId,
    locale: 'en-US',
    languageTags: ['en-US'],
    languages: ['English'],
    language: 'English',
    region: 'US',
    gender: 'unspecified',
    styles: [],
    licenseIds: ['voice-license'],
    sourceIds: ['voice-source'],
    runtimeModes: [
      engineId === 'pocket' ? 'companion' : engineId === 'edge' ? 'online' : 'browser',
    ],
    sample: null,
    backend: engineId === 'pocket' ? 'companion' : 'wasm',
    releaseGate:
      engineId === 'edge'
        ? { status: 'unavailable', reason: 'terms-not-cleared', detail: 'Metadata only.' }
        : { status: 'enabled', reason: null, detail: 'Reviewed.' },
    assetSetId: engineId === 'edge' ? null : `${engineId}-assets`,
    declaredDownloadBytes: engineId === 'edge' ? 0 : 4,
    consentRequired: engineId !== 'edge',
  };
}

function set(engineId = 'kokoro'): AssetSetManifest {
  return {
    id: `${engineId}-assets`,
    engineId,
    manifestDigest: 'sha256:24bb0a356819a69a58eb0ac658c840c17a55ad409ea666e8523e83123b26e8fc',
    assets: [
      {
        id: `${engineId}-model`,
        url: `https://example.com/${engineId}/0123456789abcdef0123456789abcdef01234567/model.onnx`,
        approvedFinalOrigins: ['https://example.com'],
        revision: '0123456789abcdef0123456789abcdef01234567',
        sha256: 'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        bytes: 4,
        cacheKey: `${engineId}/model/0123456789ab`,
        mediaType: 'application/onnx',
        sourceIds: ['source'],
        licenseIds: ['license'],
        requiredAcceptance: null,
      },
    ],
    totalBytes: 4,
    requiredAcceptanceLicenseIds: ['license'],
    releaseGate: { status: 'enabled', reason: null, detail: 'Reviewed.' },
  };
}

class FakeWorker implements WorkerPort {
  readonly messages: unknown[] = [];
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  terminated = false;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: (event: Event) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    for (const listener of this.listeners.get('message') ?? []) {
      listener(new MessageEvent('message', { data }));
    }
  }

  emitFailure(type: 'error' | 'messageerror') {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

function stillPendingAfter(delayMs = 20): Promise<'still-pending'> {
  return new Promise((resolve) => setTimeout(() => resolve('still-pending'), delayMs));
}

describe('lazy preset-only provider boundaries', () => {
  it('does not prepare assets or construct a Worker while listing or checking capability', async () => {
    const prepareAssets = vi.fn(async () => {});
    const workerFactory = vi.fn(() => new FakeWorker());
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets,
      workerFactory,
      browserRuntimeEnabled: true,
    });

    await expect(adapter.listVoices()).resolves.toEqual([preset.id]);
    await expect(adapter.checkCapability(preset, 'browser')).resolves.toMatchObject({
      available: true,
      mode: 'browser',
    });
    expect(prepareAssets).not.toHaveBeenCalled();
    expect(workerFactory).not.toHaveBeenCalled();
  });

  it('prepares consent-gated assets before constructing the Worker and posts only catalog IDs', async () => {
    const events: string[] = [];
    const worker = new FakeWorker();
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {
        events.push('assets');
      },
      workerFactory: () => {
        events.push('worker');
        return worker;
      },
      browserRuntimeEnabled: true,
    });
    const request = {
      voice: preset,
      mode: 'browser' as const,
      text: 'Safe text.',
      controls: { speed: 1 },
    };
    const prepared = adapter.prepare(request);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    const message = worker.messages[0] as Record<string, unknown>;

    expect(events).toEqual(['assets', 'worker']);
    expect(message).toEqual({
      command: 'prepare',
      operationId: 1,
      engineId: 'kokoro',
      voiceId: 'kokoro:voice-a',
    });
    expect(JSON.stringify(message)).not.toMatch(/url|path|model|prompt|reference|clone|upload/i);
    worker.emit({ type: 'ready', operationId: 1 });
    await prepared;
  });

  it('awaits an asynchronous Worker factory only after consent-gated asset preparation', async () => {
    let releaseAssets!: () => void;
    let resolveWorker!: (worker: WorkerPort) => void;
    const worker = new FakeWorker();
    const preset = voice();
    const prepareAssets = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseAssets = resolve;
        }),
    );
    const workerFactory = vi.fn(
      () =>
        new Promise<WorkerPort>((resolve) => {
          resolveWorker = resolve;
        }),
    );
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets,
      workerFactory,
      browserRuntimeEnabled: true,
    });

    const prepared = adapter.prepare({
      voice: preset,
      mode: 'browser',
      text: 'Load the selected runtime only after consent.',
      controls: { speed: 1 },
    });
    await vi.waitFor(() => expect(prepareAssets).toHaveBeenCalledOnce());
    expect(workerFactory).not.toHaveBeenCalled();

    releaseAssets();
    await vi.waitFor(() => expect(workerFactory).toHaveBeenCalledOnce());
    expect(worker.messages).toHaveLength(0);

    resolveWorker(worker);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    worker.emit({ type: 'ready', operationId: 1 });
    await prepared;
  });

  it('terminates a Worker that resolves after its asynchronous factory was cancelled', async () => {
    let resolveWorker!: (worker: WorkerPort) => void;
    const worker = new FakeWorker();
    const preset = voice();
    const workerFactory = vi.fn(
      () =>
        new Promise<WorkerPort>((resolve) => {
          resolveWorker = resolve;
        }),
    );
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory,
      browserRuntimeEnabled: true,
    });
    const prepared = adapter.prepare({
      voice: preset,
      mode: 'browser',
      text: 'Cancel while the selected runtime module loads.',
      controls: { speed: 1 },
    });
    await vi.waitFor(() => expect(workerFactory).toHaveBeenCalledOnce());

    await adapter.cancel();
    resolveWorker(worker);

    await expect(prepared).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.messages).toHaveLength(0);
    expect(worker.terminated).toBe(true);
  });

  it.each(['cancel', 'dispose'] as const)(
    '%s promptly rejects preparation when an asynchronous Worker factory never settles',
    async (cleanupMethod) => {
      const preset = voice();
      const workerFactory = vi.fn(() => new Promise<WorkerPort>(() => {}));
      const adapter = createWorkerRuntimeAdapter({
        engineId: 'kokoro',
        voices: [preset],
        assetSets: [set()],
        prepareAssets: async () => {},
        workerFactory,
        browserRuntimeEnabled: true,
      });
      const prepared = adapter.prepare({
        voice: preset,
        mode: 'browser',
        text: 'Cancel without waiting for a stalled runtime module.',
        controls: { speed: 1 },
      });
      const settled = prepared.catch((error: unknown) => error);
      await vi.waitFor(() => expect(workerFactory).toHaveBeenCalledOnce());

      await adapter[cleanupMethod]();

      await expect(Promise.race([settled, stillPendingAfter()])).resolves.toMatchObject({
        name: 'AbortError',
      });
    },
  );

  it('consumes a late asynchronous Worker factory rejection after prompt cancellation', async () => {
    let rejectWorker!: (reason: unknown) => void;
    const preset = voice();
    const nextWorker = new FakeWorker();
    const workerFactory = vi
      .fn<() => WorkerPort | Promise<WorkerPort>>()
      .mockImplementationOnce(
        () =>
          new Promise<WorkerPort>((_resolve, reject) => {
            rejectWorker = reject;
          }),
      )
      .mockImplementationOnce(() => nextWorker);
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory,
      browserRuntimeEnabled: true,
    });
    const request = {
      voice: preset,
      mode: 'browser' as const,
      text: 'A late module failure must not escape cancelled ownership.',
      controls: { speed: 1 },
    };
    const cancelledPreparation = adapter.prepare(request);
    const cancelledOutcome = cancelledPreparation.catch((error: unknown) => error);
    await vi.waitFor(() => expect(workerFactory).toHaveBeenCalledOnce());

    await adapter.cancel();
    await expect(Promise.race([cancelledOutcome, stillPendingAfter()])).resolves.toMatchObject({
      name: 'AbortError',
    });

    rejectWorker(new Error('The cancelled module failed later.'));
    await Promise.resolve();
    const nextPreparation = adapter.prepare(request);
    await vi.waitFor(() => expect(nextWorker.messages).toHaveLength(1));
    nextWorker.emit({ type: 'ready', operationId: 1 });
    await nextPreparation;
  });

  it('resolves forged caller voice objects through the adapter-owned canonical map', async () => {
    const worker = new FakeWorker();
    const canonical = voice();
    const prepareAssets = vi.fn(async () => {});
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [canonical],
      assetSets: [set()],
      prepareAssets,
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
    });
    const forged = {
      ...canonical,
      engineId: 'kitten',
      runtimeModes: ['companion'] as CatalogVoice['runtimeModes'],
      backend: 'companion' as const,
      releaseGate: {
        status: 'unavailable' as const,
        reason: 'asset-unavailable' as const,
        detail: 'forged',
      },
      assetSetId: 'kitten-assets',
      declaredDownloadBytes: 999,
      consentRequired: false,
    };

    await expect(adapter.checkCapability(forged, 'browser')).resolves.toMatchObject({
      available: true,
      controls: [{ id: 'speed', min: 0.75, max: 1.25 }],
    });
    const prepared = adapter.prepare({
      voice: forged,
      mode: 'browser',
      text: 'Canonical request.',
      controls: { speed: 1 },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    expect(prepareAssets).toHaveBeenCalledWith(
      set(),
      canonical,
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(worker.messages[0]).toMatchObject({ engineId: 'kokoro', voiceId: canonical.id });
    worker.emit({ type: 'ready', operationId: 1 });
    await prepared;

    await expect(
      adapter.prepare({
        voice: { ...canonical, id: 'kokoro:unknown' },
        mode: 'browser',
        text: 'Unknown.',
        controls: { speed: 1 },
      }),
    ).rejects.toThrow(/unknown preset/i);
  });

  it('binds synthesis to a successful prepare of the same canonical voice', async () => {
    const worker = new FakeWorker();
    const voiceA = voice();
    const voiceB = { ...voice(), id: 'kokoro:voice-b', name: 'Voice B' };
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [voiceA, voiceB],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
    });
    const requestA = {
      voice: voiceA,
      mode: 'browser' as const,
      text: 'Voice A.',
      controls: { speed: 1 },
    };
    const prepared = adapter.prepare(requestA);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    worker.emit({ type: 'ready', operationId: 1 });
    await prepared;

    const synthesis = adapter.synthesize(
      { ...requestA, voice: voiceB, text: 'Voice B without prepare.' },
      {},
    );
    await expect(Promise.race([synthesis, stillPendingAfter()])).rejects.toThrow(
      /prepare.*selected preset/i,
    );
  });

  it.each(['cancel', 'dispose'] as const)(
    '%s immediately after prepare prevents asset work and Worker creation',
    async (cleanupMethod) => {
      const prepareAssets = vi.fn(async () => {});
      const worker = new FakeWorker();
      const workerFactory = vi.fn(() => worker);
      const preset = voice();
      const adapter = createWorkerRuntimeAdapter({
        engineId: 'kokoro',
        voices: [preset],
        assetSets: [set()],
        prepareAssets,
        workerFactory,
        browserRuntimeEnabled: true,
      });
      const pending = adapter.prepare({
        voice: preset,
        mode: 'browser',
        text: 'Cancelled before the first asynchronous boundary.',
        controls: { speed: 1 },
      });
      const settled = pending.then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );

      await adapter[cleanupMethod]();
      const outcome = await Promise.race([settled, stillPendingAfter()]);
      if (outcome === 'still-pending') {
        await adapter.dispose();
        await settled;
      }

      expect(outcome).toMatchObject({ name: 'AbortError' });
      expect(prepareAssets).not.toHaveBeenCalled();
      expect(workerFactory).not.toHaveBeenCalled();
    },
  );

  it.each(['cancel', 'dispose'] as const)(
    '%s during asset preparation prevents a later Worker from being created',
    async (cleanupMethod) => {
      let releaseAssets!: () => void;
      const prepareAssets = vi.fn(
        async () =>
          new Promise<void>((resolve) => {
            releaseAssets = resolve;
          }),
      );
      const worker = new FakeWorker();
      const workerFactory = vi.fn(() => worker);
      const preset = voice();
      const adapter = createWorkerRuntimeAdapter({
        engineId: 'kokoro',
        voices: [preset],
        assetSets: [set()],
        prepareAssets,
        workerFactory,
        browserRuntimeEnabled: true,
      });
      const pending = adapter.prepare({
        voice: preset,
        mode: 'browser',
        text: 'Cancelled before Worker creation.',
        controls: { speed: 1 },
      });
      const settled = pending.then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(prepareAssets).toHaveBeenCalledOnce());

      const cleanup = adapter[cleanupMethod]();
      releaseAssets();
      await cleanup;
      const outcome = await Promise.race([settled, stillPendingAfter()]);
      if (outcome === 'still-pending') {
        await adapter.dispose();
        await settled;
      }

      expect(outcome).toMatchObject({ name: 'AbortError' });
      expect(workerFactory).not.toHaveBeenCalled();
    },
  );

  it('aborting the prepare signal after posting rejects the operation and clears the generation', async () => {
    const worker = new FakeWorker();
    const preset = voice();
    const controller = new AbortController();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
      cancelTimeoutMs: 0,
    });
    const pending = adapter.prepare(
      {
        voice: preset,
        mode: 'browser',
        text: 'Abort posted prepare.',
        controls: { speed: 1 },
      },
      { signal: controller.signal },
    );
    const settled = pending.then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

    controller.abort();
    const outcome = await Promise.race([settled, stillPendingAfter()]);
    if (outcome === 'still-pending') {
      await adapter.dispose();
      await settled;
    }

    expect(outcome).toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
  });

  it.each(['cancel', 'dispose'] as const)(
    '%s coordinates with an external abort that already detached a posted preparation',
    async (cleanupMethod) => {
      const worker = new FakeWorker();
      const preset = voice();
      const controller = new AbortController();
      const adapter = createWorkerRuntimeAdapter({
        engineId: 'kokoro',
        voices: [preset],
        assetSets: [set()],
        prepareAssets: async () => {},
        workerFactory: () => worker,
        browserRuntimeEnabled: true,
        cancelTimeoutMs: 30,
      });
      const pending = adapter.prepare(
        {
          voice: preset,
          mode: 'browser',
          text: 'Coordinate external abort with explicit cleanup.',
          controls: { speed: 1 },
        },
        { signal: controller.signal },
      );
      const settled = pending.catch((error: unknown) => error);
      await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

      controller.abort();
      await expect(settled).resolves.toMatchObject({ name: 'AbortError' });
      await adapter[cleanupMethod]();
      const terminatedWhenCleanupResolved = worker.terminated;
      await new Promise((resolve) => setTimeout(resolve, 35));

      expect(terminatedWhenCleanupResolved).toBe(true);
    },
  );

  it('detaches a cancelled generation immediately and ignores its timeout and stale result', async () => {
    vi.useFakeTimers();
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => workers.shift()!,
      browserRuntimeEnabled: true,
      cancelTimeoutMs: 10,
    });
    const request = {
      voice: preset,
      mode: 'browser' as const,
      text: 'Race-safe.',
      controls: { speed: 1 },
    };

    const firstPrepare = adapter.prepare(request);
    await vi.waitFor(() => expect(firstWorker.messages).toHaveLength(1));
    firstWorker.emit({ type: 'ready', operationId: 1 });
    await firstPrepare;
    const staleSynthesis = adapter.synthesize(request, {});
    const staleRejection = staleSynthesis.catch((error: unknown) => error);
    await vi.waitFor(() => expect(firstWorker.messages).toHaveLength(2));

    const cancellation = adapter.cancel();
    const secondPrepare = adapter.prepare(request);
    await vi.waitFor(() => expect(secondWorker.messages).toHaveLength(1));
    secondWorker.emit({ type: 'ready', operationId: 3 });
    await secondPrepare;
    const currentSynthesis = adapter.synthesize(request, {});
    await vi.waitFor(() => expect(secondWorker.messages).toHaveLength(2));

    firstWorker.emit({
      type: 'result',
      operationId: 2,
      audio: new ArrayBuffer(4),
      mimeType: 'audio/wav',
    });
    await vi.advanceTimersByTimeAsync(10);
    await cancellation;
    secondWorker.emit({
      type: 'result',
      operationId: 4,
      audio: new ArrayBuffer(4),
      mimeType: 'audio/wav',
    });

    await expect(staleRejection).resolves.toMatchObject({ name: 'AbortError' });
    await expect(currentSynthesis).resolves.toMatchObject({ mimeType: 'audio/wav' });
    expect(firstWorker.terminated).toBe(true);
    expect(secondWorker.terminated).toBe(false);
    vi.useRealTimers();
  });

  it.each(['error', 'messageerror'] as const)(
    'rejects pending work and clears prepared state on Worker %s',
    async (failureType) => {
      const worker = new FakeWorker();
      const preset = voice();
      const adapter = createWorkerRuntimeAdapter({
        engineId: 'kokoro',
        voices: [preset],
        assetSets: [set()],
        prepareAssets: async () => {},
        workerFactory: () => worker,
        browserRuntimeEnabled: true,
      });
      const request = {
        voice: preset,
        mode: 'browser' as const,
        text: 'Crash-safe.',
        controls: { speed: 1 },
      };
      const pending = adapter.prepare(request);
      await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

      worker.emitFailure(failureType);

      await expect(Promise.race([pending, stillPendingAfter()])).rejects.toThrow(/worker.*failed/i);
      expect(worker.terminated).toBe(true);
      await expect(adapter.synthesize(request, {})).rejects.toThrow(/prepare/i);
    },
  );

  it('rejects malformed responses without leaving work pending and tolerates repeated cleanup', async () => {
    const worker = new FakeWorker();
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
    });
    const request = {
      voice: preset,
      mode: 'browser' as const,
      text: 'Malformed response.',
      controls: { speed: 1 },
    };
    const pending = adapter.prepare(request);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

    worker.emit({ type: 'ready', operationId: 1, unexpected: true });

    await expect(pending).rejects.toThrow(/malformed worker response/i);
    await expect(adapter.cancel()).resolves.toBeUndefined();
    await expect(adapter.cancel()).resolves.toBeUndefined();
    await expect(adapter.dispose()).resolves.toBeUndefined();
    await expect(adapter.dispose()).resolves.toBeUndefined();
  });

  it('rejects a valid response used in the wrong lifecycle phase without leaving work pending', async () => {
    const worker = new FakeWorker();
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
    });
    const pending = adapter.prepare({
      voice: preset,
      mode: 'browser',
      text: 'Wrong lifecycle.',
      controls: { speed: 1 },
    });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));

    worker.emit({
      type: 'result',
      operationId: 1,
      audio: new ArrayBuffer(4),
      mimeType: 'audio/wav',
    });

    await expect(Promise.race([pending, stillPendingAfter()])).rejects.toThrow(
      /unexpected lifecycle/i,
    );
    expect(worker.terminated).toBe(true);
  });

  it('ignores stale results after cancellation and terminates an unresponsive Worker', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const preset = voice();
    const adapter = createWorkerRuntimeAdapter({
      engineId: 'kokoro',
      voices: [preset],
      assetSets: [set()],
      prepareAssets: async () => {},
      workerFactory: () => worker,
      browserRuntimeEnabled: true,
      cancelTimeoutMs: 10,
    });
    const request = {
      voice: preset,
      mode: 'browser' as const,
      text: 'Safe text.',
      controls: { speed: 1 },
    };
    const prepared = adapter.prepare(request);
    await vi.waitFor(() => expect(worker.messages).toHaveLength(1));
    worker.emit({ type: 'ready', operationId: 1 });
    await prepared;
    const synthesis = adapter.synthesize(request, {});
    const rejectedSynthesis = expect(synthesis).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2));

    const cancelling = adapter.cancel();
    await vi.advanceTimersByTimeAsync(10);
    await cancelling;
    worker.emit({
      type: 'result',
      operationId: 2,
      audio: new Uint8Array([82, 73, 70, 70]).buffer,
      mimeType: 'audio/wav',
    });

    await rejectedSynthesis;
    expect(worker.terminated).toBe(true);
    vi.useRealTimers();
  });

  it('keeps Edge and future Azure hard-unavailable with zero network or Worker calls', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const edge = createEdgeMetadataAdapter([voice('edge')]);
    const azure = createFutureAzureAdapter();

    await expect(edge.checkCapability(voice('edge'), 'online')).resolves.toMatchObject({
      available: false,
      reason: 'terms-not-cleared',
    });
    await expect(
      edge.synthesize(
        { voice: voice('edge'), mode: 'online', text: 'No request.', controls: {} },
        {},
      ),
    ).rejects.toThrow(/terms-not-cleared/i);
    await expect(azure.checkCapability(voice(), 'online')).resolves.toMatchObject({
      available: false,
      reason: 'feature-disabled',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('exposes Pocket only as a disconnected typed companion seam with the exact pack', async () => {
    const ids = [
      'alba',
      'estelle',
      'anna',
      'vera',
      'fantine',
      'charles',
      'paul',
      'eponine',
      'azelma',
      'george',
      'mary',
      'jane',
      'michael',
      'eve',
      'bill_boerst',
      'caro_davy',
      'peter_yearsley',
      'stuart_bell',
      'marius',
      'javert',
    ];
    const voices = ids.map((id) => ({ ...voice('pocket'), id: `pocket:${id}` }));
    const adapter = createPocketCompanionAdapter(voices, set('pocket'));

    await expect(adapter.listVoices()).resolves.toEqual(ids.map((id) => `pocket:${id}`));
    await expect(adapter.checkCapability(voices[0]!, 'companion')).resolves.toMatchObject({
      available: false,
      reason: 'companion-not-connected',
    });
    expect(adapter.packManifest.id).toBe('pocket-assets');
  });

  it('creates decodable non-silent PCM WAV only through the explicit test backend', async () => {
    expect(() => createTestOnlyPcmAdapter('test-engine', [voice()], 'production')).toThrow(
      /test-only/i,
    );
    const adapter = createTestOnlyPcmAdapter('kokoro', [voice()], 'test');
    const output = await adapter.synthesize(
      { voice: voice(), mode: 'browser', text: 'Test fixture tone.', controls: {} },
      {},
    );
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(output.blob);
    });

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(bytes.slice(44).some((value) => value !== 0)).toBe(true);
    expect(output.filename).toMatch(/test-only/i);
  });
});
