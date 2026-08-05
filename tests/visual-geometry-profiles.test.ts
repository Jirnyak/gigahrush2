import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FloorLevel } from '../src/core/types';
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
  VISUAL_GEOMETRY_BASE_PROFILES,
  VISUAL_GEOMETRY_MODE_BUDGETS,
  VISUAL_GEOMETRY_MODES,
  VISUAL_GEOMETRY_THEME_MODULATIONS,
  normalizeVisualGeometryMode,
  resolveVisualGeometryProfile,
  visualGeometryThemeTags,
  type ResolvedVisualGeometryProfile,
  type VisualGeometryMode,
} from '../src/data/visual_geometry_profiles';
import {
  VISUAL_CORRIDOR_COVERINGS,
  VISUAL_CORRIDOR_COVERING_RULES,
  type VisualCorridorCoveringId,
} from '../src/data/visual_corridor_coverings';

const ID_RE = /^[a-z][a-z0-9_]*$/;
const VALID_FLOORS = Object.values(FloorLevel).filter((value): value is FloorLevel => typeof value === 'number');
const EXPECTED_RADII: Record<Exclude<VisualGeometryMode, 'off'>, number> = { low: 4, medium: 8, high: 16 };
const EXPECTED_INSTANCE_CAPS: Record<Exclude<VisualGeometryMode, 'off'>, number> = { low: 128, medium: 256, high: 512 };
const EXPECTED_FIELD_RADII: Record<Exclude<VisualGeometryMode, 'off'>, number> = { low: 2, medium: 4, high: 8 };
const EXPECTED_FIELD_CAPS: Record<Exclude<VisualGeometryMode, 'off'>, number> = { low: 16, medium: 32, high: 64 };
const EXPECTED_TRIANGLE_CAPS: Record<Exclude<VisualGeometryMode, 'off'>, number> = { low: 24_000, medium: 48_000, high: 96_000 };

function assertUnique(ids: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    assert.equal(seen.has(id), false, `${label} duplicate id: ${id}`);
    seen.add(id);
  }
}

function assertEnabledCaps(profile: ResolvedVisualGeometryProfile, label: string): void {
  assert.equal(profile.enabled, true, `${label} should be enabled`);
  for (const key of [
    'radius',
    'proceduralFieldRadius',
    'proceduralFieldInstanceCap',
    'chunkSize',
    'maxChunksPerFrame',
    'visualSlotScanCap',
    'visualSlotInstanceCap',
    'visualSlotMergeCap',
    'instanceCap',
    'triangleCap',
    'drawCallCap',
  ] as const) {
    const value = profile[key];
    assert.equal(Number.isFinite(value), true, `${label}.${key} must be finite`);
    assert.equal(value > 0, true, `${label}.${key} must be positive`);
  }
  assert.equal(profile.visualSlotInstanceCap <= profile.instanceCap, true, `${label} visual slot instances must fit instance cap`);
  assert.equal(profile.proceduralFieldInstanceCap <= profile.instanceCap, true, `${label} procedural field cap must fit instance cap`);
  assert.equal(profile.visualSlotMergeCap > 0, true, `${label} merge cap must be enforceable`);
  assert.equal(profile.triangleCap >= profile.instanceCap * 8, true, `${label} triangle cap is too low for instance cap`);
  assert.equal(profile.drawCallCap <= profile.instanceCap, true, `${label} draw calls should remain capped below instances`);
  for (const key of ['ceilingDetail', 'furnitureDetail', 'emissiveDetail'] as const) {
    const value = profile[key];
    assert.equal(Number.isFinite(value), true, `${label}.${key} must be finite`);
    assert.equal(value > 0, true, `${label}.${key} must be positive`);
    assert.equal(value <= 4, true, `${label}.${key} must stay bounded`);
  }
  assert.equal(profile.includeCorridorVolumes, true, `${label} should include corridor volume detail`);
  for (const key of ['corridorVolumeDetail', 'organicVolumeDetail'] as const) {
    const value = profile[key];
    assert.equal(Number.isFinite(value), true, `${label}.${key} must be finite`);
    assert.equal(value >= 0, true, `${label}.${key} must be non-negative`);
    assert.equal(value <= 1, true, `${label}.${key} must stay normalized`);
  }
  assert.equal(['concrete', 'service', 'organic', 'void'].includes(profile.corridorVolumeStyle), true, `${label}.corridorVolumeStyle`);
  assert.equal(VISUAL_CORRIDOR_COVERINGS.some(def => def.id === profile.corridorCoveringId), true, `${label}.corridorCoveringId`);
}

