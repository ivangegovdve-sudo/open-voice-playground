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
public launch JSON ---> 426 runtime-declared voices ---> runtime/asset boundaries
         |
         +-----------> 312 Pocket coverage variants ---> metadata/filtering/external link only
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

## Pocket multilingual coverage boundary

Schema version 4 carries the following Pocket populations as different data classes:

| Invariant                                    | Exact value |
| -------------------------------------------- | ----------: |
| Runtime-declared voices, all engines         |         426 |
| Legacy Pocket voices inside the runtime pack |          20 |
| Pocket multilingual coverage variants        |         312 |
| Source-license candidates                    |         240 |
| Noncommercial link-only variants             |          24 |
| Provenance-pending link-only variants        |          48 |
| Published Pocket output clips                |           0 |
| Official Pocket live-demo records            |           1 |

The legacy 20 Pocket presets and their pack remain unchanged inside `voices`. The additional 312
records live only in `pocketCoverage`: none enters `SeedCatalog.voices`, an asset set, runtime
selection, generation candidate, generated-media record, Play/Compare behavior, the companion
protocol, or an operational count. The expanded collection is carried by the verified external
catalog JSON rather than the initial JavaScript bundle.

The coverage inventory is an exact `12 selectors x 26 labels = 312` closure with inventory digest
`sha256:67bb94d81b1a74f18ba13952a355b474ee8788201a58a66a49126316b9e33f6d`.
Every stable ID is `pocket:${selectorId}.${label}` and its exact upstream path is
`languages/${selectorId}/embeddings/${label}.safetensors`. Selectors that share a language remain
separate identities and paths.

| Base BCP-47 language | Selectors | Variants |
| -------------------- | --------: | -------: |
| English (`en`)       |         3 |       78 |
| French (`fr`)        |         1 |       26 |
| German (`de`)        |         2 |       52 |
| Italian (`it`)       |         2 |       52 |
| Portuguese (`pt`)    |         2 |       52 |
| Spanish (`es`)       |         2 |       52 |

The selector supplies only its reviewed base language tag. Every coverage record has
`countryCode: null` and `gender: "unspecified"`; country, region, accent, gender, and identity are
never inferred from a filename, label, recording, name, or apparent voice.

### Immutable audit pins

| Coverage role                | Exact revision                             |
| ---------------------------- | ------------------------------------------ |
| Stable Pocket code           | `058886528d0b6f2f2d4022de2e244a5260729e6e` |
| Current code audit           | `d108410d23eef7e01db282f9442891162dbc3db6` |
| Full cloning-capable model   | `4c8ad48f8a003909bc4f1122cbe88a4252124621` |
| Preset-only no-cloning model | `e041936c75475d350b405bc870bcf7c22da4e9e6` |
| Voice-source repository      | `323332d33f997de8394f24a193e1a76df720e01a` |
| Historical prompt snapshot   | `64ab7d24c479d736a83b8cc666c4a776fca30fda` |

The full model and historical snapshot are audit evidence only; this release does not accept their
gates or download their media. The no-cloning tree establishes inventory, not a release-ready
multilingual runtime: its selector assets and full runtime closure are not pinned into launch asset
sets.

### Rights and delivery policy

The 240 `catalog-only-runtime-candidate` variants are **source-license candidates with unpinned
assets/runtime**. Source-license eligibility is not generated-output clearance and does not settle
personality, publicity, privacy, performer, consent, publication, commercial-use, or redistribution
rights. A separate affirmative decision is required before generation or publication.

The 24 Cosette/Expresso and Jean/EARS variants remain `link-only-noncommercial`; they cannot become
runtime candidates, hosted media, commercial content, or playable clips. The 48 Giovanni, Lola,
Juergen, and Rafael variants remain `link-only-provenance-pending` until exact per-clip source,
license, consent, and attribution evidence exists.

There are zero reviewed Pocket-generated output clips. Source WAV/MP3 files are conditioning or
prompt recordings, not model output, and cannot be relabeled, copied, proxied, cached, or played as
samples. The one official-demo record points to `https://kyutai.org/tts` as ordinary external,
internet-required navigation. Page construction, offline startup, filtering, and scrolling make no
request to the demo, blog, Hugging Face, model, embedding, prompt, source audio, or generated audio;
none enters the service-worker shell cache. Verified coverage metadata remains usable offline, but
the live demo does not.

Repository MIT terms apply only to repository-authored code. They do not relicense Pocket code,
models, weights, embeddings, datasets, voices, conditioning/source recordings, services, or
generated outputs. The exact gate for a separately reviewed project-generated clip is defined in
`docs/GENERATED_MEDIA_NOTICE.md`.

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
