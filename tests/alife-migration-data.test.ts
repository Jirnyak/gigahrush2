import test from 'node:test';
import assert from 'node:assert/strict';

import { Faction, FloorLevel, Occupation } from '../src/core/types';
import {
  ALIFE_POPULATION_BASELINE,
  ALIFE_POPULATION_CAPACITY,
  ALIFE_POPULATION_JITTER,
  buildAlifePopulationPlan,
  validateAlifePopulationPlan,
} from '../src/data/alife_population_plan';
import { validateAlifeMigrationProfiles } from '../src/data/alife_migration';
import {
  floorKeyAllowsNpcs,
  floorKeyBaseFloor,
  floorKeyKnown,
  floorKeyZ,
} from '../src/data/floor_keys';
import {
  DESIGN_FLOOR_ROUTES,
} from '../src/data/design_floors';
import {
  PROCEDURAL_FLOOR_ZS,
  makeProceduralFloorSpec,
} from '../src/data/procedural_floors';
import type { NpcPackageDef } from '../src/data/npc_packages';
import '../src/gen/design_floors/floor_69';
import '../src/gen/hell/madoka';
import '../src/gen/maintenance/gordon';
import '../src/gen/ministry/npcs';

function routeKeysForRun(runSeed: number): string[] {
  return [
    'story:ministry',
    'story:kvartiry',
    'story:living',
    'story:maintenance',
    'story:hell',
    'story:void',
    ...DESIGN_FLOOR_ROUTES.map(route => `design:${route.id}`),
    ...PROCEDURAL_FLOOR_ZS.map(z => `procedural:z${z}`),
  ];
}

function testNpcPackage(id: string, patch: Partial<NpcPackageDef> = {}): NpcPackageDef {
  const base: NpcPackageDef = {
    version: 1,
    id,
    kind: 'design',
    identity: { firstName: 'Test', displayName: `Test ${id}` },
    demographics: { sex: 'female', age: 33 },
    affiliation: { faction: Faction.CITIZEN, occupation: Occupation.TRAVELER },
    rpg: { level: 7 },
    wealth: { cashRubles: 42, accountRubles: 1000 },
    visual: { sprite: Occupation.TRAVELER, npcVisualId: 'test_visual' },
    placement: { homeFloorKey: 'story:living', presence: 'population' },
    runtime: { hp: 123, maxHp: 150, canGiveQuest: true },
    tags: ['test_pkg'],
  };
  return {
    ...base,
    ...patch,
    identity: { ...base.identity, ...(patch.identity ?? {}) },
    demographics: { ...base.demographics, ...(patch.demographics ?? {}) },
    affiliation: { ...base.affiliation, ...(patch.affiliation ?? {}) },
    rpg: { ...base.rpg, ...(patch.rpg ?? {}) },
    wealth: { ...base.wealth, ...(patch.wealth ?? {}) },
    visual: { ...base.visual, ...(patch.visual ?? {}) },
    placement: { ...base.placement, ...(patch.placement ?? {}) },
    runtime: { ...base.runtime, ...(patch.runtime ?? {}) },
    ...(patch.content ? { content: patch.content } : {}),
    ...(patch.editor ? { editor: patch.editor } : {}),
    ...(patch.tags ? { tags: patch.tags } : {}),
  };
}

test('A-Life population plan validates and allocates the run-sized budget', () => {
  const runSeed = 24680;
  const plan = buildAlifePopulationPlan({
    runSeed,
    routeKeys: routeKeysForRun(runSeed),
    proceduralSpecs: PROCEDURAL_FLOOR_ZS.map(z => makeProceduralFloorSpec(runSeed, z)),
  });

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.ok(plan.total >= ALIFE_POPULATION_BASELINE - ALIFE_POPULATION_JITTER);
  assert.ok(plan.total <= ALIFE_POPULATION_CAPACITY);
  assert.equal(plan.version, 1);
  const ordinary = plan.buckets.reduce((sum, bucket) => sum + bucket.targetCount, 0);
  assert.equal(ordinary + plan.reserved.length, plan.total);
  assert.equal(new Set(plan.buckets.map(bucket => bucket.floorKey)).size, plan.buckets.length);
  assert.equal(new Set(plan.reserved.map(identity => identity.plotNpcId).filter(Boolean)).size, plan.reserved.filter(identity => identity.plotNpcId).length);
});

