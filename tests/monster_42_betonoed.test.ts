import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, generateSprite } from '../src/entities/betonoed';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';

test('betonoed is a standalone weak-wall monster package', () => {
  assert.equal(DEF.kind, MonsterKind.BETONOED);
  assert.equal(DEF.name, 'Бетоноед');
  assert.equal(MONSTERS[MonsterKind.BETONOED], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.BETONOED], generateSprite);
  assert.deepEqual(DEF.floors, [FloorLevel.MAINTENANCE]);
  assert.equal(DEF.aiFlags?.includes('weakWallBreach'), true);
  assert.equal(DEF.aiFlags?.includes('wallBias'), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE].includes(MonsterKind.BETONOED), true);

  assert.notEqual(DEF.hp, MONSTERS[MonsterKind.BETONNIK].hp);
  assert.equal(DEF.speed > MONSTERS[MonsterKind.BETONNIK].speed, true);
  assert.match(DEF.counterplay ?? '', /герметик|блок-комплект|шум|огонь/);
});

test('betonoed ecology stays rare and has no old variant id', () => {
  const ecology = getMonsterEcology(MonsterKind.BETONOED);
  assert.ok(ecology);
  assert.equal(ecology.spawnWeight > 0 && ecology.spawnWeight < 0.2, true);
  assert.equal(ecology.rare, true);
  assert.equal(ecology.rumorIds.includes('monster_betonoed_weak_wall'), true);
  assert.equal(ecology.rumorIds.includes('ecology_betonoed_shortcut'), true);
});

test('betonoed shortcut spawns direct monster kind without variant plumbing', () => {
  const source = readFileSync('src/gen/maintenance/betonoed_shortcut.ts', 'utf8');
  const legacyVariantField = ['monster', 'Variant', 'Id'].join('');
  const legacyApplyVariant = ['apply', 'Monster', 'Variant'].join('');
  const legacyForceVariant = ['force', 'Betonoed', 'Variant'].join('');
  assert.match(source, /monsterKind:\s*MonsterKind\.BETONOED/);
  assert.match(source, /system:\s*'betonoed_shortcut'/);
  assert.equal(source.includes(legacyVariantField), false);
  assert.equal(source.includes(legacyApplyVariant), false);
  assert.equal(source.includes(legacyForceVariant), false);
  assert.equal(source.includes('noise_can'), true);
});
