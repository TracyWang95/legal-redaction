// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFiles } from './env.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_EVAL_TOKEN_FILE = path.join(rootDir, 'tmp', 'eval-token.txt');

export function requireArg(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

export function authHeaders(token, extra = {}) {
  if (!token) return { ...extra };
  return { Authorization: `Bearer ${token}`, ...extra };
}

export async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = typeof body === 'object' && body ? body.detail || body.message : body;
    throw new Error(`${options.method || 'GET'} ${url} failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  return body;
}

export async function tryRequestJson(url, options = {}) {
  try {
    return await requestJson(url, options);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function login(apiBase, password) {
  const body = await requestJson(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return requireArg(body?.access_token, 'Login succeeded but did not return access_token');
}

export function resolveTokenFilePath(filePath) {
  if (!filePath || path.isAbsolute(filePath)) return filePath;
  const cwdPath = path.resolve(process.cwd(), filePath);
  if (existsSync(cwdPath)) return cwdPath;
  return path.resolve(rootDir, filePath);
}

export function resolveDefaultTokenFile(env = process.env) {
  return resolveTokenFilePath(env.DATAINFRA_DEFAULT_TOKEN_FILE || DEFAULT_EVAL_TOKEN_FILE);
}

async function readTokenFile(filePath) {
  const resolvedPath = resolveTokenFilePath(filePath);
  let raw = '';
  try {
    raw = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `DATAINFRA_TOKEN_FILE is set but cannot be read: ${resolvedPath}. ${reason}\n` +
        'Create a local ignored token file with: DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt\n' +
        'Then rerun with: DATAINFRA_TOKEN_FILE=tmp/eval-token.txt npm run eval:batch-e2e -- output/playwright/eval-batch-current',
    );
  }
  const token = raw.trim();
  return requireArg(token, `DATAINFRA_TOKEN_FILE is empty: ${resolvedPath}`);
}

function envDisablesAuth(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').trim().toLowerCase());
}

function missingCredentialMessage(authStatus, defaultTokenFile) {
  const passwordState = authStatus?.password_set === false
    ? ' The backend reports auth is enabled but no password has been created yet; open the web UI once to set the local administrator password.'
    : '';
  return (
    'Set DATAINFRA_PASSWORD, DATAINFRA_TOKEN, or DATAINFRA_TOKEN_FILE before running eval.' +
    passwordState +
    `\nNo default local token file was found at: ${defaultTokenFile}` +
    '\nRecommended local flow:' +
    '\n  DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt' +
    '\n  DATAINFRA_TOKEN_FILE=tmp/eval-token.txt npm run eval:batch-e2e -- output/playwright/eval-batch-current' +
    '\nDo not commit token files; tmp/eval-token.txt is intended for local ignored credentials.'
  );
}

export async function resolveAuthToken(apiBase, env = process.env) {
  const resolvedEnv = resolveEvalEnv(env);
  const authStatus = await tryRequestJson(`${apiBase}/auth/status`);
  if (authStatus?.auth_enabled === false) {
    return { token: null, authStatus };
  }
  if (authStatus?.error && envDisablesAuth(resolvedEnv.AUTH_ENABLED)) {
    return {
      token: null,
      authStatus,
      authDisabledByEnv: true,
    };
  }
  if (resolvedEnv.DATAINFRA_TOKEN) {
    return { token: resolvedEnv.DATAINFRA_TOKEN, authStatus };
  }
  if (resolvedEnv.DATAINFRA_TOKEN_FILE) {
    return { token: await readTokenFile(resolvedEnv.DATAINFRA_TOKEN_FILE), authStatus };
  }
  const defaultTokenFile = resolveDefaultTokenFile(resolvedEnv);
  if (!resolvedEnv.DATAINFRA_PASSWORD && existsSync(defaultTokenFile)) {
    return {
      token: await readTokenFile(defaultTokenFile),
      authStatus,
      tokenFile: defaultTokenFile,
      tokenSource: 'default-token-file',
    };
  }
  const password = requireArg(
    resolvedEnv.DATAINFRA_PASSWORD,
    missingCredentialMessage(authStatus, defaultTokenFile),
  );
  return {
    token: await login(apiBase, password),
    authStatus,
  };
}

export function resolveEvalEnv(env = process.env) {
  if (env !== process.env) return env;
  loadDotEnvFiles(rootDir, { env, files: ['.env'] });
  return env;
}
