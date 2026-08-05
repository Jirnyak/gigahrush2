import { type TitleLanguageId } from '../data/languages';

type RuntimeLocaleCatalogData = readonly [
  readonly (readonly [string, string])[],
  readonly (readonly [string, string])[],
];

interface TemplateRule {
  anchor: string;
  regex: RegExp;
  placeholders: string[];
  translation: string;
}

interface RuntimeCatalog {
  exact: Map<string, string>;
  templates: TemplateRule[];
}

declare global {
  // Injected by Vite as a compact runtime-only catalog. Node tests use the tiny fallback below.
  var __GIGAHRUSH_EN_LOCALE__: RuntimeLocaleCatalogData | undefined;
}

const CYRILLIC_RE = /[А-Яа-яЁё]/;
const CYRILLIC_GLOBAL_RE = /[А-Яа-яЁё]/g;
const CYRILLIC_LETTER_RE = /[А-Яа-яЁё]/;
const LETTER_RE = /[A-Za-zА-Яа-яЁё]/;
const TRANSLATION_CACHE_LIMIT = 8192;
const COMPOSED_TEXT_MAX_LENGTH = 180;
const COMPOSED_MATCH_MAX_LENGTH = 160;
const FALLBACK_EN_LOCALE: RuntimeLocaleCatalogData = [
  [
    ['1kpmy5f', 'Continue'],
  ],
  [
    ['Снято ${moved} руб.', 'Withdrew ${moved} rub.'],
  ],
];

let activeLanguage: TitleLanguageId = 'ru';
let englishCatalog: RuntimeCatalog | null = null;
let canvasLocalizationInstalled = false;
const translationCache = new Map<string, string>();

function sourceKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readDollarPlaceholder(source: string, start: number): string | null {
  if (source[start] !== '$' || source[start + 1] !== '{') return null;
  let depth = 1;
  for (let i = start + 2; i < source.length; i++) {
    const ch = source[i] ?? '';
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function readBracePlaceholder(source: string, start: number): string | null {
  if (source[start] !== '{') return null;
  const match = /^\{[A-Za-z_][A-Za-z0-9_]*\}/.exec(source.slice(start));
  return match?.[0] ?? null;
}

function splitTemplateSource(source: string): { parts: string[]; placeholders: string[] } {
  const parts: string[] = [];
  const placeholders: string[] = [];
  let last = 0;
  for (let i = 0; i < source.length;) {
    const placeholder = readDollarPlaceholder(source, i) ?? readBracePlaceholder(source, i);
    if (!placeholder) {
      i++;
      continue;
    }
    parts.push(source.slice(last, i));
    placeholders.push(placeholder);
    i += placeholder.length;
    last = i;
  }
  parts.push(source.slice(last));
  return { parts, placeholders };
}

function templateAnchor(parts: readonly string[]): string {
  let best = '';
  for (const part of parts) {
    const clean = part.replace(/\s+/g, ' ').trim();
    if (CYRILLIC_RE.test(clean) && clean.length > best.length) best = clean;
  }
  return best;
}

function compileTemplateRule(source: string, translation: string): TemplateRule | null {
  const { parts, placeholders } = splitTemplateSource(source);
  if (placeholders.length === 0) return null;
  const anchor = templateAnchor(parts);
  if (!anchor) return null;

  let pattern = '^';
  for (let i = 0; i < placeholders.length; i++) {
    pattern += escapeRegExp(parts[i]) + '([\\s\\S]*?)';
  }
  pattern += escapeRegExp(parts[parts.length - 1]) + '$';

  return {
    anchor,
    regex: new RegExp(pattern),
    placeholders,
    translation,
  };
}

function runtimeEnglishLocaleData(): RuntimeLocaleCatalogData {
  return globalThis.__GIGAHRUSH_EN_LOCALE__ ?? FALLBACK_EN_LOCALE;
}

function buildEnglishCatalog(): RuntimeCatalog {
  const data = runtimeEnglishLocaleData();
  const exact = new Map<string, string>();
  for (const [key, translation] of data[0]) exact.set(key, translation);
  const templates: TemplateRule[] = [];
  const templateData = data[1];

  for (const [source, translation] of templateData) {
    const rule = compileTemplateRule(source, translation);
    if (rule) templates.push(rule);
  }

  templates.sort((a, b) => b.anchor.length - a.anchor.length);
  return { exact, templates };
}

function catalogForActiveLanguage(): RuntimeCatalog | null {
  if (activeLanguage === 'ru') return null;
  englishCatalog ??= buildEnglishCatalog();
  return englishCatalog;
}

function applyTemplateRule(text: string, rule: TemplateRule, catalog: RuntimeCatalog): string | null {
  const anchorIndex = text.indexOf(rule.anchor);
  if (anchorIndex < 0) return null;
  if (
    rule.anchor.length === 1
    && CYRILLIC_LETTER_RE.test(rule.anchor)
    && CYRILLIC_LETTER_RE.test(text[anchorIndex + 1] ?? '')
  ) {
    return null;
  }
  const match = rule.regex.exec(text);
  if (!match) return null;

  let out = rule.translation;
  for (let i = 0; i < rule.placeholders.length; i++) {
    const value = match[i + 1] ?? '';
    const translatedValue = CYRILLIC_RE.test(value)
      ? (translateWithCatalog(value, catalog, 1) ?? value)
      : value;
    out = out.split(rule.placeholders[i]).join(translatedValue);
  }
  return CYRILLIC_RE.test(out) ? null : out;
}

function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
  return !LETTER_RE.test(text[index - 1] ?? '') || !LETTER_RE.test(text[index] ?? '');
}

function exactTranslation(text: string, catalog: RuntimeCatalog): string | null {
  const exact = catalog.exact.get(sourceKey(text));
  if (exact !== undefined) return exact;

  const first = text[0] ?? '';
  const lowered = first.toLocaleLowerCase('ru-RU');
  if (first === lowered) return null;
  const fallback = catalog.exact.get(sourceKey(`${lowered}${text.slice(1)}`));
  if (fallback === undefined) return null;
  return fallback.replace(/[A-Za-z]/, ch => ch.toUpperCase());
}

function translateComposedText(text: string, catalog: RuntimeCatalog): string | null {
  if (text.length > COMPOSED_TEXT_MAX_LENGTH || !CYRILLIC_RE.test(text)) return null;

  let out = '';
  let changed = false;
  let unresolvedCyrillic = false;

  for (let i = 0; i < text.length;) {
    const ch = text[i] ?? '';
    if (!CYRILLIC_LETTER_RE.test(ch) || !isWordBoundary(text, i)) {
      out += ch;
      i += 1;
      continue;
    }

    let bestEnd = -1;
    let bestTranslation = '';
    const maxEnd = Math.min(text.length, i + COMPOSED_MATCH_MAX_LENGTH);
    for (let end = maxEnd; end > i; end--) {
      if (!isWordBoundary(text, end)) continue;
      const candidate = text.slice(i, end).trimEnd();
      if (!candidate || !CYRILLIC_RE.test(candidate)) continue;
      const translated = exactTranslation(candidate, catalog);
      if (translated !== null) {
        bestEnd = i + candidate.length;
        bestTranslation = translated;
        break;
      }
    }

    if (bestEnd > i) {
      out += bestTranslation;
      i = bestEnd;
      changed = true;
      continue;
    }

    let wordEnd = i + 1;
    while (wordEnd < text.length && CYRILLIC_LETTER_RE.test(text[wordEnd] ?? '')) wordEnd++;
    out += text.slice(i, wordEnd);
    unresolvedCyrillic = true;
    i = wordEnd;
  }

  if (!changed) return null;
  if (unresolvedCyrillic && CYRILLIC_RE.test(out)) return null;
  return out;
}

function translateDelimitedText(text: string, catalog: RuntimeCatalog): string | null {
  if (!CYRILLIC_RE.test(text) || text.length > COMPOSED_TEXT_MAX_LENGTH) return null;
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    const isDecimalPoint = ch === '.'
      && /\d/.test(text[i - 1] ?? '')
      && /\d/.test(text[i + 1] ?? '');
    if ((!':;.!?'.includes(ch) || isDecimalPoint)) continue;
    let end = i + 1;
    while (end < text.length && /\s/.test(text[end] ?? '')) end++;
    parts.push(text.slice(start, i));
    parts.push(text.slice(i, end));
    start = end;
  }
  parts.push(text.slice(start));
  if (parts.length <= 1) return null;

  let out = '';
  let changed = false;
  for (const part of parts) {
    if (!part || !CYRILLIC_RE.test(part) || /^[:;.!?]\s*$/.test(part)) {
      out += part;
      continue;
    }
    const leading = part.match(/^\s*/)?.[0] ?? '';
    const trailing = part.match(/\s*$/)?.[0] ?? '';
    const core = part.slice(leading.length, part.length - trailing.length);
    const translated = exactTranslation(core, catalog) ?? translateComposedText(core, catalog);
    if (translated === null) {
      out += part;
      continue;
    }
    out += `${leading}${translated}${trailing}`;
    changed = true;
  }

  return changed && !CYRILLIC_RE.test(out) ? out : null;
}

