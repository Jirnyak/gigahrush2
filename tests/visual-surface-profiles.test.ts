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
  PROCEDURAL_FLOOR_ZS,
  makeProceduralFloorSpec,
} from '../src/data/procedural_floors';
import {
  VISUAL_SURFACE_CEILING_PATTERN_CODES,
  VISUAL_SURFACE_FLOOR_PATTERN_CODES,
  VISUAL_SURFACE_GEOMETRY_MODES,
  VISUAL_SURFACE_PROFILES,
  VISUAL_SURFACE_PROFILE_ROWS,
  VISUAL_SURFACE_TRIM_CODES,
  VISUAL_SURFACE_WALL_BAND_CODES,
  resolveVisualSurfaceProfile,
  visualSurfaceProfileById,
  type ResolvedVisualSurfaceProfile,
} from '../src/data/visual_surface_profiles';

const ID_RE = /^[a-z][a-z0-9_]*$/;
const VALID_FLOORS = new Set(Object.values(FloorLevel).filter((value): value is FloorLevel => typeof value === 'number'));
const VALID_ROOMS = new Set(Object.values(RoomType).filter((value): value is RoomType => typeof value === 'number'));
const VALID_ROUTE_IDS = new Set(DESIGN_FLOOR_ROUTES.map(route => route.id));
const VALID_PROFILE_IDS = new Set(VISUAL_SURFACE_PROFILES.map(profile => profile.id));
const KNOWN_TAGS = new Set<string>([
  ...Object.values(FloorLevel).filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()),
  ...DESIGN_FLOOR_ROUTES.map(route => route.id),
  'admin',
  'archive',
  'civil',
  'cult',
  'deep_route',
  'documents',
  'industrial',
  'lab',
  'maintenance',
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

function assertResolved(profile: ResolvedVisualSurfaceProfile, label: string): void {
  assert.match(profile.id, ID_RE, `${label} id must stay snake_case`);
  assert.equal(Number.isInteger(profile.seed), true, `${label} seed must be integer`);
  assert.ok(profile.seed >= 0 && profile.seed <= 0xffff, `${label} seed must stay compact`);
  for (const key of ['grime', 'seamStrength', 'lightPanelChance', 'ventChance'] as const) {
    assert.equal(Number.isFinite(profile[key]), true, `${label}.${key} must be finite`);
    assert.ok(profile[key] >= 0 && profile[key] <= 1, `${label}.${key} must be in 0..1`);
  }
  assert.equal(profile.floorPatternCode, VISUAL_SURFACE_FLOOR_PATTERN_CODES[profile.floorPattern]);
  assert.equal(profile.wallBandCode, VISUAL_SURFACE_WALL_BAND_CODES[profile.wallBand]);
  assert.equal(profile.ceilingPatternCode, VISUAL_SURFACE_CEILING_PATTERN_CODES[profile.ceilingPattern]);
  assert.equal(profile.trimCode, VISUAL_SURFACE_TRIM_CODES[profile.trim]);
  assert.equal(profile.surfaceMaterialsEnabled, true, `${label} base raycaster materials should remain enabled`);
}

test('visual surface profiles are unique bounded data rows', () => {
  assertUnique(VISUAL_SURFACE_PROFILES.map(profile => profile.id), 'visual surface profile');
  assertUnique(VISUAL_SURFACE_PROFILE_ROWS.map(row => row.id), 'visual surface row');

  for (const profile of VISUAL_SURFACE_PROFILES) {
    assert.match(profile.id, ID_RE);
    assert.equal(profile.floorPattern in VISUAL_SURFACE_FLOOR_PATTERN_CODES, true, `${profile.id} floor pattern code missing`);
    assert.equal(profile.wallBand in VISUAL_SURFACE_WALL_BAND_CODES, true, `${profile.id} wall band code missing`);
    assert.equal(profile.ceilingPattern in VISUAL_SURFACE_CEILING_PATTERN_CODES, true, `${profile.id} ceiling code missing`);
    assert.equal(profile.trim in VISUAL_SURFACE_TRIM_CODES, true, `${profile.id} trim code missing`);
    for (const value of [profile.grime, profile.seamStrength, profile.lightPanelChance, profile.ventChance]) {
      assert.ok(value >= 0 && value <= 1, `${profile.id} numeric profile values must be normalized`);
    }
  }

  for (const row of VISUAL_SURFACE_PROFILE_ROWS) {
    assert.match(row.id, ID_RE);
    assert.equal(VALID_PROFILE_IDS.has(row.profileId), true, `${row.id} references missing profile ${row.profileId}`);
    assert.equal(Number.isFinite(row.priority), true, `${row.id} priority must be finite`);
    for (const floor of row.baseFloors ?? []) assert.equal(VALID_FLOORS.has(floor), true, `${row.id} invalid floor`);
    for (const room of row.roomTypes ?? []) assert.equal(VALID_ROOMS.has(room), true, `${row.id} invalid room`);
    for (const routeId of row.routeIds ?? []) assert.equal(VALID_ROUTE_IDS.has(routeId), true, `${row.id} invalid route`);
    for (const tex of [...(row.wallTex ?? []), ...(row.floorTex ?? [])]) assert.ok(Number.isInteger(tex) && tex >= 0 && tex < Tex.COUNT, `${row.id} invalid tex`);
    for (const tag of [...(row.requiredTags ?? []), ...(row.blockedTags ?? [])]) assert.ok(KNOWN_TAGS.has(tag), `${row.id} unknown tag ${tag}`);
  }
});

test('visual surface resolver is deterministic and mode bounded', () => {
  const theme = themeForStoryFloor(FloorLevel.LIVING);
  const a = resolveVisualSurfaceProfile(theme, { seed: 111, roomId: 9, roomType: RoomType.BATHROOM });
  const b = resolveVisualSurfaceProfile(theme, { seed: 111, roomId: 9, roomType: RoomType.BATHROOM });
  const c = resolveVisualSurfaceProfile(theme, { seed: 112, roomId: 9, roomType: RoomType.BATHROOM });
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, c.seed);
  assert.equal(a.id, 'residential_tile');

  for (const mode of VISUAL_SURFACE_GEOMETRY_MODES) {
    const resolved = resolveVisualSurfaceProfile(theme, { seed: 5, geometryMode: mode });
    assertResolved(resolved, mode);
    if (mode === 'off' || mode === 'low') {
      assert.equal(resolved.protrudingDressing, false, `${mode} should be able to skip expensive protruding dressing`);
      assert.equal(resolved.surfaceMaterialsEnabled, true, `${mode} should keep raycaster materials`);
    }
  }
});

