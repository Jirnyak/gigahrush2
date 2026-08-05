import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, MonsterKind } from '../src/core/types';
import { DEF as IDOL_DEF } from '../src/entities/idol';
import { MONSTERS } from '../src/entities/monster';

test('idol stays an immobile ranged psi monolith with geometry counterplay', () => {
  assert.equal(MONSTERS[MonsterKind.IDOL], IDOL_DEF);
  assert.equal(IDOL_DEF.speed, 0);
  assert.equal(IDOL_DEF.isRanged, true);
  assert.equal(IDOL_DEF.projSpeed, 12);
  assert.deepEqual(IDOL_DEF.floors, [FloorLevel.MINISTRY, FloorLevel.LIVING, FloorLevel.HELL, FloorLevel.VOID]);
  assert.match(IDOL_DEF.counterplay ?? '', /не двигается/);
  assert.match(IDOL_DEF.counterplay ?? '', /сбейте угол/);
  assert.match(IDOL_DEF.counterplay ?? '', /в упор/);
  assert.match(IDOL_DEF.lootHint ?? '', /ПСИ-пыль/);
});
