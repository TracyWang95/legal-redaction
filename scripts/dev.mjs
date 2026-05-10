import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadDotEnvFiles } from "./env.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultEvalTokenFile = path.join(rootDir, "tmp", "eval-token.txt");
const isWindows = process.platform === "win32";
const isWsl =
  !isWindows &&
  (Boolean(process.env.WSL_DISTRO_NAME) ||
    os.release().toLowerCase().includes("microsoft"));

const args = new Set(process.argv.slice(2));

loadDotEnvFiles(rootDir, { files: [".env"] });

const mode = {
  appOnly: args.has("--app-only"),
  modelsOnly: args.has("--models-only"),
  doctor: args.has("--doctor"),
  hasTextServerDoctor: args.has("--doctor-has-text-server"),
  firstRun: args.has("--first-run"),
  setup: args.has("--setup"),
  attachExisting: args.has("--attach-existing"),
  json: args.has("--json") || process.env.npm_config_json === "true",
  strict: args.has("--strict") || process.env.npm_config_strict === "true",
};

const ports = {
  backend: Number(process.env.BACKEND_PORT || 8000),
  frontend: Number(process.env.FRONTEND_PORT || 3000),
  ner: Number(process.env.HAS_TEXT_PORT || 8080),
  vision: Number(process.env.HAS_IMAGE_PORT || 8081),
  ocr: Number(process.env.OCR_PORT || 8082),
  glmFlash: Number(process.env.GLM_FLASH_PORT || 8090),
  ocrVllm: Number(process.env.OCR_VLLM_PORT || 8118),
};

function isPosixAbsolutePath(value) {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

function isWindowsDrivePath(value) {
  return typeof value === "string" && /^[a-zA-Z]:[\\/]/.test(value);
}

function windowsDrivePathToWslPath(value) {
  if (!isWindowsDrivePath(value)) return value;
  const drive = value[0].toLowerCase();
  const rest = value.slice(2).replaceAll("\\", "/").replace(/^\/+/, "");
  return `/mnt/${drive}/${rest}`;
}

function normalizeConfiguredPath(value) {
  if (isWindows && isPosixAbsolutePath(value)) return value;
  if (isWsl && isWindowsDrivePath(value)) return value;
  return path.resolve(value);
}

function posixQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function wslPathExists(value) {
  const result = spawnSync(
    "wsl.exe",
    ["bash", "-lc", `test -e ${posixQuote(value)}`],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  return result.status === 0;
}

function pathExists(value) {
  if (fs.existsSync(value)) return true;
  if (isWsl && isWindowsDrivePath(value)) {
    return fs.existsSync(windowsDrivePathToWslPath(value));
  }
  if (isWindows && isPosixAbsolutePath(value)) return wslPathExists(value);
  return false;
}

function readWslDefaultGateway() {
  if (!isWsl) return "";
  const result = spawnSync(
    "sh",
    ["-lc", "ip route | awk '/default/{print $3; exit}'"],
    { encoding: "utf8" },
  );
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }
  return "";
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveTokenFilePath(filePath) {
  if (!filePath || path.isAbsolute(filePath)) return filePath;
  const cwdPath = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(cwdPath)) return cwdPath;
  return path.resolve(rootDir, filePath);
}

function resolveDefaultEvalTokenFile() {
  return resolveTokenFilePath(
    process.env.DATAINFRA_DEFAULT_TOKEN_FILE || defaultEvalTokenFile,
  );
}

function parseMajorVersion(version) {
  const match = String(version || "").match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isNodeVersionSupported(version, range) {
  const major = parseMajorVersion(version);
  if (major == null) return true;
  const boundedRange = String(range || "").match(/^>=(\d+)\s+<(\d+)$/);
  if (boundedRange) {
    return major >= Number(boundedRange[1]) && major < Number(boundedRange[2]);
  }
  return true;
}

function firstExisting(candidates, fallback) {
  return (
    candidates.find((candidate) => candidate && pathExists(candidate)) ||
    fallback
  );
}

const paths = {
  backend: path.join(rootDir, "backend"),
  frontend: path.join(rootDir, "frontend"),
  modelProvenance: path.join(rootDir, "docs", "MODEL_PROVENANCE.md"),
  venv: process.env.VENV_DIR
    ? normalizeConfiguredPath(process.env.VENV_DIR)
    : path.join(rootDir, ".venv"),
  vllmVenv: process.env.VLLM_VENV_DIR
    ? normalizeConfiguredPath(process.env.VLLM_VENV_DIR)
    : path.join(rootDir, ".venv-vllm"),
  hasTextModel: firstExisting(
    [
      process.env.HAS_MODEL_PATH,
      "/mnt/d/has_models/HaS_Text_0209_0.6B_Q4_K_M.gguf",
      path.join(rootDir, "..", "has_models", "HaS_Text_0209_0.6B_Q4_K_M.gguf"),
      path.join(
        rootDir,
        "backend",
        "models",
        "has",
        "HaS_Text_0209_0.6B_Q4_K_M.gguf",
      ),
    ],
    path.join(
      rootDir,
      "backend",
      "models",
      "has",
      "HaS_Text_0209_0.6B_Q4_K_M.gguf",
    ),
  ),
  hasImageWeights: firstExisting(
    [
      process.env.HAS_IMAGE_WEIGHTS,
      "/mnt/d/has_models/sensitive_seg_best.pt",
      path.join(rootDir, "..", "has_models", "sensitive_seg_best.pt"),
      path.join(
        rootDir,
        "backend",
        "models",
        "has_image",
        "sensitive_seg_best.pt",
      ),
    ],
    path.join(
      rootDir,
      "backend",
      "models",
      "has_image",
      "sensitive_seg_best.pt",
    ),
  ),
  glmFlashModel: firstExisting(
    [
      process.env.GLM_FLASH_MODEL,
      "D:/has_models/GLM-4.6V-Flash-Q4_K_M.gguf",
      "/mnt/d/has_models/GLM-4.6V-Flash-Q4_K_M.gguf",
      path.join(rootDir, "..", "has_models", "GLM-4.6V-Flash-Q4_K_M.gguf"),
    ],
    "D:/has_models/GLM-4.6V-Flash-Q4_K_M.gguf",
  ),
  glmFlashMmproj: firstExisting(
    [
      process.env.GLM_FLASH_MMPROJ,
      "D:/has_models/mmproj-F16.gguf",
      "/mnt/d/has_models/mmproj-F16.gguf",
      path.join(rootDir, "..", "has_models", "mmproj-F16.gguf"),
    ],
    "D:/has_models/mmproj-F16.gguf",
  ),
  hasTextServerBin: process.env.HAS_TEXT_SERVER_BIN
    ? normalizeConfiguredPath(process.env.HAS_TEXT_SERVER_BIN)
    : "",
};

const rootPackage = readJsonFile(path.join(rootDir, "package.json"), {});
const declaredNodeEngine = rootPackage?.engines?.node || "";
const effectiveNodeVersion =
  process.env.DATAINFRA_DOCTOR_NODE_VERSION || process.versions.node;
const recommendedNodeVersion = readRepoText(".nvmrc", "24");
const nodeVersionFileVersion = readRepoText(
  ".node-version",
  recommendedNodeVersion,
);

function readRepoText(relativePath, fallback = "") {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), "utf8").trim();
  } catch {
    return fallback;
  }
}

function defaultHasLlamacppBaseUrl() {
  if (process.env.HAS_LLAMACPP_BASE_URL) {
    return process.env.HAS_LLAMACPP_BASE_URL;
  }
  if (isWsl && /\.exe$/i.test(paths.hasTextServerBin || "")) {
    const gateway = readWslDefaultGateway();
    if (gateway) return `http://${gateway}:${ports.ner}/v1`;
  }
  return `http://127.0.0.1:${ports.ner}/v1`;
}

function defaultVlmBaseUrl() {
  if (process.env.VLM_BASE_URL) {
    return process.env.VLM_BASE_URL;
  }
  if (isWsl && /\.exe$/i.test(glmFlashServerBin() || "")) {
    const gateway = readWslDefaultGateway();
    if (gateway) return `http://${gateway}:${ports.glmFlash}`;
  }
  return `http://127.0.0.1:${ports.glmFlash}`;
}

function defaultVlmChatUrl() {
  const base = defaultVlmBaseUrl().replace(/\/$/, "");
  return `${base.endsWith("/v1") ? base : `${base}/v1`}/chat/completions`;
}

function assertRuntimeSplit() {
  if (mode.doctor || mode.hasTextServerDoctor) return;
  const hasTextRuntime = String(process.env.HAS_TEXT_RUNTIME || "vllm").trim().toLowerCase();
  if (hasTextRuntime === "vllm") return;
  if (hasTextRuntime) {
    throw new Error(
      `Unsupported HAS_TEXT_RUNTIME=${process.env.HAS_TEXT_RUNTIME}. This profile expects HaS Text on vLLM; use HAS_TEXT_RUNTIME=vllm.`,
    );
  }
}

function printNodeVersionGuidance(prefix = "doctor") {
  if (
    !declaredNodeEngine ||
    isNodeVersionSupported(effectiveNodeVersion, declaredNodeEngine)
  ) {
    return false;
  }
  const warning = `Node ${effectiveNodeVersion} is outside project engine ${declaredNodeEngine}`;
  console.log(
    `warn ${warning}; recommended Node ${recommendedNodeVersion} is recorded in .nvmrc and .node-version${nodeVersionFileVersion !== recommendedNodeVersion ? ` (currently ${nodeVersionFileVersion})` : ""}.`,
  );
  console.log(
    `${prefix} note: this remains a warning so already-running services can still be verified; switch this shell to Node ${recommendedNodeVersion} before npm install or npm run setup.`,
  );
  return true;
}

function binDirForVenv(venvPath) {
  if (isWindows && isPosixAbsolutePath(venvPath))
    return `${venvPath.replace(/\/+$/, "")}/bin`;
  return path.join(venvPath, isWindows ? "Scripts" : "bin");
}

