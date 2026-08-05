import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  W,
  ZoneFaction,
} from '../src/core/types';
import {
  DESIGN_FLOOR_ROUTES,
  designFloorAtZ,
  designFloorById,
} from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import {
  commitFloorRunEntry,
  resolveFloorRunRoute,
  setFloorRunState,
} from '../src/systems/procedural_floors';
import { getRecentEvents } from '../src/systems/events';
import { putIntoContainer, takeFromContainer } from '../src/systems/containers';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  BANK_FLOOR_BASE_FLOOR,
  BANK_FLOOR_ROUTE_ID,
  BANK_FLOOR_Z,
  BANK_HQ_ROOM_NAMES,
  BANK_ROOM_NAMES,
  BANK_VAULT_RISK_RADIUS,
  bankVaultRiskSources,
  bankVaultRiskTierAt,
} from '../src/gen/design_floors/bank_floor';
import {
  countTerritoryCells,
  territoryHqAnchors,
} from '../src/systems/territory';
import { makeGameState, makeTestPlayer } from './helpers';

let cachedReadOnlyGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function bankFloorForRead(): ReturnType<typeof generateDesignFloor> {
  cachedReadOnlyGeneration ??= generateDesignFloor(BANK_FLOOR_ROUTE_ID);
  return cachedReadOnlyGeneration;
}

function countEntitiesNear(
  gen: ReturnType<typeof generateDesignFloor>,
  type: EntityType,
  x: number,
  y: number,
  radius: number,
): number {
  const r2 = radius * radius;
  let count = 0;
  for (const entity of gen.entities) {
    if (!entity.alive || entity.type !== type) continue;
    if (gen.world.dist2(entity.x, entity.y, x, y) <= r2) count++;
  }
  return count;
}

test('bank_floor is registered as an authored Ministry-band route', () => {
  const route = designFloorById(BANK_FLOOR_ROUTE_ID);
  assert.equal(route?.z, BANK_FLOOR_Z);
  assert.equal(route?.baseFloor, BANK_FLOOR_BASE_FLOOR);
  assert.equal(route?.displayName, 'Банковский этаж');
  assert.equal(designFloorAtZ(BANK_FLOOR_Z)?.id, BANK_FLOOR_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(BANK_FLOOR_Z), false);
  assert.equal(DESIGN_FLOOR_ROUTES.some(def => def.id === BANK_FLOOR_ROUTE_ID), true);
});

test('normal lift route reaches bank_floor between Ministry and Raionsovet archive', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY });
  setFloorRunState(state, { runSeed: 2214, currentZ: 30, specs: {}, visited: {} }, FloorLevel.MINISTRY);

  const upperGap = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(upperGap?.z, 29);
  assert.equal(upperGap?.procedural, true);
  commitFloorRunEntry(state, upperGap!);

  const labyrinth = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(labyrinth?.z, 28);
  assert.equal(labyrinth?.designFloorId, 'istinniy_labirint');
  commitFloorRunEntry(state, labyrinth!);

  for (const expectedZ of [27]) {
    const gap = resolveFloorRunRoute(state, LiftDirection.DOWN);
    assert.equal(gap?.z, expectedZ);
    assert.equal(gap?.procedural, true);
    commitFloorRunEntry(state, gap!);
  }

  const bank = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(bank?.z, BANK_FLOOR_Z);
  assert.equal(bank?.designFloorId, BANK_FLOOR_ROUTE_ID);
  assert.equal(bank?.baseFloor, BANK_FLOOR_BASE_FLOOR);
  commitFloorRunEntry(state, bank!);

  const firstGap = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(firstGap?.z, 25);
  assert.equal(firstGap?.procedural, true);
  commitFloorRunEntry(state, firstGap!);

  const leakArchive = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(leakArchive?.z, 24);
  assert.equal(leakArchive?.designFloorId, 'critical_leak_archive');
  assert.equal(leakArchive?.baseFloor, FloorLevel.MINISTRY);
  commitFloorRunEntry(state, leakArchive!);

  for (const expectedZ of [23]) {
    const nextGap = resolveFloorRunRoute(state, LiftDirection.DOWN);
    assert.equal(nextGap?.z, expectedZ);
    assert.equal(nextGap?.procedural, true);
    commitFloorRunEntry(state, nextGap!);
  }

  const archive = resolveFloorRunRoute(state, LiftDirection.DOWN);
  assert.equal(archive?.z, 22);
  assert.equal(archive?.designFloorId, 'raionsovet_archive');
});

