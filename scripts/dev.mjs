#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(repoRoot, 'backend');
const frontendDir = path.join(repoRoot, 'frontend');
const logsDir = path.join(repoRoot, 'logs');
mkdirSync(logsDir, { recursive: true });

function parseEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const raw of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function splitArgs(value) {
  if (!value) return [];
  const matches = String(value).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ''));
}

function winToWsl(value) {
  const match = String(value).match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return String(value).replace(/\\/g, '/');
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function wslToWin(value) {
  const match = String(value).match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (!match) return value;
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}. Put it in .env.`);
  return value;
}

function getWslHost() {
  const result = spawnSync('wsl.exe', ['-e', 'bash', '-lc', "hostname -I | awk '{print $1}'"], {
    encoding: 'utf8',
  });
  const match = (result.stdout || '').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  if (!match) {
    throw new Error(`Could not resolve WSL IP. stderr=${(result.stderr || '').trim()}`);
  }
  return match[0];
}

function preferWslUrl(value, port, suffix = '') {
  const raw = String(value || '').trim();
  if (!raw || /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(raw)) {
    return `http://${wslHost}:${port}${suffix}`;
  }
  return raw;
}

const fileEnv = {
  ...parseEnv(path.join(backendDir, '.env')),
  ...parseEnv(path.join(repoRoot, '.env')),
};

const env = {
  ...process.env,
  ...fileEnv,
  PYTHONUNBUFFERED: '1',
  CUDA_VISIBLE_DEVICES: fileEnv.CUDA_VISIBLE_DEVICES || process.env.CUDA_VISIBLE_DEVICES || '0',
  OCR_VL_BACKEND: fileEnv.OCR_VL_BACKEND || 'vllm-server',
  OCR_VLLM_URL: fileEnv.OCR_VLLM_URL || 'http://127.0.0.1:8118/v1',
  OCR_VL_API_MODEL_NAME: fileEnv.OCR_VL_API_MODEL_NAME || 'PaddleOCR-VL-1.5-0.9B',
};

const wslHost = process.platform === 'win32' ? getWslHost() : '127.0.0.1';
env.WSL_MODEL_HOST = wslHost;
env.HAS_TEXT_RUNTIME = env.HAS_TEXT_RUNTIME || 'vllm';
env.HAS_TEXT_VLLM_BASE_URL = preferWslUrl(env.HAS_TEXT_VLLM_BASE_URL, 8080, '/v1');
env.OCR_BASE_URL = preferWslUrl(env.OCR_BASE_URL, 8082);

for (const key of ['HAS_IMAGE_WEIGHTS', 'GLM_FLASH_SERVER_BIN', 'GLM_FLASH_MODEL_FOR_SERVER', 'GLM_FLASH_MMPROJ_FOR_SERVER']) {
  if (env[key]) env[key] = wslToWin(env[key]);
}
const winEnv = { ...env, PYTHONPATH: backendDir };

const windowsVenv = env.WINDOWS_VENV_DIR || '.venv';
const windowsPython = env.WINDOWS_PYTHON || path.join(repoRoot, windowsVenv, 'Scripts', 'python.exe');
const appPython = path.posix.join(required('VENV_DIR'), 'bin', 'python');
const vllmPython = path.posix.join(required('VLLM_VENV_DIR'), 'bin', 'python');
const vllmBin = path.posix.join(required('VLLM_VENV_DIR'), 'bin', 'vllm');
const glmPort = env.GLM_FLASH_PORT || '8090';
const children = [];

function nvidiaDllDirs() {
  const root = path.join(path.dirname(path.dirname(windowsPython)), 'Lib', 'site-packages', 'nvidia');
  if (!existsSync(root)) return [];
  const dirs = [];
  for (const child of readdirSync(root, { withFileTypes: true })) {
    if (!child.isDirectory()) continue;
    const bin = path.join(root, child.name, 'bin');
    if (existsSync(bin)) dirs.push(bin);
  }
  return dirs;
}