function assertOffCaps(profile: ResolvedVisualGeometryProfile): void {
  assert.equal(profile.mode, 'off');
  assert.equal(profile.enabled, false);
  assert.equal(profile.radius, 0);
  assert.equal(profile.chunkSize, 0);
  assert.equal(profile.maxChunksPerFrame, 0);
  assert.equal(profile.proceduralFieldRadius, 0);
  assert.equal(profile.proceduralFieldInstanceCap, 0);
  assert.equal(profile.visualSlotScanCap, 0);
  assert.equal(profile.visualSlotInstanceCap, 0);
  assert.equal(profile.visualSlotMergeCap, 0);
  assert.equal(profile.instanceCap, 0);
  assert.equal(profile.triangleCap, 0);
  assert.equal(profile.drawCallCap, 0);
  assert.equal(profile.voxelEnabled, false);
  assert.equal(profile.voxelRadius, 0);
  assert.equal(profile.ceilingDetail, 0);
  assert.equal(profile.furnitureDetail, 0);
  assert.equal(profile.emissiveDetail, 0);
  assert.equal(profile.corridorVolumeDetail, 0);
  assert.equal(profile.organicVolumeDetail, 0);
  assert.equal(profile.corridorVolumeStyle, 'concrete');
  assert.equal(profile.corridorCoveringId, 'concrete');
  assert.equal(profile.includeCorridorVolumes, false);
}

test('visual geometry base modes resolve with safe caps', () => {
  const modeIds = VISUAL_GEOMETRY_MODES.map(mode => typeof mode === 'string' ? mode : String((mode as { id: unknown }).id));
  assert.deepEqual(modeIds, ['off', 'low', 'medium', 'high']);
  assert.deepEqual(Object.keys(VISUAL_GEOMETRY_BASE_PROFILES).sort(), [...modeIds].sort());
  assert.equal(normalizeVisualGeometryMode('medium'), 'medium');
  assert.equal(normalizeVisualGeometryMode('bad'), 'high');
  assert.equal(normalizeVisualGeometryMode(undefined), 'high');

  assertOffCaps(resolveVisualGeometryProfile('off', 'story:living', ['living', 'residential']));
  for (const mode of ['low', 'medium', 'high'] as const satisfies readonly VisualGeometryMode[]) {
    const profile = resolveVisualGeometryProfile(mode, 'story:living', ['living', 'residential']);
    assertEnabledCaps(profile, mode);
    assert.equal(profile.instanceCap, EXPECTED_INSTANCE_CAPS[mode], `${mode} instance cap`);
    assert.equal(profile.proceduralFieldRadius, EXPECTED_FIELD_RADII[mode], `${mode} procedural field radius`);
    assert.equal(profile.proceduralFieldInstanceCap, EXPECTED_FIELD_CAPS[mode], `${mode} procedural field cap`);
    assert.deepEqual(VISUAL_GEOMETRY_MODE_BUDGETS[mode], {
      radius: EXPECTED_RADII[mode],
      proceduralFieldRadius: EXPECTED_FIELD_RADII[mode],
      instanceCap: EXPECTED_INSTANCE_CAPS[mode],
      proceduralFieldInstanceCap: EXPECTED_FIELD_CAPS[mode],
      triangleCap: EXPECTED_TRIANGLE_CAPS[mode],
    });
  }
});

