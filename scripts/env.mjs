// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs';
import path from 'node:path';

export function parseDotEnv(text) {
  const values = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = parseDotEnvValue(line.slice(idx + 1));
  }
  return values;
}

export function parseDotEnvValue(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const parsed = readQuotedValue(value, quote);
    return quote === '"' ? unescapeDoubleQuotedValue(parsed) : parsed;
  }
  return value.replace(/\s+#.*$/, '').trim();
}

export function loadDotEnvFiles(rootDir, options = {}) {
  const env = options.env || process.env;
  const files = options.files || ['.env'];
  const loaded = {};
  for (const file of files) {
    const envPath = path.resolve(rootDir, file);
    if (!fs.existsSync(envPath)) continue;
    const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      loaded[key] = value;
      if (env[key] === undefined) env[key] = value;
    }
  }
  return loaded;
}

function readQuotedValue(value, quote) {
  let escaped = false;
  let result = '';
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"' && char === '\\' && !escaped) {
      escaped = true;
      result += char;
      continue;
    }
    if (char === quote && !escaped) return result;
    escaped = false;
    result += char;
  }
  return value.endsWith(quote) ? value.slice(1, -1) : value.slice(1);
}

function unescapeDoubleQuotedValue(value) {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\r')
    .replaceAll('\\t', '\t')
    .replaceAll('\\"', '"')
    .replaceAll('\\\\', '\\');
}
