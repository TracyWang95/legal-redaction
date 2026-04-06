import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const TEST_IMAGE_PATH =
  'D:/DataInfra-RedactionEverything/frontend/output/playwright/cursor-polish/playground-current.png';

export const REAL_TEST_FILES = {
  image: TEST_IMAGE_PATH,
  docx1: 'D:/ceshi/sample-1.docx',
  docx2: 'D:/ceshi/sample-2.docx',
} as const;

export async function isBackendUp(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get('http://127.0.0.1:8000/health');
    return res.ok();
  } catch {
    return false;
  }
}

export async function preparePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('onboarding_completed', 'true');
    localStorage.setItem('locale', 'zh');
  });
}

export async function openPage(page: Page, path = '/') {
  await preparePage(page);
  await page.goto(path);
  await waitForPageReady(page);
}

export async function dismissOnboarding(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('onboarding_completed', 'true');
  }).catch(() => {});

  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) {
    const dismissButton = dialog.getByRole('button').first();
    if (await dismissButton.isVisible().catch(() => false)) {
      await dismissButton.click().catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

export async function waitForPageReady(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
}

export async function expectVisibleNav(page: Page, testId: string) {
  await expect(page.getByTestId(testId)).toBeVisible();
}

export async function stubBackendOffline(page: Page) {
  await page.route('**/health/services**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'offline' }),
    });
  });

  await page.route('**/api/v1/**', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'offline' }),
    });
  });
}

export async function stubRecognitionConfig(page: Page) {
  const entityTypes = Array.from({ length: 12 }, (_, index) => ({
    id: `text_type_${index + 1}`,
    name: `Text Rule ${String(index + 1).padStart(2, '0')}`,
    color: '#3b82f6',
    enabled: true,
    order: index + 1,
    description: `Text Rule ${index + 1}`,
  }));

  const buildPipelineTypes = (prefix: string, label: string, color: string) =>
    Array.from({ length: 12 }, (_, index) => ({
      id: `${prefix}_${index + 1}`,
      name: `${label} ${String(index + 1).padStart(2, '0')}`,
      color,
      enabled: true,
      order: index + 1,
      description: `${label} ${index + 1}`,
    }));

  const pipelines = [
    {
      mode: 'ocr_has',
      name: 'OCR Text',
      description: 'OCR text items',
      enabled: true,
      types: buildPipelineTypes('ocr_type', 'OCR Text', '#0f766e'),
    },
    {
      mode: 'has_image',
      name: 'Image Feature',
      description: 'Image feature items',
      enabled: true,
      types: buildPipelineTypes('image_type', 'Image Feature', '#b45309'),
    },
  ];

  const presets = [
    {
      id: 'preset-text-default',
      name: 'Text Preset',
      kind: 'text',
      selectedEntityTypeIds: entityTypes.slice(0, 4).map((item) => item.id),
      ocrHasTypes: [],
      hasImageTypes: [],
      replacementMode: 'structured',
      created_at: '2026-04-06T00:00:00.000Z',
      updated_at: '2026-04-06T00:00:00.000Z',
    },
    {
      id: 'preset-vision-default',
      name: 'Vision Preset',
      kind: 'vision',
      selectedEntityTypeIds: [],
      ocrHasTypes: pipelines[0].types.slice(0, 3).map((item) => item.id),
      hasImageTypes: pipelines[1].types.slice(0, 3).map((item) => item.id),
      replacementMode: 'structured',
      created_at: '2026-04-06T00:00:00.000Z',
      updated_at: '2026-04-06T00:00:00.000Z',
    },
  ];

  await page.route('**/health/services**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        all_online: true,
        probe_ms: 12,
        checked_at: '2026-04-06T00:00:00.000Z',
        gpu_memory: null,
        services: {
          paddle_ocr: { name: 'Paddle OCR', status: 'online' },
          has_ner: { name: 'HAS NER', status: 'online' },
          has_image: { name: 'HAS Image', status: 'online' },
        },
      }),
    });
  });

  await page.route('**/api/v1/custom-types**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ custom_types: entityTypes }),
    });
  });

  await page.route('**/api/v1/vision-pipelines**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(pipelines),
    });
  });

  await page.route('**/api/v1/presets**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(presets),
    });
  });
}

export async function expectNoOverlap(cards: Locator, footer: Locator) {
  const boxes = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );

  for (let index = 0; index < boxes.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < boxes.length; nextIndex += 1) {
      const current = boxes[index];
      const next = boxes[nextIndex];
      const horizontalOverlap = current.left < next.right && current.right > next.left;
      const verticalOverlap = current.top < next.bottom && current.bottom > next.top;
      expect(horizontalOverlap && verticalOverlap).toBe(false);
    }
  }

  const lastBox = boxes.at(-1);
  const footerBox = await footer.boundingBox();
  expect(lastBox).toBeTruthy();
  expect(footerBox).toBeTruthy();
  if (lastBox && footerBox) {
    expect(lastBox.bottom).toBeLessThanOrEqual(footerBox.y);
  }
}
