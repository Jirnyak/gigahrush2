import test from 'node:test';
import assert from 'node:assert/strict';

import { World } from '../src/core/world';
import {
  AIGoal,
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  type Entity,
  type GameState,
} from '../src/core/types';
import {
  assignPersistentAlifeNpcFromEntity,
  alifeForSave,
  captureAlifeFloorState,
  createPrefilledAlifeState,
  currentAlifeFloorRecordIds,
  forEachAlifeNpcRecordSlice,
  defaultAlifePopulation,
  getAlifeNpcRecordSnapshot,
  getAlifeNpcTotalMoney,
  getAlifeLeaderboardSnapshot,
  materializeAlifeArrival,
  materializeAlifeFloorPopulation,
  moveAlifeNpcRecord,
  packageIdFromReservedIdentityId,
  recordAlifeNpcDeath,
  selectCinematicExtras,
  resetAlifePlayerRelationsForNewPlayer,
  sampleAlifeFloorRecordIds,
  setAlifeState,
  type AlifePopulationPlan,
} from '../src/systems/alife';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { getEntityIndex, rebuildEntityIndexForSimulation } from '../src/systems/entity_index';
import { getFactionRel, initFactionRelations } from '../src/data/relations';
import { freshRPG, RPG_LEVEL_CAP } from '../src/systems/rpg';
import { NPC_VISUAL_FLOOR69_FEMALE, NPC_VISUAL_LIQUIDATOR_MALE } from '../src/entities/npc_visuals';

function minimalState(): GameState {
  const state = { currentFloor: FloorLevel.LIVING } as GameState;
  setFloorRunState(state, { runSeed: 1 }, FloorLevel.LIVING);
  return state;
}

function restoreGlobalProperty(name: 'navigator' | 'performance' | 'window', descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete (globalThis as Record<string, unknown>)[name];
}

function ambientTemplate(id: number, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1.2,
    sprite: Occupation.TRAVELER,
    name: `template ${id}`,
    hp: 10,
    maxHp: 10,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    faction: Faction.CITIZEN,
    occupation: Occupation.TRAVELER,
    isTraveler: true,
    questId: -1,
  };
}

test('A-Life default population baseline ignores runtime memory', () => {
  assert.equal(defaultAlifePopulation(), 100_000);
});

test('A-Life population plan pre-fills records, reserved identities and empty buckets', () => {
  const state = minimalState();
  const plan: AlifePopulationPlan = {
    buckets: [
      {
        floorKey: 'story:living',
        floor: FloorLevel.LIVING,
        targetCount: 3,
        reserved: [{
          name: 'Резервная Ольга',
          female: true,
          faction: Faction.SCIENTIST,
          occupation: Occupation.SCIENTIST,
          age: 31,
          sex: 'female',
          canGiveQuest: true,
          level: 9,
          maxHp: 3000,
          hp: 2700,
          money: 10_000,
          accountRubles: 1_000_000,
        }],
      },
      { floorKey: 'design:black_market_88', floor: FloorLevel.LIVING, targetCount: 2 },
      { floorKey: 'story:void', floor: FloorLevel.VOID, targetCount: 0 },
    ],
  };

  const alife = createPrefilledAlifeState(state, 12345, 5, plan) as {
    total: number;
    npcs: Array<{ id: number; floorKey: string; name: string; faction: Faction; occupation: Occupation; canGiveQuest: boolean }>;
    floorIndex: Record<string, number[]>;
  };

  assert.equal(alife.total, 5);
  assert.equal(alife.npcs.length, 5);
  assert.deepEqual(currentAlifeFloorRecordIds(state, 'story:living'), [1, 2, 3]);
  assert.deepEqual(currentAlifeFloorRecordIds(state, 'design:black_market_88'), [4, 5]);
  assert.deepEqual(currentAlifeFloorRecordIds(state, 'story:void'), []);
  const reserved = getAlifeNpcRecordSnapshot(state, 1);
  assert.equal(reserved?.name, 'Резервная Ольга');
  assert.equal(reserved?.faction, Faction.SCIENTIST);
  assert.equal(reserved?.occupation, Occupation.SCIENTIST);
  assert.equal(reserved?.age, 31);
  assert.equal(reserved?.sex, 'female');
  assert.equal(reserved?.canGiveQuest, true);
  assert.equal(reserved?.level, 9);
  assert.equal(reserved?.hp, 2700);
  assert.equal(reserved?.maxHp, 3000);
  assert.equal(reserved?.money, 10_000);
  assert.equal(reserved?.accountRubles, 1_000_000);
  for (const columnField of ['floorKey', 'floor', 'danger', 'faction', 'occupation', 'female', 'age', 'sex', 'level', 'hp', 'maxHp', 'money', 'accountRubles', 'familyId', 'canGiveQuest', 'sprite', 'spriteSeed', 'weapon', 'inventory', 'kills', 'npcKills', 'monsterKills', 'dead', 'touched']) {
    assert.equal(Object.hasOwn(alife.npcs[0], columnField), false, `${columnField} should not live as a per-record object field`);
  }
});

