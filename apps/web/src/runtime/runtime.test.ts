import { describe, expect, it, vi } from 'vitest';

import type { CatalogVoice } from '../catalog/filters';
import {
  MAX_SYNTHESIS_CHARACTERS,
  StaticRuntimeRegistry,
  UnavailableRuntimeAdapter,
  runSequentialComparison,
  validateSynthesisText,
  type RuntimeAdapter,
  type SynthesisRequest,
} from './runtime';

function voice(id: string, mode: CatalogVoice['runtimeModes'][number] = 'browser'): CatalogVoice {
  return {
    id,
    name: id,
    engineId: `engine-${id}`,
    engineName: `Engine ${id}`,
    locale: 'en-US',
    language: 'English',
    region: 'Unspecified',
    gender: 'unspecified',
    styles: [],
    licenseIds: ['fixture-license'],
    sourceIds: ['fixture-source'],
    runtimeModes: [mode],
    sample: null,
  };
}

function availableAdapter(engineId: string, events: string[]): RuntimeAdapter {
  return {
    engineId,
    async listVoices() {
      return [];
    },
    async checkCapability() {
      return { available: true, mode: 'browser', reason: null, controls: [] };
    },
    async prepare(request) {
      events.push(`prepare:${request.voice.id}`);
    },
    async synthesize(request) {
      events.push(`start:${request.voice.id}`);
      await Promise.resolve();
      events.push(`end:${request.voice.id}`);
      return {
        blob: new Blob([request.text], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        filename: `${request.voice.id}.wav`,
      };
    },
    async cancel() {},
    async dispose() {},
  };
}

describe('runtime boundary', () => {
  it('enforces the exact 2,000-character synthesis limit', () => {
    expect(MAX_SYNTHESIS_CHARACTERS).toBe(2000);
    expect(validateSynthesisText('a'.repeat(2000))).toEqual({ valid: true, message: null });
    expect(validateSynthesisText('a'.repeat(2001))).toEqual({
      valid: false,
      message: 'Text must be 2,000 characters or fewer.',
    });
  });

  it('reports unavailable capability without fabricating synthesis output', async () => {
    const preset = voice('offline');
    const adapter = new UnavailableRuntimeAdapter(
      preset.engineId,
      'browser',
      'Browser runtime is not installed in this build.',
    );

    await expect(adapter.checkCapability(preset, 'browser')).resolves.toMatchObject({
      available: false,
      mode: 'browser',
      reason: 'Browser runtime is not installed in this build.',
    });
    await expect(
      adapter.synthesize(
        { voice: preset, mode: 'browser', text: 'No fake output.', controls: {} },
        {},
      ),
    ).rejects.toThrow('Browser runtime is not installed in this build.');
  });

  it('runs up to three generation comparisons sequentially with identical text', async () => {
    const presets = [voice('a'), voice('b'), voice('c')];
    const events: string[] = [];
    const adapters = presets.map((preset) => availableAdapter(preset.engineId, events));
    const registry = new StaticRuntimeRegistry(adapters);

    const results = await runSequentialComparison(
      presets.map((preset) => ({ voice: preset, mode: 'browser' as const })),
      'The same sentence.',
      registry,
    );

    expect(events).toEqual([
      'prepare:a',
      'start:a',
      'end:a',
      'prepare:b',
      'start:b',
      'end:b',
      'prepare:c',
      'start:c',
      'end:c',
    ]);
    expect(results.map((result) => result.status)).toEqual(['complete', 'complete', 'complete']);
  });

  it('passes the exact selected mode and capability defaults to comparison synthesis', async () => {
    const preset = {
      ...voice('multi'),
      runtimeModes: ['browser', 'companion'] as CatalogVoice['runtimeModes'],
    };
    const requests: SynthesisRequest[] = [];
    const checkedModes: string[] = [];
    const adapter: RuntimeAdapter = {
      engineId: preset.engineId,
      async listVoices() {
        return [preset.id];
      },
      async checkCapability(_voice, mode) {
        checkedModes.push(mode);
        return {
          available: true,
          mode,
          reason: null,
          controls: [
            {
              id: 'speed',
              label: 'Speed',
              type: 'range',
              defaultValue: 1.25,
            },
            {
              id: 'tone',
              label: 'Tone',
              type: 'select',
              defaultValue: 'warm',
              options: [{ label: 'Warm', value: 'warm' }],
            },
          ],
        };
      },
      async prepare(request) {
        requests.push(request);
      },
      async synthesize(request) {
        requests.push(request);
        return {
          blob: new Blob([request.text], { type: 'audio/wav' }),
          mimeType: 'audio/wav',
          filename: 'multi.wav',
        };
      },
      async cancel() {},
      async dispose() {},
    };

    const [result] = await runSequentialComparison(
      [{ voice: preset, mode: 'companion' }],
      'Mode-specific text.',
      new StaticRuntimeRegistry([adapter]),
    );

    expect(checkedModes).toEqual(['companion']);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      mode: 'companion',
      controls: { speed: 1.25, tone: 'warm' },
    });
    expect(result).toMatchObject({
      key: `${preset.id}:companion`,
      voiceId: preset.id,
      mode: 'companion',
      status: 'complete',
    });
  });

  it('rejects a capability response for a different comparison mode', async () => {
    const preset = {
      ...voice('multi'),
      runtimeModes: ['browser', 'companion'] as CatalogVoice['runtimeModes'],
    };
    const prepare = vi.fn<RuntimeAdapter['prepare']>(async () => {});
    const synthesize = vi.fn<RuntimeAdapter['synthesize']>();
    const adapter: RuntimeAdapter = {
      engineId: preset.engineId,
      async listVoices() {
        return [preset.id];
      },
      async checkCapability() {
        return { available: true, mode: 'browser', reason: null, controls: [] };
      },
      prepare,
      synthesize,
      async cancel() {},
      async dispose() {},
    };

    const [result] = await runSequentialComparison(
      [{ voice: preset, mode: 'companion' }],
      'Do not run.',
      new StaticRuntimeRegistry([adapter]),
    );

    expect(result).toMatchObject({
      key: `${preset.id}:companion`,
      voiceId: preset.id,
      mode: 'companion',
      status: 'error',
      message: 'Runtime adapter returned Runs in browser for a Uses companion request.',
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('rejects a comparison mode that the voice does not declare', async () => {
    const preset = voice('browser-only');
    const checkCapability = vi.fn<RuntimeAdapter['checkCapability']>();
    const adapter = {
      ...availableAdapter(preset.engineId, []),
      checkCapability,
    };

    await expect(
      runSequentialComparison(
        [{ voice: preset, mode: 'online' }],
        'Do not run.',
        new StaticRuntimeRegistry([adapter]),
      ),
    ).rejects.toThrow('browser-only does not declare the Online service runtime.');
    expect(checkCapability).not.toHaveBeenCalled();
  });

  it('rejects sample-only entries and selections larger than three', async () => {
    const registry = new StaticRuntimeRegistry([]);

    await expect(
      runSequentialComparison(
        [{ voice: voice('sample', 'sample-only'), mode: 'sample-only' }],
        'Text',
        registry,
      ),
    ).rejects.toThrow('Sample-only presets cannot enter generation comparison.');
    await expect(
      runSequentialComparison(
        [voice('a'), voice('b'), voice('c'), voice('d')].map((preset) => ({
          voice: preset,
          mode: 'browser' as const,
        })),
        'Text',
        registry,
      ),
    ).rejects.toThrow('Choose no more than three presets.');
  });
});

void ({} as SynthesisRequest);
