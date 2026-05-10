#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { login, requestJson, requireArg, resolveDefaultTokenFile, resolveEvalEnv } from './eval-auth.mjs';

const DEFAULT_API = 'http://127.0.0.1:8000/api/v1';

function usage() {
  console.log(`Usage:
  DATAINFRA_PASSWORD=... npm run eval:login -- [token-file]

Examples:
  DATAINFRA_PASSWORD=... npm run eval:login -- tmp/eval-token.txt
  DATAINFRA_TOKEN_FILE=tmp/eval-token.txt npm run eval:batch-e2e -- output/playwright/eval-batch-current private corpus\\file.pdf

Options via env:
  DATAINFRA_API        API base, default ${DEFAULT_API}
  DATAINFRA_PASSWORD   Local app password used to request a token
  DATAINFRA_TOKEN      Existing token to write without logging in
  DATAINFRA_TOKEN_OUT  Default token output path when no CLI path is provided
  DATAINFRA_DEFAULT_TOKEN_FILE  Default local token file, default tmp/eval-token.txt
`);
}

function missingPasswordMessage(status, outPath) {
  const passwordState = status.password_set === false
    ? '\n/auth/status reports password_set=false; open the web UI once and create the local administrator password first.'
    : '';
  return (
    'Set DATAINFRA_PASSWORD to create a token file, or DATAINFRA_TOKEN to persist an existing token.' +
    passwordState +
    `\nDefault token file: ${outPath}` +
    '\nExample: DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt'
  );
}

async function main() {
  const arg = process.argv[2];
  if (arg === '-h' || arg === '--help') {
    usage();
    return;
  }
  const env = resolveEvalEnv();
  const apiBase = (env.DATAINFRA_API || DEFAULT_API).replace(/\/+$/, '');
  const outPath = path.resolve(arg || env.DATAINFRA_TOKEN_OUT || resolveDefaultTokenFile(env));
  const status = await requestJson(`${apiBase}/auth/status`);
  let token = env.DATAINFRA_TOKEN || '';
  if (status.auth_enabled === false) {
    token = '';
  } else if (!token) {
    const password = requireArg(
      env.DATAINFRA_PASSWORD,
      missingPasswordMessage(status, outPath),
    );
    token = await login(apiBase, password);
  }
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, token ? `${token}\n` : '', { encoding: 'utf8', mode: 0o600 });
  console.log(`auth_enabled=${Boolean(status.auth_enabled)} authenticated=${Boolean(status.authenticated)}`);
  console.log(`token_file=${outPath}`);
  if (token) {
    console.log(`set DATAINFRA_TOKEN_FILE=${outPath}`);
  } else {
    console.log('auth is disabled; token file is empty and eval scripts can run without credentials.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