winEnv.PATH = [...nvidiaDllDirs(), path.dirname(windowsPython), process.env.PATH || ''].join(path.delimiter);

function logPath(name) {
  return path.join(logsDir, `${name}.log`);
}

function pipe(name, stream, out) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      const text = `[${name}] ${line}\n`;
      process.stdout.write(text);
      out.write(text);
    }
  });
}

function spawnLogged(name, command, args, options = {}) {
  const out = createWriteStream(logPath(name), { flags: 'a' });
  out.write(`\n\n===== ${new Date().toISOString()} ${command} ${args.join(' ')} =====\n`);
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || winEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  pipe(name, child.stdout, out);
  pipe(name, child.stderr, out);
  child.on('exit', (code, signal) => {
    const message = `[dev] ${name} exited code=${code ?? ''} signal=${signal ?? ''}\n`;
    process.stdout.write(message);
    out.write(message);
  });
  child.on('error', (error) => {
    const msg = `[dev] ${name} failed to start: ${error.message}\n`;
    process.stdout.write(msg);
    out.write(msg);
  });
  console.log(`[dev] started ${name} pid=${child.pid}`);
  return child;
}

function spawnWsl(name, command) {
  return spawnLogged(name, 'wsl.exe', ['-e', 'bash', '-lc', command], { cwd: repoRoot, env: process.env });
}

async function waitPort(port, label, timeoutMs = 240000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 1000 });
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${label} did not listen on ${port}`);
}

async function waitJson(url, predicate, label, timeoutMs = 240000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const body = await response.json();
        if (!predicate || predicate(body)) return body;
        last = JSON.stringify(body).slice(0, 240);
      } else {
        last = `${response.status} ${response.statusText}`;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${label} not ready: ${last}`);
}

async function startVllmServices() {
  const wslRoot = winToWsl(repoRoot);
  const cuda = shellQuote(env.CUDA_VISIBLE_DEVICES || '0');
  spawnWsl(
    'paddle-vllm',
    [
      `cd ${shellQuote(wslRoot)} &&`,
      `CUDA_VISIBLE_DEVICES=${cuda}`,
      shellQuote(vllmPython),
      shellQuote(vllmBin),
      'serve PaddlePaddle/PaddleOCR-VL',
      '--host 0.0.0.0 --port 8118',
      '--served-model-name PaddleOCR-VL-1.5-0.9B',
      '--trust-remote-code',
      ...splitArgs(env.VLLM_EXTRA_ARGS).map(shellQuote),
    ].join(' '),
  );
  await waitJson(`http://${wslHost}:8118/v1/models`, (body) => Array.isArray(body.data), 'paddle-vllm', 360000);

  spawnWsl(
    'has-text-vllm',
    [
      `cd ${shellQuote(wslRoot)} &&`,
      `CUDA_VISIBLE_DEVICES=${cuda}`,
      shellQuote(vllmPython),
      shellQuote(vllmBin),
      'serve',
      shellQuote(required('HAS_TEXT_HF_MODEL_PATH')),
      '--host 0.0.0.0 --port 8080',
      `--served-model-name ${shellQuote(env.HAS_TEXT_MODEL_NAME || 'HaS_4.0_0.6B')}`,
      '--trust-remote-code',
      ...splitArgs(env.HAS_TEXT_VLLM_EXTRA_ARGS).map(shellQuote),
    ].join(' '),
  );
  await waitJson(`http://${wslHost}:8080/v1/models`, (body) => Array.isArray(body.data), 'has-text-vllm', 360000);
}