test('A-Life movement updates floor buckets once, clears stale coordinates and saves override', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 3, {
    buckets: [
      { floorKey: 'story:living', floor: FloorLevel.LIVING, targetCount: 2 },
      { floorKey: 'design:black_market_88', floor: FloorLevel.LIVING, targetCount: 1 },
    ],
  });

  assert.equal(moveAlifeNpcRecord(state, 1, 'design:black_market_88', { x: 5.25, y: 6.75, angle: -0.5 }), true);
  assert.equal(moveAlifeNpcRecord(state, 1, 'design:black_market_88', { preservePosition: true }), true);

  assert.deepEqual(currentAlifeFloorRecordIds(state, 'story:living'), [2]);
  assert.deepEqual(currentAlifeFloorRecordIds(state, 'design:black_market_88'), [3, 1]);
  const snapshot = getAlifeNpcRecordSnapshot(state, 1);
  assert.ok(snapshot);
  assert.equal(snapshot.floorKey, 'design:black_market_88');
  assert.equal(snapshot.floor, FloorLevel.LIVING);
  assert.equal(snapshot.x, 5.25);
  assert.equal(snapshot.y, 6.75);
  assert.equal(snapshot.angle !== undefined && snapshot.angle > 0, true);
  assert.equal(alifeForSave(state).overrides.some(item => item.id === 1 && item.floorKey === 'design:black_market_88'), true);

  const dead = ambientTemplate(99, 5.25, 6.75);
  dead.alifeId = 1;
  dead.persistentNpcId = 'alife:1';
  recordAlifeNpcDeath(state, dead);
  assert.equal(moveAlifeNpcRecord(state, 1, 'story:living'), false);
  assert.deepEqual(currentAlifeFloorRecordIds(state, 'design:black_market_88'), [3, 1]);
});

test('A-Life floor sampling is cursor based, bounded and skips dead records', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 4, {
    buckets: [{ floorKey: 'story:living', floor: FloorLevel.LIVING, targetCount: 4 }],
  });
  const dead = ambientTemplate(100, 10.5, 10.5);
  dead.alifeId = 2;
  dead.persistentNpcId = 'alife:2';
  recordAlifeNpcDeath(state, dead);

  assert.deepEqual(sampleAlifeFloorRecordIds(state, 'story:living', 0, 10), { ids: [1, 3, 4], nextCursor: 0 });
  assert.deepEqual(sampleAlifeFloorRecordIds(state, 'story:living', 2, 2), { ids: [3, 4], nextCursor: 0 });
});

test('A-Life snapshots are copies, not mutable record access', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{ name: 'Копия без доступа' }],
    }],
  });

  const snapshot = getAlifeNpcRecordSnapshot(state, 1);
  assert.ok(snapshot);
  snapshot.name = 'Мутировало снаружи';

  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.name, 'Копия без доступа');
});

test('A-Life arrival materializes one persistent record through the shared NPC constructor', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'design:black_market_88',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{ money: 77, accountRubles: 1234, karma: 12 }],
    }],
  });
  const world = new World();
  world.cells[world.idx(15, 15)] = Cell.FLOOR;
  const entities: Entity[] = [];
  const nextId = { v: 10 };

  const entity = materializeAlifeArrival(state, world, entities, nextId, 1, {
    x: 15.5,
    y: 15.5,
    angle: 1,
    isTraveler: false,
    goalX: 20,
    goalY: 20,
  });

  assert.ok(entity);
  assert.equal(entity.alifeId, 1);
  assert.equal(entity.persistentNpcId, 'alife:1');
  assert.equal(entity.money, 77);
  assert.equal(entity.accountRubles, 1234);
  assert.equal(entity.karma, 12);
  assert.equal(typeof entity.playerRelation, 'number');
  assert.equal(entity.isTraveler, false);
  assert.equal(entity.ai?.goal, AIGoal.GOTO);
  assert.equal(entities.length, 1);
  assert.equal(materializeAlifeArrival(state, world, entities, nextId, 1, { x: 15.5, y: 15.5 }), null);
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.floorKey, 'story:living');
});