test('A-Life population plan uses seed-sized totals below technical capacity', () => {
  const totals = new Set<number>();
  for (const runSeed of [1, 2, 3, 4, 5, 13579, 24680]) {
    const plan = buildAlifePopulationPlan({
      runSeed,
      routeKeys: routeKeysForRun(runSeed),
      proceduralSpecs: PROCEDURAL_FLOOR_ZS.map(z => makeProceduralFloorSpec(runSeed, z)),
    });
    assert.ok(plan.total >= ALIFE_POPULATION_BASELINE - ALIFE_POPULATION_JITTER);
    assert.ok(plan.total <= ALIFE_POPULATION_CAPACITY);
    totals.add(plan.total);
  }
  assert.ok(totals.size > 1, 'run seed should change actual A-Life population total');
});

test('A-Life population plan keeps authored floor taste and NPC-free route stops explicit', () => {
  const runSeed = 13579;
  const plan = buildAlifePopulationPlan({
    runSeed,
    routeKeys: routeKeysForRun(runSeed),
    proceduralSpecs: PROCEDURAL_FLOOR_ZS.map(z => makeProceduralFloorSpec(runSeed, z)),
  });
  const byKey = new Map(plan.buckets.map(bucket => [bucket.floorKey, bucket]));

  assert.ok((byKey.get('design:floor_69')?.targetCount ?? 0) > 0);
  assert.ok(byKey.get('design:floor_69')?.tags.includes('floor_69'));
  assert.ok((byKey.get('design:black_market_88')?.targetCount ?? 0) > 0);
  assert.ok(byKey.get('design:black_market_88')?.tags.includes('black_market_88'));
  assert.ok((byKey.get('design:slime_nii')?.targetCount ?? 0) > 0);
  assert.ok(byKey.get('design:slime_nii')?.tags.includes('slime_nii'));
  assert.ok((byKey.get('story:ministry')?.targetCount ?? 0) > 0);
  assert.equal(byKey.get('story:void')?.targetCount, 0);
  assert.equal(byKey.get('design:darkness')?.targetCount, 0);

  const lowerProcedural = [...byKey.values()].filter(bucket =>
    bucket.floorKey.startsWith('procedural:') &&
    bucket.baseFloor !== FloorLevel.VOID &&
    bucket.tags.some(tag => tag === 'route_pressure' || tag === 'industrial' || tag === 'samosbor' || tag === 'cult')
  );
  assert.ok(lowerProcedural.length > 0, 'lower procedural route groups should be represented by tagged buckets');
});

test('A-Life population plan projects one runtime NPC package into one reserved identity', () => {
  const pack = testNpcPackage('reservation_package_fixture', {
    identity: { displayName: 'Package Resident' },
    demographics: { sex: 'male', age: 41 },
    affiliation: { faction: Faction.SCIENTIST, occupation: Occupation.SCIENTIST, familyId: 77 },
    rpg: { level: 12 },
    wealth: { cashRubles: 700, accountRubles: 9000 },
    runtime: { hp: 250, maxHp: 300, canGiveQuest: false },
    social: { playerRelation: 20, karma: 5 },
    tags: ['package_test'],
  });
  const plan = buildAlifePopulationPlan({
    runSeed: 777,
    routeKeys: ['story:living'],
    total: 16,
    npcPackages: [pack],
  });
  const reserved = plan.reserved[0];

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.equal(plan.reserved.length, 1);
  assert.equal(reserved.id, 'npc:reservation_package_fixture');
  assert.equal(reserved.kind, 'authored');
  assert.equal(reserved.floorKey, 'story:living');
  assert.equal(reserved.name, 'Package Resident');
  assert.equal(reserved.sex, 'male');
  assert.equal(reserved.age, 41);
  assert.equal(reserved.faction, Faction.SCIENTIST);
  assert.equal(reserved.occupation, Occupation.SCIENTIST);
  assert.equal(reserved.familyId, 77);
  assert.equal(reserved.level, 12);
  assert.equal(reserved.hp, 250);
  assert.equal(reserved.maxHp, 300);
  assert.equal(reserved.money, 700);
  assert.equal(reserved.accountRubles, 9000);
  assert.equal(reserved.canGiveQuest, false);
  assert.equal(reserved.playerRelation, 20);
  assert.equal(reserved.karma, 5);
  assert.equal(plan.buckets.reduce((sum, bucket) => sum + bucket.targetCount, 0) + plan.reserved.length, plan.total);
});

