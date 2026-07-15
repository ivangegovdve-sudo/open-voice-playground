import { expect, test, type Page } from '@playwright/test';

async function waitForFirstController(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const controlled = new Promise<void>((resolve) => {
      if (navigator.serviceWorker.controller !== null) {
        resolve();
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
    await navigator.serviceWorker.ready;
    await controlled;
  });
}

async function replaceCachedShell(page: Page, body: string): Promise<void> {
  await page.evaluate(async (replacementBody) => {
    const cacheName = (await window.caches.keys()).find((name) =>
      name.startsWith('open-voice-shell-'),
    );
    if (cacheName === undefined) {
      throw new Error('The application shell cache is missing.');
    }
    const cache = await window.caches.open(cacheName);
    await cache.put(
      '/index.html',
      new Response(replacementBody, { headers: { 'content-type': 'text/html' } }),
    );
  }, body);
}

async function readCachedShell(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const cacheName = (await window.caches.keys()).find((name) =>
      name.startsWith('open-voice-shell-'),
    );
    if (cacheName === undefined) {
      throw new Error('The application shell cache is missing.');
    }
    const response = await (await window.caches.open(cacheName)).match('/index.html');
    if (response === undefined) {
      throw new Error('The cached application shell is missing.');
    }
    return response.text();
  });
}

async function readShellCacheVersion(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const prefix = 'open-voice-shell-';
    const cacheName = (await window.caches.keys()).find((name) => name.startsWith(prefix));
    const version = cacheName?.slice(prefix.length);
    if (version === undefined || !/^[a-f0-9]{12}$/.test(version)) {
      throw new Error('The versioned application shell cache is missing.');
    }
    return version;
  });
}

async function waitForInstallingWorkerTerminalState(page: Page): Promise<string> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.installing?.state ?? null;
        }),
      { timeout: 7_000 },
    )
    .toBe('installing');

  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.installing;
    if (worker === undefined || worker === null) {
      throw new Error('The installing service worker disappeared before observation.');
    }
    if (worker.state === 'activated' || worker.state === 'redundant') {
      return worker.state;
    }
    return new Promise<string>((resolve) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          resolve(worker.state);
        }
      });
    });
  });
}

test('first install rejects HTML that is not the exact built shell', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'open_voice_install_fixture',
      value: 'arbitrary-html',
      url: 'http://127.0.0.1:4174',
    },
  ]);

  await page.goto('/');

  expect(await waitForInstallingWorkerTerminalState(page)).toBe('redundant');
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(false);
  expect(
    (await page.evaluate(() => window.caches.keys())).filter((name) =>
      name.startsWith('open-voice-shell-'),
    ),
  ).toEqual([]);
});

test('first service-worker activation preserves the application shell offline', async ({
  context,
  page,
  request,
}) => {
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    name: 'Open Voice Playground',
    start_url: '/',
    display: 'standalone',
  });

  await page.goto('/');
  await waitForFirstController(page);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
  await page.goto('/voices');
  await expect(page.getByRole('heading', { level: 1, name: 'Voice atlas' })).toBeVisible();
});

test('activation removes stale shell caches but preserves unrelated origin caches', async ({
  page,
}) => {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async () => {
    await Promise.all([
      window.caches.open('open-voice-shell-stale'),
      window.caches.open('unrelated-feature-cache'),
    ]);
  });

  await page.goto('/');
  await waitForFirstController(page);

  const cacheNames = await page.evaluate(() => window.caches.keys());
  expect(cacheNames).not.toContain('open-voice-shell-stale');
  expect(cacheNames).toContain('unrelated-feature-cache');
});

test('a rejected upgrade preserves the active trusted shell cache', async ({ context, page }) => {
  await page.goto('/');
  await waitForFirstController(page);
  const originalCacheNames = (await page.evaluate(() => window.caches.keys())).filter((name) =>
    name.startsWith('open-voice-shell-'),
  );
  expect(originalCacheNames).toHaveLength(1);

  const terminalState = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw-upgrade.js', { scope: '/' });
    const worker = registration.installing ?? registration.waiting;
    if (worker === null) {
      throw new Error('The upgrade worker was not created.');
    }
    if (worker.state === 'activated' || worker.state === 'redundant') {
      return worker.state;
    }
    return new Promise<string>((resolve) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          resolve(worker.state);
        }
      });
    });
  });

  expect(terminalState).toBe('redundant');
  expect(
    (await page.evaluate(() => window.caches.keys())).filter((name) =>
      name.startsWith('open-voice-shell-'),
    ),
  ).toEqual(originalCacheNames);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
});

test('non-app routes cannot refresh the cached application shell', async ({ page }) => {
  await page.goto('/');
  await waitForFirstController(page);

  for (const path of ['/login', '/docs']) {
    const sentinel = `trusted shell before ${path}`;
    await replaceCachedShell(page, sentinel);
    await page.goto(path);
    expect(await readCachedShell(page)).toBe(sentinel);
  }
});

test('an allowlisted SPA route can refresh the cached application shell', async ({ page }) => {
  await page.goto('/');
  await waitForFirstController(page);
  const trustedShell = await readCachedShell(page);
  await replaceCachedShell(page, 'stale shell');

  await page.goto('/voices');

  const refreshedShell = await readCachedShell(page);
  expect(refreshedShell).toBe(trustedShell);
  expect(refreshedShell).toContain('<title>Open Voice Playground</title>');
  expect(refreshedShell).not.toContain('open-voice-shell');
});

