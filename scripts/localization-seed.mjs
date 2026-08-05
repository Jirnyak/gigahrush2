#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCALE_DIR,
  SOURCE_LOCALE,
  auditLocale,
  canonicalCatalog,
  emptyLocale,
  firstOccurrence,
  readLocale,
  rel,
} from './localization-audit.mjs';

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function validateLocale(locale) {
  if (!/^[a-z][a-z0-9-]*$/i.test(locale)) {
    throw new Error(`Invalid locale "${locale}". Use a simple code like "en" or "pt-br".`);
  }
  return locale.toLowerCase();
}

function seedRecord(entry) {
  return {
    source: entry.source,
    sourceHash: entry.id.slice(3),
    translation: '',
    status: 'todo',
    placeholders: entry.placeholders,
    firstOccurrence: firstOccurrence(entry),
    notes: '',
  };
}

function mergeRecord(record, entry) {
  if (typeof record === 'string') return record;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return seedRecord(entry);

  const {
    source,
    translation,
    status,
    notes,
    sourceHash: _sourceHash,
    placeholders: _placeholders,
    firstOccurrence: _firstOccurrence,
    ...extra
  } = record;
  const text = typeof translation === 'string' ? translation : '';
  return {
    source: typeof source === 'string' ? source : entry.source,
    sourceHash: entry.id.slice(3),
    translation: text,
    status: typeof status === 'string' ? status : (text.trim() ? 'done' : 'todo'),
    placeholders: entry.placeholders,
    firstOccurrence: firstOccurrence(entry),
    notes: typeof notes === 'string' ? notes : '',
    ...extra,
  };
}

function hasKeepableOrphan(record) {
  if (typeof record === 'string') return record.trim().length > 0;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const translation = typeof record.translation === 'string' ? record.translation.trim() : '';
  const notes = typeof record.notes === 'string' ? record.notes.trim() : '';
  return translation.length > 0 || notes.length > 0 || record.status !== 'todo';
}

function sortedObject(entries) {
  const out = {};
  for (const key of Object.keys(entries).sort()) out[key] = entries[key];
  return out;
}

function main() {
  const locale = validateLocale(argValue('--locale', 'en'));
  const write = args.includes('--write');
  const name = argValue('--name', locale === 'en' ? 'English' : locale);
  const file = path.join(LOCALE_DIR, `${locale}.json`);
  const catalog = canonicalCatalog();
  const existing = fs.existsSync(file) ? readLocale(file) : emptyLocale(locale);
  const entries = {};
  let added = 0;
  let refreshed = 0;
  const canonicalIds = new Set(catalog.map(entry => entry.id));

  for (const entry of catalog) {
    const record = existing.entries[entry.id];
    if (record === undefined) {
      entries[entry.id] = seedRecord(entry);
      added++;
    } else {
      entries[entry.id] = mergeRecord(record, entry);
      refreshed++;
    }
  }

  let orphan = 0;
  let droppedStaleTodo = 0;
  for (const id of Object.keys(existing.entries)) {
    if (canonicalIds.has(id)) continue;
    if (hasKeepableOrphan(existing.entries[id])) {
      entries[id] = existing.entries[id];
      orphan++;
    } else {
      droppedStaleTodo++;
    }
  }

  const data = {
    ...existing.data,
    locale,
    name: typeof existing.data.name === 'string' && existing.data.name.trim() ? existing.data.name : name,
    sourceLocale: SOURCE_LOCALE,
    entries: sortedObject(entries),
  };

  const audit = auditLocale(catalog, { file, locale, data, entries: data.entries });
  console.log(
    `${locale}: ${audit.translated}/${audit.total} translated, `
    + `${audit.missing.length} missing, ${audit.todo.length} todo, `
    + `${audit.placeholderErrors.length} placeholder errors, ${audit.orphan.length} orphan`,
  );
  console.log(`${write ? 'Seeded' : 'Would seed'} ${rel(file)}: ${added} added, ${refreshed} refreshed, ${orphan} orphan preserved, ${droppedStaleTodo} stale todo dropped.`);

  if (!write) {
    console.log('Run with --write to update the locale file.');
    return;
  }
  fs.mkdirSync(LOCALE_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

main();
