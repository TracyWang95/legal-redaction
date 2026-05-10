#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_OUT = path.join('output', 'model-provenance-manifest.json');
const DEFAULT_MODEL_DIRS = ['D:\\has_models', '/mnt/d/has_models'];
const SOURCE_DOC = 'docs/MODEL_PROVENANCE.md';

const MODEL_SPECS = [
  {
    basename: 'HaS_Text_0209_0.6B_Q4_K_M.gguf',
    role: 'has_text',
    requirement: 'required',
    upstream: {
      repo: 'xuanwulab/HaS_4.0_0.6B_GGUF',
      url: 'https://huggingface.co/xuanwulab/HaS_4.0_0.6B_GGUF',
      revision: '39a643aa8f19ad6c324fe96dacb1fc292fbe6095',
      revisionSource: 'huggingface-api',
      revisionCheckedAt: '2026-05-06',
      lastModified: '2025-10-28T05:18:45.000Z',
      license: 'MIT',
      sourceDoc: SOURCE_DOC,
    },
  },
  {
    basename: 'sensitive_seg_best.pt',
    role: 'has_image',
    requirement: 'required',
    upstream: {
      repo: 'xuanwulab/HaS_Image_0209_FP32',
      url: 'https://huggingface.co/xuanwulab/HaS_Image_0209_FP32',
      revision: '3ed1114d783274208695e422bf22c017d6424669',
      revisionSource: 'huggingface-api',
      revisionCheckedAt: '2026-05-06',
      lastModified: '2026-03-03T08:11:20.000Z',
      license: 'MIT',
      sourceDoc: SOURCE_DOC,
    },
  },
  {
    basename: 'GLM-4.6V-Flash-Q4_K_M.gguf',
    role: 'vlm',
    requirement: 'optional',
    upstream: {
      repo: 'unsloth/GLM-4.6V-Flash-GGUF',
      url: 'https://huggingface.co/unsloth/GLM-4.6V-Flash-GGUF',
      revision: 'c78a0727cb5ee489db2f218a212f613943023ee8',
      revisionSource: 'huggingface-api',
      revisionCheckedAt: '2026-05-06',
      lastModified: '2025-12-27T11:17:13.000Z',
      license: 'MIT',
      sourceDoc: SOURCE_DOC,
    },
  },
  {
    basename: 'mmproj-F16.gguf',
    role: 'vlm_mmproj',
    requirement: 'optional',
    upstream: {
      repo: 'unsloth/GLM-4.6V-Flash-GGUF',
      url: 'https://huggingface.co/unsloth/GLM-4.6V-Flash-GGUF/blob/main/mmproj-F16.gguf',
      revision: 'c78a0727cb5ee489db2f218a212f613943023ee8',
      revisionSource: 'huggingface-api',
      revisionCheckedAt: '2026-05-06',
      lastModified: '2025-12-27T11:17:13.000Z',
      license: 'MIT',
      sourceDoc: SOURCE_DOC,
    },
  },
];

const OPTIONAL_PATTERNS = [
  {
    pattern: /^has_4\.0_0\.6b.*\.gguf$/i,
    role: 'has_text',
    requirement: 'optional',
    relation: 'alternate-local-name',
    upstream: MODEL_SPECS[0].upstream,
  },
  {
    pattern: /^mmproj-.*\.gguf$/i,
    role: 'vlm_mmproj',
    requirement: 'optional',
    relation: 'multimodal-projector',
    upstream: MODEL_SPECS[3].upstream,
  },
  {
    pattern: /^glm-4\.6v-flash-.*\.gguf$/i,
    role: 'vlm',
    requirement: 'optional',
    relation: 'quantization-variant',
    upstream: MODEL_SPECS[2].upstream,
  },
];

function usage() {
  console.log(`Usage:
  node scripts/create-model-provenance-manifest.mjs [--out path] [--models-dir path ...]

Creates a privacy-preserving manifest for local model files. By default it
checks D:\\has_models and /mnt/d/has_models for HaS Text, HaS Image, and optional
VLM/mmproj files. The JSON manifest stores basenames only, never absolute model
paths.
`);
}

