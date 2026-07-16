import { createSha256Digest, type AssetStorePort, type AssetTemporarySink } from './assets';

export type OpfsWritablePort = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

export type OpfsFileSnapshotPort = {
  readonly size: number;
  text(): Promise<string>;
  stream(): ReadableStream<Uint8Array>;
};

export type OpfsFilePort = {
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritablePort>;
  getFile(): Promise<OpfsFileSnapshotPort>;
  move?(newName: string): Promise<void>;
};

export type OpfsDirectoryPort = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryPort>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFilePort>;
  removeEntry(name: string): Promise<void>;
};

export type OpfsLockManagerPort = {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
};

type OpfsAssetStoreOptions = {
  getRoot?: () => Promise<OpfsDirectoryPort>;
  namespace?: readonly string[];
  locks?: OpfsLockManagerPort | null;
};

type CacheIdentity = { sha256: string; bytes: number };
type CommitRecord = CacheIdentity & {
  version: 1;
  cacheKey: string;
  dataFile: string;
};

const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const FALLBACK_LOCKS = new Map<string, Promise<void>>();

function splitSafeKey(key: string): string[] {
  const segments = key.split('/');
  if (segments.length < 2 || segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
    throw new Error(`Expected a safe namespaced OPFS cache key, received ${JSON.stringify(key)}.`);
  }
  return segments;
}

function assertIdentity(identity: CacheIdentity): void {
  if (
    !SHA256.test(identity.sha256) ||
    !Number.isSafeInteger(identity.bytes) ||
    identity.bytes <= 0
  ) {
    throw new Error('Expected a complete SHA-256 and positive exact byte length.');
  }
}

function generationName(name: string, identity: CacheIdentity): string {
  return `${name}.data-${identity.sha256.slice('sha256:'.length)}-${identity.bytes}`;
}

function commitName(name: string): string {
  return `${name}.commit.json`;
}

function parseCommitRecord(value: string, cacheKey: string, name: string): CommitRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Partial<CommitRecord>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
      JSON.stringify(['bytes', 'cacheKey', 'dataFile', 'sha256', 'version']) ||
    record.version !== 1 ||
    record.cacheKey !== cacheKey ||
    typeof record.sha256 !== 'string' ||
    !SHA256.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    (record.bytes ?? 0) <= 0 ||
    record.dataFile !== generationName(name, record as CacheIdentity)
  ) {
    return null;
  }
  return record as CommitRecord;
}

async function browserOpfsRoot(): Promise<OpfsDirectoryPort> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof storage.getDirectory !== 'function') {
    throw new DOMException('Origin-private file storage is not supported.', 'NotSupportedError');
  }
  return (await storage.getDirectory()) as unknown as OpfsDirectoryPort;
}

function browserLocks(): OpfsLockManagerPort | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: OpfsLockManagerPort }).locks;
  return locks ?? null;
}

async function ignoreMissing(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

async function withFallbackLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
  const previous = FALLBACK_LOCKS.get(name) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => held);
  FALLBACK_LOCKS.set(name, current);
  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    if (FALLBACK_LOCKS.get(name) === current) FALLBACK_LOCKS.delete(name);
  }
}

