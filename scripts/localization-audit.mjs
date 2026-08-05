#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectGameTextEntries } from './extract-game-texts.mjs';

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.resolve(ROOT, '..', 'gatbage');
export const LOCALE_DIR = path.join(ROOT, 'locales');
export const REPORT_DIR = path.join(ARCHIVE_ROOT, 'reference/localization');
export const SOURCE_LOCALE = 'ru';
const DEFAULT_LOCALES = ['en'];

const args = new Set(process.argv.slice(2));
const writeReports = args.has('--write');
const requestedLocales = process.argv
  .slice(2)
  .filter((arg, index, all) => all[index - 1] === '--locale' && /^[a-z][a-z0-9-]*$/i.test(arg));

export function rel(file) {
  return path.relative(ROOT, file).replaceAll(path.sep, '/');
}

export function hasCyrillic(text) {
  return /[А-Яа-яЁё]/.test(text);
}

export function normalizeSource(text) {
  return text.replace(/\r\n?/g, '\n').trim();
}

export function textId(text) {
  const hash = crypto.createHash('sha1').update(normalizeSource(text)).digest('hex').slice(0, 14);
  return `gt_${hash}`;
}

export function placeholders(text) {
  const out = new Set();
  for (const match of text.matchAll(/\$\{[^}]+\}/g)) out.add(match[0]);
  for (const match of text.matchAll(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g)) out.add(match[0]);
  for (const match of text.matchAll(/%[sdif]/g)) out.add(match[0]);
  return [...out].sort();
}

