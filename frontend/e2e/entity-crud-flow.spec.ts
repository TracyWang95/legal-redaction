import { test, expect, type Page } from '@playwright/test';
import { mockApi } from './support/mock-api';

const TS = Date.now();
const REGEX_NAME = `TestRegex_${TS}`;
const REGEX_PATTERN = String.raw`TESTRX\d+`;

async function dismissTransientUi(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test('settings: create regex type and verify list refreshes', async ({ page }) => {
  await mockApi(page);

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await dismissTransientUi(page);

  const regexTab = page.locator('[data-testid="subtab-regex"]');
  if (await regexTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await regexTab.click();
    await page.waitForTimeout(300);
  }

  const beforeText = await regexTab.textContent();

  await page.locator('[data-testid="add-regex-type"]').click();
  await page.locator('[data-testid="entity-type-name"]').fill(REGEX_NAME);
  await page.locator('[data-testid="entity-type-regex"]').fill(REGEX_PATTERN);
  await page.locator('[data-testid="entity-type-save"]').click();

  await expect.poll(async () => regexTab.textContent(), { timeout: 5_000 }).not.toBe(beforeText);

  const afterText = await regexTab.textContent();

  await page.reload();
  await page.waitForLoadState('networkidle');
  await dismissTransientUi(page);

  if (await regexTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await regexTab.click();
  }

  await expect(regexTab).toHaveText(afterText ?? '');

  let found = false;
  for (let i = 0; i < 10; i += 1) {
    const text = await page.textContent('body');
    if (text?.includes(REGEX_NAME)) {
      found = true;
      break;
    }
    const nextButton = page.getByRole('button', { name: /next|下一页/i }).first();
    if (await nextButton.isEnabled().catch(() => false)) {
      await nextButton.click();
      await page.waitForTimeout(300);
    } else {
      break;
    }
  }

  expect(found).toBe(true);
});