test('A-Life mobile runtime keeps the same baseline despite large memory hints', () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36',
        maxTouchPoints: 5,
        deviceMemory: 16,
      },
    });
    Object.defineProperty(globalThis, 'performance', {
      configurable: true,
      value: { memory: { jsHeapSizeLimit: 4 * 1024 * 1024 * 1024 } },
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 844, innerHeight: 390 },
    });

    assert.equal(defaultAlifePopulation(), 100_000);
  } finally {
    restoreGlobalProperty('navigator', navigatorDescriptor);
    restoreGlobalProperty('performance', performanceDescriptor);
    restoreGlobalProperty('window', windowDescriptor);
  }
});

test('A-Life materializes ambient slots and leaves killed slots empty', () => {
  initFactionRelations();
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const world = new World();
  world.cells[world.idx(10, 10)] = Cell.FLOOR;
  world.cells[world.idx(11, 10)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 10.5, 10.5), ambientTemplate(2, 11.5, 10.5)];
  const nextId = { v: 3 };

  materializeAlifeFloorPopulation(state, world, entities, nextId, 'story:living');

  assert.equal(entities.length, 2);
  assert.equal(entities.every(entity => entity.alifeId !== undefined), true);
  const firstRelation = entities[0].playerRelation;
  assert.equal(typeof firstRelation, 'number');
  assert.ok(Math.abs((firstRelation ?? 0) - getFactionRel(entities[0].faction ?? Faction.CITIZEN, Faction.PLAYER)) <= 12);
  assert.equal(typeof entities[0].karma, 'number');
  assert.ok((entities[0].karma ?? 0) >= -127 && (entities[0].karma ?? 0) <= 127);
  const killedAlifeId = entities[0].alifeId;
  assert.ok(killedAlifeId);

  recordAlifeNpcDeath(state, entities[0]);

  const regenerated = [ambientTemplate(10, 10.5, 10.5), ambientTemplate(11, 11.5, 10.5)];
  materializeAlifeFloorPopulation(state, world, regenerated, { v: 20 }, 'story:living');

  assert.equal(regenerated.length, 1);
  assert.notEqual(regenerated[0].alifeId, killedAlifeId);
  assert.equal(regenerated[0].x, 11.5);
  assert.equal(alifeForSave(state).deadIds.includes(killedAlifeId), true);
});

test('A-Life materialization preserves local template anchors separately from social record family', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        name: 'Обычный жилец',
        faction: Faction.CITIZEN,
        occupation: Occupation.HUNTER,
        familyId: 999,
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(30, 30)] = Cell.FLOOR;
  const template = ambientTemplate(1, 30.5, 30.5);
  template.sprite = Occupation.HOUSEWIFE;
  template.occupation = Occupation.HOUSEWIFE;
  template.familyId = 42;
  template.assignedRoomId = 77;
  delete template.isTraveler;
  const entities = [template];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].occupation, Occupation.HUNTER);
  assert.equal(entities[0].familyId, 42);
  assert.equal(entities[0].assignedRoomId, 77);
  assert.equal(entities[0].isTraveler, false);
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.familyId, 999);
});

test('A-Life ordinary materialization assigns faction art visual ids without overriding templates', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        name: 'Ликвидатор без портрета',
        faction: Faction.LIQUIDATOR,
        occupation: Occupation.HUNTER,
        female: false,
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(31, 31)] = Cell.FLOOR;
  const template = ambientTemplate(1, 31.5, 31.5);
  template.faction = Faction.LIQUIDATOR;
  template.occupation = Occupation.HUNTER;
  template.sprite = Occupation.HUNTER;
  template.isFemale = false;
  const entities = [template];

  materializeAlifeFloorPopulation(state, world, entities, { v: 20 }, 'story:living');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].npcVisualId, NPC_VISUAL_LIQUIDATOR_MALE);
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.npcVisualId, NPC_VISUAL_LIQUIDATOR_MALE);
});

