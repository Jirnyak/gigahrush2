import { beforeEach, test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  AIGoal,
  Cell,
  ContainerKind,
  DoorState,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  LiftDirection,
  RoomType,
  Tex,
  W,
  ZoneFaction,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  SAMOSBOR_VARIANTS,
  buildActiveSamosborVariant,
  type ActiveSamosborVariant,
  type SamosborVariantId,
} from '../src/data/samosbor_variants';
import type { FloorGeneration } from '../src/gen/floor_manifest';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { forceNextSamosborVariant } from '../src/systems/samosbor_variants_runtime';
import {
  getSamosborActiveInstructionSnapshot,
  getSamosborWarningSnapshot,
  applySamosborFogEffectAtCellForTests,
  rebuildWorld,
  resetSamosborRuntimeForTests,
  resolvePlayerShelterAtSealForTests,
  spawnSamosborPlayerPressureMonsterForTests,
  tickRandomEntityTransferForTests,
  updateSamosbor,
} from '../src/systems/samosbor';
import { makeGameState } from './helpers';

const TEST_SHELTER_ROOM_ID = 777;

function testVariant(id: SamosborVariantId): ActiveSamosborVariant {
  const def = SAMOSBOR_VARIANTS.find(variant => variant.id === id);
  if (!def) throw new Error(`${id} samosbor variant missing`);
  return buildActiveSamosborVariant(def);
}

beforeEach(() => {
  resetSamosborRuntimeForTests();
});

function makeShelterWorld(doorState: DoorState): {
  world: World;
  entities: Entity[];
  player: Entity;
  nextId: { v: number };
} {
  const world = new World();
  const room = {
    id: TEST_SHELTER_ROOM_ID,
    type: RoomType.LIVING,
    x: 10, y: 10, w: 6, h: 6,
    doors: [] as number[],
    sealed: false,
    name: 'Тестовая гермокомната',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[TEST_SHELTER_ROOM_ID] = room;
  world.apartmentRoomCount = 0;
  world.zones[0] = { id: 0, cx: 14, cy: 14, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };

  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      world.set(x, y, Cell.FLOOR);
      world.roomMap[ci] = room.id;
      world.zoneMap[ci] = 0;
      world.aptMask[ci] = 1;
    }
  }

  const doorIdx = world.idx(room.x + room.w, room.y + 3);
  world.set(room.x + room.w, room.y + 3, Cell.DOOR);
  world.roomMap[doorIdx] = room.id;
  world.zoneMap[doorIdx] = 0;
  world.aptMask[doorIdx] = 1;
  world.doors.set(doorIdx, { idx: doorIdx, state: doorState, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorIdx);

  const hallIdx = world.idx(room.x + room.w + 1, room.y + 3);
  world.set(room.x + room.w + 1, room.y + 3, Cell.FLOOR);
  world.zoneMap[hallIdx] = 0;

  const player: Entity = {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: room.x + 2.5,
    y: room.y + 2.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Вы',
    faction: Faction.PLAYER,
    hp: 50,
    maxHp: 50,
    rpg: { level: 1, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 0, psi: 10, maxPsi: 10 },
  };

  return { world, entities: [player], player, nextId: { v: 2 } };
}

function resolveClassicSeal(ctx: ReturnType<typeof makeShelterWorld>): ReturnType<typeof makeGameState> {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 1,
    worldEvents: createWorldEventState(),
  });
  resolvePlayerShelterAtSealForTests(ctx.world, ctx.entities, state, testVariant('classic'));
  return state;
}

function forceWarningWindow(variantId: SamosborVariantId): {
  state: ReturnType<typeof makeGameState>;
  warning: NonNullable<ReturnType<typeof getSamosborWarningSnapshot>>;
} {
  resetSamosborRuntimeForTests();
  const ctx = makeShelterWorld(DoorState.CLOSED);
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.NPC,
    x: 14.5,
    y: 14.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Соседка',
    faction: Faction.CITIZEN,
    isFemale: true,
  });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborTimer: 12,
    worldEvents: createWorldEventState(),
  });
  assert.equal(forceNextSamosborVariant(variantId), true);
  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId), false);
  const warning = getSamosborWarningSnapshot(state);
  assert.ok(warning, `${variantId} warning snapshot should exist`);
  return { state, warning };
}