async function verifyFile(file: OpfsFileSnapshotPort, identity: CacheIdentity): Promise<boolean> {
  if (file.size !== identity.bytes) return false;
  const digest = createSha256Digest();
  const reader = file.stream().getReader();
  let received = 0;
  let completed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
        break;
      }
      received += result.value.byteLength;
      if (received > identity.bytes) {
        await reader.cancel().catch(() => undefined);
        return false;
      }
      digest.update(result.value);
    }
    return received === identity.bytes && (await digest.digest()) === identity.sha256;
  } catch {
    await reader.cancel().catch(() => undefined);
    return false;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * Lazy OPFS storage with immutable content generations and an atomic commit
 * pointer. Construction is side-effect free; storage and Web Locks are touched
 * only by explicit asset operations after consent.
 */
export class OpfsAssetStore implements AssetStorePort {
  private readonly getRoot: () => Promise<OpfsDirectoryPort>;
  private readonly namespace: readonly string[];
  private readonly locks: OpfsLockManagerPort | null | undefined;

  constructor({
    getRoot = browserOpfsRoot,
    namespace = ['open-voice-playground', 'assets'],
    locks,
  }: OpfsAssetStoreOptions = {}) {
    if (namespace.length === 0 || namespace.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
      throw new Error('OPFS namespace segments must be safe lowercase path components.');
    }
    this.getRoot = getRoot;
    this.namespace = [...namespace];
    this.locks = locks;
  }

  async has(cacheKey: string, sha256: string, bytes: number): Promise<boolean> {
    const segments = splitSafeKey(cacheKey);
    const identity = { sha256, bytes };
    assertIdentity(identity);
    return await this.withCacheLock(cacheKey, async () => {
      let directory: OpfsDirectoryPort;
      let name: string;
      try {
        ({ directory, name } = await this.resolveParent(segments, false));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return false;
        throw error;
      }

      let commit: CommitRecord | null = null;
      try {
        const commitFile = await directory.getFileHandle(commitName(name));
        commit = parseCommitRecord(await (await commitFile.getFile()).text(), cacheKey, name);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
      if (commit === null) {
        await ignoreMissing(() => directory.removeEntry(commitName(name))).catch(() => undefined);
        await ignoreMissing(() => directory.removeEntry(generationName(name, identity))).catch(
          () => undefined,
        );
        return false;
      }
      if (commit.sha256 !== sha256 || commit.bytes !== bytes) {
        return false;
      }

      let valid = false;
      try {
        const data = await directory.getFileHandle(commit.dataFile);
        valid = await verifyFile(await data.getFile(), commit);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      }
      if (valid) return true;

      await ignoreMissing(() => directory.removeEntry(commitName(name))).catch(() => undefined);
      await ignoreMissing(() => directory.removeEntry(commit.dataFile)).catch(() => undefined);
      return false;
    });
  }

  async createTemporary(key: string): Promise<AssetTemporarySink> {
    const segments = splitSafeKey(key);
    const { directory, name } = await this.resolveParent(segments, true);
    let existed = true;
    let handle: OpfsFilePort;
    try {
      handle = await directory.getFileHandle(name);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      existed = false;
      handle = await directory.getFileHandle(name, { create: true });
    }

    let writable: OpfsWritablePort;
    try {
      writable = await handle.createWritable({ keepExistingData: false });
    } catch (error) {
      if (!existed) {
        try {
          await ignoreMissing(() => directory.removeEntry(name));
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Could not open or clean the newly-created OPFS temporary file.',
            { cause: cleanupError },
          );
        }
      }
      throw error;
    }
    let settled = false;

    return {
      async write(chunk) {
        if (settled) throw new DOMException('Temporary file is closed.', 'InvalidStateError');
        await writable.write(chunk);
      },
      async close() {
        if (settled) return;
        await writable.close();
        settled = true;
      },
      async abort() {
        if (settled) return;
        await writable.abort();
        settled = true;
      },
    };
  }

  async promote(temporaryKey: string, cacheKey: string, identity: CacheIdentity): Promise<void> {
    const temporarySegments = splitSafeKey(temporaryKey);
    const finalSegments = splitSafeKey(cacheKey);
    assertIdentity(identity);
    await this.withCacheLock(cacheKey, async () => {
      const temporary = await this.resolveParent(temporarySegments, false);
      const destination = await this.resolveParent(finalSegments, true);
      const temporaryHandle = await temporary.directory.getFileHandle(temporary.name);
      const dataFile = generationName(destination.name, identity);
      let generationCreated = false;
      let moved = false;

      try {
        let reusable = false;
        try {
          const existing = await destination.directory.getFileHandle(dataFile);
          reusable = await verifyFile(await existing.getFile(), identity);
          if (!reusable) await destination.directory.removeEntry(dataFile);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
        }

        if (!reusable) {
          generationCreated = true;
          if (
            temporary.directory === destination.directory &&
            typeof temporaryHandle.move === 'function'
          ) {
            await temporaryHandle.move(dataFile);
            moved = true;
          } else {
            await this.copyFile(temporaryHandle, destination.directory, dataFile);
          }
        }

        const staged = await destination.directory.getFileHandle(dataFile);
        if (!(await verifyFile(await staged.getFile(), identity))) {
          throw new Error('The staged OPFS generation failed exact content verification.');
        }

        const commit: CommitRecord = {
          version: 1,
          cacheKey,
          dataFile,
          sha256: identity.sha256,
          bytes: identity.bytes,
        };
        if (!moved) await ignoreMissing(() => temporary.directory.removeEntry(temporary.name));
        await this.writeCommit(destination.directory, destination.name, commit);
      } catch (error) {
        if (generationCreated) {
          try {
            await ignoreMissing(() => destination.directory.removeEntry(dataFile));
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              'OPFS promotion failed and its staging generation could not be cleaned.',
              { cause: cleanupError },
            );
          }
        }
        throw error;
      }
    });
  }

  async deleteTemporary(key: string): Promise<void> {
    const segments = splitSafeKey(key);
    try {
      const { directory, name } = await this.resolveParent(segments, false);
      await ignoreMissing(() => directory.removeEntry(name));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }

  private async withCacheLock<T>(cacheKey: string, callback: () => Promise<T>): Promise<T> {
    const name = `open-voice-opfs:${cacheKey}`;
    const locks = this.locks === undefined ? browserLocks() : this.locks;
    if (locks !== null) return await locks.request(name, { mode: 'exclusive' }, callback);
    return await withFallbackLock(name, callback);
  }

  private async resolveParent(
    segments: readonly string[],
    create: boolean,
  ): Promise<{ directory: OpfsDirectoryPort; name: string }> {
    let directory = await this.getRoot();
    for (const segment of this.namespace) {
      directory = await directory.getDirectoryHandle(segment, { create });
    }
    for (const segment of segments.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(segment, { create });
    }
    return { directory, name: segments.at(-1)! };
  }

  private async copyFile(
    sourceHandle: OpfsFilePort,
    destinationDirectory: OpfsDirectoryPort,
    destinationName: string,
  ): Promise<void> {
    const source = await sourceHandle.getFile();
    const destinationHandle = await destinationDirectory.getFileHandle(destinationName, {
      create: true,
    });
    let writable: OpfsWritablePort;
    try {
      writable = await destinationHandle.createWritable({ keepExistingData: false });
    } catch (error) {
      await ignoreMissing(() => destinationDirectory.removeEntry(destinationName)).catch(
        () => undefined,
      );
      throw error;
    }
    const reader = source.stream().getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        await writable.write(result.value);
      }
      await writable.close();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      try {
        await writable.abort();
      } catch (abortFailure) {
        throw new AggregateError(
          [error, abortFailure],
          'The OPFS generation write and its abort both failed.',
          { cause: abortFailure },
        );
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async writeCommit(
    directory: OpfsDirectoryPort,
    name: string,
    commit: CommitRecord,
  ): Promise<void> {
    const filename = commitName(name);
    let existed = true;
    let handle: OpfsFilePort;
    try {
      handle = await directory.getFileHandle(filename);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
      existed = false;
      handle = await directory.getFileHandle(filename, { create: true });
    }
    let writable: OpfsWritablePort;
    try {
      writable = await handle.createWritable({ keepExistingData: false });
    } catch (error) {
      if (!existed)
        await ignoreMissing(() => directory.removeEntry(filename)).catch(() => undefined);
      throw error;
    }
    try {
      await writable.write(new TextEncoder().encode(JSON.stringify(commit)));
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch (abortFailure) {
        throw new AggregateError(
          [error, abortFailure],
          'The OPFS commit write and its abort both failed.',
          { cause: abortFailure },
        );
      }
      throw error;
    }
  }
}
