import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FloorLevel, RoomType, Tex } from '../src/core/types';
import { DESIGN_FLOOR_ROUTES } from '../src/data/design_floors';
import {
  themeForDesignRoute,
  themeForProceduralSpec,
  themeForStoryFloor,
} from '../src/data/floor_theme_profiles';
import {
  FLOOR_ANOMALIES,
  FLOOR_GEOMETRIES,
  FLOOR_MAJORITY_FACTIONS,
  PROCEDURAL_FLOOR_ZS,
  makeProceduralFloorSpec,
} from '../src/data/procedural_floors';
import {
  VISUAL_DETAIL_FAMILY_CODES,
  VISUAL_DETAIL_LIGHT_DUST_DENSITY_CAP,
  VISUAL_DETAIL_MAX_ACTIVE_FAMILIES,
  VISUAL_DETAIL_MAX_FLOOR_FAMILIES,
  VISUAL_DETAIL_MAX_WALL_FAMILIES,
  VISUAL_DETAIL_PROFILE_ROWS,
  VISUAL_DETAIL_RULES,
  resolveVisualDetailProfile,
  type ResolvedVisualDetailProfile,
} from '../src/data/visual_detail_profiles';

const ID_RE = /^[a-z][a-z0-9_]*$/;
const VALID_ROOM_TYPES = new Set(Object.values(RoomType).filter((value): value is number => typeof value === 'number'));
const VALID_FLOORS = new Set(Object.values(FloorLevel).filter((value): value is number => typeof value === 'number'));
const VALID_ROUTE_IDS = new Set(DESIGN_FLOOR_ROUTES.map(route => route.id));
const VALID_RULE_IDS = new Set(VISUAL_DETAIL_RULES.map(rule => rule.id));
const VALID_SURFACES = new Set(['floor', 'wall', 'ceiling', 'light_volume']);
const KNOWN_TAGS = new Set<string>([
  ...Object.values(FloorLevel).filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()),
  ...DESIGN_FLOOR_ROUTES.map(route => route.id),
  ...FLOOR_GEOMETRIES.flatMap(def => def.tags),
  ...FLOOR_MAJORITY_FACTIONS.flatMap(def => def.tags),
  ...FLOOR_ANOMALIES.flatMap(def => def.tags),
  'admin',
  'archive',
  'civil',
  'cult',
  'documents',
  'industrial',
  'lab',
  'meat',
  'proof',
  'quarantine',
  'residential',
  'samosbor',
  'slime',
  'sump',
  'void',
  'water',
]);

function assertUnique(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    assert.equal(seen.has(id), false, `${label} duplicate id: ${id}`);
    seen.add(id);
  }
}

function assertProfileCaps(profile: ResolvedVisualDetailProfile, label: string): void {
  assert.ok(profile.activeFamilies.length <= VISUAL_DETAIL_MAX_ACTIVE_FAMILIES, `${label} exceeds active family cap`);
  assert.ok(profile.floorFamilies.length <= VISUAL_DETAIL_MAX_FLOOR_FAMILIES, `${label} exceeds floor family cap`);
  assert.ok(profile.wallFamilies.length <= VISUAL_DETAIL_MAX_WALL_FAMILIES, `${label} exceeds wall family cap`);
  for (const family of profile.activeFamilies) {
    assert.equal(VALID_RULE_IDS.has(family.id), true, `${label} resolves unknown detail ${family.id}`);
    assert.ok(family.density >= 0 && family.density <= 255, `${label}.${family.id} density is out of byte range`);
    assert.ok(family.scale > 0 && family.scale <= 4, `${label}.${family.id} scale is out of range`);
    assert.ok(family.familyCode > 0, `${label}.${family.id} missing family code`);
  }
  if (profile.lightDust) {
    assert.ok(profile.lightDust.density <= VISUAL_DETAIL_LIGHT_DUST_DENSITY_CAP, `${label} light dust must stay sparse`);
  }
}

