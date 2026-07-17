import { Link } from 'react-router-dom';

import type { SeedCatalog } from '../catalog/catalog';
import { ArrowIcon } from './Icons';

type PocketCoverage = NonNullable<SeedCatalog['pocketCoverage']>;

export function PocketCoverageSummary({
  coverage,
  eyebrow,
  headingId,
  inset = false,
  pocketPackPresetCount,
  runtimePresetCount,
}: {
  coverage: PocketCoverage;
  eyebrow: string;
  headingId: string;
  inset?: boolean;
  pocketPackPresetCount: number;
  runtimePresetCount: number;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={`pocket-coverage-summary${inset ? ' pocket-coverage-summary--inset' : ''}`}
    >
      <div className="pocket-coverage-summary__heading">
        <div>
          <span>{eyebrow}</span>
          <h2 id={headingId}>Pocket multilingual coverage</h2>
        </div>
        <Link className="text-link" to="/voices?mode=catalog-only&engine=pocket">
          Browse all {coverage.totalEmbeddings} variants <ArrowIcon />
        </Link>
      </div>
      <dl className="pocket-coverage-summary__facts">
        <div>
          <dt>Runtime catalog</dt>
          <dd>{runtimePresetCount} runtime-declared presets</dd>
        </div>
        <div>
          <dt>Legacy Pocket pack</dt>
          <dd>{pocketPackPresetCount} legacy Pocket pack presets</dd>
        </div>
        <div>
          <dt>Multilingual inventory</dt>
          <dd>{coverage.totalEmbeddings} catalog-only variants</dd>
        </div>
      </dl>
      <p className="pocket-coverage-summary__rights">
        <strong>
          {coverage.rightsCounts.catalogOnlyRuntimeCandidate} source-license candidates with
          unpinned assets/runtime
        </strong>
        <span>Output/personality-rights review still required</span>
        <span>{coverage.rightsCounts.linkOnlyNonCommercial} noncommercial link-only</span>
        <span>{coverage.rightsCounts.linkOnlyProvenancePending} provenance-pending link-only</span>
        <span>
          {coverage.publishedOutputClipCount === 0
            ? 'Zero Pocket output clips'
            : `${coverage.publishedOutputClipCount} Pocket output clips`}
        </span>
      </p>
    </section>
  );
}