function makeMaronaryGlowWorld(): {
  world: World;
  entities: Entity[];
  player: Entity;
  nextId: { v: number };
} {
  const world = new World();
  world.zones[0] = { id: 0, cx: 13, cy: 13, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  for (let y = 8; y <= 18; y++) {
    for (let x = 8; x <= 18; x++) {
      const ci = world.idx(x, y);
      world.set(x, y, Cell.FLOOR);
      world.zoneMap[ci] = 0;
    }
  }
  const screenIdx = world.idx(12, 10);
  world.set(12, 10, Cell.WALL);
  world.features[screenIdx] = Feature.SCREEN;
  world.zoneMap[screenIdx] = 0;
  world.screenCells = [screenIdx];

  const player = makePlayer(1, 12.5, 11.5);
  return { world, entities: [player], player, nextId: { v: 2 } };
}

test('prepared hermodoor room shelters player and publishes success event', () => {
  const ctx = makeShelterWorld(DoorState.HERMETIC_CLOSED);
  const state = resolveClassicSeal(ctx);

  assert.equal(ctx.world.rooms[TEST_SHELTER_ROOM_ID].sealed, true);
  const events = getRecentEvents(state, { tags: ['shelter', 'success'], limit: 4 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'door_sealed');
  assert.equal(events[0].roomId, TEST_SHELTER_ROOM_ID);
});

test('unprepared shelter fails locally and publishes failure event', () => {
  const ctx = makeShelterWorld(DoorState.HERMETIC_OPEN);
  const state = resolveClassicSeal(ctx);

  assert.equal(ctx.world.rooms[TEST_SHELTER_ROOM_ID].sealed, false);
  assert.ok((ctx.player.hp ?? 50) < 50);
  assert.equal(ctx.world.fog.some(v => v > 0), false);
  const events = getRecentEvents(state, { tags: ['shelter', 'failure'], limit: 4 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'samosbor_warning');
  assert.equal(events[0].data?.hpDamage, 4);
  assert.equal(events[0].data?.fogCells, undefined);
});

test('random samosbor transfer moves a random map entity and can pick player', () => {
  const ctx = makeShelterWorld(DoorState.HERMETIC_CLOSED);
  const targetX = 20;
  const targetY = 20;
  const targetIdx = ctx.world.idx(targetX, targetY);
  ctx.world.set(targetX, targetY, Cell.FLOOR);
  ctx.world.zoneMap[targetIdx] = 0;
  ctx.entities.unshift({
    id: ctx.nextId.v++,
    type: EntityType.NPC,
    x: 14.5,
    y: 14.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Сосед',
    faction: Faction.CITIZEN,
  });
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 1,
    worldEvents: createWorldEventState(),
  });
  const originalRandom = Math.random;
  const targetRoll = (targetIdx + 0.25) / (W * W);
  const rolls = [0.75, targetRoll, 0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    assert.equal(tickRandomEntityTransferForTests(ctx.world, ctx.entities, state, testVariant('classic')), true);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(ctx.player.x, targetX + 0.5);
  assert.equal(ctx.player.y, targetY + 0.5);
  const events = getRecentEvents(state, { tags: ['random_transfer'], limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].actorId, ctx.player.id);
});

test('samosbor warning publishes sound, HUD/log, hazard, and nearby NPC bark channels', () => {
  const { state, warning } = forceWarningWindow('classic');

  assert.equal(warning.variantId, 'classic');
  assert.equal(warning.tint, '#a34cff');
  assert.equal(warning.actionLine, 'К гермодвери или выйдите из зоны.');
  assert.match(warning.shelterHintLine, /выйдите из зоны/);
  assert.ok(warning.signals.channels.includes('audio'));
  assert.ok(warning.signals.channels.includes('hud'));
  assert.ok(warning.signals.channels.includes('log'));
  assert.ok(warning.signals.channels.includes('hazard'));
  assert.ok(warning.signals.channels.includes('npc_barks'));
  assert.match(warning.signals.audioLine, /сирена/);
  assert.match(warning.signals.hazardLine, /зона риска|зона риска рядом/);
  assert.match(warning.signals.npcLine, /соседи: 1/);
  assert.ok(state.msgs.some(m => m.text.includes('Через 12с ожидается классический самосбор.')));
  assert.ok(state.msgs.some(m => m.text.includes('Соседка:')));

  const events = getRecentEvents(state, { type: 'samosbor_warning', tags: ['prewarning'], limit: 1 });
  assert.equal(events.length, 1);
  const channels = events[0].data?.warningChannels;
  assert.ok(Array.isArray(channels));
  assert.ok(channels.includes('audio'));
  assert.ok(channels.includes('hazard'));
  assert.ok(channels.includes('npc_barks'));
  assert.ok(state.msgLog.some(entry => entry.text.includes('Через 12с ожидается классический самосбор.')));
});

test('active samosbor exposes a compact survival instruction', () => {
  resetSamosborRuntimeForTests();
  const ctx = makeShelterWorld(DoorState.CLOSED);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborTimer: 0,
    worldEvents: createWorldEventState(),
  });
  assert.equal(forceNextSamosborVariant('classic'), true);

  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId), false);
  const active = getSamosborActiveInstructionSnapshot(state);

  assert.equal(state.samosborActive, true);
  assert.ok(active);
  assert.equal(active.variantId, 'classic');
  assert.match(active.actionLine, /гермодвери|гермой|зоны/);
  assert.equal(active.secondsLeft > 0, true);
});