test('A-Life population package reservations materialize with exact runtime defaults and loadout', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 2, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 2,
      reserved: [{
        id: 'npc:quiet_mechanic',
        kind: 'authored',
        presence: 'population',
        name: 'Тихий механик',
        sex: 'male',
        age: 36,
        faction: Faction.CITIZEN,
        occupation: Occupation.MECHANIC,
        canGiveQuest: true,
        rpg: { level: 7, xp: 0, attrPoints: 0, str: 2, agi: 1, int: 3, psi: 13, maxPsi: 13 },
        maxHp: 222,
        hp: 111,
        speed: 1.7,
        isTraveler: false,
        weapon: 'makarov',
        tool: 'radio',
        inventory: [
          { defId: 'makarov', count: 1 },
          { defId: 'ammo_9mm', count: 9 },
          { defId: 'radio', count: 1 },
        ],
        money: 123,
        accountRubles: 456,
        kills: 2,
        npcKills: 1,
        monsterKills: 1,
        playerRelation: 42,
        karma: 7,
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(20, 20)] = Cell.FLOOR;
  world.cells[world.idx(21, 20)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 20.5, 20.5), ambientTemplate(2, 21.5, 20.5)];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');

  assert.equal(entities.length, 2);
  const packaged = entities.find(entity => entity.alifeId === 1);
  assert.ok(packaged);
  assert.equal(packaged.name, 'Тихий механик');
  assert.equal(packaged.weapon, 'makarov');
  assert.equal(packaged.tool, 'radio');
  assert.deepEqual(packaged.inventory, [
    { defId: 'makarov', count: 1 },
    { defId: 'ammo_9mm', count: 9 },
    { defId: 'radio', count: 1 },
  ]);
  assert.equal(packaged.money, 123);
  assert.equal(packaged.accountRubles, 456);
  assert.equal(packaged.hp, 111);
  assert.equal(packaged.maxHp, 222);
  assert.equal(packaged.speed, 2.0);
  assert.equal(packaged.isTraveler, false);
  assert.equal(packaged.canGiveQuest, true);
  assert.equal(packaged.rpg?.level, 7);
  assert.equal(packaged.rpg?.str, 2);
  assert.equal(packaged.kills, 2);
  assert.equal(packaged.npcKills, 1);
  assert.equal(packaged.monsterKills, 1);
  assert.equal(packaged.playerRelation, 42);
  assert.equal(packaged.karma, 7);

  const snapshot = getAlifeNpcRecordSnapshot(state, 1);
  assert.equal(packageIdFromReservedIdentityId(snapshot?.reservedIdentityId), 'quiet_mechanic');
  assert.equal(snapshot?.reservedPresence, 'population');
  assert.deepEqual(sampleAlifeFloorRecordIds(state, 'story:living', 0, 3), { ids: [1, 2], nextCursor: 0 });
});

test('A-Life killed population package reservation does not rematerialize on floor revisit', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        id: 'npc:doomed_resident',
        kind: 'authored',
        presence: 'population',
        name: 'Обреченный жилец',
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(22, 20)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 22.5, 20.5)];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');
  assert.equal(entities.length, 1);
  assert.equal(entities[0].alifeId, 1);

  recordAlifeNpcDeath(state, entities[0]);
  const revisited = [ambientTemplate(2, 22.5, 20.5)];
  materializeAlifeFloorPopulation(state, world, revisited, { v: 20 }, 'story:living');

  assert.equal(revisited.length, 0);
  assert.equal(alifeForSave(state).deadIds.includes(1), true);
});

test('A-Life event-only package reservation stays out of ordinary materialization slots', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 2, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 2,
      reserved: [{
        id: 'npc:alarm_only',
        kind: 'event_reserved',
        presence: 'event_only',
        name: 'Только событие',
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(23, 20)] = Cell.FLOOR;
  world.cells[world.idx(24, 20)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 23.5, 20.5), ambientTemplate(2, 24.5, 20.5)];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');

  assert.equal(packageIdFromReservedIdentityId(getAlifeNpcRecordSnapshot(state, 1)?.reservedIdentityId), 'alarm_only');
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.reservedPresence, 'event_only');
  assert.deepEqual(sampleAlifeFloorRecordIds(state, 'story:living', 0, 3), { ids: [2], nextCursor: 0 });
  assert.equal(entities.length, 1);
  assert.equal(entities[0].alifeId, 2);
  assert.notEqual(entities[0].name, 'Только событие');
});

