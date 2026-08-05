import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookupHints } from '../src/data/lookup_hints.js';
import {
  compileNpcPackageForEditor,
  sanitizeNpcPackage,
  validateNpcPackage,
} from '../src/form/schema.js';

function validDraft(overrides = {}) {
  return {
    version: 1,
    id: 'ivan_slesar',
    kind: 'procedural',
    identity: { displayName: 'Иван Слесарь' },
    bio: {
      publicLine: 'Чинит мокрый щиток у лифта и ругается на чужие ведра.',
      origin: 'Жилая зона',
      work: 'дежурит у щитка',
    },
    demographics: { sex: 'male', age: 44 },
    affiliation: { faction: 'citizen', occupation: 'locksmith' },
    rpg: { level: 3, str: 7, agi: 4, int: 6, perks: [{ id: 'tool_hands', rank: 1 }] },
    wealth: { cashRubles: 120, accountRubles: 400, debtRubles: 20 },
    loadout: { weapon: 'wrench', tool: 'radio', inventory: [{ defId: 'bread', count: 2 }] },
    social: {
      playerRelation: 12,
      karma: 8,
      links: [{ targetNpcId: 'olga', relation: 64, role: 'friend', flags: ['friend', 'work'] }],
    },
    visual: { npcVisualId: 'floor_69_female', spriteSeed: 123 },
    placement: { homeFloorKey: 'story:living', presence: 'population', mobility: 'fixed_home' },
    speech: {
      talkLines: ['Щиток не трогай. Он мокрый, но пока честный.'],
      demosPostHints: ['У лифта опять ведро. Кто поставил, тот и выносит.'],
    },
    tags: ['community'],
    ...overrides,
  };
}

test('valid minimal NPC package sanitizes and validates', () => {
  const result = validateNpcPackage(validDraft(), lookupHints);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.package.version, 1);
  assert.equal(result.package.id, 'ivan_slesar');
  assert.equal(result.package.identity.displayName, 'Иван Слесарь');
  assert.equal(Object.hasOwn(result.package.identity, 'firstName'), false);
  assert.equal(Object.hasOwn(result.package.identity, 'lastName'), false);
  assert.equal(Object.hasOwn(result.package.identity, 'patronymic'), false);
  assert.equal(result.package.affiliation.faction, 0);
  assert.equal(result.package.affiliation.occupation, 1);
  assert.equal(result.package.visual.npcVisualId, 'floor_69_female');
  assert.equal(result.package.visual.spriteSeed, 123);
});

test('legacy FIO drafts are accepted only as displayName fallback', () => {
  const pack = sanitizeNpcPackage(validDraft({
    identity: {
      firstName: 'Анна',
      patronymic: 'Петровна',
      lastName: 'Ключница',
    },
  }), lookupHints);

  assert.equal(pack.identity.displayName, 'Анна Петровна Ключница');
  assert.equal(Object.hasOwn(pack.identity, 'firstName'), false);
  assert.equal(Object.hasOwn(pack.identity, 'lastName'), false);
  assert.equal(Object.hasOwn(pack.identity, 'patronymic'), false);
});

test('lookup hints expose route-key floor choices and source-linked package templates', () => {
  assert.deepEqual(lookupHints.floorKeys, lookupHints.floorOptions.map(option => option.id));
  const firstProcedural = lookupHints.floorOptions.findIndex(option => option.group === 'procedural');
  assert.ok(firstProcedural > 0);
  assert.equal(lookupHints.floorOptions.slice(0, firstProcedural).every(option => option.group === 'route'), true);
  assert.equal(lookupHints.floorOptions.slice(firstProcedural).every(option => option.group === 'procedural'), true);
  for (let index = 1; index < lookupHints.floorOptions.length; index++) {
    const prev = lookupHints.floorOptions[index - 1];
    const current = lookupHints.floorOptions[index];
    if (prev.group === current.group) assert.ok(prev.z >= current.z, `${prev.id} should not sort below ${current.id}`);
  }

  const packages = lookupHints.npcPackageSummaries;
  assert.ok(packages.length > 0);
  assert.equal(packages.every(pack => ['plot', 'design', 'procedural'].includes(pack.kind)), true);
  assert.equal(packages.every(pack => pack.sourceFile && !pack.sourceFile.includes('runtime package registry')), true);
  assert.equal(packages.every(pack => Number.isInteger(pack.sourceLine) && pack.sourceLine > 0), true);
});

test('full package keeps editor proposal and lookup document shape', () => {
  const pack = sanitizeNpcPackage(validDraft({
    editor: {
      publicCredit: 'tester',
      intake: { contentProposal: { type: 'quest_seed', text: 'Попросит донести сухой фильтр в медпункт.' } },
    },
  }), lookupHints);
  const doc = compileNpcPackageForEditor(pack, lookupHints);
  assert.equal(doc.schema, 'gigahrush.npc-package');
  assert.equal(doc.validation.errors.length, 0);
  assert.ok(doc.lookupHints.itemIds.includes('bread'));
  assert.ok(doc.lookupHints.floorKeys.includes('story:living'));
  assert.equal(doc.package.editor.source, 'community');
  assert.match(doc.package.editor.notes, /quest_seed/);
});

test('invalid item, perk and floor ids are rejected', () => {
  const result = validateNpcPackage(validDraft({
    loadout: { weapon: 'not_a_weapon', inventory: [{ defId: 'missing_item', count: 1 }] },
    rpg: { perks: [{ id: 'missing_perk' }] },
    placement: { homeFloorKey: 'floor_that_is_not_real', presence: 'population' },
  }), lookupHints);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /unknown weapon item id/);
  assert.match(result.errors.join('\n'), /unknown inventory item id/);
  assert.match(result.errors.join('\n'), /unknown perk id/);
  assert.match(result.errors.join('\n'), /unknown homeFloorKey/);
});

test('social links are capped to nine NPC links and relation values clamp', () => {
  const links = Array.from({ length: 10 }, (_, index) => ({
    targetNpcId: `npc_${index}`,
    relation: 999,
    role: 'friend',
  }));
  const result = validateNpcPackage(validDraft({
    social: { playerRelation: 500, karma: -500, links },
  }), lookupHints);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /social\.links exceeds 9/);
  assert.equal(result.package.social.playerRelation, 100);
  assert.equal(result.package.social.karma, -127);
  assert.equal(result.package.social.links[0].relation, 127);
  assert.equal(result.package.social.links[0].role, 1);
  assert.equal(result.package.social.links.length, 9);
});

test('function values, remote URLs and implementation geometry leaks are rejected', () => {
  const result = validateNpcPackage(validDraft({
    callback: () => {},
    bio: { publicLine: 'Живет в 1024x1024 toroidal map: https://example.com' },
  }), lookupHints);
  assert.equal(result.valid, false);
  const joined = result.errors.join('\n');
  assert.match(joined, /function value/);
  assert.match(joined, /remote URL/);
  assert.match(joined, /implementation geometry leak/);
});