test('normal and rare samosbor warnings keep variant-specific colors and cues', () => {
  const cases: Array<{
    id: SamosborVariantId;
    tint: string;
    signalCode: string;
    audio: RegExp;
    hazard: RegExp;
  }> = [
    { id: 'classic', tint: '#a34cff', signalCode: 'СБОР', audio: /штатная сирена/, hazard: /зона риска/ },
    { id: 'maronary', tint: '#35ff66', signalCode: 'МАР', audio: /высокий писк/, hazard: /зелёный|повтор двери/ },
    { id: 'istotit', tint: '#d6a64b', signalCode: 'ИСТ', audio: /колокол/, hazard: /жёлтые комнаты/ },
    { id: 'veretar', tint: '#f4f1df', signalCode: 'ВЕР', audio: /внешняя тревога/, hazard: /белое пятно/ },
  ];

  for (const spec of cases) {
    const { warning } = forceWarningWindow(spec.id);
    assert.equal(warning.variantId, spec.id);
    assert.equal(warning.tint, spec.tint);
    assert.equal(warning.signals.signalCode, spec.signalCode);
    assert.match(warning.signals.audioLine, spec.audio);
    assert.match(warning.signals.hazardLine, spec.hazard);
  }
});

test('maronary green source glow damages player near marked source', () => {
  resetSamosborRuntimeForTests();
  const ctx = makeMaronaryGlowWorld();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborTimer: 1,
    worldEvents: createWorldEventState(),
  });
  assert.equal(forceNextSamosborVariant('maronary'), true);

  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId), false);
  const warning = getSamosborWarningSnapshot(state);
  assert.ok(warning);
  assert.equal(warning.variantId, 'maronary');
  assert.ok(warning.greenSourceCount > 0);

  const hpBefore = ctx.player.hp ?? 0;
  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 1, ctx.nextId), false);

  assert.ok((ctx.player.hp ?? 0) < hpBefore);
  assert.equal(state.lastDamage?.sourceKind, 'samosbor');
  assert.match(state.lastDamage?.detail ?? '', /Маронарий: зелёное свечение/);
  const events = getRecentEvents(state, { tags: ['glow_damage'], limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].data?.damage, hpBefore - (ctx.player.hp ?? 0));
});

function makeFogEffectWorld(): { world: World; state: ReturnType<typeof makeGameState>; entities: Entity[]; nextId: { v: number }; ci: number } {
  const world = new World();
  world.zones[0] = { id: 0, cx: 20, cy: 20, faction: ZoneFaction.SAMOSBOR, hasLift: false, fogged: true, level: 2, hqRoomId: -1 };
  for (let y = 18; y <= 22; y++) {
    for (let x = 18; x <= 22; x++) {
      const ci = world.idx(x, y);
      world.set(x, y, Cell.FLOOR);
      world.zoneMap[ci] = 0;
      world.roomMap[ci] = -1;
    }
  }
  const ci = world.idx(20, 20);
  world.fog[ci] = 180;
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 2,
    worldEvents: createWorldEventState(),
  });
  return { world, state, entities: [], nextId: { v: 10 }, ci };
}

