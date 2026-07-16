import { describe, expect, it, vi } from 'vitest';

import {
  OpfsAssetStore,
  type OpfsDirectoryPort,
  type OpfsFilePort,
  type OpfsFileSnapshotPort,
  type OpfsWritablePort,
} from './opfs';

const IDENTITY_A = {
  sha256: 'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
  bytes: 4,
};
const IDENTITY_B = {
  sha256: 'sha256:55e5509f8052998294266ee5b50cb592938191fb5d67f73cac2e60b0276b1bdd',
  bytes: 4,
};

type FailureKind = 'createWritable' | 'write' | 'close' | 'abort' | 'move' | 'remove';

class Faults {
  readonly failures = new Map<FailureKind, (path: string) => boolean>();

  shouldFail(kind: FailureKind, path: string): boolean {
    return this.failures.get(kind)?.(path) ?? false;
  }
}

class MemoryFile {
  bytes = new Uint8Array();
}

class MemoryDirectory implements OpfsDirectoryPort {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  constructor(
    private readonly faults = new Faults(),
    private readonly path = '',
    private readonly supportMove = true,
  ) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let directory = this.directories.get(name);
    if (directory === undefined && options?.create) {
      directory = new MemoryDirectory(this.faults, `${this.path}/${name}`, this.supportMove);
      this.directories.set(name, directory);
    }
    if (directory === undefined) throw new DOMException('Missing', 'NotFoundError');
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFilePort> {
    let file = this.files.get(name);
    if (file === undefined && options?.create) {
      file = new MemoryFile();
      this.files.set(name, file);
    }
    if (file === undefined) throw new DOMException('Missing', 'NotFoundError');
    const files = this.files;
    const path = `${this.path}/${name}`;
    const faults = this.faults;
    const handle: OpfsFilePort = {
      async createWritable(): Promise<OpfsWritablePort> {
        if (faults.shouldFail('createWritable', path)) {
          throw new DOMException('Quota exhausted', 'QuotaExceededError');
        }
        const chunks: Uint8Array[] = [];
        return {
          async write(chunk) {
            if (faults.shouldFail('write', path)) throw new Error(`write failed: ${path}`);
            chunks.push(chunk.slice());
          },
          async close() {
            if (faults.shouldFail('close', path)) throw new Error(`close failed: ${path}`);
            const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
            const merged = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.byteLength;
            }
            file!.bytes = merged;
          },
          async abort() {
            if (faults.shouldFail('abort', path)) throw new Error(`abort failed: ${path}`);
            chunks.length = 0;
          },
        };
      },
      async getFile(): Promise<OpfsFileSnapshotPort> {
        return {
          size: file!.bytes.byteLength,
          async text() {
            return new TextDecoder().decode(file!.bytes);
          },
          stream() {
            const bytes = file!.bytes.slice();
            return new ReadableStream({
              start(controller) {
                controller.enqueue(bytes);
                controller.close();
              },
            });
          },
        };
      },
      ...(this.supportMove
        ? {
            async move(newName: string) {
              if (faults.shouldFail('move', path)) throw new Error(`move failed: ${path}`);
              files.set(newName, file!);
              files.delete(name);
            },
          }
        : {}),
    };
    return handle;
  }

  async removeEntry(name: string) {
    const path = `${this.path}/${name}`;
    if (this.faults.shouldFail('remove', path)) throw new Error(`remove failed: ${path}`);
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException('Missing', 'NotFoundError');
    }
  }
}

function assetDirectory(root: MemoryDirectory): MemoryDirectory {
  return root.directories
    .get('open-voice-playground')!
    .directories.get('assets')!
    .directories.get('kokoro')!
    .directories.get('model')!;
}

function committedData(directory: MemoryDirectory): [string, MemoryFile] {
  const entry = [...directory.files].find(
    ([name]) => !name.includes('.partial-') && !name.endsWith('.json'),
  );
  if (entry === undefined) throw new Error('Committed data file is missing.');
  return entry;
}

function commitRecord(directory: MemoryDirectory): [string, MemoryFile] {
  const entry = [...directory.files].find(
    ([name]) => name.endsWith('.commit.json') || name.endsWith('.meta.json'),
  );
  if (entry === undefined) throw new Error('Commit record is missing.');
  return entry;
}

