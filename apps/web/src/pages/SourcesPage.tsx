import { useAppServices } from '../state/AppState';

function BooleanFact({ launch, value }: { launch: boolean; value: boolean }) {
  if (!launch) {
    return <span>{value ? 'Permitted by fixture record' : 'Not permitted by fixture record'}</span>;
  }
  return <span>{value ? 'Permission recorded' : 'No permission established by this record'}</span>;
}

export function SourcesPage() {
  const { catalog } = useAppServices();

  return (
    <div className="page page--sources">
      <header className="page-intro page-intro--split">
        <div>
          <h1>Sources, licenses, and limits</h1>
          <p>
            Every preset points to explicit evidence records. Unknown or unverified claims stay
            unknown instead of being inferred.
          </p>
        </div>
        <div className="atlas-coordinate" aria-hidden="true">
          EVIDENCE / REVIEW / HEALTH
        </div>
      </header>

      {catalog.kind === 'fixture' ? (
        <aside className="fixture-warning">
          <strong>This build uses synthetic fixture evidence.</strong>
          <p>
            The <code>example.invalid</code> URLs are intentionally non-resolving and must not be
            treated as public provenance.
          </p>
        </aside>
      ) : (
        <aside className="launch-evidence-note">
          <strong>Reviewed public launch evidence</strong>
          <p>
            Source, license, revision, digest, and gate records are loaded from the deterministic
            external launch catalog. Evidence-cleared does not mean operational inference.
          </p>
        </aside>
      )}

      <section aria-labelledby="license-heading" className="evidence-section">
        <div className="section-heading">
          <h2 id="license-heading">License records</h2>
          <span>
            {catalog.licenses.size} reviewed {catalog.kind === 'launch' ? 'public' : 'fixture'}{' '}
            records
          </span>
        </div>
        <div className="evidence-list">
          {[...catalog.licenses.values()].map((license) => (
            <article id={license.id} key={license.id}>
              <div className="evidence-list__identity">
                <code>{license.id}</code>
                <h3>{license.name}</h3>
                <span>{license.scope}</span>
              </div>
              <dl>
                <div>
                  <dt>Attribution</dt>
                  <dd>{license.attribution}</dd>
                </div>
                <div>
                  <dt>Redistribution</dt>
                  <dd>
                    <BooleanFact
                      launch={catalog.kind === 'launch'}
                      value={license.redistribution}
                    />
                  </dd>
                </div>
                <div>
                  <dt>Commercial use</dt>
                  <dd>
                    <BooleanFact launch={catalog.kind === 'launch'} value={license.commercialUse} />
                  </dd>
                </div>
                <div>
                  <dt>Review</dt>
                  <dd>{license.reviewStatus}</dd>
                </div>
              </dl>
              {license.terms !== null ? <p>{license.terms}</p> : null}
              <a href={license.url} rel="noreferrer" target="_blank">
                Open recorded evidence URL
              </a>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="source-heading" className="evidence-section">
        <div className="section-heading">
          <h2 id="source-heading">Source records</h2>
          <span>Generated {new Date(catalog.generatedAt).toLocaleDateString('en-GB')}</span>
        </div>
        <div className="source-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Source ID</th>
                <th scope="col">Class</th>
                <th scope="col">Revision</th>
                <th scope="col">Health</th>
                <th scope="col">Last verified</th>
              </tr>
            </thead>
            <tbody>
              {[...catalog.sources.values()].map((source) => (
                <tr id={source.id} key={source.id}>
                  <th scope="row">
                    <a href={source.url} rel="noreferrer" target="_blank">
                      {source.id}
                    </a>
                  </th>
                  <td>{source.sourceClass.replaceAll('-', ' ')}</td>
                  <td>{source.revision}</td>
                  <td>{source.health}</td>
                  <td>{new Date(source.lastVerifiedAt).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="product-limits" className="limits-section">
        <h2 id="product-limits">Product limits are part of the interface</h2>
        <ul>
          <li>No autoplay or hidden runtime fallback.</li>
          <li>No voice upload, cloning, account, or cloud history.</li>
          <li>
            Sample-only entries remain listening experiences and never enter generation comparison.
          </li>
          <li>
            Unavailable providers report why they are unavailable; they do not fabricate success.
          </li>
        </ul>
      </section>
    </div>
  );
}
