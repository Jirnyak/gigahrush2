import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.resolve(ROOT, '..', 'gatbage');
const DEFAULT_SOURCES = path.join(
  ARCHIVE_ROOT,
  'reference/scenario_writers/samosbor_source_urls.json',
);
const DEFAULT_OUT = path.join(
  ARCHIVE_ROOT,
  'reference/scenario_writers/samosbor_source_texts.jsonl',
);
const DEFAULT_REPORT = path.join(
  ARCHIVE_ROOT,
  'reference/scenario_writers/samosbor_source_texts_report.md',
);

const DEFAULT_KEYWORDS = [
  'самосбор',
  'само-сбор',
  'гигахрущ',
  'гигахрущёв',
  'гигахрущев',
  'хрущ',
  'хрущёв',
  'хрущев',
  'хрущепедия',
  'гермодвер',
  'герма',
  'ликвидатор',
  'бугурт',
  'анон',
  'тред',
  'двач',
  '2ch',
  'сектор',
  'сирена',
  'туман',
  'слизь',
  'апартам',
  'этаж',
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function intArg(name, fallback) {
  const raw = argValue(name, String(fallback));
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${raw}`);
  }
  return parsed;
}

function nowIso() {
  return new Date().toISOString();
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function decodeHtmlEntities(text) {
  const named = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
    ['nbsp', ' '],
    ['thinsp', ' '],
    ['ensp', ' '],
    ['emsp', ' '],
    ['laquo', '«'],
    ['raquo', '»'],
    ['bdquo', '„'],
    ['ldquo', '“'],
    ['rdquo', '”'],
    ['lsquo', '‘'],
    ['rsquo', '’'],
    ['ndash', '-'],
    ['mdash', '-'],
    ['hellip', '...'],
  ]);

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return named.get(body) ?? entity;
  });
}

function removeBoilerplateHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(?:nav|footer|header|aside|form|button|select|option)\b[\s\S]*?<\/(?:nav|footer|header|aside|form|button|select|option)>/gi, ' ');
}

function htmlToText(html) {
  const stripped = removeBoilerplateHtml(html)
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|td|th|article|section|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeText(decodeHtmlEntities(stripped));
}

function normalizeText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTitle(html, fallback) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? fallback;
  return normalizeText(htmlToText(title)).slice(0, 180);
}

function splitLongText(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const sentences = text
    .split(/(?<=[.!?…。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    const chunks = [];
    for (let start = 0; start < text.length; start += maxChars) {
      chunks.push(text.slice(start, start + maxChars).trim());
    }
    return chunks;
  }

  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    current = sentence.length > maxChars ? sentence.slice(0, maxChars).trim() : sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitChunks(text, maxChars) {
  const rough = text
    .split(/\n{2,}|\n(?=[^\n]{80,}$)/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const chunks = [];
  for (const part of rough) {
    chunks.push(...splitLongText(part, maxChars));
  }
  return chunks.map((part) => normalizeText(part)).filter(Boolean);
}

function keywordMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword.toLowerCase()));
}

function looksLikeContent(text) {
  if (!/[А-Яа-яЁёA-Za-z]/.test(text)) return false;
  if (/^(?:войти|регистрация|подписаться|поделиться|читать далее|загрузка|cookie)$/i.test(text)) {
    return false;
  }
  const letters = text.replace(/[^А-Яа-яЁёA-Za-z]/g, '').length;
  return letters >= Math.max(20, Math.floor(text.length * 0.35));
}

function safeId(text) {
  return text
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9а-яё]+/giu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'source';
}

function normalizeUrl(value, baseUrl) {
  try {
    const url = new URL(decodeHtmlEntities(value), baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const url = normalizeUrl(match[2], baseUrl);
    if (url) links.push(url);
  }
  return links;
}

function linkAllowed(url, discover) {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }
  const haystacks = [url, decoded];
  if (Array.isArray(discover.include) && discover.include.length) {
    if (!discover.include.some((part) => haystacks.some((value) => value.includes(part)))) {
      return false;
    }
  }
  if (
    Array.isArray(discover.exclude)
    && discover.exclude.some((part) => haystacks.some((value) => value.includes(part)))
  ) {
    return false;
  }
  if (discover.same_origin !== false) {
    try {
      const sourceOrigin = new URL(discover.base_url ?? url).origin;
      if (new URL(url).origin !== sourceOrigin) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function discoverSources(source, timeoutMs) {
  if (!source.discover || source.discover.enabled === false) return [];
  const html = await fetchHtml(source, timeoutMs);
  const discover = {
    max_links: 40,
    same_origin: true,
    base_url: source.url,
    exclude: [
      'Special:',
      'Служебная:',
      'File:',
      'Файл:',
      'User:',
      'Участник:',
      'Template:',
      'Шаблон:',
      'Category:',
      'Категория:',
      'action=',
      'oldid=',
    ],
    ...source.discover,
  };
  const out = [];
  const seen = new Set();
  for (const url of extractLinks(html, source.url)) {
    if (out.length >= discover.max_links) break;
    if (seen.has(url) || !linkAllowed(url, discover)) continue;
    seen.add(url);
    const title = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? url)
      .replaceAll('_', ' ');
    out.push({
      ...source,
      id: `${source.id}_${hashText(url)}`,
      title,
      url,
      tags: [...new Set([...source.tags, 'discovered'])],
      discover: undefined,
      discovered_from: source.id,
    });
  }
  return out;
}

async function fetchHtml(source, timeoutMs) {
  const response = await fetch(source.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      'user-agent': 'GIGAH|RUSH scenario source parser/1.0 (+https://tenevik.itch.io/gigahrush)',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!/(?:text\/html|text\/plain|application\/xhtml\+xml|application\/json)/i.test(contentType)) {
    throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
  }
  return await response.text();
}

function readSources(file) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sources = Array.isArray(payload) ? payload : payload.sources;
  if (!Array.isArray(sources)) throw new Error(`No sources array in ${file}`);
  return sources.map((source, index) => {
    if (!source.url || typeof source.url !== 'string') {
      throw new Error(`Source ${index} is missing url`);
    }
    return {
      id: source.id || safeId(source.url),
      title: source.title || source.id || source.url,
      url: source.url,
      policy: source.policy || 'paraphrase_only',
      tags: Array.isArray(source.tags) ? source.tags : [],
      keywords: Array.isArray(source.keywords) ? source.keywords : [],
      max_per_source: Number.isFinite(source.max_per_source) && source.max_per_source > 0
        ? Math.floor(source.max_per_source)
        : undefined,
      discover: source.discover && typeof source.discover === 'object' ? source.discover : undefined,
    };
  });
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(temp, body ? `${body}\n` : '', 'utf8');
  fs.renameSync(temp, file);
}

function writeReport(file, summary) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '# Samosbor Source Text Parser Report',
    '',
    `Generated: ${summary.generatedAt}`,
    `Source config: \`${summary.sourcesFile}\``,
    `Database: \`${summary.outFile}\``,
    '',
    '## Totals',
    '',
    `- Sources configured: ${summary.sourceCount}`,
    `- Sources fetched: ${summary.fetchedCount}`,
    `- Sources failed: ${summary.failed.length}`,
    `- Records written: ${summary.recordCount}`,
    `- Duplicate chunks skipped: ${summary.duplicateCount}`,
    '',
    '## Source Results',
    '',
    '| Source | Records | Status | URL |',
    '| --- | ---: | --- | --- |',
  ];
  for (const item of summary.sources) {
    lines.push(`| \`${item.id}\` | ${item.records} | ${item.status} | ${item.url} |`);
  }
  if (summary.failed.length) {
    lines.push('', '## Failures', '');
    for (const failure of summary.failed) {
      lines.push(`- \`${failure.id}\`: ${failure.error}`);
    }
  }
  lines.push(
    '',
    '## Rule',
    '',
    'The `text` field in the JSONL database is parser output only. Local agents must not hand-write example phrases, sample sentences or sample paragraphs into this database.',
    '',
  );
  fs.writeFileSync(file, `${lines.join('\n')}`, 'utf8');
}

