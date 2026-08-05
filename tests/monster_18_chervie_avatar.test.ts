import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Feature, FloorLevel, Faction, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { getMonsterEcology } from '../src/data/monster_ecology';
import { RUMORS } from '../src/data/rumors';
import { DEF, generateSprite } from '../src/entities/chervie_avatar';
import { MONSTERS, NEW_MONSTERS_BY_FLOOR } from '../src/entities/monster';
import { S } from '../src/render/pixutil';
import {
  CHERVIE_MIND_PULSE_CAP,
  CHERVIE_MIND_PULSE_COOLDOWN_SEC,
  updateChervieNetPossessor,
} from '../src/systems/ai/monster';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { CHERVIE_NET_SOURCE_RADIUS, chervieNetPowered, findChervieNetSource } from '../src/systems/monster_traits';
import { generateSiliconNetWellDesignFloor } from '../src/gen/design_floors/silicon_net_well';
import { addTestRoom, makeGameState } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.features.fill(Feature.NONE);
  addTestRoom(world, {
    id: 1,
    type: RoomType.PRODUCTION,
    name: 'Тестовый НЕТ-узел',
    x: 4,
    y: 4,
    w: 32,
    h: 16,
  });
  return world;
}

function chervie(x = 10.5, y = 10.5): Entity {
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
    monsterKind: MonsterKind.CHERVIE_AVATAR,
    attackCd: 0,
    currentMag: 1,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function player(x = 12.5, y = 10.5): Entity {
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
    faction: Faction.PLAYER,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 1, agi: 1, int: 1, psi: 10, maxPsi: 10 },
  };
}

function npc(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    hp: 40,
    maxHp: 40,
    name: `NPC ${id}`,
    faction: Faction.CITIZEN,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

test('Chervie avatar keeps the existing standalone monster package', () => {
  const sprite = generateSprite();
  let opaque = 0;
  let green = 0;
  let textWhite = 0;
  for (const px of sprite) {
    if ((px >>> 24) === 0) continue;
    opaque++;
    const r = px & 255;
    const g = (px >>> 8) & 255;
    const b = (px >>> 16) & 255;
    if (g > 140 && r < 120 && b < 150) green++;
    if (r > 210 && g > 220 && b > 200) textWhite++;
  }

  assert.equal(DEF.kind, MonsterKind.CHERVIE_AVATAR);
  assert.equal(DEF.name, 'Червие');
  assert.deepEqual(DEF.aiFlags, ['netPossessor']);
  assert.deepEqual(DEF.floors, [FloorLevel.MINISTRY, FloorLevel.MAINTENANCE, FloorLevel.VOID]);
  assert.equal(MONSTERS[MonsterKind.CHERVIE_AVATAR], DEF);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MINISTRY].includes(MonsterKind.CHERVIE_AVATAR), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.MAINTENANCE].includes(MonsterKind.CHERVIE_AVATAR), true);
  assert.equal(NEW_MONSTERS_BY_FLOOR[FloorLevel.VOID].includes(MonsterKind.CHERVIE_AVATAR), true);
  assert.deepEqual(getMonsterEcology(MonsterKind.CHERVIE_AVATAR)?.rumorIds, ['monster_chervie_avatar_screen', 'ecology_chervie_avatar_disconnect']);
  assert.equal(RUMORS.some(rumor => rumor.id === 'monster_chervie_avatar_screen'), true);
  assert.equal(sprite.length, S * S);
  assert.equal(opaque > 650, true, 'sprite should read as a many-headed cable avatar');
  assert.equal(green > 70, true, 'terminal glow should be visible');
  assert.equal(textWhite > 8, true, 'text teeth/glyphs should be visible');
});

test('Chervie power source is local, radius-bounded, and line-breakable', () => {
  const world = openWorld();
  const threat = chervie();

  world.features[world.idx(10 + CHERVIE_NET_SOURCE_RADIUS, 10)] = Feature.APPARATUS;
  const source = findChervieNetSource(world, threat);
  assert.equal(source?.feature, Feature.APPARATUS);
  assert.equal(chervieNetPowered(world, threat), true);

  world.features[world.idx(10 + CHERVIE_NET_SOURCE_RADIUS, 10)] = Feature.NONE;
  world.features[world.idx(10 + CHERVIE_NET_SOURCE_RADIUS + 1, 10)] = Feature.APPARATUS;
  assert.equal(findChervieNetSource(world, threat), undefined, 'source outside radius must not power the avatar');

  world.features[world.idx(15, 10)] = Feature.SCREEN;
  world.cells[world.idx(13, 10)] = Cell.WALL;
  assert.equal(findChervieNetSource(world, threat), undefined, 'wall line break must cut a visible screen source');
});

test('Chervie mind pulse is capped and cooldown-gated', () => {
  const world = openWorld();
  const threat = chervie();
  const target = player();
  world.features[world.idx(11, 10)] = Feature.APPARATUS;
  const entities = [
    target,
    threat,
    npc(3, 11.5, 11.5),
    npc(4, 12.5, 11.5),
    npc(5, 13.5, 11.5),
    npc(6, 14.5, 11.5),
    npc(7, 15.5, 11.5),
    npc(8, 16.5, 11.5),
  ];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  rebuildEntityIndex(entities);

  updateChervieNetPossessor(world, entities, threat, 1, 1, msgs, target.id, state);
  const affected = entities.filter(e => e.type === EntityType.NPC && (e.psiMadness ?? 0) > 0);
  assert.equal(threat.ai?.netPowered, true);
  assert.equal(affected.length, CHERVIE_MIND_PULSE_CAP);
  assert.equal(threat.ai?.netPulseCd, CHERVIE_MIND_PULSE_COOLDOWN_SEC);
  assert.equal(target.rpg?.psi, 9);
  assert.equal(getRecentEvents(state, { type: 'chervie_false_order', limit: 4 }).length, 1);

  updateChervieNetPossessor(world, entities, threat, 1, 2, msgs, target.id, state);
  assert.equal(getRecentEvents(state, { type: 'chervie_false_order', limit: 4 }).length, 1, 'cooldown must prevent a second pulse');
});

test('cutting the local server publishes a Chervie cut event', () => {
  const world = openWorld();
  const threat = chervie();
  const target = player(30.5, 10.5);
  const entities = [target, threat];
  const msgs: Msg[] = [];
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, worldEvents: createWorldEventState() });
  world.features[world.idx(11, 10)] = Feature.APPARATUS;
  rebuildEntityIndex(entities);

  updateChervieNetPossessor(world, entities, threat, 0.5, 1, msgs, target.id, state);
  assert.equal(threat.ai?.netPowered, true);
  world.features[world.idx(11, 10)] = Feature.NONE;
  updateChervieNetPossessor(world, entities, threat, 0.5, 2, msgs, target.id, state);

  assert.equal(threat.ai?.netPowered, false);
  const cut = getRecentEvents(state, { type: 'chervie_server_cut', limit: 1 })[0];
  assert.equal(cut?.monsterKind, MonsterKind.CHERVIE_AVATAR);
  assert.equal(cut?.tags.includes('counterplay'), true);
});

test('Silicon NET well has an authored reachable Chervie screen site', () => {
  const floor = generateSiliconNetWellDesignFloor();
  const avatar = floor.entities.find(e => e.monsterKind === MonsterKind.CHERVIE_AVATAR);
  assert.ok(avatar, 'silicon_net_well should spawn the authored Chervie avatar');
  assert.equal(chervieNetPowered(floor.world, avatar), true, 'authored avatar should start by screens/apparatus');
});
