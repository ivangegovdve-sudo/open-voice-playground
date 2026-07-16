export type PinnedAssetSeed = {
  id: string;
  path: string;
  url: string;
  revision: string;
  sha256: `sha256:${string}`;
  bytes: number;
  mediaType: string;
  sourceId: string;
  licenseId: string;
  requiredAcceptance: { licenseId: string; termsHash: `sha256:${string}` } | null;
  voiceId?: string;
};

export type PinnedAssetSource = PinnedAssetSeed & {
  approvedFinalOrigins: string[];
};

const HUGGING_FACE_ORIGIN = 'https://huggingface.co';
const HUGGING_FACE_XET_ORIGIN = 'https://cas-bridge.xethub.hf.co';

/**
 * Attaches the exact final origins observed by the S0 one-byte CORS probes.
 * Unknown direct-Hub IDs and non-Hugging-Face source URLs fail closed during
 * catalog construction instead of silently widening an allowlist.
 */
export function withObservedHuggingFaceOrigins(
  assets: PinnedAssetSeed[],
  directHubAssetIds: readonly string[] = [],
): PinnedAssetSource[] {
  const ids = new Set(assets.map(({ id }) => id));
  const direct = new Set(directHubAssetIds);
  for (const id of direct) {
    if (!ids.has(id)) throw new Error(`Unknown direct-Hub asset ID: ${id}`);
  }
  return assets.map((asset) => {
    if (new URL(asset.url).origin !== HUGGING_FACE_ORIGIN) {
      throw new Error(`No observed final-origin policy for asset ${asset.id}`);
    }
    return {
      ...asset,
      approvedFinalOrigins: [direct.has(asset.id) ? HUGGING_FACE_ORIGIN : HUGGING_FACE_XET_ORIGIN],
    };
  });
}
