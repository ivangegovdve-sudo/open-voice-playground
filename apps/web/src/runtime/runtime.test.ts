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
    async dispose() {
      events.push(`dispose:${engineId}`);
    },
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
      'dispose:engine-a',
      'prepare:b',
      'start:b',
      'end:b',
      'dispose:engine-b',
      'prepare:c',
      'start:c',
      'end:c',
      'dispose:engine-c',
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

  it('disposes an unavailable comparison adapter before returning its result', async () => {
    const preset = voice('unavailable');
    const dispose = vi.fn(async () => {});
    const adapter: RuntimeAdapter = {
      ...availableAdapter(preset.engineId, []),
      async checkCapability(_voice, mode) {
        return { available: false, mode, reason: 'Fixture unavailable.', controls: [] };
      },
      dispose,
    };

    const [result] = await runSequentialComparison(
      [{ voice: preset, mode: 'browser' }],
      'No synthesis.',
      new StaticRuntimeRegistry([adapter]),
    );

    expect(result).toMatchObject({
      status: 'unavailable',
      output: null,
      message: 'Fixture unavailable.',
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('fails closed when a comparison adapter cannot be disposed', async () => {
    const preset = voice('disposal-failure');
    const adapter: RuntimeAdapter = {
      ...availableAdapter(preset.engineId, []),
      async dispose() {
        throw new Error('Fixture disposal failed.');
      },
    };

    const [result] = await runSequentialComparison(
      [{ voice: preset, mode: 'browser' }],
      'Discard this output.',
      new StaticRuntimeRegistry([adapter]),
    );

    expect(result).toEqual({
      key: `${preset.id}:browser`,
      voiceId: preset.id,
      mode: 'browser',
      status: 'error',
      output: null,
      message: 'Runtime disposal failed: Fixture disposal failed.',
    });
  });

  it.each(['capability', 'prepare', 'synthesis'] as const)(
    'disposes the adapter after a %s exception',
    async (stage) => {
      const preset = voice(`throws-${stage}`);
      const dispose = vi.fn(async () => {});
      const base = availableAdapter(preset.engineId, []);
      const adapter: RuntimeAdapter = {
        ...base,
        async checkCapability(checkedVoice, mode) {
          if (stage === 'capability') throw new Error('Capability failed.');
          return await base.checkCapability(checkedVoice, mode);
        },
        async prepare(request, context) {
          if (stage === 'prepare') throw new Error('Prepare failed.');
          return await base.prepare(request, context);
        },
        async synthesize(request, context) {
          if (stage === 'synthesis') throw new Error('Synthesis failed.');
          return await base.synthesize(request, context);
        },
        dispose,
      };

      const [result] = await runSequentialComparison(
        [{ voice: preset, mode: 'browser' }],
        'Exercise cleanup.',
        new StaticRuntimeRegistry([adapter]),
      );

      expect(result).toBeDefined();
      expect(result!.status).toBe('error');
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

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
