// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { request, type FullConfig, type StorageState } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_STORAGE_STATE = path.join('e2e', '.auth', 'storage-state.json');
const DEFAULT_BROWSER_BASE_URL = 'http://127.0.0.1:3000';
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

function envFlag(value: string | undefined): boolean | null {
  if (value == null || value === '') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

type Env = Record<string, string | undefined>;

function hasBrowserAuthCredential(env: Env): boolean {
  return Boolean(env.DATAINFRA_PASSWORD || env.DATAINFRA_TOKEN || env.DATAINFRA_TOKEN_FILE);
}

function shouldPrepareAuth(env: Env): boolean {
  const explicit = envFlag(env.PLAYWRIGHT_AUTH);
  if (explicit != null) return explicit;
  if (env.PLAYWRIGHT_AUTH_STORAGE || env.PLAYWRIGHT_AUTH_STORAGE_STATE) return true;
  return Boolean(env.PLAYWRIGHT_BASE_URL && hasBrowserAuthCredential(env));
}

function storageStatePath(env: Env): string {
  return path.resolve(
    env.PLAYWRIGHT_AUTH_STORAGE || env.PLAYWRIGHT_AUTH_STORAGE_STATE || DEFAULT_STORAGE_STATE,
  );
}

function firstProjectBaseURL(config: FullConfig): string {
  const configured = config.projects[0]?.use?.baseURL;
  if (typeof configured === 'string' && configured) return configured;
  return process.env.PLAYWRIGHT_BASE_URL || DEFAULT_BROWSER_BASE_URL;
}

function resolveApiBase(config: FullConfig, env: Env): string {
  const raw =
    env.PLAYWRIGHT_API_BASE_URL ||
    env.DATAINFRA_API ||
    'http://127.0.0.1:8000/api/v1';
  const withoutTrailingSlash = raw.replace(/\/+$/, '');
  const apiBase = withoutTrailingSlash.endsWith('/api/v1')
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api/v1`;
  return `${apiBase}/`;
}

function apiUrl(apiBase: string, path: string): string {
  return `${apiBase}${path.replace(/^\/+/, '')}`;
}

async function readJsonResponse<T>(response: { text: () => Promise<string> }, url: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${url} did not return JSON. ` +
        'Set PLAYWRIGHT_API_BASE_URL or DATAINFRA_API to the backend /api/v1 URL when testing an already-running frontend.',
    );
  }
}

function repoRootCandidate(): string {
  return path.basename(process.cwd()).toLowerCase() === 'frontend'
    ? path.resolve(process.cwd(), '..')
    : process.cwd();
}

function resolveTokenFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(repoRootCandidate(), filePath),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[1];
}

function tokenFileCandidates(filePath: string): string[] {
  if (path.isAbsolute(filePath)) return [filePath];
  return Array.from(
    new Set([
      path.resolve(process.cwd(), filePath),
      path.resolve(repoRootCandidate(), filePath),
    ]),
  );
}

async function readToken(env: Env): Promise<string> {
  if (env.DATAINFRA_TOKEN) return env.DATAINFRA_TOKEN.trim();
  if (env.DATAINFRA_TOKEN_FILE) {
    const tokenPath = resolveTokenFilePath(env.DATAINFRA_TOKEN_FILE);
    let token = '';
    try {
      token = (await readFile(tokenPath, 'utf8')).trim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const candidates = tokenFileCandidates(env.DATAINFRA_TOKEN_FILE).join('", "');
      throw new Error(
        `DATAINFRA_TOKEN_FILE="${env.DATAINFRA_TOKEN_FILE}" could not be read. ` +
          `Tried "${candidates}". Relative token paths are resolved from the Playwright cwd ` +
          `("${process.cwd()}") and the repo root ("${repoRootCandidate()}"). ${reason}`,
      );
    }
    if (!token) {
      throw new Error(
        `DATAINFRA_TOKEN_FILE="${env.DATAINFRA_TOKEN_FILE}" resolved to "${tokenPath}", but the file is empty.`,
      );
    }
    return token;
  }
  return '';
}

function accessTokenCookie(cookieBase: string, token: string): StorageState['cookies'][number] {
  const origin = new URL(cookieBase);
  return {
    name: 'access_token',
    value: token,
    domain: origin.hostname,
    path: '/',
    expires: 4102444800,
    httpOnly: true,
    secure: origin.protocol === 'https:',
    sameSite: 'Strict',
  };
}

