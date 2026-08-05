import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityType, Faction, FloorLevel, Occupation, type Entity, type GameState } from '../src/core/types';
import {
  DEMOS_EDGE_DEBT,
  DEMOS_EDGE_ENEMY,
  DEMOS_EDGE_FRIEND,
  DEMOS_EDGE_WORK,
  DEMOS_RELATION_EMPTY,
  DEMOS_RELATION_MAX,
  DEMOS_RELATION_MIN,
  DEMOS_SOCIAL_NPC_SLOT_START,
  DEMOS_SOCIAL_NPC_SLOTS,
  DEMOS_SOCIAL_PLAYER_SLOT,
  DEMOS_SOCIAL_PUBLIC_SLOTS,
  DEMOS_SOCIAL_INITIAL_NPC_SLOTS,
  DemosSocialRoleId,
} from '../src/data/demos_social';
import { registerNpcPackages, type NpcPackageDef } from '../src/data/npc_packages';
import { initFactionRelations } from '../src/data/relations';
import { createEmptyDemosSocialSaveState } from '../src/systems/demos_save';
import {
  captureAlifeFloorState,
  createPrefilledAlifeState,
  recordAlifeNpcDeath,
  type AlifePopulationReservedNpc,
} from '../src/systems/alife';
import {
  applyDemosRelationDelta,
  clearDemosNpcSocialEdges,
  getDemosNpcOnlySocialEdges,
  getDemosOutgoingSocialEdges,
  getDemosRelationToPlayerSlot,
  getDemosSocialGraphStats,
  setDemosSocialEdge,
} from '../src/systems/demos_social';

interface DemosSocialGraphDebug {
  targets: Uint32Array;
  relations: Int8Array;
}

function stateWithPopulation(seed: number, total: number, reserved: readonly AlifePopulationReservedNpc[] = []): GameState {
  initFactionRelations();
  const state = { currentFloor: FloorLevel.LIVING } as GameState;
  createPrefilledAlifeState(state, seed, total, {
    buckets: [{
      floorKey: 'story:living',
      floor: FloorLevel.LIVING,
      targetCount: total,
      reserved,
    }],
  });
  return state;
}

function debugGraph(state: GameState): DemosSocialGraphDebug {
  getDemosSocialGraphStats(state);
  return (state as GameState & { demosSocialGraph: DemosSocialGraphDebug }).demosSocialGraph;
}

function demosPackage(id: string, displayName: string, social: NpcPackageDef['social'] = {}): NpcPackageDef {
  return {
    version: 1,
    id,
    kind: 'design',
    identity: { firstName: displayName, displayName },
    bio: { publicLine: displayName },
    demographics: { sex: 'male', age: 33 },
    affiliation: { faction: Faction.CITIZEN, occupation: Occupation.SECRETARY },
    rpg: { level: 1 },
    wealth: {},
    loadout: {},
    social,
    visual: {},
    placement: { homeFloorKey: 'story:living', presence: 'population' },
    speech: {},
  };
}

function deadAlifeEntity(alifeId: number): Entity {
  return {
    id: 1000 + alifeId,
    type: EntityType.NPC,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: false,
    speed: 0,
    sprite: Occupation.HOUSEWIFE,
    name: `dead ${alifeId}`,
    alifeId,
    persistentNpcId: `alife:${alifeId}`,
    faction: Faction.CITIZEN,
    hp: 0,
    maxHp: 10,
    inventory: [],
  };
}

test('Demos social graph is deterministic for the same A-Life seed and state', () => {
  const state = stateWithPopulation(101, 32);
  const first = getDemosNpcOnlySocialEdges(state, 7);
  const second = getDemosNpcOnlySocialEdges(state, 7);
  assert.deepEqual(second, first);

  const sameSeed = stateWithPopulation(101, 32);
  assert.deepEqual(getDemosNpcOnlySocialEdges(sameSeed, 7), first);
});

test('Demos social constants expose player plus nine NPC public slots', () => {
  assert.equal(DEMOS_SOCIAL_PLAYER_SLOT, 0);
  assert.equal(DEMOS_SOCIAL_NPC_SLOT_START, 1);
  assert.equal(DEMOS_SOCIAL_NPC_SLOTS, 9);
  assert.equal(DEMOS_SOCIAL_INITIAL_NPC_SLOTS, 4);
  assert.equal(DEMOS_SOCIAL_PUBLIC_SLOTS, 10);
});

