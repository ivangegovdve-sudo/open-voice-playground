# Open Voice Playground

Open Voice Playground is an MIT-licensed monorepo for a preset-only voice catalog, a React web
application, and a future Windows companion. This foundation deliberately contains no engine
inference, voice cloning, reference-audio input, arbitrary model loading, or production catalog
claims.

The checked-in catalog is synthetic fixture data. Its counts validate the catalog pipeline only and
must not be presented as launch engine or voice counts.

## Requirements

- Node.js 22.13 or newer
- npm 11

On this Windows host, invoke npm through `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run catalog:validate
```

Use `npm.cmd run dev` for the Vite development server. Copy `.env.example` to `.env.local` only if
local origin overrides are needed; committed environment files contain no values.

## Workspaces

| Workspace            | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `apps/web`           | React 19 and Vite application boundary; Task 1 includes only a placeholder shell. |
| `apps/companion`     | Reserved boundary for the later Tauri 2 Windows companion.                        |
| `packages/contracts` | Strict Zod contracts for runtime modes and catalog records.                       |
| `packages/catalog`   | Manifest loading, deterministic sorting, counts, and release validation.          |

Focused commands are available as `test:contracts`, `test:catalog`, `typecheck:contracts`,
`typecheck:catalog`, and the four `build:*` scripts. Run `npm.cmd run format:check` to verify
deterministic formatting and `npm.cmd run audit` for the dependency audit.

See [docs/architecture.md](docs/architecture.md) for trust boundaries, catalog invariants, and the
build flow.

## Licensing

Application source is provided under the [MIT License](LICENSE). Models, voice prompts, audio,
samples, and other third-party assets keep their own licenses and require independent catalog
evidence. The MIT license for this repository never overrides those records.
