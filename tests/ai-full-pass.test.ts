import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, FloorLevel, Faction, MonsterKind, Occupation, ZoneFaction, type Entity, type GameClock, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { PATH_BLOCKER_ROWS_PER_CELL, setPathBlockerRow } from '../src/core/path_blockers';
import { updateAI, getAiStats } from '../src/systems/ai';
import { rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { canActorOccupy } from '../src/systems/movement_collision';
import { initFactionRelations } from '../src/data/relations';
import { makeGameState } from './helpers';
import { isHostile } from '../src/systems/factions';
import {
  notifyActorDamaged,
  resetCombatStimulus,
} from '../src/systems/combat_stimulus';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { setCurrentPlayerEntity } from '../src/systems/player_actor';

function makeOpenWorld(): World {
  const world = new World();
  for (let y = 0; y < 360; y++) {
    for (let x = 0; x < 360; x++) world.set(x, y, Cell.FLOOR);
  }
  return world;
}

function aiState() {
  return { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 10 };
}

function player(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 10,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    faction: Faction.PLAYER,
  };
}

function npc(id: number, x: number, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    hp: 50,
    maxHp: 50,
    faction: Faction.CITIZEN,
    ai: aiState(),
    ...extra,
  };
}

function monster(id: number, x: number, kind: MonsterKind): Entity {
  return {
    id,
    type: EntityType.MONSTER,
    x,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    monsterKind: kind,
    attackCd: 1,
    ai: aiState(),
  };
}

function projectile(id: number, ownerId: number): Entity {
  return {
    id,
    type: EntityType.PROJECTILE,
    x: 12,
    y: 10,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    ownerId,
    projLife: 1,
  };
}

function blockCellFully(world: World, x: number, y: number): void {
  const cell = world.idx(x, y);
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) setPathBlockerRow(world, cell, row, 0x0f);
}

function tick(world: World, entities: Entity[], dt: number, time: number, clock: GameClock, msgs: Msg[] = []): void {
  rebuildEntityIndexForSimulation(entities, Math.floor(time * 1000));
  updateAI(world, entities, dt, time, msgs, 1, clock, false, { v: 1000 }, FloorLevel.LIVING, makeGameState({ time, clock }));
}

test('active AI updates every non-player actor in one isotropic pass', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  const shooter = npc(5, 300);
  const entities = [
    p,
    npc(2, 20),
    npc(3, 90),
    npc(4, 300),
    npc(6, 310, { plotNpcId: 'test_plot_target' }),
    monster(7, 320, MonsterKind.MATKA),
    shooter,
    projectile(8, shooter.id),
    npc(9, 330, { ai: { ...aiState(), combatTargetId: p.id } }),
  ];

  tick(world, entities, 1 / 60, 0, clock);
  const stats = getAiStats();

  assert.equal(stats.liveAi, 7);
  assert.equal(stats.updated, 7);
  assert.equal(stats.skipped, 0);
  assert.equal(stats.updatedNpc, 6);
  assert.equal(stats.updatedMonster, 1);
  assert.equal(stats.plot, 1);
  assert.equal(stats.bosses, 1);
  assert.equal(stats.activeAttackers, 0);
  assert.equal(stats.projectileOwners, 1);
  assert.equal(stats.projectiles, 1);
});

test('AI pass depenetrates non-player actors spawned inside fine blockers', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const resident = npc(2, 30.5, {
    y: 10.5,
    ai: { goal: AIGoal.GOTO, tx: 80, ty: 80, path: [world.idx(30, 10), world.idx(31, 10)], pi: 0, stuck: 4, timer: 0 },
  });
  const mob = monster(3, 40.5, MonsterKind.SBORKA);
  mob.y = 10.5;
  blockCellFully(world, 30, 10);
  blockCellFully(world, 40, 10);

  tick(world, [player(), resident, mob], 1 / 60, 0, clock);

  assert.equal(canActorOccupy(world, resident.x, resident.y, 0.16), true);
  assert.notEqual(world.idx(Math.floor(resident.x), Math.floor(resident.y)), world.idx(30, 10));
  assert.equal(canActorOccupy(world, mob.x, mob.y, 0.18), true);
  assert.notEqual(world.idx(Math.floor(mob.x), Math.floor(mob.y)), world.idx(40, 10));
});

test('remote actors tick on the same frame as everyone else', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const resident = npc(2, 300);
  const mob = monster(3, 320, MonsterKind.SBORKA);
  mob.speed = 1;
  const entities = [player(), resident, mob];

  tick(world, entities, 1 / 60, 0, clock);
  const stats = getAiStats();

  assert.equal(stats.updated, 2);
  assert.equal(stats.updatedNpc, 1);
  assert.equal(stats.updatedMonster, 1);
  assert.equal((resident.ai?.stateTimer ?? 0) > 0, true);
  assert.equal(mob.ai?.goal, AIGoal.HUNT);
});

