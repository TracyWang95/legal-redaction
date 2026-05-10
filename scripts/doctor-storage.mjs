#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFiles } from './env.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const maxEntriesDefault = Number.parseInt(process.env.DATAINFRA_STORAGE_DOCTOR_MAX_ENTRIES || '', 10) || 200000;

function usage() {
  console.log(`Usage:
  npm run doctor:storage
  npm run doctor:storage:dry
  node scripts/doctor-storage.mjs --json

Reports local disk and cache pressure without deleting anything.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    json: false,
    maxEntries: maxEntriesDefault,
  };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run' || arg === '--dry') {
      options.dryRun = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--max-entries=')) {
      const value = Number.parseInt(arg.slice('--max-entries='.length), 10);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid --max-entries value: ${arg}`);
      options.maxEntries = value;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function estimateDirectorySize(targetPath, options) {
  const stat = safeStat(targetPath);
  if (!stat) return null;
  if (stat.isFile()) {
    return {
      bytes: stat.size,
      entries: 1,
      skipped: 0,
      approximate: false,
      kind: 'file',
    };
  }
  if (!stat.isDirectory()) return null;

  const queue = [targetPath];
  let bytes = 0;
  let entries = 0;
  let skipped = 0;
  let approximate = false;

  while (queue.length > 0) {
    const current = queue.shift();
    let dirents;
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      skipped += 1;
      approximate = true;
      continue;
    }

    for (const dirent of dirents) {
      entries += 1;
      if (entries > options.maxEntries) {
        approximate = true;
        return { bytes, entries, skipped, approximate, kind: 'directory' };
      }

      const childPath = path.join(current, dirent.name);
      if (dirent.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      if (dirent.isDirectory()) {
        queue.push(childPath);
        continue;
      }
      if (!dirent.isFile()) continue;

      const childStat = safeStat(childPath);
      if (childStat) bytes += childStat.size;
      else {
        skipped += 1;
        approximate = true;
      }
    }
  }

  return { bytes, entries, skipped, approximate, kind: 'directory' };
}

function addPathCandidate(candidates, seen, label, targetPath, category, notes = []) {
  if (!targetPath) return;
  const resolved = path.resolve(targetPath);
  const key = isWindows ? resolved.toLowerCase() : resolved;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ label, path: resolved, category, notes });
}

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function collectCacheCandidates(env) {
  const candidates = [];
  const seen = new Set();
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const tempDirs = uniquePaths([env.TEMP, env.TMP, path.join(os.tmpdir()), isWindows ? 'C:\\Windows\\Temp' : '/tmp']);

  addPathCandidate(candidates, seen, 'pip cache', path.join(localAppData, 'pip', 'Cache'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'pip cache (home)', homePath('.cache', 'pip'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'npm cache', path.join(localAppData, 'npm-cache'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'npm cache (home)', homePath('.npm'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'pnpm store', path.join(localAppData, 'pnpm', 'store'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'pnpm store', path.join(localAppData, 'pnpm-store'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'pnpm store (roaming)', path.join(appData, 'pnpm', 'store'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'Hugging Face cache', env.HF_HOME || homePath('.cache', 'huggingface'), 'rebuildable-cache', [
    'model files can be downloaded again, but the next model start may be slow and network-heavy',
  ]);
  addPathCandidate(candidates, seen, 'Hugging Face hub cache', env.HUGGINGFACE_HUB_CACHE, 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'PaddleX cache', homePath('.cache', 'paddlex'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'Paddle cache', homePath('.cache', 'paddle'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'PaddleOCR cache', homePath('.paddleocr'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'Gemini cache', homePath('.gemini', 'cache'), 'rebuildable-cache');
  addPathCandidate(candidates, seen, 'Gemini tmp', homePath('.gemini', 'tmp'), 'rebuildable-cache');
  for (const tempDir of tempDirs) {
    addPathCandidate(candidates, seen, tempDir.toLowerCase().includes('windows') ? 'Windows Temp' : 'user Temp', tempDir, 'rebuildable-temp');
  }

  return candidates;
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    const key = isWindows ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function collectVenvCandidates(env) {
  const venvDir = env.VENV_DIR || '.venv';
  const vllmVenvDir = env.VLLM_VENV_DIR || '.venv-vllm';
  const protectedPaths = [
    {
      label: 'app venv',
      path: resolveProjectPath(venvDir),
      category: 'keep-current-venv',
      notes: ['current app/PaddleOCR/HaS environment; keep unless intentionally rebuilding with npm run setup'],
    },
    {
      label: 'vLLM venv',
      path: resolveProjectPath(vllmVenvDir),
      category: 'keep-current-venv',
      notes: ['current vLLM/PyTorch/CUDA environment; keep unless intentionally rebuilding with npm run setup'],
    },
  ];

  if (isWindows) {
    protectedPaths.push({
      label: 'Codex home',
      path: env.CODEX_HOME || homePath('.codex'),
      category: 'keep-tool-state',
      notes: ['agent runtime, skills, sessions, and tool state; do not clear as part of project dependency cleanup'],
      scan: false,
    });
    protectedPaths.push({
      label: 'Claude local package data',
      path: path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Packages', 'Claude_pzs8sxrjxfjjc'),
      category: 'keep-tool-state',
      notes: ['Claude application state/cache; leave untouched unless explicitly managing the Claude app'],
      scan: false,
    });
  }

  return protectedPaths;
}

function resolveProjectPath(value) {
  if (!value) return '';
  if (/^\/[^/]/.test(value) && isWindows) return value;
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function isWslPath(value) {
  return isWindows && /^\/[^/]/.test(value || '');
}

function collectWslVhdxFiles(env) {
  if (!isWindows) return [];
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [];

  collectVhdxFromPackages(path.join(localAppData, 'Packages'), candidates);
  collectVhdxRecursive(path.join(localAppData, 'wsl'), candidates);
  for (const dockerPath of [
    path.join(localAppData, 'Docker', 'wsl', 'data', 'ext4.vhdx'),
    path.join(localAppData, 'Docker', 'wsl', 'distro', 'ext4.vhdx'),
  ]) {
    if (pathExists(dockerPath)) candidates.push(dockerPath);
  }

  return uniquePaths(candidates).map((targetPath) => {
    const stat = safeStat(targetPath);
    return {
      label: path.basename(path.dirname(path.dirname(targetPath))) || 'WSL ext4.vhdx',
      path: targetPath,
      bytes: stat?.size || 0,
    };
  });
}

function collectVhdxRecursive(startDir, candidates) {
  const queue = [startDir];
  const maxDirs = 1000;
  let scanned = 0;

  while (queue.length > 0 && scanned < maxDirs) {
    const current = queue.shift();
    scanned += 1;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(childPath);
      } else if (entry.isFile() && entry.name.toLowerCase() === 'ext4.vhdx') {
        candidates.push(childPath);
      }
    }
  }
}

function collectVhdxFromPackages(packagesDir, candidates) {
  let entries;
  try {
    entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const vhdx = path.join(packagesDir, entry.name, 'LocalState', 'ext4.vhdx');
    if (pathExists(vhdx)) candidates.push(vhdx);
  }
}

function readWindowsCDrive() {
  if (!isWindows) return null;
  const command = [
    "$d = Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\";",
    'if ($d) { [Console]::Out.Write(($d.FreeSpace.ToString() + "," + $d.Size.ToString())) }',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const [freeRaw, totalRaw] = result.stdout.trim().split(',');
  const freeBytes = Number.parseInt(freeRaw, 10);
  const totalBytes = Number.parseInt(totalRaw, 10);
  if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes)) return null;
  return {
    mount: 'C:',
    freeBytes,
    totalBytes,
    usedPercent: totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : null,
  };
}

function readCurrentFsDrive() {
  if (!fs.statfsSync) return null;
  try {
    const stat = fs.statfsSync(rootDir);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    return {
      mount: rootDir,
      freeBytes,
      totalBytes,
      usedPercent: totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : null,
    };
  } catch {
    return null;
  }
}

function readWslCacheSizes() {
  if (!isWindows) return [];
  const script = [
    'for p in "$HOME/.cache/uv" "$HOME/.cache/pip"; do',
    '  if [ -e "$p" ]; then du -sb "$p" 2>/dev/null; fi',
    'done',
  ].join(' ');
  const result = spawnSync('wsl.exe', ['sh', '-lc', script], {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      const targetPath = match[2];
      return {
        label: `WSL ${path.posix.basename(targetPath)} cache`,
        path: targetPath,
        bytes: Number.parseInt(match[1], 10),
        category: 'rebuildable-cache',
      };
    })
    .filter(Boolean);
}

function readWslPathSize(targetPath) {
  if (!isWslPath(targetPath)) return null;
  const script = 'if [ -e "$1" ]; then du -sb "$1" 2>/dev/null; fi';
  const result = spawnSync('wsl.exe', ['sh', '-lc', script, 'sh', targetPath], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;

  const match = result.stdout.trim().match(/^(\d+)\s+.+$/);
  if (!match) return null;
  return {
    bytes: Number.parseInt(match[1], 10),
    entries: null,
    skipped: 0,
    approximate: false,
    kind: 'directory',
  };
}

function buildDryRunReport() {
  return {
    mode: 'dry-run',
    generatedAt: new Date(0).toISOString(),
    disks: [
      {
        mount: 'C:',
        freeBytes: 80 * 1024 ** 3,
        totalBytes: 512 * 1024 ** 3,
        usedPercent: 84.4,
      },
    ],
    wslVhdx: [
      {
        label: 'CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc',
        path: '%LOCALAPPDATA%\\Packages\\CanonicalGroupLimited.Ubuntu_79rhkp1fndgsc\\LocalState\\ext4.vhdx',
        bytes: 120 * 1024 ** 3,
      },
    ],
    caches: [
      {
        label: 'pip cache',
        path: '%LOCALAPPDATA%\\pip\\Cache',
        category: 'rebuildable-cache',
        size: { bytes: 2 * 1024 ** 3, entries: 100, skipped: 0, approximate: false, kind: 'directory' },
      },
      {
        label: 'Hugging Face cache',
        path: '%USERPROFILE%\\.cache\\huggingface',
        category: 'rebuildable-cache',
        size: { bytes: 30 * 1024 ** 3, entries: 100, skipped: 0, approximate: false, kind: 'directory' },
      },
      {
        label: 'WSL uv cache',
        path: '~/.cache/uv',
        category: 'rebuildable-cache',
        size: { bytes: 4 * 1024 ** 3, entries: null, skipped: 0, approximate: false, kind: 'directory' },
      },
    ],
    protected: [
      {
        label: 'app venv',
        path: path.join(rootDir, '.venv'),
        category: 'keep-current-venv',
        size: { bytes: 8 * 1024 ** 3, entries: 100, skipped: 0, approximate: false, kind: 'directory' },
      },
      {
        label: 'vLLM venv',
        path: path.join(rootDir, '.venv-vllm'),
        category: 'keep-current-venv',
        size: { bytes: 22 * 1024 ** 3, entries: 100, skipped: 0, approximate: false, kind: 'directory' },
      },
    ],
    skipped: [
      { label: 'npm cache', path: '%LOCALAPPDATA%\\npm-cache', reason: 'not found' },
    ],
  };
}

function buildReport(options) {
  if (options.dryRun) return buildDryRunReport();

  loadDotEnvFiles(rootDir);
  const env = process.env;
  const report = {
    mode: 'scan',
    generatedAt: new Date().toISOString(),
    disks: [],
    wslVhdx: collectWslVhdxFiles(env),
    caches: [],
    protected: [],
    skipped: [],
  };

  const cDrive = readWindowsCDrive();
  if (cDrive) report.disks.push(cDrive);
  else if (!isWindows) {
    const currentFs = readCurrentFsDrive();
    if (currentFs) report.disks.push(currentFs);
  }

  for (const candidate of collectCacheCandidates(env)) {
    const size = estimateDirectorySize(candidate.path, options);
    if (!size) {
      report.skipped.push({ label: candidate.label, path: candidate.path, reason: 'not found or not readable' });
      continue;
    }
    report.caches.push({ ...candidate, size });
  }

  for (const candidate of collectVenvCandidates(env)) {
    const size =
      candidate.scan === false
        ? null
        : isWslPath(candidate.path)
          ? readWslPathSize(candidate.path)
          : estimateDirectorySize(candidate.path, options);
    if (!size) {
      const missing = candidate.scan === false ? !pathExists(candidate.path) : true;
      report.protected.push({ ...candidate, size: null, missing, sizeDeferred: candidate.scan === false && !missing });
      if (missing) {
        report.skipped.push({ label: candidate.label, path: candidate.path, reason: 'not found or not readable' });
      }
      continue;
    }
    report.protected.push({ ...candidate, size });
  }

  for (const cache of readWslCacheSizes()) {
    report.caches.push({
      label: cache.label,
      path: cache.path,
      category: cache.category,
      size: {
        bytes: cache.bytes,
        entries: null,
        skipped: 0,
        approximate: false,
        kind: 'directory',
      },
    });
  }

  report.caches.sort((a, b) => b.size.bytes - a.size.bytes);
  report.protected.sort((a, b) => (b.size?.bytes || 0) - (a.size?.bytes || 0));
  report.wslVhdx.sort((a, b) => b.bytes - a.bytes);

  return report;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'unknown';
}

function sizeSuffix(size) {
  if (!size) return '';
  const flags = [];
  if (size.approximate) flags.push('approx');
  if (size.skipped) flags.push(`${size.skipped} skipped`);
  return flags.length ? ` (${flags.join(', ')})` : '';
}

function printReport(report) {
  console.log(`storage doctor: ${report.mode === 'dry-run' ? 'dry run fixture' : 'read-only scan'}`);
  console.log('scope: reports sizes only; no files are deleted or changed');

  console.log('\nDisk');
  if (report.disks.length === 0) {
    console.log('- C: unavailable; run from Windows PowerShell for C drive free-space details');
  } else {
    for (const disk of report.disks) {
      const mountLabel = disk.mount.endsWith(':') ? disk.mount : `${disk.mount}:`;
      console.log(
        `- ${mountLabel} ${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)} (${formatPercent(
          disk.usedPercent,
        )} used)`,
      );
    }
  }

  console.log('\nWSL ext4.vhdx');
  if (report.wslVhdx.length === 0) {
    console.log('- none found; WSL may be absent or installed in a non-default location');
  } else {
    for (const item of report.wslVhdx) {
      console.log(`- ${formatBytes(item.bytes)}  ${item.path}`);
    }
  }

  console.log('\nRebuildable caches and temp');
  if (report.caches.length === 0) {
    console.log('- no configured cache paths were found');
  } else {
    for (const item of report.caches) {
      console.log(`- ${formatBytes(item.size.bytes)}${sizeSuffix(item.size)}  ${item.label}: ${item.path}`);
    }
  }

  console.log('\nKeep');
  if (report.protected.length === 0) {
    console.log('- no current app/vLLM venv paths are configured');
  } else {
    for (const item of report.protected) {
      if (item.missing) {
        console.log(`- not found  ${item.label}: ${item.path}`);
        continue;
      }
      if (item.sizeDeferred) {
        console.log(`- keep  ${item.label}: ${item.path}`);
        continue;
      }
      console.log(`- ${formatBytes(item.size.bytes)}${sizeSuffix(item.size)}  ${item.label}: ${item.path}`);
    }
  }

  console.log('\nRecommendations');
  console.log('- Safe first targets: pip, npm, pnpm, uv, Hugging Face, Paddle/PaddleX, Gemini, and Temp caches. They are rebuildable, but the next install/model start may be slower or require network.');
  console.log('- Keep the current app venv and vLLM venv listed above unless you plan to rebuild them with npm run setup.');
  console.log('- Leave Codex and Claude application data alone unless you are explicitly managing those tools outside this project.');
  console.log('- Do not delete an ext4.vhdx file directly. To compact a WSL VHD, stop WSL services first; WSL VHD compaction interrupts running WSL shells, Docker/WSL services, and model servers.');
  console.log('- If C: free space is low, clear rebuildable caches first, then compact WSL VHD only after caches inside WSL have been removed and WSL has been stopped.');

  if (report.skipped.length > 0) {
    console.log(`\nSkipped missing/unreadable paths: ${report.skipped.length}`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
} catch (error) {
  console.error(`storage doctor failed: ${error.message}`);
  process.exit(1);
}