async function saveStorageState(filePath: string, state: StorageState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function withCompletedOnboarding(browserBase: string, state: StorageState): StorageState {
  const origin = new URL(browserBase).origin;
  const origins = state.origins.filter((entry) => entry.origin !== origin);
  const existing = state.origins.find((entry) => entry.origin === origin);
  const localStorage = [
    ...(existing?.localStorage ?? []).filter((entry) => entry.name !== ONBOARDING_COMPLETED_KEY),
    { name: ONBOARDING_COMPLETED_KEY, value: 'true' },
  ];

  return {
    ...state,
    origins: [...origins, { origin, localStorage }],
  };
}

export default async function globalSetup(config: FullConfig) {
  const env = process.env;
  if (!shouldPrepareAuth(env)) return;

  const browserBase = firstProjectBaseURL(config);
  const apiBase = resolveApiBase(config, env);
  const outPath = storageStatePath(env);
  const api = await request.newContext({ baseURL: apiBase });

  try {
    const statusResponse = await api.get('auth/status');
    if (!statusResponse.ok()) {
      throw new Error(`GET ${apiUrl(apiBase, 'auth/status')} failed: HTTP ${statusResponse.status()}`);
    }
    const statusText = await statusResponse.text();
    let status: {
      auth_enabled?: boolean;
      authenticated?: boolean;
      password_set?: boolean | null;
    };
    try {
      status = JSON.parse(statusText) as typeof status;
    } catch {
      throw new Error(
        `GET ${apiUrl(apiBase, 'auth/status')} did not return JSON. ` +
          'Set PLAYWRIGHT_API_BASE_URL or DATAINFRA_API to the backend /api/v1 URL when testing an already-running frontend.',
      );
    }

    if (status.auth_enabled === false || status.authenticated) {
      await saveStorageState(outPath, withCompletedOnboarding(browserBase, await api.storageState()));
      return;
    }

    const token = await readToken(env);
    if (token) {
      const tokenStatusResponse = await api.get('auth/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!tokenStatusResponse.ok()) {
        throw new Error(
          `GET ${apiUrl(apiBase, 'auth/status')} with DATAINFRA_TOKEN_FILE/DATAINFRA_TOKEN failed: HTTP ${tokenStatusResponse.status()}`,
        );
      }
      const tokenStatus = await readJsonResponse<{ authenticated?: boolean }>(
        tokenStatusResponse,
        apiUrl(apiBase, 'auth/status'),
      );
      if (!tokenStatus.authenticated) {
        throw new Error(
          'DATAINFRA_TOKEN_FILE/DATAINFRA_TOKEN was read, but /auth/status still reports authenticated=false. ' +
            'Regenerate the token with DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt.',
        );
      }
      const state = await api.storageState();
      const existing = state.cookies.filter((cookie) => cookie.name !== 'access_token');
      await saveStorageState(
        outPath,
        withCompletedOnboarding(browserBase, {
          ...state,
          cookies: [...existing, accessTokenCookie(browserBase, token)],
        }),
      );
      return;
    }

    if (!env.DATAINFRA_PASSWORD) {
      throw new Error(
        'Set DATAINFRA_PASSWORD, DATAINFRA_TOKEN, or DATAINFRA_TOKEN_FILE for PLAYWRIGHT_AUTH=1.',
      );
    }

    const loginResponse = await api.post('auth/login', {
      data: { password: env.DATAINFRA_PASSWORD },
    });
    if (!loginResponse.ok()) {
      const detail = await loginResponse.text().catch(() => '');
      throw new Error(
        `POST ${apiUrl(apiBase, 'auth/login')} failed: HTTP ${loginResponse.status()} ${detail}`.trim(),
      );
    }
    const loginBody = (await loginResponse.json().catch(() => ({}))) as { access_token?: string };

    const verifyResponse = await api.get('auth/status');
    const verified = verifyResponse.ok()
      ? ((await verifyResponse.json()) as { authenticated?: boolean })
      : null;
    if (!verified?.authenticated) {
      throw new Error('Playwright login succeeded but /auth/status is still unauthenticated.');
    }
    const state = await api.storageState();
    await saveStorageState(
      outPath,
      withCompletedOnboarding(
        browserBase,
        loginBody.access_token
          ? {
              ...state,
              cookies: [
                ...state.cookies.filter(
                  (cookie) =>
                    cookie.name !== 'access_token' ||
                    cookie.domain !== new URL(browserBase).hostname,
                ),
                accessTokenCookie(browserBase, loginBody.access_token),
              ],
            }
          : state,
      ),
    );
  } finally {
    await api.dispose();
  }
}
