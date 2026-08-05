import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, MonsterKind, ProjType, type Entity } from '../src/core/types';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { DEF, PAUPSINA_WEB_COOLDOWN_SEC, generateSprite } from '../src/entities/paupsina';
import { MONSTERS, MONSTER_SPRITES, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import {
  PAUPSINA_WEB_DURATION_SEC,
  activePaupsinaWeb,
  applyPaupsinaWeb,
  isPaupsinaWebCuttingWeapon,
  normalizePlayerStatuses,
  paupsinaWebMoveMult,
  reducePaupsinaWeb,
} from '../src/systems/status';

function player(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 10.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
  };
}

function opaquePixels(sprite: Uint32Array): number {
  let count = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) count++;
  return count;
}

test('paupsina is registered as a distinct web-spitting monster', () => {
  assert.equal(DEF.kind, MonsterKind.PAUPSINA);
  assert.equal(MONSTERS[MonsterKind.PAUPSINA], DEF);
  assert.equal(MONSTER_SPRITES[MonsterKind.PAUPSINA], generateSprite);
  assert.equal(DEF.projType, ProjType.WEB);
  assert.equal(DEF.attackRate, PAUPSINA_WEB_COOLDOWN_SEC);
  assert.deepEqual(DEF.aiFlags, ['webSpitter']);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE].includes(MonsterKind.PAUPSINA), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.KVARTIRY].includes(MonsterKind.PAUPSINA), true);

  const ecology = getMonsterEcology(MonsterKind.PAUPSINA);
  assert.ok(ecology);
  assert.match(ecology.counterplay, /нож|огонь|двер|шкаф/);

  const sprite = generateSprite();
  assert.equal(sprite.length, S * S);
  assert.equal(opaquePixels(sprite) > 450, true);
});

test('paupsina web duration is capped and escapable by cutting or fire', () => {
  const e = player();
  const first = applyPaupsinaWeb(e, 10);
  assert.equal(first.expiresAt, 10 + PAUPSINA_WEB_DURATION_SEC);
  assert.equal(paupsinaWebMoveMult(e, 10.1) > 0.15, true, 'web should root-like slow without full stun lock');

  const refreshed = applyPaupsinaWeb(e, 11);
  assert.equal(refreshed.expiresAt <= 11 + PAUPSINA_WEB_DURATION_SEC, true, 'repeat web hits must not stack beyond the duration cap');
  assert.equal(activePaupsinaWeb(e, 11.2), refreshed);
  assert.equal(isPaupsinaWebCuttingWeapon('knife'), true);

  const beforeCut = refreshed.expiresAt;
  assert.equal(reducePaupsinaWeb(e, 11.2, undefined, undefined, e, 'cut'), true);
  const afterCut = activePaupsinaWeb(e, 11.2);
  assert.ok(afterCut);
  assert.equal(afterCut.expiresAt < beforeCut, true);

  assert.equal(reducePaupsinaWeb(e, 11.3, undefined, undefined, e, 'fire'), true);
  assert.equal(activePaupsinaWeb(e, 11.5), undefined);
});

test('saved paupsina web statuses normalize with the same max duration cap', () => {
  const statuses = normalizePlayerStatuses([{
    id: 'paupsina_web',
    source: 'paupsina_web',
    startedAt: 20,
    expiresAt: 200,
  }]);
  assert.equal(statuses?.length, 1);
  assert.equal(statuses?.[0]?.expiresAt, 20 + PAUPSINA_WEB_DURATION_SEC);
});

test('saved player statuses restore only the newest bounded entries', () => {
  const statuses = normalizePlayerStatuses(Array.from({ length: 20 }, (_, i) => ({
    id: 'paupsina_web',
    source: 'paupsina_web',
    startedAt: i,
    expiresAt: i + 2,
  })));

  assert.equal(statuses?.length, 12);
  assert.deepEqual(statuses?.map(status => status.startedAt), Array.from({ length: 12 }, (_, i) => i + 8));
});
