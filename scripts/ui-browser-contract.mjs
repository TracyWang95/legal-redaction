#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const ROUTES = [
  {
    name: 'start',
    path: '/',
    ready: '[data-testid="start-jobs"]',
    navTestId: 'nav-start',
  },
  {
    name: 'single',
    path: '/single',
    ready: '[data-testid="playground"]',
    navTestId: 'nav-single',
  },
  { name: 'batch', path: '/batch', ready: '[data-testid="batch-hub-title"]', navTestId: 'nav-batch' },
  { name: 'jobs', path: '/jobs', ready: '[data-testid="jobs-page"]', navTestId: 'nav-jobs' },
  {
    name: 'history',
    path: '/history',
    ready: '[data-testid="history-page"]',
    navTestId: 'nav-history',
  },
  {
    name: 'settings',
    path: '/settings',
    ready: '[data-testid="settings-tabs"]',
    navTestId: 'nav-settings',
  },
];
const SENSITIVE_API_PATTERNS = [
  /\/files\/upload(?:$|\?)/,
  /\/files\/[^/]+\/ner(?:\/|$|\?)/,
  /\/redaction\/execute(?:$|\?)/,
  /\/redaction\/[^/]+\/vision(?:$|\?)/,
  /\/jobs\/[^/]+\/submit(?:$|\?)/,
  /\/jobs\/[^/]+\/requeue-failed(?:$|\?)/,
];

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BASE_URL,
    outDir:
      process.env.UI_BROWSER_CONTRACT_OUT_DIR ||
      path.join(ROOT_DIR, 'output', 'playwright', `ui-browser-contract-${timestampSlug()}`),
    dryRun: false,
    preflightOnly: false,
    headed: false,
    mockApi: true,
    screenshot: true,
    timeoutMs: 30_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') args.baseUrl = argv[++index] || args.baseUrl;
    else if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
    else if (arg === '--out-dir') args.outDir = argv[++index] || args.outDir;
    else if (arg.startsWith('--out-dir=')) args.outDir = arg.slice('--out-dir='.length);
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++index] || args.timeoutMs);
    else if (arg.startsWith('--timeout-ms=')) args.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--preflight-only') args.preflightOnly = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--live-api') args.mockApi = false;
    else if (arg === '--mock-api') args.mockApi = true;
    else if (arg === '--no-screenshot') args.screenshot = false;
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, '');
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.');
  }
  args.outDir = path.isAbsolute(args.outDir) ? args.outDir : path.resolve(ROOT_DIR, args.outDir);
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ui-browser-contract.mjs
  node scripts/ui-browser-contract.mjs --dry-run
  node scripts/ui-browser-contract.mjs --preflight-only --base-url http://127.0.0.1:3000

Checks the 1920x1080 UI contract for:
  /, /single, /batch, /jobs, /history, /settings