async function main() {
  const sourcesFile = path.resolve(argValue('--sources', DEFAULT_SOURCES));
  const outFile = path.resolve(argValue('--out', DEFAULT_OUT));
  const reportFile = path.resolve(argValue('--report', DEFAULT_REPORT));
  const maxPerSource = intArg('--max-per-source', 120);
  const minChars = intArg('--min-chars', 80);
  const maxChars = intArg('--max-chars', 700);
  const timeoutMs = intArg('--timeout-ms', 20_000);
  const generatedAt = nowIso();
  const configuredSources = readSources(sourcesFile);
  const sourceByUrl = new Map(configuredSources.map((source) => [source.url, source]));
  const discoveryFailures = [];
  for (const source of configuredSources) {
    try {
      for (const discovered of await discoverSources(source, timeoutMs)) {
        if (!sourceByUrl.has(discovered.url)) sourceByUrl.set(discovered.url, discovered);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      discoveryFailures.push({ id: source.id, error: message });
    }
  }
  const sources = [...sourceByUrl.values()];
  const records = [];
  const seen = new Set();
  let duplicateCount = 0;
  const results = [];
  const failed = [...discoveryFailures.map((failure) => ({
    id: `${failure.id}:discovery`,
    error: failure.error,
  }))];

  for (const source of sources) {
    const startedRecordCount = records.length;
    try {
      const html = await fetchHtml(source, timeoutMs);
      const title = extractTitle(html, source.title);
      const keywords = [...DEFAULT_KEYWORDS, ...source.keywords];
      const chunks = splitChunks(htmlToText(html), maxChars);
      const sourceLimit = source.max_per_source ?? maxPerSource;
      let sourceIndex = 0;
      for (const chunk of chunks) {
        if (sourceIndex >= sourceLimit) break;
        if (chunk.length < minChars || !looksLikeContent(chunk)) continue;
        const matches = keywordMatches(chunk, keywords);
        if (matches.length === 0) continue;
        const normalized = normalizeText(chunk);
        const hash = hashText(`${source.url}\n${normalized}`);
        if (seen.has(hash)) {
          duplicateCount += 1;
          continue;
        }
        seen.add(hash);
        sourceIndex += 1;
        records.push({
          id: `${source.id}.${String(sourceIndex).padStart(4, '0')}`,
          kind: 'source_excerpt',
          source_id: source.id,
          source_title: source.title,
          page_title: title,
          url: source.url,
          retrieved_at: generatedAt,
          index: sourceIndex,
          hash,
          char_count: normalized.length,
          matched_keywords: matches,
          tags: source.tags,
          copy_policy: source.policy,
          text: normalized,
        });
      }
      results.push({
        id: source.id,
        url: source.url,
        records: records.length - startedRecordCount,
        status: 'ok',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: source.id, error: message });
      results.push({
        id: source.id,
        url: source.url,
        records: 0,
        status: `failed: ${message.replace(/\|/g, '/')}`,
      });
    }
  }

  writeJsonl(outFile, records);
  writeReport(reportFile, {
    generatedAt,
    sourcesFile,
    outFile,
    sourceCount: sources.length,
    fetchedCount: sources.length - (failed.length - discoveryFailures.length),
    failed,
    sources: results,
    recordCount: records.length,
    duplicateCount,
  });

  console.log(`wrote ${records.length} records to ${outFile}`);
  console.log(`wrote report to ${reportFile}`);
  if (failed.length) {
    console.log(`failed sources: ${failed.map((item) => item.id).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
