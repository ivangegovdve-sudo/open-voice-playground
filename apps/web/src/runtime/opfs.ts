import type { AssetStorePort, AssetTemporarySink } from './assets';

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

type OpfsAssetStoreOptions = {
  getRoot?: () => Promise<OpfsDirectoryPort>;
  namespace?: readonly string[];
};

type CacheIdentity = { sha256: string; bytes: number };

const SAFE_PATH_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

function splitSafeKey(key: string): string[] {
  const segments = key.split('/');
  if (segments.length < 2 || segments.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
    throw new Error(`Expected a safe namespaced OPFS cache key, received ${JSON.stringify(key)}.`);
  }
  return segments;
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

async function ignoreMissing(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

/**
 * A lazy Origin Private File System adapter. Merely constructing the store does
 * not touch navigator.storage; the root is requested only by an explicit store
 * operation after consent has already been validated by AssetPreparationManager.
 */
export class OpfsAssetStore implements AssetStorePort {
  private readonly getRoot: () => Promise<OpfsDirectoryPort>;
  private readonly namespace: readonly string[];

  constructor({
    getRoot = browserOpfsRoot,
    namespace = ['open-voice-playground', 'assets'],
  }: OpfsAssetStoreOptions = {}) {
    if (namespace.length === 0 || namespace.some((segment) => !SAFE_PATH_SEGMENT.test(segment))) {
      throw new Error('OPFS namespace segments must be safe lowercase path components.');
    }
    this.getRoot = getRoot;
    this.namespace = [...namespace];
  }

  async has(cacheKey: string, sha256: string, bytes: number): Promise<boolean> {
    const segments = splitSafeKey(cacheKey);
    try {
      const { directory, name } = await this.resolveParent(segments, false);
      const [assetFile, metadataFile] = await Promise.all([
        directory.getFileHandle(name).then((handle) => handle.getFile()),
        directory.getFileHandle(`${name}.meta.json`).then((handle) => handle.getFile()),
      ]);
      if (assetFile.size !== bytes) return false;
      const parsed = JSON.parse(await metadataFile.text()) as Partial<CacheIdentity>;
      return parsed.sha256 === sha256 && parsed.bytes === bytes;
    } catch (error) {
      if (
        (error instanceof DOMException && error.name === 'NotFoundError') ||
        error instanceof SyntaxError
      ) {
        return false;
      }
      throw error;
    }
  }

  async createTemporary(key: string): Promise<AssetTemporarySink> {
    const segments = splitSafeKey(key);
    const { directory, name } = await this.resolveParent(segments, true);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    let settled = false;

    return {
      async write(chunk) {
        if (settled) throw new DOMException('Temporary file is closed.', 'InvalidStateError');
        await writable.write(chunk);
      },
      async close() {
        if (settled) return;
        settled = true;
        await writable.close();
      },
      async abort() {
        if (settled) return;
        settled = true;
        await writable.abort();
      },
    };
  }

  async promote(temporaryKey: string, cacheKey: string, identity: CacheIdentity): Promise<void> {
    const temporarySegments = splitSafeKey(temporaryKey);
    const finalSegments = splitSafeKey(cacheKey);
    const temporary = await this.resolveParent(temporarySegments, false);
    const destination = await this.resolveParent(finalSegments, true);
    const temporaryHandle = await temporary.directory.getFileHandle(temporary.name);
    const sameDirectory = temporary.directory === destination.directory;
    let moved = false;

    try {
      if (sameDirectory && typeof temporaryHandle.move === 'function') {
        await temporaryHandle.move(destination.name);
        moved = true;
      } else {
        await this.copyFile(temporaryHandle, destination.directory, destination.name);
      }
      await this.writeMetadata(destination.directory, destination.name, identity);
      if (!moved) {
        await ignoreMissing(() => temporary.directory.removeEntry(temporary.name));
      }
    } catch (error) {
      await ignoreMissing(() => destination.directory.removeEntry(destination.name));
      await ignoreMissing(() => destination.directory.removeEntry(`${destination.name}.meta.json`));
      throw error;
    }
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
    const writable = await destinationHandle.createWritable({ keepExistingData: false });
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
      await writable.abort().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async writeMetadata(
    directory: OpfsDirectoryPort,
    name: string,
    identity: CacheIdentity,
  ): Promise<void> {
    const handle = await directory.getFileHandle(`${name}.meta.json`, { create: true });
    const writable = await handle.createWritable({ keepExistingData: false });
    try {
      await writable.write(new TextEncoder().encode(JSON.stringify(identity)));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }
}