test('classic fog effect spawns a monster from active fog', () => {
  const ctx = makeFogEffectWorld();

  const applied = applySamosborFogEffectAtCellForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    ctx.state.samosborCount,
    testVariant('classic'),
    FloorLevel.LIVING,
    ctx.ci,
  );

  assert.equal(applied, true);
  assert.equal(ctx.entities.length, 1);
  assert.equal(ctx.entities[0].type, EntityType.MONSTER);
});

function makePlayerPressureWorld(): {
  world: World;
  entities: Entity[];
  player: Entity;
  state: ReturnType<typeof makeGameState>;
  nextId: { v: number };
  pressureIdx: number;
} {
  const world = new World();
  world.zones[0] = { id: 0, cx: 20, cy: 20, faction: ZoneFaction.SAMOSBOR, hasLift: false, fogged: true, level: 2, hqRoomId: -1 };
  const player = makePlayer(1, 20.5, 20.5);
  player.rpg = { level: 7, xp: 0, attrPoints: 0, str: 0, agi: 0, int: 0, psi: 10, maxPsi: 10 };
  const playerIdx = world.idx(20, 20);
  world.set(20, 20, Cell.FLOOR);
  world.zoneMap[playerIdx] = 0;
  world.roomMap[playerIdx] = -1;

  const pressureIdx = world.idx(32, 20);
  world.set(32, 20, Cell.FLOOR);
  world.zoneMap[pressureIdx] = 0;
  world.roomMap[pressureIdx] = -1;

  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 3,
    worldEvents: createWorldEventState(),
  });
  return { world, entities: [player], player, state, nextId: { v: 10 }, pressureIdx };
}

test('active samosbor spawns nearby pressure monster targeting unsheltered player above player level', () => {
  const ctx = makePlayerPressureWorld();

  assert.equal(spawnSamosborPlayerPressureMonsterForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    testVariant('classic'),
    FloorLevel.LIVING,
  ), true);

  const monster = ctx.entities.find(e => e.type === EntityType.MONSTER);
  assert.ok(monster);
  assert.equal(monster.ai?.goal, AIGoal.HUNT);
  assert.equal(monster.ai?.combatTargetId, ctx.player.id);
  assert.equal((monster.rpg?.level ?? 0) >= (ctx.player.rpg?.level ?? 1) + 1, true);
  assert.equal(ctx.world.dist2(ctx.player.x, ctx.player.y, monster.x, monster.y) >= 8 * 8, true);
  const events = getRecentEvents(ctx.state, { tags: ['player_pressure', 'target_player'], limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].targetId, ctx.player.id);
  assert.equal(events[0].data?.raised, true);
});

test('active samosbor pressure spawn is skipped for accepted shelter player', () => {
  const ctx = makeShelterWorld(DoorState.HERMETIC_CLOSED);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 2,
    worldEvents: createWorldEventState(),
  });
  resolvePlayerShelterAtSealForTests(ctx.world, ctx.entities, state, testVariant('classic'));
  const pressureIdx = ctx.world.idx(28, 13);
  ctx.world.set(28, 13, Cell.FLOOR);
  ctx.world.zoneMap[pressureIdx] = 0;
  ctx.world.roomMap[pressureIdx] = -1;

  assert.equal(spawnSamosborPlayerPressureMonsterForTests(
    ctx.world,
    ctx.entities,
    state,
    ctx.nextId,
    testVariant('classic'),
    FloorLevel.LIVING,
  ), false);
  assert.equal(ctx.entities.some(e => e.type === EntityType.MONSTER), false);
});

test('maronary fog effect rewrites actor identity in active fog', () => {
  const ctx = makeFogEffectWorld();
  const npc: Entity = {
    id: 2,
    type: EntityType.NPC,
    x: 20.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Старое имя',
    faction: Faction.CITIZEN,
  };
  ctx.entities.push(npc);

  const applied = applySamosborFogEffectAtCellForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    ctx.state.samosborCount,
    testVariant('maronary'),
    FloorLevel.LIVING,
    ctx.ci,
  );

  assert.equal(applied, true);
  assert.notEqual(npc.name, 'Старое имя');
  assert.ok(npc.rpg);
  assert.ok((npc.inventory?.length ?? 0) > 0);
  assert.equal(getRecentEvents(ctx.state, { tags: ['maronary', 'rewrite'], limit: 1 }).length, 1);
});