for (const [fixture, location] of [
  ['comment-fake-head', 'an HTML comment'],
  ['raw-text-fake-head', 'raw-text content'],
  ['quoted-attribute-fake-head', 'a quoted attribute'],
] as const) {
  test(`a former shell marker inside ${location} cannot spoof the built shell bytes`, async ({
    page,
  }) => {
    await page.goto('/');
    await waitForFirstController(page);
    const formerIdentity = await readShellCacheVersion(page);
    const sentinel = `trusted shell before ${fixture}`;
    await replaceCachedShell(page, sentinel);

    const response = await page.goto(
      `/voices?__pwa_fixture=${fixture}&__pwa_identity=${formerIdentity}`,
    );

    expect(response?.status()).toBe(200);
    expect(await readCachedShell(page)).toBe(sentinel);
  });
}

test('a one-byte near-match cannot replace the exact built shell', async ({ page }) => {
  await page.goto('/');
  await waitForFirstController(page);
  const sentinel = 'trusted shell before one-byte near-match';
  await replaceCachedShell(page, sentinel);

  const response = await page.goto('/voices?__pwa_fixture=near-matching-shell');

  expect(response?.status()).toBe(200);
  expect(await readCachedShell(page)).toBe(sentinel);
});

for (const [fixture, elementName] of [
  ['title-identity', 'title'],
  ['textarea-identity', 'textarea'],
  ['template-identity', 'template'],
] as const) {
  test(`a shell marker nested in ${elementName} cannot refresh the offline fallback`, async ({
    page,
  }) => {
    await page.goto('/');
    await waitForFirstController(page);
    const formerIdentity = await readShellCacheVersion(page);
    const sentinel = `trusted shell before nested ${elementName}`;
    await replaceCachedShell(page, sentinel);

    const response = await page.goto(
      `/voices?__pwa_fixture=${fixture}&__pwa_identity=${formerIdentity}`,
    );

    expect(response?.status()).toBe(200);
    expect(await readCachedShell(page)).toBe(sentinel);
  });
}

test('marker text after a quoted head boundary cannot refresh the offline fallback', async ({
  page,
}) => {
  await page.goto('/');
  await waitForFirstController(page);
  const formerIdentity = await readShellCacheVersion(page);
  const sentinel = 'trusted shell before quoted head boundary';
  await replaceCachedShell(page, sentinel);

  const response = await page.goto(
    `/voices?__pwa_fixture=quoted-head-identity&__pwa_identity=${formerIdentity}`,
  );

  expect(response?.status()).toBe(200);
  expect(await readCachedShell(page)).toBe(sentinel);
});

test('allowlisted routes require exact built shell bytes before refreshing fallback', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await waitForFirstController(page);
  const trustedShell = await readCachedShell(page);
  const formerIdentity = await readShellCacheVersion(page);
  const wrongIdentity = formerIdentity === '000000000000' ? '111111111111' : '000000000000';

  const paths = [
    '/voices?__pwa_fixture=arbitrary-html',
    '/play?__pwa_fixture=error-html',
    `/voices?__pwa_fixture=wrong-identity&__pwa_identity=${wrongIdentity}`,
    `/voices?__pwa_fixture=comment-identity&__pwa_identity=${formerIdentity}`,
    `/voices?__pwa_fixture=duplicate-identity&__pwa_identity=${formerIdentity}`,
    `/voices?__pwa_fixture=malformed-identity&__pwa_identity=${formerIdentity}`,
    `/play?__pwa_fixture=body-identity&__pwa_identity=${formerIdentity}`,
    '/voices?__pwa_fixture=redirect-login',
  ];
  for (const path of paths) {
    const sentinel = `trusted shell before ${path}`;
    await replaceCachedShell(page, sentinel);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(await readCachedShell(page)).toBe(sentinel);
  }

  await replaceCachedShell(page, trustedShell);
  await context.setOffline(true);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
});

test('runtime cache excludes API, audio, and model responses', async ({ page }) => {
  const nonStaticPaths = [
    '/api/pwa-cache-probe',
    '/audio/pwa-cache-probe.mp3',
    '/models/pwa-cache-probe.bin',
  ];

  await page.goto('/');
  await waitForFirstController(page);
  const responsesWereAvailable = await page.evaluate(
    async (paths) => Promise.all(paths.map(async (path) => (await fetch(path)).ok)),
    nonStaticPaths,
  );
  expect(responsesWereAvailable).toEqual([true, true, true]);

  const cachedNonStaticPaths = await page.evaluate(async (paths) => {
    const cachedRequests = (
      await Promise.all(
        (await window.caches.keys()).map(async (name) => (await window.caches.open(name)).keys()),
      )
    ).flat();
    return paths.filter((path) =>
      cachedRequests.some((request) => new URL(request.url).pathname === path),
    );
  }, nonStaticPaths);
  expect(cachedNonStaticPaths).toEqual([]);
});

test('non-HTML navigation cannot replace the cached offline shell', async ({ context, page }) => {
  await page.goto('/');
  await waitForFirstController(page);
  await page.goto('/manifest.webmanifest');

  await context.setOffline(true);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
});
