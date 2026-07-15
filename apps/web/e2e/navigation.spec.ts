import { expect, test } from '@playwright/test';

test('keyboard users can enter the main landmark with visible focus', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS('outline-style', 'solid');

  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('filter URL state survives a direct load and reload', async ({ page }) => {
  await page.goto('/voices?q=voice&mode=browser&engine=fixture-browser');
  await expect(page.getByRole('searchbox', { name: 'Search voices' })).toHaveValue('voice');
  await expect(page.getByRole('checkbox', { name: 'Runs in browser' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Fixture Browser Engine' })).toBeChecked();

  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search voices' })).toHaveValue('voice');
  await expect(page).toHaveURL(/mode=browser/);
});

test('mobile navigation and filter drawer work without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/voices');

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation' }).click();

  await page.getByRole('button', { name: 'Open filters' }).click();
  const drawer = page.getByRole('dialog', { name: 'Voice filters' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('checkbox', { name: 'Runs in browser' }).click();
  await expect(drawer.getByRole('checkbox', { name: 'Runs in browser' })).toBeChecked();
  await expect(page).toHaveURL(/mode=browser/);
  await drawer.getByRole('button', { name: 'Close filters' }).click();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
