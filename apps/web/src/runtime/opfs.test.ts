import { describe, expect, it, vi } from 'vitest';

import {
  OpfsAssetStore,
  type OpfsDirectoryPort,
  type OpfsFilePort,
  type OpfsFileSnapshotPort,
  type OpfsWritablePort,
} from './opfs';

class MemoryFile {
  bytes = new Uint8Array();
}

class MemoryDirectory implements OpfsDirectoryPort {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let directory = this.directories.get(name);
    if (directory === undefined && options?.create) {
      directory = new MemoryDirectory();
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
    const handle: OpfsFilePort = {
      async createWritable(): Promise<OpfsWritablePort> {
        const chunks: Uint8Array[] = [];
        return {
          async write(chunk) {
            chunks.push(chunk.slice());
          },
          async close() {
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
      async move(newName: string) {
        files.set(newName, file!);
        files.delete(name);
      },
    };
    return handle;
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException('Missing', 'NotFoundError');
    }
  }
}

describe('lazy OPFS asset store', () => {
  it('does not touch navigator storage during construction', () => {
    const getRoot = vi.fn(async () => new MemoryDirectory());

    new OpfsAssetStore({ getRoot });

    expect(getRoot).not.toHaveBeenCalled();
  });

  it('streams a temporary file, promotes it with identity metadata, and verifies cache hits', async () => {
    const root = new MemoryDirectory();
    const getRoot = vi.fn(async () => root);
    const store = new OpfsAssetStore({ getRoot });
    const sink = await store.createTemporary('kokoro/model/model.partial-1');
    await sink.write(new Uint8Array([1, 2]));
    await sink.write(new Uint8Array([3, 4]));
    await sink.close();
    await store.promote('kokoro/model/model.partial-1', 'kokoro/model/model', {
      sha256: 'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
      bytes: 4,
    });

    await expect(
      store.has(
        'kokoro/model/model',
        'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        4,
      ),
    ).resolves.toBe(true);
    await expect(store.has('kokoro/model/model', 'sha256:wrong', 4)).resolves.toBe(false);
    await expect(
      store.has(
        'kokoro/model/model',
        'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        5,
      ),
    ).resolves.toBe(false);
    expect(getRoot).toHaveBeenCalled();
  });

  it('deletes partials and rejects traversal before storage access', async () => {
    const root = new MemoryDirectory();
    const getRoot = vi.fn(async () => root);
    const store = new OpfsAssetStore({ getRoot });
    const sink = await store.createTemporary('kitten/model/model.partial-1');
    await sink.write(new Uint8Array([1]));
    await sink.close();
    await store.deleteTemporary('kitten/model/model.partial-1');

    await expect(store.createTemporary('../escape/model')).rejects.toThrow(/safe/i);
    expect(getRoot).toHaveBeenCalledTimes(2);
  });
});
