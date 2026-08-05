import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { DoorState, EntityType, FloorLevel, MonsterKind, Occupation, W, ZoneFaction } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { DESIGN_FLOOR_ROUTES, designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  CAYLEY_BYURO_BASE_FLOOR,
  CAYLEY_BYURO_ROOM_NAMES,
  CAYLEY_BYURO_ROUTE_ID,
  CAYLEY_BYURO_TARGET_TERRITORY_SHARES,
  CAYLEY_BYURO_Z,
  cayleyApplyFormSequence,
  cayleyCosetOf,
  generateCayleyByuroDesignFloor,
  type CayleyByuroGeneration,
} from '../src/gen/design_floors/cayley_byuro';

test('cayley_byuro is registered as a Ministry-band authored route', () => {
  const route = designFloorById(CAYLEY_BYURO_ROUTE_ID);
  assert.equal(route?.z, CAYLEY_BYURO_Z);
  assert.equal(route?.baseFloor, CAYLEY_BYURO_BASE_FLOOR);
  assert.equal(route?.displayName, 'Бюро Кэли');
  assert.equal(designFloorAtZ(CAYLEY_BYURO_Z)?.id, CAYLEY_BYURO_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(CAYLEY_BYURO_Z), false);
  assert.equal(DESIGN_FLOOR_ROUTES.some(def => def.id === CAYLEY_BYURO_ROUTE_ID), true);
});

test('cayley_byuro form order is deterministic and non-commutative', () => {
  const rs = cayleyApplyFormSequence(['r', 's']);
  const sr = cayleyApplyFormSequence(['s', 'r']);

  assert.equal(rs, 'srr');
  assert.equal(sr, 'sr');
  assert.notEqual(rs, sr);
  assert.equal(cayleyCosetOf(rs), 'odd');
  assert.equal(cayleyCosetOf(sr), 'odd');
});

test('cayley_byuro authored generator creates graph rooms, cues and decision containers', () => {
  const gen = generateCayleyByuroDesignFloor();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const cues = getRouteCueMarkers(gen.world);
  const quests = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachableCells = audit.reachable.reduce((sum, value) => sum + value, 0);

  for (const name of Object.values(CAYLEY_BYURO_ROOM_NAMES)) assert.equal(names.has(name), true, name);
  for (const roomId of Object.values(gen.cayleyState.groupRooms)) {
    const room = gen.world.rooms[roomId];
    assert.ok(room);
    assert.equal(audit.reachable[gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2))], 1);
  }

  assert.equal(gen.cayleyState.generatorDoorIds.length >= 6, true);
  assert.equal(gen.cayleyState.quotientShortcutDoorIds.length >= 1, true);
  assert.equal(gen.world.rooms.length >= 360, true);
  assert.equal(gen.world.doors.size >= 260, true);
  assert.equal(reachableCells >= 180_000, true);
  for (const idx of gen.cayleyState.generatorDoorIds) {
    const door = gen.world.doors.get(idx);
    assert.equal(door?.state, DoorState.LOCKED);
    assert.equal(door?.keyId, 'key');
  }
  for (const idx of gen.cayleyState.quotientShortcutDoorIds) {
    const door = gen.world.doors.get(idx);
    assert.equal(door?.state, DoorState.LOCKED);
    assert.equal(door?.keyId, 'forged_permit_slip');
  }

  assert.equal(cues.some(cue => cue.id === 'cayley_byuro_order_rs' && cue.tags.includes('order_rs')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('generator_r') && c.tags.includes('bribe')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('quotient_shortcut') && c.tags.includes('forgery')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('identity_exposure')), true);
  for (const questId of [
    'cayley_byuro_bribe_generator_r',
    'cayley_byuro_apply_forms_rs',
    'cayley_byuro_expose_forged_identity',
  ]) {
    assert.equal(quests.has(questId), true, questId);
  }
});

test('cayley_byuro full route owns cells from faction HQ anchors', () => {
  const gen = generateDesignFloor(CAYLEY_BYURO_ROUTE_ID) as CayleyByuroGeneration;
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = W * W;
  const share = (owner: ZoneFaction) => (counts.get(owner) ?? 0) / totalCells;

  for (const owner of [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD] as const) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${owner}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `missing territory cells for ${owner}`);
  }

  for (const anchor of anchors) {
    assert.equal(territoryRoomOwner(gen.world, anchor.roomId), anchor.owner);
    assert.equal(territoryOwnerAt(gen.world, anchor.x, anchor.y), anchor.owner);
  }

  assert.equal(share(ZoneFaction.SCIENTIST) > share(ZoneFaction.CITIZEN), true);
  assert.equal(share(ZoneFaction.SCIENTIST) > share(ZoneFaction.LIQUIDATOR), true);
  assert.ok(Math.abs(share(ZoneFaction.CITIZEN) - CAYLEY_BYURO_TARGET_TERRITORY_SHARES[ZoneFaction.CITIZEN]) <= 0.04);
  assert.ok(Math.abs(share(ZoneFaction.LIQUIDATOR) - CAYLEY_BYURO_TARGET_TERRITORY_SHARES[ZoneFaction.LIQUIDATOR]) <= 0.04);
  assert.ok(Math.abs(share(ZoneFaction.CULTIST) - CAYLEY_BYURO_TARGET_TERRITORY_SHARES[ZoneFaction.CULTIST]) <= 0.035);
  assert.ok(Math.abs(share(ZoneFaction.SCIENTIST) - CAYLEY_BYURO_TARGET_TERRITORY_SHARES[ZoneFaction.SCIENTIST]) <= 0.045);
  assert.ok(Math.abs(share(ZoneFaction.WILD) - CAYLEY_BYURO_TARGET_TERRITORY_SHARES[ZoneFaction.WILD]) <= 0.035);
});

test('cayley_byuro full route applies bounded Ministry population pressure', () => {
  const route = designFloorById(CAYLEY_BYURO_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = generateDesignFloor(CAYLEY_BYURO_ROUTE_ID) as CayleyByuroGeneration;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);

  assert.equal(profile.npcTarget, 760);
  assert.equal(profile.monsterTarget, 980);
  assert.equal(profile.npcOccupations.some(value => value.value === Occupation.SECRETARY && value.weight >= 30), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.PARAGRAPH), true);
  assert.equal(npcs.length >= 560 && npcs.length <= 900, true);
  assert.equal(monsters.length >= 760 && monsters.length <= 1150, true);
  assert.equal(gen.cayleyState.routeId, CAYLEY_BYURO_ROUTE_ID);
});
