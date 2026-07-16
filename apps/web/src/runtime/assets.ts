import type { AssetSetManifest, ImmutableAsset } from '@open-voice/contracts';

export type ConsentReceipt = {
  assetSetId: string;
  manifestDigest: string;
  acceptedLicenseIds: string[];
  acceptedTermsHashes: string[];
};

export type AssetPreparationProgress = {
  assetId: string;
  completedBytes: number;
  totalBytes: number;
  percent: number;
};

export type AssetPreparationOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: AssetPreparationProgress) => void;
};

export type AssetPreparationDescription = {
  assetSetId: string;
  downloadBytes: number;
  consentRequired: boolean;
  requiredLicenseIds: string[];
};

export type AssetTemporarySink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

export type AssetStorePort = {
  has(cacheKey: string, sha256: string, bytes: number): Promise<boolean>;
  createTemporary(key: string): Promise<AssetTemporarySink>;
  promote(
    temporaryKey: string,
    cacheKey: string,
    identity: { sha256: string; bytes: number },
  ): Promise<void>;
  deleteTemporary(temporaryKey: string): Promise<void>;
};

export type StreamingDigest = {
  update(chunk: Uint8Array): void;
  digest(): Promise<string>;
};

export type AssetPreparationErrorCode =
  | 'consent-required'
  | 'stale-consent'
  | 'license-acceptance-required'
  | 'asset-unavailable'
  | 'network-error'
  | 'unexpected-size'
  | 'hash-mismatch'
  | 'quota-exceeded'
  | 'storage-error';

export class AssetPreparationError extends Error {
  override readonly name = 'AssetPreparationError';

