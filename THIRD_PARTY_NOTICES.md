# Third-party notices

Open Voice Playground's repository-authored code is licensed under MIT. MIT applies only to that
code. It does **not** relicense or grant rights to third-party code, services, model weights, voice
embeddings, datasets, source recordings, official samples, or generated outputs.

The deterministic public catalog is the machine-readable source of truth for exact evidence URLs,
revisions, digests, review status, scopes, attribution, and recorded permissions:
`packages/catalog/data/launch-catalog.public.json`. A missing permission is treated as unestablished,
not inferred.

## OpenAPI structural schema

The unchanged OpenAPI 3.1 structural schema revision dated 2025-11-23 is vendored from the OpenAPI
Initiative's `spec.openapis.org` repository under Apache-2.0. Source:
`https://spec.openapis.org/oas/3.1/schema/2025-11-23`. The retained file is exactly 33,452 bytes with
SHA-256 `1b8ccc6e34234b17536f2dd0eb3597142a32bd108438cd42471a5fca4c1a07ef`. The upstream
repository has no `NOTICE` file and the schema carries no separate embedded attribution notice. A
complete copy of its license is retained at
`apps/companion/openapi/vendor/LICENSE-OAI-APACHE-2.0.txt`.

## Preset engines

### Edge voice metadata

The `edge-tts` client is LGPL-3.0-or-later. Edge Read Aloud is a Microsoft connected service with
separate consumer, privacy, and related terms. This project ships a maintainer-reviewed metadata
snapshot only. It makes no Edge synthesis request and keeps every Edge record terms-gated.

### Kokoro

Kokoro code and the reviewed base weights are Apache-2.0. Voice/dataset evidence is retained
separately. In particular:

- `jf_gongitsune`, `jf_nezumi`, `jf_tebukuro`, and `jm_kumo` use modified Kokoro voice embeddings
  sourced from Koniwa/TNC announcer audio. Attribution: Koniwa contributors and Television
  Nishinippon (TNC). The recorded dataset license is CC BY 3.0.
- `ff_siwis` uses a modified Kokoro voice embedding sourced from the SIWIS database. Attribution:
  Junichi Yamagishi, Pierre-Edouard Honnet, Philip N. Garner, and Alexandros Lazaridis; DOI
  10.7488/ds/1705. The recorded dataset license is CC BY 4.0. The pinned primary license evidence is
  content-hashed in the catalog.

### Pocket TTS

Pocket TTS code is MIT. The pinned preset-only weights package is CC BY 4.0 and remains subject to
the upstream prohibited-use policy; commercial use is recorded as permitted, but the restrictions
still apply. This playground exposes only a fixed preset allowlist and no cloning input.

Voice embeddings retain source-specific dataset notices:

- Alba MacKenna: CC BY 4.0.
- Estelle / Kyutai `unmute-prod developpeuse-3`: CC0 1.0.
- Anna, Vera, Fantine, Charles, Paul, Eponine, Azelma, George, Mary, Jane, Michael, and Eve: VCTK,
  CC BY 4.0. Attribution: Christophe Veaux, Junichi Yamagishi, Kirsten MacDonald; Centre for Speech
  Technology Research, University of Edinburgh; DOI 10.7488/ds/2645. Selected files were enhanced
  through Kyutai `ai-coustics` processing before inclusion in the pinned voice repository.
- Bill Boerst, Caro Davy, Peter Yearsley, and Stuart Bell: Voice-Zero sources, CC0 1.0.
- Marius and Javert: Kyutai voice-donation sources, CC0 1.0.

The current `tts-voices` revision is an audit pin. Its WAV files are upstream reference/source clips,
not evidence of Pocket TTS-generated output. Only 11 authoritative VCTK transcripts were found;
George's transcript was not retained and the remaining non-VCTK records do not have authoritative
source-published/source-clip transcripts. Therefore this launch publishes no Pocket sample records and no copied
audio. The Kyutai demo is linked externally only; the app does not proxy or reuse its API.

### KittenTTS

KittenTTS code and reviewed weights are Apache-2.0. The eight fixed upstream labels are preserved
without inferred demographics. No voice-builder or reference-audio workflow is included.

### Supertonic

Supertonic code is MIT. Weights and the fixed M1–M5/F1–F5 styles use pinned OpenRAIL-M terms.
Users must accept the exact pinned terms before any Supertonic asset request. Voice Builder and
reference-audio workflows are outside this product. Those OpenRAIL-M model terms remain separate
from the MIT code and runtime notices below.

The following notice is retained from Supertonic source revision
`dff55dc00064c398736080c78195f577527832ae`:

#### Supertonic MIT license

MIT License

Copyright (c) 2025 Supertone Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ONNX Runtime Web

The browser runtime uses `onnxruntime-web@1.27.0`. Its exact npm tarball does not contain a
standalone `LICENSE` file, so the complete immutable upstream notice is retained here from ONNX
Runtime source revision `8f0278c77bf44b0cc83c098c6c722b92a36ac4b5`:

#### ONNX Runtime MIT license

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Piper / sherpa-onnx

The reviewed sherpa-onnx code is Apache-2.0. Each Piper model and source dataset retains its own
model-card license and attribution; no blanket commercial or redistribution permission is inferred.
The launch publishes 12 catalog records but keeps all of them asset-unavailable because the reviewed
GitHub release assets are not browser-readable through CORS.

## Model gallery

Gallery code and weight terms remain separate. The catalog records exact revisions and restrictions
for VoxCPM2, Qwen3-TTS, Parler-TTS, Dia, Chatterbox, CosyVoice3, MeloTTS, Bark, OmniVoice, F5-TTS,
Spark-TTS, and MaskGCT. Notable retained obligations include:

- VoxCPM2 output labeling and responsible-use requirements.
- Chatterbox PerTh watermark preservation; the playground must never strip or bypass it.
- Dia, Bark, Spark-TTS, and other project-specific safety/use restrictions.
- F5-TTS and MaskGCT CC BY-NC 4.0 weight terms; Spark-TTS CC BY-NC-SA 4.0 terms.
- OmniVoice's prose non-commercial notice plus separate custom Boson Higgs Audio 2 tokenizer terms.

The project-held `generated-media-cc0` record can apply only to a future output whose rights the
project actually holds. CC0 never erases upstream model, dataset, attribution, acceptable-use,
watermark, non-commercial, or labeling obligations.

See [the generated-media notice](docs/GENERATED_MEDIA_NOTICE.md) before adding any clip.