test('Demos social graph changes at least some edges for a different seed', () => {
  const first = Array.from(debugGraph(stateWithPopulation(201, 48)).targets);
  const second = Array.from(debugGraph(stateWithPopulation(202, 48)).targets);
  assert.notDeepEqual(second, first);
});

test('Demos social graph stores only valid directed NPC targets and relation bytes', () => {
  const total = 40;
  const state = stateWithPopulation(303, total);
  for (let alifeId = 1; alifeId <= total; alifeId++) {
    const seen = new Set<number>();
    const edges = getDemosNpcOnlySocialEdges(state, alifeId);
    assert.ok(edges.length <= DEMOS_SOCIAL_NPC_SLOTS);
    for (const edge of edges) {
      assert.equal(edge.targetKind, 'alife');
      assert.notEqual(edge.slot, 0);
      assert.ok(edge.targetAlifeId !== undefined);
      assert.ok(edge.targetAlifeId > 0 && edge.targetAlifeId <= total);
      assert.notEqual(edge.targetAlifeId, alifeId);
      assert.equal(seen.has(edge.targetAlifeId), false);
      seen.add(edge.targetAlifeId);
      assert.ok(edge.relation >= DEMOS_RELATION_MIN && edge.relation <= DEMOS_RELATION_MAX);
    }
  }
});

test('Demos social graph leaves empty NPC slots with the -128 relation sentinel', () => {
  const graph = debugGraph(stateWithPopulation(404, 1));
  assert.equal(graph.targets.length, DEMOS_SOCIAL_PUBLIC_SLOTS);
  assert.equal(graph.targets[DEMOS_SOCIAL_PLAYER_SLOT], 0);
  assert.notEqual(graph.relations[DEMOS_SOCIAL_PLAYER_SLOT], DEMOS_RELATION_EMPTY);
  for (let i = DEMOS_SOCIAL_NPC_SLOT_START; i < graph.targets.length; i++) {
    assert.equal(graph.targets[i], 0);
    assert.equal(graph.relations[i], DEMOS_RELATION_EMPTY);
  }
});

test('Demos player relation is stored in public slot zero and exposed with outgoing edges', () => {
  const state = stateWithPopulation(505, 8, [{
    faction: Faction.CULTIST,
  }]);
  captureAlifeFloorState(state, [{ ...deadAlifeEntity(1), alive: true, hp: 10, playerRelation: -100 }]);
  const playerSlot = getDemosRelationToPlayerSlot(state, 1);
  assert.ok(playerSlot);
  assert.equal(playerSlot.slot, 0);
  assert.equal(playerSlot.targetKind, 'player');
  assert.equal(playerSlot.targetAlifeId, undefined);
  assert.equal(playerSlot.relation, DEMOS_RELATION_MIN);

  const outgoing = getDemosOutgoingSocialEdges(state, 1);
  assert.equal(outgoing[0].slot, 0);
  assert.equal(outgoing[0].targetKind, 'player');
  assert.equal(getDemosNpcOnlySocialEdges(state, 1).some(edge => edge.slot === 0 || edge.targetKind === 'player'), false);
});

test('Demos relation delta to player persists as the same relation override shape', () => {
  const state = stateWithPopulation(515, 8);
  const result = applyDemosRelationDelta(state, 1, { targetKind: 'player' }, -12, { reasonTag: 'test_player_delta' });
  const social = (state as GameState & { demosSocial?: ReturnType<typeof createEmptyDemosSocialSaveState> }).demosSocial;

  assert.equal(result?.targetKind, 'player');
  assert.equal(getDemosRelationToPlayerSlot(state, 1)?.relation, result?.relation);
  assert.equal(social?.relationOverrides.some(override =>
    override.fromAlifeId === 1
    && override.targetKind === 'player'
    && override.targetAlifeId === undefined
    && override.value === result?.relation), true);
});