function parseArgs(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    usage();
    process.exit(0);
  }

  let out = DEFAULT_OUT;
  const modelDirs = [];
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
    if (arg === '--models-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--models-dir requires a path');
      modelDirs.push(value);
      continue;
    }
    if (arg.startsWith('--models-dir=')) {
      modelDirs.push(arg.slice('--models-dir='.length));
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    modelDirs.push(arg);
  }

  return {
    out,
    modelDirs: modelDirs.length > 0 ? modelDirs : DEFAULT_MODEL_DIRS,
  };
}

function specKey(basename) {
  return basename.toLowerCase();
}

function knownSpecForBasename(basename) {
  const direct = MODEL_SPECS.find((spec) => spec.basename.toLowerCase() === basename.toLowerCase());
  if (direct) return direct;

  const patternSpec = OPTIONAL_PATTERNS.find((spec) => spec.pattern.test(basename));
  if (!patternSpec) return null;
  return {
    basename,
    role: patternSpec.role,
    requirement: patternSpec.requirement,
    relation: patternSpec.relation,
    upstream: patternSpec.upstream,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function listDirectFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function discoverKnownFiles(modelDirs) {
  const found = new Map();
  let existingRootCount = 0;
  let duplicateBasenameCount = 0;

  for (const dir of modelDirs) {
    if (!existsSync(dir)) continue;
    existingRootCount += 1;
    for (const filePath of await listDirectFiles(dir)) {
      const basename = path.basename(filePath);
      const spec = knownSpecForBasename(basename);
      if (!spec) continue;

      const key = specKey(basename);
      if (found.has(key)) {
        duplicateBasenameCount += 1;
        continue;
      }

      const info = await stat(filePath);
      found.set(key, {
        basename,
        role: spec.role,
        requirement: spec.requirement,
        required: spec.requirement === 'required',
        found: true,
        sizeBytes: info.size,
        sha256: await sha256File(filePath),
        upstream: spec.upstream,
        ...(spec.relation ? { relation: spec.relation } : {}),
      });
    }
  }

  return { found, existingRootCount, duplicateBasenameCount };
}

function missingEntry(spec) {
  return {
    basename: spec.basename,
    role: spec.role,
    requirement: spec.requirement,
    required: spec.requirement === 'required',
    found: false,
    sizeBytes: null,
    sha256: null,
    upstream: spec.upstream,
  };
}

function sortModels(left, right) {
  const requirementOrder = { required: 0, optional: 1 };
  const roleOrder = { has_text: 0, has_image: 1, vlm: 2, vlm_mmproj: 3 };
  const byRequirement = requirementOrder[left.requirement] - requirementOrder[right.requirement];
  if (byRequirement !== 0) return byRequirement;
  const byRole = (roleOrder[left.role] ?? 99) - (roleOrder[right.role] ?? 99);
  if (byRole !== 0) return byRole;
  return left.basename.localeCompare(right.basename);
}

async function createManifest({ modelDirs }) {
  const { found, existingRootCount, duplicateBasenameCount } = await discoverKnownFiles(modelDirs);
  const models = [];

  for (const spec of MODEL_SPECS) {
    const entry = found.get(specKey(spec.basename));
    models.push(entry || missingEntry(spec));
  }

  for (const [key, entry] of found.entries()) {
    if (MODEL_SPECS.some((spec) => specKey(spec.basename) === key)) continue;
    models.push(entry);
  }

  models.sort(sortModels);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: {
      absolutePathsIncluded: false,
      searchedPathCount: modelDirs.length,
      existingSearchRootCount: existingRootCount,
      note: 'Manifest records model basenames, sizes, hashes, roles, requirements, and upstream provenance only.',
    },
    summary: {
      modelCount: models.length,
      foundCount: models.filter((model) => model.found).length,
      requiredMissing: models
        .filter((model) => model.required && !model.found)
        .map((model) => model.basename),
      duplicateBasenameCount,
    },
    models,
  };
}

const args = parseArgs(process.argv.slice(2));
const manifest = await createManifest(args);

await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
await writeFile(args.out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`model provenance manifest: ${args.out}`);
console.log(`models=${manifest.summary.modelCount} found=${manifest.summary.foundCount} required_missing=${manifest.summary.requiredMissing.length}`);