test('A-Life population package foldback stores changed sparse state without live entities', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: 1,
      reserved: [{
        id: 'npc:foldback_resident',
        kind: 'authored',
        presence: 'population',
        name: 'Жилец фолдбэка',
        weapon: 'knife',
        tool: 'flashlight',
        inventory: [{ defId: 'knife', count: 1 }],
        money: 50,
        accountRubles: 500,
        playerRelation: 5,
        karma: 1,
      }],
    }],
  });
  const world = new World();
  world.cells[world.idx(25, 20)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 25.5, 20.5)];

  materializeAlifeFloorPopulation(state, world, entities, { v: 10 }, 'story:living');
  const npc = entities[0];
  npc.money = 777;
  npc.accountRubles = 888;
  npc.weapon = 'makarov';
  npc.tool = 'radio';
  npc.inventory = [{ defId: 'bandage', count: 2 }];
  npc.playerRelation = -33;
  npc.karma = -12;
  npc.rpg = { level: 9, xp: 0, attrPoints: 0, str: 4, agi: 2, int: 1, psi: 11, maxPsi: 11 };
  npc.kills = 4;
  npc.npcKills = 3;
  npc.monsterKills = 2;

  captureAlifeFloorState(state, entities);
  const save = alifeForSave(state);
  const override = save.overrides.find(item => item.id === 1);

  assert.ok(override);
  assert.equal(override.money, 777);
  assert.equal(override.accountRubles, 888);
  assert.equal(override.weapon, 'makarov');
  assert.equal(override.tool, 'radio');
  assert.deepEqual(override.inventory, [{ defId: 'bandage', count: 2 }]);
  assert.equal(override.playerRelation, -33);
  assert.equal(override.karma, -12);
  assert.equal(override.rpg?.level, 9);
  assert.equal(override.rpg?.str, 4);
  assert.equal(override.kills, 4);
  assert.equal(override.npcKills, 3);
  assert.equal(override.monsterKills, 2);
  assert.equal(Object.hasOwn(save as unknown as Record<string, unknown>, 'entities'), false);
});

test('event-created ordinary NPC receives persistent A-Life identity', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const npc = ambientTemplate(50, 16.5, 16.5);
  npc.name = 'Новый жилец';
  npc.faction = Faction.SCIENTIST;
  npc.occupation = Occupation.SCIENTIST;
  npc.money = 77;
  npc.canGiveQuest = true;
  npc.rpg = freshRPG(12);
  npc.maxHp = 64;
  npc.hp = 64;
  const entities: Entity[] = [];

  assert.equal(assignPersistentAlifeNpcFromEntity(state, npc, entities), true);

  assert.equal(typeof npc.alifeId, 'number');
  assert.equal(npc.persistentNpcId, `alife:${npc.alifeId}`);
  const save = alifeForSave(state);
  const override = save.overrides.find(item => item.id === npc.alifeId);
  assert.ok(override);
  assert.equal(override.name, 'Новый жилец');
  assert.equal(override.faction, Faction.SCIENTIST);
  assert.equal(override.occupation, Occupation.SCIENTIST);
  assert.equal(override.canGiveQuest, true);
});

test('event-created ordinary NPC does not inherit an existing A-Life identity or death slot', () => {
  const state = minimalState();
  const alife = setAlifeState(state, {
    seed: 12345,
    total: 1_000,
    overrides: [{
      id: 1,
      floorKey: 'story:living',
      playerRelation: -88,
      karma: -123,
      kills: 17,
      npcKills: 9,
    }],
  }) as {
    npcs: Array<{
      id: number;
      floorKey: string;
      kills?: number;
      npcKills?: number;
      dead?: boolean;
    }>;
    floorIndex: Record<string, number[]>;
  };
  const reserved = alife.npcs[0];
  alife.floorIndex['story:living'] = [0];

  const npc = ambientTemplate(60, 18.5, 18.5);
  npc.name = 'Прибытие без прошлого';
  npc.kills = undefined;
  npc.npcKills = undefined;
  npc.monsterKills = undefined;
  npc.playerRelation = undefined;
  npc.karma = undefined;

  assert.equal(assignPersistentAlifeNpcFromEntity(state, npc, []), true);

  assert.ok(npc.alifeId);
  assert.notEqual(npc.alifeId, reserved.id);
  assert.equal(getAlifeNpcRecordSnapshot(state, reserved.id)?.playerRelation, -88);
  assert.equal(getAlifeNpcRecordSnapshot(state, reserved.id)?.karma, -123);
  const reservedOverride = alifeForSave(state).overrides.find(item => item.id === reserved.id);
  assert.equal(reservedOverride?.kills, 17);
  assert.equal(reservedOverride?.npcKills, 9);
  assert.notEqual(npc.playerRelation, -88);
  assert.notEqual(npc.karma, -123);
  assert.equal(npc.kills, 0);
  assert.equal(npc.npcKills, 0);

  recordAlifeNpcDeath(state, npc);
  const save = alifeForSave(state);
  assert.equal(save.deadIds.includes(npc.alifeId), true);
  assert.equal(save.deadIds.includes(reserved.id), false);
});