function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function canonicalCatalog() {
  const byId = new Map();
  for (const entry of collectGameTextEntries()) {
    if (!hasCyrillic(entry.text)) continue;
    const source = normalizeSource(entry.text);
    if (!source) continue;
    const id = textId(source);
    const existing = byId.get(id);
    const occurrence = {
      file: entry.file,
      line: entry.line,
      col: entry.col,
      key: entry.key,
      context: entry.context,
      kind: entry.kind,
    };
    if (existing) {
      existing.occurrences.push(occurrence);
      continue;
    }
    byId.set(id, {
      id,
      sourceLocale: SOURCE_LOCALE,
      source,
      placeholders: placeholders(source),
      occurrences: [occurrence],
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function localeFiles() {
  if (!fs.existsSync(LOCALE_DIR)) return [];
  return fs.readdirSync(LOCALE_DIR)
    .filter(name => name.endsWith('.json') && !name.startsWith('_'))
    .map(name => path.join(LOCALE_DIR, name))
    .sort((a, b) => rel(a).localeCompare(rel(b)));
}

export function readLocale(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${rel(file)} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${rel(file)} must contain a JSON object`);
  }
  const locale = typeof parsed.locale === 'string' && parsed.locale.trim()
    ? parsed.locale.trim()
    : path.basename(file, '.json');
  const entries = parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
    ? parsed.entries
    : {};
  return { file, locale, data: parsed, entries };
}

export function emptyLocale(locale) {
  return {
    file: path.join(LOCALE_DIR, `${locale}.json`),
    locale,
    data: { locale, sourceLocale: SOURCE_LOCALE, entries: {} },
    entries: {},
  };
}

export function translationText(record) {
  if (typeof record === 'string') return record;
  if (!record || typeof record !== 'object') return '';
  return typeof record.translation === 'string' ? record.translation : '';
}

export function auditLocale(catalog, localeData) {
  const canonicalById = new Map(catalog.map(entry => [entry.id, entry]));
  const translated = [];
  const missing = [];
  const todo = [];
  const sourceMismatches = [];
  const placeholderErrors = [];
  const orphan = [];

  for (const entry of catalog) {
    const record = localeData.entries[entry.id];
    const translatedText = translationText(record).trim();
    if (!record) {
      missing.push(entry);
      continue;
    }
    if (!translatedText || (record && typeof record === 'object' && record.status === 'todo')) {
      todo.push(entry);
      continue;
    }
    if (record && typeof record === 'object' && typeof record.source === 'string' && normalizeSource(record.source) !== entry.source) {
      sourceMismatches.push(entry);
    }
    const translatedPlaceholders = placeholders(translatedText);
    if (!sameList(entry.placeholders, translatedPlaceholders)) {
      placeholderErrors.push({
        id: entry.id,
        source: entry.source,
        translation: translatedText,
        expected: entry.placeholders,
        actual: translatedPlaceholders,
      });
    }
    translated.push(entry);
  }

  for (const id of Object.keys(localeData.entries)) {
    if (!canonicalById.has(id)) orphan.push(id);
  }

  return {
    locale: localeData.locale,
    file: rel(localeData.file),
    total: catalog.length,
    translated: translated.length,
    missing,
    todo,
    sourceMismatches,
    placeholderErrors,
    orphan,
  };
}

export function firstOccurrence(entry) {
  const first = entry.occurrences[0];
  return first ? `${first.file}:${first.line}:${first.col}` : '';
}

function markdownEscape(text) {
  return text.replaceAll('```', '`\\`\\`');
}

export function writeReport(catalog, audits) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const json = {
    generatedAt: new Date().toISOString(),
    sourceLocale: SOURCE_LOCALE,
    totalCanonicalStrings: catalog.length,
    locales: audits.map(audit => ({
      locale: audit.locale,
      file: audit.file,
      total: audit.total,
      translated: audit.translated,
      missing: audit.missing.length,
      todo: audit.todo.length,
      sourceMismatches: audit.sourceMismatches.length,
      placeholderErrors: audit.placeholderErrors.length,
      orphan: audit.orphan.length,
    })),
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'audit.json'), `${JSON.stringify(json, null, 2)}\n`, 'utf8');

  for (const audit of audits) {
    const lines = [];
    lines.push(`# Missing Localization: ${audit.locale}`);
    lines.push('');
    lines.push(`Source locale: \`${SOURCE_LOCALE}\`.`);
    lines.push(`Locale file: \`${audit.file}\`.`);
    lines.push(`Canonical strings: ${audit.total}.`);
    lines.push(`Translated: ${audit.translated}.`);
    lines.push(`Missing: ${audit.missing.length}.`);
    lines.push(`Todo records: ${audit.todo.length}.`);
    lines.push('');
    lines.push('Add entries to `locales/<locale>.json`; do not edit Russian source text unless the canonical game text should change.');
    lines.push('');
    for (const entry of [...audit.missing, ...audit.todo]) {
      lines.push(`## ${entry.id}`);
      lines.push('');
      lines.push(`source: \`${firstOccurrence(entry)}\``);
      if (entry.placeholders.length > 0) lines.push(`placeholders: \`${entry.placeholders.join('`, `')}\``);
      lines.push('');
      lines.push('```text');
      lines.push(markdownEscape(entry.source));
      lines.push('```');
      lines.push('');
    }
    fs.writeFileSync(path.join(REPORT_DIR, `missing-${audit.locale}.md`), `${lines.join('\n')}\n`, 'utf8');
  }
}

export function printAudit(audits) {
  for (const audit of audits) {
    console.log(
      `${audit.locale}: ${audit.translated}/${audit.total} translated, `
      + `${audit.missing.length} missing, ${audit.todo.length} todo, `
      + `${audit.placeholderErrors.length} placeholder errors, ${audit.orphan.length} orphan`,
    );
    for (const entry of audit.missing.slice(0, 8)) {
      const oneLine = entry.source.replace(/\s+/g, ' ').slice(0, 96);
      console.log(`  missing ${entry.id} ${firstOccurrence(entry)} ${oneLine}`);
    }
    if (audit.missing.length > 8) console.log(`  ... ${audit.missing.length - 8} more missing`);
  }
}

function main() {
  const catalog = canonicalCatalog();
  const files = localeFiles();
  const locales = requestedLocales.length > 0
    ? requestedLocales.map(locale => {
      const file = path.join(LOCALE_DIR, `${locale}.json`);
      return fs.existsSync(file) ? readLocale(file) : emptyLocale(locale);
    })
    : (files.length > 0 ? files.map(readLocale) : DEFAULT_LOCALES.map(emptyLocale));

  const audits = locales.map(locale => auditLocale(catalog, locale));
  printAudit(audits);
  if (writeReports) {
    writeReport(catalog, audits);
    console.log(`Wrote ${rel(REPORT_DIR)}/audit.json and missing-<locale>.md reports.`);
  }

  const hasHardErrors = audits.some(audit => audit.placeholderErrors.length > 0 || audit.sourceMismatches.length > 0);
  if (hasHardErrors) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
