import type {
  GalleryManifest,
  GenerationCandidate,
  LicenseRecord,
  SourceRecord,
} from '@open-voice/contracts';

const REVIEWED_AT = '2026-07-16T00:00:00.000Z';

type LicenseOptions = {
  spdxId?: string;
  exactUpstreamTerms?: string;
  redistribution?: boolean;
  commercial?: boolean;
  status?: 'verified' | 'restricted';
  evidenceSha256?: `sha256:${string}`;
};

function license(
  id: string,
  scope: LicenseRecord['scope'],
  name: string,
  evidenceUrl: string,
  attribution: string,
  options: LicenseOptions,
): LicenseRecord {
  return {
    id,
    scope,
    name,
    ...(options.spdxId === undefined ? {} : { spdxId: options.spdxId }),
    ...(options.exactUpstreamTerms === undefined
      ? {}
      : { exactUpstreamTerms: options.exactUpstreamTerms }),
    evidenceUrl,
    ...(options.evidenceSha256 === undefined ? {} : { evidenceSha256: options.evidenceSha256 }),
    attribution,
    permitsRedistribution: options.redistribution ?? false,
    permitsCommercialUse: options.commercial ?? false,
    reviewedAt: REVIEWED_AT,
    reviewStatus: options.status ?? 'verified',
  };
}