test('Demos relation deltas propagate through source friends and enemies', () => {
  const state = stateWithPopulation(525, 8);
  for (const id of [1, 2, 3]) clearDemosNpcSocialEdges(state, id);
  setDemosSocialEdge(state, 1, 2, DEMOS_RELATION_MAX, DEMOS_EDGE_FRIEND);
  setDemosSocialEdge(state, 1, 3, DEMOS_RELATION_MIN, DEMOS_EDGE_ENEMY);
  const beforeFriendToPlayer = getDemosRelationToPlayerSlot(state, 2)?.relation ?? 0;
  const beforeEnemyToPlayer = getDemosRelationToPlayerSlot(state, 3)?.relation ?? 0;

  applyDemosRelationDelta(state, 1, { targetKind: 'player' }, -10, { reasonTag: 'hit_test' });

  assert.equal((getDemosRelationToPlayerSlot(state, 2)?.relation ?? 0) - beforeFriendToPlayer, -10);
  assert.equal((getDemosRelationToPlayerSlot(state, 3)?.relation ?? 0) - beforeEnemyToPlayer, 10);

  clearDemosNpcSocialEdges(state, 2);
  setDemosSocialEdge(state, 1, 2, DEMOS_RELATION_MAX, DEMOS_EDGE_FRIEND);
  applyDemosRelationDelta(state, 1, { targetKind: 'alife', targetAlifeId: 4 }, -12, { reasonTag: 'npc_target_test' });

  assert.equal(getDemosNpcOnlySocialEdges(state, 2).find(edge => edge.targetAlifeId === 4)?.relation, -12);
});

test('Demos child records receive parent edges from controlled family state', () => {
  const state = stateWithPopulation(606, 4, [
    { name: 'Ребенок Демоса', occupation: Occupation.CHILD, age: 10, familyId: 77, faction: Faction.CITIZEN },
    { name: 'Родитель один', occupation: Occupation.DOCTOR, age: 34, familyId: 77, faction: Faction.CITIZEN },
    { name: 'Родитель два', occupation: Occupation.MECHANIC, age: 36, familyId: 77, faction: Faction.CITIZEN },
    { name: 'Сосед', occupation: Occupation.COOK, familyId: 88, faction: Faction.CITIZEN },
  ]);

  const childEdges = getDemosNpcOnlySocialEdges(state, 1);
  const parentEdges = childEdges.filter(edge => edge.role === DemosSocialRoleId.PARENT);
  assert.ok(parentEdges.length >= 1);
  assert.ok(parentEdges.some(edge => edge.targetAlifeId === 2 || edge.targetAlifeId === 3));
  assert.ok(getDemosNpcOnlySocialEdges(state, 2).some(edge => edge.targetAlifeId === 1 && edge.role === DemosSocialRoleId.CHILD));
});

test('Demos social parent candidates use age instead of occupation label', () => {
  const state = stateWithPopulation(616, 3, [
    { name: 'Младший', occupation: Occupation.CHILD, age: 11, familyId: 78, faction: Faction.CITIZEN },
    { name: 'Старший с детской меткой', occupation: Occupation.CHILD, age: 19, familyId: 78, faction: Faction.CITIZEN },
    { name: 'Взрослый механик', occupation: Occupation.MECHANIC, age: 40, familyId: 78, faction: Faction.CITIZEN },
  ]);

  const parentEdges = getDemosNpcOnlySocialEdges(state, 1).filter(edge => edge.role === DemosSocialRoleId.PARENT);
  assert.ok(parentEdges.some(edge => edge.targetAlifeId === 2));
  assert.ok(parentEdges.some(edge => edge.targetAlifeId === 3));
});

test('Demos dead family targets remain returnable as visible history edges', () => {
  const state = stateWithPopulation(707, 2, [
    { name: 'Ребенок с записью', occupation: Occupation.CHILD, age: 8, familyId: 91, faction: Faction.CITIZEN },
    { name: 'Мертвый родитель', occupation: Occupation.DOCTOR, age: 41, familyId: 91, faction: Faction.CITIZEN },
  ]);
  recordAlifeNpcDeath(state, deadAlifeEntity(2));

  const parent = getDemosNpcOnlySocialEdges(state, 1).find(edge => edge.targetAlifeId === 2);
  assert.ok(parent);
  assert.equal(parent.role, DemosSocialRoleId.PARENT);
  assert.equal(parent.hidden, false);
});

