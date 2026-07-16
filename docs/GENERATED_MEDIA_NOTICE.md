# Generated media notice

No generated audio is published in the current launch catalog. The gallery's fixed recipes are
reviewed plans, not proof that a clip was executed, reproduced, or cleared.

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

`generated-media-cc0` is only a dedication of rights the Open Voice Playground project actually
holds in a reviewed output. It does not relicense weights, training data, voices, references, or
other upstream material.

Seeds do not make GPU/driver/library executions bit-exact across environments. The published audio
hash and recorded environment—not the seed alone—identify the authoritative reviewed artifact.

Official upstream samples use a separate contract. Link-only records may point to an official page
but cannot carry a copied audio URL. Hosted sample audio requires exact bytes/hash, readable CORS,
explicit sample-scope rights, redistribution permission, transcript, source provenance, and human
review. Source-only galleries can never host or redistribute sample audio.

The browser runtime protocol remains preset-only. Gallery prompts, descriptions, references, and
generation recipes belong to the maintainer build pipeline and are never accepted as arbitrary user
input by browser workers or the planned companion.
