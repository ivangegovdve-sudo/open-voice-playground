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
  readonly listeners = new Set<(event: MessageEvent) => void>();
  terminated = false;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data }));
  }
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
    const request = { voice: preset, mode: 'browser' as const, text: 'Safe text.', controls: {} };
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
