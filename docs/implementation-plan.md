# Open Voice Playground v1 Implementation Plan

## Global constraints

- Work only on `feat/open-voice-playground-v1`; do not implement on `main`.
- Public application code is MIT. Third-party code, models, voice prompts, and samples retain independent license records.
- Core launch experience costs $0, requires no account, and supports preset voices only. No voice upload, reference audio, cloning route, arbitrary model URL, filesystem path, or shell command may enter a public or companion API.
- Use a React 19 + TypeScript + Vite PWA and a Tauri 2/Rust Windows companion. The public site remains fully useful when the companion or any online provider is unavailable.
- Canonical runtime modes are `browser`, `online`, `companion`, and `sample-only`; never silently substitute one mode for another.
- The catalog must distinguish browser-local, online-service, companion, and sample-only counts and never infer gender or region.
- All production behavior is test-first. Every implementer report must record the RED and GREEN commands and outputs.
- Do not publish private repository metadata in the public repository or public workbook.
- Preserve the sonic-atlas design: ink and warm-ivory surfaces, restrained coral/cyan signal accents, editorial typography, CSS/SVG waveform motifs, system-aware light mode, and reduced-motion support. No generic AI neon, hero eyebrow, WebGL decoration, or autoplay.

## Task 1: Monorepo foundation and shared contracts

Create the new npm-workspace repository foundation and testable shared contracts.

- Add root scripts for `dev`, `build`, `test`, `typecheck`, `lint`, `catalog:validate`, `audit`, and focused workspace commands.
- Create `apps/web`, `apps/companion`, `packages/catalog`, and `packages/contracts` workspaces without implementing feature UI or engine inference yet.
- Configure TypeScript, ESLint, Vitest, React 19, Vite, and deterministic formatting; use `npm.cmd` on this Windows host.
- In `packages/contracts`, write failing tests first for runtime modes, engine/voice/sample/license/source schemas, stable `<engine>:<upstream-id>` IDs, BCP-47 validation, explicit `unspecified` gender, and rejection of cloning/reference-audio/arbitrary-path fields. Then implement the minimum Zod contracts.
- In `packages/catalog`, write failing tests first for uniqueness, count separation, required license/source evidence, stable sorting, and release validation. Then implement manifest loading and validation.
- Add MIT license, architecture/readme setup instructions, `.env.example` containing names only, Vercel SPA configuration, and CI that runs install, typecheck, lint, tests, build, and catalog validation.
- Create an initial sanitized fixture catalog large enough to exercise validation but do not claim final engine counts.
- Run the focused RED/GREEN tests and the full root verification commands before committing.

## Task 2: GitHub repository audit, workbook, and sanitized source catalog

Build the evidence pipeline for the user's GitHub repositories and public catalog sources.

- Enumerate all accessible owner-affiliated repositories at execution time using the connected GitHub app; capture name, URL, visibility, fork/upstream, update time, topics, description, license, and evidence without exposing credentials.
- Classify each repository as TTS, voice conversion, STT, voice agent/infrastructure, unrelated/false positive, or needs review. Record relevance, runtime, reuse decision, license risk, and evidence URL.
- Store the full audit only as a private/local artifact. Generate a public sanitized JSON/CSV containing approved public repositories and upstream projects only.
- Use the spreadsheet artifact tool to create one polished `voice-repository-audit.xlsx` with Summary, Repositories, Candidates, Engines, and License Decisions sheets, filters, frozen headers, formulas for summary counts, conditional formatting, source URLs, and one useful category/status chart. Render and visually verify every sheet.
- Resolve `ivan-workspace/index.md` with an authenticated recursive tree lookup; record found path or confirmed absence in the private audit without blocking the build.
- Add import scripts and tests that convert sanitized audit records into `SourceRecord` entries without leaking private fields.
- Commit only sanitized public audit data and the reusable import/validation code; keep the complete workbook outside the public repository and link it in the final handoff.

## Task 3: Sonic-atlas React PWA

Build the complete public application shell and creator/expert workflows.

- Implement routes `/`, `/voices`, `/play`, `/compare`, `/engines/:slug`, `/companion`, and `/about/sources` with responsive desktop/mobile navigation.
- Implement the selected sonic-atlas design tokens and component system, including system-aware light/dark themes, accessible focus states, 44px touch targets, reduced motion, and code-native icons.
- Build a virtualized voice explorer with diacritic-insensitive search and URL-persisted filters for availability, engine, language, locale, country/region, source-published gender, style, and license. OR values within one filter and AND across filters.
- Build voice cards, one-at-a-time accessible preview playback, persistent mini-player, favorites/recent items, model cache status, and local history through versioned IndexedDB.
- Build `/play` with 2,000-character UI limit, engine-specific controls, download-as-WAV, progress/cancel states, capability disclosures, and no silent runtime fallback.
- Build sequential A/B/C comparison for up to three runnable presets using identical text; sample-only entries may not enter generation comparison.
- Build explicit sample-only cards with transcript, license, source, `Play official sample`, and `Open official demo`.
- Write component/unit tests before production behavior and Playwright tests for the main browse-filter-play-compare workflow, keyboard navigation, URL restoration, offline shell, and mobile filter drawer.

## Task 4: Six engine adapters and verified launch manifests

Implement the provider boundary, safe browser runtimes, companion fallbacks, and launch data.

