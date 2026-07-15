# Foundation architecture

## Workspace boundaries

The root npm workspace coordinates two applications and two shared packages. The web app consumes
only preset catalog data and later provider adapters. The companion workspace is currently inert;
its localhost protocol, native lifecycle, and engine workers belong to later tasks. Contracts stay
free of UI and inference behavior. Catalog code may read build-time JSON files but does not execute
model code.

```text
apps/web --------> packages/catalog --------> packages/contracts
apps/companion (reserved) ------------------> packages/contracts
```

## Shared invariants

- Runtime modes are exactly `browser`, `online`, `companion`, and `sample-only`.
- Voice IDs are stable `<engine>:<upstream-id>` values, and path separators are not allowed.
- Source-published gender is required; absent upstream evidence is represented as `unspecified`.
- BCP-47 language tags are validated at the contract boundary.
- Strict schemas reject undeclared fields, including cloning, reference audio, commands, arbitrary
  model URLs, and filesystem paths.
- Code, model weights, voices, and samples retain separate license evidence.

Release validation checks schema conformance, ID uniqueness, references, reviewed license evidence,
runtime compatibility, sample coverage for listen-only voices, deterministic ordering, and the
presence of at least one runnable preset. Counts keep browser, online, companion, and sample-only
availability separate; `runnableVoices` counts each runnable preset once.

## Catalog fixture

`packages/catalog/fixtures/catalog.fixture.json` is synthetic and intentionally uses the reserved
`example.invalid` domain. It covers every runtime mode, a multi-runtime preset, explicit
`unspecified` gender, separate license scopes, a listen-only sample, sorting, and reference checks.
It is test material, not a statement about supported engines or final counts.

## Build and deployment

The build compiles contracts first, then catalog tooling, the reserved companion workspace, and the
Vite web shell. Vercel serves the web output as a single-page application. CI installs from the lock
file, then runs type checking, linting, tests, builds, and catalog validation without publishing or
writing to remote systems.