test('A-Life player relations are regenerated for a new death-continuation host', () => {
  const state = minimalState();
  initFactionRelations();
  setAlifeState(state, {
    seed: 12345,
    total: 1_000,
    overrides: [
      { id: 1, floorKey: 'story:living', faction: Faction.LIQUIDATOR, playerRelation: 80 },
      { id: 2, floorKey: 'story:living', faction: Faction.CULTIST, playerRelation: -80 },
      { id: 3, floorKey: 'story:living', faction: Faction.CITIZEN, playerRelation: 80 },
    ],
  });
  const guard = ambientTemplate(1, 10, 10);
  guard.alifeId = 1;
  guard.playerRelation = 80;
  const host = ambientTemplate(2, 11, 10);
  host.alifeId = 2;
  host.faction = Faction.CULTIST;
  host.playerRelation = -80;
  const entities = [guard, host];

  const result = resetAlifePlayerRelationsForNewPlayer(state, entities, host, (from, target) =>
    from === 1 && target === 2 ? -73 : undefined
  );

  assert.equal(result.newPlayerAlifeId, 2);
  assert.equal(getAlifeNpcRecordSnapshot(state, 1)?.playerRelation, -73);
  assert.equal(guard.playerRelation, -73);
  assert.equal(getAlifeNpcRecordSnapshot(state, 2)?.playerRelation, 100);
  assert.equal(host.playerRelation, 100);
  assert.notEqual(getAlifeNpcRecordSnapshot(state, 3)?.playerRelation, 80);
});

test('A-Life death-continuation relation reset stays a compact current-player baseline', () => {
  const state = minimalState();
  initFactionRelations();
  setAlifeState(state, { seed: 12345, total: 20_000 });
  const host = ambientTemplate(2, 11, 10);
  host.alifeId = 2;
  host.faction = Faction.CULTIST;

  resetAlifePlayerRelationsForNewPlayer(state, [host], host);
  const save = alifeForSave(state);

  assert.equal(save.playerRelationTargetFaction, Faction.CULTIST);
  assert.equal(save.playerRelationTargetAlifeId, 2);
  assert.equal(save.overrides.length, 0);
  assert.equal(getAlifeNpcRecordSnapshot(state, 2)?.playerRelation, 100);
  assert.notEqual(getAlifeNpcRecordSnapshot(state, 3)?.playerRelation, undefined);
});

test('A-Life caps sanitized and saved dead ids', () => {
  const state = minimalState();
  const deadIds = Array.from({ length: 70_000 }, (_, index) => index + 1);
  setAlifeState(state, { seed: 12345, total: 100_000, deadIds });
  const save = alifeForSave(state);
  assert.equal(save.deadIds.length, 65_536);
  assert.equal(save.deadIds[0], 1);
  assert.equal(save.deadIds[save.deadIds.length - 1], 65_536);
});

test('A-Life quest candidates are bounded instead of every persistent NPC offering work', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 100_000 });
  let candidates = 0;
  forEachAlifeNpcRecordSlice(state, 0, defaultAlifePopulation(), snapshot => {
    if (snapshot.canGiveQuest) candidates++;
  });

  assert.ok(candidates > 4_000, 'some persistent NPCs should be quest candidates');
  assert.ok(candidates < 24_000, 'dense floors should not make every persistent NPC a quest giver');
});

test('A-Life design-floor records use Floor 69 social population mix', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 100_000 });
  const floor69: NonNullable<ReturnType<typeof getAlifeNpcRecordSnapshot>>[] = [];
  forEachAlifeNpcRecordSlice(state, 0, defaultAlifePopulation(), snapshot => {
    if (snapshot.floorKey === 'design:floor_69') floor69.push(snapshot);
  });
  const industrialTrades = floor69.filter(npc =>
    npc.occupation === Occupation.ELECTRICIAN ||
    npc.occupation === Occupation.TURNER,
  );

  assert.ok(floor69.length > 1000, 'floor_69 should receive a dense A-Life allocation');
  assert.equal(floor69.some(npc => npc.occupation === Occupation.CHILD), false);
  assert.ok(floor69.some(npc => npc.faction === Faction.LIQUIDATOR), 'floor_69 should include guard/liquidator records');
  assert.ok(floor69.some(npc => npc.occupation === Occupation.WORKER69), 'floor_69 should preserve worker69 records in the A-Life occupation column');
  assert.ok(floor69.some(npc => npc.occupation === Occupation.PERFORMER), 'floor_69 should still include general performer records');
  assert.ok(floor69.some(npc => npc.occupation === Occupation.DOCTOR), 'floor_69 should include clinic records');
  assert.ok(floor69.some(npc => npc.occupation === Occupation.SECRETARY || npc.occupation === Occupation.STOREKEEPER), 'floor_69 should include staff/accounting records');
  assert.ok(industrialTrades.length < floor69.length * 0.05, 'floor_69 should not inherit the generic Maintenance worker mix');
});