- Define provider methods `listVoices`, `checkCapability`, `prepare`, `synthesize`, `cancel`, and `dispose`; add contract tests before implementations.
- Implement lazy Worker adapters for Kokoro (54 presets, WebGPU then WASM), KittenTTS micro (8), Supertonic (10, OpenRAIL acceptance), and 12 curated Piper voices using sherpa-onnx and OPFS caching. No runtime loads before intent.
- Add the exact Piper allowlist: `bg_BG-dimitar-medium`, `de_DE-thorsten-medium`, `es_ES-davefx-medium`, `nl_NL-alex-medium`, `pl_PL-gosia-medium`, `pt_BR-cadu-medium`, `ro_RO-mihai-medium`, `ru_RU-dmitri-medium`, `zh_CN-chaowen-medium`, `en_GB-cori-medium`, `fr_FR-siwis-medium`, `uk_UA-lada-x_low`.
- Add 20 provenance-cleared Pocket presets for companion use: Alba, Estelle, 12 explicitly VCTK-derived voices, four Voice-Zero voices, and two verified donated voices. Exclude Giovanni, Lola, Juergen, Rafael, Cosette, and Jean.
- Refresh Edge metadata dynamically from upstream, preserving the current 322-voice snapshot as evidence rather than a hardcoded promise. Label it an open-source client to a proprietary online service. Implement companion support and a feature-gated public adapter with input limits, quotas, timeout, circuit breaker, and automatic unavailable state. Never enable the public adapter unless technical and terms gates pass.
- Add 12 sample-gallery manifests: OmniVoice, Qwen3-TTS, CosyVoice, VoxCPM, F5-TTS, Chatterbox, IndexTTS2, Fish Speech, Dia, VibeVoice, Bark, and MeloTTS. Require 3-12 official clips, transcripts, source, and license evidence; replacements are Spark-TTS, MaskGCT, then Parler-TTS; launch floor is 10 verified galleries.
- Package only redistribution-cleared audio for `izgDve/open-voice-playground-assets`; otherwise use a permitted official URL or exclude the sample.
- Add tests for capabilities, cancellation, download interruption, offline cache, non-silent decodable audio fixtures, language/voice enumeration, unavailable providers, and the preset-only policy.

## Task 5: Secure Windows tray companion

Build the Tauri 2/Rust companion and its narrow localhost protocol.

- Bind only to `127.0.0.1:17843`; never bind LAN interfaces or add a firewall exception.
- Implement deep-link pairing with exact-origin validation, a two-minute 256-bit state, native approval, one-time 256-bit bearer token delivery, SHA-256 token storage, 90-day inactivity expiry, revoke-one/revoke-all, and manual pairing-code fallback.
- Implement OpenAPI 3.1 endpoints for health, pairings, runtime, engines, voices, jobs, audio, packs, and pack actions. Return RFC 9457 problem responses with stable error codes.
- Enforce one active job, ten queued jobs, per-client rate limits, five-minute idle worker shutdown, private job directories, 30-minute audio deletion, and seven-day metadata-only logs.
- Tauri/Rust owns lifecycle, security, model management, signed manifests, updates, hardware/storage checks, and Windows Job Objects. Bundle `uv.exe`; use managed CPython and per-engine hash-pinned environments. Python workers communicate only through stdio JSON-RPC and never listen on a network port.
- Implement exact CORS allowlists for fixed production and staging origins, Local Network Access pre-prompt/connect flow, fetch-and-poll browser integration, and browser-only fallback.
- Package an x64 per-user NSIS installer with first-run hardware/model wizard, resumable verified downloads, rollback, move-library flow, uninstall cleanup options, CycloneDX SBOM, and signing-ready updater. Apply for open-source signing; label unsigned builds beta.
- Write Rust/Python/contract/security tests first, including hostile origins, invalid tokens, path traversal, arbitrary URLs/commands, queue floods, corrupt hashes/signatures, port conflict, crash recovery, low disk, and clean Windows install scripts.

## Task 6: Verification, deployment, and operations

Verify the whole product, repair findings, and prepare public operations.

- Run all unit, integration, contract, Rust, Python, Playwright, catalog, license, typecheck, lint, build, and packaging checks from clean installs.
- Use the Browser plugin first to verify page identity, meaningful DOM, no framework overlay, console health, screenshot evidence, and browse-filter-play-compare interactions at desktop and mobile viewports.
- Inspect final screenshots with `view_image`; keep a fidelity ledger covering copy, layout, typography, palette, spacing/container model, responsive behavior, icons, motion, and remaining intentional deviations. The user opted out of an image-generated concept, so compare against the locked textual sonic-atlas spec.
- Meet WCAG 2.2 AA and p75 targets LCP <2.5s, INP <200ms, CLS <0.1. Keep initial JS <250KB gzip and normalized catalog <500KB gzip excluding lazy inference assets.
- Verify at least 400 unique runnable presets across browser, online, and companion modes when Edge is available, while separately displaying all runtime totals. If Edge is gated off, publish honest reduced live counts without blocking the catalog/sample launch.
- Add weekly link/audio health checks and monthly metadata refresh workflows that open reviewed pull requests, mark stale records, and hide repeatedly broken audio.
- Link and deploy fixed staging and production Vercel projects with no paid resources or secret-bearing public config. Verify production from the deployed URL.
- Create the Hugging Face dataset repository and upload only the reviewed redistributable asset package and dataset card.
- Create/publish the GitHub repository, push the feature branch, run a final whole-branch code review, fix all Critical/Important findings, and leave the branch ready for a pull request or merge choice.