function translateTemplateText(text: string, catalog: RuntimeCatalog): string | null {
  for (const rule of catalog.templates) {
    const translated = applyTemplateRule(text, rule, catalog);
    if (translated !== null) return translated;
  }

  return null;
}

function cyrillicSpan(text: string): { start: number; end: number } | null {
  CYRILLIC_GLOBAL_RE.lastIndex = 0;
  let first = -1;
  let last = -1;
  for (const match of text.matchAll(CYRILLIC_GLOBAL_RE)) {
    const index = match.index ?? -1;
    if (first < 0) first = index;
    last = index;
  }
  return first >= 0 && last >= first ? { start: first, end: last + 1 } : null;
}

function translateDecoratedText(text: string, catalog: RuntimeCatalog, derived: boolean): string | null {
  const span = cyrillicSpan(text);
  if (!span || (span.start === 0 && span.end === text.length)) return null;

  const middle = text.slice(span.start, span.end);
  const translated = exactTranslation(middle, catalog)
    ?? (derived ? translateTemplateText(middle, catalog) : null)
    ?? (derived ? translateComposedText(middle, catalog) : null);
  return translated === null ? null : `${text.slice(0, span.start)}${translated}${text.slice(span.end)}`;
}

function translateWithCatalog(text: string, catalog: RuntimeCatalog | null, depth = 0): string | null {
  if (!catalog || !text || !CYRILLIC_RE.test(text)) return null;
  return exactTranslation(text, catalog)
    ?? translateDecoratedText(text, catalog, false)
    ?? translateTemplateText(text, catalog)
    ?? translateDelimitedText(text, catalog)
    ?? translateDecoratedText(text, catalog, true)
    ?? (depth < 2 ? translateComposedText(text, catalog) : null);
}

export function setLocalizationLanguage(id: TitleLanguageId): void {
  activeLanguage = id === 'en' ? 'en' : 'ru';
  translationCache.clear();
}

export function getLocalizationLanguage(): TitleLanguageId {
  return activeLanguage;
}

export function translateText(input: string): string {
  const catalog = catalogForActiveLanguage();
  if (!catalog || !input || !CYRILLIC_RE.test(input)) return input;

  const cached = translationCache.get(input);
  if (cached !== undefined) return cached;

  const leading = input.match(/^\s*/)?.[0] ?? '';
  const trailing = input.match(/\s*$/)?.[0] ?? '';
  const core = input.slice(leading.length, input.length - trailing.length);
  const translated = translateWithCatalog(core, catalog);
  const out = translated === null ? input : `${leading}${translated}${trailing}`;

  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) translationCache.clear();
  translationCache.set(input, out);
  return out;
}