test('A-Life population plan dedupes package rows by plotNpcId', () => {
  const source = testNpcPackage('package_olga_source', {
    kind: 'plot',
    identity: { displayName: 'Package Olga' },
    content: { plotNpcId: 'olga' },
    tags: ['plot'],
  });
  const duplicateRawCompat = testNpcPackage('package_olga_duplicate', {
    kind: 'plot',
    identity: { displayName: 'Raw Olga Compatibility' },
    content: { plotNpcId: 'olga' },
    tags: ['plot'],
  });
  const plan = buildAlifePopulationPlan({
    runSeed: 778,
    routeKeys: ['story:living'],
    total: 16,
    npcPackages: [source, duplicateRawCompat],
  });
  const olgaRows = plan.reserved.filter(identity => identity.plotNpcId === 'olga');

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.equal(olgaRows.length, 1);
  assert.equal(olgaRows[0].id, 'npc:package_olga_source');
});

test('A-Life population plan does not synthesize reservations without NPC packages', () => {
  const legacyId = 'package_less_alife_fixture';
  const plan = buildAlifePopulationPlan({
    runSeed: 779,
    routeKeys: ['story:living'],
    total: 16,
  });

  assert.equal(plan.reserved.some(identity => identity.plotNpcId === legacyId), false);
});

test('A-Life population plan reserves design packages on design route keys', () => {
  const pack = testNpcPackage('floor69_authored_package', {
    kind: 'design',
    placement: { homeFloorKey: 'design:floor_69', presence: 'anchor' },
    tags: ['floor_69'],
  });
  const plan = buildAlifePopulationPlan({
    runSeed: 779,
    routeKeys: ['design:floor_69'],
    total: 2,
    npcPackages: [pack],
  });
  const reserved = plan.reserved[0];

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.equal(plan.reserved.length, 1);
  assert.equal(reserved.id, 'npc:floor69_authored_package');
  assert.equal(reserved.kind, 'authored');
  assert.equal(reserved.floorKey, 'design:floor_69');
});

test('A-Life population plan keeps event-only reservations on route-allowed NPC-free floors', () => {
  const pack = testNpcPackage('void_event_package', {
    kind: 'design',
    placement: { homeFloorKey: 'story:void', presence: 'event_only' },
    tags: ['void_event'],
  });
  const plan = buildAlifePopulationPlan({
    runSeed: 780,
    routeKeys: ['story:void'],
    total: 1,
    npcPackages: [pack],
  });
  const blockedByRoute = buildAlifePopulationPlan({
    runSeed: 780,
    routeKeys: ['story:living'],
    total: 4,
    npcPackages: [pack],
  });

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.equal(plan.buckets.find(bucket => bucket.floorKey === 'story:void')?.targetCount, 0);
  assert.equal(plan.reserved.length, 1);
  assert.equal(plan.reserved[0].kind, 'event_reserved');
  assert.equal(plan.reserved[0].presence, 'event_only');
  assert.deepEqual(validateAlifePopulationPlan(blockedByRoute), []);
  assert.equal(blockedByRoute.reserved.length, 0);
});

