import { test, expect, type Locator, type Page } from '@playwright/test';
import { mockApi } from './support/mock-api';

const desktopRoutes = [
  ['start', '/'],
  ['single', '/single'],
  ['batch', '/batch'],
  ['jobs', '/jobs'],
  ['history', '/history'],
  ['settings', '/settings'],
  ['settings-redaction', '/settings/redaction'],
  ['model-settings-text', '/model-settings/text'],
  ['model-settings-vision', '/model-settings/vision'],
] as const;

const zhDesktopRoutes = [
  ['start', '/'],
  ['batch', '/batch'],
  ['jobs', '/jobs'],
  ['history', '/history'],
  ['settings', '/settings'],
] as const;

async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const main = document.querySelector('main');

    const delta = (element: Element | HTMLElement | null) => {
      if (!element) return 0;
      return Math.max(0, element.scrollHeight - element.clientHeight);
    };

    return {
      document: delta(documentElement),
      body: delta(body),
      main: delta(main),
    };
  });
}

async function prepareLayoutPage(
  page: Page,
  locale?: 'zh' | 'en',
  mockOptions: Parameters<typeof mockApi>[1] = {},
) {
  await mockApi(page, {
    ...mockOptions,
    servicesOnline: mockOptions.servicesOnline ?? true,
  });
  await page.addInitScript((nextLocale) => {
    window.localStorage.setItem('onboarding_completed', 'true');
    if (nextLocale) window.localStorage.setItem('locale', nextLocale);
  }, locale);
}

async function expectNoPageOverflow(page: Page, context: string) {
  const overflow = await pageOverflow(page);
  expect(overflow, `${context} should not require page-level vertical scrolling`).toEqual({
    document: 0,
    body: 0,
    main: 0,
  });
}