test('Demos social graph applies optional authored plot relations', () => {
  const state = stateWithPopulation(909, 7, [
    { kind: 'plot', plotNpcId: 'olga', name: 'Ольга Дмитриевна', faction: Faction.SCIENTIST, occupation: Occupation.DOCTOR },
    { kind: 'plot', plotNpcId: 'yakov', name: 'Яков Давидович', faction: Faction.SCIENTIST, occupation: Occupation.SCIENTIST },
    { kind: 'plot', plotNpcId: 'barni', name: 'Сержант Баринов', faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER },
    { kind: 'plot', plotNpcId: 'vanka', name: 'Ванька Банчиный', faction: Faction.CULTIST, occupation: Occupation.ALCOHOLIC },
    { kind: 'plot', plotNpcId: 'major_grom', name: 'Майор Громный', faction: Faction.LIQUIDATOR, occupation: Occupation.HUNTER },
    { kind: 'plot', plotNpcId: 'rotenbergov', name: 'Министр Ротенбергов', faction: Faction.CITIZEN, occupation: Occupation.DIRECTOR },
    { kind: 'plot', plotNpcId: 'f69_accountant_nil', name: 'Нил Расписочный', faction: Faction.CITIZEN, occupation: Occupation.STOREKEEPER },
  ]);

  const olgaToYakov = getDemosNpcOnlySocialEdges(state, 1).find(edge => edge.targetAlifeId === 2);
  const yakovToOlga = getDemosNpcOnlySocialEdges(state, 2).find(edge => edge.targetAlifeId === 1);
  const barniToOlga = getDemosNpcOnlySocialEdges(state, 3).find(edge => edge.targetAlifeId === 1);
  const vankaToYakov = getDemosNpcOnlySocialEdges(state, 4).find(edge => edge.targetAlifeId === 2);
  const gromToYakov = getDemosNpcOnlySocialEdges(state, 5).find(edge => edge.targetAlifeId === 2);
  const rotenbergovToNil = getDemosNpcOnlySocialEdges(state, 6).find(edge => edge.targetAlifeId === 7);

  assert.equal(olgaToYakov?.role, DemosSocialRoleId.FRIEND);
  assert.equal(olgaToYakov?.relation, 88);
  assert.equal((yakovToOlga?.flags ?? 0) & DEMOS_EDGE_FRIEND, DEMOS_EDGE_FRIEND);
  assert.equal(barniToOlga?.role, DemosSocialRoleId.PARTNER);
  assert.equal(vankaToYakov?.role, DemosSocialRoleId.ACQUAINTANCE);
  assert.equal(gromToYakov?.role, DemosSocialRoleId.ACQUAINTANCE);
  assert.equal(rotenbergovToNil?.role, DemosSocialRoleId.ENEMY);
  assert.equal((rotenbergovToNil?.flags ?? 0) & DEMOS_EDGE_ENEMY, DEMOS_EDGE_ENEMY);
  assert.equal((rotenbergovToNil?.flags ?? 0) & DEMOS_EDGE_DEBT, DEMOS_EDGE_DEBT);
});

test('Demos package-authored links resolve package ids to A-Life ids', () => {
  registerNpcPackages([
    demosPackage('demos_social_source', 'Источник Демоса', {
      links: [{
        targetNpcId: 'demos_social_target',
        relation: 91,
        role: DemosSocialRoleId.FRIEND,
        flags: ['friend', 'work'],
      }],
    }),
    demosPackage('demos_social_target', 'Цель Демоса'),
  ]);
  const state = stateWithPopulation(919, 4, [
    { id: 'npc:demos_social_source', kind: 'authored', name: 'Источник Демоса', faction: Faction.CITIZEN },
    { id: 'npc:demos_social_target', kind: 'authored', name: 'Цель Демоса', faction: Faction.CITIZEN },
  ]);

  const edge = getDemosNpcOnlySocialEdges(state, 1).find(item => item.targetAlifeId === 2);
  assert.equal(edge?.relation, 91);
  assert.equal(edge?.role, DemosSocialRoleId.FRIEND);
  assert.equal((edge?.flags ?? 0) & DEMOS_EDGE_FRIEND, DEMOS_EDGE_FRIEND);
  assert.equal((edge?.flags ?? 0) & DEMOS_EDGE_WORK, DEMOS_EDGE_WORK);
});

