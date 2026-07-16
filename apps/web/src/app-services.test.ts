import { describe, expect, it, vi } from 'vitest';

import launchRaw from '../../../packages/catalog/data/launch-catalog.public.json?raw';
import { createLaunchServices } from './app-services';

describe('production launch services', () => {
  it('loads the external catalog explicitly and creates no worker or asset I/O', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(launchRaw, {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
    );
    const workerConstructor = vi.fn();
    vi.stubGlobal('Worker', workerConstructor);

    const services = await createLaunchServices(fetcher, '/launch-catalog.json');

    expect(services.catalog.kind).toBe('launch');
    expect(services.catalog.voices).toHaveLength(426);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(workerConstructor).not.toHaveBeenCalled();
    await expect(
      services.runtime.get('kokoro')!.checkCapability(
        services.catalog.voices.find(({ engineId }) => engineId === 'kokoro')!,
        'browser',
      ),
    ).resolves.toMatchObject({
      available: false,
      reason: 'runtime-verification-pending',
    });
    expect(workerConstructor).not.toHaveBeenCalled();
  });
});
