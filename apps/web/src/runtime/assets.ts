import {
  parseBrowserRuntimeS0Evidence,
  type AssetSetManifest,
  type BrowserRuntimeS0Evidence,
  type ImmutableAsset,
} from '@open-voice/contracts';

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

export type AssetStorageDescription = {
  selectedBytes: number;
  largestAssetBytes: number;
  safetyMarginBytes: number;
  upperBoundBytes: number;
};

export type AssetStorageManagerPort = {
  estimate(): Promise<{ quota?: number; usage?: number }>;
  persist?(): Promise<boolean>;
};

export function createBrowserStorageManagerPort(
  getStorage: () => Pick<StorageManager, 'estimate' | 'persist'> = () => navigator.storage,
): AssetStorageManagerPort {
  let storage: Pick<StorageManager, 'estimate' | 'persist'> | null = null;
  const resolveStorage = () => {
    storage ??= getStorage();
    return storage;
  };
  return {
    async estimate() {
      return await resolveStorage().estimate();
    },
    async persist() {
      return await resolveStorage().persist();
    },
  };
}

export type AssetStorageEvidence = AssetStorageDescription & {
  persisted: boolean | null;
  quotaBytes: number | null;
  usageBytes: number | null;
  retainedBytes: number;
  candidateBytes: number;
  largestTemporaryBytes: number;
  additionalRequiredBytes: number;
  requiredCapacityBytes: number;
};

export type AssetPreparationAssetEvidence = BrowserRuntimeS0Evidence['assets'][number];

export type AssetPreparationEvidence = BrowserRuntimeS0Evidence;

export type AssetTemporarySink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

export type AssetStorePort = {
  has(cacheKey: string, sha256: string, bytes: number): Promise<boolean>;
  readVerified(cacheKey: string, sha256: string, bytes: number): Promise<ArrayBuffer | null>;
  createTemporary(key: string): Promise<AssetTemporarySink>;
  promote(
    temporaryKey: string,
    cacheKey: string,
    identity: { sha256: string; bytes: number },
  ): Promise<void>;
  deleteTemporary(temporaryKey: string): Promise<void>;
};

export type PreparedAssetBytes = {
  assetId: string;
  cacheKey: string;
  sha256: string;
  byteLength: number;
  bytes: ArrayBuffer;
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
  | 'unapproved-response'
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
  storage?: AssetStorageManagerPort | null;
  temporaryNamespace?: string;
};

const MIN_STORAGE_SAFETY_BYTES = 8 * 1024 * 1024;
const MAX_STORAGE_SAFETY_BYTES = 64 * 1024 * 1024;

function safeByteSum(...values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new AssetPreparationError(
      'storage-error',
      'The selected asset storage requirement exceeds safe browser limits.',
    );
  }
  return total;
}

function storageDescription(assetSet: AssetSetManifest): AssetStorageDescription {
  const largestAssetBytes = Math.max(...assetSet.assets.map(({ bytes }) => bytes));
  const proportionalMargin = Math.ceil(assetSet.totalBytes * 0.05);
  const safetyMarginBytes = Math.min(
    MAX_STORAGE_SAFETY_BYTES,
    Math.max(MIN_STORAGE_SAFETY_BYTES, proportionalMargin),
  );
  return {
    selectedBytes: assetSet.totalBytes,
    largestAssetBytes,
    safetyMarginBytes,
    upperBoundBytes: safeByteSum(assetSet.totalBytes, largestAssetBytes, safetyMarginBytes),
  };
}