test('A-Life population plan skips non-runtime and unreviewed community packages', () => {
  const nonRuntime = testNpcPackage('skip_non_runtime_package', {
    runtime: { reserveInAlife: false },
  });
  const communityDraft = testNpcPackage('skip_community_draft_package', {
    editor: { source: 'community', reviewStatus: 'draft' },
    tags: ['community'],
  });
  const plan = buildAlifePopulationPlan({
    runSeed: 781,
    routeKeys: ['story:living'],
    total: 8,
    npcPackages: [nonRuntime, communityDraft],
  });

  assert.deepEqual(validateAlifePopulationPlan(plan), []);
  assert.equal(plan.reserved.length, 0);
  assert.equal(plan.buckets.reduce((sum, bucket) => sum + bucket.targetCount, 0), plan.total);
});

test('A-Life population plan resolves authored NPC floor keys from their content packages', () => {
  const runSeed = 86420;
  const plan = buildAlifePopulationPlan({
    runSeed,
    routeKeys: routeKeysForRun(runSeed),
    proceduralSpecs: PROCEDURAL_FLOOR_ZS.map(z => makeProceduralFloorSpec(runSeed, z)),
  });
  const reserved = new Map(plan.reserved.map(identity => [identity.plotNpcId, identity]));

  assert.equal(reserved.get('gordon_freeman')?.floorKey, 'story:maintenance');
  assert.equal(reserved.get('gordon_freeman')?.age, 28);
  assert.equal(reserved.get('gordon_freeman')?.sex, 'male');
  assert.equal(reserved.get('meduka_meguku')?.floorKey, 'story:hell');
  assert.equal(reserved.get('meduka_meguku')?.age, 14);
  assert.equal(reserved.get('meduka_meguku')?.sex, 'female');
  assert.equal(reserved.get('f69_performer_ira')?.floorKey, 'design:floor_69');
  assert.equal(reserved.get('f69_performer_ira')?.age, 22);
  assert.equal(reserved.get('f69_performer_ira')?.sex, 'female');
  assert.equal(reserved.get('rotenbergov')?.floorKey, 'story:ministry');
  assert.equal(reserved.get('rotenbergov')?.age, 70);
  assert.equal(reserved.get('rotenbergov')?.sex, 'male');
  assert.equal(reserved.get('rotenbergov')?.money, 10_000);
  assert.equal(reserved.get('rotenbergov')?.accountRubles, 4_990_000);
  assert.equal(reserved.get('rotenbergov')?.hp, 3000);
  assert.equal(reserved.get('rotenbergov')?.maxHp, 3000);
  assert.equal(reserved.get('yakov')?.level, 10);
  assert.equal(reserved.get('yakov')?.hp, 800);
  assert.equal(reserved.get('yakov')?.maxHp, 800);
  assert.equal(reserved.get('vanka')?.level, 2);
  assert.equal(reserved.get('vanka')?.hp, 300);
});

test('A-Life migration profiles validate statically', () => {
  assert.deepEqual(validateAlifeMigrationProfiles(), []);
});

test('shared floor key resolver covers story, design and procedural A-Life keys', () => {
  assert.equal(floorKeyKnown('story:living'), true);
  assert.equal(floorKeyZ('story:living'), 0);
  assert.equal(floorKeyBaseFloor('story:living'), FloorLevel.LIVING);
  assert.equal(floorKeyAllowsNpcs('story:void'), false);

  assert.equal(floorKeyKnown('design:floor_69'), true);
  assert.equal(floorKeyBaseFloor('design:floor_69'), FloorLevel.MAINTENANCE);

  const proceduralZ = PROCEDURAL_FLOOR_ZS[0];
  assert.equal(floorKeyKnown(`procedural:z${proceduralZ}`), true);
  assert.equal(floorKeyZ(`procedural:z${proceduralZ}`), proceduralZ);
});