test('veretar fog effect deletes actor in active fog', () => {
  const ctx = makeFogEffectWorld();
  const npc: Entity = {
    id: 3,
    type: EntityType.NPC,
    x: 20.5,
    y: 20.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Свидетель',
    faction: Faction.CITIZEN,
  };
  ctx.entities.push(npc);

  const applied = applySamosborFogEffectAtCellForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    ctx.state.samosborCount,
    testVariant('veretar'),
    FloorLevel.LIVING,
    ctx.ci,
  );

  assert.equal(applied, true);
  assert.equal(npc.alive, false);
  assert.equal(npc.hp, 0);
  const events = getRecentEvents(ctx.state, { tags: ['veretar', 'delete'], limit: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0].data?.effect, 'npc_deleted');
});

test('veretar fog cell deletion records local grid dirty rects', () => {
  const ctx = makeFogEffectWorld();

  const applied = applySamosborFogEffectAtCellForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    ctx.state.samosborCount,
    testVariant('veretar'),
    FloorLevel.LIVING,
    ctx.ci,
  );

  assert.equal(applied, true);
  assert.deepEqual(ctx.world.takeCellDirtyRects(), [{ x: 20, y: 20, w: 1, h: 1 }]);
  assert.deepEqual(ctx.world.takeFloorTexDirtyRects(), [{ x: 20, y: 20, w: 1, h: 1 }]);
});

test('istotit fog effect heals actors in active fog', () => {
  const ctx = makeFogEffectWorld();
  const player = makePlayer(1, 20.5, 20.5);
  player.hp = 20;
  player.maxHp = 100;
  player.needs = { food: 10, water: 10, sleep: 10, pee: 0, poo: 0 };
  ctx.entities.push(player);

  const applied = applySamosborFogEffectAtCellForTests(
    ctx.world,
    ctx.entities,
    ctx.state,
    ctx.nextId,
    ctx.state.samosborCount,
    testVariant('istotit'),
    FloorLevel.LIVING,
    ctx.ci,
  );

  assert.equal(applied, true);
  assert.equal(player.hp, 38);
  assert.equal(player.needs.food, 18);
  assert.equal(getRecentEvents(ctx.state, { tags: ['istotit', 'create'], limit: 1 }).length, 1);
});

test('captured samosbor zone is restored before post-cycle patch or fallback rebuild', () => {
  const ctx = makeShelterWorld(DoorState.CLOSED);
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    samosborTimer: 0,
    worldEvents: createWorldEventState(),
  });
  assert.equal(forceNextSamosborVariant('classic'), true);

  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId), false);
  assert.equal(state.samosborActive, true);
  assert.equal(ctx.world.zones[0].faction, ZoneFaction.SAMOSBOR);
  assert.equal(ctx.world.zones[0].fogged, true);

  state.samosborTimer = 0;
  // Note: updateSamosbor no longer returns true implicitly, it returns false
  updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId);
  assert.equal(state.samosborActive, false);
  assert.equal(ctx.world.zones[0].faction, ZoneFaction.CITIZEN);
  assert.equal(ctx.world.zones[0].fogged, false);
});

interface RuntimeGenerationCase {
  target: World;
  generation: FloorGeneration;
  entities: Entity[];
  nextId: { v: number };
  before: {
    cellVersion: number;
    surfaceVersion: number;
    wallTexVersion: number;
    floorTexVersion: number;
    fogVersion: number;
  };
  staleIdx: number;
  protectedIdx: number;
  screenIdx: number;
  surfaceIdx: number;
  teleportA: number;
  teleportB: number;
  smogIdx: number;
  smogNeighborIdx: number;
  trackCell: number;
  trackId: string;
  containerId: number;
}

function makePlayer(id: number, x: number, y: number): Entity {
  return {
    id,
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
    faction: Faction.PLAYER,
  };
}

