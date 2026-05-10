#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadDotEnvFiles } from './env.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const isWsl =
  !isWindows &&
  (Boolean(process.env.WSL_DISTRO_NAME) ||
    os.release().toLowerCase().includes('microsoft'));
const args = new Set(process.argv.slice(2));

loadDotEnvFiles(rootDir, { files: ['.env'] });

const port = Number(process.env.HAS_TEXT_PORT || 8080);
const strict = args.has('--strict') || process.env.npm_config_strict === 'true';
const json = args.has('--json') || process.env.npm_config_json === 'true';
const timeoutMs = Number(process.env.HAS_TEXT_GPU_PREFLIGHT_TIMEOUT_MS || 1500);

function isPosixAbsolutePath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function isWindowsDrivePath(value) {
  return typeof value === 'string' && /^[a-zA-Z]:[\\/]/.test(value);
}

function windowsDrivePathToWslPath(value) {
  if (!isWindowsDrivePath(value)) return value;
  const drive = value[0].toLowerCase();
  const rest = value.slice(2).replaceAll('\\', '/').replace(/^\/+/, '');
  return `/mnt/${drive}/${rest}`;
}

function posixQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function wslPathExists(value) {
  const result = spawnSync(
    'wsl.exe',
    ['bash', '-lc', `test -e ${posixQuote(value)}`],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  return result.status === 0;
}

function normalizeConfiguredPath(value) {
  if (!value) return '';
  if (isWindows && isPosixAbsolutePath(value)) return value;
  if (isWsl && isWindowsDrivePath(value)) return value;
  return path.resolve(value);
}

function quote(value) {
  if (isWindows) return `"${String(value).replaceAll('"', '\\"')}"`;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runQuietCommand(command, commandArgs = [], options = {}) {
  try {
    const result = spawnSync(command, commandArgs, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeoutMs || 5000,
      shell: false,
    });
    return {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      output: `${result.stdout || ''}${result.stderr || ''}`.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function pathExists(value) {
  if (!value) return false;
  if (fs.existsSync(value)) return true;
  if (isWsl && isWindowsDrivePath(value)) {
    return fs.existsSync(windowsDrivePathToWslPath(value));
  }
  if (isWindows && isPosixAbsolutePath(value)) return wslPathExists(value);
  return false;
}

function normalizeDeviceValue(value) {
  return String(value || '')
    .trim()
    .replace(/["']/g, '')
    .toLowerCase();
}

function inferRuntimeProvider(device) {
  const normalized = normalizeDeviceValue(device);
  if (!normalized) return 'default';
  if (normalized === 'cpu') return 'cpu';
  if (normalized.includes('cuda') || /^\d+$/.test(normalized)) return 'cuda';
  if (normalized.includes('vulkan')) return 'vulkan';
  if (normalized.includes('rocm') || normalized.includes('hip')) return 'rocm';
  if (normalized.includes('metal')) return 'metal';
  return 'custom';
}

function assessHasTextRuntimePolicy() {
  const gpuLayers = String(process.env.HAS_TEXT_N_GPU_LAYERS || '-1');
  const device = process.env.HAS_TEXT_DEVICE || '';
  const provider = inferRuntimeProvider(device);
  const layers = String(process.env.HAS_TEXT_N_GPU_LAYERS || '-1');
  const cpuFallback =
    layers === '0' || provider === 'cpu' || provider === 'custom';
  const reasons = [];
  if (layers === '0') reasons.push('HAS_TEXT_N_GPU_LAYERS=0 disables GPU offload');
  if (provider === 'cpu') reasons.push('HAS_TEXT_DEVICE targets CPU');
  if (provider === 'custom') reasons.push('HAS_TEXT_DEVICE has non-standard provider (manual confirm cuda/rocm/vulkan/metal)');
  return {
    gpu_layers: gpuLayers,
    device: device || null,
    provider,
    runtime_mode: layers === '0' ? 'cpu' : 'gpu',
    cpu_fallback_risk: cpuFallback,
    runtime_expectation: 'cuda-gpu',
    risk_reason: reasons.join('; '),
  };
}

function hasTextServerModelPath() {
  return (
    process.env.HAS_TEXT_MODEL_PATH_FOR_SERVER ||
    process.env.HAS_MODEL_PATH ||
    path.join(rootDir, 'backend', 'models', 'has', 'HaS_Text_0209_0.6B_Q4_K_M.gguf')
  );
}

function hasTextCommand() {
  const serverBin = normalizeConfiguredPath(process.env.HAS_TEXT_SERVER_BIN || '');
  if (!serverBin) return null;
  const commandParts = [
    quote(serverBin),
    '-m',
    quote(hasTextServerModelPath()),
    '--host',
    '0.0.0.0',
    '--port',
    String(port),
    '-c',
    process.env.HAS_TEXT_N_CTX || '8192',
    '-ngl',
    process.env.HAS_TEXT_N_GPU_LAYERS || '-1',
    '--chat-template',
    'chatml',
  ];
  if (process.env.HAS_TEXT_DEVICE) {
    commandParts.push('--device', quote(process.env.HAS_TEXT_DEVICE));
  }
  return commandParts.join(' ');
}

async function fetchText(url, requestTimeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: requestTimeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 256_000) req.destroy();
      });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          text: body,
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error(`timeout after ${requestTimeoutMs}ms`));
    });
    req.on('error', (error) => {
      resolve({
        ok: false,
        status: 0,
        text: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function extractModelIds(text) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data.data)) {
      return data.data
        .map((item) => item?.id || item?.model || item?.name)
        .filter(Boolean)
        .map(String);
    }
    return [data.id, data.model, data.name].filter(Boolean).map(String);
  } catch {
    return [];
  }
}

async function probeHasTextHealth() {
  const url = `http://127.0.0.1:${port}/v1/models`;
  const result = await fetchText(url, timeoutMs);
  return {
    url,
    ok: result.ok,
    status: result.status,
    text: result.text.slice(0, 500),
    models: extractModelIds(result.text),
  };
}

function findWindowsPortOwner(targetPort) {
  const command = [
    `$c = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    'if ($null -ne $c) {',
    '  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '  $w = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue',
    '  [pscustomobject]@{listening=$true;pid=$c.OwningProcess;processName=$p.ProcessName;commandLine=$w.CommandLine} | ConvertTo-Json -Compress',
    '}',
  ].join('; ');
  const result = runQuietCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ]);
  if (!result.ok || !result.stdout.trim()) return { listening: false, source: 'powershell' };
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      listening: true,
      pid: Number(parsed.pid),
      processName: parsed.processName || null,
      commandLine: parsed.commandLine || null,
      source: 'powershell',
    };
  } catch {
    return { listening: true, source: 'powershell', raw: result.stdout.trim() };
  }
}

function findPosixPortOwner(targetPort) {
  const lsof = runQuietCommand('lsof', ['-nP', `-iTCP:${targetPort}`, '-sTCP:LISTEN']);
  if (lsof.ok && lsof.stdout.trim()) {
    const lines = lsof.stdout.trim().split(/\r?\n/);
    const columns = lines[1]?.trim().split(/\s+/) || [];
    if (columns.length >= 2) {
      return {
        listening: true,
        pid: Number(columns[1]),
        processName: columns[0] || null,
        commandLine: null,
        source: 'lsof',
      };
    }
  }

  const ss = runQuietCommand('ss', ['-ltnp', `sport = :${targetPort}`]);
  if (ss.ok && ss.stdout.includes(`:${targetPort}`)) {
    const pidMatch = ss.stdout.match(/pid=(\d+)/);
    const processMatch = ss.stdout.match(/users:\(\("([^"]+)"/);
    return {
      listening: true,
      pid: pidMatch ? Number(pidMatch[1]) : null,
      processName: processMatch?.[1] || null,
      commandLine: null,
      source: 'ss',
    };
  }

  return { listening: false, source: 'lsof/ss' };
}

function findPortOwner(targetPort) {
  return isWindows ? findWindowsPortOwner(targetPort) : findPosixPortOwner(targetPort);
}

function parseGpuMemoryRows(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((part) => part.trim());
      return {
        name: parts[0] || 'GPU',
        used: Number(parts[1]),
        total: Number(parts[2]),
      };
    })
    .filter((row) => Number.isFinite(row.used) && Number.isFinite(row.total) && row.total > 0);
}

function parseGpuProcessRows(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((part) => part.trim());
      return {
        pid: Number(parts[0]),
        name: parts[1] || '',
        used: Number(parts[2]),
      };
    })
    .filter((row) => Number.isFinite(row.pid));
}

function probeGpu() {
  if (process.env.HAS_TEXT_GPU_PREFLIGHT_GPU_MOCK === 'busy') {
    return {
      available: true,
      rows: [{ name: 'Mock GPU', used: 14500, total: 16000, ratio: 0.90625 }],
      processes: [{ pid: 4242, name: 'ModelWorker', used: 12288 }],
      busy: true,
      source: 'mock',
    };
  }
  if (process.env.HAS_TEXT_GPU_PREFLIGHT_GPU_MOCK === 'idle') {
    return {
      available: true,
      rows: [{ name: 'Mock GPU', used: 512, total: 16000, ratio: 0.032 }],
      processes: [],
      busy: false,
      source: 'mock',
    };
  }
  if (process.env.HAS_TEXT_GPU_PREFLIGHT_SKIP_GPU === '1') {
    return { available: false, rows: [], processes: [], busy: null, source: 'skipped' };
  }

  const memoryProbe = runQuietCommand('nvidia-smi', [
    '--query-gpu=name,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (!memoryProbe.ok || !memoryProbe.stdout.trim()) {
    return { available: false, rows: [], processes: [], busy: null, source: 'nvidia-smi unavailable' };
  }

  const rows = parseGpuMemoryRows(memoryProbe.stdout).map((row) => ({
    ...row,
    ratio: row.used / row.total,
  }));
  const processProbe = runQuietCommand('nvidia-smi', [
    '--query-compute-apps=pid,process_name,used_memory',
    '--format=csv,noheader,nounits',
  ]);
  const processes = processProbe.ok
    ? parseGpuProcessRows(processProbe.stdout).filter(
        (row) => Number.isFinite(row.used) && row.used > 0,
      )
    : [];
  return {
    available: true,
    rows,
    processes,
    busy: rows.some((row) => row.ratio >= 0.8) || processes.length > 0,
    source: 'nvidia-smi',
  };
}

function buildConfigChecks() {
  const serverBin = normalizeConfiguredPath(process.env.HAS_TEXT_SERVER_BIN || '');
  const modelPath = hasTextServerModelPath();
  return [
    {
      label: 'HAS_TEXT_SERVER_BIN configured',
      ok: Boolean(serverBin),
      detail: serverBin || 'set HAS_TEXT_SERVER_BIN to llama-server or llama-server.exe',
      required: true,
    },
    {
      label: 'HAS_TEXT_SERVER_BIN exists',
      ok: pathExists(serverBin),
      detail: serverBin || 'not configured',
      required: true,
    },
    {
      label: 'HAS_TEXT_MODEL_PATH_FOR_SERVER exists',
      ok: pathExists(modelPath),
      detail: modelPath,
      required: true,
    },
    {
      label: 'HAS_TEXT_PORT valid',
      ok: Number.isInteger(port) && port > 0 && port < 65536,
      detail: String(port),
      required: true,
    },
    {
      label: 'HAS_TEXT_N_GPU_LAYERS enables GPU',
      ok: String(process.env.HAS_TEXT_N_GPU_LAYERS || '-1') !== '0',
      detail: process.env.HAS_TEXT_N_GPU_LAYERS || '-1',
      required: false,
    },
    {
      label: 'Has Text runtime policy aims CUDA/GPU',
      ok: inferRuntimeProvider(process.env.HAS_TEXT_DEVICE || '') !== 'cpu',
      detail: `provider=${inferRuntimeProvider(process.env.HAS_TEXT_DEVICE || '')}; device=${process.env.HAS_TEXT_DEVICE || '(default)'}`,
      required: false,
    },
  ];
}

function nextStepCommands(owner, command) {
  const stopHint = owner.listening && owner.pid
    ? isWindows
      ? `Stop-Process -Id ${owner.pid}`
      : `kill ${owner.pid}`
    : '<stop the currently verified HaS Text process if you choose to switch>';
  return [
    'Keep the current 8080 service running while GPU is busy.',
    `When GPU is idle and you have confirmed the listener, stop the old service manually: ${stopHint}`,
    command ? `Start external HaS Text manually: ${command}` : 'Set HAS_TEXT_SERVER_BIN before starting external HaS Text.',
    `Verify after start: curl http://127.0.0.1:${port}/v1/models`,
  ];
}

function printReport(report) {
  console.log('HaS Text external GPU switch preflight');
  console.log('mode: dry-run (no kill, no start, no model load)');
  console.log(`root: ${rootDir}`);
  console.log(`port: ${port}`);
  console.log(`health URL: ${report.health.url}`);
  console.log('');

  const owner = report.listener;
  if (owner.listening) {
    const name = owner.processName ? ` ${owner.processName}` : '';
    console.log(`port ${port} listener: pid ${owner.pid || 'unknown'}${name} (${owner.source})`);
    if (owner.commandLine) console.log(`listener command: ${owner.commandLine}`);
  } else {
    console.log(`port ${port} listener: none detected (${owner.source})`);
  }

  const healthModels = report.health.models.length ? report.health.models.join(', ') : '(none parsed)';
  console.log(`health: ${report.health.status || 'unreachable'} ${report.health.ok ? 'ok' : 'not ok'}`);
  console.log(`health models: ${healthModels}`);
  if (!report.health.ok && report.health.text) console.log(`health detail: ${report.health.text}`);
  console.log('');

  console.log('configuration:');
  for (const check of report.config.checks) {
    console.log(`${check.ok ? 'ok  ' : check.required ? 'fail' : 'warn'} ${check.label}: ${check.detail}`);
  }
  console.log(`HAS_TEXT_DEVICE: ${report.config.device || '(default)'}`);
  console.log(`HAS_TEXT_N_CTX: ${report.config.context}`);
  console.log(`HAS_TEXT_N_GPU_LAYERS: ${report.config.gpu_layers}`);
  console.log(`runtime expectation: ${report.config.runtime_expectation}`);
  console.log(
    `runtime policy: ${report.config.runtime_mode} (provider: ${report.config.runtime_provider})`
  );
  if (report.config.cpu_fallback_risk) {
    console.log(`runtime warning: ${report.config.runtime_risk_reason}`);
  }
  console.log('');

  console.log('GPU:');
  if (!report.gpu.available) {
    console.log(`gpu status: unknown (${report.gpu.source})`);
  } else {
    for (const [index, row] of report.gpu.rows.entries()) {
      console.log(`gpu ${index}: ${row.name} memory ${row.used}/${row.total} MiB (${(row.ratio * 100).toFixed(1)}%)`);
    }
    if (report.gpu.processes.length) {
      console.log('gpu processes:');
      for (const processRow of report.gpu.processes) {
        const memory = Number.isFinite(processRow.used) ? `${processRow.used} MiB` : 'memory n/a';
        console.log(`  pid ${processRow.pid}: ${memory} ${processRow.name}`);
      }
    }
  }
  if (report.gpu.busy === true) {
    console.log('GPU decision: busy; do not switch HaS Text to GPU now.');
  } else if (report.gpu.busy === false) {
    console.log('GPU decision: idle enough for an operator-controlled switch.');
  } else {
    console.log('GPU decision: unknown; verify manually before switching.');
  }
  console.log('');

  if (report.command) {
    console.log('external llama-server command preview:');
    console.log(report.command);
  } else {
    console.log('external llama-server command preview: unavailable until HAS_TEXT_SERVER_BIN is set');
  }
  console.log('');

  console.log('next steps:');
  for (const step of report.next_steps) console.log(`- ${step}`);
  console.log('');
  console.log('dry-run guard: this script did not stop 8080 and did not start llama-server.');
}

async function main() {
  if (args.has('--execute')) {
    console.error('--execute is intentionally unsupported by this preflight script. Use the printed commands after manual confirmation.');
    process.exit(2);
  }

  const listener = findPortOwner(port);
  const health = await probeHasTextHealth();
  const gpu = probeGpu();
  const command = hasTextCommand();
  const configChecks = buildConfigChecks();
  const runtimePolicy = assessHasTextRuntimePolicy();
  const report = {
    generated_at: new Date().toISOString(),
    runtime: isWindows ? 'windows' : os.platform(),
    dry_run: true,
    listener,
    health,
    config: {
      server_bin: normalizeConfiguredPath(process.env.HAS_TEXT_SERVER_BIN || '') || null,
      model_path: hasTextServerModelPath(),
      device: process.env.HAS_TEXT_DEVICE || null,
      context: process.env.HAS_TEXT_N_CTX || '8192',
      gpu_layers: process.env.HAS_TEXT_N_GPU_LAYERS || '-1',
      runtime_mode: runtimePolicy.runtime_mode,
      runtime_provider: runtimePolicy.provider,
      runtime_expectation: runtimePolicy.runtime_expectation,
      cpu_fallback_risk: runtimePolicy.cpu_fallback_risk,
      runtime_risk_reason: runtimePolicy.risk_reason,
      checks: configChecks,
    },
    gpu,
    command,
    next_steps: nextStepCommands(listener, command),
    summary: {
      failed_required_checks: configChecks.filter((check) => check.required && !check.ok).length,
      port_listening: listener.listening,
      health_ok: health.ok,
      gpu_busy: gpu.busy,
      cpu_fallback_risk: runtimePolicy.cpu_fallback_risk,
    },
  };

  printReport(report);

  if (json) {
    const outputPath = path.join(rootDir, 'output', 'has-text-gpu-preflight.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`json report: ${outputPath}`);
  }

  if (
    strict &&
    (report.summary.failed_required_checks > 0 ||
      report.summary.cpu_fallback_risk ||
      report.gpu.busy === true)
  ) {
    process.exit(1);
  }
}

await main();
