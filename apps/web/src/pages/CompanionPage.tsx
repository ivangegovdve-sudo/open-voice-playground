import { RUNTIME_LABELS } from '../catalog/catalog';
import { PocketCoverageSummary } from '../components/PocketCoverageSummary';
import { useAppServices } from '../state/AppState';

export function CompanionPage() {
  const { catalog } = useAppServices();
  const companionVoices = catalog.voices.filter((voice) =>
    voice.runtimeModes.includes('companion'),
  );
  const pocketCoverage = catalog.pocketCoverage;

  return (
    <div className="page page--companion">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Local companion</h1>
          <p>
            {catalog.kind === 'launch'
              ? 'A planned uv-managed local companion will run the fixed Pocket TTS presets without Docker. It is not implemented or connected in this build.'
              : 'A future Windows tray companion can run heavier preset engines on this machine. The public app stays useful without it.'}
          </p>
        </div>
        <div className="connection-state" role="status">
          <span aria-hidden="true" />
          Not connected
        </div>
      </header>

      <section aria-labelledby="companion-boundary" className="companion-boundary">
        <div className="section-heading">
          <h2 id="companion-boundary">Narrow local boundary</h2>
          <span>{RUNTIME_LABELS.companion}</span>
        </div>
        <ol>
          <li>
            <span>01</span>
            <div>
              <strong>Preset identifiers only</strong>
              <p>
                No voice uploads, cloning, arbitrary model URLs, filesystem paths, or shell
                commands.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Explicit pairing</strong>
              <p>The companion is never contacted until a user pairs and chooses its runtime.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Local lifecycle</strong>
              <p>
                Generated audio and history remain on this device; cloud history is not part of this
                app.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {pocketCoverage !== null ? (
        <PocketCoverageSummary
          coverage={pocketCoverage}
          eyebrow="Discovery is broader than the runtime pack"
          headingId="companion-pocket-coverage"
          inset
          pocketPackPresetCount={companionVoices.length}
          runtimePresetCount={catalog.voices.length}
        />
      ) : null}

      <section aria-labelledby="companion-seed" className="companion-seed">
        <div className="section-heading">
          <h2 id="companion-seed">
            {catalog.kind === 'launch'
              ? 'Pocket companion manifest'
              : 'Companion-ready fixture entries'}
          </h2>
          <span>{companionVoices.length} presets</span>
        </div>
        <ul>
          {companionVoices.map((voice) => (
            <li aria-label={`Pocket preset ${voice.name}`} key={voice.id}>
              <strong>{voice.name}</strong>
              <span>{voice.engineName}</span>
              <small>Unavailable until a verified adapter and paired companion are present.</small>
            </li>
          ))}
        </ul>
      </section>
      {catalog.kind === 'launch' ? (
        <aside className="companion-source-note">
          <p>
            The pinned upstream voice WAVs are reference/source clips, not Pocket TTS outputs. This
            playground does not present them as generated samples.
          </p>
          <a href="https://kyutai.org/tts" rel="noreferrer" target="_blank">
            Open Kyutai's official remote demo
          </a>
          <small>
            External link only: this app does not copy, proxy, cache, or call the demo service.
          </small>
        </aside>
      ) : null}
    </div>
  );
}