function seedTargetRuntimeState(world: World, staleIdx: number): RuntimeGenerationCase['before'] {
  world.aptMask[staleIdx] = 1;
  world.hermoWall[staleIdx] = 1;
  world.fog[staleIdx] = 220;
  world.screenCells = [staleIdx];
  world.surfaceMap.set(staleIdx, new Uint8Array(1024));
  world.anomalyTeleports.set(staleIdx, world.idx(8, 8));
  world.anomalySmogSource = staleIdx;
  world.anomalySmogCells = [staleIdx];
  world.anomalySmogHandled = true;
  world.railTracks = [{ id: 'stale_track', label: 'stale', cells: [staleIdx], stationOffsets: [0], platformCells: [staleIdx], loop: true }];
  world.railTrains = [{
    id: 'stale_train',
    label: 'stale',
    trackId: 'stale_track',
    offset: 0,
    speed: 1,
    length: 1,
    direction: 1,
    stopSeconds: 1,
    stopUntil: -1,
    passengerId: -1,
    passengerSeat: -1,
    entityIds: [],
    lastStopOffset: 0,
    nextWarnAt: 0,
    nextCrushAt: 0,
    nextDoorMsgAt: 0,
  }];
  world.railTrainCells.set(staleIdx, 0);
  world.cellVersion = 11;
  world.surfaceVersion = 12;
  world.wallTexVersion = 13;
  world.floorTexVersion = 14;
  world.fogVersion = 15;
  return {
    cellVersion: world.cellVersion,
    surfaceVersion: world.surfaceVersion,
    wallTexVersion: world.wallTexVersion,
    floorTexVersion: world.floorTexVersion,
    fogVersion: world.fogVersion,
  };
}

function makeRuntimeGenerationCase(seed: number, floor: FloorLevel): RuntimeGenerationCase {
  const target = new World();
  const staleIdx = target.idx(5, 5);
  const before = seedTargetRuntimeState(target, staleIdx);

  const world = new World();
  const room = {
    id: 0,
    type: RoomType.STORAGE,
    x: 40 + seed * 3,
    y: 45 + seed * 3,
    w: 7,
    h: 7,
    doors: [] as number[],
    sealed: false,
    name: `runtime room ${seed}`,
    apartmentId: seed,
    wallTex: Tex.METAL,
    floorTex: Tex.F_TILE,
  };
  world.rooms[0] = room;
  world.apartmentRoomCount = 1;
  world.zones[0] = { id: 0, cx: room.x + 3, cy: room.y + 3, faction: ZoneFaction.CULTIST, hasLift: false, fogged: false, level: 3, hqRoomId: room.id };
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = room.id;
      world.floorTex[ci] = Tex.F_TILE;
      world.zoneMap[ci] = 0;
      world.factionControl[ci] = ZoneFaction.CULTIST;
    }
  }

  const protectedIdx = world.idx(room.x + 1, room.y + 1);
  world.aptMask[protectedIdx] = 1;
  world.hermoWall[protectedIdx] = 1;
  const doorIdx = world.idx(room.x + room.w, room.y + 3);
  world.cells[doorIdx] = Cell.DOOR;
  world.roomMap[doorIdx] = room.id;
  world.zoneMap[doorIdx] = 0;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: room.id, roomB: -1, keyId: '', timer: 0 });
  room.doors.push(doorIdx);

  const screenIdx = world.idx(room.x + 2, room.y - 1);
  world.cells[screenIdx] = Cell.WALL;
  world.features[screenIdx] = Feature.SCREEN;
  world.wallTex[screenIdx] = Tex.SCREEN_BASE;
  world.screenCells = [screenIdx];
  const surfaceIdx = world.idx(room.x + 3, room.y + 3);
  const surface = new Uint8Array(1024);
  surface[3] = 180;
  world.surfaceMap.set(surfaceIdx, surface);
  world.surfaceVersion = 4;

  const teleportA = world.idx(room.x + 4, room.y + 4);
  const teleportB = world.idx(room.x + 5, room.y + 5);
  world.anomalyTeleports.set(teleportA, teleportB);
  const smogIdx = world.idx(room.x + 2, room.y + 2);
  const smogNeighborIdx = world.idx(room.x + 2, room.y + 3);
  world.anomalySmogSource = smogIdx;
  world.anomalySmogCells = [smogIdx, smogNeighborIdx];
  world.anomalySmogHandled = seed % 2 === 0;
  world.fog[smogIdx] = 77;
  world.liftDir[teleportA] = LiftDirection.UP;
  world.slideCells = [screenIdx, world.idx(room.x + 4, room.y - 1)];

  const trackCell = world.idx(room.x + 1, room.y + 5);
  const trackId = `runtime_track_${seed}`;
  world.railTracks = [{ id: trackId, label: 'Runtime rail', cells: [trackCell], stationOffsets: [0], platformCells: [trackCell], loop: true }];
  world.railTrains = [{
    id: `runtime_train_${seed}`,
    label: 'Runtime train',
    trackId,
    offset: 0,
    speed: 2,
    length: 1,
    direction: 1,
    stopSeconds: 2,
    stopUntil: -1,
    passengerId: -1,
    passengerSeat: -1,
    entityIds: [],
    lastStopOffset: 0,
    nextWarnAt: 0,
    nextCrushAt: 0,
    nextDoorMsgAt: 0,
  }];
  world.railTrainCells.set(trackCell, 0);

  const containerId = 900 + seed;
  world.addContainer({
    id: containerId,
    x: room.x + 2,
    y: room.y + 2,
    floor,
    roomId: room.id,
    zoneId: 0,
    kind: ContainerKind.TOOL_LOCKER,
    name: `Runtime locker ${seed}`,
    inventory: [{ defId: 'water', count: 1 }],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: ['runtime_replace_test'],
  });

  const entities = [makePlayer(1, room.x + 1.5, room.y + 1.5)];
  const generatedNpc = {
    id: 50 + seed,
    type: EntityType.NPC,
    x: room.x + 2.5,
    y: room.y + 2.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    faction: Faction.CITIZEN,
  } satisfies Entity;

  return {
    target,
    generation: { world, entities: [generatedNpc], spawnX: room.x + 1.5, spawnY: room.y + 1.5 },
    entities,
    nextId: { v: 1000 },
    before,
    staleIdx,
    protectedIdx,
    screenIdx,
    surfaceIdx,
    teleportA,
    teleportB,
    smogIdx,
    smogNeighborIdx,
    trackCell,
    trackId,
    containerId,
  };
}