Default behavior:
  - Opens the local frontend at http://127.0.0.1:3000
  - Uses fixed Playwright API mocks for /api/v1/** and /health/services
  - Blocks upload, recognition, redaction, job submit, and inference endpoints
  - Writes artifacts under output/playwright/...`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function planFor(args) {
  return {
    mode: args.dryRun ? 'dry-run' : args.preflightOnly ? 'preflight-only' : 'browser',
    base_url: args.baseUrl,
    out_dir: args.outDir,
    viewport: { width: 1920, height: 1080 },
    routes: ROUTES.map(({ name, path: routePath }) => ({ name, path: routePath })),
    mock_api: args.mockApi,
    screenshots: args.screenshot,
    no_gpu: true,
    blocked_api_patterns: SENSITIVE_API_PATTERNS.map((pattern) => pattern.source),
    skipped_when_dry_run: {
      browser: true,
      frontend_fetch: true,
      upload: true,
      recognition: true,
      inference: true,
    },
  };
}

async function ensureReachable(baseUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 8_000));
  try {
    const response = await fetch(baseUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Frontend is not reachable at ${baseUrl} (${reason}). Start the frontend on port 3000 or pass --base-url.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function loadPlaywright() {
  const pkg = path.join(FRONTEND_DIR, 'package.json');
  const nodeModules = path.join(FRONTEND_DIR, 'node_modules', '@playwright', 'test');
  if (!existsSync(pkg)) {
    throw new Error(`Missing frontend package.json at ${pkg}.`);
  }
  if (!existsSync(nodeModules)) {
    throw new Error(`Playwright dependency is missing at ${nodeModules}. Run npm install in frontend.`);
  }
  const frontendRequire = createRequire(pkg);
  return frontendRequire('@playwright/test');
}

function paginate(items, url, fallbackPageSize) {
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const pageSize = Math.max(1, Number(url.searchParams.get('page_size') || fallbackPageSize));
  const start = (page - 1) * pageSize;
  return {
    page,
    page_size: pageSize,
    total: items.length,
    items: items.slice(start, start + pageSize),
  };
}

function makeJobs(count) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    const id = `contract-job-${String(order).padStart(3, '0')}`;
    const created = new Date(Date.UTC(2026, 4, 5, 8, order % 60)).toISOString();
    return {
      id,
      job_id: id,
      job_type: 'smart_batch',
      title: `Contract job ${order}`,
      status: 'completed',
      skip_item_review: false,
      config: { preferred_execution: 'queue' },
      created_at: created,
      updated_at: created,
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

function makeFiles(count) {
  return Array.from({ length: count }, (_, index) => {
    const order = index + 1;
    const id = `contract-file-${String(order).padStart(3, '0')}`;
    const created = new Date(Date.UTC(2026, 4, 5, 9, order % 60)).toISOString();
    return {
      file_id: id,
      id,
      original_filename: `contract-result-${String(order).padStart(3, '0')}.pdf`,
      filename: `contract-result-${String(order).padStart(3, '0')}.pdf`,
      file_type: 'pdf',
      file_size: 4096 + order,
      created_at: created,
      has_output: true,
      entity_count: order % 5,
      upload_source: order % 2 === 0 ? 'batch' : 'playground',
      batch_group_id: order % 2 === 0 ? `contract-batch-${Math.ceil(order / 4)}` : null,
      batch_group_count: order % 2 === 0 ? 4 : null,
      job_id: `contract-job-${String(Math.max(1, Math.ceil(order / 3))).padStart(3, '0')}`,
      item_id: `contract-item-${String(order).padStart(3, '0')}`,
      item_status: 'completed',
    };
  });
}

function mockPayloads() {
  const now = new Date().toISOString();
  const customTypes = [
    {
      id: 'PERSON',
      name: 'Person',
      category: 'direct',
      description: 'Names in text',
      examples: ['Alice Example'],
      color: '#2563eb',
      regex_pattern: '',
      use_llm: true,
      enabled: true,
      order: 1,
      tag_template: 'PERSON_{n}',
      risk_level: 3,
    },
    {
      id: 'EMAIL',
      name: 'Email',
      category: 'direct',
      description: 'Email addresses',
      examples: ['user@example.com'],
      color: '#059669',
      regex_pattern: '[^@\\s]+@[^@\\s]+',
      use_llm: false,
      enabled: true,
      order: 2,
      tag_template: 'EMAIL_{n}',
      risk_level: 4,
    },
  ];
  const pipelines = [
    {
      mode: 'ocr_has',
      name: 'OCR HaS',
      description: 'OCR text detection',
      enabled: true,
      types: [
        {
          id: 'ocr_text',
          name: 'OCR Text',
          color: '#2563eb',
          description: 'Text region',
          enabled: true,
          order: 1,
        },
      ],
    },
    {
      mode: 'has_image',
      name: 'HaS Image',
      description: 'Image region detection',
      enabled: true,
      types: [
        {
          id: 'signature',
          name: 'Signature',
          color: '#7c3aed',
          description: 'Signature region',
          enabled: true,
          order: 1,
        },
      ],
    },
  ];
  return {
    jobs: makeJobs(24),
    files: makeFiles(24),
    customTypes,
    pipelines,
    presets: [
      {
        id: 'contract-default',
        name: 'Contract default',
        kind: 'full',
        selectedEntityTypeIds: customTypes.map((type) => type.id),
        ocrHasTypes: ['ocr_text'],
        hasImageTypes: ['signature'],
        replacementMode: 'structured',
        created_at: now,
        updated_at: now,
        readonly: true,
      },
    ],
  };
}

function isSensitiveApi(pathname, method) {
  if (method === 'GET') return false;
  return SENSITIVE_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

async function installMockApi(page, blockedRequests) {
  const fixtures = mockPayloads();
  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  await page.route('**/health/services', (route) =>
    json(route, {
      all_online: true,
      probe_ms: 1,
      checked_at: new Date().toISOString(),
      gpu_memory: null,
      gpu_processes: [],
      services: {
        paddle_ocr: { name: 'PaddleOCR', status: 'online' },
        has_ner: { name: 'HaS NER', status: 'online' },
        has_image: { name: 'HaS Image', status: 'online' },
      },
    }),
  );

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api\/v1/, '') || '/';
    const method = request.method();

    if (isSensitiveApi(apiPath, method)) {
      blockedRequests.push({ method, path: apiPath });
      await json(route, { detail: 'Blocked by ui-browser-contract; inference is not allowed.' }, 409);
      return;
    }

    if (apiPath === '/auth/status') {
      await json(route, { auth_enabled: false, password_set: true, authenticated: true });
      return;
    }
    if (apiPath === '/jobs' && method === 'GET') {
      const pageData = paginate(fixtures.jobs, url, 10);
      await json(route, {
        jobs: pageData.items,
        total: pageData.total,
        page: pageData.page,
        page_size: pageData.page_size,
      });
      return;
    }
    if (apiPath === '/jobs/batch-details' && method === 'POST') {
      await json(route, { jobs: fixtures.jobs });
      return;
    }
    if (apiPath.startsWith('/jobs/') && method === 'GET') {
      const id = decodeURIComponent(apiPath.slice('/jobs/'.length).split('/')[0] || '');
      await json(route, fixtures.jobs.find((job) => job.id === id) || fixtures.jobs[0]);
      return;
    }
    if (apiPath === '/files' && method === 'GET') {
      const source = url.searchParams.get('source');
      const filtered = source
        ? fixtures.files.filter((file) => file.upload_source === source)
        : fixtures.files;
      const pageData = paginate(filtered, url, 10);
      await json(route, {
        files: pageData.items,
        total: pageData.total,
        page: pageData.page,
        page_size: pageData.page_size,
      });
      return;
    }
    if (apiPath === '/custom-types' && method === 'GET') {
      await json(route, { custom_types: fixtures.customTypes, total: fixtures.customTypes.length });
      return;
    }
    if (apiPath === '/vision-pipelines' && method === 'GET') {
      await json(route, fixtures.pipelines);
      return;
    }
    if (apiPath === '/presets' && method === 'GET') {
      await json(route, { presets: fixtures.presets });
      return;
    }
    if (apiPath === '/redaction/entity-types' && method === 'GET') {
      await json(route, {
        entity_types: fixtures.customTypes.map(({ id, name, color }) => ({ id, name, color })),
      });
      return;
    }
    if (apiPath === '/redaction/replacement-modes' && method === 'GET') {
      await json(route, {
        replacement_modes: [
          { id: 'structured', name: 'Structured', description: 'Stable placeholders' },
          { id: 'mask', name: 'Mask', description: 'Mask characters' },
        ],
      });
      return;
    }
    if (apiPath === '/model-config' && method === 'GET') {
      await json(route, {
        active_id: 'paddle_ocr_service',
        configs: [
          {
            id: 'paddle_ocr_service',
            name: 'PaddleOCR',
            provider: 'local',
            enabled: true,
            model_name: 'builtin',
            temperature: 0,
            top_p: 1,
            max_tokens: 0,
            enable_thinking: false,
          },
          {
            id: 'has_image_service',
            name: 'HaS Image',
            provider: 'local',
            enabled: true,
            model_name: 'builtin',
            temperature: 0,
            top_p: 1,
            max_tokens: 0,
            enable_thinking: false,
          },
        ],
      });
      return;
    }
    if (apiPath === '/ner-backend' && method === 'GET') {
      await json(route, { backend: 'llamacpp', llamacpp_base_url: 'http://127.0.0.1:8080/v1' });
      return;
    }
    if (apiPath === '/safety/cleanup' && method === 'POST') {
      await json(route, { files_removed: 0, jobs_removed: 0 });
      return;
    }

    await json(route, {});
  });
}

