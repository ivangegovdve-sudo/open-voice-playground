import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppView } from './App';

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

describe('application routes', () => {
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
    expect(closeButton).toHaveFocus();
    expect(document.querySelector('main')).toHaveAttribute('inert');

    await user.tab({ shift: true });
    expect(within(dialog).getByRole('link', { name: 'Sources' })).toHaveFocus();
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(document.querySelector('main')).not.toHaveAttribute('inert');
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

  it('enforces the text limit and reports the unavailable runtime without fallback', async () => {
    const user = userEvent.setup();
    renderRoute('/play?voice=fixture-browser%3Avoice-a');

    const text = screen.getByRole('textbox', { name: 'Text to synthesize' });
    expect(text).toHaveAttribute('maxlength', '2000');
    fireEvent.change(text, { target: { value: 'a'.repeat(2001) } });
    expect(text).toHaveValue('a'.repeat(2000));
    expect(screen.getByText('2,000 / 2,000')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Generate speech' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Browser runtime is not installed in this build.',
    );
    expect(screen.getByRole('button', { name: 'Download WAV' })).toBeDisabled();
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