test('dense debug-spawned monsters are not capped out of AI', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  p.x = 20;
  p.y = 20;
  const entities = [p];
  const spawned: Entity[] = [];
  for (let i = 0; i < 80; i++) {
    const e = monster(200 + i, 24 + (i % 12), MonsterKind.SBORKA);
    e.y = 20 + Math.floor(i / 12);
    e.speed = 1;
    spawned.push(e);
    entities.push(e);
  }

  tick(world, entities, 1 / 60, 0, clock);
  const stats = getAiStats();

  assert.equal(stats.updatedMonster, spawned.length);
  assert.equal(stats.skipped, 0);
  assert.deepEqual(spawned.filter(e => e.ai?.combatTargetId !== p.id).map(e => e.id), []);
});

test('ordinary NPCs all run personal utility instead of an empty placeholder routine', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  p.x = 20;
  const residents: Entity[] = [];
  const entities = [p];
  for (let i = 0; i < 40; i++) {
    const resident = npc(20 + i, 200 + (i % 20) * 10, {
      y: 30 + Math.floor(i / 20) * 10,
      occupation: Occupation.COOK,
      weapon: undefined,
      inventory: [],
    });
    residents.push(resident);
    entities.push(resident);
  }

  tick(world, entities, 1 / 60, 0, clock);
  const stats = getAiStats();

  assert.equal(stats.updatedNpc, residents.length);
  assert.deepEqual(residents.filter(e => (e.ai?.stateTimer ?? 0) <= 0).map(e => e.id), []);
});

test('monster target acquisition works during scan cooldown', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  p.x = 20;
  const m = monster(2, 25, MonsterKind.SBORKA);
  m.speed = 1;
  m.ai!.combatScanCd = 10;
  const entities = [p, m];

  tick(world, entities, 1 / 60, 0, clock);

  assert.equal(m.ai?.combatTargetId, p.id);
  assert.equal(m.ai?.goal, AIGoal.HUNT);
});

test('monster target acquisition ignores the player while possessing a monster body', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const body = player();
  body.x = 300;
  const possessed = monster(2, 24, MonsterKind.SBORKA);
  possessed.speed = 1;
  const hunter = monster(3, 25, MonsterKind.SBORKA);
  hunter.speed = 1;
  hunter.ai!.combatScanCd = 10;
  const entities = [body, possessed, hunter];

  setCurrentPlayerEntity(possessed);
  try {
    tick(world, entities, 1 / 60, 0, clock);
  } finally {
    setCurrentPlayerEntity(undefined);
  }

  assert.equal(hunter.ai?.combatTargetId, undefined);
  assert.notEqual(hunter.ai?.goal, AIGoal.HUNT);
});

test('monster combat fires physical projectiles through the full AI pass', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  p.x = 20;
  const eye = monster(2, 30, MonsterKind.EYE);
  eye.attackCd = 0;
  const entities = [p, eye];

  for (let i = 0; i < 90 && !entities.some(e => e.type === EntityType.PROJECTILE && e.ownerId === eye.id); i++) {
    tick(world, entities, 1 / 30, i / 30, clock);
  }

  assert.equal(eye.ai?.combatTargetId, p.id);
  assert.equal(entities.some(e => e.type === EntityType.PROJECTILE && e.ownerId === eye.id), true);
});

test('live AI pass reaches monster ecology source updates', () => {
  const world = makeOpenWorld();
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 32,
    cy: 10,
    faction: ZoneFaction.WILD,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const p = player();
  p.x = 240;
  p.y = 240;
  const source = monster(2, 32.5, MonsterKind.MATKA);
  source.y = 10.5;
  source.speed = 0.4;
  source.matkaTimer = 0.01;
  const entities = [p, source];
  const state = makeGameState({ currentFloor: FloorLevel.HELL, worldEvents: createWorldEventState(), time: 1, clock });
  const nextId = { v: 20 };
  const msgs: Msg[] = state.msgs;

  rebuildEntityIndexForSimulation(entities, 1000);
  updateAI(world, entities, 0.02, 1, msgs, p.id, clock, false, nextId, FloorLevel.HELL, state);

  const children = entities.filter(e => e.type === EntityType.MONSTER && e.ai?.sourceEntityId === source.id);
  assert.equal(children.length, 1);
  assert.deepEqual(source.ai?.sourceChildIds, [children[0].id]);
  assert.equal(getRecentEvents(state, { type: 'matka_child_spawned', limit: 1 })[0]?.targetId, children[0].id);
});

test('combat NPC acquires nearby monster even during scan cooldown', () => {
  initFactionRelations();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const guard = npc(2, 25, {
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weapon: 'knife',
    inventory: [{ defId: 'knife', count: 1 }],
  });
  guard.ai!.combatScanCd = 10;
  const mob = monster(3, 29, MonsterKind.SBORKA);
  mob.speed = 1;
  const entities = [player(), guard, mob];

  tick(world, entities, 1 / 60, 0, clock);

  assert.equal(guard.ai?.combatTargetId, mob.id);
  assert.equal(guard.ai?.goal, AIGoal.HUNT);
});

