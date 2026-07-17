import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App, AppView } from './App';
import { createDefaultServices, createLaunchServices } from './app-services';
import launchJson from '../../../packages/catalog/data/launch-catalog.public.json';
import launchRaw from '../../../packages/catalog/data/launch-catalog.public.json?raw';
import { PreviewController, type AudioPort } from './audio/preview-controller';
import { mapLaunchCatalog } from './catalog/launch-catalog';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderRoute(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppView />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function renderLaunchRoute(route: string) {
  const defaults = createDefaultServices();
  const services = {
    ...defaults,
    catalog: mapLaunchCatalog(launchJson),
    runtimeSummary: {
      evidenceClearedVoiceCount: 92,
      operationalVoiceCount: 0,
      operationalEngineIds: [],
      operationalVoiceIds: [],
    },
  };
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

async function renderRouteWithPlayingPreview(route: string) {
  let paused = true;
  const audio: AudioPort = {
    src: 'https://example.invalid/sample.wav',
    currentTime: 0,
    duration: 4,
    get paused() {
      return paused;
    },
    async play() {
      paused = false;
    },
    pause() {
      paused = true;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const preview = new PreviewController(() => audio);
  await preview.play({
    id: 'modal-preview',
    title: 'Modal preview',
    audioUrl: audio.src,
    transcript: 'Modal isolation transcript.',
    sourceId: 'fixture-gallery-source',
    licenseId: 'fixture-sample-license',
  });
  const services = { ...createDefaultServices(), preview };

  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppView services={services} />
    </MemoryRouter>,
  );
}

describe('application routes', () => {
  it('boots production from the external launch catalog without a fixture fallback', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(launchRaw, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const loadServices = vi.fn(() => createLaunchServices(fetcher));

    render(<App loadServices={loadServices} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading the reviewed voice catalog');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Find a voice by the shape of its sound.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/426 source-backed preset voices/i)).toBeInTheDocument();
    expect(loadServices).toHaveBeenCalledTimes(1);
  });

  it('keeps launch routes and the shell free of fixture claims or widened runtime actions', () => {
    const view = renderLaunchRoute('/engines/kokoro');

    expect(screen.getByRole('heading', { level: 1, name: 'Kokoro 82M' })).toBeInTheDocument();
    expect(screen.getByText(/no verified operational adapter/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /use preset/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Reviewed launch catalog.*0 operational synthesis runtimes/i),
    ).toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(
      /example\.invalid|synthetic fixture|not the final/i,
    );

    view.unmount();
    renderLaunchRoute('/about/sources');
    expect(screen.getByText('Reviewed public launch evidence')).toBeInTheDocument();
    expect(screen.queryByText(/synthetic fixture evidence/i)).not.toBeInTheDocument();
  });

  it('publishes separate Pocket runtime and catalog-only coverage on Home and Pocket Engine', () => {
    const home = renderLaunchRoute('/');
    let coverage = screen.getByRole('region', { name: 'Pocket multilingual coverage' });
    expect(coverage).toHaveTextContent('426 runtime-declared presets');
    expect(coverage).toHaveTextContent('20 legacy Pocket pack presets');
    expect(coverage).toHaveTextContent('312 catalog-only variants');
    expect(coverage).toHaveTextContent(
      '240 source-license candidates with unpinned assets/runtime',
    );
    expect(coverage).toHaveTextContent('Output/personality-rights review still required');
    expect(coverage).toHaveTextContent('24 noncommercial link-only');
    expect(coverage).toHaveTextContent('48 provenance-pending link-only');
    expect(coverage).toHaveTextContent('Zero Pocket output clips');

    home.unmount();
    renderLaunchRoute('/engines/pocket');
    coverage = screen.getByRole('region', { name: 'Pocket multilingual coverage' });
    expect(coverage).toHaveTextContent('20 legacy Pocket pack presets');
    expect(coverage).toHaveTextContent('312 catalog-only variants');
    const catalogPresetFact = screen.getByText('Catalog presets').closest('div')!;
    expect(within(catalogPresetFact).getByText('20')).toBeVisible();
  });

  it.each([
    ['/', 'Find a voice by the shape of its sound.'],
    ['/voices', 'Voice atlas'],
    ['/play', 'Make a line speak'],
    ['/compare', 'Compare the same words'],
    ['/engines/fixture-browser', 'Fixture Browser Engine'],
    ['/companion', 'Local companion'],
    ['/about/sources', 'Sources, licenses, and limits'],
  ])('renders %s with its primary heading', (route, heading) => {
    renderRoute(route);

    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('opens and closes the responsive primary navigation', async () => {
    const user = userEvent.setup();
    renderRoute('/');

    const button = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Navigation' });
    const closeButton = within(dialog).getByRole('button', { name: 'Close navigation' });
    const appRoot = document.querySelector('.app-shell')?.parentElement;
    expect(closeButton).toHaveFocus();
    expect(appRoot).toHaveAttribute('inert');
    expect(document.querySelector('main')?.closest('[inert]')).toBe(appRoot);

    await user.tab({ shift: true });
    expect(within(dialog).getByRole('link', { name: 'Sources' })).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(appRoot).not.toHaveAttribute('inert');
  });
});

describe('voice explorer', () => {
  it('restores filters from the URL and persists subsequent filter changes', async () => {
    const user = userEvent.setup();
    renderRoute('/voices?q=voice&mode=browser&engine=fixture-browser');

    expect(screen.getByRole('searchbox', { name: 'Search voices' })).toHaveValue('voice');
    expect(screen.getByRole('checkbox', { name: 'Runs in browser' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Fixture Browser Engine' })).toBeChecked();
    expect(screen.getByText('2 presets')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Uses companion' }));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('mode=browser');
      expect(screen.getByTestId('location')).toHaveTextContent('mode=companion');
    });
  });

  it('renders complete sample-only disclosures and official actions', () => {
    renderRoute('/voices?mode=sample-only');

    expect(screen.getByText('A synthetic catalog fixture sample.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play official sample' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open official demo' })).toHaveAttribute(
      'href',
      'https://example.invalid/fixture-gallery/demo',
    );
    expect(screen.getByText('fixture-sample-license')).toBeInTheDocument();
    expect(screen.getByText('fixture-gallery-source')).toBeInTheDocument();
  });

  it('opens the mobile filter drawer with the same controls', async () => {
    const user = userEvent.setup();
    renderRoute('/voices');

    const trigger = screen.getByRole('button', { name: 'Open filters' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Voice filters' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close filters' })).toHaveFocus();
    expect(screen.getAllByRole('checkbox', { name: 'Runs in browser' })).toHaveLength(2);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Voice filters' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('isolates the whole app behind the filter drawer and blocks nested pointer interaction', async () => {
    const user = userEvent.setup();
    await renderRouteWithPlayingPreview('/voices');

    const trigger = screen.getByRole('button', { name: 'Open filters' });
    const navigationTrigger = screen.getByRole('button', { name: 'Open navigation' });
    const themeButton = screen.getByRole('button', { name: 'Theme: System' });
    const player = screen.getByRole('complementary', { name: 'Audio player' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Voice filters' });
    const appRoot = document.querySelector('.app-shell')?.parentElement;
    expect(appRoot).toHaveAttribute('inert');
    expect(themeButton.closest('[inert]')).toBe(appRoot);
    expect(player.closest('[inert]')).toBe(appRoot);
    expect(dialog.closest('[inert]')).toBeNull();

    fireEvent.click(navigationTrigger);
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(navigationTrigger).toHaveAttribute('aria-expanded', 'false');

    themeButton.focus();
    fireEvent.focusIn(themeButton);
    expect(within(dialog).getByRole('button', { name: 'Close filters' })).toHaveFocus();

    const browserMode = within(dialog).getByRole('checkbox', { name: 'Runs in browser' });
    await user.click(browserMode);
    expect(browserMode).toBeChecked();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Voice filters' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(appRoot).not.toHaveAttribute('inert');
  });
});

describe('creator workflows', () => {
  it('checks capability for the explicitly selected runtime mode', async () => {
    const user = userEvent.setup();
    renderRoute('/play?voice=fixture-browser%3Avoice-b');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Runtime' }), 'companion');

    expect(await screen.findByText('Companion is not connected.')).toBeInTheDocument();
    expect(
      screen.queryByText('Browser runtime is not installed in this build.'),
    ).not.toBeInTheDocument();
  });

  it('enforces the text limit and disables unavailable generation without fallback', async () => {
    renderRoute('/play?voice=fixture-browser%3Avoice-a');

    const text = screen.getByRole('textbox', { name: 'Text to synthesize' });
    expect(text).toHaveAttribute('maxlength', '2000');
    fireEvent.change(text, { target: { value: 'a'.repeat(2001) } });
    expect(text).toHaveValue('a'.repeat(2000));
    expect(screen.getByText('2,000 / 2,000')).toBeInTheDocument();

    expect(
      await screen.findByText('Browser runtime is not installed in this build.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Download WAV' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download WAV' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel generation' })).toBeDisabled();
  });

  it('excludes sample-only presets and caps comparison at three', async () => {
    const user = userEvent.setup();
    renderRoute('/compare');

    expect(
      screen.queryByRole('checkbox', { name: /Fixture Listen-only Voice/ }),
    ).not.toBeInTheDocument();
    const choices = screen.getAllByRole('checkbox', { name: /^Compare / });
    await user.click(choices[0]!);
    await user.click(choices[1]!);
    await user.click(choices[2]!);

    expect(choices[3]).toBeDisabled();
    expect(screen.getByText(/Sample-only presets stay in the listening atlas/)).toBeInTheDocument();
  });

  it('invalidates comparison output when the queue changes', async () => {
    const user = userEvent.setup();
    renderRoute('/compare?voice=fixture-browser%3Avoice-a');

    await user.click(screen.getByRole('button', { name: 'Run comparison' }));
    expect(
      await screen.findByText('Browser runtime is not installed in this build.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Compare Fixture Voice A' }));
    await user.click(screen.getByRole('checkbox', { name: 'Compare Fixture Companion Voice' }));

    expect(
      screen.queryByText('Browser runtime is not installed in this build.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
});
