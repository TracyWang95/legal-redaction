#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.join(rootDir, 'frontend');
const backendDir = path.join(rootDir, 'backend');
const nodeBin = process.execPath;
const npmBin = 'npm';
const pythonBin = resolvePythonBin();
const cmdBin = process.env.ComSpec || 'cmd.exe';

function venvPython(venvDir) {
  return path.join(venvDir, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

function resolvePythonBin() {
  if (process.env.PYTHON) return process.env.PYTHON;
  const configuredVenv = process.env.VENV_DIR ? path.resolve(process.env.VENV_DIR) : null;
  const candidates = [
    configuredVenv ? venvPython(configuredVenv) : null,
    venvPython(path.join(rootDir, '.venv')),
    venvPython(path.join(rootDir, 'backend/.venv')),
  ].filter(Boolean);
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) return existing;
  return process.platform === 'win32' ? 'python.exe' : 'python3';
}

function npmCommand(args) {
  if (process.platform !== 'win32') return [npmBin, ...args];
  return [cmdBin, '/d', '/s', '/c', [npmBin, ...args].join(' ')];
}

const CORE_STEPS = [
  {
    id: 'i18n',
    label: 'i18n parity',
    command: [nodeBin, 'scripts/check-i18n.mjs'],
  },
  {
    id: 'docs-contract',
    label: 'docs and npm script contracts',
    command: [nodeBin, 'scripts/test-docs-contract.mjs'],
  },
  {
    id: 'document-fixtures-contract',
    label: 'public document fixture generator contract',
    command: [nodeBin, 'scripts/test-create-eval-document-fixtures.mjs'],
  },
  {
    id: 'model-provenance-manifest-contract',
    label: 'model provenance manifest privacy contract',
    command: [nodeBin, 'scripts/test-create-model-provenance-manifest.mjs'],
  },
  {
    id: 'release-readiness-report-contract',
    label: 'release readiness evidence report contract',
    command: [nodeBin, 'scripts/test-release-readiness-report.mjs'],
  },
  {
    id: 'has-text-gpu-preflight-contract',
    label: 'HaS Text GPU preflight dry-run contract',
    command: [nodeBin, 'scripts/test-has-text-gpu-preflight.mjs'],
  },
  {
    id: 'ui-browser-contract-script',
    label: 'UI browser contract script dry-run/preflight checks',
    command: [nodeBin, 'scripts/test-ui-browser-contract.mjs'],
  },
  {
    id: 'dev-attach-docs',
    label: 'dev attach and docs guard',
    command: [nodeBin, 'scripts/test-dev-attach.mjs'],
  },
  {
    id: 'frontend-batch-review',
    label: 'frontend batch review focused tests',
    command: [nodeBin, 'scripts/test-frontend-batch-review.mjs'],
  },
  {
    id: 'backend-vision-contracts',
    label: 'backend OCR/vision contract tests',
    command: [
      pythonBin,
      '-m',
      'pytest',
      'tests/test_vision_ocr_pipeline.py',
      'tests/test_type_mapping.py',
      'tests/test_has_image_categories_contract.py',
      'tests/test_vision_no_regex_contract.py',
      'tests/test_image_redaction_behavior.py',
      'tests/test_warmup_models.py',
      '-q',
    ],
    cwd: backendDir,
  },
  {
    id: 'eval-auth-contracts',
    label: 'eval auth script contracts',
    command: [nodeBin, 'scripts/test-eval-auth.mjs'],
  },
  {
    id: 'eval-login-contracts',
    label: 'eval login script contracts',
    command: [nodeBin, 'scripts/test-eval-login.mjs'],
  },
  {
    id: 'eval-report-contracts',
    label: 'eval report rendering contracts',
    command: [nodeBin, 'scripts/test-eval-text-report.mjs'],
  },
  {
    id: 'eval-vision-report-contracts',
    label: 'eval vision report contracts',
    command: [nodeBin, 'scripts/test-eval-vision-report.mjs'],
  },
  {
    id: 'eval-public-contract',
    label: 'public eval script contract',
    command: [nodeBin, 'scripts/test-eval-public.mjs'],
  },
  {
    id: 'eval-batch-contract',
    label: 'batch eval script contract',
    command: [nodeBin, 'scripts/test-eval-batch-e2e.mjs'],
  },
  {
    id: 'eval-ceshi-contract',
    label: 'maintainer real-file eval script contract',
    command: [nodeBin, 'scripts/test-eval-ceshi.mjs'],
  },
  {
    id: 'eval-ceshi-perf-contract',
    label: 'maintainer PDF performance script contract',
    command: [nodeBin, 'scripts/test-eval-ceshi-perf.mjs'],
  },
];

const OPTIONAL_STEPS = {
  frontendBuild: {
    id: 'frontend-build',
    label: 'frontend production build',
    command: npmCommand(['run', 'build']),
    displayCommand: [npmBin, 'run', 'build'],
    cwd: frontendDir,
  },
  backendPytest: {
    id: 'backend-key-pytest',
    label: 'backend key pytest subset',
    command: [
      pythonBin,
      '-m',
      'pytest',
      'tests/test_auth_api.py',
      'tests/test_files_api.py',
      'tests/test_redaction_orchestrator.py',
      '-q',
    ],
    cwd: backendDir,
  },
};

function usage() {
  console.log(`Usage:
  npm run quality
  npm run quality:fast
  npm run quality:dry
  npm run quality:frontend
  npm run quality:backend
  npm run quality:full

Default fast gate:
  - i18n key parity
  - docs and root npm script contracts
  - model provenance manifest privacy contract
  - release readiness evidence report contract
  - HaS Text GPU preflight script contract using fake health and GPU mocks
  - UI browser contract dry-run/preflight script checks
  - dev attach/docs guard contracts
  - focused frontend batch review tests
  - backend OCR/vision contract tests
  - eval script contract tests with public/temp fixtures

The default gate only runs script/unit-style checks and public/temp fixtures. It
does not run private corpus real files or wrapper diagnostics, does not start model or
GPU services, and does not run the full backend pytest suite or frontend
production build.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    withFrontendBuild: false,
    withBackendPytest: false,
  };

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run' || arg === '--dry') {
      options.dryRun = true;
    } else if (arg === '--fast') {
      // Fast is the default; keep the flag for discoverability and npm aliases.
    } else if (arg === '--with-frontend-build') {
      options.withFrontendBuild = true;
    } else if (arg === '--with-backend-pytest') {
      options.withBackendPytest = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function buildSteps(options) {
  const steps = [...CORE_STEPS];
  if (options.withFrontendBuild) steps.push(OPTIONAL_STEPS.frontendBuild);
  if (options.withBackendPytest) steps.push(OPTIONAL_STEPS.backendPytest);
  return steps;
}

function quotePart(part) {
  if (!/[^\w./:\\-]/.test(part)) return part;
  return JSON.stringify(part);
}

function formatCommand(step) {
  const cwd = step.cwd && step.cwd !== rootDir ? `cd ${path.relative(rootDir, step.cwd)} && ` : '';
  const command = step.displayCommand || step.command;
  return `${cwd}${command.map(quotePart).join(' ')}`;
}

function printPlan(steps, options) {
  console.log(`local quality gate: ${options.dryRun ? 'dry run' : 'fast'}`);
  console.log(
    'scope: script/unit-style checks and public/temp fixtures only; no private corpus real-file or wrapper diagnostics gate; no model or GPU services by default',
  );
  for (const [index, step] of steps.entries()) {
    console.log(`${index + 1}. ${step.id}: ${formatCommand(step)}`);
  }
  printOptionalHints(options);
}

function printOptionalHints(options) {
  const hints = [];
  if (!options.withFrontendBuild) hints.push('frontend build: npm run quality:frontend');
  if (!options.withBackendPytest) hints.push('backend key pytest: npm run quality:backend');
  if (!options.withFrontendBuild || !options.withBackendPytest) {
    hints.push('combined heavier gate: npm run quality:full');
  }
  if (hints.length === 0) return;

  console.log('\noptional heavier checks:');
  for (const hint of hints) console.log(`- ${hint}`);
}

function runStep(step) {
  console.log(`\nquality gate: ${step.id}`);
  console.log(`$ ${formatCommand(step)}`);
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: step.cwd || rootDir,
    env: {
      ...process.env,
      EVAL_BATCH_USE_LOCAL_CESHI: '0',
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

const options = parseArgs(process.argv.slice(2));
const steps = buildSteps(options);
printPlan(steps, options);

if (options.dryRun) {
  process.exit(0);
}

for (const step of steps) {
  const status = runStep(step);
  if (status !== 0) {
    console.error(`\nquality gate failed: ${step.id}`);
    process.exit(status);
  }
}

console.log('\nquality=pass');
