import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../App';
import { createDefaultServices, type AppServices } from '../app-services';
import {
  StaticRuntimeRegistry,
  type RuntimeAdapter,
  type RuntimeOperationContext,
  type SynthesisOutput,
} from '../runtime/runtime';
import { createLocalDataStore } from '../state/local-store';

afterEach(() => vi.restoreAllMocks());

function runtimeAdapter(overrides: Partial<RuntimeAdapter> = {}): RuntimeAdapter {
  return {
    engineId: 'fixture-browser',
    async listVoices() {
      return ['fixture-browser:voice-a', 'fixture-browser:voice-b'];
    },
    async checkCapability(_voice, mode) {
      return {
        available: true,
        mode,
        reason: null,
        controls: [
          {
            id: 'speed',
            label: 'Speed',
            type: 'range',
            min: 0.5,
            max: 2,
            step: 0.1,
            defaultValue: 1,
          },
        ],
      };
    },
    async prepare(_request, context) {
      context?.onProgress?.({ phase: 'Preparing fixture runtime…', percent: 20 });
    },
    async synthesize(request, context) {
      context.onProgress?.({ phase: 'Generating fixture audio…', percent: 70 });
      return {
        blob: new Blob([request.text], { type: 'audio/wav' }),
        mimeType: 'audio/wav',
        filename: `${request.voice.id}.wav`,
      };
    },
    async cancel() {},
    async dispose() {},
    ...overrides,
  };
}

function servicesFor(adapter: RuntimeAdapter): AppServices {
  const defaults = createDefaultServices();
  return {
    ...defaults,
    store: createLocalDataStore({ indexedDB: null }),
    runtime: new StaticRuntimeRegistry([adapter]),
    now: () => new Date('2026-07-15T12:00:00.000Z'),
    createObjectUrl: vi.fn(() => 'blob:fixture-output'),
    revokeObjectUrl: vi.fn(),
  };
}

function renderPlay(services: AppServices) {
  return render(
    <MemoryRouter initialEntries={['/play?voice=fixture-browser%3Avoice-a']}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

describe('play workbench with an available adapter', () => {
  it('shows readiness, engine controls, progress, WAV output, and completed local history', async () => {
    const user = userEvent.setup();
    const services = servicesFor(runtimeAdapter());
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPlay(services);

    expect(await screen.findByText('Runtime is ready.')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Speed' })).toHaveValue('1');

    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'A clear line.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));

    expect(await screen.findByRole('status')).toHaveTextContent('WAV is ready on this device.');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '100');
    expect(screen.getByRole('button', { name: 'Download WAV' })).toBeEnabled();
    expect(await screen.findByText('complete')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download WAV' }));
    expect(services.createObjectUrl).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    anchorClick.mockRestore();
  });

  it('locks mutable inputs and cancels the adapter that owns the active operation', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn(async () => {});
    const adapter = runtimeAdapter({
      cancel,
      synthesize(_request, context: RuntimeOperationContext): Promise<SynthesisOutput> {
        context.onProgress?.({ phase: 'Generating fixture audio…', percent: 45 });
        return new Promise((_resolve, reject) => {
          context.signal?.addEventListener('abort', () => {
            reject(new DOMException('Generation cancelled', 'AbortError'));
          });
        });
      },
    });
    renderPlay(servicesFor(adapter));

    expect(await screen.findByText('Runtime is ready.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Text to synthesize' }), 'Hold this run.');
    await user.click(screen.getByRole('button', { name: 'Generate speech' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Generating fixture audio…');

    expect(screen.getByRole('combobox', { name: 'Voice preset' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Runtime' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Text to synthesize' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel generation' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('status')).toHaveTextContent('Generation cancelled.');
    expect(screen.getByRole('button', { name: 'Download WAV' })).toBeDisabled();
  });

  it('turns capability-check rejection into an explicit error state', async () => {
    const adapter = runtimeAdapter({
      async checkCapability() {
        throw new Error('Capability probe failed.');
      },
    });
    renderPlay(servicesFor(adapter));

    expect(await screen.findByText('Capability probe failed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
  });

  it('rejects a capability response for a different runtime mode', async () => {
    const adapter = runtimeAdapter({
      async checkCapability() {
        return { available: true, mode: 'online', reason: null, controls: [] };
      },
    });
    renderPlay(servicesFor(adapter));

    expect(
      await screen.findByText(
        'Runtime adapter returned Online service for a Runs in browser request.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
  });
});