export const LAUNCH_LICENSES: LicenseRecord[] = [
  license(
    'edge-code-license',
    'code',
    'LGPL-3.0-or-later',
    'https://github.com/rany2/edge-tts/blob/4bdb8e4c6ea62f151a45a3fceb4cf6ff696bb89f/LICENSE',
    'edge-tts contributors',
    { spdxId: 'LGPL-3.0-or-later', redistribution: true, commercial: true },
  ),
  license(
    'edge-service-terms',
    'service',
    'Microsoft online speech service terms - launch gate not cleared',
    'https://support.microsoft.com/en-US/edge/manage-connected-experiences-in-microsoft-edge',
    'Microsoft; edge-tts only supplies the open-source client',
    {
      exactUpstreamTerms:
        'Edge Read Aloud is a Microsoft connected experience governed by consumer service, privacy, and related terms. Metadata only: synthesis stays disabled until an explicit supported path and terms review is approved.',
      status: 'restricted',
    },
  ),
  license(
    'kokoro-code-license',
    'code',
    'Apache License 2.0',
    'https://github.com/hexgrad/kokoro/blob/dfb907a02bba8152ca444717ca5d78747ccb4bec/LICENSE',
    'hexgrad and Kokoro contributors',
    { spdxId: 'Apache-2.0', redistribution: true, commercial: true },
  ),
  license(
    'kokoro-weights-license',
    'weights',
    'Apache License 2.0',
    'https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/README.md',
    'hexgrad and Kokoro contributors',
    { spdxId: 'Apache-2.0', redistribution: true, commercial: true },
  ),
  license(
    'kokoro-voice-license',
    'voice',
    'Apache License 2.0 with separate voice metadata',
    'https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/README.md',
    'hexgrad and Kokoro contributors; Koniwa and SIWIS overrides are preserved separately',
    {
      spdxId: 'Apache-2.0',
      exactUpstreamTerms:
        'The model card declares Apache-2.0. Voice identity and metadata evidence is separately pinned in VOICES.md; Koniwa and SIWIS dataset overrides use their own records.',
      redistribution: true,
      commercial: true,
    },
  ),
  license(
    'kokoro-koniwa-dataset-license',
    'dataset',
    'Creative Commons Attribution 3.0',
    'https://github.com/koniwa/koniwa/blob/e2a6b4ff74e36805a7721342af210b4bf5b989e0/README.md',
    'Koniwa contributors and Television Nishinippon (TNC), whose announcer readings are the attributed source audio',
    {
      spdxId: 'CC-BY-3.0',
      exactUpstreamTerms:
        'Applies to jf_gongitsune, jf_nezumi, jf_tebukuro, and jm_kumo. Kokoro-derived voice embeddings are modifications of the attributed Koniwa tnc audio.',
      redistribution: true,
      commercial: true,
    },
  ),
  license(
    'kokoro-siwis-dataset-license',
    'dataset',
    'Creative Commons Attribution 4.0',
    'https://datashare.ed.ac.uk/bitstreams/d7204860-2dc9-48e6-bb9a-604a3a49d9ce/download',
    'Junichi Yamagishi, Pierre-Edouard Honnet, Philip N. Garner, and Alexandros Lazaridis; SIWIS database, DOI 10.7488/ds/1705',
    {
      spdxId: 'CC-BY-4.0',
      exactUpstreamTerms:
        'Applies to ff_siwis. The Kokoro-derived voice embedding is a modification sourced from the attributed SIWIS database.',
      evidenceSha256: 'sha256:b34e17103bfb246f2549fc82a279e6ba28834e0cb42f76a92efc14b72e3a3723',
      redistribution: true,
      commercial: true,
    },
  ),
  license(
    'pocket-code-license',
    'code',
    'MIT License',
    'https://github.com/kyutai-labs/pocket-tts/blob/058886528d0b6f2f2d4022de2e244a5260729e6e/LICENSE',
    'Kyutai and Pocket TTS contributors',
    { spdxId: 'MIT', redistribution: true, commercial: true },
  ),
  license(
    'pocket-weights-license',
    'weights',
    'CC-BY-4.0 with upstream prohibited-use terms',
    'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/blob/e041936c75475d350b405bc870bcf7c22da4e9e6/README.md',
    'Kyutai; preset-only weights package',
    {
      spdxId: 'CC-BY-4.0',
      exactUpstreamTerms:
        'Use is subject to the pinned model card and prohibited-use policy. This catalog exposes only the reviewed preset allowlist and no cloning inputs.',
      redistribution: true,
      commercial: true,
      status: 'restricted',
    },
  ),
  license(
    'pocket-alba-mackenna-dataset-license',
    'dataset',
    'Creative Commons Attribution 4.0',
    'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md',
    'Alba MacKenna',
    { spdxId: 'CC-BY-4.0', redistribution: true, commercial: true },
  ),
  license(
    'pocket-unmute-prod-dataset-license',
    'dataset',
    'CC0 1.0 Universal',
    'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md',
    'Kyutai unmute-prod developpeuse-3 (Estelle)',
    { spdxId: 'CC0-1.0', redistribution: true, commercial: true },
  ),
  license(
    'pocket-vctk-dataset-license',
    'dataset',
    'Creative Commons Attribution 4.0',
    'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md',
    'Christophe Veaux, Junichi Yamagishi, Kirsten MacDonald; CSTR, University of Edinburgh; DOI 10.7488/ds/2645',
    {
      spdxId: 'CC-BY-4.0',
      exactUpstreamTerms:
        'Selected VCTK files are distributed under CC BY 4.0 and were enhanced through Kyutai ai-coustics processing before inclusion in the pinned tts-voices snapshot.',
      redistribution: true,
      commercial: true,
    },
  ),
  license(
    'pocket-voice-zero-dataset-license',
    'dataset',
    'CC0 1.0 Universal',
    'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md',
    'Voice-Zero contributors and the named Bill Boerst, Caro Davy, Peter Yearsley, and Stuart Bell voices',
    { spdxId: 'CC0-1.0', redistribution: true, commercial: true },
  ),
  license(
    'pocket-donations-dataset-license',
    'dataset',
    'CC0 1.0 Universal',
    'https://huggingface.co/kyutai/tts-voices/blob/323332d33f997de8394f24a193e1a76df720e01a/README.md',
    'Kyutai voice-donation contributors for Marius and Javert',
    { spdxId: 'CC0-1.0', redistribution: true, commercial: true },
  ),
  license(
    'kitten-code-license',
    'code',
    'Apache License 2.0',
    'https://github.com/KittenML/KittenTTS/blob/f0282f0198d497b7256535b755f9f3e339c1baa7/LICENSE',
    'KittenML and KittenTTS contributors',
    { spdxId: 'Apache-2.0', redistribution: true, commercial: true },
  ),
  license(
    'kitten-weights-license',
    'weights',
    'Apache License 2.0',
    'https://huggingface.co/KittenML/kitten-tts-micro-0.8/blob/1ccf72b2c2048fd17efac7de2fab32d10e225084/README.md',
    'KittenML',
    { spdxId: 'Apache-2.0', redistribution: true, commercial: true },
  ),
  license(
    'kitten-voice-license',
    'voice',
    'KittenTTS fixed-preset terms',
    'https://huggingface.co/KittenML/kitten-tts-micro-0.8/blob/1ccf72b2c2048fd17efac7de2fab32d10e225084/README.md',
    'KittenML',
    {
      exactUpstreamTerms:
        'The catalog preserves the eight fixed upstream preset labels and makes no inferred demographic claim.',
      redistribution: true,
      commercial: true,
    },
  ),
  license(
    'supertone-code-license',
    'code',
    'MIT License',
    'https://github.com/supertone-inc/supertonic/blob/dff55dc00064c398736080c78195f577527832ae/LICENSE',
    'Supertone Inc.',
    { spdxId: 'MIT', redistribution: true, commercial: true },
  ),
  license(
    'onnxruntime-web-runtime-license',
    'runtime',
    'ONNX Runtime MIT License',
    'https://github.com/microsoft/onnxruntime/blob/8f0278c77bf44b0cc83c098c6c722b92a36ac4b5/LICENSE',
    'Microsoft Corporation',
    { spdxId: 'MIT', redistribution: true, commercial: true },
  ),
  license(
    'supertone-weights-license',
    'weights',
    'OpenRAIL-M',
    'https://huggingface.co/Supertone/supertonic-3/blob/3cadd1ee6394adea1bd021217a0e650ede09a323/LICENSE',
    'Supertone Inc.',
    {
      exactUpstreamTerms:
        'Exact pinned OpenRAIL-M text must be accepted before any Supertonic asset request.',
      evidenceSha256: 'sha256:0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f',
      redistribution: true,
      commercial: true,
      status: 'restricted',
    },
  ),
  license(
    'supertone-voice-license',
    'voice',
    'Supertonic fixed-style OpenRAIL-M terms',
    'https://huggingface.co/Supertone/supertonic-3/blob/3cadd1ee6394adea1bd021217a0e650ede09a323/LICENSE',
    'Supertone Inc.',
    {
      exactUpstreamTerms:
        'Fixed M1-M5 and F1-F5 styles only. No Voice Builder or reference-audio workflow is included.',
      redistribution: true,
      commercial: true,
      status: 'restricted',
    },
  ),
  license(
    'piper-code-license',
    'code',
    'Apache License 2.0',
    'https://github.com/k2-fsa/sherpa-onnx/blob/38ad05bdf8163e31275288d4e9945508d34cbf25/LICENSE',
    'sherpa-onnx contributors',
    { spdxId: 'Apache-2.0', redistribution: true, commercial: true },
  ),
  license(
    'piper-weights-license',
    'weights',
    'Piper voice-model license records',
    'https://huggingface.co/rhasspy/piper-voices/tree/e21c7de8d4eab79b902f0d61e662b3f21664b8d2',
    'Piper voice-model authors and dataset contributors',
    {
      exactUpstreamTerms:
        'Each curated model retains its own MODEL_CARD license and attribution. The catalog does not collapse those dataset rights into the application MIT license.',
      status: 'restricted',
    },
  ),
  license(
    'piper-voice-license',
    'dataset',
    'Piper per-voice dataset terms',
    'https://huggingface.co/rhasspy/piper-voices/tree/e21c7de8d4eab79b902f0d61e662b3f21664b8d2',
    'Piper voice and dataset contributors, including SIWIS where applicable',
    {
      exactUpstreamTerms:
        'Per-voice source cards govern reuse. This record is conservative and does not assert blanket commercial or redistribution rights.',
      status: 'restricted',
    },
  ),
  license(
    'generated-media-cc0',
    'generated-output',
    'CC0-1.0 project-owned generated media dedication',
    'https://creativecommons.org/publicdomain/zero/1.0/',
    'Open Voice Playground contributors; applies only to reviewed project-owned generated outputs',
    {
      spdxId: 'CC0-1.0',
      exactUpstreamTerms:
        'No generated media is currently published. Future entries require complete provenance and remain outside the repository MIT license.',
      redistribution: true,
      commercial: true,
    },
  ),
];