function observedByteValue(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

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

async function contentLength(response: Response, asset: ImmutableAsset): Promise<number | null> {
  try {
    const raw = response.headers.get('content-length');
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} did not expose readable response headers.`,
      ),
    );
  }
}

async function cancelResponseBody(response: Response, reason: unknown): Promise<void> {
  try {
    const body = response.body;
    if (body !== null) await body.cancel(reason);
  } catch {
    // Cancellation is best effort; the owned validation error remains authoritative.
  }
}

async function rejectResponse(response: Response, error: AssetPreparationError): Promise<never> {
  await cancelResponseBody(response, error);
  throw error;
}

async function bestEffortCleanup(action: () => unknown): Promise<void> {
  try {
    await action();
  } catch {
    // Cleanup must never replace the operation's owned error or suppress later cleanup steps.
  }
}

async function validateResponseMetadata(
  asset: ImmutableAsset,
  response: Response,
): Promise<{ finalUrl: string; finalOrigin: string; responseType: 'cors'; status: 200 }> {
  let status: number;
  try {
    status = response.status;
  } catch {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} did not expose a readable final HTTP status.`,
      ),
    );
  }
  if (status! !== 200) {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} returned an unapproved final HTTP status ${status!}.`,
      ),
    );
  }
  let responseType: ResponseType;
  try {
    responseType = response.type;
  } catch {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} did not expose a readable response type.`,
      ),
    );
  }
  if (responseType! !== 'cors') {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} did not return a CORS-readable response type.`,
      ),
    );
  }

  let finalUrl: URL;
  try {
    finalUrl = new URL(response.url);
  } catch {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} did not expose a valid final response URL.`,
      ),
    );
  }
  if (
    finalUrl!.protocol !== 'https:' ||
    finalUrl!.username.length > 0 ||
    finalUrl!.password.length > 0 ||
    !asset.approvedFinalOrigins.includes(finalUrl!.origin)
  ) {
    await rejectResponse(
      response,
      new AssetPreparationError(
        'unapproved-response',
        `${asset.id} resolved to an unapproved final origin.`,
      ),
    );
  }
  return {
    finalUrl: finalUrl!.href,
    finalOrigin: finalUrl!.origin,
    responseType: 'cors',
    status: 200,
  };
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
  private readonly storage: AssetStorageManagerPort | null;
  private readonly temporaryNamespace: string;
  private operationSequence = 0;

  constructor({
    store,
    fetcher = globalThis.fetch,
    createDigest = createSha256Digest,
    storage = null,
    temporaryNamespace = createTemporaryNamespace(),
  }: AssetPreparationPorts) {
    this.store = store;
    this.fetcher = fetcher;
    this.createDigest = createDigest;
    this.storage = storage;
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

  describeStorage(assetSet: AssetSetManifest): AssetStorageDescription {
    return storageDescription(assetSet);
  }

  async prepare(
    assetSet: AssetSetManifest,
    receipt: ConsentReceipt | null,
    options: AssetPreparationOptions = {},
  ): Promise<AssetPreparationEvidence> {
    // This check intentionally precedes even a cache lookup. Consent is tied to
    // the exact manifest, including assets that might already be cached.
    validateConsent(assetSet, receipt);

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    let completedBytes = 0;
    try {
      const cached: boolean[] = [];
      for (const asset of assetSet.assets) {
        throwIfAborted(controller.signal);
        try {
          cached.push(await this.store.has(asset.cacheKey, asset.sha256, asset.bytes));
        } catch (error) {
          throwIfAborted(controller.signal);
          throw classifyStorageError(error);
        }
        throwIfAborted(controller.signal);
      }
      const storage = await this.prepareStorage(assetSet, cached, controller.signal);
      throwIfAborted(controller.signal);
      const assets: AssetPreparationAssetEvidence[] = [];
      for (const [index, asset] of assetSet.assets.entries()) {
        throwIfAborted(controller.signal);
        if (cached[index] === true) {
          completedBytes += asset.bytes;
          options.onProgress?.({
            assetId: asset.id,
            completedBytes,
            totalBytes: assetSet.totalBytes,
            percent: Math.round((completedBytes / assetSet.totalBytes) * 100),
          });
          throwIfAborted(controller.signal);
          assets.push({
            assetId: asset.id,
            cacheKey: asset.cacheKey,
            disposition: 'cache-hit',
            requestUrl: null,
            finalUrl: null,
            finalOrigin: null,
            responseType: null,
            status: null,
            expectedBytes: asset.bytes,
            observedBytes: asset.bytes,
            expectedSha256: asset.sha256,
            observedSha256: asset.sha256,
          });
          continue;
        }

        const evidence = await this.downloadAndStore(
          asset,
          controller.signal,
          completedBytes,
          assetSet.totalBytes,
          options.onProgress,
        );
        throwIfAborted(controller.signal);
        assets.push(evidence);
        completedBytes += asset.bytes;
      }
      throwIfAborted(controller.signal);
      const evidence: AssetPreparationEvidence = {
        schemaVersion: 1,
        kind: 'open-voice-browser-runtime-s0',
        assetSetId: assetSet.id,
        manifestDigest: assetSet.manifestDigest,
        consent: {
          assetSetId: receipt!.assetSetId,
          manifestDigest: receipt!.manifestDigest,
          acceptedLicenseIds: [...receipt!.acceptedLicenseIds],
          acceptedTermsHashes: [...receipt!.acceptedTermsHashes],
        },
        storage,
        assets,
      };
      return parseBrowserRuntimeS0Evidence(evidence, assetSet);
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
  }

  async readPreparedAssets(
    assetSet: AssetSetManifest,
    receipt: ConsentReceipt | null,
    options: Pick<AssetPreparationOptions, 'signal'> = {},
  ): Promise<PreparedAssetBytes[]> {
    validateConsent(assetSet, receipt);
    const result: PreparedAssetBytes[] = [];
    for (const asset of assetSet.assets) {
      if (options.signal !== undefined) throwIfAborted(options.signal);
      let bytes: ArrayBuffer | null;
      try {
        bytes = await this.store.readVerified(asset.cacheKey, asset.sha256, asset.bytes);
      } catch (error) {
        if (options.signal !== undefined) throwIfAborted(options.signal);
        throw classifyStorageError(error);
      }
      if (options.signal !== undefined) throwIfAborted(options.signal);
      if (bytes === null || bytes.byteLength !== asset.bytes) {
        throw new AssetPreparationError(
          'asset-unavailable',
          `${asset.id} is not present as verified content-addressed bytes. Prepare it again.`,
        );
      }
      result.push({
        assetId: asset.id,
        cacheKey: asset.cacheKey,
        sha256: asset.sha256,
        byteLength: bytes.byteLength,
        bytes,
      });
    }
    if (options.signal !== undefined) throwIfAborted(options.signal);
    return result;
  }

  private async prepareStorage(
    assetSet: AssetSetManifest,
    cached: readonly boolean[],
    signal: AbortSignal,
  ): Promise<AssetStorageEvidence> {
    const description = storageDescription(assetSet);
    let retainedBytes = 0;
    let candidateBytes = 0;
    let largestTemporaryBytes = 0;
    for (const [index, asset] of assetSet.assets.entries()) {
      if (cached[index] === true) retainedBytes = safeByteSum(retainedBytes, asset.bytes);
      else {
        candidateBytes = safeByteSum(candidateBytes, asset.bytes);
        largestTemporaryBytes = Math.max(largestTemporaryBytes, asset.bytes);
      }
    }
    const additionalRequiredBytes =
      candidateBytes === 0
        ? 0
        : safeByteSum(candidateBytes, largestTemporaryBytes, description.safetyMarginBytes);
    const requiredCapacityBytes = safeByteSum(retainedBytes, additionalRequiredBytes);
    let persisted: boolean | null = null;
    let quotaBytes: number | null = null;
    let usageBytes: number | null = null;
    if (this.storage !== null) {
      throwIfAborted(signal);
      if (this.storage.persist !== undefined) {
        try {
          persisted = await this.storage.persist();
        } catch {
          persisted = null;
        }
      }
      throwIfAborted(signal);
      try {
        const estimate = await this.storage.estimate();
        quotaBytes = observedByteValue(estimate.quota);
        usageBytes = observedByteValue(estimate.usage);
      } catch {
        quotaBytes = null;
        usageBytes = null;
      }
      throwIfAborted(signal);
      if (
        quotaBytes !== null &&
        usageBytes !== null &&
        Math.max(0, quotaBytes - usageBytes) < additionalRequiredBytes
      ) {
        throw new AssetPreparationError(
          'quota-exceeded',
          'The browser storage quota is too small for the selected runtime assets.',
        );
      }
    }
    return {
      ...description,
      persisted,
      quotaBytes,
      usageBytes,
      retainedBytes,
      candidateBytes,
      largestTemporaryBytes,
      additionalRequiredBytes,
      requiredCapacityBytes,
    };
  }

  private async downloadAndStore(
    asset: ImmutableAsset,
    signal: AbortSignal,
    completedBeforeAsset: number,
    totalBytes: number,
    onProgress: AssetPreparationOptions['onProgress'],
  ): Promise<AssetPreparationAssetEvidence> {
    const operationId = ++this.operationSequence;
    const temporaryKey = `${asset.cacheKey}.partial-${this.temporaryNamespace}-${operationId}`;
    let temporaryCreated = false;
    let promoted = false;
    let sink: AssetTemporarySink | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let readerFinished = false;
    let readerCancellation: Promise<void> | null = null;
    const cancelReaderBestEffort = (reason?: unknown): Promise<void> => {
      if (readerCancellation !== null) return readerCancellation;
      if (reader === null || readerFinished) return Promise.resolve();
      readerCancellation = bestEffortCleanup(() => reader!.cancel(reason));
      return readerCancellation;
    };
    const cancelReader = () => {
      void cancelReaderBestEffort(signal.reason);
    };

    try {
      let networkResponse: Response;
      try {
        networkResponse = await this.fetcher(asset.url, {
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors',
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
      throwIfAborted(signal);

      const responseMetadata = await validateResponseMetadata(asset, networkResponse);
      throwIfAborted(signal);
      const declaredLength = await contentLength(networkResponse, asset);
      throwIfAborted(signal);
      if (declaredLength !== null && declaredLength !== asset.bytes) {
        const relation = declaredLength > asset.bytes ? 'larger' : 'truncated';
        await rejectResponse(
          networkResponse,
          new AssetPreparationError(
            'unexpected-size',
            `${asset.id} is ${relation} than the immutable manifest size.`,
          ),
        );
      }
      let body: ReadableStream<Uint8Array> | null;
      try {
        body = networkResponse.body;
      } catch {
        throw new AssetPreparationError(
          'unapproved-response',
          `${asset.id} did not expose a readable response body.`,
        );
      }
      if (body === null) {
        throw new AssetPreparationError('network-error', `${asset.id} returned no response body.`);
      }

      const digest = this.createDigest();
      try {
        sink = await this.store.createTemporary(temporaryKey);
        temporaryCreated = true;
      } catch (error) {
        throwIfAborted(signal);
        throw classifyStorageError(error);
      }
      throwIfAborted(signal);
      try {
        reader = body.getReader();
      } catch (error) {
        throw new AssetPreparationError(
          'unapproved-response',
          `${asset.id} did not expose a readable response stream.`,
          { cause: error },
        );
      }
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
          throwIfAborted(signal);
          throw classifyStorageError(error);
        }
        throwIfAborted(signal);
        onProgress?.({
          assetId: asset.id,
          completedBytes: completedBeforeAsset + receivedBytes,
          totalBytes,
          percent: Math.round(((completedBeforeAsset + receivedBytes) / totalBytes) * 100),
        });
        throwIfAborted(signal);
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
        throwIfAborted(signal);
        throw classifyStorageError(error);
      }
      throwIfAborted(signal);

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
        throwIfAborted(signal);
        throw classifyStorageError(error);
      }
      throwIfAborted(signal);
      return {
        assetId: asset.id,
        cacheKey: asset.cacheKey,
        disposition: 'downloaded',
        requestUrl: asset.url,
        finalUrl: responseMetadata.finalUrl,
        finalOrigin: responseMetadata.finalOrigin,
        responseType: responseMetadata.responseType,
        status: responseMetadata.status,
        expectedBytes: asset.bytes,
        observedBytes: receivedBytes,
        expectedSha256: asset.sha256,
        observedSha256: actualHash,
      };
    } finally {
      signal.removeEventListener('abort', cancelReader);
      if (reader !== null) {
        if (readerCancellation !== null) await readerCancellation;
        else if (!readerFinished) await cancelReaderBestEffort();
        await bestEffortCleanup(() => reader!.releaseLock());
      }
      if (temporaryCreated && !promoted) {
        if (sink !== null) await bestEffortCleanup(() => sink!.abort());
        await bestEffortCleanup(() => this.store.deleteTemporary(temporaryKey));
      }
    }
  }
}