async function preparePage(page, mockApi, blockedRequests) {
  if (mockApi) await installMockApi(page, blockedRequests);
  await page.addInitScript(() => {
    window.localStorage.setItem('onboarding_completed', 'true');
    window.localStorage.setItem('locale', 'en');
  });
}

async function getPageContractMetrics(page) {
  return page.evaluate(() => {
    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function overflowFor(element) {
      if (!element) {
        return { scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0, x: 0, y: 0 };
      }
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        x: Math.max(0, element.scrollWidth - element.clientWidth),
        y: Math.max(0, element.scrollHeight - element.clientHeight),
      };
    }

    const visibleTexts = [];
    for (const element of document.body.querySelectorAll('body *')) {
      if (!(element instanceof HTMLElement)) continue;
      if (!isVisible(element)) continue;
      const children = Array.from(element.children).filter(
        (child) => child instanceof HTMLElement && isVisible(child),
      );
      if (children.length > 0) continue;
      const text = element.innerText?.trim();
      if (text) visibleTexts.push(text);
    }

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflow: {
        document: overflowFor(document.documentElement),
        body: overflowFor(document.body),
        main: overflowFor(document.querySelector('main')),
      },
      visible_busy_texts: visibleTexts.filter((text) => /繁忙|忙碌|\bBusy\b/i.test(text)),
      title: document.title,
    };
  });
}