function binForVenv(venvPath, executable) {
  if (isWindows && isPosixAbsolutePath(venvPath))
    return `${binDirForVenv(venvPath)}/${executable}`;
  return path.join(
    binDirForVenv(venvPath),
    isWindows ? `${executable}.exe` : executable,
  );
}

const python = binForVenv(paths.venv, "python");
const appUv = binForVenv(paths.venv, "uv");
const vllmPython = binForVenv(paths.vllmVenv, "python");
const vllmBin = binForVenv(paths.vllmVenv, "vllm");
const vllmUv = binForVenv(paths.vllmVenv, "uv");
const npmCmd = isWindows ? "npm.cmd" : "npm";
const paddleIndexUrl =
  process.env.PADDLE_INDEX_URL ||
  "https://www.paddlepaddle.org.cn/packages/stable/cu129/";
const vllmSpec = process.env.VLLM_SPEC || "vllm==0.19.1";
const vllmTorchBackend = process.env.VLLM_TORCH_BACKEND || "cu129";
const vllmExtraArgs =
  process.env.VLLM_EXTRA_ARGS ||
  "--max-model-len 4096 --max-num-batched-tokens 1024 --gpu-memory-utilization 0.34 --no-enable-prefix-caching --mm-processor-cache-gb 0 --enforce-eager --attention-backend TRITON_ATTN --mm-encoder-attn-backend TORCH_SDPA";
const defaultVisionPageConcurrency = "2";
const defaultVisionDualPipelineParallel = "true";
const defaultHasTextGpuLayers = "-1";
const defaultHasTextContextTokens = "8192";
const defaultGlmFlashContextTokens = "2048";
const defaultOcrMaxNewTokens = "1024";
const setupTmpDir =
  process.env.SETUP_TMPDIR || "/tmp/datainfra-redaction-setup";
const pythonIncludeDir = firstExisting(
  [
    process.env.PYTHON_INCLUDE_DIR,
    "/usr/include/python3.12",
    path.join(
      os.homedir(),
      ".cache",
      "datainfra-redaction",
      "python-dev",
      "usr",
      "include",
      "python3.12",
    ),
  ],
  "",
);
const pythonPlatformIncludeDir = firstExisting(
  [
    process.env.PYTHON_PLATFORM_INCLUDE_DIR,
    "/usr/include/x86_64-linux-gnu/python3.12",
    path.join(
      os.homedir(),
      ".cache",
      "datainfra-redaction",
      "python-dev",
      "usr",
      "include",
      "x86_64-linux-gnu",
      "python3.12",
    ),
  ],
  "",
);

function sh(command) {
  if (isWindows) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command],
      display: command,
    };
  }
  return { command: "bash", args: ["-lc", command], display: command };
}