test('bank_floor population profile targets bank crowds, guards and paper monsters', () => {
  const route = designFloorById(BANK_FLOOR_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);

  assert.equal(profile.npcTarget, 1400);
  assert.equal(profile.monsterTarget, 650);
  assert.equal(profile.npcFactions.some(v => v.value === Faction.LIQUIDATOR && v.weight >= 20), true);
  assert.equal(profile.npcFactions.some(v => v.value === Faction.WILD && v.weight >= 10), true);
  assert.equal(profile.npcOccupations.some(v => v.value === Occupation.SECRETARY && v.weight >= 25), true);
  assert.equal(profile.npcOccupations.some(v => v.value === Occupation.ALCOHOLIC && v.weight > 0), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.PROTOKOLNIK), true);
  assert.equal(profile.npcPlacement.anchors?.some(a => a.x === 506 && a.y === 548 && a.weight > 2), true);
  assert.equal(profile.monsterPlacement.anchors?.some(a => a.x === 603 && a.y === 515 && a.weight > 2), true);
});

test('bank_floor generator creates named banking rooms, NPCs, containers and passable spawn', () => {
  const gen = bankFloorForRead();
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const names = new Set(gen.world.rooms.map(room => room.name));
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const upLift = gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT);
  const downLift = gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(upLift, true);
  assert.equal(downLift, true);
  for (const roomName of [
    BANK_ROOM_NAMES.hall,
    BANK_ROOM_NAMES.teller,
    BANK_ROOM_NAMES.deposit,
    BANK_ROOM_NAMES.credit,
    BANK_ROOM_NAMES.vault,
    BANK_ROOM_NAMES.queue,
    BANK_ROOM_NAMES.bypass,
    BANK_ROOM_NAMES.tellerLane,
    BANK_ROOM_NAMES.debtorCircuit,
    BANK_ROOM_NAMES.bribeQueue,
    BANK_ROOM_NAMES.vaultShell,
    BANK_ROOM_NAMES.bypassGate,
    'Очередной зал вкладчиков Б-22',
    'Очередной зал должников Б-22',
    'Сейфовый пост ликвидаторов Б-22',
    'Архив испорченных депозитов Б-22',
    'Черная кассовая перемычка Б-22',
    'Северная депозитная ячейка Б-22 1',
    'Южная долговая клетка Б-22 1',
    'Западный кассовый кабинет Б-22 1',
    'Восточный сейфовый кабинет Б-22 1',
  ]) {
    assert.equal(names.has(roomName), true, roomName);
  }
  assert.equal(gen.world.rooms.length >= 96, true);
  assert.equal(gen.world.doors.size >= 96, true);
  assert.equal(npcs.length >= 5, true);
  assert.equal(npcs.some(e => e.plotNpcId === 'bank_cashier_lyuba'), true);
  assert.equal(npcs.some(e => e.plotNpcId === 'bank_credit_prokhor'), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('banking') && c.tags.includes('deposit')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('banking') && c.tags.includes('vault')), true);
  assert.equal(gen.world.containers.some(c => c.tags.includes('banking') && c.tags.includes('bribe') && c.tags.includes('buyable')), true);
});

test('bank_floor has named mini-HQs and cell territory near target shares', () => {
  const gen = bankFloorForRead();
  const names = new Set(gen.world.rooms.map(room => room.name));
  const anchors = territoryHqAnchors(gen.world);
  const anchorByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const expectedHqs = new Map([
    [ZoneFaction.CITIZEN, BANK_HQ_ROOM_NAMES.citizen],
    [ZoneFaction.LIQUIDATOR, BANK_HQ_ROOM_NAMES.liquidator],
    [ZoneFaction.CULTIST, BANK_HQ_ROOM_NAMES.cultist],
    [ZoneFaction.SCIENTIST, BANK_HQ_ROOM_NAMES.scientist],
    [ZoneFaction.WILD, BANK_HQ_ROOM_NAMES.wild],
  ]);

  for (const [owner, roomName] of expectedHqs) {
    const anchor = anchorByOwner.get(owner);
    assert.ok(anchor, ZoneFaction[owner]);
    assert.equal(gen.world.rooms[anchor.roomId]?.name, roomName);
  }
  for (const supportRoom of [
    'Кухня гражданского баланса Б-22',
    'Санузел гражданского баланса Б-22',
    'Оружейный шкаф инкассаторов Б-22',
    'Медпункт инкассаторов Б-22',
    'Санузел свечной очереди Б-22',
    'Лаборатория процентного шума Б-22',
    'Кухня ночной кассы Б-22',
  ]) {
    assert.equal(names.has(supportRoom), true, supportRoom);
  }

  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const total = W * W;
  const shares = new Map([...counts].map(([owner, cells]) => [owner, cells / total]));
  assert.equal([...counts].every(([, cells]) => cells >= 0), true);
  assert.equal((counts.get(ZoneFaction.CITIZEN) ?? 0) > (counts.get(ZoneFaction.LIQUIDATOR) ?? 0), true);
  assert.ok((shares.get(ZoneFaction.CITIZEN) ?? 0) >= 0.40 && (shares.get(ZoneFaction.CITIZEN) ?? 0) <= 0.44);
  assert.ok((shares.get(ZoneFaction.LIQUIDATOR) ?? 0) >= 0.26 && (shares.get(ZoneFaction.LIQUIDATOR) ?? 0) <= 0.30);
  assert.ok((shares.get(ZoneFaction.CULTIST) ?? 0) >= 0.06 && (shares.get(ZoneFaction.CULTIST) ?? 0) <= 0.10);
  assert.ok((shares.get(ZoneFaction.SCIENTIST) ?? 0) >= 0.08 && (shares.get(ZoneFaction.SCIENTIST) ?? 0) <= 0.12);
  assert.ok((shares.get(ZoneFaction.WILD) ?? 0) >= 0.10 && (shares.get(ZoneFaction.WILD) ?? 0) <= 0.14);
});