function addOverflowFailures(failures, route, metrics) {
  for (const [target, values] of Object.entries(metrics.overflow)) {
    if (values.x > 1) {
      failures.push({
        route,
        check: 'page-level-horizontal-overflow',
        message: `${route.path} ${target} has horizontal overflow ${values.x}px.`,
        details: values,
      });
    }
    if (values.y > 1) {
      failures.push({
        route,
        check: 'page-level-vertical-overflow',
        message: `${route.path} ${target} has vertical overflow ${values.y}px.`,
        details: values,
      });
    }
  }
}

function addBusyTextFailures(failures, route, metrics) {
  for (const text of metrics.visible_busy_texts) {
    failures.push({
      route,
      check: 'visible-busy-copy',
      message: `${route.path} shows visible busy copy: ${text}`,
      details: { text },
    });
  }
}

function normalizePath(pathname) {
  if (pathname === '/') {
    return '/';
  }
  return pathname.replace(/\/+$/, '');
}

async function waitForPath(page, pathname, timeoutMs) {
  const expectedPath = normalizePath(pathname);
  await page
    .waitForFunction(
      (targetPath) => {
        const pathname = window.location.pathname;
        if (pathname === targetPath) return true;
        if (targetPath === '/') return pathname === '/';
        return pathname === `${targetPath}/` || pathname.startsWith(`${targetPath}/`);
      },
      expectedPath,
      { timeout: timeoutMs },
    )
    .catch(() => {});
}

async function visibleCount(locator) {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible().catch(() => false)) visible += 1;
  }
  return visible;
}

async function checkPagination(page, route, failures) {
  const isJobs = route.name === 'jobs';
  const rowSelector = isJobs ? '[data-testid^="job-row-"]' : '[data-testid^="history-row-"]';
  const beforeRows = await visibleCount(page.locator(rowSelector));
  const rail = page.getByTestId('pagination-rail').last();
  const railVisible = await rail.isVisible().catch(() => false);
  if (!railVisible) {
    failures.push({
      route,
      check: 'pagination-rail-visible',
      message: `${route.path} pagination rail is not visible before paging.`,
    });
  }
  if (beforeRows <= 0) {
    failures.push({
      route,
      check: 'page-not-blank-before-pagination',
      message: `${route.path} has no visible rows before paging.`,
      details: { rowSelector },
    });
  }

  const nextButton = rail.locator('.pagination-rail__actions button').nth(2);
  const canGoNext = railVisible && (await nextButton.isEnabled().catch(() => false));
  if (!canGoNext) {
    failures.push({
      route,
      check: 'pagination-next-enabled',
      message: `${route.path} next page button is not enabled; fixture pagination cannot be verified.`,
    });
    return;
  }

  await nextButton.click();
  await page.waitForTimeout(350);
  const afterRows = await visibleCount(page.locator(rowSelector));
  const afterRailVisible = await rail.isVisible().catch(() => false);
  if (!afterRailVisible) {
    failures.push({
      route,
      check: 'pagination-rail-persists',
      message: `${route.path} pagination rail disappeared after moving to the next page.`,
    });
  }
  if (afterRows <= 0) {
    failures.push({
      route,
      check: 'page-not-blank-after-pagination',
      message: `${route.path} has no visible rows after moving to the next page.`,
      details: { rowSelector },
    });
  }

  const afterRailBounds = await rail.boundingBox();
  if (!afterRailBounds) {
    failures.push({
      route,
      check: 'pagination-rail-bounds',
      message: `${route.path} pagination rail has no measurable bounding box after paging.`,
    });
    return;
  }
  if (
    afterRailBounds.x < 0 ||
    afterRailBounds.y < 0 ||
    afterRailBounds.x + afterRailBounds.width > 1920 ||
    afterRailBounds.y + afterRailBounds.height > 1080
  ) {
    failures.push({
      route,
      check: 'pagination-rail-overflows-viewport',
      message: `${route.path} pagination rail overflows viewport after paging.`,
      details: { railBounds: afterRailBounds },
    });
  }
}

