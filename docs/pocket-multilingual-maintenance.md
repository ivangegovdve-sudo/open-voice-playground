# Pocket multilingual inventory maintenance

This procedure freezes the reviewed filename inventory from the preset-only Pocket TTS model. It
does not download, publish, or enable any model, speaker embedding, prompt, conditioning audio, or
generated audio. It also does not change the existing 20-voice Pocket companion pack.

## Pinned source

- Repository: `kyutai/pocket-tts-without-voice-cloning`
- Revision: `e041936c75475d350b405bc870bcf7c22da4e9e6`
- Expected selectors: 12
- Expected labels per selector: 26
- Expected embedding paths: 312
- Expected language totals: English 78, French 26, German 52, Italian 52, Portuguese 52,
  Spanish 52
- Approved inventory digest:
  `sha256:67bb94d81b1a74f18ba13952a355b474ee8788201a58a66a49126316b9e33f6d`

The importer assigns only the reviewed language-level tags `en`, `fr`, `de`, `it`, `pt`, and `es`.
The upstream tree does not publish country or gender for these selector/label combinations, so the
inventory fixes country to `null` and gender to `unspecified`. Do not infer either field from a name,
language, accent, dataset, or appearance.

## Capture the immutable tree

Install the current Hugging Face `hf` CLI, then run this read-only command from the repository root:

```powershell
New-Item -ItemType Directory -Force .superpowers/sdd | Out-Null
hf models info kyutai/pocket-tts-without-voice-cloning `
  --revision e041936c75475d350b405bc870bcf7c22da4e9e6 `
  --expand siblings `
  --format json |
  Set-Content -Encoding utf8 .superpowers/sdd/pocket-no-cloning-e041936-siblings.json
```

`.superpowers/` is ignored. Keep the captured tree there; never commit it. The production review CLI
accepts a local JSON file only and has no Hub, HTTP, or other network path. It strips at most one
leading UTF-8 BOM so a normal Windows PowerShell capture is deterministic.

## Review before writing

Run the importer without `--write`:

```powershell
npm.cmd run catalog:review:pocket-multilingual -- `
  --input .superpowers/sdd/pocket-no-cloning-e041936-siblings.json `
  --revision e041936c75475d350b405bc870bcf7c22da4e9e6
```

The command must report 12 selectors, 26 labels, 312 variants, the six language totals above, and
the approved digest. Inspect every added, removed, or changed path. Missing paths, duplicates,
unknown selectors or labels, traversal paths, and unexpected files inside an embeddings directory
are closed errors rather than data to normalize away.

After review, authorize exactly the printed candidate digest:

```powershell
npm.cmd run catalog:review:pocket-multilingual -- `
  --input .superpowers/sdd/pocket-no-cloning-e041936-siblings.json `
  --revision e041936c75475d350b405bc870bcf7c22da4e9e6 `
  --write `
  --approve-hash sha256:67bb94d81b1a74f18ba13952a355b474ee8788201a58a66a49126316b9e33f6d
```

The only writable destination is
`packages/catalog/src/pocket-multilingual-data.ts`. It contains the pinned revision, inventory
digest, selector/language mapping, and labels; never the 312 expanded records or upstream bytes.

## Acceptance checks

```powershell
npm.cmd run test --workspace @open-voice/catalog -- test/pocket-multilingual-import.test.ts
npm.cmd run typecheck --workspace @open-voice/catalog
npm.cmd run lint
npm.cmd run format:check
git diff --check
```

Commit only the importer, local-only CLI, generated constants, tests, script entries, and this
maintenance procedure. Do not commit the Hub capture or any model, embedding, tokenizer, prompt,
conditioning-audio, or generated-audio body. A different repository revision or a tree that does
not close at exactly 12 x 26 requires a new source review; do not update counts or the approval hash
merely to make an unexpected upstream tree pass.