test('local samosbor patch can be deferred before replacement generation', () => {
  const ctx = makeShelterWorld(DoorState.CLOSED);
  ctx.world.zones[0].cx = 96;
  ctx.world.zones[0].cy = 96;
  for (let y = 88; y <= 104; y++) {
    for (let x = 88; x <= 104; x++) {
      const idx = ctx.world.idx(x, y);
      ctx.world.set(x, y, Cell.FLOOR);
      ctx.world.roomMap[idx] = -1;
      ctx.world.zoneMap[idx] = 0;
      ctx.world.aptMask[idx] = 0;
      ctx.world.hermoWall[idx] = 0;
    }
  }
  const state = makeGameState({
    currentFloor: FloorLevel.MINISTRY,
    samosborTimer: 0,
    worldEvents: createWorldEventState(),
  });
  assert.equal(forceNextSamosborVariant('classic'), true);

  assert.equal(updateSamosbor(ctx.world, ctx.entities, state, 0, ctx.nextId), false);
  assert.equal(state.samosborActive, true);

  state.samosborTimer = 0;
  let replacementCalls = 0;
  let scheduledPatch: (() => void) | null = null;
  const replacement = makeRuntimeGenerationCase(8, FloorLevel.MINISTRY).generation;
  const needsFullRebuild = updateSamosbor(
    ctx.world,
    ctx.entities,
    state,
    0,
    ctx.nextId,
    () => {
      replacementCalls++;
      return replacement;
    },
    fn => {
      scheduledPatch = fn;
    },
  );

  assert.equal(needsFullRebuild, false);
  assert.equal(state.samosborActive, false);
  assert.equal(ctx.world.zones[0].faction, ZoneFaction.CITIZEN);
  assert.equal(ctx.world.zones[0].fogged, false);
  assert.equal(replacementCalls, 0);
  if (!scheduledPatch) throw new Error('local samosbor patch was not scheduled');

  scheduledPatch();

  assert.equal(replacementCalls, 1);
});

function runReplacementRebuild(seed: number, floor: FloorLevel): RuntimeGenerationCase {
  const ctx = makeRuntimeGenerationCase(seed, floor);
  rebuildWorld(ctx.target, ctx.entities, ctx.nextId, seed, floor, ctx.generation);
  return ctx;
}

function assertDirtyVersionsBumped(ctx: RuntimeGenerationCase): void {
  assert.equal(ctx.target.cellVersion, (ctx.before.cellVersion + 1) | 0);
  assert.equal(ctx.target.surfaceVersion, (ctx.before.surfaceVersion + 1) | 0);
  assert.equal(ctx.target.wallTexVersion, (ctx.before.wallTexVersion + 1) | 0);
  assert.equal(ctx.target.floorTexVersion, (ctx.before.floorTexVersion + 1) | 0);
  assert.equal(ctx.target.fogVersion, (ctx.before.fogVersion + 1) | 0);
}

