import { RUNTIME_LABELS } from '../catalog/catalog';
import type { CatalogVoice, RuntimeMode } from '../catalog/filters';

export const MAX_SYNTHESIS_CHARACTERS = 2000;

export type EngineControl = {
  id: string;
  label: string;
  type: 'range' | 'select';
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number;
  options?: Array<{ label: string; value: string }>;
};

export type RuntimeCapability = {
  available: boolean;
  mode: RuntimeMode;
  reason: string | null;
  controls: EngineControl[];
};

export type SynthesisRequest = {
  voice: CatalogVoice;
  mode: RuntimeMode;
  text: string;
  controls: Record<string, string | number | boolean>;
};

export type RuntimeOperationContext = {
  signal?: AbortSignal;
  onProgress?: (progress: { phase: string; percent: number }) => void;
};

export type SynthesisOutput = {
  blob: Blob;
  mimeType: 'audio/wav';
  filename: string;
};

export type RuntimeAdapter = {
  engineId: string;
  listVoices(): Promise<string[]>;
  checkCapability(voice: CatalogVoice, mode: RuntimeMode): Promise<RuntimeCapability>;
  prepare(request: SynthesisRequest, context?: RuntimeOperationContext): Promise<void>;
  synthesize(request: SynthesisRequest, context: RuntimeOperationContext): Promise<SynthesisOutput>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
};

export type RuntimeRegistry = {
  get(engineId: string): RuntimeAdapter | null;
};

export class StaticRuntimeRegistry implements RuntimeRegistry {
  private readonly adaptersByEngine: ReadonlyMap<string, RuntimeAdapter>;

  constructor(adapters: RuntimeAdapter[]) {
    this.adaptersByEngine = new Map(adapters.map((adapter) => [adapter.engineId, adapter]));
  }

  get(engineId: string): RuntimeAdapter | null {
    return this.adaptersByEngine.get(engineId) ?? null;
  }
}

export class UnavailableRuntimeAdapter implements RuntimeAdapter {
  constructor(
    readonly engineId: string,
    private readonly defaultMode: RuntimeMode,
    private readonly reason: string | ((mode: RuntimeMode) => string),
  ) {}

  async listVoices(): Promise<string[]> {
    return [];
  }

  async checkCapability(_voice: CatalogVoice, mode: RuntimeMode): Promise<RuntimeCapability> {
    return { available: false, mode, reason: this.resolveReason(mode), controls: [] };
  }

  async prepare(_request: SynthesisRequest): Promise<void> {}

  async synthesize(
    request: SynthesisRequest,
    _context: RuntimeOperationContext,
  ): Promise<SynthesisOutput> {
    throw new Error(this.resolveReason(request.mode));
  }

  async cancel(): Promise<void> {}

  async dispose(): Promise<void> {}

  private resolveReason(mode: RuntimeMode): string {
    if (typeof this.reason === 'function') {
      return this.reason(mode);
    }
    return mode === this.defaultMode ? this.reason : `${mode} runtime is unavailable.`;
  }
}

export type TextValidation = { valid: boolean; message: string | null };

export function validateSynthesisText(text: string): TextValidation {
  if (text.length > MAX_SYNTHESIS_CHARACTERS) {
    return { valid: false, message: 'Text must be 2,000 characters or fewer.' };
  }
  return { valid: true, message: null };
}

export type ComparisonResult = {
  key: string;
  voiceId: string;
  mode: RuntimeMode;
  status: 'complete' | 'unavailable' | 'cancelled' | 'error';
  output: SynthesisOutput | null;
  message: string | null;
};

export type ComparisonSelection = {
  voice: CatalogVoice;
  mode: RuntimeMode;
};

function comparisonKey(voiceId: string, mode: RuntimeMode): string {
  return `${voiceId}:${mode}`;
}

export async function runSequentialComparison(
  selections: readonly ComparisonSelection[],
  text: string,
  registry: RuntimeRegistry,
): Promise<ComparisonResult[]> {
  if (selections.length > 3) {
    throw new Error('Choose no more than three presets.');
  }
  if (
    selections.some(
      ({ voice, mode }) => mode === 'sample-only' || voice.runtimeModes.includes('sample-only'),
    )
  ) {
    throw new Error('Sample-only presets cannot enter generation comparison.');
  }
  const invalidSelection = selections.find(({ voice, mode }) => !voice.runtimeModes.includes(mode));
  if (invalidSelection !== undefined) {
    throw new Error(
      `${invalidSelection.voice.name} does not declare the ${RUNTIME_LABELS[invalidSelection.mode]} runtime.`,
    );
  }

  const results: ComparisonResult[] = [];
  for (const { voice, mode } of selections) {
    const key = comparisonKey(voice.id, mode);
    const adapter = registry.get(voice.engineId);
    if (adapter === null) {
      results.push({
        key,
        voiceId: voice.id,
        mode,
        status: 'unavailable',
        output: null,
        message: `No runtime adapter is registered for ${voice.engineName}.`,
      });
      continue;
    }

    try {
      const capability = await adapter.checkCapability(voice, mode);
      if (capability.mode !== mode) {
        throw new Error(
          `Runtime adapter returned ${RUNTIME_LABELS[capability.mode]} for a ${RUNTIME_LABELS[mode]} request.`,
        );
      }
      if (!capability.available) {
        results.push({
          key,
          voiceId: voice.id,
          mode,
          status: 'unavailable',
          output: null,
          message: capability.reason,
        });
        continue;
      }

      const controls = Object.fromEntries(
        capability.controls.map((control) => [control.id, control.defaultValue]),
      );
      const request: SynthesisRequest = { voice, mode, text, controls };
      await adapter.prepare(request);
      const output = await adapter.synthesize(request, {});
      results.push({ key, voiceId: voice.id, mode, status: 'complete', output, message: null });
    } catch (error) {
      results.push({
        key,
        voiceId: voice.id,
        mode,
        status: 'error',
        output: null,
        message: error instanceof Error ? error.message : 'Generation failed.',
      });
    }
  }
  return results;
}