test('Demos bidirectional package link compiles into two directed edges without duplicates', () => {
  registerNpcPackages([
    demosPackage('demos_bidir_a', 'Первый Бидир', {
      links: [{
        targetNpcId: 'demos_bidir_b',
        relation: 74,
        role: DemosSocialRoleId.WORK,
        flags: ['work'],
        bidirectional: true,
      }],
    }),
    demosPackage('demos_bidir_b', 'Второй Бидир'),
  ]);
  const state = stateWithPopulation(929, 4, [
    { id: 'npc:demos_bidir_a', kind: 'authored', name: 'Первый Бидир', faction: Faction.CITIZEN },
    { id: 'npc:demos_bidir_b', kind: 'authored', name: 'Второй Бидир', faction: Faction.CITIZEN },
  ]);

  const aToB = getDemosNpcOnlySocialEdges(state, 1).filter(item => item.targetAlifeId === 2);
  const bToA = getDemosNpcOnlySocialEdges(state, 2).filter(item => item.targetAlifeId === 1);
  assert.equal(aToB.length, 1);
  assert.equal(bToA.length, 1);
  assert.equal(aToB[0].relation, 74);
  assert.equal(bToA[0].relation, 74);
  assert.equal(aToB[0].role, DemosSocialRoleId.WORK);
  assert.equal(bToA[0].role, DemosSocialRoleId.WORK);
});

test('Demos sparse saved relation override wins over package base relation', () => {
  registerNpcPackages([
    demosPackage('demos_override_a', 'Оверрайд Первый', {
      links: [{
        targetNpcId: 'demos_override_b',
        relation: 100,
        role: DemosSocialRoleId.FRIEND,
        flags: ['friend'],
      }],
    }),
    demosPackage('demos_override_b', 'Оверрайд Второй'),
  ]);
  const state = stateWithPopulation(939, 4, [
    { id: 'npc:demos_override_a', kind: 'authored', name: 'Оверрайд Первый', faction: Faction.CITIZEN },
    { id: 'npc:demos_override_b', kind: 'authored', name: 'Оверрайд Второй', faction: Faction.CITIZEN },
  ]);
  (state as GameState & { demosSocial: ReturnType<typeof createEmptyDemosSocialSaveState> }).demosSocial = {
    ...createEmptyDemosSocialSaveState(),
    relationOverrides: [{
      fromAlifeId: 1,
      targetKind: 'alife',
      targetAlifeId: 2,
      value: -77,
      reasonTag: 'test_override',
    }],
  };

  const edge = getDemosNpcOnlySocialEdges(state, 1).find(item => item.targetAlifeId === 2);
  assert.equal(edge?.relation, -77);
  assert.equal(edge?.role, DemosSocialRoleId.ENEMY);
});

test('Demos package social links keep one-profile views lazy for large pools', () => {
  registerNpcPackages([
    demosPackage('demos_lazy_a', 'Ленивый Первый', {
      links: [{
        targetNpcId: 'demos_lazy_b',
        relation: 70,
        role: DemosSocialRoleId.FRIEND,
        flags: ['friend'],
      }],
    }),
    demosPackage('demos_lazy_b', 'Ленивый Второй'),
  ]);
  const state = stateWithPopulation(949, 100_000, [
    { id: 'npc:demos_lazy_a', kind: 'authored', name: 'Ленивый Первый', faction: Faction.CITIZEN },
    { id: 'npc:demos_lazy_b', kind: 'authored', name: 'Ленивый Второй', faction: Faction.CITIZEN },
  ]);

  const edge = getDemosNpcOnlySocialEdges(state, 1).find(item => item.targetAlifeId === 2);
  const graph = (state as GameState & { demosSocialGraph: { builtAll: boolean; initialized: Uint8Array } }).demosSocialGraph;
  assert.equal(edge?.relation, 70);
  assert.equal(graph.builtAll, false);
  assert.equal(graph.initialized[1], 1);
  assert.equal(graph.initialized[99999], 0);
});

test('Demos social stats report byte storage under seven megabytes for 100k records', () => {
  const stats = getDemosSocialGraphStats(stateWithPopulation(808, 100_000));
  assert.equal(stats.totalRecords, 100_000);
  assert.equal(stats.npcSlots, DEMOS_SOCIAL_NPC_SLOTS);
  assert.equal(stats.heapBytesApprox, 100_000 * DEMOS_SOCIAL_PUBLIC_SLOTS * 7);
  assert.ok(stats.heapBytesApprox < 7 * 1024 * 1024);
});
