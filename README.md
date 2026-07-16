# Open Voice Playground

Open Voice Playground is an MIT-licensed, preset-only voice catalog and React playground. The
checked-in public launch catalog contains exactly 426 reviewed preset records:

- 322 Edge voice metadata records (terms-gated; no synthesis)
- 54 Kokoro presets
- 20 Pocket TTS companion presets
- 8 KittenTTS presets
- 10 Supertonic presets
- 12 Piper presets (asset-unavailable until a pinned CORS-readable distribution exists)

The catalog currently marks 92 presets as evidence-cleared for their declared browser or companion
mode. The production app intentionally reports **0 operational synthesis runtimes**: its real
workers and planned local companion remain hard-disabled until engine-specific execution,
compatibility, and output verification are complete. The interface never substitutes another
runtime or fabricates audio.

The 12-project model gallery contains eight fixed, maintainer-owned generation recipes and four
source-only records. No generated media or copied upstream sample audio is published in this
release.

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
generated outputs. Each public record retains its own evidence and restrictions in
`packages/catalog/data/launch-catalog.public.json`.
