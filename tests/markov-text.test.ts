import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  MARKOV_DOMAINS,
  MARKOV_TEMPLATES,
  MARKOV_TERMINAL_CLASSES,
  MARKOV_TEXT_DEFINITIONS,
  type MarkovDomain,
  type MarkovTextDefinitions,
} from '../src/data/markov_text';
import {
  MARKOV_MAX_OUTPUT_CHARS_BARK,
  MARKOV_MAX_OUTPUT_CHARS_TALK,
  generateMarkovText,
  validateMarkovTextData,
  type SpeechRouterRequest,
} from '../src/systems/markov_text';

const NEED_REQUEST: SpeechRouterRequest = {
  intent: 'talk_context',
  seed: 12_345,
  repeatIndex: 0,
  context: {
    actorId: 7,
    floorKey: 'story:living',
    needBand: 'urgent',
    tags: ['need', 'water'],
    requiredAnchors: ['need'],
  },
};

test('same seed context and request yield the same generated output', () => {
  const first = generateMarkovText(NEED_REQUEST);
  const second = generateMarkovText(NEED_REQUEST);
  assert.equal(first.text, second.text);
  assert.equal(first.source, 'generated_markov');
  assert.equal(first.fallbackUsed, false);
});

test('different repeat index can vary output when corpus supports it', () => {
  const outputs = new Set<string>();
  for (let repeatIndex = 0; repeatIndex < 12; repeatIndex++) {
    outputs.add(generateMarkovText({ ...NEED_REQUEST, repeatIndex }).text);
  }
  assert.ok(outputs.size > 1, [...outputs].join(' | '));
});

test('invalid duplicate ids fail data validation', () => {
  const bad: MarkovTextDefinitions = {
    ...MARKOV_TEXT_DEFINITIONS,
    domains: [...MARKOV_DOMAINS, MARKOV_DOMAINS[0] as MarkovDomain],
  };
  assert.ok(validateMarkovTextData(bad).some(issue => issue.includes('duplicate domain id')));
});

test('every domain and template has fallback text', () => {
  for (const domain of MARKOV_DOMAINS) assert.ok(domain.fallback.trim(), domain.id);
  for (const template of MARKOV_TEMPLATES) assert.ok(template.fallback.trim(), template.id);
  assert.deepEqual(validateMarkovTextData(), []);
});

test('every atom has a class', () => {
  for (const domain of MARKOV_DOMAINS) {
    for (const atom of domain.atoms ?? []) assert.ok(atom.class, atom.id);
  }
});

test('class paths reach terminal state', () => {
  const terminal = new Set(MARKOV_TERMINAL_CLASSES);
  for (const template of MARKOV_TEMPLATES) {
    for (const part of template.parts) {
      if (part.kind !== 'slot') continue;
      for (const path of part.allowedClassPaths) {
        assert.ok(terminal.has(path[path.length - 1]), `${template.id}: ${path.join(' -> ')}`);
      }
    }
  }
});

test('output respects character caps', () => {
  const talk = generateMarkovText({ ...NEED_REQUEST, maxChars: MARKOV_MAX_OUTPUT_CHARS_TALK });
  assert.ok(talk.text.length <= MARKOV_MAX_OUTPUT_CHARS_TALK);

  const bark = generateMarkovText({
    intent: 'bark_ambient',
    seed: 88,
    repeatIndex: 1,
    maxChars: MARKOV_MAX_OUTPUT_CHARS_BARK,
    context: {
      actorId: 8,
      dangerBand: 'panic',
      tags: ['danger', 'samosbor'],
      requiredAnchors: ['event'],
    },
  });
  assert.ok(bark.text.length <= MARKOV_MAX_OUTPUT_CHARS_BARK);
});

test('generated text has at least one grounded anchor when required', () => {
  const result = generateMarkovText(NEED_REQUEST);
  assert.equal(result.fallbackUsed, false);
  assert.ok(result.tags.includes('need'), result.tags.join(','));
});

test('generated output has no unresolved slot', () => {
  const result = generateMarkovText(NEED_REQUEST);
  assert.doesNotMatch(result.text, /\{[^}]+}/);
});

test('generated output avoids adjacent repeated atoms and repeated bigram loops', () => {
  for (const domain of MARKOV_DOMAINS) {
    const request: SpeechRouterRequest = {
      intent: domain.allowedIntents[0],
      seed: 77,
      repeatIndex: 2,
      context: { actorId: 22, tags: domain.tags },
    };
    const result = generateMarkovText(request);
    assertNoRepeatLoops(result.text);
  }
});

test('tone and internal blacklist catches forbidden words', () => {
  const bad: MarkovTextDefinitions = {
    ...MARKOV_TEXT_DEFINITIONS,
    domains: [{
      ...MARKOV_DOMAINS[0],
      id: 'bad_domain',
      fallback: 'debug строка',
    }],
  };
  assert.ok(validateMarkovTextData(bad).some(issue => issue.includes('forbidden word')));
});

test('core generation path does not use ambient random source', () => {
  const source = readFileSync('src/systems/markov_text.ts', 'utf8');
  assert.equal(source.includes('Math.random'), false);
});

function assertNoRepeatLoops(text: string): void {
  const tokens = text
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 1; i < tokens.length; i++) assert.notEqual(tokens[i], tokens[i - 1], text);
  const bigrams = new Map<string, number>();
  for (let i = 1; i < tokens.length; i++) {
    const key = `${tokens[i - 1]}\u0001${tokens[i]}`;
    const count = (bigrams.get(key) ?? 0) + 1;
    assert.ok(count <= 2, text);
    bigrams.set(key, count);
  }
}