test('current floor themes resolve finite visual surface profiles', () => {
  for (const floor of VALID_FLOORS) {
    assertResolved(resolveVisualSurfaceProfile(themeForStoryFloor(floor), { seed: 1001 }), `story:${FloorLevel[floor]}`);
  }
  for (const route of DESIGN_FLOOR_ROUTES) {
    assertResolved(resolveVisualSurfaceProfile(themeForDesignRoute(route), { seed: 1002 }), `design:${route.id}`);
  }
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const spec = makeProceduralFloorSpec(1003, z);
    assertResolved(resolveVisualSurfaceProfile(themeForProceduralSpec(spec), { seed: spec.seed }), `procedural:${spec.key}`);
  }
});

test('texture and room context select authored surface families without room names', () => {
  const theme = themeForStoryFloor(FloorLevel.KVARTIRY);
  assert.equal(resolveVisualSurfaceProfile(theme, { floorTex: Tex.F_TILE }).id, 'residential_tile');
  assert.equal(resolveVisualSurfaceProfile(theme, { wallTex: Tex.PIPE }).id, 'maintenance_service');
  assert.equal(resolveVisualSurfaceProfile(theme, { roomType: RoomType.PRODUCTION }).id, 'maintenance_service');
  assert.equal(visualSurfaceProfileById('ministry_checker')?.floorPattern, 'checker');
});
