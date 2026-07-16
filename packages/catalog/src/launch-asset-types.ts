export type PinnedAssetSource = {
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
