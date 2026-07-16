import { webcrypto } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createSha256Digest } from './assets';

async function referenceSha256(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function streamedSha256(chunks: readonly Uint8Array[]): Promise<string> {
  const digest = createSha256Digest();
  for (const chunk of chunks) digest.update(chunk);
  return await digest.digest();
}

describe('incremental SHA-256', () => {
  it.each([
    [
      'empty input',
      new Uint8Array(),
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
    [
      'abc',
      new TextEncoder().encode('abc'),
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ],
    [
      'one million a characters',
      new Uint8Array(1_000_000).fill('a'.charCodeAt(0)),
      'sha256:cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    ],
  ])('matches the published %s vector', async (_name, bytes, expected) => {
    await expect(streamedSha256([bytes])).resolves.toBe(expected);
  });

  it.each([55, 56, 63, 64, 65])(
    'matches Web Crypto for every two-chunk split of a %i-byte boundary vector',
    async (length) => {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff);
      const expected = await referenceSha256(bytes);

      for (let split = 0; split <= length; split += 1) {
        await expect(streamedSha256([bytes.slice(0, split), bytes.slice(split)])).resolves.toBe(
          expected,
        );
      }
    },
  );

  it('matches Web Crypto under deterministic randomized chunking', async () => {
    let state = 0x5eed1234;
    const next = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    };
    const bytes = Uint8Array.from({ length: 8_193 }, () => next() & 0xff);
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < bytes.byteLength) {
      const size = Math.min((next() % 137) + 1, bytes.byteLength - offset);
      chunks.push(bytes.slice(offset, offset + size));
      offset += size;
    }

    await expect(streamedSha256(chunks)).resolves.toBe(await referenceSha256(bytes));
  });
});