async function startOcrWrapper() {
  const wslBackend = winToWsl(backendDir);
  const cuda = shellQuote(env.CUDA_VISIBLE_DEVICES || '0');
  spawnWsl(
    'ocr-wrapper',
    [
      `cd ${shellQuote(wslBackend)} &&`,
      `CUDA_VISIBLE_DEVICES=${cuda}`,
      `PYTHONPATH=${shellQuote(wslBackend)}`,
      `OCR_VL_BACKEND=${shellQuote(env.OCR_VL_BACKEND || 'vllm-server')}`,
      `OCR_VLLM_URL=${shellQuote(env.OCR_VLLM_URL || 'http://127.0.0.1:8118/v1')}`,
      `OCR_VL_API_MODEL_NAME=${shellQuote(env.OCR_VL_API_MODEL_NAME || 'PaddleOCR-VL-1.5-0.9B')}`,
      `PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=${shellQuote(env.PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK || 'True')}`,
      shellQuote(appPython),
      'scripts/ocr_server.py',
    ].join(' '),
  );
  await waitJson(`http://${wslHost}:8082/health`, (body) => body.ready === true, 'ocr-wrapper', 360000);
}

async function runWarmup() {
  console.log('[dev] running warmup');
  const child = spawnLogged('warmup', windowsPython, ['scripts/warmup_models.py'], { cwd: backendDir, env: winEnv });
  await new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`warmup failed with exit code ${code}`))));
  });
}

function ensureWindowsVenv() {
  if (!existsSync(windowsPython)) {
    throw new Error(
      `Missing Windows project venv: ${windowsPython}\n` +
        'Create it once, then run npm run dev again. Do not use global Anaconda for the app services.',
    );
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('This local hybrid profile is started from Windows. WSL hosts the vLLM/OCR model helpers.');
  }
  ensureWindowsVenv();

  await startVllmServices();

  if ((env.GLM_FLASH_ENABLED || '1') !== '0') {
    spawnLogged('glm-vlm', required('GLM_FLASH_SERVER_BIN'), [
      '-m',
      required('GLM_FLASH_MODEL_FOR_SERVER'),
      '--mmproj',
      required('GLM_FLASH_MMPROJ_FOR_SERVER'),
      '--host',
      '0.0.0.0',
      '--port',
      glmPort,
      '-a',
      env.GLM_FLASH_ALIAS || env.VLM_MODEL_NAME || 'GLM-4.6V-Flash-Q4',
      '--jinja',
      '-ngl',
      env.GLM_FLASH_N_GPU_LAYERS || 'auto',
      '--flash-attn',
      'on',
      '-fit',
      'on',
      '-c',
      env.GLM_FLASH_N_CTX || '2048',
      '-np',
      env.GLM_FLASH_N_PARALLEL || '1',
      '-ctk',
      env.GLM_FLASH_CACHE_TYPE_K || 'q8_0',
      '-ctv',
      env.GLM_FLASH_CACHE_TYPE_V || 'q8_0',
      '--temp',
      '0.8',
      '--top-p',
      '0.6',
      '--top-k',
      '2',
      '--repeat-penalty',
      '1.1',
      '--metrics',
      '--device',
      env.GLM_FLASH_DEVICE || 'CUDA0',
      ...(env.GLM_FLASH_MMPROJ_OFFLOAD === '0' ? [] : ['--mmproj-offload']),
    ]);
    await waitJson(`http://127.0.0.1:${glmPort}/v1/models`, (body) => Array.isArray(body.data), 'glm-vlm', 360000);
  }

  await startOcrWrapper();

  spawnLogged('has-image', windowsPython, ['scripts/has_image_server.py'], { cwd: backendDir, env: winEnv });
  await waitJson('http://127.0.0.1:8081/health', (body) => body.ready === true, 'has-image', 180000);

  spawnLogged('backend', windowsPython, ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000'], {
    cwd: backendDir,
    env: winEnv,
  });
  await waitJson('http://127.0.0.1:8000/health/services', (body) => body.all_online === true, 'backend', 180000);

  await runWarmup();

  const frontendCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const frontendArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm run dev -- --host 0.0.0.0 --port 3000 --strictPort']
      : ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000', '--strictPort'];
  spawnLogged('frontend', frontendCommand, frontendArgs, {
    cwd: frontendDir,
    env: process.env,
  });
  await waitPort(3000, 'frontend', 120000);

  console.log('[dev] ready: http://localhost:3000');
  await new Promise(() => {});
}

function shutdown(code = 0) {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), children.length ? 1500 : 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  shutdown(1);
});
