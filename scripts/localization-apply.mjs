#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCALE_DIR,
  SOURCE_LOCALE,
  auditLocale,
  canonicalCatalog,
  firstOccurrence,
  readLocale,
  rel,
} from './localization-audit.mjs';

const args = process.argv.slice(2);

function argValue(name, fallback = '') {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function usage() {
  console.error('Usage: node scripts/localization-apply.mjs --locale en --file locales/_en_batch.json --write');
}

function readBatch(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${rel(file)} is not valid JSON: ${err.message}`);
  }
  const entries = parsed?.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
    ? parsed.entries
    : parsed;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error(`${rel(file)} must contain an entries object or an id-to-translation object`);
  }
  return entries;
}

function translationFrom(record) {
  if (typeof record === 'string') return { translation: record, status: 'done', notes: '' };
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { translation: '', status: 'todo', notes: '' };
  return {
    translation: typeof record.translation === 'string' ? record.translation : '',
    status: typeof record.status === 'string' ? record.status : 'done',
    notes: typeof record.notes === 'string' ? record.notes : '',
  };
}

function seedRecord(entry, translation, status, notes) {
  return {
    source: entry.source,
    sourceHash: entry.id.slice(3),
    translation,
    status,
    placeholders: entry.placeholders,
    firstOccurrence: firstOccurrence(entry),
    notes,
  };
}

function main() {
  const locale = argValue('--locale', 'en').toLowerCase();
  const batchFile = argValue('--file');
  const write = args.includes('--write');
  if (!batchFile) {
    usage();
    process.exitCode = 1;
    return;
  }

  const file = path.join(LOCALE_DIR, `${locale}.json`);
  if (!fs.existsSync(file)) throw new Error(`${rel(file)} does not exist. Run l10n:seed first.`);

  const catalog = canonicalCatalog();
  const canonicalById = new Map(catalog.map(entry => [entry.id, entry]));
  const localeData = readLocale(file);
  const batch = readBatch(path.resolve(batchFile));
  let applied = 0;
  const unknown = [];

  for (const id of Object.keys(batch).sort()) {
    const entry = canonicalById.get(id);
    if (!entry) {
      unknown.push(id);
      continue;
    }
    const incoming = translationFrom(batch[id]);
    if (!incoming.translation.trim()) continue;
    const existing = localeData.entries[id];
    const notes = incoming.notes || (existing && typeof existing === 'object' && typeof existing.notes === 'string' ? existing.notes : '');
    localeData.entries[id] = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...seedRecord(entry, incoming.translation, incoming.status || 'done', notes),
    };
    applied++;
  }

  if (unknown.length > 0) {
    for (const id of unknown.slice(0, 20)) console.error(`Unknown localization id: ${id}`);
    if (unknown.length > 20) console.error(`... ${unknown.length - 20} more unknown ids`);
    process.exitCode = 1;
    return;
  }

  localeData.data.locale = locale;
  localeData.data.sourceLocale = SOURCE_LOCALE;
  localeData.data.entries = Object.fromEntries(Object.entries(localeData.entries).sort(([a], [b]) => a.localeCompare(b)));
  const audit = auditLocale(catalog, {
    file,
    locale,
    data: localeData.data,
    entries: localeData.data.entries,
  });
  console.log(
    `${locale}: ${audit.translated}/${audit.total} translated, `
    + `${audit.missing.length} missing, ${audit.todo.length} todo, `
    + `${audit.placeholderErrors.length} placeholder errors, ${audit.orphan.length} orphan`,
  );

  if (audit.placeholderErrors.length > 0 || audit.sourceMismatches.length > 0) {
    for (const error of audit.placeholderErrors.slice(0, 10)) {
      console.error(`Placeholder mismatch ${error.id}: expected ${error.expected.join(', ') || '(none)'}, got ${error.actual.join(', ') || '(none)'}`);
    }
    if (audit.sourceMismatches.length > 0) console.error(`${audit.sourceMismatches.length} source mismatches`);
    process.exitCode = 1;
    return;
  }

  if (write) {
    fs.writeFileSync(file, `${JSON.stringify(localeData.data, null, 2)}\n`, 'utf8');
    console.log(`Applied ${applied} translations from ${rel(path.resolve(batchFile))}.`);
  } else {
    console.log(`Would apply ${applied} translations from ${rel(path.resolve(batchFile))}.`);
    console.log('Run with --write to update the locale file.');
  }
}

main();
