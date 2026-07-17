import { expect, test } from '@playwright/test';

test('boots from the external reviewed launch catalog and reports honest counts', async ({
  page,
}) => {
  const catalogResponse = page.waitForResponse((response) =>
    /\/assets\/launch-catalog\.public-[A-Za-z0-9_-]+\.json$/.test(new URL(response.url()).pathname),
  );

  await page.goto('/');

  const response = await catalogResponse;
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('application/json');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
  await expect(page.getByText(/426 source-backed preset voices/i)).toBeVisible();
  await expect(page.getByText(/92 are evidence-cleared/i)).toBeVisible();
  await expect(page.getByText(/0 are operational in this build/i)).toBeVisible();
  await expect(
    page.getByText(/Reviewed launch catalog.*0 operational synthesis runtimes/i),
  ).toBeVisible();
  await expect(page.getByText(/synthetic fixture|not the final public launch/i)).toHaveCount(0);
});

test('filters runtime presets and catalog-only coverage without widening Edge or Piper availability', async ({
  page,
}) => {
  await page.goto('/voices');
  await expect(page.getByText('738 catalog entries', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Runs in browser' }).click();
  await expect(page).toHaveURL(/mode=browser/);
  await expect(page.getByText('84 catalog entries')).toBeVisible();

  await page.goto('/voices?engine=piper');
  await expect(page.getByRole('checkbox', { name: 'Piper via sherpa-onnx' })).toBeChecked();
  await expect(page.getByText('12 catalog entries')).toBeVisible();
  await expect(page.getByText('Catalog unavailable').first()).toBeVisible();
  await expect(page.getByText(/Unavailable.*asset unavailable/i).first()).toBeVisible();
  await expect(
    page.getByText(/GitHub serves the archives without cross-origin browser access/i).first(),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Use voice/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Add to compare/i })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Voice license piper-voice-license' }).first(),
  ).toHaveAttribute('href', '/about/sources#piper-voice-license');

  await page.goto('/voices?engine=edge&q=Ava');
  await expect(page.getByText(/Unavailable.*terms not cleared/i).first()).toBeVisible();
  await expect(
    page.getByText(/unsupported consumer-service path is not called/i).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Voice source edge-voices-snapshot' }).first(),
  ).toHaveAttribute('href', '/about/sources#edge-voices-snapshot');
});

test('renders German Pocket coverage as link-only metadata without remote requests', async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (/(?:^|\.)(?:kyutai\.org|huggingface\.co)$/i.test(new URL(request.url()).hostname)) {
      remoteRequests.push(request.url());
    }
  });

  await page.goto('/voices?mode=catalog-only&engine=pocket&lang=German');
  await expect(page.getByText('52 catalog entries')).toBeVisible();
  const albaRows = page.getByRole('article', {
    name: /Catalog-only Pocket variant alba · German · german(?:_24l)?$/,
  });
  await expect(albaRows).toHaveCount(2);
  const first = albaRows.first();
  await expect(first.getByText('Country: Unspecified (not source-published)')).toBeVisible();
  await expect(first.getByText('Gender: Unspecified (not source-published)')).toBeVisible();
  await expect(first.getByText('Catalog only · no generation')).toBeVisible();
  await expect(first.getByRole('button')).toHaveCount(0);
  await expect(first.locator('audio, input[type="file"]')).toHaveCount(0);
  await expect(
    first.getByRole('link', { name: /Open official Pocket TTS live demo/i }),
  ).toHaveAttribute('href', 'https://kyutai.org/tts');
  await expect(
    first.getByRole('link', {
      name: 'Official demo source pocket-official-live-demo-source',
    }),
  ).toHaveAttribute('href', '/about/sources#pocket-official-live-demo-source');
  expect(remoteRequests).toEqual([]);
});

test('keeps filter focus when a focused virtual Pocket row scrolls out of the DOM', async ({
  page,
}) => {
  await page.goto('/voices?mode=catalog-only&engine=pocket');
  await expect(page.getByText('312 catalog entries')).toBeVisible();

  const firstDemoLink = page.getByRole('link', {
    name: 'Open official Pocket TTS live demo for alba · english',
    exact: true,
  });
  await firstDemoLink.focus();
  await expect(firstDemoLink).toBeFocused();

  const viewport = page.locator('.voice-list-viewport');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(firstDemoLink).toHaveCount(0);

  const germanFilter = page.locator('#desktop-lang-German');
  await germanFilter.click();
  await expect(page.getByText('52 catalog entries')).toBeVisible();
  await expect(germanFilter).toBeFocused();
});

test('keeps play and comparison locked until a concrete adapter is verified', async ({ page }) => {
  await page.goto('/voices?engine=kokoro&q=Heart');
  await expect(page.getByText('1 catalog entry')).toBeVisible();
  await page.getByRole('link', { name: /Inspect preset/i }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Make a line speak' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate speech' })).toBeDisabled();
  await expect(
    page.getByText('Runtime verification is pending; no model download or Worker was started.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download WAV' })).toBeDisabled();

  await page.getByRole('link', { name: 'Compare' }).click();
  await expect(page.getByText(/No launch adapter is operational yet/i)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Compare / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeDisabled();
});

test('exposes twelve source-backed galleries, launch engines, and the planned Pocket boundary', async ({
  page,
}) => {
  await page.goto('/galleries');
  await expect(page.getByRole('heading', { level: 1, name: 'Model galleries' })).toBeVisible();
  await expect(page.getByRole('article', { name: /gallery$/i })).toHaveCount(12);
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /generate/i })).toHaveCount(0);

  await page.goto('/engines/kokoro');
  await expect(page.getByRole('heading', { level: 1, name: 'Kokoro 82M' })).toBeVisible();
  await expect(page.getByText(/no verified operational adapter/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Inspect status/i })).toHaveCount(54);
  await expect(page.getByRole('link', { name: /Use preset/i })).toHaveCount(0);

  await page.goto('/companion');
  await expect(page.getByText(/planned uv-managed local companion/i)).toBeVisible();
  await expect(page.getByText('20 presets')).toBeVisible();
  await expect(page.getByText(/reference\/source clips, not Pocket TTS outputs/i)).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Open Kyutai's official remote demo/i }),
  ).toHaveAttribute('href', 'https://kyutai.org/tts');
});

test('shows an honest catalog error and retries without a fixture fallback', async ({ page }) => {
  const pattern = '**/assets/launch-catalog.public-*.json';
  await page.route(pattern, (route) => route.abort('failed'));

  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Catalog unavailable');
  await expect(page.getByText(/synthetic fixture|Fixture Voice/i)).toHaveCount(0);

  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry catalog load' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find a voice by the shape of its sound.' }),
  ).toBeVisible();
});
