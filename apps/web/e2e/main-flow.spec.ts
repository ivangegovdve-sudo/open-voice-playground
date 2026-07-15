import { expect, test } from '@playwright/test';

test('browse, filter, open play, and compare without silent fallback', async ({ page }) => {
  await page.goto('/voices');
  await expect(page.getByRole('heading', { level: 1, name: 'Voice atlas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open filters' })).toBeHidden();

  await page.getByRole('checkbox', { name: 'Runs in browser' }).click();
  await expect(page.getByRole('checkbox', { name: 'Runs in browser' })).toBeChecked();
  await expect(page).toHaveURL(/mode=browser/);
  await expect(page.getByText('2 presets')).toBeVisible();

  await page
    .getByRole('link', { name: /Use voice/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Make a line speak' })).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Text to synthesize' })
    .fill('The inlet is quiet at dawn.');
  await page.getByRole('button', { name: 'Generate speech' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Browser runtime is not installed in this build.',
  );
  await expect(page.getByRole('button', { name: 'Download WAV' })).toBeDisabled();

  await page.getByRole('link', { name: 'Compare' }).click();
  const choices = page.getByRole('checkbox', { name: /^Compare / });
  await choices.nth(0).check();
  await choices.nth(1).check();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByRole('status')).toContainText('Comparison finished');
  await expect(page.getByText('unavailable', { exact: true }).first()).toBeVisible();
});
