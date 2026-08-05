import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateProtokolnikSprite, generateSprite } from '../src/entities/protokolnik';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setEntityMap } from '../src/systems/ai/monster';
import {
  PROTOKOLNIK_PRESSURE_MAX,
  PROTOKOLNIK_PRESSURE_SAFE_CAP,
  protokolnikDocumentPressure,
  protokolnikPressureCap,
  updateProtokolnikProtocolPressure,
} from '../src/systems/ai/monster';
import { setListenerPos } from '../src/systems/audio';
import { makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function player(x: number, y: number, documents = true): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    name: 'Вы',
    inventory: documents
      ? [{ defId: 'official_permit_slip', count: 2 }, { defId: 'blank_form', count: 4 }]
      : [],
  };
}

function protokolnik(x: number, y: number): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.PROTOKOLNIK,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function syncEntities(entities: Entity[]): void {
  setEntityMap(new Map(entities.map(e => [e.id, e])));
}

test('protokolnik is a standalone ministry monster with normal rumor reachability', () => {
  assert.equal(DEF.kind, MonsterKind.PROTOKOLNIK);
  assert.equal(DEF.name, 'Протокольник');
  assert.deepEqual(DEF.aiFlags, ['protocolPressure']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY]);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY].includes(MonsterKind.PROTOKOLNIK), true);

  const ecology = getMonsterEcology(MonsterKind.PROTOKOLNIK);
  assert.ok(ecology);
  assert.equal(ecology?.rare, true);
  assert.deepEqual(ecology?.floors, [FloorLevel.MINISTRY]);
  assert.equal(ecology?.rooms.includes(RoomType.STORAGE), true, 'archive/storage POIs should fit the monster');
  assert.equal(ecology?.rumorIds.includes('ecology_protokolnik_protocol'), true);
  assert.equal(RUMORS.some(rumor => rumor.id === 'ecology_protokolnik_protocol'), true);

  const legacyVariantId = ['court', 'nightmare'].join('_');
  assert.equal(RUMORS.some(rumor => rumor.id === legacyVariantId), false);
  assert.equal(MONSTERS[MonsterKind.NIGHTMARE].name, 'Кошмарище');
});

test('protokolnik sprite reads as paper robe, red stamps, and blank stamp face', () => {
  const sprite = generateProtokolnikSprite(3535, 4);
  let opaque = 0;
  let darkInk = 0;
  let yellowPaper = 0;
  let redStamps = 0;

  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const b = (px >>> 16) & 255;
    const g = (px >>> 8) & 255;
    const r = px & 255;
    if (r < 48 && g < 48 && b < 56) darkInk++;
    if (r > 155 && g > 125 && b < 170) yellowPaper++;
    if (r > 120 && g < 75 && b < 90) redStamps++;
  }

  assert.equal(opaque > 620, true);
  assert.equal(darkInk > 90, true);
  assert.equal(yellowPaper > 180, true);
  assert.equal(redStamps > 25, true);
});

test('generateSprite calls generateProtokolnikSprite with default parameters', () => {
  const defaultSprite = generateSprite();
  const explicitSprite = generateProtokolnikSprite();
  assert.deepEqual(defaultSprite, explicitSprite);
});

test('visual intensity of sprite scales with pressure tier', () => {
  const lowPressure = generateProtokolnikSprite(1234, 0);
  const highPressure = generateProtokolnikSprite(1234, 4);

  let lowOpaque = 0;
  for (const px of lowPressure) {
    if ((px >>> 24) !== 0) lowOpaque++;
  }

  let highOpaque = 0;
  for (const px of highPressure) {
    if ((px >>> 24) !== 0) highOpaque++;
  }

  assert.equal(highOpaque > lowOpaque, true, 'High pressure should have more opaque pixels due to more flying pages');
});

test('protocol pressure grows from carried documents, caps, and eases after papers are dropped', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(22.5, 10.5, true);
  const threat = protokolnik(10.5, 10.5);
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  syncEntities([target, threat]);

  const documentPressure = protokolnikDocumentPressure(target);
  assert.equal(documentPressure > 0, true);
  assert.equal(protokolnikPressureCap(documentPressure) <= PROTOKOLNIK_PRESSURE_MAX, true);

  updateProtokolnikProtocolPressure(world, threat, target, 8, 8, msgs, target.id, state);
  const loadedPressure = threat.ai?.protocolPressure ?? 0;
  assert.equal(loadedPressure > PROTOKOLNIK_PRESSURE_SAFE_CAP, true);
  assert.equal(loadedPressure <= protokolnikPressureCap(documentPressure), true);
  assert.equal((threat.protocolPressureTier ?? 0) >= 2, true);
  assert.equal((target.hp ?? 100) < 100, true, 'pressure should pulse without instant death');

  target.inventory = [];
  updateProtokolnikProtocolPressure(world, threat, target, 4, 12, msgs, target.id, state);
  assert.equal((threat.ai?.protocolPressure ?? 0) <= PROTOKOLNIK_PRESSURE_SAFE_CAP + 0.1, true);
  assert.equal((threat.ai?.protocolPressure ?? 0) <= loadedPressure, true);
});

test('breaking protocol line publishes a protokolnik escape event', () => {
  const world = openWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const target = player(20.5, 10.5, true);
  const threat = protokolnik(10.5, 10.5);
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, worldEvents: createWorldEventState() });
  syncEntities([target, threat]);

  updateProtokolnikProtocolPressure(world, threat, target, 5, 5, msgs, target.id, state);
  assert.equal((threat.ai?.protocolPressure ?? 0) >= 18, true);

  updateProtokolnikProtocolPressure(world, threat, null, 1, 6, msgs, target.id, state);
  const escaped = getRecentEvents(state, { type: 'monster_escaped', limit: 1 })[0];
  assert.equal(escaped?.monsterKind, MonsterKind.PROTOKOLNIK);
  assert.equal(escaped?.tags.includes('protocol_pressure'), true);
});