function quote(value) {
  if (isWindows) return `"${String(value).replaceAll('"', '\\"')}"`;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function envPrefix(env) {
  if (isWindows) {
    return Object.entries(env)
      .map(([key, value]) => `set ${quote(`${key}=${value}`)}`)
      .join(" && ");
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${quote(value)}`)
    .join(" ");
}

function collectDirectories(root, predicate, out = []) {
  if (!root || !fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    if (predicate(fullPath)) out.push(fullPath);
    collectDirectories(fullPath, predicate, out);
  }
  return out;
}

function pythonNvidiaLibraryDirs() {
  if (isWindows) return [];
  const libRoot = path.join(paths.venv, "lib");
  return collectDirectories(libRoot, (dirPath) =>
    /site-packages\/nvidia\/[^/]+\/lib$/.test(dirPath.replaceAll("\\", "/")),
  );
}

function hasTextRuntimeEnvPrefix() {
  const env = {
    HAS_MODEL_PATH: paths.hasTextModel,
    HAS_TEXT_PORT: String(ports.ner),
    HAS_TEXT_N_CTX: process.env.HAS_TEXT_N_CTX || defaultHasTextContextTokens,
    HAS_TEXT_N_GPU_LAYERS:
      process.env.HAS_TEXT_N_GPU_LAYERS || defaultHasTextGpuLayers,
  };
  const nvidiaLibs = pythonNvidiaLibraryDirs();
  if (nvidiaLibs.length > 0) {
    env.LD_LIBRARY_PATH = [nvidiaLibs.join(":"), process.env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":");
  }
  return envPrefix(env);
}

function hasTextRuntimeCommand() {
  if (String(process.env.HAS_TEXT_RUNTIME || "vllm").toLowerCase() === "vllm") {
    const modelPath =
      process.env.HAS_TEXT_HF_MODEL_PATH ||
      "/mnt/d/has_models/hf-cache/hub/models--xuanwulab--HaS_4.0_0.6B/snapshots/1f700bdb7cc8085a789fa895845fbb36391f5125";
    const modelName = process.env.HAS_TEXT_MODEL_NAME || "HaS_4.0_0.6B";
    const extraArgs =
      process.env.HAS_TEXT_VLLM_EXTRA_ARGS ||
      `--dtype bfloat16 --max-model-len ${defaultHasTextContextTokens} --max-num-batched-tokens 8192 --gpu-memory-utilization 0.22 --no-enable-prefix-caching --enforce-eager`;
    return `mkdir -p /tmp/datainfra-vllm && ${vllmRuntimeEnvPrefix()} ${quote(vllmBin)} serve ${quote(modelPath)} --host 0.0.0.0 --port ${ports.ner} --served-model-name ${quote(modelName)} --trust-remote-code ${extraArgs}`;
  }
  const ctx = process.env.HAS_TEXT_N_CTX || defaultHasTextContextTokens;
  const gpuLayers =
    process.env.HAS_TEXT_N_GPU_LAYERS || defaultHasTextGpuLayers;
  if (paths.hasTextServerBin) {
    const modelPath = hasTextServerModelPath();
    const args = [
      quote(paths.hasTextServerBin),
      "-m",
      quote(modelPath),
      "--host",
      "0.0.0.0",
      "--port",
      String(ports.ner),
      "-c",
      ctx,
      "-ngl",
      gpuLayers,
      "--chat-template",
      "chatml",
    ];
    if (process.env.HAS_TEXT_N_PARALLEL) {
      args.push("-np", process.env.HAS_TEXT_N_PARALLEL);
    }
    if (process.env.HAS_TEXT_DEVICE) {
      args.push("--device", quote(process.env.HAS_TEXT_DEVICE));
    }
    return args.join(" ");
  }
  return `${hasTextRuntimeEnvPrefix()} ${quote(python)} scripts/start_has_python.py`;
}

function hasTextServerModelPath() {
  return process.env.HAS_TEXT_MODEL_PATH_FOR_SERVER || paths.hasTextModel;
}

function hasTextContractModelName() {
  if (String(process.env.HAS_TEXT_RUNTIME || "vllm").toLowerCase() === "vllm") {
    return process.env.HAS_TEXT_MODEL_NAME || "HaS_4.0_0.6B";
  }
  return path.basename(hasTextServerModelPath());
}

function envFlagEnabled(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function glmFlashServerBin() {
  if (process.env.GLM_FLASH_SERVER_BIN) {
    return normalizeConfiguredPath(process.env.GLM_FLASH_SERVER_BIN);
  }
  return firstExisting(
    [
      "D:/llama.cpp/llama-server.exe",
      "D:/llama.cpp/build/bin/Release/llama-server.exe",
      paths.hasTextServerBin,
    ],
    paths.hasTextServerBin,
  );
}

function glmFlashRuntimeCommand() {
  const serverBin = glmFlashServerBin();
  const args = [
    quote(serverBin),
    "-m",
    quote(process.env.GLM_FLASH_MODEL_FOR_SERVER || paths.glmFlashModel),
    "--mmproj",
    quote(process.env.GLM_FLASH_MMPROJ_FOR_SERVER || paths.glmFlashMmproj),
    "--host",
    "0.0.0.0",
    "--port",
    String(ports.glmFlash),
    "-a",
    quote(process.env.GLM_FLASH_ALIAS || "GLM-4.6V-Flash-Q4"),
    "--jinja",
    "-ngl",
    process.env.GLM_FLASH_N_GPU_LAYERS || "auto",
    "--flash-attn",
    "on",
    "-fit",
    "on",
    "-c",
    process.env.GLM_FLASH_N_CTX || defaultGlmFlashContextTokens,
    "-np",
    process.env.GLM_FLASH_N_PARALLEL || "1",
    "-ctk",
    process.env.GLM_FLASH_CACHE_TYPE_K || "q8_0",
    "-ctv",
    process.env.GLM_FLASH_CACHE_TYPE_V || "q8_0",
    "--temp",
    process.env.GLM_FLASH_TEMP || "0.8",
    "--top-p",
    process.env.GLM_FLASH_TOP_P || "0.6",
    "--top-k",
    process.env.GLM_FLASH_TOP_K || "2",
    "--repeat-penalty",
    process.env.GLM_FLASH_REPEAT_PENALTY || "1.1",
    "--metrics",
  ];
  const device = process.env.GLM_FLASH_DEVICE || process.env.HAS_TEXT_DEVICE;
  if (device) args.push("--device", quote(device));
  if (envFlagEnabled("GLM_FLASH_MMPROJ_OFFLOAD", true)) {
    args.push("--mmproj-offload");
  } else {
    args.push("--no-mmproj-offload");
  }
  const command = args.join(" ");
  const startDelay = Number(process.env.GLM_FLASH_START_DELAY_SEC || 0);
  if (startDelay > 0) {
    if (isWindows) {
      return `powershell -NoProfile -Command "Start-Sleep -Seconds ${startDelay}; ${command.replaceAll('"', '\\"')}"`;
    }
    return `sleep ${startDelay} && ${command}`;
  }
  return command;
}

function hasTextServerDoctorConfig() {
  const enabled = Boolean(paths.hasTextServerBin);
  const modelPath = hasTextServerModelPath();
  const binOk = enabled ? pathExists(paths.hasTextServerBin) : false;
  const modelOk = pathExists(modelPath);
  const gpuLayers = process.env.HAS_TEXT_N_GPU_LAYERS || defaultHasTextGpuLayers;
  const allowCpu = ["1", "true", "yes", "on"].includes(
    String(process.env.HAS_TEXT_ALLOW_CPU || "").toLowerCase(),
  );
  const config = {
    enabled,
    server_bin: paths.hasTextServerBin || null,
    server_bin_exists: binOk,
    model_path: modelPath,
    model_path_exists: modelOk,
    port: ports.ner,
    context: process.env.HAS_TEXT_N_CTX || defaultHasTextContextTokens,
    gpu_layers: gpuLayers,
    gpu_only_mode: gpuLayers !== "0" && !allowCpu,
    cpu_fallback_risk: gpuLayers === "0" || allowCpu,
    device: process.env.HAS_TEXT_DEVICE || null,
    health_url: `${defaultHasLlamacppBaseUrl()}/models`,
    api_base_url: defaultHasLlamacppBaseUrl(),
    command: enabled ? hasTextRuntimeCommand() : null,
    checks: [],
  };
  config.checks.push({
    label: "HAS_TEXT_SERVER_BIN configured",
    ok: enabled,
    detail: paths.hasTextServerBin || "set HAS_TEXT_SERVER_BIN to llama-server or llama-server.exe",
    required: true,
  });
  config.checks.push({
    label: "HaS Text external server binary exists",
    ok: binOk,
    detail: paths.hasTextServerBin || "not configured",
    required: true,
  });
  config.checks.push({
    label: "HaS Text model path for server exists",
    ok: modelOk,
    detail: modelPath,
    required: true,
  });
  config.checks.push({
    label: "HaS Text external server port is valid",
    ok: Number.isInteger(ports.ner) && ports.ner > 0 && ports.ner < 65536,
    detail: String(ports.ner),
    required: true,
  });
  return config;
}

function printHasTextServerDoctor(config) {
  console.log("HaS Text external llama-server doctor");
  console.log(`enabled: ${config.enabled ? "yes" : "no"}`);
  console.log(`server bin: ${config.server_bin || "(not configured)"}`);
  console.log(`model path: ${config.model_path}`);
  console.log(`port: ${config.port}`);
  console.log(`context: ${config.context}`);
  console.log(`GPU layers: ${config.gpu_layers}`);
  console.log(`GPU-only mode: ${config.gpu_only_mode ? "yes" : "no"}`);
  console.log(`CPU fallback risk: ${config.cpu_fallback_risk ? "yes" : "no"}`);
  console.log(`device: ${config.device || "(default)"}`);
  console.log(`health URL: ${config.health_url}`);
  console.log(`backend API base: ${config.api_base_url}`);
  console.log("");
  for (const check of config.checks) {
    console.log(`${check.ok ? "ok  " : "fail"} ${check.label}: ${check.detail}`);
  }
  console.log("");
  if (config.command) {
    console.log("command preview:");
    console.log(config.command);
  } else {
    console.log("command preview: unavailable until HAS_TEXT_SERVER_BIN is set");
  }
  console.log("");
  console.log("This doctor only validates configuration and prints the command; it does not start llama-server or run model inference.");
  return config.checks.every((check) => !check.required || check.ok);
}

async function doctorHasTextServer(options = {}) {
  const json = Boolean(options.json);
  const strict = Boolean(options.strict);
  const config = hasTextServerDoctorConfig();
  const ok = printHasTextServerDoctor(config);
  if (json) {
    const outputPath = doctorReportPath();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          root: rootDir,
          runtime: isWindows ? "windows" : isWsl ? "wsl" : process.platform,
          strict,
          has_text_server: config,
          summary: {
            failed_checks: config.checks.filter(
              (check) => check.required && !check.ok,
            ).length,
            strict_pass: ok,
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`doctor json: ${outputPath}`);
  }
  if (strict && !ok) {
    console.error("HaS Text external server doctor failed");
  }
  return { ok, config };
}

function vllmRuntimeEnvPrefix() {
  const env = {
    TMPDIR: "/tmp/datainfra-vllm",
    TEMP: "/tmp/datainfra-vllm",
    TMP: "/tmp/datainfra-vllm",
    VLLM_PLUGINS: "",
  };
  if (
    pythonIncludeDir &&
    fs.existsSync(path.join(pythonIncludeDir, "Python.h"))
  ) {
    const includePaths = [pythonIncludeDir];
    if (
      pythonPlatformIncludeDir &&
      fs.existsSync(path.join(pythonPlatformIncludeDir, "pyconfig.h"))
    ) {
      includePaths.push(
        pythonPlatformIncludeDir,
        path.dirname(path.dirname(pythonPlatformIncludeDir)),
      );
    }
    env.C_INCLUDE_PATH = includePaths.join(":");
    env.CPATH = includePaths.join(":");
  }
  return envPrefix(env);
}

function serviceDefinitions() {
  assertRuntimeSplit();
  const backendEnv = {
    DEBUG: process.env.DEBUG || "true",
    AUTH_ENABLED: process.env.AUTH_ENABLED || "false",
    DATA_DIR: process.env.DATA_DIR || "./data",
    UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
    OUTPUT_DIR: process.env.OUTPUT_DIR || "./outputs",
    OCR_BASE_URL: process.env.OCR_BASE_URL || `http://127.0.0.1:${ports.ocr}`,
    HAS_IMAGE_BASE_URL:
      process.env.HAS_IMAGE_BASE_URL || `http://127.0.0.1:${ports.vision}`,
    HAS_LLAMACPP_BASE_URL: defaultHasLlamacppBaseUrl(),
    HAS_TEXT_RUNTIME: process.env.HAS_TEXT_RUNTIME || "vllm",
    HAS_TEXT_VLLM_BASE_URL:
      process.env.HAS_TEXT_VLLM_BASE_URL || `http://127.0.0.1:${ports.ner}/v1`,
    HAS_TEXT_MODEL_NAME: process.env.HAS_TEXT_MODEL_NAME || hasTextContractModelName(),
    VLM_BASE_URL: defaultVlmBaseUrl(),
    VLM_MODEL_NAME:
      process.env.VLM_MODEL_NAME ||
      process.env.GLM_FLASH_ALIAS ||
      "GLM-4.6V-Flash-Q4",
    VISION_DUAL_PIPELINE_PARALLEL:
      process.env.VISION_DUAL_PIPELINE_PARALLEL ||
      defaultVisionDualPipelineParallel,
  };
  const frontendEnv = {
    VITE_API_PREFIX:
      process.env.VITE_API_PREFIX || `http://127.0.0.1:${ports.backend}/api/v1`,
  };

  const defs = [
    {
      name: "backend",
      port: ports.backend,
      health: `http://127.0.0.1:${ports.backend}/health`,
      contract: {
        url: `http://127.0.0.1:${ports.backend}/openapi.json`,
        maxText: 1_000_000,
        includes: [
          "/api/v1/auth/status",
          "/api/v1/jobs",
          "/api/v1/files",
        ],
        label: "DataInfra backend API",
      },
      group: "app",
      cwd: paths.backend,
      ...sh(
        `${envPrefix(backendEnv)} ${quote(python)} -m uvicorn app.main:app --host 0.0.0.0 --port ${ports.backend} --reload`,
      ),
    },
    {
      name: "frontend",
      port: ports.frontend,
      health: `http://127.0.0.1:${ports.frontend}/`,
      contract: {
        url: `http://127.0.0.1:${ports.frontend}/src/router.tsx`,
        includes: ["features/home", "StartPage", "playground"],
        label: "current start and single-file router",
      },
      group: "app",
      cwd: paths.frontend,
      env: frontendEnv,
      command: npmCmd,
      args: [
        "run",
        "dev",
        "--",
        "--host",
        "0.0.0.0",
        "--port",
        String(ports.frontend),
        "--strictPort",
      ],
      display: `${envPrefix(frontendEnv)} npm run dev -- --host 0.0.0.0 --port ${ports.frontend} --strictPort`,
    },
    {
      name: "paddle-vllm",
      port: ports.ocrVllm,
      health: `http://127.0.0.1:${ports.ocrVllm}/v1/models`,
      contract: {
        url: `http://127.0.0.1:${ports.ocrVllm}/v1/models`,
        includes: ["PaddleOCR-VL-1.5-0.9B"],
        label: "PaddleOCR-VL vLLM model list",
      },
      group: "models",
      cwd: paths.backend,
      ...sh(
        `mkdir -p /tmp/datainfra-vllm && ${vllmRuntimeEnvPrefix()} ${quote(vllmBin)} serve PaddlePaddle/PaddleOCR-VL --host 0.0.0.0 --port ${ports.ocrVllm} --served-model-name PaddleOCR-VL-1.5-0.9B --trust-remote-code ${vllmExtraArgs}`,
      ),
    },
    {
      name: "ocr",
      port: ports.ocr,
      health: `http://127.0.0.1:${ports.ocr}/health`,
      contract: {
        url: `http://127.0.0.1:${ports.ocr}/health`,
        includes: ["PaddleOCR", '"ready":true'],
        label: "PaddleOCR service health",
      },
      group: "models",
      cwd: paths.backend,
      ...sh(
        `OCR_PORT=${ports.ocr} OCR_VL_BACKEND=vllm-server OCR_VLLM_URL=http://127.0.0.1:${ports.ocrVllm}/v1 OCR_VL_API_MODEL_NAME=PaddleOCR-VL-1.5-0.9B ${quote(python)} scripts/ocr_server.py`,
      ),
    },
    {
      name: "vision",
      port: ports.vision,
      health: `http://127.0.0.1:${ports.vision}/health`,
      contract: {
        url: `http://127.0.0.1:${ports.vision}/health`,
        includes: ["HaS-Image", '"ready":true'],
        label: "HaS Image service health",
      },
      group: "models",
      cwd: paths.backend,
      ...sh(
        `PYTHONPATH=. HAS_IMAGE_PORT=${ports.vision} HAS_IMAGE_WEIGHTS=${quote(paths.hasImageWeights)} ${quote(python)} scripts/has_image_server.py`,
      ),
    },
    {
      name: "has-text",
      port: ports.ner,
      health: `http://127.0.0.1:${ports.ner}/v1/models`,
      contract: {
        url: `http://127.0.0.1:${ports.ner}/v1/models`,
        includes: [hasTextContractModelName()],
        label: "HaS Text model list",
      },
      group: "models",
      cwd: paths.backend,
      ...sh(hasTextRuntimeCommand()),
    },
  ];

  if (envFlagEnabled("GLM_FLASH_ENABLED", false)) {
    defs.push({
      name: "glm-flash",
      port: ports.glmFlash,
      health: `http://127.0.0.1:${ports.glmFlash}/v1/models`,
      contract: {
        url: `http://127.0.0.1:${ports.glmFlash}/v1/models`,
        includes: [process.env.GLM_FLASH_ALIAS || "GLM-4.6V-Flash-Q4"],
        label: "GLM-4.6V-Flash model list",
      },
      group: "models",
      cwd: paths.backend,
      ...sh(glmFlashRuntimeCommand()),
    });
  }

  if (mode.appOnly) return defs.filter((def) => def.group === "app");
  if (mode.modelsOnly) return defs.filter((def) => def.group === "models");
  return defs;
}

function log(prefix, message) {
  try {
    process.stdout.write(`[${prefix.padEnd(8)}] ${message}`);
  } catch (error) {
    if (error?.code !== "EPIPE") throw error;
  }
}

function shouldWarmupModels() {
  return !["1", "true", "yes", "on"].includes(
    String(process.env.DATAINFRA_SKIP_MODEL_WARMUP || "").toLowerCase(),
  );
}

function runModelWarmup() {
  if (!shouldWarmupModels()) return;
  const warmupScript = path.join(paths.backend, "scripts", "warmup_models.py");
  if (!fs.existsSync(warmupScript)) return;
  if (!pathExists(python)) {
    log("warmup", `skipped; app python not found: ${quote(python)}\n`);
    return;
  }
  log("warmup", `${quote(python)} scripts/warmup_models.py\n`);
  const child = spawn(python, ["scripts/warmup_models.py"], {
    cwd: paths.backend,
    env: {
      ...process.env,
      VLM_MODEL_NAME:
        process.env.VLM_MODEL_NAME ||
        process.env.GLM_FLASH_ALIAS ||
        "GLM-4.6V-Flash-Q4",
      VLM_WARMUP_URL: defaultVlmChatUrl(),
      HAS_TEXT_MODEL_NAME:
        process.env.HAS_TEXT_MODEL_NAME || hasTextContractModelName(),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  child.on("error", (error) => {
    log("warmup", `skipped; failed to start app python: ${error.message}\n`);
  });
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) log("warmup", `${line}\n`);
    }
  });
  child.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line) log("warmup", `${line}\n`);
    }
  });
  child.on("exit", (code, signal) => {
    log("warmup", `exited (${signal || code})\n`);
  });
}