test('bank_floor full route keeps crowd density and guarded vault pressure in playable bands', () => {
  const gen = bankFloorForRead();
  const npcs = gen.entities.filter(e => e.type === EntityType.NPC);
  const monsters = gen.entities.filter(e => e.type === EntityType.MONSTER);
  const vaultContainers = gen.world.containers.filter(c => c.tags.includes('banking') && c.tags.includes('vault'));

  assert.equal(npcs.length >= 800 && npcs.length <= 1800, true);
  assert.equal(monsters.length >= 300 && monsters.length <= 900, true);
  assert.equal(countEntitiesNear(gen, EntityType.NPC, 514, 512, 130) >= 100, true);
  assert.equal(countEntitiesNear(gen, EntityType.NPC, 506, 548, 70) >= 35, true);
  assert.equal(countEntitiesNear(gen, EntityType.NPC, 610, 512, 70) >= 30, true);
  assert.equal(countEntitiesNear(gen, EntityType.MONSTER, 603, 515, 90) >= 20, true);
  assert.equal(countEntitiesNear(gen, EntityType.MONSTER, 573, 540, 80) >= 16, true);
  assert.equal(vaultContainers.length >= 2, true);
  assert.equal(vaultContainers.every(c => c.access !== 'public' && (c.lockDifficulty ?? 0) >= 4), true);
});

test('bank_floor marks vault risk SDF around high-value rooms and escape pressure', () => {
  const gen = bankFloorForRead();
  const vaultSources = bankVaultRiskSources(gen.world);
  const highValueVault = gen.world.containers.find(c => c.tags.includes('banking') && c.tags.includes('high_value'));
  const vault = gen.world.containers.find(c => c.tags.includes('banking') && c.tags.includes('vault'));

  assert.equal(BANK_VAULT_RISK_RADIUS >= 80, true);
  assert.equal(vaultSources.length >= 4, true);
  assert.ok(highValueVault);
  assert.ok(vault);
  assert.equal(highValueVault.tags.includes('vault_risk_sdf'), true);
  assert.equal(highValueVault.tags.includes('escape_pressure'), true);
  assert.equal(bankVaultRiskTierAt(gen.world, vault.x + 0.5, vault.y + 0.5) >= 4, true);
  assert.equal(bankVaultRiskTierAt(gen.world, 300.5, 300.5), 0);
});

test('bank_floor exposes legal deposit and risky vault interactions through existing systems', () => {
  const gen = generateDesignFloor(BANK_FLOOR_ROUTE_ID);
  const state = makeGameState({ currentFloor: BANK_FLOOR_BASE_FLOOR, time: 12 });
  const player = makeTestPlayer({
    id: 9999,
    x: gen.spawnX,
    y: gen.spawnY,
    speed: 3,
    hp: 100,
    maxHp: 100,
    money: 180,
    inventory: [{ defId: 'voluntary_receipt', count: 1 }],
  });
  const deposit = gen.world.containers.find(c => c.tags.includes('banking') && c.tags.includes('account'));
  const vault = gen.world.containers.find(c => c.tags.includes('banking') && c.tags.includes('vault'));

  assert.ok(deposit);
  assert.ok(vault);
  assert.equal(putIntoContainer(deposit, player, 0, 1, { state, world: gen.world, entities: gen.entities }), true);

  const depositEvent = getRecentEvents(state, { type: 'item_deposited', tags: ['banking', 'deposit'], limit: 1 })[0];
  assert.equal(depositEvent?.containerId, deposit.id);
  assert.equal(depositEvent?.data?.depositOutcome, 'deposit');

  player.x = vault.x + 0.5;
  player.y = vault.y + 0.5;
  assert.equal(takeFromContainer(vault, player, 0, 1, { state, world: gen.world, entities: gen.entities }), true);
  const theftEvent = getRecentEvents(state, { type: 'item_stolen', tags: ['banking', 'vault'], limit: 1 })[0];
  assert.equal(theftEvent?.containerId, vault.id);
  assert.equal(theftEvent?.tags.includes('theft'), true);
});

test('bank_floor registers banking side quests for deposit, loan, repayment and forged paper choices', () => {
  const ids = new Set(getSideQuestRegistrySnapshot().map(q => q.id));
  for (const id of [
    'bank_wait_teller_lane',
    'bank_cash_deposit_50',
    'bank_take_corridor_loan',
    'bank_repay_corridor_loan',
    'bank_report_forged_debt_paper',
    'bank_cash_forged_debt_paper',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
});
