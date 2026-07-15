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