async function expectWithinViewport(locator: Locator, context: string) {
  await expect(locator, `${context} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${context} should have a rendered bounding box`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${context} should not overflow left`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${context} should not overflow top`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${context} should not overflow right`).toBeLessThanOrEqual(1921);
  expect(box.y + box.height, `${context} should not overflow bottom`).toBeLessThanOrEqual(1081);
}

async function expectNoVerticalOverflow(locator: Locator, context: string) {
  await expect(locator, `${context} should be visible`).toBeVisible();
  const overflow = await locator.evaluate((element) =>
    Math.max(0, element.scrollHeight - element.clientHeight),
  );
  expect(overflow, `${context} should not have internal vertical scrolling`).toBe(0);
}

async function choosePageSize(page: Page, scope: Locator, size: number) {
  await scope.getByRole('combobox').click();
  await page.getByRole('option', { name: new RegExp(`^${size}\\b`) }).click();
}

const coreNavRoutes = [
  { name: 'start', route: '/', nav: 'nav-start', ready: '[data-testid="start-jobs"]' },
  { name: 'single', route: '/single', nav: 'nav-single', ready: '[data-testid="playground"]' },
  { name: 'batch', route: '/batch', nav: 'nav-batch', ready: '[data-testid="batch-hub-title"]' },
  { name: 'jobs', route: '/jobs', nav: 'nav-jobs', ready: '[data-testid="jobs-page"]' },
  {
    name: 'history',
    route: '/history',
    nav: 'nav-history',
    ready: '[data-testid="history-page"]',
  },
  {
    name: 'settings',
    route: '/settings',
    nav: 'nav-settings',
    ready: '[data-testid="settings-tabs"]',
  },
] as const;

function makeEntityTypes(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    return {
      id: `REGEX_LAYOUT_${String(order).padStart(2, '0')}`,
      name: `Layout rule ${order}`,
      category: 'direct',
      description: `Layout regression rule ${order}`,
      examples: [`LAYOUT-${order}`],
      color: '#2563eb',
      regex_pattern: `LAYOUT-${order}\\d{3}`,
      use_llm: false,
      enabled: true,
      order,
      tag_template: `LAYOUT_${order}_{n}`,
      risk_level: 3,
    };
  });
}

function makePipelines(count: number) {
  const types = Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    return {
      id: `layout_region_${String(order).padStart(2, '0')}`,
      name: `Layout region ${order}`,
      color: '#059669',
      description: `Layout visual rule ${order}`,
      enabled: true,
      order,
    };
  });

  return [
    {
      mode: 'ocr_has',
      name: 'OCR HaS',
      description: 'OCR visual text detection',
      enabled: true,
      types,
    },
    {
      mode: 'has_image',
      name: 'HaS Image',
      description: 'Image object detection',
      enabled: true,
      types,
    },
  ];
}

function makeLayoutJobs(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    const id = `job-layout-${String(order).padStart(3, '0')}`;
    return {
      id,
      job_id: id,
      job_type: 'smart_batch',
      title: `Layout density job ${order}`,
      status: 'completed',
      created_at: new Date(2026, 3, 5, 9, order % 60).toISOString(),
      updated_at: new Date(2026, 3, 5, 10, order % 60).toISOString(),
      config: { preferred_execution: 'queue' },
      progress: {
        total_items: 3,
        pending: 0,
        processing: 0,
        queued: 0,
        parsing: 0,
        ner: 0,
        vision: 0,
        awaiting_review: 0,
        review_approved: 0,
        redacting: 0,
        completed: 3,
        failed: 0,
        cancelled: 0,
      },
      nav_hints: {
        item_count: 3,
        first_awaiting_review_item_id: null,
        wizard_furthest_step: 5,
        batch_step1_configured: true,
        awaiting_review_count: 0,
        redacted_count: 3,
      },
      items: [],
    };
  });
}

function makeLayoutFiles(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    const id = `file-layout-${String(order).padStart(3, '0')}`;
    return {
      file_id: id,
      id,
      original_filename: `layout-density-result-${String(order).padStart(3, '0')}.pdf`,
      filename: `layout-density-result-${String(order).padStart(3, '0')}.pdf`,
      file_type: 'pdf',
      file_size: 2048 + order,
      created_at: new Date(2026, 3, 5, 11, order % 60).toISOString(),
      has_output: true,
      entity_count: order % 7,
      upload_source: 'batch',
      batch_group_id: `layout-batch-${Math.ceil(order / 5)}`,
      batch_group_count: 5,
      job_id: `job-layout-${String(order).padStart(3, '0')}`,
      item_id: `item-layout-${String(order).padStart(3, '0')}`,
      item_status: 'completed',
    };
  });
}

async function firstBoxHeight(locator: Locator) {
  await expect(locator.first()).toBeVisible();
  const box = await locator.first().boundingBox();
  expect(box).not.toBeNull();
  return box?.height ?? 0;
}

async function clickAndAssertCoreRoute(page: Page, step: (typeof coreNavRoutes)[number], index: number) {
  if (index === 0) {
    await page.goto(step.route);
  } else {
    await page.getByTestId(step.nav).click();
  }

  await page.locator(step.ready).first().waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  await expectNoPageOverflow(page, `${step.name} route after core navigation`);

  if (step.route === '/jobs' || step.route === '/history') {
    const rail = page.getByTestId('pagination-rail').last();
    await expect(rail, `${step.name} pagination rail remains visible`).toBeVisible();
    const railBox = await rail.boundingBox();
    expect(railBox, `${step.name} pagination rail box should be measurable`).not.toBeNull();
    if (railBox) {
      expect(railBox.x, `${step.name} pagination rail should stay in viewport left side`).toBeGreaterThanOrEqual(
        -1,
      );
      expect(railBox.y, `${step.name} pagination rail should stay in viewport top side`).toBeGreaterThanOrEqual(
        -1,
      );
      expect(railBox.x + railBox.width, `${step.name} pagination rail should stay within viewport width`).toBeLessThanOrEqual(
        1921,
      );
      expect(railBox.y + railBox.height, `${step.name} pagination rail should stay within viewport height`).toBeLessThanOrEqual(
        1081,
      );
    }
  }
}

test.describe('desktop UI layout', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const [name, route] of desktopRoutes) {
    test(`${name} fits the primary desktop viewport`, async ({ page }) => {
      await prepareLayoutPage(page);
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const overflow = await pageOverflow(page);
      expect(overflow, `${route} should not require page-level vertical scrolling`).toEqual({
        document: 0,
        body: 0,
        main: 0,
      });

      await expect(page.locator('body')).not.toContainText(
        /\b[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+\b/,
      );
      await page.screenshot({
        path: `output/ui-layout/${name}-1920x1080.png`,
        fullPage: false,
      });
    });
  }
});

test.describe('Chinese desktop UI layout', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  for (const [name, route] of zhDesktopRoutes) {
    test(`${name} keeps Chinese product navigation clean`, async ({ page }) => {
      await prepareLayoutPage(page, 'zh');
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      const overflow = await pageOverflow(page);
      expect(overflow, `${route} should not require page-level vertical scrolling`).toEqual({
        document: 0,
        body: 0,
        main: 0,
      });

      await expect(page.getByTestId('nav-start')).toContainText('开始');
      await expect(page.getByTestId('nav-single')).toContainText('单次处理');
      await expect(page.getByTestId('nav-batch')).toContainText('批量处理');
      await expect(page.getByTestId('nav-jobs')).toContainText('任务中心');
      await expect(page.getByTestId('nav-history')).toContainText('处理结果');
      await expect(page.getByTestId('health-panel')).toContainText('本地服务');
      await expect(page.locator('body')).not.toContainText(
        /Playground|Advanced Settings|Service Status|Model Services|DataInfra-RedactionEverything/,
      );
      await page.screenshot({
        path: `output/ui-layout/zh-${name}-1920x1080.png`,
        fullPage: false,
      });
    });
  }
});

test.describe('desktop navigation click flow', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('core workflow pages are reachable by basic sidebar clicks', async ({ page }) => {
    await prepareLayoutPage(page);

    for (const [index, step] of coreNavRoutes.entries()) {
      await clickAndAssertCoreRoute(page, step, index);
    }
  });
});

test.describe('desktop layout density controls', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('recognition settings keep 9/18/27 item pages inside the desktop shell', async ({
    page,
  }) => {
    await prepareLayoutPage(page, 'en', {
      entityTypes: makeEntityTypes(30),
      pipelines: makePipelines(30),
    });
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const assertRecognitionPanel = async (panel: Locator, label: string) => {
      const footer = panel.locator('.page-surface-footer');
      for (const size of [9, 18, 27]) {
        if (size !== 9) await choosePageSize(page, footer, size);

        await expect(panel.locator('article'), `${label} should render ${size} cards`).toHaveCount(
          size,
        );
        const cardMetrics = await panel.locator('article').evaluateAll((cards) =>
          cards.map((card) => {
            const el = card as HTMLElement;
            const box = el.getBoundingClientRect();
            return {
              height: box.height,
              width: box.width,
              horizontalOverflow: el.scrollWidth - el.clientWidth,
            };
          }),
        );
        expect(
          cardMetrics.every(
            (metric) =>
              metric.width >= 300 &&
              metric.height >= 140 &&
              metric.height <= 160 &&
              metric.horizontalOverflow <= 1,
          ),
          `${label} cards should keep full card dimensions at page size ${size}`,
        ).toBe(true);
        await expectWithinViewport(footer, `${label} pagination at page size ${size}`);
        await expectNoPageOverflow(page, `${label} page size ${size}`);
      }
    };

    await assertRecognitionPanel(page.getByTestId('entity-type-list-regex'), 'text recognition');

    await page.getByTestId('tab-vision').click();
    await expect(page.getByTestId('vision-pipeline-panel')).toBeVisible();
    await assertRecognitionPanel(page.getByTestId('vision-pipeline-panel'), 'vision recognition');
  });

  test('jobs page size switches preserve desktop layout density', async ({ page }) => {
    await prepareLayoutPage(page, 'en', { jobs: makeLayoutJobs(100) });
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('[data-testid^="job-row-job-layout-"]');
    const footer = page.locator('.page-surface-footer').last();
    await expect(rows).toHaveCount(10);
    const defaultHeight = await firstBoxHeight(rows);
    await expectWithinViewport(footer, 'jobs pagination');
    await expectNoPageOverflow(page, 'jobs default page size');

    for (const size of [20, 50, 100]) {
      await choosePageSize(page, footer, size);
      await expect(rows, `jobs should render ${size} rows after page-size switch`).toHaveCount(
        size,
      );
      const rowHeight = await firstBoxHeight(rows);
      expect(
        rowHeight,
        `jobs row height should stay compact at page size ${size}`,
      ).toBeLessThanOrEqual(defaultHeight + 1);
      await expectWithinViewport(footer, `jobs pagination at page size ${size}`);
      await expectNoPageOverflow(page, `jobs page size ${size}`);
    }
  });

  test('history page size switches preserve desktop table layout', async ({ page }) => {
    await prepareLayoutPage(page, 'en', { files: makeLayoutFiles(100) });
    await page.goto('/history');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('[data-testid^="history-row-file-layout-"]');
    const tableBody = page.getByTestId('history-table');
    const footer = page.locator('.page-surface-footer').last();
    await expect(rows).toHaveCount(10);
    const defaultHeight = await firstBoxHeight(rows);
    expect(
      defaultHeight,
      'history default 10-row page should stay dense without looking cramped',
    ).toBeGreaterThanOrEqual(54);
    expect(
      defaultHeight,
      'history default 10-row page should leave room for pagination and filters',
    ).toBeLessThanOrEqual(60);
    await expectNoVerticalOverflow(tableBody, 'history table default page size');
    await expectWithinViewport(footer, 'history pagination');
    await expectNoPageOverflow(page, 'history default page size');

    for (const size of [20]) {
      await choosePageSize(page, footer, size);
      await expect(rows, `history should render ${size} rows after page-size switch`).toHaveCount(
        size,
      );
      const rowHeight = await firstBoxHeight(rows);
      expect(
        rowHeight,
        `history row height should stay compact at page size ${size}`,
      ).toBeLessThanOrEqual(defaultHeight + 1);
      await expectNoVerticalOverflow(tableBody, `history table page size ${size}`);
      await expectWithinViewport(footer, `history pagination at page size ${size}`);
      await expectNoPageOverflow(page, `history page size ${size}`);
    }
  });
});