test('hostile NPC groups keep physical ranged fire in the shared combat step', () => {
  initFactionRelations();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const entities = [player()];
  let id = 2;

  for (let i = 0; i < 6; i++) {
    entities.push(npc(id++, 300 + (i % 3), {
      y: 300 + Math.floor(i / 3),
      faction: Faction.LIQUIDATOR,
      occupation: Occupation.HUNTER,
      weapon: 'makarov',
      inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 24 }],
    }));
  }
  for (let i = 0; i < 6; i++) {
    entities.push(npc(id++, 306 + (i % 3), {
      y: 300 + Math.floor(i / 3),
      faction: Faction.CULTIST,
      occupation: Occupation.PILGRIM,
      weapon: 'makarov',
      inventory: [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 24 }],
    }));
  }

  const msgs: Msg[] = [];
  for (let i = 0; i < 480; i++) tick(world, entities, 1 / 60, i / 60, clock, msgs);

  assert.equal(entities.filter(e => e.type === EntityType.PROJECTILE).length > 0, true);
  assert.equal(entities.filter(e => e.type === EntityType.NPC && e.ai?.combatTargetId !== undefined).length >= 8, true);
});

test('remote wounded actor still receives the ordinary AI pass', () => {
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const wounded = npc(2, 300);
  const entities = [player(), wounded];

  tick(world, entities, 1 / 60, 0, clock);
  wounded.hp = 35;
  tick(world, entities, 1 / 60, 1 / 60, clock);
  const stats = getAiStats();

  assert.equal(stats.updatedNpc, 1);
  assert.equal((wounded.ai?.stateTimer ?? 0) > 0, true);
});

test('monster damage makes a weak remote NPC flee instead of standing idle', () => {
  resetCombatStimulus();
  initFactionRelations();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const victim = npc(2, 300, { weapon: '', inventory: [] });
  const mob = monster(3, 302, MonsterKind.SBORKA);
  mob.speed = 1;
  const entities = [player(), victim, mob];
  const state = makeGameState({ time: 0, clock });

  rebuildEntityIndexForSimulation(entities, 0);
  victim.hp = 42;
  notifyActorDamaged(world, victim, mob, 8, 'monster_melee', 0, state);
  tick(world, entities, 1 / 60, 1 / 60, clock);

  assert.equal(victim.ai?.goal, AIGoal.FLEE);
  assert.equal(victim.ai?.combatTargetId, mob.id);
});

test('monster damage makes an armed brave NPC target the attacker', () => {
  resetCombatStimulus();
  initFactionRelations();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const guard = npc(2, 300, {
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    weapon: 'knife',
    inventory: [{ defId: 'knife', count: 1 }],
  });
  const mob = monster(3, 302, MonsterKind.SBORKA);
  mob.speed = 1;
  const entities = [player(), guard, mob];
  const state = makeGameState({ time: 0, clock });

  rebuildEntityIndexForSimulation(entities, 0);
  guard.hp = 42;
  notifyActorDamaged(world, guard, mob, 8, 'monster_melee', 0, state);
  tick(world, entities, 1 / 60, 1 / 60, clock);

  assert.equal(guard.ai?.goal, AIGoal.HUNT);
  assert.equal(guard.ai?.combatTargetId, mob.id);
});

test('monster damage never creates monster-vs-monster combat', () => {
  resetCombatStimulus();
  initFactionRelations();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const victim = monster(2, 300, MonsterKind.SBORKA);
  const attacker = monster(3, 302, MonsterKind.TVAR);
  const entities = [player(), victim, attacker];
  const state = makeGameState({ time: 0, clock });

  rebuildEntityIndexForSimulation(entities, 0);
  victim.psiMadness = 5;
  notifyActorDamaged(world, victim, attacker, 30, 'monster_special', 0, state);
  tick(world, entities, 1 / 60, 1 / 60, clock);

  assert.equal(isHostile(victim, attacker), false);
  assert.equal(victim.ai?.combatTargetId, undefined);
});

test('NPC killing a monster through damage stimulus publishes npc kill event', () => {
  resetCombatStimulus();
  const world = makeOpenWorld();
  const clock = { hour: 8, minute: 0, totalMinutes: 0 };
  const guard = npc(2, 30, {
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    name: 'Ликвидатор',
  });
  const mob = monster(3, 31, MonsterKind.SBORKA);
  mob.hp = 0;
  const state = makeGameState({ time: 0, clock, worldEvents: createWorldEventState() });

  rebuildEntityIndexForSimulation([player(), guard, mob], 0);
  notifyActorDamaged(world, mob, guard, 12, 'npc_melee', 0, state);

  const events = getRecentEvents(state, { type: 'npc_kill_monster' });
  assert.equal(events.length, 1);
  assert.equal(events[0].actorId, guard.id);
  assert.equal(events[0].targetId, mob.id);
});