function localizedCanvasText(value: unknown): string {
  return translateText(String(value));
}

const CANVAS_TEXT_GLITCH_CHARS = '#%&*+=?/\\<>[]{}';
const CANVAS_TEXT_GLITCH_RE = /[A-Za-zА-Яа-яЁё]/;
const CANVAS_TEXT_GLITCH_BASE_PER_MILLE = 10;
const CANVAS_TEXT_GLITCH_SAMOSBOR_BASE_PER_MILLE = 50;
const CANVAS_TEXT_GLITCH_MAX_PER_MILLE = 100;

let canvasTextGlitchPerMille = CANVAS_TEXT_GLITCH_BASE_PER_MILLE;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function setCanvasTextGlitchPressure(context: { healthRatio?: number; samosborActive?: boolean } = {}): void {
  const healthRatio = Number.isFinite(context.healthRatio) ? clamp01(context.healthRatio ?? 1) : 1;
  const base = context.samosborActive ? CANVAS_TEXT_GLITCH_SAMOSBOR_BASE_PER_MILLE : CANVAS_TEXT_GLITCH_BASE_PER_MILLE;
  const lowHealth = smoothstep01(1 - healthRatio);
  canvasTextGlitchPerMille = Math.round(base + (CANVAS_TEXT_GLITCH_MAX_PER_MILLE - base) * lowHealth);
}

function canvasTextGlitchTick(): number {
  const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  return Math.floor(now / 85);
}

function canvasTextGlitchHash(text: string, index: number, x: number, y: number, tick: number): number {
  let h = (0x811c9dc5 ^ tick ^ Math.round(x * 7) ^ Math.round(y * 13)) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) + i * 17;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= Math.imul(index + 1, 0x9e3779b9);
  h ^= h >>> 16;
  return h >>> 0;
}

function canvasTextGlitch(text: string, x: number, y: number): string {
  if (text.length < 4) return text;
  const chars = Array.from(text);
  const maxChanges = Math.max(1, Math.min(4, Math.floor(chars.length / 16)));
  const tick = canvasTextGlitchTick();
  let changed = 0;
  for (let i = 0; i < chars.length && changed < maxChanges; i++) {
    const ch = chars[i];
    if (!CANVAS_TEXT_GLITCH_RE.test(ch)) continue;
    const h = canvasTextGlitchHash(text, i, x, y, tick);
    if ((h % 1000) >= canvasTextGlitchPerMille) continue;
    chars[i] = CANVAS_TEXT_GLITCH_CHARS[(h >>> 10) % CANVAS_TEXT_GLITCH_CHARS.length];
    changed++;
  }
  return changed > 0 ? chars.join('') : text;
}

export function installCanvasLocalization(): void {
  if (canvasLocalizationInstalled || typeof CanvasRenderingContext2D === 'undefined') return;
  canvasLocalizationInstalled = true;

  const proto = CanvasRenderingContext2D.prototype;
  const fillText = proto.fillText;
  const strokeText = proto.strokeText;
  const measureText = proto.measureText;

  proto.fillText = function localizedFillText(
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ): void {
    const localized = localizedCanvasText(text);
    const visible = canvasTextGlitch(localized, x, y);
    if (maxWidth === undefined) fillText.call(this, visible, x, y);
    else fillText.call(this, visible, x, y, maxWidth);
  };

  proto.strokeText = function localizedStrokeText(
    text: string,
    x: number,
    y: number,
    maxWidth?: number,
  ): void {
    const localized = localizedCanvasText(text);
    const visible = canvasTextGlitch(localized, x, y);
    if (maxWidth === undefined) strokeText.call(this, visible, x, y);
    else strokeText.call(this, visible, x, y, maxWidth);
  };

  proto.measureText = function localizedMeasureText(text: string): TextMetrics {
    return measureText.call(this, localizedCanvasText(text));
  };
}