function runSync(label, command, options = {}) {
  const cmd = sh(command);
  const result = spawnSync(cmd.command, cmd.args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (options.quiet) {
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
      if (output) console.error(output);
    }
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
  return result;
}

function ensureVenv(venvPath, pythonPath, label) {
  if (fs.existsSync(pythonPath)) {
    const pipProbe = spawnSync(pythonPath, ["-m", "pip", "--version"], {
      cwd: rootDir,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (pipProbe.status === 0) return;
    console.log(
      `[setup   ] existing ${label} venv has no pip; bootstrapping pip`,
    );
    runSync(
      "download get-pip",
      `curl -fsSL https://bootstrap.pypa.io/get-pip.py -o ${quote(path.join(venvPath, "get-pip.py"))}`,
    );
    runSync(
      "bootstrap pip",
      `${quote(pythonPath)} ${quote(path.join(venvPath, "get-pip.py"))}`,
    );
    fs.rmSync(path.join(venvPath, "get-pip.py"), { force: true });
    return;
  }
  if (isWindows) {
    throw new Error(
      "PaddlePaddle GPU 3.3.0 is configured for the WSL/Linux venv. Run this from WSL, or use start-dev.bat which delegates to WSL.",
    );
  }
  console.log(`[setup   ] creating ${label} venv at ${venvPath}`);
  fs.rmSync(venvPath, { recursive: true, force: true });
  const normal = spawnSync(
    "bash",
    ["-lc", `python3 -m venv ${quote(venvPath)}`],
    {
      cwd: rootDir,
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  if (normal.status === 0) return;

  const output = `${normal.stdout || ""}${normal.stderr || ""}`;
  if (!output.includes("ensurepip is not")) {
    process.stderr.write(output);
    throw new Error(`create venv failed with exit code ${normal.status}`);
  }

  console.log(
    "[setup   ] python3-venv/ensurepip is missing; bootstrapping pip without sudo",
  );
  fs.rmSync(venvPath, { recursive: true, force: true });
  runSync(
    "create venv without pip",
    `python3 -m venv --without-pip ${quote(venvPath)}`,
  );
  runSync(
    "download get-pip",
    `curl -fsSL https://bootstrap.pypa.io/get-pip.py -o ${quote(path.join(venvPath, "get-pip.py"))}`,
  );
  runSync(
    "bootstrap pip",
    `${quote(pythonPath)} ${quote(path.join(venvPath, "get-pip.py"))}`,
  );
  fs.rmSync(path.join(venvPath, "get-pip.py"), { force: true });
}

function ensureFrontendInstall() {
  const vitePkg = path.join(paths.frontend, "node_modules", "vite");
  const rollupNative = isWindows
    ? path.join(
        paths.frontend,
        "node_modules",
        "@rollup",
        "rollup-win32-x64-msvc",
      )
    : path.join(
        paths.frontend,
        "node_modules",
        "@rollup",
        "rollup-linux-x64-gnu",
      );
  if (fs.existsSync(vitePkg) && fs.existsSync(rollupNative)) return;
  console.log("[setup   ] installing frontend dependencies");
  runSync("frontend npm install", `${npmCmd} install`, { cwd: paths.frontend });
}

function setup() {
  printNodeVersionGuidance("setup");
  if (!isWsl && !isWindows) {
    console.log(
      "[setup   ] non-WSL Linux detected; continuing with Linux venv setup",
    );
  }
  if (!isWindows) fs.mkdirSync(setupTmpDir, { recursive: true });
  const setupEnv = isWindows
    ? {}
    : { TMPDIR: setupTmpDir, TEMP: setupTmpDir, TMP: setupTmpDir };
  ensureVenv(paths.venv, python, "app");
  ensureVenv(paths.vllmVenv, vllmPython, "vllm");
  runSync(
    "upgrade packaging tools",
    `${quote(python)} -m pip install --upgrade pip 'setuptools>=77,<81' wheel uv`,
    { env: setupEnv },
  );
  runSync(
    "install PaddlePaddle GPU",
    `${quote(python)} -m pip install paddlepaddle-gpu==3.3.0 -i ${quote(paddleIndexUrl)}`,
    { env: setupEnv },
  );
  runSync(
    "install backend/model dependencies",
    `${quote(python)} -m pip install -r backend/requirements.txt`,
    {
      env: setupEnv,
    },
  );
  runSync(
    "install vision dependencies",
    `UV_LINK_MODE=copy ${quote(appUv)} pip install --python ${quote(python)} -r backend/requirements-vision.txt --torch-backend=cu129 --index-strategy unsafe-best-match`,
    { env: setupEnv },
  );
  runSync(
    "upgrade vLLM packaging tools",
    `${quote(vllmPython)} -m pip install --upgrade pip 'setuptools>=77,<81' wheel uv`,
    { env: setupEnv },
  );
  runSync(
    "install vLLM",
    `UV_LINK_MODE=copy ${quote(vllmUv)} pip install --python ${quote(vllmPython)} -U ${quote(vllmSpec)} --torch-backend=${quote(vllmTorchBackend)} --index-strategy unsafe-best-match`,
    { env: setupEnv },
  );
  runSync(
    "verify vLLM import",
    `VLLM_PLUGINS='' ${quote(vllmPython)} -c "import vllm; print(vllm.__version__)"`,
    {
      env: setupEnv,
    },
  );
  ensureFrontendInstall();
  console.log("[setup   ] done");
}

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function requestText(url, timeoutMs = 2500, maxText = 180, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(parsed, { headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (size >= maxText) return;
        const text = String(chunk);
        chunks.push(text.slice(0, Math.max(0, maxText - size)));
        size += text.length;
      });
      res.on("end", () => {
        const status = res.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: chunks.join("").slice(0, maxText),
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("request timed out")));
    req.on("error", (error) => {
      resolve({
        ok: false,
        status: 0,
        text: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serviceUsesVllmVenv(def) {
  return (
    def.name === "paddle-vllm" ||
    (def.name === "has-text" &&
      String(process.env.HAS_TEXT_RUNTIME || "vllm").toLowerCase() === "vllm")
  );
}

function serviceUsesAppVenv(def) {
  return (
    def.name !== "frontend" &&
    def.name !== "glm-flash" &&
    !serviceUsesVllmVenv(def)
  );
}

async function requestTextWithRetry(url, timeoutMs = 2500, maxText = 180, headers = {}) {
  const attempts = boundedInt(process.env.DOCTOR_SERVICE_HEALTH_ATTEMPTS, 2, 1, 5);
  const retryDelayMs = boundedInt(process.env.DOCTOR_SERVICE_HEALTH_RETRY_DELAY_MS, 350, 0, 5000);
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await requestText(url, timeoutMs, maxText, headers);
    last = { ...result, attempts: attempt };
    if (result.ok) return last;
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  return last || { ok: false, status: 0, text: "request failed", attempts: 0 };
}

async function fetchHealth(url, timeoutMs = 2500, maxText = 180) {
  return requestTextWithRetry(url, timeoutMs, maxText);
}

async function checkServiceHealth(def, timeoutMs = 2500) {
  const health = await fetchHealth(def.health, timeoutMs);
  if (!health.ok || !def.contract) return health;

  const contract = await fetchHealth(
    def.contract.url,
    timeoutMs,
    def.contract.maxText || 20_000,
  );
  if (!contract.ok) {
    return {
      ok: false,
      status: contract.status,
      text: `${def.contract.label} unavailable: ${contract.text}`,
    };
  }
  const missing = def.contract.includes.filter((needle) => !contract.text.includes(needle));
  if (missing.length) {
    return {
      ok: false,
      status: contract.status,
      text: `${def.contract.label} stale; missing ${missing.join(", ")}`,
    };
  }
  return health;
}

async function fetchJson(url, timeoutMs = 2500, headers = {}) {
  const res = await requestText(url, timeoutMs, 20_000, headers);
  let body = null;
  if (res.text) {
    try {
      body = JSON.parse(res.text);
    } catch {
      body = res.text;
    }
  }
  return { ...res, body, text: res.text.slice(0, 180) };
}

async function preflight(defs) {
  const occupied = [];
  const unhealthyOccupied = [];
  const attached = [];
  const toStart = [];
  for (const def of defs) {
    if (!(await isPortOpen(def.port))) {
      toStart.push(def);
      continue;
    }
    if (!mode.attachExisting) {
      occupied.push(`${def.name}:${def.port}`);
      continue;
    }
    const health = await checkServiceHealth(def);
    if (health.ok) {
      attached.push(def);
    } else {
      unhealthyOccupied.push(
        `${def.name}:${def.port} ${health.status || "unhealthy"} ${health.text}`,
      );
    }
  }
  if (occupied.length) {
    throw new Error(
      `ports already in use: ${occupied.join(", ")}. Stop the old services first, or rerun with --attach-existing to reuse healthy services.`,
    );
  }
  if (unhealthyOccupied.length) {
    throw new Error(
      `ports are occupied but health checks failed: ${unhealthyOccupied.join("; ")}. Stop those processes or fix them before using --attach-existing.`,
    );
  }
  if (attached.length) {
    console.log(
      `[attach ] reusing healthy services: ${attached.map((def) => `${def.name}:${def.port}`).join(", ")}`,
    );
  }
  const needsAppVenv = toStart.some(serviceUsesAppVenv);
  const needsVllmVenv = toStart.some(serviceUsesVllmVenv);
  if (needsAppVenv && !pathExists(python)) {
    throw new Error(
      `app venv is missing at ${paths.venv}. Run npm run setup first.`,
    );
  }
  if (needsVllmVenv && !pathExists(vllmBin)) {
    throw new Error(
      `vLLM venv is missing at ${paths.vllmVenv}. Run npm run setup first.`,
    );
  }
  if (
    toStart.some((def) => def.name !== "frontend") &&
    isWindows &&
    (isPosixAbsolutePath(paths.venv) || isPosixAbsolutePath(paths.vllmVenv))
  ) {
    throw new Error(
      "This repo is configured with WSL/Linux virtualenv paths. From Windows, run start-dev.bat; inside WSL, run npm run dev.",
    );
  }
  return toStart;
}

function runExecutableQuiet(command, args = [], options = {}) {
  const useWsl = isWindows && isPosixAbsolutePath(command);
  const result = useWsl
    ? spawnSync(
        "wsl.exe",
        [
          "bash",
          "-lc",
          [posixQuote(command), ...args.map(posixQuote)].join(" "),
        ],
        {
          stdio: "pipe",
          encoding: "utf8",
          windowsHide: true,
        },
      )
    : spawnSync(command, args, {
        cwd: options.cwd || rootDir,
        env: { ...process.env, ...(options.env || {}) },
        stdio: "pipe",
        encoding: "utf8",
      });
  const stdout = String(result.stdout || "")
    .replaceAll("\u0000", "")
    .trim();
  const stderr = String(result.stderr || "")
    .replaceAll("\u0000", "")
    .trim();
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    output: `${stdout}${stdout && stderr ? "\n" : ""}${stderr}`.trim(),
  };
}

function checkPythonImport(moduleName, pythonPath = python) {
  const result = runExecutableQuiet(pythonPath, [
    "-c",
    `import ${moduleName}; print("ok")`,
  ]);
  return result.ok;
}

function runQuietCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: { ...process.env, ...(options.env || {}) },
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function parseGpuMemoryRows(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const [name, used, total] = line.split(",").map((part) => part.trim());
      return {
        name,
        used: Number.parseInt(used, 10),
        total: Number.parseInt(total, 10),
      };
    })
    .filter(
      (row) =>
        row.name &&
        Number.isFinite(row.used) &&
        Number.isFinite(row.total) &&
        row.total > 0,
    );
}

function processLabelForPid(pid, fallback) {
  if (!pid || isWindows) return fallback;
  const result = runQuietCommand("ps", ["-p", String(pid), "-o", "args="]);
  if (!result.ok || !result.output) return fallback;
  return result.output.replace(/\s+/g, " ").trim();
}

function parseGpuProcessRows(output) {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const [pidText, processName, usedText] = line
        .split(",")
        .map((part) => part.trim());
      const pid = Number.parseInt(pidText, 10);
      const used = Number.parseInt(usedText, 10);
      const fallbackName =
        processName && processName !== "[Not Found]" ? processName : "unknown";
      return {
        pid,
        name: processLabelForPid(pid, fallbackName),
        used: Number.isFinite(used) ? used : null,
      };
    })
    .filter((row) => Number.isFinite(row.pid));
}

function readEvalCredential() {
  const result = {
    configured: Boolean(
      process.env.DATAINFRA_TOKEN ||
        process.env.DATAINFRA_TOKEN_FILE ||
        process.env.DATAINFRA_PASSWORD,
    ),
    password_configured: Boolean(process.env.DATAINFRA_PASSWORD),
    token_source: null,
    token: "",
    token_file: process.env.DATAINFRA_TOKEN_FILE
      ? resolveTokenFilePath(process.env.DATAINFRA_TOKEN_FILE)
      : "",
    token_file_readable: null,
    token_file_nonempty: null,
    warnings: [],
  };
  if (process.env.DATAINFRA_TOKEN) {
    result.token_source = "DATAINFRA_TOKEN";
    result.token = String(process.env.DATAINFRA_TOKEN).trim();
    if (!result.token) {
      result.warnings.push("DATAINFRA_TOKEN is set but empty");
    }
    return result;
  }
  if (process.env.DATAINFRA_TOKEN_FILE) {
    result.token_source = "DATAINFRA_TOKEN_FILE";
    try {
      const raw = fs.readFileSync(result.token_file, "utf8");
      result.token_file_readable = true;
      result.token = raw.trim();
      result.token_file_nonempty = Boolean(result.token);
      if (!result.token_file_nonempty) {
        result.warnings.push("DATAINFRA_TOKEN_FILE is empty");
      }
    } catch (error) {
      result.token_file_readable = false;
      result.token_file_nonempty = false;
      const reason = error instanceof Error ? error.message : String(error);
      result.warnings.push(`DATAINFRA_TOKEN_FILE cannot be read: ${reason}`);
    }
    return result;
  }
  if (!process.env.DATAINFRA_PASSWORD) {
    const defaultTokenFile = resolveDefaultEvalTokenFile();
    if (fs.existsSync(defaultTokenFile)) {
      result.configured = true;
      result.token_source = "default-token-file";
      result.token_file = defaultTokenFile;
      try {
        const raw = fs.readFileSync(defaultTokenFile, "utf8");
        result.token_file_readable = true;
        result.token = raw.trim();
        result.token_file_nonempty = Boolean(result.token);
        if (!result.token_file_nonempty) {
          result.warnings.push("default eval token file is empty");
        }
      } catch (error) {
        result.token_file_readable = false;
        result.token_file_nonempty = false;
        const reason = error instanceof Error ? error.message : String(error);
        result.warnings.push(`default eval token file cannot be read: ${reason}`);
      }
    }
  }
  return result;
}

function envDisablesAuth(value) {
  return ["0", "false", "no", "off"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

function copyEvalCredentialFields(target, credential) {
  target.eval_credential_configured = credential.configured;
  target.eval_token_source = credential.token_source;
  target.eval_token_file = credential.token_file;
  target.eval_token_file_readable = credential.token_file_readable;
  target.eval_token_file_nonempty = credential.token_file_nonempty;
}

function printAuthCredentialSummary() {
  console.log(
    `auth env AUTH_ENABLED: ${process.env.AUTH_ENABLED ?? "(backend default true)"}`,
  );
  console.log(
    `auth env DATAINFRA_PASSWORD: ${process.env.DATAINFRA_PASSWORD ? "set" : "not set"}`,
  );
  console.log(
    `auth env DATAINFRA_TOKEN: ${process.env.DATAINFRA_TOKEN ? "set" : "not set"}`,
  );
  console.log(
    `auth env DATAINFRA_TOKEN_FILE: ${process.env.DATAINFRA_TOKEN_FILE ? "set" : "not set"}`,
  );
}

function printAuthEvalBlockedGuidance() {
  console.log(
    "auth decision: authenticated eval scripts and browser automation are blocked.",
  );
  console.log(
    "auth next: DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt",
  );
  console.log(
    "auth then public workflow: npm run eval:batch-e2e -- output/playwright/eval-batch-current",
  );
  console.log(
    "auth then private corpus gate: npm run eval:ceshi -- output/playwright/eval-ceshi-current",
  );
  console.log(
    "auth then custom real files: EVAL_CESHI_MANIFEST=fixtures/local-real-files.json npm run eval:ceshi -- output/playwright/eval-local-real-current",
  );
  console.log(
    "auth note: when auth is enabled, the eval scripts use tmp/eval-token.txt by default; set DATAINFRA_TOKEN_FILE only for a non-default token path.",
  );
  console.log(
    "auth browser: npm run test:e2e:live",
  );
  console.log("auth fallback: direct gates do not need backend auth:");
  console.log("  npm run eval:public -- output/playwright/eval-public-current");
  console.log(
    "  npm run eval:text-direct -- fixtures/eval/sample-contract.txt output/playwright/eval-text-direct-public",
  );
  console.log("  npm run fixtures:visual");
  console.log(
    "  npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public -- --ocr-mode off --skip-has-image --write-pages --max-warnings -1",
  );
  console.log(
    "  npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public-services -- --ocr-mode structure --write-pages --max-warnings -1 --min-total-has-image-regions 1",
  );
  console.log(
    "  npm run eval:vision-direct -- <pdf> output/playwright/eval-vision-direct-current -- --pages 1,5 --write-pages",
  );
  console.log(
    "  npm run eval:ocr -- <pdf> output/playwright/eval-ocr-current -- --mode both --pages 1,5 --write-pages",
  );
  console.log(
    "  npm run eval:seal -- <pdf> output/playwright/eval-seal-current",
  );
}

async function printAuthDoctor() {
  console.log("");
  printAuthCredentialSummary();
  const localAuthDisabled = envDisablesAuth(process.env.AUTH_ENABLED);
  let credential = {
    configured: Boolean(
      process.env.DATAINFRA_TOKEN ||
        process.env.DATAINFRA_TOKEN_FILE ||
        process.env.DATAINFRA_PASSWORD,
    ),
    password_configured: Boolean(process.env.DATAINFRA_PASSWORD),
    token_source: process.env.DATAINFRA_TOKEN
      ? "DATAINFRA_TOKEN"
      : process.env.DATAINFRA_TOKEN_FILE
        ? "DATAINFRA_TOKEN_FILE"
        : null,
    token: "",
    token_file: process.env.DATAINFRA_TOKEN_FILE || "",
    token_file_readable: null,
    token_file_nonempty: null,
    warnings: [],
  };
  const result = {
    ok: false,
    status: 0,
    text: "",
    auth_enabled: null,
    password_set: null,
    authenticated: null,
    eval_credential_configured: credential.configured,
    eval_token_source: credential.token_source,
    eval_token_file_readable: credential.token_file_readable,
    eval_token_file_nonempty: credential.token_file_nonempty,
    eval_token_authenticated: null,
    warnings: [],
  };
  copyEvalCredentialFields(result, credential);

  const authStatusUrl = `http://127.0.0.1:${ports.backend}/api/v1/auth/status`;
  if (!(await isPortOpen(ports.backend))) {
    console.log(`auth live: backend:${ports.backend} not listening`);
    if (localAuthDisabled) {
      console.log(
        "auth decision: AUTH_ENABLED=false in local env; eval credential checks are skipped until backend is listening.",
      );
    }
    result.text = "backend not listening";
    result.warnings.push("auth status unavailable");
    return result;
  }

  const authStatus = await fetchJson(authStatusUrl);
  result.ok = Boolean(authStatus.ok);
  result.status = authStatus.status || 0;
  result.text = authStatus.text || "";
  if (
    !authStatus.ok ||
    typeof authStatus.body !== "object" ||
    authStatus.body === null
  ) {
    console.log(
      `auth live: ${authStatus.status || "unreachable"} ${authStatus.text}`,
    );
    result.warnings.push("auth status unavailable");
    return result;
  }

  const body = authStatus.body;
  result.auth_enabled = Boolean(body.auth_enabled);
  result.password_set =
    body.password_set === null || body.password_set === undefined
      ? null
      : Boolean(body.password_set);
  result.authenticated = Boolean(body.authenticated);
  console.log(
    `auth live: enabled=${Boolean(body.auth_enabled)} password_set=${
      body.password_set === null || body.password_set === undefined
        ? "n/a"
        : Boolean(body.password_set)
    } authenticated=${Boolean(body.authenticated)}`,
  );

  if (!body.auth_enabled) {
    if (credential.configured) {
      console.log(
        "auth credential: DATAINFRA_* is configured but ignored because backend auth is disabled.",
      );
    }
    console.log(
      "auth decision: auth is disabled; authenticated API eval scripts can run without DATAINFRA_* credentials.",
    );
    return result;
  }

  credential = readEvalCredential();
  copyEvalCredentialFields(result, credential);
  for (const warning of credential.warnings) {
    result.warnings.push(warning);
    console.log(`warn ${warning}`);
  }

  if (body.auth_enabled && credential.token) {
    const tokenStatus = await fetchJson(authStatusUrl, 2500, {
      Authorization: `Bearer ${credential.token}`,
    });
    if (
      tokenStatus.ok &&
      typeof tokenStatus.body === "object" &&
      tokenStatus.body !== null
    ) {
      result.eval_token_authenticated = Boolean(
        tokenStatus.body.authenticated,
      );
      console.log(
        `auth token: source=${credential.token_source} authenticated=${result.eval_token_authenticated}`,
      );
      if (!result.eval_token_authenticated) {
        result.warnings.push(
          `${credential.token_source} is configured but not authenticated`,
        );
        console.log(
          `warn ${credential.token_source} is configured but /auth/status still reports authenticated=false`,
        );
      }
    } else {
      result.warnings.push("auth token status unavailable");
      console.log(
        `warn auth token status unavailable: ${tokenStatus.status || "unreachable"} ${tokenStatus.text}`,
      );
    }
  }

  if (body.auth_enabled && body.password_set === false) {
    result.warnings.push("auth enabled but no password is set");
    console.log(
      "warn auth is enabled but no password is set; open the web UI once to create it before running authenticated eval flows.",
    );
    console.log(
      `auth next: open http://localhost:${ports.frontend} and create the local administrator password.`,
    );
    console.log(
      "auth then: DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt",
    );
  } else if (body.auth_enabled && !body.authenticated && !credential.configured) {
    result.warnings.push("auth enabled and no eval credential is configured");
    console.log(
      "warn auth is enabled and no eval credential is configured; set DATAINFRA_PASSWORD, DATAINFRA_TOKEN, or DATAINFRA_TOKEN_FILE before npm run eval:* or browser automation.",
    );
    printAuthEvalBlockedGuidance();
  } else if (
    body.auth_enabled &&
    credential.configured &&
    (credential.password_configured || credential.token)
  ) {
    console.log(
      "auth decision: eval credential is configured; authenticated eval scripts can attempt login/token auth.",
    );
  } else if (body.auth_enabled && credential.configured) {
    console.log(
      "auth decision: eval credential is configured but not currently usable.",
    );
    printAuthEvalBlockedGuidance();
  }
  return result;
}

function doctorReportPath() {
  return (
    process.env.DOCTOR_REPORT_PATH ||
    path.join(rootDir, "output", "doctor-report.json")
  );
}

function buildDoctorNextSteps(report) {
  const failedChecks = report.checks.filter(
    (check) => check.required && !check.ok,
  );
  const unhealthyServices = report.services.filter(
    (service) => service.required && !service.ok,
  );
  const authWarnings = report.auth?.warnings || [];
  const nextSteps = [];

  if (failedChecks.length) {
    nextSteps.push({
      label: "install or refresh local dependencies",
      command: "npm run setup",
      when: "required venv, package, model, or import checks failed",
    });
  }

  if (unhealthyServices.length) {
    nextSteps.push({
      label: "CPU browser UI/API smoke",
      command: "docker compose up -d",
      when: "you only need to open the browser UI and inspect API/auth screens",
    });
    nextSteps.push({
      label: "GPU full recognition stack",
      command: "docker compose --profile gpu up -d",
      when: "you need OCR, HaS Text, HaS Image, review, and export",
    });
    nextSteps.push({
      label: "reuse already-running local services",
      command: "npm run dev:attach",
      when: "some localhost services are already healthy and should not be restarted",
    });
  }

  if (
    authWarnings.some((warning) =>
      /DATAINFRA|TOKEN|credential|password/i.test(warning),
    )
  ) {
    nextSteps.push({
      label: "create reusable eval token",
      command:
        "DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt",
      when: "auth is enabled and browser/API evals need credentials",
    });
  }

  nextSteps.push({
    label: "public no-auth quality gate",
    command: "npm run eval:public -- output/playwright/eval-public-current",
    when: "you need a reproducible check that avoids private files and auth",
  });
  nextSteps.push({
    label: "real-file eval with your own manifest",
    command:
      report.auth?.auth_enabled === false
        ? "EVAL_CESHI_MANIFEST=fixtures/local-real-files.json npm run eval:ceshi -- output/playwright/eval-local-real-current"
        : "EVAL_CESHI_MANIFEST=fixtures/local-real-files.json DATAINFRA_TOKEN_FILE=tmp/eval-token.txt npm run eval:ceshi -- output/playwright/eval-local-real-current",
    when:
      report.auth?.auth_enabled === false
        ? "auth is disabled, services are healthy, GPU is idle, and fixtures/local-real-files.json points at your local files"
        : "auth is enabled or unknown, services are healthy, GPU is idle, and fixtures/local-real-files.json points at your local files",
  });

  return nextSteps;
}

function printDoctorNextSteps(report) {
  report.next_steps = buildDoctorNextSteps(report);
  console.log("");
  console.log("doctor next steps:");
  for (const step of report.next_steps) {
    console.log(`- ${step.label}: ${step.command}`);
    console.log(`  when: ${step.when}`);
  }
  console.log("docs: docs/RUN_MODES.md");
}

async function doctor(options = {}) {
  const json = Boolean(options.json);
  const strict = Boolean(options.strict);
  const report = {
    generated_at: new Date().toISOString(),
    root: rootDir,
    runtime: isWindows ? "windows" : isWsl ? "wsl" : process.platform,
    strict,
    paths: {
      app_venv: paths.venv,
      vllm_venv: paths.vllmVenv,
      has_text_model: paths.hasTextModel,
      has_image_weights: paths.hasImageWeights,
      glm_flash_model: paths.glmFlashModel,
      glm_flash_mmproj: paths.glmFlashMmproj,
      model_provenance: paths.modelProvenance,
      python,
      vllm_python: vllmPython,
      vllm_cli: vllmBin,
      has_text_server_bin: paths.hasTextServerBin || null,
      python_include: pythonIncludeDir || null,
      python_platform_include: pythonPlatformIncludeDir || null,
    },
    config: {
      node_version: effectiveNodeVersion,
      node_engine: declaredNodeEngine || null,
      node_recommended: recommendedNodeVersion,
      node_version_file: nodeVersionFileVersion,
      paddle_index_url: paddleIndexUrl,
      vllm_spec: vllmSpec,
      vllm_torch_backend: vllmTorchBackend,
      ocr_max_new_tokens:
        process.env.OCR_MAX_NEW_TOKENS || defaultOcrMaxNewTokens,
      vision_page_concurrency:
        process.env.BATCH_RECOGNITION_PAGE_CONCURRENCY ||
        defaultVisionPageConcurrency,
      vision_dual_pipeline_parallel:
        process.env.VISION_DUAL_PIPELINE_PARALLEL ||
        defaultVisionDualPipelineParallel,
      has_text_gpu_layers:
        process.env.HAS_TEXT_N_GPU_LAYERS || defaultHasTextGpuLayers,
      glm_flash_enabled: envFlagEnabled("GLM_FLASH_ENABLED", false),
      glm_flash_port: ports.glmFlash,
      glm_flash_context: process.env.GLM_FLASH_N_CTX || "2048",
      glm_flash_parallel: process.env.GLM_FLASH_N_PARALLEL || "1",
      glm_flash_gpu_layers: process.env.GLM_FLASH_N_GPU_LAYERS || "auto",
    },
    checks: [],
    warnings: [],
    gpu: {
      available: false,
      rows: [],
      processes: [],
    },
    services: [],
    auth: null,
    has_text_server: hasTextServerDoctorConfig(),
    next_steps: [],
    summary: {
      failed_checks: 0,
      unhealthy_services: 0,
      warnings: 0,
      strict_pass: false,
    },
  };
  console.log(`root: ${rootDir}`);
  console.log(
    `runtime: ${isWindows ? "windows" : isWsl ? "wsl" : process.platform}`,
  );
  console.log(`app venv: ${paths.venv}`);
  console.log(`vllm venv: ${paths.vllmVenv}`);
  console.log(`paddle index: ${paddleIndexUrl}`);
  console.log(`python include: ${pythonIncludeDir || "(not found)"}`);
  console.log(
    `python platform include: ${pythonPlatformIncludeDir || "(not found)"}`,
  );
  console.log(`vllm spec: ${vllmSpec}`);
  console.log(`vllm torch backend: ${vllmTorchBackend}`);
  console.log(
    `node: ${effectiveNodeVersion}${declaredNodeEngine ? ` (project engine ${declaredNodeEngine})` : ""}`,
  );
  if (
    declaredNodeEngine &&
    !isNodeVersionSupported(effectiveNodeVersion, declaredNodeEngine)
  ) {
    report.warnings.push(
      `Node ${effectiveNodeVersion} is outside project engine ${declaredNodeEngine}`,
    );
    printNodeVersionGuidance("doctor");
  }
  const visionPageConcurrency =
    process.env.BATCH_RECOGNITION_PAGE_CONCURRENCY ||
    defaultVisionPageConcurrency;
  const visionDualPipelineParallel =
    process.env.VISION_DUAL_PIPELINE_PARALLEL ||
    defaultVisionDualPipelineParallel;
  const hasTextGpuLayers =
    process.env.HAS_TEXT_N_GPU_LAYERS || defaultHasTextGpuLayers;
  const ocrMaxNewTokens =
    process.env.OCR_MAX_NEW_TOKENS || defaultOcrMaxNewTokens;
  console.log(`OCR max new tokens: ${ocrMaxNewTokens}`);
  console.log(`vision page concurrency: ${visionPageConcurrency}`);
  console.log(`vision dual pipeline parallel: ${visionDualPipelineParallel}`);
  console.log(`HaS text GPU layers: ${hasTextGpuLayers}`);
  if (envFlagEnabled("GLM_FLASH_ENABLED", false)) {
    console.log(`GLM Flash model: ${paths.glmFlashModel}`);
    console.log(`GLM Flash mmproj: ${paths.glmFlashMmproj}`);
    console.log(`GLM Flash port: ${ports.glmFlash}`);
    console.log(`GLM Flash command preview: ${glmFlashRuntimeCommand()}`);
  }
  if (report.has_text_server.enabled) {
    console.log(
      `HaS Text external server: ${report.has_text_server.server_bin}`,
    );
    console.log(
      `HaS Text external model: ${report.has_text_server.model_path}`,
    );
    console.log(`HaS Text command preview: ${report.has_text_server.command}`);
    console.log(
      "HaS Text command preview is diagnostic only; doctor does not start llama-server or run inference.",
    );
  }
  console.log("");
  const glmFlashEnabled = envFlagEnabled("GLM_FLASH_ENABLED", false);
  const glmFlashServerBinPath = glmFlashServerBin();

  const checks = [
    ["app venv python", pathExists(python), python, true],
    ["vllm venv python", pathExists(vllmPython), vllmPython, true],
    ...(paths.hasTextServerBin
      ? [
          [
            "HaS Text external server",
            report.has_text_server.server_bin_exists,
            paths.hasTextServerBin,
            true,
          ],
          [
            "HaS Text external server model",
            report.has_text_server.model_path_exists,
            report.has_text_server.model_path,
            true,
          ],
        ]
      : []),
    ...(glmFlashEnabled
      ? [
          [
            "GLM Flash llama-server",
            Boolean(glmFlashServerBinPath) && pathExists(glmFlashServerBinPath),
            glmFlashServerBinPath || "set GLM_FLASH_SERVER_BIN",
            true,
          ],
          [
            "GLM Flash model",
            pathExists(paths.glmFlashModel),
            paths.glmFlashModel,
            true,
          ],
          [
            "GLM Flash mmproj",
            pathExists(paths.glmFlashMmproj),
            paths.glmFlashMmproj,
            true,
          ],
        ]
      : []),
    [
      "frontend deps",
      fs.existsSync(path.join(paths.frontend, "node_modules", "vite")) &&
        fs.existsSync(
          isWindows
            ? path.join(
                paths.frontend,
                "node_modules",
                "@rollup",
                "rollup-win32-x64-msvc",
              )
            : path.join(
                paths.frontend,
                "node_modules",
                "@rollup",
                "rollup-linux-x64-gnu",
              ),
        ),
      "frontend/node_modules",
      true,
    ],
    [
      "HaS text model",
      pathExists(paths.hasTextModel),
      paths.hasTextModel,
      true,
    ],
    [
      "HaS image weights",
      pathExists(paths.hasImageWeights),
      paths.hasImageWeights,
      true,
    ],
    [
      "model provenance doc",
      pathExists(paths.modelProvenance),
      paths.modelProvenance,
      true,
    ],
    [
      "fastapi import",
      pathExists(python) && checkPythonImport("fastapi"),
      "fastapi",
      true,
    ],
    [
      "paddle import",
      pathExists(python) && checkPythonImport("paddle"),
      "paddle",
      true,
    ],
    [
      "paddleocr import",
      pathExists(python) && checkPythonImport("paddleocr"),
      "paddleocr",
      true,
    ],
    [
      "ultralytics import",
      pathExists(python) && checkPythonImport("ultralytics"),
      "ultralytics",
      true,
    ],
    [
      "vllm import",
      pathExists(vllmPython) && checkPythonImport("vllm", vllmPython),
      "vllm",
      true,
    ],
    ["vllm cli", pathExists(vllmBin), vllmBin, true],
    [
      "llama_cpp import",
      pathExists(python) && checkPythonImport("llama_cpp"),
      "llama_cpp",
      !paths.hasTextServerBin,
    ],
  ];

  for (const [label, ok, detail, required] of checks) {
    report.checks.push({
      label,
      ok: Boolean(ok),
      detail,
      required: Boolean(required),
    });
    console.log(`${ok ? "ok  " : "fail"} ${label}: ${detail}`);
  }

  if (pathExists(python) && checkPythonImport("paddle")) {
    const probe = runExecutableQuiet(python, [
      "-c",
      'import paddle; print(f"paddle={paddle.__version__} cuda={paddle.is_compiled_with_cuda()} devices={paddle.device.cuda.device_count() if paddle.is_compiled_with_cuda() else 0}")',
    ]);
    console.log(probe.stdout || probe.output);
  }

  const gpuProbe = runQuietCommand("nvidia-smi", [
    "--query-gpu=name,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (gpuProbe.ok && gpuProbe.output) {
    console.log("");
    const gpuRows = parseGpuMemoryRows(gpuProbe.output);
    for (const [index, row] of gpuRows.entries()) {
      const ratio = row.used / row.total;
      console.log(
        `gpu ${index}: ${row.name} memory ${row.used}/${row.total} MiB (${(ratio * 100).toFixed(1)}%)`,
      );
      report.gpu.available = true;
      report.gpu.rows.push({
        index,
        name: row.name,
        used_mb: row.used,
        total_mb: row.total,
        used_ratio: ratio,
      });
      if (ratio >= 0.9) {
        report.warnings.push("GPU memory is above 90%");
        console.log(
          "warn GPU memory is above 90%; keep BATCH_RECOGNITION_PAGE_CONCURRENCY=1 and VISION_DUAL_PIPELINE_PARALLEL=false; keep HAS_TEXT_N_GPU_LAYERS=-1 so HaS Text stays on GPU, or wait for the other GPU job to finish.",
        );
      } else if (ratio >= 0.8) {
        report.warnings.push("GPU memory is above 80%");
        console.log(
          "warn GPU memory is above 80%; benchmark before increasing page or pipeline parallelism.",
        );
      }
    }
    const processProbe = runQuietCommand("nvidia-smi", [
      "--query-compute-apps=pid,process_name,used_memory",
      "--format=csv,noheader,nounits",
    ]);
    if (processProbe.ok && processProbe.output) {
      const processRows = parseGpuProcessRows(processProbe.output);
      if (processRows.length) {
        console.log("gpu processes:");
        for (const row of processRows) {
          const memory = row.used === null ? "memory n/a" : `${row.used} MiB`;
          report.gpu.processes.push({
            pid: row.pid,
            name: row.name,
            used_mb: row.used,
          });
          console.log(`  pid ${row.pid}: ${memory} ${row.name}`);
        }
      }
    }
  } else {
    console.log("");
    console.log("gpu: nvidia-smi unavailable");
    report.warnings.push("nvidia-smi unavailable");
  }
  if (hasTextGpuLayers === "0") {
    report.warnings.push("HaS text CPU fallback risk");
    console.log(
      "warn HaS text GPU layers are disabled (HAS_TEXT_N_GPU_LAYERS=0); /health/services will mark HaS Text degraded because this is CPU mode.",
    );
  } else {
    report.warnings.push("HaS text GPU layers are enabled");
    console.log(
      "warn HaS text GPU layers are enabled; on 16GB shared GPUs this can make OCR/vision services unstable.",
    );
  }
  if (Number.parseInt(visionPageConcurrency, 10) > 1) {
    report.warnings.push("vision page concurrency is above 1");
    console.log(
      "warn page concurrency > 1 can improve wall time but may create GPU tail latency; verify with npm run eval:vision.",
    );
  }
  if (String(visionDualPipelineParallel).toLowerCase() === "true") {
    report.warnings.push("vision dual pipeline parallelism is enabled");
    console.log(
      "warn page-internal OCR+HaS and HaS Image parallelism is enabled; use only when the two services do not contend for one GPU.",
    );
  }

  console.log("");
  for (const def of serviceDefinitions()) {
    const listening = await isPortOpen(def.port);
    const health = listening ? await checkServiceHealth(def) : null;
    const status = health
      ? `${health.status} ${health.ok ? "ok" : health.text}`
      : "not listening";
    report.services.push({
      name: def.name,
      port: def.port,
      health_url: def.health,
      listening,
      ok: Boolean(listening && health?.ok),
      status: health?.status || 0,
      text: health?.text || (listening ? "" : "not listening"),
      attempts: health?.attempts || 0,
      required: true,
    });
    console.log(
      `${listening ? "up  " : "down"} ${def.name}:${def.port} ${status}`,
    );
  }

  report.auth = await printAuthDoctor();
  report.summary.failed_checks = report.checks.filter(
    (check) => check.required && !check.ok,
  ).length;
  report.summary.unhealthy_services = report.services.filter(
    (service) => service.required && !service.ok,
  ).length;
  report.summary.warnings =
    report.warnings.length + (report.auth?.warnings?.length || 0);
  report.summary.strict_pass =
    report.summary.failed_checks === 0 &&
    report.summary.unhealthy_services === 0;
  printDoctorNextSteps(report);

  if (json) {
    const outputPath = doctorReportPath();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
    console.log(`doctor json: ${outputPath}`);
  }
  if (strict && !report.summary.strict_pass) {
    console.error(
      `doctor strict failed: ${report.summary.failed_checks} checks failed, ${report.summary.unhealthy_services} services unhealthy`,
    );
  }
  return report;
}

async function firstRun() {
  console.log("first-run: environment audit");
  console.log("");
  await doctor();
  console.log("");
  console.log("first-run: gate taxonomy");
  console.log("- contract gate: npm run test:scripts");
  console.log("- public no-auth quality gate: npm run eval:public");
  console.log("- public workflow gate: eval:batch-e2e with fixtures/eval");
  console.log("- private regression gate: eval:ceshi with private corpus files");
  console.log("");
  console.log("first-run: recommended path");
  console.log(
    "1. If any venv, dependency, or model check above says fail, run: npm run setup",
  );
  console.log(
    "2. Start or reuse local services: npm run dev -- --attach-existing",
  );
  console.log(`3. Open the workbench: http://localhost:${ports.frontend}`);
  console.log(
    "4. Run the script contract gate; this proves contracts, not real model quality:",
  );
  console.log("   npm run test:scripts");
  console.log("5. If auth is enabled, create a reusable eval token:");
  console.log(
    "   DATAINFRA_PASSWORD=<local-password> npm run eval:login -- tmp/eval-token.txt",
  );
  console.log("6. Run the reproducible public no-auth quality gate:");
  console.log(
    "   npm run eval:public -- output/playwright/eval-public-current",
  );
  console.log(
    "7. Run the public batch workflow gate. Omit token env vars when auth is disabled; with auth enabled, tmp/eval-token.txt is used by default:",
  );
  console.log(
    "   npm run eval:batch-e2e -- output/playwright/eval-batch-current",
  );
  console.log(
    "8. Run authenticated browser E2E against the already-running workbench:",
  );
  console.log(
    "   npm run test:e2e:live",
  );
  console.log("9. Run a public direct text gate when API auth is blocked:");
  console.log(
    "   npm run eval:text-direct -- fixtures/eval/sample-contract.txt output/playwright/eval-text-direct-public",
  );
  console.log(
    "10. Generate and run the public visual smoke fixture without auth or model services:",
  );
  console.log("   npm run fixtures:visual");
  console.log(
    "   npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public -- --ocr-mode off --skip-has-image --write-pages --max-warnings -1",
  );
  console.log(
    "11. If OCR/HaS Image services are up, run the public service-backed visual gate:",
  );
  console.log(
    "   npm run eval:vision-direct -- fixtures/eval/sample-visual.png output/playwright/eval-vision-direct-public-services -- --ocr-mode structure --write-pages --max-warnings -1 --min-total-has-image-regions 1",
  );
  console.log(
    "12. Run the private corpus regression gate when those files are available, model services are healthy, and the GPU is idle:",
  );
  console.log(
    "   npm run eval:ceshi -- output/playwright/eval-ceshi-current",
  );
  console.log(
    "13. If you do not have a private corpus directory, copy fixtures/local-real-files.example.json to fixtures/local-real-files.json, edit it, then provide the manifest:",
  );
  console.log(
    "   EVAL_CESHI_MANIFEST=fixtures/local-real-files.json npm run eval:ceshi -- output/playwright/eval-local-real-current",
  );
  console.log("14. Or pass private files explicitly to the lower-level batch E2E gate:");
  console.log(
    "   npm run eval:batch-e2e -- output/playwright/eval-batch-current <private-corpus-dir>/file.pdf <private-corpus-dir>/file.docx",
  );
  console.log(
    "15. If auth is blocked but model services are up, run direct visual baselines first:",
  );
  console.log(
    "   npm run eval:text-direct -- <docx-or-text> output/playwright/eval-text-direct-current",
  );
  console.log(
    "   npm run eval:vision-direct -- <pdf> output/playwright/eval-vision-direct-current -- --pages 1,5 --write-pages",
  );
  console.log("");
  console.log("first-run: reports to inspect");
  console.log(
    "- Batch API E2E: output/playwright/eval-batch-current/report.html",
  );
  console.log("- Direct model gates: output/playwright/eval-*/report.html");
  console.log("- Passing script contracts: npm run test:scripts");
}

function start(defs) {
  const children = new Map();
  let shuttingDown = false;

  if (!defs.length) {
    log(
      "dev",
      `all requested services are already healthy; frontend http://localhost:${ports.frontend}  backend http://localhost:${ports.backend}\n`,
    );
    runModelWarmup();
    return;
  }

  const keepAlive = setInterval(() => {}, 60_000);
  const ignoreBrokenPipe = (error) => {
    if (error?.code !== "EPIPE") throw error;
  };
  process.stdout.on("error", ignoreBrokenPipe);
  process.stderr.on("error", ignoreBrokenPipe);

  for (const def of defs) {
    log(def.name, `${def.display}\n`);
    const child = spawn(def.command, def.args, {
      cwd: def.cwd || rootDir,
      env: { ...process.env, ...(def.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
    });
    children.set(def.name, child);

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line) log(def.name, `${line}\n`);
      }
    });
    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line) log(def.name, `${line}\n`);
      }
    });
    child.on("exit", (code, signal) => {
      children.delete(def.name);
      if (!shuttingDown) log(def.name, `exited (${signal || code})\n`);
      if (!shuttingDown && children.size === 0) {
        clearInterval(keepAlive);
        process.exit(code || 1);
      }
    });
  }

  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    console.log("\n[dev     ] stopping services...");
    for (const child of children.values()) child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  void (async () => {
    const deadline = Date.now() + 180_000;
    const pending = new Set(defs.map((def) => def.name));
    while (pending.size && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      for (const def of defs) {
        if (!pending.has(def.name)) continue;
        const health = await checkServiceHealth(def, 2500);
        if (health.ok) {
          pending.delete(def.name);
          log("health", `${def.name} ready on ${def.health}\n`);
        }
      }
    }
    if (pending.size)
      log("health", `still waiting: ${Array.from(pending).join(", ")}\n`);
    log(
      "dev",
      `frontend http://localhost:${ports.frontend}  backend http://localhost:${ports.backend}\n`,
    );
    runModelWarmup();
  })();
}

async function main() {
  try {
    if (mode.firstRun) {
      await firstRun();
      return;
    }
    if (mode.hasTextServerDoctor) {
      const report = await doctorHasTextServer({
        json: mode.json,
        strict: mode.strict,
      });
      if (mode.strict && !report.ok) process.exit(1);
      return;
    }
    if (mode.doctor) {
      const report = await doctor({ json: mode.json, strict: mode.strict });
      if (mode.strict && !report.summary.strict_pass) process.exit(1);
      return;
    }
    if (mode.setup) {
      setup();
      return;
    }
    const defs = serviceDefinitions();
    const defsToStart = await preflight(defs);
    if (defsToStart.some((def) => def.name === "frontend"))
      ensureFrontendInstall();
    start(defsToStart);
  } catch (error) {
    console.error(
      `[dev     ] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

await main();
