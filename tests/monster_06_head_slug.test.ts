import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, DoorState, EntityType, Faction, Feature, FloorLevel, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { DEF, HEAD_SLUG_DETACHED_STAGE, HEAD_SLUG_HOSTED_STAGE, generateSlugSprite, generateSprite } from '../src/entities/head_slug';
import { MONSTERS } from '../src/entities/monster';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { getRecentEvents, createWorldEventState } from '../src/systems/events';
import { HEAD_SLUG_REHOST_SCAN_CAP, findHeadSlugRehostTarget, updateMonster, setEntityMap } from '../src/systems/ai/monster';
import { getEntityIndex, rebuildEntityIndex } from '../src/systems/entity_index';
import { setListenerPos } from '../src/systems/audio';
import { S } from '../src/render/pixutil';
import { makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

function openMedicalWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.roomMap.fill(0);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 12,
    cy: 12,
    faction: 0,
    hasLift: false,
    fogged: false,
    level: 1,
    hqRoomId: -1,
  };
  world.rooms[0] = {
    id: 0,
    type: RoomType.MEDICAL,
    x: 6,
    y: 6,
    w: 12,
    h: 12,
    doors: [],
    sealed: false,
    name: 'Тестовая карантинная',
    apartmentId: -1,
    wallTex: 0,
    floorTex: 0,
  };
  const doorIdx = world.idx(10, 6);
  world.cells[doorIdx] = Cell.DOOR;
  world.features[doorIdx] = Feature.NONE;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_CLOSED, roomA: 0, roomB: -1, keyId: '', timer: 0 });
  return world;
}

function headSlug(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 2,
    type: EntityType.MONSTER,
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: DEF.speed,
    sprite: DEF.sprite,
    hp: DEF.hp,
    maxHp: DEF.hp,
    monsterKind: MonsterKind.HEAD_SLUG,
    monsterStage: HEAD_SLUG_HOSTED_STAGE,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: 10, ty: 10, path: [], pi: 0, stuck: 0, timer: 0 },
    ...overrides,
  };
}

test('head slug is a standalone registered parasite with hosted and detached silhouettes', () => {
  const ecology = getMonsterEcology(MonsterKind.HEAD_SLUG);
  const hosted = generateSprite();
  const detached = generateSlugSprite();
  let hostedLowerBody = 0;
  let detachedLowerBody = 0;
  let detachedEyes = 0;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const h = hosted[y * S + x] >>> 24;
      const d = detached[y * S + x] >>> 24;
      if (h && y > 38) hostedLowerBody++;
      if (d && y > 38) detachedLowerBody++;
      if (d && y >= 23 && y <= 27 && x >= 23 && x <= 43) detachedEyes++;
    }
  }

  assert.equal(DEF.kind, MonsterKind.HEAD_SLUG);
  assert.equal(MONSTERS[MonsterKind.HEAD_SLUG], DEF);
  assert.deepEqual(DEF.aiFlags, ['hostParasite']);
  assert.equal(ecology?.rare, true);
  assert.equal(ecology?.rooms.includes(RoomType.MEDICAL), true);
  assert.equal(ecology?.rumorIds.includes('ecology_head_slug_rehost'), true);
  assert.equal(hostedLowerBody > 120, true, 'hosted sprite should include a readable host body');
  assert.equal(detachedLowerBody < hostedLowerBody * 0.35, true, 'detached sprite should be mostly head mass and tendrils');
  assert.equal(detachedEyes > 0, true, 'detached sprite should show pale eye spots');
});

test('head slug detaches from a failing host and publishes a bounded warning event', () => {
  const world = openMedicalWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const player = makeTestPlayer({ id: 1, x: 14, y: 10, hp: 100, maxHp: 100 });
  const slug = headSlug({ hp: 18 });
  const entities = [player, slug];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  updateMonster(world, entities, slug, 0.2, 1, msgs, player.id, { v: 20 }, state);

  assert.equal(slug.monsterStage, HEAD_SLUG_DETACHED_STAGE);
  assert.equal(slug.spriteScale, 0.58);
  assert.equal((slug.ai?.parasiteRehostCd ?? -1) <= 0, true);
  assert.equal(msgs.some(m => m.text.includes('переползания')), true);
  const event = getRecentEvents(state, { type: 'head_slug_detached', tags: ['head_slug'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.monsterKind, MonsterKind.HEAD_SLUG);
  assert.equal(event.data?.scanCap, HEAD_SLUG_REHOST_SCAN_CAP);
});

test('detached head slug rehosts a stunned npc through capped radius queries', () => {
  const world = openMedicalWorld();
  setListenerPos(512, 512, world.dist2.bind(world));
  const player = makeTestPlayer({ id: 1, x: 20, y: 20, hp: 100, maxHp: 100 });
  const slug = headSlug({
    monsterStage: HEAD_SLUG_DETACHED_STAGE,
    hp: 12,
    maxHp: 18,
    speed: 1.9,
    spriteScale: 0.58,
    ai: { goal: AIGoal.WANDER, tx: 10, ty: 10, path: [], pi: 0, stuck: 0, timer: 0, parasiteRehostCd: 0 },
  });
  const host = makeTestNpc({
    id: 3,
    name: 'Санитар-тест',
    x: 10.65,
    y: 10.15,
    speed: 0.9,
    hp: 30,
    maxHp: 60,
    faction: Faction.CITIZEN,
    ai: { goal: AIGoal.WANDER, tx: 10, ty: 10, path: [], pi: 0, stuck: 0, timer: 0, staggerTimer: 1.0 },
  });
  const farNpcs = Array.from({ length: 80 }, (_, i) => makeTestNpc({ id: 10 + i, x: 80 + i, y: 80, alive: true }));
  const entities = [player, slug, host, ...farNpcs];
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const msgs: Msg[] = [];

  rebuildEntityIndex(entities);
  setEntityMap(new Map(entities.map(e => [e.id, e])));
  assert.equal(findHeadSlugRehostTarget(world, entities, slug), host);
  updateMonster(world, entities, slug, 1.3, 2, msgs, player.id, { v: 200 }, state);

  assert.equal(slug.monsterStage, HEAD_SLUG_HOSTED_STAGE);
  assert.equal(host.alive, false);
  assert.equal(slug.name?.includes('Санитар-тест'), true);
  assert.equal((slug.parasiteHostSkill ?? 0) > 0.9, true);
  assert.equal(getEntityIndex().getDebugStats().queries.maxResultCount <= HEAD_SLUG_REHOST_SCAN_CAP, true);
  const event = getRecentEvents(state, { type: 'head_slug_rehosted', tags: ['head_slug', 'rehosted'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.targetId, host.id);
  assert.equal(event.data?.hostWasAlive, true);
});