  constructor(
    readonly code: AssetPreparationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

type AssetPreparationPorts = {
  store: AssetStorePort;
  fetcher?: typeof fetch;
  createDigest?: () => StreamingDigest;
  temporaryNamespace?: string;
};

function createTemporaryNamespace(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const entropy = new Uint32Array(4);
  globalThis.crypto.getRandomValues(entropy);
  return [...entropy].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function normalizeAcceptedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function requiredTermsHashes(assetSet: AssetSetManifest): string[] {
  return normalizeAcceptedIds(
    assetSet.assets.flatMap((asset) =>
      asset.requiredAcceptance === null ? [] : [asset.requiredAcceptance.termsHash],
    ),
  );
}

export function createConsentReceipt(
  assetSet: AssetSetManifest,
  acceptedLicenseIds: readonly string[],
): ConsentReceipt {
  return {
    assetSetId: assetSet.id,
    manifestDigest: assetSet.manifestDigest,
    acceptedLicenseIds: normalizeAcceptedIds(acceptedLicenseIds),
    acceptedTermsHashes: requiredTermsHashes(assetSet),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The asset preparation was aborted.', 'AbortError');
  }
}

const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

class Sha256Digest implements StreamingDigest {
  private readonly state = SHA256_INITIAL.slice();
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private finalized = false;
  private result: string | null = null;

  update(chunk: Uint8Array): void {
    if (this.finalized) throw new Error('Cannot update a finalized SHA-256 digest.');
    this.totalBytes += chunk.byteLength;
    let offset = 0;

    if (this.blockLength > 0) {
      const needed = Math.min(64 - this.blockLength, chunk.byteLength);
      this.block.set(chunk.subarray(0, needed), this.blockLength);
      this.blockLength += needed;
      offset += needed;
      if (this.blockLength === 64) {
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
    }

    while (offset + 64 <= chunk.byteLength) {
      this.compress(chunk, offset);
      offset += 64;
    }
    if (offset < chunk.byteLength) {
      this.block.set(chunk.subarray(offset), 0);
      this.blockLength = chunk.byteLength - offset;
    }
  }

  async digest(): Promise<string> {
    if (this.result !== null) return this.result;
    if (!this.finalized) {
      this.finalized = true;
      this.block[this.blockLength++] = 0x80;
      if (this.blockLength > 56) {
        this.block.fill(0, this.blockLength);
        this.compress(this.block, 0);
        this.blockLength = 0;
      }
      this.block.fill(0, this.blockLength, 56);
      const bitLength = this.totalBytes * 8;
      const high = Math.floor(bitLength / 0x1_0000_0000);
      const low = bitLength >>> 0;
      const view = new DataView(this.block.buffer);
      view.setUint32(56, high, false);
      view.setUint32(60, low, false);
      this.compress(this.block, 0);
      this.result = `sha256:${[...this.state]
        .map((value) => value.toString(16).padStart(8, '0'))
        .join('')}`;
    }
    return this.result!;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const words = this.words;
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4;
      words[index] =
        ((bytes[byteOffset]! << 24) |
          (bytes[byteOffset + 1]! << 16) |
          (bytes[byteOffset + 2]! << 8) |
          bytes[byteOffset + 3]!) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15]!;
      const previous2 = words[index - 2]!;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

export function createSha256Digest(): StreamingDigest {
  return new Sha256Digest();
}

function validateConsent(assetSet: AssetSetManifest, receipt: ConsentReceipt | null): void {
  if (assetSet.releaseGate.status !== 'enabled') {
    throw new AssetPreparationError(
      'asset-unavailable',
      `${assetSet.releaseGate.reason ?? 'asset-unavailable'}: ${assetSet.releaseGate.detail}`,
    );
  }
  if (receipt === null) {
    throw new AssetPreparationError(
      'consent-required',
      'Consent is required before downloading runtime assets.',
    );
  }
  if (receipt.assetSetId !== assetSet.id || receipt.manifestDigest !== assetSet.manifestDigest) {
    throw new AssetPreparationError(
      'stale-consent',
      'The asset manifest changed after consent was recorded; review and accept it again.',
    );
  }

  const acceptedLicenses = new Set(receipt.acceptedLicenseIds);
  const missingLicense = assetSet.requiredAcceptanceLicenseIds.find(
    (licenseId) => !acceptedLicenses.has(licenseId),
  );
  const acceptedTerms = new Set(receipt.acceptedTermsHashes);
  const missingTerms = requiredTermsHashes(assetSet).find((hash) => !acceptedTerms.has(hash));
  if (missingLicense !== undefined || missingTerms !== undefined) {
    throw new AssetPreparationError(
      'license-acceptance-required',
      'All required licenses and exact terms must be accepted before downloading assets.',
    );
  }
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function classifyStorageError(error: unknown): AssetPreparationError {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new AssetPreparationError(
      'quota-exceeded',
      'The browser storage quota is too small for this runtime asset.',
      { cause: error },
    );
  }
  if (error instanceof AssetPreparationError) return error;
  return new AssetPreparationError('storage-error', 'The verified asset could not be stored.', {
    cause: error,
  });
}

/**
 * A consent-gated, content-addressed preparation coordinator. Construction and
 * describe() are deliberately pure: no storage, network, or Worker access occurs
 * until prepare() is explicitly called after the user accepts the manifest.
 */
export class AssetPreparationManager {
  private readonly store: AssetStorePort;
  private readonly fetcher: typeof fetch;
  private readonly createDigest: () => StreamingDigest;
  private readonly temporaryNamespace: string;
  private operationSequence = 0;

  constructor({
    store,
    fetcher = globalThis.fetch,
    createDigest = createSha256Digest,
    temporaryNamespace = createTemporaryNamespace(),
  }: AssetPreparationPorts) {
    this.store = store;
    this.fetcher = fetcher;
    this.createDigest = createDigest;
    this.temporaryNamespace = temporaryNamespace;
  }

  describe(assetSet: AssetSetManifest): AssetPreparationDescription {
    return {
      assetSetId: assetSet.id,
      downloadBytes: assetSet.totalBytes,
      consentRequired: true,
      requiredLicenseIds: [...assetSet.requiredAcceptanceLicenseIds],
    };
  }

  async prepare(
    assetSet: AssetSetManifest,
    receipt: ConsentReceipt | null,
    options: AssetPreparationOptions = {},
  ): Promise<void> {
    // This check intentionally precedes even a cache lookup. Consent is tied to
    // the exact manifest, including assets that might already be cached.
    validateConsent(assetSet, receipt);

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    let completedBytes = 0;
    try {
      for (const asset of assetSet.assets) {
        throwIfAborted(controller.signal);
        if (await this.store.has(asset.cacheKey, asset.sha256, asset.bytes)) {
          completedBytes += asset.bytes;
          options.onProgress?.({
            assetId: asset.id,
            completedBytes,
            totalBytes: assetSet.totalBytes,
            percent: Math.round((completedBytes / assetSet.totalBytes) * 100),
          });
          continue;
        }

        await this.downloadAndStore(
          asset,
          controller.signal,
          completedBytes,
          assetSet.totalBytes,
          options.onProgress,
        );
        completedBytes += asset.bytes;
      }
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private async downloadAndStore(
    asset: ImmutableAsset,
    signal: AbortSignal,
    completedBeforeAsset: number,
    totalBytes: number,
    onProgress: AssetPreparationOptions['onProgress'],
  ): Promise<void> {
    const operationId = ++this.operationSequence;
    const temporaryKey = `${asset.cacheKey}.partial-${this.temporaryNamespace}-${operationId}`;
    let temporaryCreated = false;
    let promoted = false;
    let sink: AssetTemporarySink | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let readerFinished = false;
    const cancelReader = () => {
      if (reader !== null && !readerFinished) {
        void reader.cancel(signal.reason).catch(() => undefined);
      }
    };

    try {
      let networkResponse: Response;
      try {
        networkResponse = await this.fetcher(asset.url, {
          credentials: 'omit',
          redirect: 'follow',
          signal,
        });
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException('The asset preparation was aborted.', 'AbortError');
        }
        throw new AssetPreparationError('network-error', `Could not download ${asset.id}.`, {
          cause: error,
        });
      }

      if (!networkResponse.ok) {
        throw new AssetPreparationError(
          'network-error',
          `Could not download ${asset.id}: HTTP ${networkResponse.status}.`,
        );
      }
      const declaredLength = contentLength(networkResponse);
      if (declaredLength !== null && declaredLength !== asset.bytes) {
        const relation = declaredLength > asset.bytes ? 'larger' : 'truncated';
        throw new AssetPreparationError(
          'unexpected-size',
          `${asset.id} is ${relation} than the immutable manifest size.`,
        );
      }
      if (networkResponse.body === null) {
        throw new AssetPreparationError('network-error', `${asset.id} returned no response body.`);
      }

      const digest = this.createDigest();
      try {
        sink = await this.store.createTemporary(temporaryKey);
        temporaryCreated = true;
      } catch (error) {
        throw classifyStorageError(error);
      }
      reader = networkResponse.body.getReader();
      signal.addEventListener('abort', cancelReader, { once: true });
      let receivedBytes = 0;
      while (true) {
        throwIfAborted(signal);
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (error) {
          if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            throw signal.reason instanceof Error
              ? signal.reason
              : new DOMException('The asset preparation was aborted.', 'AbortError');
          }
          throw new AssetPreparationError('network-error', `The ${asset.id} stream failed.`, {
            cause: error,
          });
        }
        throwIfAborted(signal);
        if (result.done) {
          readerFinished = true;
          break;
        }

        const chunk = result.value;
        receivedBytes += chunk.byteLength;
        if (receivedBytes > asset.bytes) {
          throw new AssetPreparationError(
            'unexpected-size',
            `${asset.id} is larger than the immutable manifest size.`,
          );
        }
        digest.update(chunk);
        try {
          await sink.write(chunk);
        } catch (error) {
          throw classifyStorageError(error);
        }
        onProgress?.({
          assetId: asset.id,
          completedBytes: completedBeforeAsset + receivedBytes,
          totalBytes,
          percent: Math.round(((completedBeforeAsset + receivedBytes) / totalBytes) * 100),
        });
      }
      if (receivedBytes !== asset.bytes) {
        throw new AssetPreparationError(
          'unexpected-size',
          `${asset.id} is truncated relative to the immutable manifest size.`,
        );
      }
      try {
        await sink.close();
      } catch (error) {
        throw classifyStorageError(error);
      }

      const actualHash = await digest.digest();
      throwIfAborted(signal);
      if (actualHash !== asset.sha256) {
        throw new AssetPreparationError(
          'hash-mismatch',
          `The downloaded ${asset.id} hash does not match the immutable manifest.`,
        );
      }

      try {
        await this.store.promote(temporaryKey, asset.cacheKey, {
          sha256: asset.sha256,
          bytes: asset.bytes,
        });
        promoted = true;
      } catch (error) {
        throw classifyStorageError(error);
      }
    } finally {
      signal.removeEventListener('abort', cancelReader);
      if (reader !== null) {
        if (!readerFinished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (temporaryCreated && !promoted) {
        await sink?.abort().catch(() => undefined);
        await this.store.deleteTemporary(temporaryKey).catch(() => undefined);
      }
    }
  }
}
