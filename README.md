# Open Voice Playground

Open Voice Playground is an MIT-licensed, preset-only voice catalog and React playground. The
checked-in schema-version-4 release deliberately separates 426 runtime-declared preset voices from
312 catalog-only Pocket multilingual variants. The 426 runtime-declared records are:

- 322 Edge voice metadata records (terms-gated; no synthesis)
- 54 Kokoro presets
- 20 Pocket TTS companion presets
- 8 KittenTTS presets
- 10 Supertonic presets
- 12 Piper presets (asset-unavailable until a pinned CORS-readable distribution exists)

The separate Pocket coverage collection adds 312 searchable metadata records without adding them
to the runtime voice registry, operational counts, model packs, generated media, or companion
protocol. The public interface can therefore describe 738 records while preserving an exact
426/312 execution boundary.

The catalog currently marks 92 presets as evidence-cleared for their declared browser or companion
mode. The production app intentionally reports **0 operational synthesis runtimes**: its real
workers and planned local companion remain hard-disabled until engine-specific execution,
compatibility, and output verification are complete. The interface never substitutes another
runtime or fabricates audio.

The 12-project model gallery contains eight fixed, maintainer-owned generation recipes and four
source-only records. No generated media or copied upstream sample audio is published in this
release.

## Pocket multilingual release ledger

| Population or policy                                   | Count | Launch behavior                                                        |
| ------------------------------------------------------ | ----: | ---------------------------------------------------------------------- |
| Runtime-declared voices, all engines                   |   426 | Existing runtime catalog; production operational count remains zero    |
| Legacy Pocket runtime-pack presets                     |    20 | Included in the 426; unchanged by multilingual coverage                |
| Pocket multilingual catalog-only variants              |   312 | Metadata/filtering plus an ordinary link to the external official demo |
| Source-license candidates with unpinned assets/runtime |   240 | Catalog-only; output and personality rights are not cleared            |
| Noncommercial source records                           |    24 | Link-only; never hosted, commercial, runtime-enabled, or playable      |
| Per-clip provenance-pending records                    |    48 | Link-only until exact source and rights are proven                     |
| Published Pocket output clips                          |     0 | No `<audio>` or copied conditioning/source recording                   |
| Official Pocket live-demo records                      |     1 | Internet-only external navigation; no proxy, prefetch, or cache        |

The 312 records are the exact Cartesian product of 12 reviewed selectors and 26 labels. Their six
language totals are English 78, French 26, German 52, Italian 52, Portuguese 52, and Spanish 52.
Each identity has the stable form `pocket:${selectorId}.${label}` and keeps selector siblings
distinct even when they share a language. Language uses the reviewed base BCP-47 tag (`en`, `fr`,
`de`, `it`, `pt`, or `es`); country is `null` and gender is `unspecified` because neither is
inferred from a label, selector, recording, or name.

The 240 source-license candidates have unpinned assets/runtime. That classification does not
establish generated-output licensing or personality, publicity, performer, consent, publication,
commercial-use, or redistribution rights. Every one of those decisions still requires affirmative
review. The 24 CC BY-NC variants and the 48 provenance-pending variants remain link-only.

Pocket cards link to Kyutai's official live-generation page only after a person activates the link.
The application does not call, embed, proxy, preload, or cache the demo, model, embeddings,
conditioning recordings, or generated response. Verified catalog metadata and filters remain
available offline; the external demo does not. The official source recordings are conditioning
material, not Pocket-generated samples, and are never presented or redistributed as output.

See [the architecture](docs/architecture.md) for the six immutable revision pins and inventory
digest, and [the generated-media policy](docs/GENERATED_MEDIA_NOTICE.md) for the exact provenance,
rights, and human-review gate that must close before any future project-generated Pocket clip can
be published.

## Requirements

- Node.js 22.13 or newer
- npm 11

On Windows, invoke npm through `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run catalog:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run format:check
npm.cmd run audit
```

Use `npm.cmd run dev` for the Vite development server. The production boot path lazily fetches the
deterministic external launch JSON; the synthetic fixture catalog remains an explicit test seam
only. A generated SHA-256 constant verifies the exact response bytes before JSON parsing or runtime
cache promotion. Model manifests are not bundled or service-worker precached. A download cannot begin before
an exact-manifest confirmation, and applicable click-through terms must also be accepted.

## Workspaces

| Workspace            | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `apps/web`           | React 19/Vite catalog, gallery, runtime boundaries, and PWA UI |
| `apps/companion`     | Reserved boundary for the planned uv-managed local companion   |
| `packages/contracts` | Strict public catalog and runtime protocol contracts           |
| `packages/catalog`   | Deterministic launch data, provenance, generation, and checks  |

The local companion is not implemented in this release. Its locked direction is a small,
uv-managed preset service with explicit pairing—no Docker requirement, voice uploads, cloning,
arbitrary model URLs, filesystem paths, or shell-command API.

See [the architecture](docs/architecture.md), [third-party notices](THIRD_PARTY_NOTICES.md),
[generated-media policy](docs/GENERATED_MEDIA_NOTICE.md), and
[Edge snapshot maintenance procedure](docs/edge-snapshot-maintenance.md).

## Licensing

Repository-authored application code is provided under the [MIT License](LICENSE). That license
does not relicense third-party code, models, weights, voices, datasets, samples, services, or
generated outputs. It also does not relicense Pocket embeddings, conditioning/source audio, or a
future synthetic output. Each public record retains its own evidence and restrictions in
`packages/catalog/data/launch-catalog.public.json`.