test('visual geometry budgets grow monotonically by mode before theme modulation', () => {
  const low = resolveVisualGeometryProfile('low', 'plain', []);
  const medium = resolveVisualGeometryProfile('medium', 'plain', []);
  const high = resolveVisualGeometryProfile('high', 'plain', []);
  for (const key of [
    'radius',
    'visualSlotScanCap',
    'visualSlotInstanceCap',
    'visualSlotMergeCap',
    'instanceCap',
    'triangleCap',
    'drawCallCap',
  ] as const) {
    assert.equal(medium[key] >= low[key], true, `${key}: medium must be >= low`);
    assert.equal(high[key] >= medium[key], true, `${key}: high must be >= medium`);
  }
  assert.equal(low.voxelEnabled, false);
  assert.equal(medium.voxelEnabled, false);
  assert.equal(high.voxelEnabled, true);
  assert.equal(high.voxelRadius > 0, true);
});

test('visual geometry theme modulation is data-only and deterministic', () => {
  assertUnique(VISUAL_GEOMETRY_THEME_MODULATIONS.map(row => row.id), 'visual geometry modulation');
  assertUnique(VISUAL_CORRIDOR_COVERINGS.map(row => row.id), 'visual corridor covering');
  assertUnique(VISUAL_CORRIDOR_COVERING_RULES.map(row => row.id), 'visual corridor covering rule');
  for (const row of VISUAL_GEOMETRY_THEME_MODULATIONS) {
    assert.match(row.id, ID_RE, `${row.id} must stay snake_case`);
    for (const floorKey of row.floorKeys ?? []) assert.ok(floorKey.includes(':'), `${row.id} floor key should include namespace`);
    for (const tag of [...(row.requiredTags ?? []), ...(row.blockedTags ?? [])]) assert.match(tag, ID_RE, `${row.id} tag ${tag} must stay snake_case`);
  }
  for (const row of VISUAL_CORRIDOR_COVERINGS) {
    assert.match(row.id, ID_RE, `${row.id} must stay snake_case`);
    assert.equal(['concrete', 'residential', 'ministry', 'technical', 'collector', 'cave', 'meat', 'void'].includes(row.id), true);
    for (const key of ['relief', 'ledge', 'threshold', 'pipe', 'cable', 'gutter', 'stalactite', 'bulge', 'fold'] as const) {
      const value = row.weights[key];
      assert.equal(Number.isFinite(value), true, `${row.id}.weights.${key} must be finite`);
      assert.equal(value >= 0, true, `${row.id}.weights.${key} must be non-negative`);
    }
  }
  for (const row of VISUAL_CORRIDOR_COVERING_RULES) {
    assert.match(row.id, ID_RE, `${row.id} must stay snake_case`);
    assert.equal(VISUAL_CORRIDOR_COVERINGS.some(def => def.id === row.coveringId), true, `${row.id} covering must exist`);
    for (const tag of [...(row.requiredTags ?? []), ...(row.blockedTags ?? [])]) assert.match(tag, ID_RE, `${row.id} tag ${tag} must stay snake_case`);
  }

  const a = resolveVisualGeometryProfile('medium', 'story:maintenance', ['maintenance', 'industrial', 'collectors']);
  const b = resolveVisualGeometryProfile('medium', 'story:maintenance', ['collectors', 'industrial', 'maintenance']);
  assert.deepEqual(a, b, 'same tags in different order must resolve identically');
  assert.equal(a.modulationIds.includes('maintenance_pipes_cables'), true);
  assert.equal(a.modulationIds.includes('industrial_hard_detail'), true);
  assert.equal(a.corridorVolumeStyle, 'service');
  assert.equal(a.corridorCoveringId, 'collector');
  assert.equal(a.corridorVolumeDetail > resolveVisualGeometryProfile('medium', 'plain', []).corridorVolumeDetail, true);

  const hell = resolveVisualGeometryProfile('medium', 'story:hell', ['hell', 'meat', 'cult']);
  assert.equal(hell.corridorVolumeStyle, 'organic');
  assert.equal(hell.corridorCoveringId, 'meat');
  assert.equal(hell.organicVolumeDetail > a.organicVolumeDetail, true);
});