test('story-floor samosbor rebuild copies generated protected state and bumps dirty versions', () => {
  const ctx = runReplacementRebuild(1, FloorLevel.MINISTRY);

  assert.equal(ctx.target.aptMask[ctx.protectedIdx], 1);
  assert.equal(ctx.target.hermoWall[ctx.protectedIdx], 1);
  assert.equal(ctx.target.aptMask[ctx.staleIdx], 0);
  assert.equal(ctx.target.hermoWall[ctx.staleIdx], 0);
  assert.equal(ctx.target.apartmentRoomCount, 1);
  assert.equal(ctx.entities.some(e => e.persistentNpcId === 'player'), true);
  assert.equal(ctx.entities.some(e => e.type === EntityType.NPC && e.id >= 1000), true);
  assertDirtyVersionsBumped(ctx);
});

test('design-floor samosbor rebuild resets stale screens and surfaces from replacement', () => {
  const ctx = runReplacementRebuild(2, FloorLevel.LIVING);

  assert.deepEqual(ctx.target.screenCells, [ctx.screenIdx]);
  assert.equal(ctx.target.surfaceMap.has(ctx.surfaceIdx), true);
  assert.equal(ctx.target.surfaceMap.has(ctx.staleIdx), false);
  assert.equal(ctx.target.containers.some(c => c.id === ctx.containerId), true);
  assert.equal(ctx.target.containerById.get(ctx.containerId)?.name, 'Runtime locker 2');
  assert.equal(ctx.target.containerMap.get(ctx.target.idx(ctx.generation.world.containers[0].x, ctx.generation.world.containers[0].y))?.includes(ctx.containerId), true);
  assertDirtyVersionsBumped(ctx);
});

test('procedural samosbor rebuild copies anomaly, smog, fog and rail runtime state', () => {
  const ctx = runReplacementRebuild(3, FloorLevel.MAINTENANCE);

  assert.equal(ctx.target.anomalyTeleports.get(ctx.teleportA), ctx.teleportB);
  assert.equal(ctx.target.anomalyTeleports.has(ctx.staleIdx), false);
  assert.equal(ctx.target.anomalySmogSource, ctx.smogIdx);
  assert.deepEqual(ctx.target.anomalySmogCells, [ctx.smogIdx, ctx.smogNeighborIdx]);
  assert.equal(ctx.target.anomalySmogHandled, false);
  assert.equal(ctx.target.fog[ctx.smogIdx], 77);
  assert.equal(ctx.target.fog[ctx.staleIdx], 0);
  assert.equal(ctx.target.railTracks[0]?.id, ctx.trackId);
  assert.equal(ctx.target.railTrains[0]?.trackId, ctx.trackId);
  assert.equal(ctx.target.railTrainCells.get(ctx.trackCell), 0);
  assert.equal(ctx.target.liftDir[ctx.teleportA], LiftDirection.UP);
  assertDirtyVersionsBumped(ctx);
});

test('full samosbor rebuild preserves old fog on walkable regenerated cells only', () => {
  const ctx = makeRuntimeGenerationCase(4, FloorLevel.MINISTRY);
  ctx.generation.world.cells[ctx.staleIdx] = Cell.FLOOR;
  ctx.generation.world.floorTex[ctx.staleIdx] = Tex.F_CONCRETE;
  ctx.generation.world.wallTex[ctx.staleIdx] = Tex.CONCRETE;
  ctx.generation.world.zoneMap[ctx.staleIdx] = 0;
  ctx.generation.world.fog[ctx.staleIdx] = 0;

  rebuildWorld(ctx.target, ctx.entities, ctx.nextId, 4, FloorLevel.MINISTRY, ctx.generation);

  assert.equal(ctx.target.cells[ctx.staleIdx], Cell.FLOOR);
  assert.equal(ctx.target.aptMask[ctx.staleIdx], 0);
  assert.equal(ctx.target.hermoWall[ctx.staleIdx], 0);
  assert.equal(ctx.target.fog[ctx.staleIdx], 220);
  assertDirtyVersionsBumped(ctx);
});