type SourceOptions = Pick<SourceRecord, 'sourceClass' | 'health'> & { contentHash?: string };

function source(
  id: string,
  canonicalUrl: string,
  upstreamRevision: string,
  options: SourceOptions,
): SourceRecord {
  return {
    id,
    canonicalUrl,
    sourceClass: options.sourceClass,
    upstreamRevision,
    retrievedAt: REVIEWED_AT,
    ...(options.contentHash === undefined ? {} : { contentHash: options.contentHash }),
    lastVerifiedAt: REVIEWED_AT,
    health: options.health,
  };
}

export const ENGINE_SOURCES: SourceRecord[] = [
  source(
    'edge-client-source',
    'https://github.com/rany2/edge-tts/tree/4bdb8e4c6ea62f151a45a3fceb4cf6ff696bb89f',
    '4bdb8e4c6ea62f151a45a3fceb4cf6ff696bb89f',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'edge-voices-snapshot',
    'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list',
    'dynamic-service-snapshot:2026-07-15;edge-tts:7.2.8',
    {
      sourceClass: 'official-service-snapshot',
      health: 'healthy',
    },
  ),
  source(
    'kokoro-code-source',
    'https://github.com/hexgrad/kokoro/tree/dfb907a02bba8152ca444717ca5d78747ccb4bec',
    'dfb907a02bba8152ca444717ca5d78747ccb4bec',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'kokoro-model-source',
    'https://huggingface.co/hexgrad/Kokoro-82M/tree/f3ff3571791e39611d31c381e3a41a3af07b4987',
    'f3ff3571791e39611d31c381e3a41a3af07b4987',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'kokoro-voice-metadata-source',
    'https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/VOICES.md',
    'f3ff3571791e39611d31c381e3a41a3af07b4987',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'kokoro-koniwa-source',
    'https://github.com/koniwa/koniwa/tree/e2a6b4ff74e36805a7721342af210b4bf5b989e0',
    'e2a6b4ff74e36805a7721342af210b4bf5b989e0',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'kokoro-siwis-source',
    'https://datashare.ed.ac.uk/items/1de74991-eede-4b48-8fbe-6c2abaed88d8',
    'doi:10.7488/ds/1705;license-sha256:b34e17103bfb246f2549fc82a279e6ba28834e0cb42f76a92efc14b72e3a3723',
    {
      sourceClass: 'official-documentation',
      contentHash: 'sha256:b34e17103bfb246f2549fc82a279e6ba28834e0cb42f76a92efc14b72e3a3723',
      health: 'healthy',
    },
  ),
  source(
    'kokoro-onnx-source',
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    '1939ad2a8e416c0acfeecc08a694d14ef25f2231',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'pocket-code-source',
    'https://github.com/kyutai-labs/pocket-tts/tree/058886528d0b6f2f2d4022de2e244a5260729e6e',
    '058886528d0b6f2f2d4022de2e244a5260729e6e',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'pocket-weights-source',
    'https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/e041936c75475d350b405bc870bcf7c22da4e9e6',
    'e041936c75475d350b405bc870bcf7c22da4e9e6',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'pocket-voice-source',
    'https://huggingface.co/kyutai/tts-voices/tree/323332d33f997de8394f24a193e1a76df720e01a',
    '323332d33f997de8394f24a193e1a76df720e01a',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'kitten-code-source',
    'https://github.com/KittenML/KittenTTS/tree/f0282f0198d497b7256535b755f9f3e339c1baa7',
    'f0282f0198d497b7256535b755f9f3e339c1baa7',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'kitten-model-source',
    'https://huggingface.co/KittenML/kitten-tts-micro-0.8/tree/1ccf72b2c2048fd17efac7de2fab32d10e225084',
    '1ccf72b2c2048fd17efac7de2fab32d10e225084',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'supertone-code-source',
    'https://github.com/supertone-inc/supertonic/tree/dff55dc00064c398736080c78195f577527832ae',
    'dff55dc00064c398736080c78195f577527832ae',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'onnxruntime-web-source',
    'https://github.com/microsoft/onnxruntime/tree/8f0278c77bf44b0cc83c098c6c722b92a36ac4b5',
    '8f0278c77bf44b0cc83c098c6c722b92a36ac4b5',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    'supertone-model-source',
    'https://huggingface.co/Supertone/supertonic-3/tree/3cadd1ee6394adea1bd021217a0e650ede09a323',
    '3cadd1ee6394adea1bd021217a0e650ede09a323',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'supertone-preset-metadata-source',
    'https://huggingface.co/spaces/Supertone/supertonic-3/blob/4402acca094e2ff2b3dff446e0bf915f3fccc462/script.js',
    '4402acca094e2ff2b3dff446e0bf915f3fccc462',
    { sourceClass: 'official-space', health: 'healthy' },
  ),
  source(
    'piper-voices-source',
    'https://huggingface.co/rhasspy/piper-voices/tree/e21c7de8d4eab79b902f0d61e662b3f21664b8d2',
    'e21c7de8d4eab79b902f0d61e662b3f21664b8d2',
    { sourceClass: 'model-card', health: 'healthy' },
  ),
  source(
    'piper-sherpa-source',
    'https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/130612623',
    'github-release-id:130612623;verified:2026-07-16',
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
];

type GalleryProject = {
  id: string;
  name: string;
  repository: string;
  codeRevision: string;
  codeSpdx: 'Apache-2.0' | 'MIT';
  modelRepository: string;
  modelRevision: string;
  weightsName: string;
  weightsSpdx?: string;
  weightsTerms?: string;
  weightsEvidenceUrl?: string;
  weightsRestricted?: boolean;
  weightsRedistribution: boolean;
  weightsCommercial: boolean;
  officialProjectUrl: string;
  mode: GalleryManifest['mode'];
};

const GALLERY_PROJECTS: readonly GalleryProject[] = [
  {
    id: 'voxcpm2',
    name: 'VoxCPM2',
    repository: 'OpenBMB/VoxCPM',
    codeRevision: '616d3d3e630a9c96c2853250eef91b0f39dcd5fa',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'openbmb/VoxCPM2',
    modelRevision: 'bffb3df5a29440629464e5e839f4d214c8714c3d',
    weightsName: 'Apache License 2.0 with VoxCPM responsible-use policy',
    weightsSpdx: 'Apache-2.0',
    weightsTerms:
      'The pinned model card requires AI-generated labeling and prohibits impersonation, fraud, and disinformation. These requirements remain attached to any future output.',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/openbmb/VoxCPM2',
    mode: 'generation-candidate',
  },
  {
    id: 'qwen3-tts',
    name: 'Qwen3-TTS',
    repository: 'QwenLM/Qwen3-TTS',
    codeRevision: '022e286b98fbec7e1e916cb940cdf532cd9f488e',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    modelRevision: '85e237c12c027371202489a0ec509ded67b5e4b5',
    weightsName: 'Apache License 2.0',
    weightsSpdx: 'Apache-2.0',
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice',
    mode: 'generation-candidate',
  },
  {
    id: 'parler-tts',
    name: 'Parler-TTS',
    repository: 'huggingface/parler-tts',
    codeRevision: 'd108732cd57788ec86bc857d99a6cabd66663d68',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'parler-tts/parler-tts-mini-v1',
    modelRevision: '0392b9451a601e528fd863bbb0598431fee810d9',
    weightsName: 'Apache License 2.0',
    weightsSpdx: 'Apache-2.0',
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/parler-tts/parler-tts-mini-v1',
    mode: 'generation-candidate',
  },
  {
    id: 'dia',
    name: 'Dia',
    repository: 'nari-labs/dia',
    codeRevision: '876125e461a03b157ec905b0fe8b57a0f8b9e7a0',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'nari-labs/Dia-1.6B',
    modelRevision: '257bc72f9b78182ccc6fa07675a9ae4c1a44e2cd',
    weightsName: 'Apache License 2.0',
    weightsSpdx: 'Apache-2.0',
    weightsTerms:
      'The pinned model card prohibits unauthorized real-person resemblance, deceptive content, and illegal or malicious use.',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/nari-labs/Dia-1.6B',
    mode: 'generation-candidate',
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox',
    repository: 'resemble-ai/chatterbox',
    codeRevision: '65b18437192794391a0308a8f705b1e33e633948',
    codeSpdx: 'MIT',
    modelRepository: 'ResembleAI/chatterbox',
    modelRevision: '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
    weightsName: 'MIT License with PerTh watermark preservation',
    weightsSpdx: 'MIT',
    weightsTerms:
      'Future generated outputs must preserve the upstream PerTh watermark; the playground never strips or bypasses it.',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/ResembleAI/chatterbox',
    mode: 'generation-candidate',
  },
  {
    id: 'cosyvoice3',
    name: 'CosyVoice3',
    repository: 'FunAudioLLM/CosyVoice',
    codeRevision: '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    modelRevision: '29e01c4e8d000f4bcd70751be16fa94bf3d85a18',
    weightsName: 'Apache License 2.0',
    weightsSpdx: 'Apache-2.0',
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512',
    mode: 'generation-candidate',
  },
  {
    id: 'melotts',
    name: 'MeloTTS',
    repository: 'myshell-ai/MeloTTS',
    codeRevision: '209145371cff8fc3bd60d7be902ea69cbdb7965a',
    codeSpdx: 'MIT',
    modelRepository: 'myshell-ai/MeloTTS-English',
    modelRevision: 'bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef',
    weightsName: 'MIT License',
    weightsSpdx: 'MIT',
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/myshell-ai/MeloTTS-English',
    mode: 'generation-candidate',
  },
  {
    id: 'bark',
    name: 'Bark',
    repository: 'suno-ai/bark',
    codeRevision: 'f4f32d4cd480dfec1c245d258174bc9bde3c2148',
    codeSpdx: 'MIT',
    modelRepository: 'suno/bark',
    modelRevision: '70a8a7d34168586dc5d028fa9666aceade177992',
    weightsName: 'MIT License',
    weightsSpdx: 'MIT',
    weightsTerms:
      'The pinned upstream documentation warns that fully generative outputs can deviate unexpectedly and requires responsible use and review.',
    weightsEvidenceUrl:
      'https://github.com/suno-ai/bark/blob/f4f32d4cd480dfec1c245d258174bc9bde3c2148/README.md',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: true,
    officialProjectUrl: 'https://huggingface.co/suno/bark',
    mode: 'generation-candidate',
  },
  {
    id: 'omnivoice',
    name: 'OmniVoice',
    repository: 'k2-fsa/OmniVoice',
    codeRevision: '52aa4045205fb474c6f33185af5d6f105e3ca838',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'k2-fsa/OmniVoice',
    modelRevision: 'c5fdb5ccb189668d56333f77ba2629f4cd7535f4',
    weightsName: 'Prose CC-BY-NC notice with additional tokenizer terms',
    weightsTerms:
      'The pinned model card states CC-BY-NC without version metadata, and the bundled audio tokenizer has separate custom Boson Higgs Audio 2 terms. No reuse right is inferred.',
    weightsRestricted: true,
    weightsRedistribution: false,
    weightsCommercial: false,
    officialProjectUrl: 'https://huggingface.co/k2-fsa/OmniVoice',
    mode: 'source-only',
  },
  {
    id: 'f5-tts',
    name: 'F5-TTS',
    repository: 'SWivid/F5-TTS',
    codeRevision: '91f499635cb4f8b8a926e83f1839f5338bc2ef87',
    codeSpdx: 'MIT',
    modelRepository: 'SWivid/F5-TTS',
    modelRevision: '84e5a410d9cead4de2f847e7c9369a6440bdfaca',
    weightsName: 'Creative Commons Attribution-NonCommercial 4.0',
    weightsSpdx: 'CC-BY-NC-4.0',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: false,
    officialProjectUrl: 'https://swivid.github.io/F5-TTS/',
    mode: 'source-only',
  },
  {
    id: 'spark-tts',
    name: 'Spark-TTS',
    repository: 'SparkAudio/Spark-TTS',
    codeRevision: '2f1ea9082400547242641f5271b6f941c9f439d1',
    codeSpdx: 'Apache-2.0',
    modelRepository: 'SparkAudio/Spark-TTS-0.5B',
    modelRevision: '642071559bfc6346c2359d19dcb6be3f9dd8a05d',
    weightsName: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0',
    weightsSpdx: 'CC-BY-NC-SA-4.0',
    weightsTerms:
      'The pinned model card also prohibits unauthorized cloning, impersonation, fraud, and deceptive deepfakes.',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: false,
    officialProjectUrl: 'https://huggingface.co/SparkAudio/Spark-TTS-0.5B',
    mode: 'source-only',
  },
  {
    id: 'maskgct',
    name: 'MaskGCT',
    repository: 'open-mmlab/Amphion',
    codeRevision: '26f6883110181f1dbfe95c70a7c7dbaf4de5f42a',
    codeSpdx: 'MIT',
    modelRepository: 'amphion/MaskGCT',
    modelRevision: '265c6cef07625665d0c28d2faafb1415562379dc',
    weightsName: 'Creative Commons Attribution-NonCommercial 4.0',
    weightsSpdx: 'CC-BY-NC-4.0',
    weightsRestricted: true,
    weightsRedistribution: true,
    weightsCommercial: false,
    officialProjectUrl: 'https://huggingface.co/amphion/MaskGCT',
    mode: 'source-only',
  },
];

export const GALLERY_SOURCES: SourceRecord[] = GALLERY_PROJECTS.flatMap((project) => [
  source(
    `${project.id}-code-source`,
    `https://github.com/${project.repository}/tree/${project.codeRevision}`,
    project.codeRevision,
    { sourceClass: 'official-repository', health: 'healthy' },
  ),
  source(
    `${project.id}-model-source`,
    `https://huggingface.co/${project.modelRepository}/tree/${project.modelRevision}`,
    project.modelRevision,
    { sourceClass: 'model-card', health: 'healthy' },
  ),
]);

export const GALLERY_LICENSES: LicenseRecord[] = [
  ...GALLERY_PROJECTS.flatMap((project) => [
    license(
      `${project.id}-code-license`,
      'code',
      project.codeSpdx === 'MIT' ? 'MIT License' : 'Apache License 2.0',
      `https://github.com/${project.repository}/blob/${project.codeRevision}/LICENSE`,
      `${project.name} code contributors`,
      {
        spdxId: project.codeSpdx,
        redistribution: true,
        commercial: true,
      },
    ),
    license(
      `${project.id}-weights-license`,
      'weights',
      project.weightsName,
      project.weightsEvidenceUrl ??
        `https://huggingface.co/${project.modelRepository}/blob/${project.modelRevision}/README.md`,
      `${project.name} model contributors`,
      {
        ...(project.weightsSpdx === undefined ? {} : { spdxId: project.weightsSpdx }),
        ...(project.weightsTerms === undefined ? {} : { exactUpstreamTerms: project.weightsTerms }),
        redistribution: project.weightsRedistribution,
        commercial: project.weightsCommercial,
        status: project.weightsRestricted ? 'restricted' : 'verified',
      },
    ),
  ]),
  license(
    'omnivoice-tokenizer-license',
    'runtime',
    'Boson Higgs Audio 2 custom tokenizer terms',
    'https://huggingface.co/k2-fsa/OmniVoice/blob/c5fdb5ccb189668d56333f77ba2629f4cd7535f4/audio_tokenizer/LICENSE',
    'Boson AI and OmniVoice audio-tokenizer contributors',
    {
      exactUpstreamTerms:
        'Use remains subject to the complete pinned custom license, including its attribution, acceptable-use, model-improvement, naming, and high-volume authorization conditions.',
      status: 'restricted',
    },
  ),
];

const CALIBRATION_SENTENCE =
  'A quiet signal crosses the morning air, clear, steady, and entirely its own.';
const REFERENCE_SENTENCE =
  'Soft rain settles beyond the window while a small lamp warms the quiet room.';
const DIA_CALIBRATION_SENTENCE =
  '[S1] A quiet signal crosses the morning air. [S2] Clear, steady, and entirely its own.';

function pendingRuntimeEnvironment(): GenerationCandidate['runtimeEnvironment'] {
  return {
    status: 'pending',
    requirements: [
      'Record an exact dependency-lock digest before generation.',
      'Record Python, framework, device, dtype, operating-system, and accelerator versions.',
      'Record a content-addressed runner image digest when a container is used.',
    ],
  };
}

function candidateEvidence(id: string): Pick<GenerationCandidate, 'sourceIds' | 'licenseIds'> {
  return {
    sourceIds: [`${id}-code-source`, `${id}-model-source`],
    licenseIds: [`${id}-code-license`, `${id}-weights-license`],
  };
}

export const GENERATION_CANDIDATES: GenerationCandidate[] = [
  {
    id: 'candidate-voxcpm2-neutral-v1',
    galleryId: 'voxcpm2',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: 'bffb3df5a29440629464e5e839f4d214c8714c3d',
    codeRevision: '616d3d3e630a9c96c2853250eef91b0f39dcd5fa',
    parameters: {
      voice_design_prefix:
        '(An adult narrator with a calm, clear, neutral voice, moderate pitch, and steady pace)',
      cfg_value: 2,
      inference_timesteps: 10,
      min_len: 2,
      max_len: 4096,
      normalize: false,
      denoise: false,
      retry_badcase: false,
      retry_badcase_max_times: 3,
      retry_badcase_ratio_threshold: 6,
      trim_silence_vad: false,
      streaming: false,
      load_denoiser: false,
    },
    seed: 42,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'recipe-ready-runtime-pending',
    readinessDetail:
      'No reference audio is required. Apply the seed to Python, NumPy, torch, and CUDA immediately before inference; retain AI labeling and responsible-use review.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('voxcpm2'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-qwen3-tts-neutral-v1',
    galleryId: 'qwen3-tts',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '85e237c12c027371202489a0ec509ded67b5e4b5',
    codeRevision: '022e286b98fbec7e1e916cb940cdf532cd9f488e',
    parameters: {
      speaker: 'Aiden',
      language: 'English',
      instruct: '',
      non_streaming_mode: true,
      do_sample: true,
      repetition_penalty: 1.05,
      temperature: 0.9,
      top_p: 1,
      top_k: 50,
      subtalker_dosample: true,
      subtalker_temperature: 0.9,
      subtalker_top_p: 1,
      subtalker_top_k: 50,
      max_new_tokens: 8192,
    },
    seed: 43,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'recipe-ready-runtime-pending',
    readinessDetail:
      'Uses the official no-reference Aiden preset. The pinned 0.6B path ignores instruct; sampler values match generation_config.json.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('qwen3-tts'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-parler-tts-neutral-v1',
    galleryId: 'parler-tts',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '0392b9451a601e528fd863bbb0598431fee810d9',
    codeRevision: 'd108732cd57788ec86bc857d99a6cabd66663d68',
    parameters: {
      description:
        'A single adult speaker delivers the sentence in a calm, neutral, clear voice at a moderate pace and pitch. The recording is clean, close, and free of background noise.',
      do_sample: true,
      guidance_scale: 1,
      min_new_tokens: 10,
      max_length: 2580,
      temperature: 1,
      top_k: 50,
      top_p: 1,
      num_beams: 1,
      repetition_penalty: 1,
      num_return_sequences: 1,
    },
    seed: 44,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'recipe-ready-runtime-pending',
    readinessDetail: 'No reference audio is required; the project-authored description is fixed.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('parler-tts'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-dia-neutral-v1',
    galleryId: 'dia',
    transcript: DIA_CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '257bc72f9b78182ccc6fa07675a9ae4c1a44e2cd',
    codeRevision: '876125e461a03b157ec905b0fe8b57a0f8b9e7a0',
    parameters: {
      max_tokens: 3072,
      cfg_scale: 3,
      temperature: 1.2,
      top_p: 0.95,
      cfg_filter_top_k: 45,
      use_torch_compile: false,
      audio_prompt_omitted: true,
      verbose: false,
    },
    seed: 45,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: ['descript-audio-codec-dac'],
    readiness: 'blocked-pending-dependency-pin',
    readinessDetail:
      'Blocked until the secondary DAC dependency is revision-pinned alongside the project-authored no-audio-prompt script.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('dia'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-chatterbox-neutral-v1',
    galleryId: 'chatterbox',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18',
    codeRevision: '65b18437192794391a0308a8f705b1e33e633948',
    parameters: {
      repetition_penalty: 1.2,
      min_p: 0.05,
      top_p: 1,
      audio_prompt_path_omitted: true,
      exaggeration: 0.5,
      cfg_weight: 0.5,
      temperature: 0.8,
      internal_max_new_tokens: 1000,
      conditioning_source: 'packaged-default',
    },
    seed: 46,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'recipe-ready-runtime-pending',
    readinessDetail:
      'Uses packaged default conditioning without reference audio. PerTh watermark preservation is mandatory.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('chatterbox'),
    referenceLineage: null,
    watermarkRequirement: 'preserve-perth',
  },
  {
    id: 'candidate-cosyvoice3-neutral-v1',
    galleryId: 'cosyvoice3',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '29e01c4e8d000f4bcd70751be16fa94bf3d85a18',
    codeRevision: '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',
    parameters: {
      method: 'inference_zero_shot',
      zero_shot_spk_id: '',
      stream: false,
      speed: 1,
      text_frontend: true,
      internal_sampling: 25,
      internal_ras_top_p: 0.8,
      internal_ras_top_k: 25,
      internal_ras_win_size: 10,
      internal_ras_tau_r: 0.1,
      internal_max_token_text_ratio: 20,
      internal_min_token_text_ratio: 2,
    },
    seed: 47,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: [],
    readiness: 'blocked-pending-reference',
    readinessDetail:
      'Hard-blocked until the project generates, hashes, rights-reviews, and approves the planned MeloTTS reference.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('cosyvoice3'),
    referenceLineage: {
      status: 'pending',
      generatorCandidateId: 'candidate-melotts-neutral-v1',
      promptText: REFERENCE_SENTENCE,
      audioSha256: null,
      transcriptSha256: null,
      rightsBasis:
        'Project-authored calibration text and a future project-generated MeloTTS reference; no third-party reference audio is allowed.',
      humanReview: null,
    },
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-melotts-neutral-v1',
    galleryId: 'melotts',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: 'bb4fb7346d566d277ba8c8c7dbfdf6786139b8ef',
    codeRevision: '209145371cff8fc3bd60d7be902ea69cbdb7965a',
    parameters: {
      constructor_language: 'EN',
      speaker_key: 'EN-US',
      speaker_id: 0,
      sdp_ratio: 0.2,
      noise_scale: 0.6,
      noise_scale_w: 0.8,
      speed: 1,
      format: 'wav',
      quiet: true,
    },
    seed: 48,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: ['bert-base-uncased'],
    readiness: 'blocked-pending-dependency-pin',
    readinessDetail:
      'Blocked until the English checkpoint metadata and EN-US speaker mapping receive an independent pinned-file verification.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('melotts'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
  {
    id: 'candidate-bark-neutral-v1',
    galleryId: 'bark',
    transcript: CALIBRATION_SENTENCE,
    locale: 'en-US',
    modelRevision: '70a8a7d34168586dc5d028fa9666aceade177992',
    codeRevision: 'f4f32d4cd480dfec1c245d258174bc9bde3c2148',
    parameters: {
      history_prompt_omitted: true,
      text_temp: 0.7,
      waveform_temp: 0.7,
      silent: true,
      output_full: false,
      internal_semantic_top_k_omitted: true,
      internal_semantic_top_p_omitted: true,
      internal_semantic_min_eos_p: 0.2,
      internal_semantic_allow_early_stop: true,
      internal_semantic_use_kv_caching: true,
      internal_coarse_top_k_omitted: true,
      internal_coarse_top_p_omitted: true,
      internal_coarse_use_kv_caching: true,
      internal_fine_temperature: 0.5,
    },
    seed: 49,
    loadingStrategy: 'pinned-local-snapshot',
    dependencyRevisions: {},
    unresolvedDependencies: ['bert-base-multilingual-cased'],
    readiness: 'blocked-pending-dependency-pin',
    readinessDetail:
      'Blocked until the secondary multilingual BERT dependency is revision-pinned. No history prompt or reference audio will be used; human review remains mandatory.',
    runtimeEnvironment: pendingRuntimeEnvironment(),
    ...candidateEvidence('bark'),
    referenceLineage: null,
    watermarkRequirement: 'none',
  },
];

const candidateIds = new Map(
  GENERATION_CANDIDATES.map((candidate) => [candidate.galleryId, candidate.id]),
);

export const GALLERIES: GalleryManifest[] = GALLERY_PROJECTS.map((project) => {
  const candidate = GENERATION_CANDIDATES.find(({ galleryId }) => galleryId === project.id);
  const additionalLicenseIds = project.id === 'omnivoice' ? ['omnivoice-tokenizer-license'] : [];
  return {
    id: project.id,
    displayName: project.name,
    mode: project.mode,
    officialProjectUrl: project.officialProjectUrl,
    sourceIds: [`${project.id}-code-source`, `${project.id}-model-source`],
    licenseIds: [
      `${project.id}-code-license`,
      `${project.id}-weights-license`,
      ...additionalLicenseIds,
    ],
    candidateId:
      project.mode === 'generation-candidate' ? (candidateIds.get(project.id) ?? null) : null,
    sampleIds: [],
    generatedMediaIds: [],
    notice:
      project.mode === 'source-only'
        ? 'Source-only: open the official project. No third-party audio is copied, proxied, cached, or offered for download.'
        : candidate?.readiness === 'recipe-ready-runtime-pending'
          ? 'Curatorial recipe reviewed; execution remains blocked until the exact runtime environment is locked. Project media stays empty until a fresh output has complete rights, digest, lineage, and human-review provenance.'
          : `Generation plan blocked: ${candidate?.readinessDetail ?? 'required evidence is incomplete'}`,
  };
});

export const LAUNCH_SOURCES = [...ENGINE_SOURCES, ...GALLERY_SOURCES];
export const ALL_LAUNCH_LICENSES = [...LAUNCH_LICENSES, ...GALLERY_LICENSES];