function activeIds(profile: ResolvedVisualDetailProfile): Set<string> {
  return new Set(profile.activeFamilies.map(row => row.id));
}

test('visual detail rules are bounded data-only ids', () => {
  assertUnique(VISUAL_DETAIL_RULES.map(rule => rule.id), 'visual detail rule');
  assert.deepEqual(
    Object.keys(VISUAL_DETAIL_FAMILY_CODES).sort(),
    VISUAL_DETAIL_RULES.map(rule => rule.family).sort(),
    'renderer family code table must cover every family id',
  );

  for (const rule of VISUAL_DETAIL_RULES) {
    assert.match(rule.id, ID_RE, `rule id ${rule.id} must stay snake_case`);
    assert.equal(rule.family, rule.id, `${rule.id} should use its core family id`);
    assert.ok(rule.density >= 0 && rule.density <= 255, `${rule.id} density must fit one byte`);
    assert.ok(rule.scale[0] > 0 && rule.scale[0] <= rule.scale[1] && rule.scale[1] <= 4, `${rule.id} scale band is invalid`);
    for (const channel of rule.colorBand) assert.ok(channel >= 0 && channel <= 255, `${rule.id} color channel out of range`);
    for (const surface of rule.surfaces) assert.equal(VALID_SURFACES.has(surface), true, `${rule.id} has invalid surface ${surface}`);
    for (const roomKey of Object.keys(rule.roomTypeWeights ?? {})) {
      assert.equal(VALID_ROOM_TYPES.has(Number(roomKey)), true, `${rule.id} has invalid RoomType weight ${roomKey}`);
    }
    for (const texKey of Object.keys(rule.texWeights ?? {})) {
      const tex = Number(texKey);
      assert.ok(Number.isInteger(tex) && tex >= 0 && tex < Tex.COUNT, `${rule.id} has invalid Tex weight ${texKey}`);
    }
    for (const tag of [...(rule.requiredTags ?? []), ...(rule.blockedTags ?? [])]) {
      assert.ok(KNOWN_TAGS.has(tag), `${rule.id} uses unknown tag ${tag}`);
    }
    if (rule.lightRange) {
      assert.ok(rule.lightRange[0] >= 0 && rule.lightRange[0] <= rule.lightRange[1] && rule.lightRange[1] <= 1, `${rule.id} light range is invalid`);
    }
    assert.ok(Number.isInteger(rule.seedSalt) && rule.seedSalt > 0, `${rule.id} needs positive seed salt`);
  }
});

test('visual detail profile rows reference current route and detail data', () => {
  assertUnique(VISUAL_DETAIL_PROFILE_ROWS.map(row => row.id), 'visual detail row');

  for (const row of VISUAL_DETAIL_PROFILE_ROWS) {
    assert.match(row.id, ID_RE, `row id ${row.id} must stay snake_case`);
    assert.equal(VALID_RULE_IDS.has(row.detailId), true, `${row.id} references missing detail ${row.detailId}`);
    assert.ok(row.density >= 0 && row.density <= 255, `${row.id} density must fit one byte`);
    for (const floor of row.baseFloors ?? []) assert.equal(VALID_FLOORS.has(floor), true, `${row.id} has invalid FloorLevel ${floor}`);
    for (const routeId of row.routeIds ?? []) assert.equal(VALID_ROUTE_IDS.has(routeId), true, `${row.id} references missing route ${routeId}`);
    for (const tag of [...(row.requiredTags ?? []), ...(row.blockedTags ?? [])]) {
      assert.ok(KNOWN_TAGS.has(tag), `${row.id} uses unknown tag ${tag}`);
    }
    if (row.minDanger !== undefined) assert.ok(row.minDanger >= 1 && row.minDanger <= 5, `${row.id} minDanger invalid`);
    if (row.maxDanger !== undefined) assert.ok(row.maxDanger >= 1 && row.maxDanger <= 5, `${row.id} maxDanger invalid`);
    if (row.minAbsZ !== undefined) assert.ok(row.minAbsZ >= 0 && row.minAbsZ <= 50, `${row.id} minAbsZ invalid`);
    if (row.maxAbsZ !== undefined) assert.ok(row.maxAbsZ >= 0 && row.maxAbsZ <= 50, `${row.id} maxAbsZ invalid`);
  }
});

