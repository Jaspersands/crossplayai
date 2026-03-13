const { test, expect } = require('@playwright/test');

test('loads upload and solve workflow shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Crossplay Scrabble Move Finder' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. Upload Crossplay Screenshot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm board state' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Solve top moves' })).toBeVisible();
});

test('corrections route reuses main flow and supports export json', async ({ page }, testInfo) => {
  const blankScreenshotPath = testInfo.outputPath('blank-crossplay.png');

  await page.setViewportSize({ width: 1170, height: 2532 });
  await page.goto('data:text/html,<html><body style=\"margin:0;background:#ffffff;\"></body></html>');
  await page.screenshot({ path: blankScreenshotPath, fullPage: true });

  await page.goto('/corrections');

  await expect(page.getByRole('heading', { name: 'Crossplay Scrabble Move Finder' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(blankScreenshotPath);

  const confirmButton = page.getByRole('button', { name: 'Confirm board state' });
  await expect(confirmButton).toBeEnabled({ timeout: 30000 });
  await confirmButton.click();

  const exportButton = page.getByRole('button', { name: 'Export corrections JSON' });
  await expect(exportButton).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click(),
  ]);

  expect(download.suggestedFilename()).toContain('.corrections.json');
});