test('A-Life current route plan replaces blocked Floor 69 in strict portal mode', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?portal=pikabu' },
  });

  try {
    const state = minimalState();
    setAlifeState(state, { seed: 12345, total: 100_000 });
    let blockedDesignRecords = 0;
    let replacementRecords = 0;
    forEachAlifeNpcRecordSlice(state, 0, defaultAlifePopulation(), snapshot => {
      if (snapshot.floorKey === 'design:floor_69') blockedDesignRecords++;
      if (snapshot.floorKey === 'procedural:z-4') replacementRecords++;
    });

    assert.equal(blockedDesignRecords, 0);
    assert.ok(replacementRecords > 0, 'strict portal route should allocate A-Life to the procedural replacement floor');
  } finally {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else delete (globalThis as typeof globalThis & { location?: Location }).location;
  }
});

test('A-Life generation keeps broad level tail and splits wealth mostly into account balance', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 100_000 });
  let lowLevel = 0;
  let maxLevel = 0;
  let millionaires = 0;
  let totalCash = 0;
  let totalWealth = 0;
  let maxCash = 0;
  forEachAlifeNpcRecordSlice(state, 0, defaultAlifePopulation(), snapshot => {
    const wealth = snapshot.money + snapshot.accountRubles;
    if (snapshot.level <= 10) lowLevel++;
    if (snapshot.level > maxLevel) maxLevel = snapshot.level;
    if (wealth >= 1_000_000) millionaires++;
    totalCash += snapshot.money;
    totalWealth += wealth;
    if (snapshot.money > maxCash) maxCash = snapshot.money;
  });

  assert.ok(lowLevel > 50_000, 'most generated NPCs should stay in levels 1-10');
  assert.equal(maxLevel, 100);
  assert.ok(millionaires > 0 && millionaires < 10, 'procedural millionaires should exist but stay rare');
  assert.ok(totalCash / totalWealth > 0.08, 'generated NPCs should keep some capital as cash');
  assert.ok(totalCash / totalWealth < 0.14, 'generated NPCs should keep most capital on account');
  assert.ok(maxCash > 2_000, 'generated NPC cash has no artificial pocket cap');
});

test('A-Life materialization preserves template sprite identity for special floors', () => {
  const state = minimalState();
  createPrefilledAlifeState(state, 12345, 1_000, {
    version: 1, total: 1_000,
    buckets: [{ floorKey: 'story:living', baseFloor: FloorLevel.LIVING, targetCount: 1_000, factionWeights: [], occupationWeights: [] }],
    reserved: []
  });
  const world = new World();
  world.cells[world.idx(12, 10)] = Cell.FLOOR;
  const template = ambientTemplate(1, 12.5, 10.5);
  template.sprite = 777;
  template.npcVisualId = NPC_VISUAL_FLOOR69_FEMALE;
  template.name = 'Особый шаблон';
  template.isFemale = true;
  template.occupation = Occupation.SECRETARY;
  template.faction = Faction.SCIENTIST;
  template.isTraveler = false;
  template.assignedRoomId = 42;
  template.ai = { goal: AIGoal.WANDER, tx: 12, ty: 10, path: [{ x: 12, y: 10 }], pi: 0, stuck: 2, timer: 3 };
  const entities = [template];

  materializeAlifeFloorPopulation(state, world, entities, { v: 2 }, 'story:living');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].sprite, 777);
  assert.equal(entities[0].npcVisualId, NPC_VISUAL_FLOOR69_FEMALE);
  assert.equal(entities[0].name, 'Особый шаблон');
  assert.equal(entities[0].isFemale, true);
  assert.equal(entities[0].occupation, Occupation.SECRETARY);
  assert.equal(entities[0].faction, Faction.SCIENTIST);
  assert.equal(typeof entities[0].spriteSeed, 'number');
  assert.equal(typeof entities[0].canGiveQuest, 'boolean');
  assert.equal(entities[0].isTraveler, false);
  assert.equal(entities[0].assignedRoomId, 42);
  assert.equal(entities[0].ai?.goal, AIGoal.WANDER);
  assert.equal(entities[0].ai?.path.length, 0);
});

