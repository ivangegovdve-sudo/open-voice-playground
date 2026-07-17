import { Link } from 'react-router-dom';

import { RUNTIME_LABELS } from '../catalog/catalog';
import { ArrowIcon, WaveformMark } from '../components/Icons';
import { PocketCoverageSummary } from '../components/PocketCoverageSummary';
import { useAppServices, useLocalState } from '../state/AppState';

export function HomePage() {
  const { catalog, runtimeSummary } = useAppServices();
  const { snapshot } = useLocalState();
  const recentVoices = snapshot.recent
    .map((id) => catalog.voices.find((voice) => voice.id === id))
    .filter((voice) => voice !== undefined);
  const favorites = catalog.voices.filter((voice) => snapshot.favorites.includes(voice.id));
  const pocketCoverage = catalog.pocketCoverage;
  const pocketPackPresetCount = catalog.voices.filter(
    (voice) => voice.engineId === 'pocket' && voice.runtimeModes.includes('companion'),
  ).length;

  return (
    <div className="page page--home">
      <section className="home-hero">
        <div className="home-hero__copy">
          <h1>Find a voice by the shape of its sound.</h1>
          <p>
            {catalog.kind === 'launch'
              ? 'Browse source-backed presets across declared browser, external-service, and companion modes, then inspect twelve carefully gated model galleries.'
              : 'Browse preset voices across browser, online, companion, and official-sample runtimes—with source and license context kept beside every choice.'}
          </p>
          <div className="hero-actions">
            <Link className="button button--primary button--large" to="/voices">
              Enter the voice atlas <ArrowIcon />
            </Link>
            <Link className="button button--quiet button--large" to="/play">
              Open the workbench
            </Link>
          </div>
          <p className="fixture-disclosure">
            {catalog.kind === 'launch'
              ? `${catalog.voices.length} source-backed preset voices. ${runtimeSummary.evidenceClearedVoiceCount} are evidence-cleared for their declared browser or companion mode; ${runtimeSummary.operationalVoiceCount} are operational in this build. Real workers or a paired companion must pass verification first.`
              : `Interface seed: ${catalog.voices.length} validated synthetic fixture presets. This is not the final public launch catalog.`}
          </p>
        </div>
        <div className="sonic-map" aria-hidden="true">
          <div className="sonic-map__contour sonic-map__contour--one" />
          <div className="sonic-map__contour sonic-map__contour--two" />
          <div className="sonic-map__axis sonic-map__axis--horizontal" />
          <div className="sonic-map__axis sonic-map__axis--vertical" />
          <WaveformMark className="sonic-map__wave" />
          <span className="sonic-map__label sonic-map__label--one">LANGUAGE</span>
          <span className="sonic-map__label sonic-map__label--two">RUNTIME</span>
          <span className="sonic-map__point sonic-map__point--coral" />
          <span className="sonic-map__point sonic-map__point--cyan" />
        </div>
      </section>

      {pocketCoverage !== null ? (
        <PocketCoverageSummary
          coverage={pocketCoverage}
          eyebrow="Catalog boundary"
          headingId="home-pocket-coverage"
          pocketPackPresetCount={pocketPackPresetCount}
          runtimePresetCount={catalog.voices.length}
        />
      ) : null}

      <section aria-labelledby="runtime-heading" className="runtime-rail">
        <div className="section-heading">
          <h2 id="runtime-heading">
            {catalog.kind === 'launch'
              ? 'Declared runtime coordinates'
              : 'Four honest runtime coordinates'}
          </h2>
          <p>
            {catalog.kind === 'launch'
              ? 'Catalog declarations are not operational capability; no mode is substituted silently.'
              : 'No mode is substituted silently.'}
          </p>
        </div>
        <ol>
          {(Object.keys(RUNTIME_LABELS) as Array<keyof typeof RUNTIME_LABELS>).map(
            (mode, index) => (
              <li key={mode}>
                <span className="rail-index">0{index + 1}</span>
                <strong>{RUNTIME_LABELS[mode]}</strong>
                <span>
                  {catalog.voices.filter((voice) => voice.runtimeModes.includes(mode)).length}{' '}
                  {mode === 'sample-only' ? 'listening preset' : 'catalog entries'}
                </span>
              </li>
            ),
          )}
        </ol>
      </section>

      <section aria-labelledby="engines-heading" className="engine-rail">
        <div className="section-heading">
          <h2 id="engines-heading">
            {catalog.kind === 'launch' ? 'Six launch catalog engines' : 'Engines in this seed'}
          </h2>
          <Link className="text-link" to="/about/sources">
            How evidence works <ArrowIcon />
          </Link>
        </div>
        <ol>
          {catalog.engines.map((engine) => (
            <li key={engine.id}>
              <Link to={`/engines/${engine.id}`}>
                <span>{engine.name}</span>
                <small>{engine.runtimeModes.map((mode) => RUNTIME_LABELS[mode]).join(' · ')}</small>
                <ArrowIcon />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="local-rails">
        <div>
          <div className="section-heading">
            <h2>Recent</h2>
            <span>Stored on this device</span>
          </div>
          {recentVoices.length === 0 ? (
            <p className="quiet-empty">
              Play a verified sample or open a preset to start a local trail.
            </p>
          ) : (
            <ul>
              {recentVoices.map((voice) => (
                <li key={voice.id}>{voice.name}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="section-heading">
            <h2>Favorites</h2>
            <span>{snapshot.storage === 'indexeddb' ? 'IndexedDB' : 'Safe memory mode'}</span>
          </div>
          {favorites.length === 0 ? (
            <p className="quiet-empty">Mark voices in the atlas to keep them close.</p>
          ) : (
            <ul>
              {favorites.map((voice) => (
                <li key={voice.id}>{voice.name}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
