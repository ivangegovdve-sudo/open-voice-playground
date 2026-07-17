# Generated media notice

No generated audio is published in the current launch catalog. The gallery's fixed recipes are
reviewed plans, not proof that a clip was executed, reproduced, or cleared.

For Pocket specifically, schema version 4 publishes 312 catalog-only multilingual metadata records,
one external live-demo record, and **zero output clips**. The 240 source-license candidates still
have unpinned release assets/runtime and unresolved output, personality, publication, and
redistribution rights. The 24 noncommercial and 48 provenance-pending records are link-only.
Official voice WAV/MP3 files are conditioning/source recordings, not Pocket-generated output; they
must not be copied, proxied, cached, embedded, or relabeled as samples.

Before any generated clip can be added, its record must establish all of the following:

1. The gallery owns the generation candidate and explicitly lists the media record.
2. Model and code revisions are immutable commit hashes, and every runtime/dependency revision is
   exact.
3. The runtime environment is verified with exact Python, package, operating-system, device, dtype,
   accelerator, dependency-lock hash, and runner-image digest.
4. Transcript, locale, fixed parameters, loading strategy, seed, reference lineage, and runtime
   environment exactly match the reviewed candidate.
5. The audio has an exact positive byte length, the audio and transcript have immutable SHA-256
   provenance, and a human approval record is attached.
6. All candidate source and license records remain attached, plus a verified generated-output rights
   record that permits redistribution.
7. Every upstream obligation remains in force. This includes attribution, non-commercial or
   share-alike conditions, acceptable-use restrictions, AI-generated labeling, and Chatterbox PerTh
   watermark preservation.

## Additional Pocket project-generated clip gate

A future Pocket clip may be produced only by a separately reviewed, preset-only project pipeline.
It may be published only when one immutable receipt records and proves every item below:

1. The exact coverage identity produced as `pocket:${selectorId}.${label}`, the matching selector,
   label, base BCP-47 language tag, and exact
   `languages/${selectorId}/embeddings/${label}.safetensors` state path. Country remains `null` and
   gender remains `unspecified`.
2. Exact Pocket code, no-cloning model, selector model, tokenizer, voice-state, runner, and complete
   runtime/dependency revisions and hashes. The audit starts from stable code
   `058886528d0b6f2f2d4022de2e244a5260729e6e` and preset-only model revision
   `e041936c75475d350b405bc870bcf7c22da4e9e6`; a branch, tag name, version range, or mutable URL is
   insufficient.
3. The exact project-authored transcript bytes plus transcript SHA-256, native-language approval,
   fixed seed and parameters, and proof that no upload, microphone, reference audio, arbitrary
   path/URL, cloning weight, or source recording entered generation.
4. The authoritative audio SHA-256, a strictly positive byte count, media type, sample rate,
   channel/encoding facts, exact UTC generation timestamp, elapsed generation time, and the frozen
   runtime/environment receipt that reproduced those bytes.
5. Every applicable source ID and license ID, family-specific attribution, generated-output license,
   and an explicit output-rights rationale tied to the exact clip and evidence revision.
6. An affirmative decision covering generated-output licensing, public performance and download,
   commercial and noncommercial redistribution, and personality, publicity, privacy, performer,
   moral, consent, and publication rights. A source or model license alone is not that decision.
7. An approved independent human review for transcript fidelity, language, audible quality,
   identity, safety, attribution, rights, and exact receipt-to-file byte/hash correspondence.
8. A project-controlled immutable HTTPS media URL whose fetched bytes, length, hash, CORS, range
   behavior, and media type match the approved receipt without redirects or hidden derivatives.

Until every field above and the affirmative redistribution right are proven for the exact artifact,
the catalog must not contain its generated-media record, hosted audio URL, or `<audio>` element.
Failure of one clip does not permit an unrecorded retry, changed seed, alternate transcript, or
hand-picked replacement under the same receipt.

`generated-media-cc0` is only a dedication of rights the Open Voice Playground project actually
holds in a reviewed output. It does not relicense weights, training data, voices, references, or
other upstream material. Repository MIT terms likewise do not relicense third-party models,
embeddings, datasets, conditioning/source audio, or generated output.

Seeds do not make GPU/driver/library executions bit-exact across environments. The published audio
hash and recorded environment—not the seed alone—identify the authoritative reviewed artifact.

Official upstream samples use a separate contract. Link-only records may point to an official page
but cannot carry a copied audio URL. Hosted sample audio requires exact bytes/hash, readable CORS,
explicit sample-scope rights, redistribution permission, transcript, source provenance, and human
review. Source-only galleries can never host or redistribute sample audio.

The browser runtime protocol remains preset-only. Gallery prompts, descriptions, references, and
generation recipes belong to the maintainer build pipeline and are never accepted as arbitrary user
input by browser workers or the planned companion.
