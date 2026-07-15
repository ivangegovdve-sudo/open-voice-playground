import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppView } from '../App';
import { createDefaultServices, type AppServices } from '../app-services';
import {
  StaticRuntimeRegistry,
  type RuntimeAdapter,
  type SynthesisRequest,
} from '../runtime/runtime';
import { createLocalDataStore } from '../state/local-store';

function renderCompare(adapter: RuntimeAdapter) {
  const defaults = createDefaultServices();
  const services: AppServices = {
    ...defaults,
    store: createLocalDataStore({ indexedDB: null }),
    runtime: new StaticRuntimeRegistry([adapter]),
    now: () => new Date('2026-07-16T10:00:00.000Z'),
  };

  return render(
    <MemoryRouter initialEntries={['/compare']}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

describe('comparison runtime choices', () => {
  it('runs a multi-mode preset with the explicitly selected mode and capability defaults', async () => {
    const user = userEvent.setup();
    const requests: SynthesisRequest[] = [];
    const checkCapability = vi.fn<RuntimeAdapter['checkCapability']>(async (_voice, mode) => ({
      available: true,
      mode,
      reason: null,
      controls: [
        {
          id: 'speed',
          label: 'Speed',
          type: 'range',
          defaultValue: 1.1,
        },
      ],
    }));
    const adapter: RuntimeAdapter = {
      engineId: 'fixture-browser',
      async listVoices() {
        return ['fixture-browser:voice-b'];
      },
      checkCapability,
      async prepare(request) {
        requests.push(request);
      },
      async synthesize(request) {
        requests.push(request);
        return {
          blob: new Blob([request.text], { type: 'audio/wav' }),
          mimeType: 'audio/wav',
          filename: 'comparison.wav',
        };
      },
      async cancel() {},
      async dispose() {},
    };
    renderCompare(adapter);

    const modeChoice = screen.getByRole('combobox', {
      name: 'Runtime for Fixture Voice B',
    });
    await user.selectOptions(modeChoice, 'companion');
    await user.click(screen.getByRole('checkbox', { name: 'Compare Fixture Voice B' }));
    await user.click(screen.getByRole('button', { name: 'Run comparison' }));

    expect(
      await screen.findByText('Comparison finished. Unavailable runtimes stayed unavailable.'),
    ).toBeInTheDocument();
    expect(checkCapability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fixture-browser:voice-b' }),
      'companion',
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ mode: 'companion', controls: { speed: 1.1 } });
    expect(
      within(screen.getByLabelText('Comparison slots')).getByText('Uses companion'),
    ).toBeInTheDocument();
  });
});
