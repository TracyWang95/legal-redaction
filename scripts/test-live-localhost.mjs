#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_EVAL_TOKEN_FILE, resolveTokenFilePath } from './eval-auth.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(rootDir, 'frontend');
const defaultTokenFile =
  resolveTokenFilePath(process.env.DATAINFRA_LIVE_DEFAULT_TOKEN_FILE || process.env.DATAINFRA_DEFAULT_TOKEN_FILE || DEFAULT_EVAL_TOKEN_FILE);
const defaultBaseUrl = 'http://127.0.0.1:3000';
const defaultPlaywrightCli = path.join(frontendDir, 'node_modules', '@playwright', 'test', 'cli.js');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const preflightOnly = args.includes('--preflight');
const forwardedArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '--preflight');

const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_WEBSERVER: process.env.PLAYWRIGHT_SKIP_WEBSERVER || '1',
  PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL || defaultBaseUrl,
};

if (
  !env.DATAINFRA_PASSWORD &&
  !env.DATAINFRA_TOKEN &&
  !env.DATAINFRA_TOKEN_FILE &&
  existsSync(defaultTokenFile)
) {
  env.DATAINFRA_TOKEN_FILE = defaultTokenFile;
}

function resolveReadablePath(filePath) {
  if (!filePath || path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(rootDir, filePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || path.resolve(rootDir, filePath);
}

if (env.DATAINFRA_TOKEN_FILE) {
  env.DATAINFRA_TOKEN_FILE = resolveReadablePath(env.DATAINFRA_TOKEN_FILE);
}

function resolvePlaywrightCli() {
  const cli = process.env.DATAINFRA_PLAYWRIGHT_CLI || defaultPlaywrightCli;
  return path.isAbsolute(cli) ? cli : path.resolve(rootDir, cli);
}

function assertPlaywrightCliAvailable(playwrightCli) {
  if (existsSync(playwrightCli)) return;
  throw new Error(
    `Playwright CLI is missing at ${playwrightCli}. Run npm install in frontend or npm run setup first.`,
  );
}

function envFlag(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function resolveApiBase(currentEnv) {
  const raw =
    currentEnv.PLAYWRIGHT_API_BASE_URL ||
    currentEnv.DATAINFRA_API ||
    'http://127.0.0.1:8000/api/v1';
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  return withoutTrailingSlash.endsWith('/api/v1')
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api/v1`;
}

function describeCredential(currentEnv) {
  if (currentEnv.DATAINFRA_TOKEN_FILE) return `DATAINFRA_TOKEN_FILE=${currentEnv.DATAINFRA_TOKEN_FILE}`;
  if (currentEnv.DATAINFRA_TOKEN) return 'DATAINFRA_TOKEN';
  if (currentEnv.DATAINFRA_PASSWORD) return 'DATAINFRA_PASSWORD';
  return '';
}

function readTokenFileForPreflight(tokenFile) {
  try {
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (!token) {
      throw new Error('file is empty');
    }
    return token;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DATAINFRA_TOKEN_FILE is set to "${tokenFile}", but the file cannot be used (${reason}). ` +
        'Run DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt, ' +
        'or point DATAINFRA_TOKEN_FILE at an existing token file.',
    );
  }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status} did not return JSON`);
      }
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureUrlReachable(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} is not reachable at ${url} (${reason}). ` +
        'Start the already-running stack first, for example npm run dev:attach or docker compose up -d, ' +
        'or set PLAYWRIGHT_BASE_URL to the live frontend URL.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function preflightLiveLocalhost(currentEnv) {
  if (currentEnv.DATAINFRA_TOKEN_FILE) {
    readTokenFileForPreflight(currentEnv.DATAINFRA_TOKEN_FILE);
  }

  await ensureUrlReachable(currentEnv.PLAYWRIGHT_BASE_URL, 'Frontend');

  const apiBase = resolveApiBase(currentEnv);
  const statusUrl = `${apiBase}/auth/status`;
  let statusResult;
  try {
    statusResult = await fetchJson(statusUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Backend auth status is not reachable at ${statusUrl} (${reason}). ` +
        'Start the backend, or set PLAYWRIGHT_API_BASE_URL/DATAINFRA_API to the live backend /api/v1 URL.',
    );
  }
  if (!statusResult.ok) {
    throw new Error(
      `Backend auth status failed at ${statusUrl}: HTTP ${statusResult.status}. ` +
        'Check the backend logs before rerunning npm run test:e2e:live.',
    );
  }

  const status = statusResult.body || {};
  if (status.auth_enabled === false || status.authenticated) return;

  if (status.password_set === false) {
    throw new Error(
      'Auth setup is incomplete: /auth/status reports auth_enabled=true password_set=false. ' +
        'Open the web UI once, create the local administrator password, then run ' +
        'DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt.',
    );
  }

  if (currentEnv.DATAINFRA_TOKEN_FILE || currentEnv.DATAINFRA_TOKEN) {
    const token = currentEnv.DATAINFRA_TOKEN || readTokenFileForPreflight(currentEnv.DATAINFRA_TOKEN_FILE);
    const tokenStatus = await fetchJson(statusUrl, {
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
    if (!tokenStatus.ok || tokenStatus.body?.authenticated !== true) {
      throw new Error(
        `${describeCredential(currentEnv)} is configured, but ${statusUrl} still reports authenticated=false. ` +
          'Regenerate the token with DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt, ' +
          'then rerun with DATAINFRA_TOKEN_FILE=tmp/eval-token.txt.',
      );
    }
    return;
  }

  if (currentEnv.DATAINFRA_PASSWORD) return;

  throw new Error(
    'No browser auth credential is configured while /auth/status reports auth_enabled=true authenticated=false. ' +
      `The default token file was not found at ${defaultTokenFile}. ` +
      'Run DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt, ' +
      'then rerun npm run test:e2e:live.',
  );
}

const playwrightCli = resolvePlaywrightCli();
const playwrightArgs = [
  playwrightCli,
  'test',
  'e2e/live-localhost.spec.ts',
  ...forwardedArgs,
];

if (dryRun) {
  console.log(`cwd=${frontendDir}`);
  console.log(`PLAYWRIGHT_SKIP_WEBSERVER=${env.PLAYWRIGHT_SKIP_WEBSERVER}`);
  console.log(`PLAYWRIGHT_BASE_URL=${env.PLAYWRIGHT_BASE_URL}`);
  console.log(`PLAYWRIGHT_API_BASE_URL=${resolveApiBase(env)}`);
  console.log(`DEFAULT_DATAINFRA_TOKEN_FILE=${defaultTokenFile}`);
  console.log(`DATAINFRA_TOKEN_FILE=${env.DATAINFRA_TOKEN_FILE || ''}`);
  console.log(`credential=${describeCredential(env) || ''}`);
  console.log(`preflight_only=${preflightOnly}`);
  console.log(`command=${process.execPath} ${playwrightArgs.join(' ')}`);
  process.exit(0);
}

let preflightPassed = true;
let launchPlaywright = !preflightOnly;
if (preflightOnly || envFlag(env.DATAINFRA_LIVE_SKIP_PREFLIGHT) !== true) {
  try {
    await preflightLiveLocalhost(env);
    if (preflightOnly) {
      console.log('Live localhost E2E preflight passed.');
      console.log(`frontend=${env.PLAYWRIGHT_BASE_URL}`);
      console.log(`api=${resolveApiBase(env)}`);
      console.log(`credential=${describeCredential(env) || 'not required'}`);
      launchPlaywright = false;
    }
  } catch (error) {
    console.error('Live localhost E2E preflight failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    preflightPassed = false;
    launchPlaywright = false;
  }
}

if (!preflightPassed || !launchPlaywright) {
  await new Promise((resolve) => setImmediate(resolve));
} else {
  let launchFailed = false;
  try {
    assertPlaywrightCliAvailable(playwrightCli);
  } catch (error) {
    console.error('Live localhost E2E launch failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    launchFailed = true;
  }

  if (launchFailed) {
    await new Promise((resolve) => setImmediate(resolve));
  } else {
    const child = spawn(process.execPath, playwrightArgs, {
      cwd: frontendDir,
      env,
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
  }
}
