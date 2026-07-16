import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { AppServices } from '../app-services';
import { seedCatalog } from '../catalog/catalog';
import { StaticRuntimeRegistry } from '../runtime/runtime';
import { AppStateProvider } from '../state/AppState';
import { createLocalDataStore } from '../state/local-store';
import { MiniPlayer } from './MiniPlayer';
import { PreviewController, type AudioPort, type PreviewTrack } from './preview-controller';

const track: PreviewTrack = {
  id: 'sample-a',
  title: 'Sample A',
  audioUrl: '/sample-a.wav',
  transcript: 'A short sample transcript.',
  sourceId: 'source-a',
  licenseId: 'license-a',
};

function createAudio(src: string): AudioPort {
  return {
    src,
    currentTime: 0,
    duration: 12,
    paused: false,
    play: async () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function createServices(preview: PreviewController): AppServices {
  return {
    catalog: seedCatalog,
    store: createLocalDataStore({ indexedDB: null }),
    preview,
    runtime: new StaticRuntimeRegistry([]),
    runtimeSummary: {
      evidenceClearedVoiceCount: 0,
      operationalVoiceCount: 0,
      operationalEngineIds: [],
      operationalVoiceIds: [],
    },
    now: () => new Date('2026-07-15T00:00:00Z'),
    createObjectUrl: () => 'blob:sample',
    revokeObjectUrl: () => undefined,
  };
}

describe('mini player', () => {
  it('keeps compact transcript, source, and license details available in the player', async () => {
    const preview = new PreviewController(createAudio);
    await preview.play(track);

    render(
      <MemoryRouter>
        <AppStateProvider services={createServices(preview)}>
          <MiniPlayer />
        </AppStateProvider>
      </MemoryRouter>,
    );

    const detailsControl = screen.getByLabelText(
      'Preview details: transcript, source, and license',
    );
    expect(detailsControl).toHaveTextContent('Details');

    fireEvent.click(detailsControl);
    expect(screen.getByText(track.transcript)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: track.sourceId })).toHaveAttribute(
      'href',
      `/about/sources#${track.sourceId}`,
    );
    expect(screen.getByRole('link', { name: track.licenseId })).toHaveAttribute(
      'href',
      `/about/sources#${track.licenseId}`,
    );
  });
});