test('A-Life materializes cash and account wealth as separate NPC fields', () => {
  const state = minimalState();
  const alife = setAlifeState(state, { seed: 12345, total: 100_000, overrides: [{ id: 1, money: 640, accountRubles: 999_360 }] }) as {
    floorIndex: Record<string, number[]>;
  };
  alife.floorIndex['story:living'] = [0];
  const world = new World();
  world.cells[world.idx(12, 10)] = Cell.FLOOR;
  const entities = [ambientTemplate(1, 12.5, 10.5)];

  materializeAlifeFloorPopulation(state, world, entities, { v: 2 }, 'story:living');

  assert.equal(entities.length, 1);
  assert.equal(entities[0].money, 640);
  assert.equal(entities[0].accountRubles, 999_360);
  assert.equal(getAlifeNpcTotalMoney(state, entities[0]), 1_000_000);
  assert.equal(alifeForSave(state).overrides.some(item =>
    item.id === 1 &&
    item.money === 640 &&
    item.accountRubles === 999_360,
  ), true);
});

test('A-Life restored floor entities preserve account wealth on capture', () => {
  const state = minimalState();
  const alife = setAlifeState(state, { seed: 12345, total: 100_000, overrides: [{ id: 1, money: 640, accountRubles: 999_360 }] }) as {
    floorIndex: Record<string, number[]>;
  };
  alife.floorIndex['story:living'] = [0];
  const world = new World();
  world.cells[world.idx(12, 10)] = Cell.FLOOR;
  const restored = ambientTemplate(1, 12.5, 10.5);
  restored.alifeId = 1;
  restored.persistentNpcId = 'alife:1';
  restored.money = 640;
  const entities = [restored];

  materializeAlifeFloorPopulation(state, world, entities, { v: 2 }, 'story:living');
  captureAlifeFloorState(state, entities);

  assert.equal(alifeForSave(state).overrides.some(item =>
    item.id === 1 &&
    item.money === 640 &&
    item.accountRubles === 999_360,
  ), true);
});

test('A-Life leaderboard includes the player as a ranked actor', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 1_000 });
  const player: Entity = {
    id: 0,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    name: 'Жилец',
    faction: Faction.PLAYER,
    playerRelation: 100,
    karma: 0,
    kills: 300,
    npcKills: 120,
    monsterKills: 180,
    money: 10_000,
    rpg: freshRPG(RPG_LEVEL_CAP),
  };

  const snapshot = getAlifeLeaderboardSnapshot(state, player, 100);

  assert.equal(snapshot.totalAlive, alifeForSave(state).total + 1);
  assert.ok(snapshot.player.rank <= 100);
  assert.equal(snapshot.entries.some(entry => entry.player), true);
});

test('A-Life leaderboard cache respects requested limits', () => {
  const state = minimalState();
  setAlifeState(state, { seed: 12345, total: 1_000 });
  const player: Entity = {
    id: 0,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Вы',
    faction: Faction.PLAYER,
  };

  assert.equal(getAlifeLeaderboardSnapshot(state, player, 5).entries.length, 5);
  assert.equal(getAlifeLeaderboardSnapshot(state, player, 10).entries.length, 10);
});

test('A-Life selectCinematicExtras retrieves correct live NPCs', () => {
  const world = new World();
  const index = getEntityIndex();

  const entities: Entity[] = [
    { id: 1, type: EntityType.NPC, x: 10, y: 10, alive: true, angle: 0, pitch: 0, speed: 1, sprite: 0 },
    { id: 2, type: EntityType.NPC, x: 12, y: 10, alive: true, angle: 0, pitch: 0, speed: 1, sprite: 0 },
    { id: 3, type: EntityType.NPC, x: 10, y: 12, alive: false, angle: 0, pitch: 0, speed: 1, sprite: 0 },
    { id: 4, type: EntityType.NPC, x: 100, y: 100, alive: true, angle: 0, pitch: 0, speed: 1, sprite: 0 },
  ];
  rebuildEntityIndexForSimulation(entities, 1);

  const extras = selectCinematicExtras(world, 2, 10, 10, 10);
  assert.equal(extras.length, 2);
  assert.ok(extras.some(e => e.id === 1));
  assert.ok(extras.some(e => e.id === 2));
  assert.ok(!extras.some(e => e.id === 3)); // Dead
  assert.ok(!extras.some(e => e.id === 4)); // Out of radius
});
