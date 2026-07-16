# Launch architecture

## Data and execution boundaries

The production web app starts with a small application shell, then fetches the deterministic public
catalog JSON as a separate asset. The synthetic `example.invalid` fixture is imported only by the
explicit test/default-services seam and is never a production fallback.

Catalog generation also emits a SHA-256 integrity record. Production keeps only that digest in its
JavaScript. Production accepts only the same-origin content-addressed asset URL, rejects redirects,
final-URL mismatch, or a non-JSON content type, reads the response bytes once, verifies the digest,
parses the JSON, enforces schema/count invariants, and only then promotes the response to a
content-addressed CacheStorage entry. Online validation failure may use a previously verified exact
entry; a poisoned cache entry is rejected and deleted. The catalog remains outside the
service-worker shell precache.

```text
public launch JSON ---> React catalog, filters, gallery, and evidence pages
         |
         +-----------> immutable asset-set descriptions
                              |
user confirmation + exact terms acceptance
                              |
                              v
                    streaming hash/size verification ---> OPFS promotion
                              |
                              v
                    engine-specific Worker boundary (hard-disabled today)

planned uv companion <--- explicit local pairing + preset IDs only (not implemented today)
```

Contracts remain free of UI behavior. Catalog generation may read reviewed build-time data but does
not download models, call services, synthesize audio, or inspect private repositories. The web app
passes only catalog-owned engine, voice, and asset-set identifiers across Worker boundaries. It has
no voice-cloning, reference-audio, arbitrary-model, filesystem-path, or command field.

## Launch invariants

- Exactly 426 stable preset IDs: Edge 322, Kokoro 54, Pocket 20, Kitten 8, Supertonic 10, Piper 12.
- Declared runtime and evidence-cleared runtime counts are separate from operational runtime counts.
- Edge remains metadata-only behind a `terms-not-cleared` gate.
- All Piper presets remain `asset-unavailable` until their complete immutable distribution is
  pinned and browser-readable; representative evidence never widens that claim.
- Immutable assets carry URL, revision, SHA-256, byte length, source IDs, license IDs, and any exact
  terms acceptance. Asset-set acceptance references are checked in both directions.
- Construction, inspection, and cache description perform no network, storage, or Worker I/O.
- Every asset download requires explicit confirmation—even when no separate click-through license
  applies. Downloads stream into collision-resistant temporary OPFS keys, enforce size while
  streaming, verify SHA-256, then promote atomically. Failure, cancellation, or quota errors remove
  partial state.
- The four browser-delivery evidence records cover only their named representative assets. They are
  not an all-assets runtime certification.
- All real synthesis workers and the Pocket companion adapter are hard-disabled in the launch
  registry. Consequently, production operational count is zero.

## Gallery boundary

The model gallery has 12 project records. The first eight have fixed maintainer-owned recipes; the
last four are source-only. Recipe prompts, descriptions, seeds, parameters, model/code revisions,
dependencies, reference lineage, and runtime locks are provenance—not interactive browser input.

No generated clip is publishable until its candidate has a verified runtime environment and the
clip matches the candidate's exact lineage. Output rights, upstream obligations, human review,
hashes, source IDs, license IDs, and watermark requirements are mandatory. Source-only projects may
link to an official page but cannot embed or redistribute audio.

## PWA and deployment

The Vite build injects only shell JavaScript, CSS, fonts, and image assets into the service-worker
precache. The external catalog JSON and all model assets remain lazy. The service worker validates
the exact build shell and does not cache arbitrary HTML responses. Vercel serves the built web app
as a single-page application; deployment never adds provider credentials.

## Fixture boundary

`packages/catalog/fixtures/catalog.fixture.json` is synthetic test data using the reserved
`example.invalid` domain. It exercises runtime modes, samples, sorting, source/license references,
and unavailable behavior. It is not public provenance and must never be displayed by the production
boot path.