test('all story design and procedural themes resolve bounded visual detail profiles', () => {
  for (const floor of VALID_FLOORS) {
    assertProfileCaps(resolveVisualDetailProfile(themeForStoryFloor(floor), { seed: 1001 }), `story:${FloorLevel[floor]}`);
  }
  for (const route of DESIGN_FLOOR_ROUTES) {
    assertProfileCaps(resolveVisualDetailProfile(themeForDesignRoute(route), { seed: 1002 }), `design:${route.id}`);
  }
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const spec = makeProceduralFloorSpec(1003, z);
    assertProfileCaps(resolveVisualDetailProfile(themeForProceduralSpec(spec), { seed: spec.seed }), `procedural:${spec.key}`);
  }
});

test('visual detail profile resolution is deterministic by floor theme and seed', () => {
  const theme = themeForProceduralSpec(makeProceduralFloorSpec(24680, -33));
  const a = resolveVisualDetailProfile(theme, { seed: 77 });
  const b = resolveVisualDetailProfile(theme, { seed: 77 });
  const c = resolveVisualDetailProfile(theme, { seed: 78 });
  assert.deepEqual(a, b, 'same theme and seed must resolve identically');
  assert.notEqual(a.seed, c.seed, 'seed should affect deterministic shader salt');
});

test('story floor taste defaults stay sparse and distinct', () => {
  const living = activeIds(resolveVisualDetailProfile(themeForStoryFloor(FloorLevel.LIVING), { seed: 1 }));
  assert.equal(living.has('paper_scraps'), true, 'Living should get paper scraps');
  assert.equal(living.has('crumbs'), true, 'Living should get crumbs');
  assert.equal(living.has('floor_dust'), true, 'Living should get household dust');

  const ministry = activeIds(resolveVisualDetailProfile(themeForStoryFloor(FloorLevel.MINISTRY), { seed: 2 }));
  assert.equal(ministry.has('paper_scraps'), true, 'Ministry should get paper scraps');
  assert.equal(ministry.has('wall_cracks'), true, 'Ministry should get cracks');

  const maintenance = activeIds(resolveVisualDetailProfile(themeForStoryFloor(FloorLevel.MAINTENANCE), { seed: 3 }));
  assert.equal(maintenance.has('rust_grit'), true, 'Maintenance should get rust grit');
  assert.equal(maintenance.has('wet_dirt'), true, 'Maintenance should get wet dirt');

  const hell = resolveVisualDetailProfile(themeForStoryFloor(FloorLevel.HELL), { seed: 4 });
  const hellIds = activeIds(hell);
  assert.equal(hellIds.has('bone_crumbs'), true, 'Hell should get bone crumbs');
  assert.equal(hellIds.has('gut_threads'), true, 'Hell should get gut threads');
  assert.ok((hell.activeFamilies.find(row => row.id === 'gut_threads')?.density ?? 0) < 48, 'Hell gut threads must not become red wallpaper');

  const voidProfile = resolveVisualDetailProfile(themeForStoryFloor(FloorLevel.VOID), { seed: 5 });
  const voidIds = activeIds(voidProfile);
  assert.equal(voidIds.has('proof_specks'), true, 'Void should get proof specks');
  assert.equal(voidIds.has('bone_crumbs'), false, 'Void should not drift into gore detail');
  assert.equal(voidIds.has('gut_threads'), false, 'Void should not drift into meat detail');
});