async function runRoute(page, args, route, summary, isFirstRoute) {
  const start = performance.now();
  const url = `${args.baseUrl}${route.path}`;
  const result = { ...route, url, elapsed_ms: 0, metrics: null };

  if (isFirstRoute) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
  } else if (route.navTestId) {
    const navItem = page.getByTestId(route.navTestId);
    const navCount = await navItem.count().catch(() => 0);
    if (navCount > 0) {
      await navItem.click({ timeout: args.timeoutMs });
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
    }
  } else {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: args.timeoutMs });
  }

  await waitForPath(page, route.path, args.timeoutMs);
  await page.locator(route.ready).first().waitFor({ state: 'visible', timeout: args.timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(250);

  const metrics = await getPageContractMetrics(page);
  result.metrics = metrics;
  addOverflowFailures(summary.failures, route, metrics);
  addBusyTextFailures(summary.failures, route, metrics);

  if (route.name === 'jobs' || route.name === 'history') {
    await checkPagination(page, route, summary.failures);
    const postMetrics = await getPageContractMetrics(page);
    addOverflowFailures(summary.failures, { ...route, phase: 'after-pagination' }, postMetrics);
    addBusyTextFailures(summary.failures, { ...route, phase: 'after-pagination' }, postMetrics);
    result.after_pagination_metrics = postMetrics;
  }

  if (args.screenshot) {
    const screenshotPath = path.join(args.outDir, `${route.name}-1920x1080.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    result.screenshot = screenshotPath;
  }
  result.elapsed_ms = Math.round(performance.now() - start);
  return result;
}

async function runBrowser(args) {
  const { chromium } = loadPlaywright();
  const summary = {
    generated_at: new Date().toISOString(),
    base_url: args.baseUrl,
    out_dir: args.outDir,
    viewport: { width: 1920, height: 1080 },
    mock_api: args.mockApi,
    routes: [],
    failures: [],
    console: [],
    page_errors: [],
    failed_requests: [],
    blocked_requests: [],
    passed: false,
  };

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      summary.console.push({ type: message.type(), text: message.text() });
    }
  });
  page.on('pageerror', (error) => summary.page_errors.push(String(error)));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (!request.url().includes('/health/services')) {
      summary.failed_requests.push({ method: request.method(), url: request.url(), failure });
    }
  });
  await preparePage(page, args.mockApi, summary.blocked_requests);

  try {
    for (const [index, route] of ROUTES.entries()) {
      summary.routes.push(await runRoute(page, args, route, summary, index === 0));
    }
  } catch (error) {
    summary.failures.push({
      check: 'browser-run',
      message: error instanceof Error ? error.stack || error.message : String(error),
    });
    if (args.screenshot) {
      await page.screenshot({ path: path.join(args.outDir, 'failure.png'), fullPage: false }).catch(() => {});
    }
  } finally {
    await browser.close();
  }

  for (const request of summary.blocked_requests) {
    summary.failures.push({
      check: 'blocked-sensitive-api',
      message: `Sensitive API call was attempted: ${request.method} ${request.path}`,
      details: request,
    });
  }

  summary.passed =
    summary.failures.length === 0 &&
    summary.page_errors.length === 0 &&
    summary.failed_requests.length === 0 &&
    summary.blocked_requests.length === 0;
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outDir, { recursive: true });
  const plan = planFor(args);
  await writeJson(path.join(args.outDir, 'plan.json'), plan);

  if (args.dryRun) {
    await writeJson(path.join(args.outDir, 'dry-run.json'), plan);
    console.log(`dry-run: ${path.join(args.outDir, 'dry-run.json')}`);
    console.log(`base_url=${args.baseUrl}`);
    console.log(`routes=${ROUTES.map((route) => route.path).join(',')}`);
    console.log(`mock_api=${args.mockApi}`);
    console.log('browser=false upload=false recognition=false inference=false');
    return;
  }

  await ensureReachable(args.baseUrl, args.timeoutMs);
  if (args.preflightOnly) {
    console.log('UI browser contract preflight passed.');
    console.log(`base_url=${args.baseUrl}`);
    console.log(`out_dir=${args.outDir}`);
    return;
  }

  const summary = await runBrowser(args);
  await writeJson(path.join(args.outDir, 'summary.json'), summary);
  console.log(`summary: ${path.join(args.outDir, 'summary.json')}`);
  console.log(`passed=${summary.passed} failures=${summary.failures.length}`);
  if (!summary.passed) {
    for (const failure of summary.failures.slice(0, 12)) {
      console.error(`- ${failure.check}: ${failure.message}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('UI browser contract failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
