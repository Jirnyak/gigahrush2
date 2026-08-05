/* -- Universal Markov NPC speech router ------------------------- */

import type { MarkovTextContext } from './markov_context';
import { hashSeed } from '../core/rand';
import {
  generateMarkovText as generateCoreMarkovText,
  validateMarkovTextData as validateCoreMarkovTextData,
} from './markov_text';

export type {
  MarkovDangerBand,
  MarkovNeedBand,
  MarkovRelationBand,
  MarkovRouteZBand,
  MarkovTextContext,
  MarkovTimeBand,
  MarkovWealthBand,
} from './markov_context';

export type MarkovIntent =
  | 'talk_ambient'
  | 'talk_context'
  | 'log_speech'
  | 'bark_ambient'
  | 'procedural_quest'
  | 'rumor_flavor'
  | 'demos_post'
  | 'demos_reaction'
  | 'locked_author_text';

export type MarkovSource = 'generated_markov' | 'curated_pool' | 'locked_author_text';

export interface SpeechRouterRequest {
  intent: MarkovIntent;
  source?: MarkovSource;
  context: MarkovTextContext;
  lockedText?: string;
  exactFallback?: string;
  repeatIndex?: number;
  maxChars?: number;
  seed?: number | string;
}

export interface SpeechRouterResult {
  text: string;
  source: MarkovSource;
  intent: MarkovIntent;
  templateId?: string;
  domainId?: string;
  tags: readonly string[];
  fallbackUsed: boolean;
}

export type SpeechGenerator = (request: SpeechRouterRequest) => SpeechRouterResult | undefined;

const DEFAULT_INTENT_CAPS: Record<MarkovIntent, number> = {
  talk_ambient: 120,
  talk_context: 140,
  log_speech: 120,
  bark_ambient: 96,
  procedural_quest: 180,
  rumor_flavor: 140,
  demos_post: 220,
  demos_reaction: 120,
  locked_author_text: 4096,
};

const CURATED_FALLBACKS: Record<MarkovIntent, string> = {
  talk_ambient: 'Потом скажу. Сейчас не до разговоров.',
  talk_context: 'Сначала осмотрись, потом спрашивай.',
  log_speech: 'Слышали разговор, но слов не разобрали.',
  bark_ambient: 'Не стой на проходе.',
  procedural_quest: 'Работа есть, но детали скажу у места.',
  rumor_flavor: 'Слух есть, подробности лучше проверить самому.',
  demos_post: 'Короткая запись без лишних подробностей.',
  demos_reaction: 'Принято к сведению.',
  locked_author_text: '',
};

const GENERATED_BLOCKED_TAGS = new Set([
  'blocked.markov',
  'markov.blocked',
  'markov.no_generate',
  'locked_author_text',
  'source.locked_author_text',
]);

let speechGenerator: SpeechGenerator | undefined;

export function setSpeechRouterGenerator(generator: SpeechGenerator | undefined): void {
  speechGenerator = generator;
}

export function routeSpeech(request: SpeechRouterRequest): SpeechRouterResult {
  if (request.source === 'locked_author_text' || request.intent === 'locked_author_text') {
    return lockedTextResult(request);
  }

  if (hasText(request.exactFallback)) return fallbackResult(request, 'curated_pool');

  if (request.source === 'curated_pool') return curatedPoolResult(request);

  return generateMarkovText(request);
}

export function generateMarkovText(request: SpeechRouterRequest): SpeechRouterResult {
  if (!generatedAllowed(request.context)) return curatedPoolResult(request);

  let generated: SpeechRouterResult | undefined;
  if (speechGenerator) {
    try {
      generated = speechGenerator(request);
    } catch {
      return curatedPoolResult(request);
    }
  } else {
    generated = generateCoreMarkovText({
      intent: request.intent,
      source: 'generated_markov',
      context: request.context,
      exactFallback: request.exactFallback,
      repeatIndex: request.repeatIndex,
      maxChars: request.maxChars,
      seed: normalizeSeed(request.seed),
    });
  }

  if (generated && generated.source === 'generated_markov' && hasText(generated.text) && !generated.fallbackUsed) {
    return {
      ...generated,
      text: capText(generated.text, maxCharsForRequest(request)),
      tags: normalizeResultTags(request, generated.tags),
      fallbackUsed: false,
    };
  }

  return curatedPoolResult(request);
}

export function validateMarkovTextData(): readonly string[] {
  return validateCoreMarkovTextData();
}

function lockedTextResult(request: SpeechRouterRequest): SpeechRouterResult {
  const text = request.lockedText ?? request.exactFallback ?? '';
  return {
    text,
    source: 'locked_author_text',
    intent: request.intent,
    tags: normalizeResultTags(request),
    fallbackUsed: false,
  };
}

function fallbackResult(request: SpeechRouterRequest, source: MarkovSource): SpeechRouterResult {
  const text = request.exactFallback ?? CURATED_FALLBACKS[request.intent] ?? CURATED_FALLBACKS.talk_context;
  return {
    text: capText(text, maxCharsForRequest(request)),
    source,
    intent: request.intent,
    tags: normalizeResultTags(request),
    fallbackUsed: true,
  };
}

function curatedPoolResult(request: SpeechRouterRequest): SpeechRouterResult {
  const curated = generateCoreMarkovText({
    intent: request.intent,
    source: 'curated_pool',
    context: request.context,
    repeatIndex: request.repeatIndex,
    maxChars: request.maxChars,
    seed: normalizeSeed(request.seed),
  });
  if (hasText(curated.text)) {
    return {
      ...curated,
      text: capText(curated.text, maxCharsForRequest(request)),
      source: 'curated_pool',
      tags: normalizeResultTags(request, curated.tags),
    };
  }
  return fallbackResult(request, 'curated_pool');
}

function normalizeResultTags(request: SpeechRouterRequest, extra: readonly string[] = []): readonly string[] {
  const out: string[] = [];
  for (const tag of [...request.context.tags, ...extra]) {
    if (tag.length > 0 && !out.includes(tag)) out.push(tag);
  }
  return out.sort();
}

function generatedAllowed(context: MarkovTextContext): boolean {
  return !context.tags.some(tag => GENERATED_BLOCKED_TAGS.has(tag));
}

function maxCharsForRequest(request: SpeechRouterRequest): number {
  const explicit = request.maxChars;
  if (explicit !== undefined && Number.isFinite(explicit)) return Math.max(8, Math.trunc(explicit));
  return DEFAULT_INTENT_CAPS[request.intent] ?? 120;
}

function capText(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  if (maxChars <= 3) return compact.slice(0, maxChars);
  return `${compact.slice(0, maxChars - 3).trimEnd()}...`;
}

function hasText(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim().length > 0;
}

function normalizeSeed(seed: number | string | undefined): number | undefined {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed;
  if (typeof seed === 'string') return hashSeed(seed);
  return undefined;
}
