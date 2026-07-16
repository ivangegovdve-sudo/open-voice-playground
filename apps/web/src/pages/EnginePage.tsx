import { Link, useParams } from 'react-router-dom';

import { RUNTIME_LABELS } from '../catalog/catalog';
import { ArrowIcon } from '../components/Icons';
import { useAppServices, useLocalState } from '../state/AppState';

export function EnginePage() {
  const { slug } = useParams();
  const { catalog, runtimeSummary } = useAppServices();
  const { snapshot } = useLocalState();
  const engine = catalog.engines.find((candidate) => candidate.id === slug);

  if (engine === undefined) {
    return (
      <div className="page narrow-page">
        <h1>Engine not found</h1>
        <p>
          The requested engine is not present in this{' '}
          {catalog.kind === 'launch' ? 'reviewed launch catalog' : 'validated seed'}.
        </p>
        <Link className="button button--primary" to="/voices">
          Return to voices
        </Link>
      </div>
    );
  }

  const voices = catalog.voices.filter((voice) => voice.engineId === engine.id);
  const cache = snapshot.modelCache[engine.id] ?? 'not-cached';
  const operational = voices.some((voice) => runtimeSummary.operationalVoiceIds.includes(voice.id));

  return (
    <div className="page page--engine">
      <header className="engine-header">
        <div>
          <h1>{engine.name}</h1>
          <p>{engine.classification.replaceAll('-', ' ')}</p>
        </div>
        <div className="runtime-list">
          {engine.runtimeModes.map((mode) => (
            <span className={`runtime-label runtime-label--${mode}`} key={mode}>
              {RUNTIME_LABELS[mode]}
            </span>
          ))}
        </div>
      </header>

      <dl className="engine-facts">
        <div>
          <dt>{catalog.kind === 'launch' ? 'Catalog presets' : 'Presets in seed'}</dt>
          <dd>{voices.length}</dd>
        </div>
        <div>
          <dt>Declared locales</dt>
          <dd>{engine.languageTags.join(', ')}</dd>
        </div>
        <div>
          <dt>Model cache</dt>
          <dd>
            {engine.runtimeModes.includes('browser') ? cache.replace('-', ' ') : 'Not applicable'}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="engine-presets" className="engine-preset-list">
        <div className="section-heading">
          <h2 id="engine-presets">Preset line</h2>
          <Link to={`/voices?engine=${engine.id}`}>Filter the atlas</Link>
        </div>
        <ol>
          {voices.map((voice) => (
            <li key={voice.id}>
              <span>{voice.name}</span>
              <small>{voice.locale}</small>
              {catalog.kind === 'launch' ? (
                <Link to={`/play?voice=${encodeURIComponent(voice.id)}`}>
                  Inspect status <ArrowIcon />
                </Link>
              ) : !voice.runtimeModes.includes('sample-only') ? (
                <Link to={`/play?voice=${encodeURIComponent(voice.id)}`}>
                  Use preset <ArrowIcon />
                </Link>
              ) : (
                <Link to={`/voices?engine=${engine.id}`}>Listen in atlas</Link>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="engine-evidence" className="evidence-line">
        <h2 id="engine-evidence">
          {catalog.kind === 'launch'
            ? 'Reviewed launch evidence'
            : 'Evidence carried by this fixture'}
        </h2>
        <p>
          {catalog.kind === 'launch'
            ? operational
              ? 'This engine has a verified operational adapter.'
              : 'Catalog evidence is present, but this engine has no verified operational adapter in the current build.'
            : 'These are synthetic foundation records, not public launch provenance.'}
        </p>
        <div>
          <span>Sources</span>
          {engine.sourceIds.map((id) => (
            <Link key={id} to={`/about/sources#${id}`}>
              {id}
            </Link>
          ))}
        </div>
        <div>
          <span>Licenses</span>
          {engine.licenseIds.map((id) => (
            <Link key={id} to={`/about/sources#${id}`}>
              {id}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
