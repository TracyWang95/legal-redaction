#!/usr/bin/env node
// Copyright 2026 DataInfra-RedactionEverything Contributors
// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises';

const LOCALES = [
  { name: 'zh', file: 'frontend/src/i18n/zh.ts' },
  { name: 'en', file: 'frontend/src/i18n/en.ts' },
];

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`No matching brace found at index ${openIndex}`);
}

function lineAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function extractBlocks(text, localeName) {
  const blocks = [];
  for (const match of text.matchAll(new RegExp(`const\\s+(${localeName}(?:Base|Overrides))\\s*:`, 'g'))) {
    const open = text.indexOf('{', match.index);
    const close = findMatchingBrace(text, open);
    blocks.push({
      name: match[1],
      body: text.slice(open, close + 1),
      offset: open,
    });
  }
  for (const match of text.matchAll(new RegExp(`Object\\.assign\\(\\s*(${localeName}Overrides)\\s*,\\s*{`, 'g'))) {
    const open = text.indexOf('{', match.index);
    const close = findMatchingBrace(text, open);
    blocks.push({
      name: `Object.assign(${match[1]})`,
      body: text.slice(open, close + 1),
      offset: open,
    });
  }
  return blocks;
}

function collectBlockKeys(text, block) {
  const keys = [];
  const regex = /'([^']+)'\s*:/g;
  let match;
  while ((match = regex.exec(block.body))) {
    keys.push({
      key: match[1],
      line: lineAt(text, block.offset + match.index),
    });
  }
  return keys;
}

async function readLocale(locale) {
  const text = await readFile(locale.file, 'utf8');
  const blocks = extractBlocks(text, locale.name);
  if (blocks.length < 2) {
    throw new Error(`${locale.file}: expected base and override translation blocks`);
  }
  const finalKeys = new Set();
  const duplicateErrors = [];
  for (const block of blocks) {
    const seen = new Map();
    for (const item of collectBlockKeys(text, block)) {
      finalKeys.add(item.key);
      if (seen.has(item.key)) {
        duplicateErrors.push(
          `${locale.file}:${item.line} duplicate key '${item.key}' inside ${block.name}; first seen at line ${seen.get(item.key)}`,
        );
      } else {
        seen.set(item.key, item.line);
      }
    }
  }
  return { ...locale, finalKeys, duplicateErrors };
}

function diffKeys(left, right) {
  return [...left].filter((key) => !right.has(key)).sort();
}

function printList(title, items) {
  if (items.length === 0) return;
  console.error(title);
  for (const item of items.slice(0, 100)) console.error(`  ${item}`);
  if (items.length > 100) console.error(`  ... ${items.length - 100} more`);
}

const locales = await Promise.all(LOCALES.map(readLocale));
const errors = locales.flatMap((locale) => locale.duplicateErrors);
const [zh, en] = locales;
const missingInEn = diffKeys(zh.finalKeys, en.finalKeys);
const missingInZh = diffKeys(en.finalKeys, zh.finalKeys);

if (missingInEn.length > 0) {
  errors.push(`${missingInEn.length} keys exist in zh but not en`);
  printList('Missing in en:', missingInEn);
}
if (missingInZh.length > 0) {
  errors.push(`${missingInZh.length} keys exist in en but not zh`);
  printList('Missing in zh:', missingInZh);
}
if (errors.length > 0) {
  printList('i18n check failed:', errors);
  process.exit(1);
}

console.log(`i18n check passed: zh=${zh.finalKeys.size} en=${en.finalKeys.size}`);
