import { Link } from 'react-router-dom';

import type { GenerationCandidate } from '@open-voice/contracts';

import { ArrowIcon } from '../components/Icons';
import { useAppServices } from '../state/AppState';

const READINESS_LABELS: Record<GenerationCandidate['readiness'], string> = {
  'ready-for-generation': 'Execution provenance verified',
  'recipe-ready-runtime-pending': 'Recipe reviewed · runtime lock pending',
  'blocked-pending-reference': 'Blocked · reference lineage pending',
  'blocked-pending-checkpoint-verification': 'Blocked · checkpoint verification pending',
  'blocked-pending-dependency-pin': 'Blocked · dependency pin pending',
};

function shortRevision(value: string): string {
  return `${value.slice(0, 10)}…`;
}

function displayParameter(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export function GalleryPage() {
  const { catalog } = useAppServices();
  const candidates = new Map(
    catalog.generationCandidates.map((candidate) => [candidate.id, candidate]),
  );

  return (
    <div className="page page--galleries">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Model galleries</h1>
          <p>
            Twelve carefully gated open voice projects. Reviewed build recipes are descriptive and
            non-interactive; source-only projects never expose copied audio or generation controls.
          </p>
        </div>
        <div className="atlas-coordinate" aria-hidden="true">
          12 PROJECTS / 0 PUBLISHED CLIPS
        </div>
      </header>

      <aside className="gallery-boundary">
        <strong>Preset-only boundary</strong>
        <p>
          Fixed descriptions, prompts, and future references belong to maintainer-owned build
          recipes. They are never sent through the browser worker protocol or offered as user input.
        </p>
      </aside>

      <section aria-label="Open voice project galleries" className="gallery-grid">
        {catalog.galleries.map((gallery, index) => {
          const candidate =
            gallery.candidateId === null ? null : (candidates.get(gallery.candidateId) ?? null);
          return (
            <article
              aria-label={`${gallery.displayName} gallery`}
              className="gallery-card"
              key={gallery.id}
            >
              <header className="gallery-card__header">
                <span className="gallery-card__index">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <h2>{gallery.displayName}</h2>
                  <span className={`gallery-state gallery-state--${gallery.mode}`}>
                    {gallery.mode === 'source-only'
                      ? 'Source only'
                      : candidate === null
                        ? 'Candidate unavailable'
                        : READINESS_LABELS[candidate.readiness]}
                  </span>
                </div>
              </header>

              <p className="gallery-card__notice">{gallery.notice}</p>

              {candidate === null ? (
                <div className="gallery-source-only">
                  <p>
                    This project remains a research/source reference. No sample is embedded and no
                    output is offered for download.
                  </p>
                </div>
              ) : (
                <div className="gallery-recipe">
                  <p className="gallery-recipe__boundary">
                    Project-authored build recipe — not an interactive user prompt.
                  </p>
                  <blockquote>{candidate.transcript}</blockquote>
                  <dl className="gallery-recipe__facts">
                    <div>
                      <dt>Locale</dt>
                      <dd>{candidate.locale}</dd>
                    </div>
                    <div>
                      <dt>Seed</dt>
                      <dd>{candidate.seed}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd title={candidate.modelRevision}>
                        {shortRevision(candidate.modelRevision)}
                      </dd>
                    </div>
                    <div>
                      <dt>Code</dt>
                      <dd title={candidate.codeRevision}>
                        {shortRevision(candidate.codeRevision)}
                      </dd>
                    </div>
                  </dl>
                  <p className="gallery-recipe__readiness">{candidate.readinessDetail}</p>
                  <details>
                    <summary>Inspect fixed recipe parameters</summary>
                    <dl className="gallery-parameters">
                      {Object.entries(candidate.parameters).map(([name, value]) => (
                        <div key={name}>
                          <dt>{name.replaceAll('_', ' ')}</dt>
                          <dd>{displayParameter(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
              )}

              <div className="gallery-card__evidence">
                <span>Evidence</span>
                <p>
                  {gallery.sourceIds.map((sourceId, sourceIndex) => (
                    <span key={sourceId}>
                      {sourceIndex > 0 ? ' · ' : null}
                      <Link to={`/about/sources#${sourceId}`}>{sourceId}</Link>
                    </span>
                  ))}
                </p>
                <p>
                  {gallery.licenseIds.map((licenseId, licenseIndex) => (
                    <span key={licenseId}>
                      {licenseIndex > 0 ? ' · ' : null}
                      <Link to={`/about/sources#${licenseId}`}>{licenseId}</Link>
                    </span>
                  ))}
                </p>
              </div>

              <a
                className="button button--secondary"
                href={gallery.officialProjectUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open official project page <ArrowIcon />
              </a>
            </article>
          );
        })}
      </section>
    </div>
  );
}
