import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import launchJson from '../../../../packages/catalog/data/launch-catalog.public.json';
import { AppView } from '../App';
import { createDefaultServices } from '../app-services';
import { mapLaunchCatalog } from '../catalog/launch-catalog';

function renderGallery() {
  const services = { ...createDefaultServices(), catalog: mapLaunchCatalog(launchJson) };
  return render(
    <MemoryRouter initialEntries={['/galleries']}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

describe('source-backed model galleries', () => {
  it('shows twelve honest project cards with non-interactive curatorial recipes', () => {
    renderGallery();

    expect(screen.getByRole('heading', { level: 1, name: 'Model galleries' })).toBeInTheDocument();
    expect(screen.getAllByRole('article', { name: /gallery$/i })).toHaveLength(12);
    const vox = screen.getByRole('article', { name: 'VoxCPM2 gallery' });
    expect(within(vox).getByText('Recipe reviewed · runtime lock pending')).toBeInTheDocument();
    expect(within(vox).getByText(/Project-authored build recipe/i)).toBeInTheDocument();
    expect(within(vox).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(vox).queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
  });

  it('keeps source-only cards free of inline audio and download actions', () => {
    renderGallery();

    const f5 = screen.getByRole('article', { name: 'F5-TTS gallery' });
    expect(within(f5).getByText('Source only')).toBeInTheDocument();
    expect(within(f5).getByRole('link', { name: 'Open official project page' })).toHaveAttribute(
      'href',
      'https://swivid.github.io/F5-TTS/',
    );
    expect(within(f5).queryByRole('button')).not.toBeInTheDocument();
    expect(within(f5).queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
  });
});