async function writeTemporary(
  store: OpfsAssetStore,
  name: string,
  bytes: readonly number[],
): Promise<void> {
  const sink = await store.createTemporary(`kokoro/model/${name}`);
  await sink.write(new Uint8Array(bytes));
  await sink.close();
}

async function promote(
  store: OpfsAssetStore,
  temporary: string,
  identity = IDENTITY_A,
): Promise<void> {
  await store.promote(`kokoro/model/${temporary}`, 'kokoro/model/model', identity);
}

describe('lazy content-addressed OPFS asset store', () => {
  it('does not touch navigator storage during construction', () => {
    const getRoot = vi.fn(async () => new MemoryDirectory());

    new OpfsAssetStore({ getRoot });

    expect(getRoot).not.toHaveBeenCalled();
  });

  it('streams committed bytes through SHA-256 and removes equal-size corruption', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-1', [1, 2, 3, 4]);
    await promote(store, 'model.partial-1');
    const directory = assetDirectory(root);
    const [, data] = committedData(directory);
    data.bytes = new Uint8Array([9, 9, 9, 9]);

    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(false);
    expect(directory.files.size).toBe(0);
  });

  it('returns a fresh exact transferable buffer only for a verified committed identity', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-1', [1, 2, 3, 4]);
    await promote(store, 'model.partial-1');

    const first = await (
      store as OpfsAssetStore & {
        readVerified(cacheKey: string, sha256: string, bytes: number): Promise<ArrayBuffer | null>;
      }
    ).readVerified('kokoro/model/model', IDENTITY_A.sha256, IDENTITY_A.bytes);
    expect(first).toBeInstanceOf(ArrayBuffer);
    expect(first).toHaveProperty('byteLength', 4);
    expect(new Uint8Array(first!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    new Uint8Array(first!)[0] = 99;

    const second = await (
      store as OpfsAssetStore & {
        readVerified(cacheKey: string, sha256: string, bytes: number): Promise<ArrayBuffer | null>;
      }
    ).readVerified('kokoro/model/model', IDENTITY_A.sha256, IDENTITY_A.bytes);
    expect(second).not.toBe(first);
    expect(new Uint8Array(second!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(
      (
        store as OpfsAssetStore & {
          readVerified(
            cacheKey: string,
            sha256: string,
            bytes: number,
          ): Promise<ArrayBuffer | null>;
        }
      ).readVerified('kokoro/model/model', IDENTITY_B.sha256, IDENTITY_B.bytes),
    ).resolves.toBeNull();
  });

  it.each([
    [
      'missing committed data',
      (directory: MemoryDirectory) => directory.files.delete(committedData(directory)[0]),
    ],
    [
      'equal-size corrupt committed data',
      (directory: MemoryDirectory) => {
        committedData(directory)[1].bytes = new Uint8Array([8, 8, 8, 8]);
      },
    ],
    [
      'malformed commit metadata',
      (directory: MemoryDirectory) => {
        commitRecord(directory)[1].bytes = new TextEncoder().encode('{bad');
      },
    ],
  ])('returns no bytes and cleans %s during a verified read', async (_label, corrupt) => {
    const root = new MemoryDirectory();
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-1', [1, 2, 3, 4]);
    await promote(store, 'model.partial-1');
    const directory = assetDirectory(root);
    corrupt(directory);

    await expect(
      (
        store as OpfsAssetStore & {
          readVerified(
            cacheKey: string,
            sha256: string,
            bytes: number,
          ): Promise<ArrayBuffer | null>;
        }
      ).readVerified('kokoro/model/model', IDENTITY_A.sha256, IDENTITY_A.bytes),
    ).resolves.toBeNull();
    expect([...directory.files.keys()].some((name) => name.includes('model'))).toBe(false);
  });

  it.each([
    [
      'truncated data',
      (directory: MemoryDirectory) =>
        (committedData(directory)[1].bytes = new Uint8Array([1, 2, 3])),
    ],
    [
      'malformed commit metadata',
      (directory: MemoryDirectory) =>
        (commitRecord(directory)[1].bytes = new TextEncoder().encode('{bad')),
    ],
  ])('rejects and safely cleans %s', async (_label, corrupt) => {
    const root = new MemoryDirectory();
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-1', [1, 2, 3, 4]);
    await promote(store, 'model.partial-1');
    const directory = assetDirectory(root);
    corrupt(directory);

    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(false);
    expect([...directory.files.keys()].some((name) => name.includes('model'))).toBe(false);
  });

  it('removes a newly-created temporary file when createWritable fails', async () => {
    const faults = new Faults();
    faults.failures.set('createWritable', (path) => path.endsWith('/model.partial-quota'));
    const root = new MemoryDirectory(faults);
    const store = new OpfsAssetStore({ getRoot: async () => root });

    await expect(store.createTemporary('kokoro/model/model.partial-quota')).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(assetDirectory(root).files.has('model.partial-quota')).toBe(false);
  });

  it('preserves a pre-existing temporary file when createWritable fails', async () => {
    const faults = new Faults();
    const root = new MemoryDirectory(faults);
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-existing', [1, 2, 3, 4]);
    faults.failures.set('createWritable', (path) => path.endsWith('/model.partial-existing'));

    await expect(store.createTemporary('kokoro/model/model.partial-existing')).rejects.toThrow();
    expect(assetDirectory(root).files.get('model.partial-existing')?.bytes).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it.each(['write', 'close', 'metadata-write', 'metadata-close', 'move'] as const)(
    'keeps the prior verified generation readable after a %s failure',
    async (failure) => {
      const faults = new Faults();
      const root = new MemoryDirectory(faults, '', failure === 'move');
      const store = new OpfsAssetStore({ getRoot: async () => root });
      await writeTemporary(store, 'model.partial-a', [1, 2, 3, 4]);
      await promote(store, 'model.partial-a');
      await writeTemporary(store, 'model.partial-b', [5, 6, 7, 8]);
      const dataPath = (path: string) =>
        !path.includes('.partial-') &&
        !path.endsWith('.json') &&
        (path.endsWith('/model') || path.includes('/model.data-'));
      const metadataPath = (path: string) =>
        path.endsWith('/model.meta.json') || path.endsWith('/model.commit.json');
      if (failure === 'write') faults.failures.set('write', dataPath);
      if (failure === 'close') faults.failures.set('close', dataPath);
      if (failure === 'metadata-write') faults.failures.set('write', metadataPath);
      if (failure === 'metadata-close') faults.failures.set('close', metadataPath);
      if (failure === 'move') {
        faults.failures.set('move', (path) => path.endsWith('/model.partial-b'));
      }

      await expect(promote(store, 'model.partial-b', IDENTITY_B)).rejects.toThrow();
      faults.failures.clear();
      await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(true);
      await expect(store.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(false);
    },
  );

  it('preserves abort failure evidence while keeping the prior commit readable', async () => {
    const faults = new Faults();
    const root = new MemoryDirectory(faults, '', false);
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-a', [1, 2, 3, 4]);
    await promote(store, 'model.partial-a');
    await writeTemporary(store, 'model.partial-b', [5, 6, 7, 8]);
    const stagedDataPath = (path: string) =>
      !path.includes('.partial-') && !path.endsWith('.json') && path.includes('/model.data-');
    faults.failures.set('write', stagedDataPath);
    faults.failures.set('abort', stagedDataPath);

    await expect(promote(store, 'model.partial-b', IDENTITY_B)).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: expect.stringContaining('write failed') }),
        expect.objectContaining({ message: expect.stringContaining('abort failed') }),
      ],
    });
    faults.failures.clear();

    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(true);
    await expect(store.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(false);
  });

  it('leaves the prior commit readable even when failed-generation cleanup also fails', async () => {
    const faults = new Faults();
    const root = new MemoryDirectory(faults, '', false);
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-a', [1, 2, 3, 4]);
    await promote(store, 'model.partial-a');
    await writeTemporary(store, 'model.partial-b', [5, 6, 7, 8]);
    faults.failures.set(
      'close',
      (path) => path.endsWith('/model.commit.json') || path.endsWith('/model.meta.json'),
    );
    faults.failures.set(
      'remove',
      (path) =>
        !path.endsWith('.json') && (path.endsWith('/model') || path.includes('/model.data-')),
    );

    await expect(promote(store, 'model.partial-b', IDENTITY_B)).rejects.toThrow();
    faults.failures.clear();
    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(true);
  });

  it('keeps the prior commit readable when temporary cleanup fails before commit', async () => {
    const faults = new Faults();
    const root = new MemoryDirectory(faults, '', false);
    const store = new OpfsAssetStore({ getRoot: async () => root });
    await writeTemporary(store, 'model.partial-a', [1, 2, 3, 4]);
    await promote(store, 'model.partial-a');
    await writeTemporary(store, 'model.partial-b', [5, 6, 7, 8]);
    faults.failures.set('remove', (path) => path.endsWith('/model.partial-b'));

    await expect(promote(store, 'model.partial-b', IDENTITY_B)).rejects.toThrow();
    faults.failures.clear();
    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(true);
    await expect(store.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(false);
  });

  it('serializes verification and concurrent promotions with the same injected lock name', async () => {
    const root = new MemoryDirectory();
    const calls: string[] = [];
    let tail = Promise.resolve();
    const locks = {
      request<T>(name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) {
        calls.push(name);
        const result = tail.then(callback, callback);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const store = new OpfsAssetStore({ getRoot: async () => root, locks } as never);
    await writeTemporary(store, 'model.partial-a', [1, 2, 3, 4]);
    await writeTemporary(store, 'model.partial-b', [5, 6, 7, 8]);

    await Promise.all([
      promote(store, 'model.partial-a', IDENTITY_A),
      promote(store, 'model.partial-b', IDENTITY_B),
    ]);

    await expect(store.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(true);
    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(false);
    expect(new Set(calls)).toEqual(new Set(['open-voice-opfs:kokoro/model/model']));
    expect(calls).toHaveLength(4);
  });

  it('serializes concurrent store instances with the process-wide fallback lock', async () => {
    const root = new MemoryDirectory();
    const first = new OpfsAssetStore({ getRoot: async () => root, locks: null });
    const second = new OpfsAssetStore({ getRoot: async () => root, locks: null });
    await writeTemporary(first, 'model.partial-a', [1, 2, 3, 4]);
    await writeTemporary(second, 'model.partial-b', [5, 6, 7, 8]);

    await Promise.all([
      promote(first, 'model.partial-a', IDENTITY_A),
      promote(second, 'model.partial-b', IDENTITY_B),
    ]);

    await expect(first.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(false);
    await expect(second.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(true);
  });

  it('queues a newer promotion behind a delayed stale completion without cross-wiring it', async () => {
    const root = new MemoryDirectory();
    let releaseOlder!: () => void;
    const olderReleased = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    let markOlderEntered!: () => void;
    const olderEntered = new Promise<void>((resolve) => {
      markOlderEntered = resolve;
    });
    let requestIndex = 0;
    let tail = Promise.resolve();
    const locks = {
      request<T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) {
        const index = requestIndex++;
        const result = tail.then(async () => {
          if (index === 0) {
            markOlderEntered();
            await olderReleased;
          }
          return await callback();
        });
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const store = new OpfsAssetStore({ getRoot: async () => root, locks } as never);
    await writeTemporary(store, 'model.partial-older', [1, 2, 3, 4]);
    await writeTemporary(store, 'model.partial-newer', [5, 6, 7, 8]);

    const olderPromotion = promote(store, 'model.partial-older', IDENTITY_A);
    await olderEntered;
    let newerSettled = false;
    const newerPromotion = promote(store, 'model.partial-newer', IDENTITY_B).finally(() => {
      newerSettled = true;
    });
    await Promise.resolve();
    expect(newerSettled).toBe(false);

    releaseOlder();
    await Promise.all([olderPromotion, newerPromotion]);
    await expect(store.has('kokoro/model/model', IDENTITY_A.sha256, 4)).resolves.toBe(false);
    await expect(store.has('kokoro/model/model', IDENTITY_B.sha256, 4)).resolves.toBe(true);
  });

  it('aborts temporary writes without committing staged bytes and deletes explicit partials', async () => {
    const root = new MemoryDirectory();
    const store = new OpfsAssetStore({ getRoot: async () => root });
    const sink = await store.createTemporary('kokoro/model/model.partial-abort');
    await sink.write(new Uint8Array([1, 2, 3, 4]));
    await sink.abort();
    await store.deleteTemporary('kokoro/model/model.partial-abort');

    expect(assetDirectory(root).files.has('model.partial-abort')).toBe(false);
    await expect(store.createTemporary('../escape/model')).rejects.toThrow(/safe/i);
  });
});