test('visual geometry resolves generator corridor coverings from floor tags', () => {
  const cases: Array<{ tags: readonly string[]; expected: VisualCorridorCoveringId }> = [
    { tags: ['living_tunnels', 'topology', 'moving_walls'], expected: 'cave' },
    { tags: ['meat', 'samosbor', 'cult'], expected: 'meat' },
    { tags: ['collectors', 'industrial', 'water', 'pipes'], expected: 'collector' },
    { tags: ['service', 'industrial', 'power', 'maintenance'], expected: 'technical' },
    { tags: ['void', 'finale'], expected: 'void' },
    { tags: ['residential', 'civil'], expected: 'residential' },
    { tags: ['ministry', 'bureaucratic'], expected: 'ministry' },
    { tags: ['plain', 'civil'], expected: 'concrete' },
  ];

  for (const row of cases) {
    const profile = resolveVisualGeometryProfile('medium', `test:${row.expected}`, row.tags);
    assert.equal(profile.corridorCoveringId, row.expected, row.tags.join(','));
  }
});

test('all current floor themes provide finite visual geometry profiles', () => {
  for (const floor of VALID_FLOORS) {
    const theme = themeForStoryFloor(floor);
    const profile = resolveVisualGeometryProfile('low', theme.floorKey, visualGeometryThemeTags(theme));
    assertEnabledCaps(profile, `story:${FloorLevel[floor]}`);
    assert.equal(profile.instanceCap, EXPECTED_INSTANCE_CAPS.low, `story:${FloorLevel[floor]} low instance cap`);
    assert.equal(profile.proceduralFieldRadius, EXPECTED_FIELD_RADII.low, `story:${FloorLevel[floor]} low field radius`);
    assert.equal(profile.proceduralFieldInstanceCap, EXPECTED_FIELD_CAPS.low, `story:${FloorLevel[floor]} low field cap`);
  }
  for (const route of DESIGN_FLOOR_ROUTES) {
    const theme = themeForDesignRoute(route);
    const profile = resolveVisualGeometryProfile('medium', theme.floorKey, visualGeometryThemeTags(theme));
    assertEnabledCaps(profile, `design:${route.id}`);
    assert.equal(profile.instanceCap, EXPECTED_INSTANCE_CAPS.medium, `design:${route.id} medium instance cap`);
    assert.equal(profile.proceduralFieldRadius, EXPECTED_FIELD_RADII.medium, `design:${route.id} medium field radius`);
    assert.equal(profile.proceduralFieldInstanceCap, EXPECTED_FIELD_CAPS.medium, `design:${route.id} medium field cap`);
  }
  for (const z of PROCEDURAL_FLOOR_ZS) {
    const spec = makeProceduralFloorSpec(9305, z);
    const theme = themeForProceduralSpec(spec);
    const profile = resolveVisualGeometryProfile('high', theme.floorKey, visualGeometryThemeTags(theme));
    assertEnabledCaps(profile, `procedural:${spec.key}`);
    assert.equal(profile.instanceCap, EXPECTED_INSTANCE_CAPS.high, `procedural:${spec.key} high instance cap`);
    assert.equal(profile.proceduralFieldRadius, EXPECTED_FIELD_RADII.high, `procedural:${spec.key} high field radius`);
    assert.equal(profile.proceduralFieldInstanceCap, EXPECTED_FIELD_CAPS.high, `procedural:${spec.key} high field cap`);
  }
});
