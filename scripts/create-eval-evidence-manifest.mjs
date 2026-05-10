#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUT = path.join('output', 'playwright', 'evidence-manifest.json');
const DEFAULT_DIRS = [
  path.join('output', 'playwright', 'live-ui-private-current'),
  path.join('output', 'playwright', 'eval-private-perf-current'),
  path.join('output', 'playwright', 'eval-vision-direct-profile-round3-after'),
  path.join('output', 'playwright', 'eval-vision-direct-visual-round3-after'),
];

function usage() {
  console.log(`Usage:
  node scripts/create-eval-evidence-manifest.mjs [--out path] [artifact-dir ...]

Creates a privacy-preserving manifest for local maintainer evaluation outputs.
It stores artifact-relative paths, sizes, sha256 hashes, and selected summary
metrics. It does not read private input files or write original filenames.
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  let out = DEFAULT_OUT;
  const dirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      out = argv[++index] || out;
      continue;
    }
    if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    dirs.push(arg);
  }
  return { out, dirs: dirs.length > 0 ? dirs : DEFAULT_DIRS };
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

function sanitizeSummary(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeSummary);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'files' && Array.isArray(item)) {
      output.file_count = item.length;
      output.files_sha256 = shortHash(JSON.stringify(item));
      continue;
    }
    if (key === 'image' && typeof item === 'string') {
      output.image_sha256 = shortHash(item);
      continue;
    }
    if (key === 'input' && item && typeof item === 'object') {
      output.input = sanitizeSummary(item);
      continue;
    }
    if (key === 'path' || key === 'private_path' || key === 'input_path') continue;
    if (typeof item === 'string' && /[A-Za-z]:\\|\/mnt\/|\\ceshi|ceshi|D:\\/i.test(item)) {
      output[`${key}_sha256`] = shortHash(item);
      continue;
    }
    output[key] = sanitizeSummary(item);
  }
  return output;
}

function sanitizeLabel(value, fallback) {
  const text = String(value || fallback || 'artifact');
  if (/ceshi|private|[A-Za-z]:\\|\/mnt\/|\/Users\/|\/home\//i.test(text)) {
    return fallback || `artifact-${shortHash(text)}`;
  }
  return text;
}

function sanitizeArgv(argv) {
  return argv.map((arg) => {
    if (typeof arg !== 'string') return arg;
    if (/[A-Za-z]:\\|\/mnt\/|\/Users\/|\/home\/|\\ceshi|ceshi/i.test(arg)) {
      return `<redacted:${shortHash(arg)}>`;
    }
    return arg;
  });
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

async function inspectArtifactDir(dir) {
  const absolute = path.resolve(dir);
  const entry = {
    label: sanitizeLabel(path.basename(dir), `artifact-${shortHash(absolute)}`),
    dir_sha256: shortHash(absolute),
    exists: existsSync(absolute),
    files: [],
  };
  if (!entry.exists) return entry;

  const files = await listFiles(absolute);
  for (const file of files) {
    const buffer = await readFile(file);
    const info = await stat(file);
    const relative = path.relative(absolute, file).replaceAll('\\', '/');
    entry.files.push({
      path: relative,
      bytes: info.size,
      sha256: sha256Buffer(buffer),
    });
    if (relative === 'summary.json' || relative === 'local-profile-summary.json') {
      try {
        entry.summary = sanitizeSummary(JSON.parse(buffer.toString('utf8')));
      } catch {
        entry.summary_parse_error = true;
      }
    }
  }
  return entry;
}

const args = parseArgs(process.argv.slice(2));
const artifacts = [];
for (const dir of args.dirs) artifacts.push(await inspectArtifactDir(dir));
const manifest = {
  generated_at: new Date().toISOString(),
  privacy: {
    private_inputs_read: false,
    private_paths_redacted: true,
    note: 'Hashes cover generated local artifacts only; source private files are not read.',
  },
  command: {
    argv: sanitizeArgv(process.argv.slice(2)),
    cwd_sha256: shortHash(process.cwd()),
  },
  artifacts,
};

await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`evidence manifest: ${args.out}`);
console.log(`artifacts=${artifacts.length} files=${artifacts.reduce((sum, item) => sum + item.files.length, 0)}`);
