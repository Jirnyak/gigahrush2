import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALL_VISUAL_MODEL_IDS,
  VISUAL_MODELS,
  maybeVisualModelDef,
  type VisualModelId,
} from '../src/data/visual_models';
import { MESH_MATERIALS } from '../src/render/mesh/materials';
import {
  MAX_MESH_MODEL_CACHE_SIZE,
  clearMeshModelCache,
  getMeshTemplate,
  meshModelCacheSize,
} from '../src/render/mesh/model_cache';
import { buildMeshTemplate, buildVisualModelPart, type MeshTemplate } from '../src/render/mesh/primitives';

const ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TRIANGLE_CAP = 512;

function assertFiniteArray(values: Float32Array | Uint8Array | Uint16Array | Uint32Array, label: string): void {
  for (let i = 0; i < values.length; i++) {
    assert.equal(Number.isFinite(values[i]), true, `${label}[${i}] must be finite`);
  }
}

function assertTemplate(template: MeshTemplate, label: string): void {
  assert.equal(template.vertices.length > 0, true, `${label} must have vertices`);
  assert.equal(template.normals.length, template.vertices.length, `${label} normal arity`);
  assert.equal(template.colors.length, (template.vertices.length / 3) * 4, `${label} color arity`);
  assert.equal(template.indices.length > 0, true, `${label} must have indices`);
  assert.equal(template.indices.length % 3, 0, `${label} indices must form triangles`);
  assert.equal(template.triangleCount, template.indices.length / 3, `${label} triangle count`);
  assert.equal(template.triangleCount > 0 && template.triangleCount <= TRIANGLE_CAP, true, `${label} triangle cap`);
  assert.equal(Number.isFinite(template.boundsRadius) && template.boundsRadius > 0, true, `${label} bounds radius`);
  assertFiniteArray(template.vertices, `${label}.vertices`);
  assertFiniteArray(template.normals, `${label}.normals`);
  assertFiniteArray(template.colors, `${label}.colors`);
  assertFiniteArray(template.indices, `${label}.indices`);
}

async function loadVisualCellDefs(): Promise<readonly { id?: string; modelId?: string }[] | undefined> {
  try {
    const mod = await import('../src/data/visual_cell_slots') as Record<string, unknown>;
    const rows = mod.VISUAL_CELL_DEFS ?? mod.VISUAL_CELL_SLOT_DEFS ?? mod.VISUAL_CELL_SLOTS;
    if (Array.isArray(rows)) return rows as readonly { id?: string; modelId?: string }[];
    if (rows && typeof rows === 'object') return Object.values(rows) as readonly { id?: string; modelId?: string }[];
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('visual_cell_slots')) return undefined;
    throw error;
  }
}

test('visual model registry has unique bounded data-only ids', () => {
  const ids = new Set<string>();
  const allIds = new Set(ALL_VISUAL_MODEL_IDS);
  assert.equal(VISUAL_MODELS.length >= 12, true);
  assert.equal(allIds.size, ALL_VISUAL_MODEL_IDS.length);

  for (const def of VISUAL_MODELS) {
    assert.match(def.id, ID_RE, `${def.id} must be snake_case`);
    assert.equal(ids.has(def.id), false, `duplicate visual model id ${def.id}`);
    ids.add(def.id);
    assert.equal(allIds.has(def.id), true, `${def.id} missing from id list`);
    assert.equal(maybeVisualModelDef(def.id), def);
    assert.equal(def.tags.length > 0, true, `${def.id} needs tags`);
    assert.equal(def.parts.length > 0, true, `${def.id} needs parts`);
    assert.equal(Number.isFinite(def.bounds.x) && def.bounds.x > 0, true, `${def.id} bounds.x`);
    assert.equal(Number.isFinite(def.bounds.y) && def.bounds.y > 0, true, `${def.id} bounds.y`);
    assert.equal(Number.isFinite(def.bounds.z) && def.bounds.z > 0, true, `${def.id} bounds.z`);
    if (def.spriteFallback) assert.match(def.spriteFallback, /^[a-z]+:[a-z0-9_]+$/);
    for (const part of def.parts) {
      assert.equal(MESH_MATERIALS[part.material] !== undefined, true, `${def.id} uses unknown material ${part.material}`);
    }
  }
});

test('visual model registry stays data-only by import boundary', () => {
  const source = readFileSync(new URL('../src/data/visual_models.ts', import.meta.url), 'utf8');
  assert.equal(source.includes("from '../core/world'"), false);
  assert.equal(source.includes('World'), false);
  assert.equal(source.includes('WebGL'), false);
  assert.equal(source.includes('../render/'), false);
});

test('visual cell slot model references resolve when that registry exists', async () => {
  const rows = await loadVisualCellDefs();
  if (!rows) return;
  for (const row of rows) {
    if (!row.modelId) continue;
    assert.ok(maybeVisualModelDef(row.modelId), `${row.id ?? 'visual cell'} references missing model ${row.modelId}`);
  }
});

test('every visual model part builds non-empty finite geometry', () => {
  for (const def of VISUAL_MODELS) {
    for (let i = 0; i < def.parts.length; i++) {
      const template = buildVisualModelPart(def.id, def.parts[i], i, 1234);
      assertTemplate(template, `${def.id}.part${i}.${def.parts[i].kind}`);
    }
  }
});

test('visual model templates are finite and stay below per-model triangle caps', () => {
  for (const def of VISUAL_MODELS) {
    const template = buildMeshTemplate(def, 7001);
    assertTemplate(template, def.id);
    assert.equal(template.modelId, def.id);
  }
});

test('mesh model cache is stable for the same model id and variant seed', () => {
  clearMeshModelCache();
  assert.equal(meshModelCacheSize(), 0);
  const first = getMeshTemplate('table_slab', 42);
  const second = getMeshTemplate('table_slab', 42);
  const otherSeed = getMeshTemplate('table_slab', 43);
  const otherModel = getMeshTemplate('lamp_stand', 42);

  assert.equal(first, second);
  assert.notEqual(first, otherSeed);
  assert.notEqual(first, otherModel);
  assert.equal(meshModelCacheSize(), 3);
  assertTemplate(first, 'cached table_slab');
});

test('mesh model cache stays bounded across variants', () => {
  clearMeshModelCache();
  for (let seed = 0; seed < MAX_MESH_MODEL_CACHE_SIZE + 11; seed++) {
    assertTemplate(getMeshTemplate('chair_simple', seed), `chair_simple:${seed}`);
  }
  assert.equal(meshModelCacheSize(), MAX_MESH_MODEL_CACHE_SIZE);
});

test('public visual model id union includes the required first primitive model set', () => {
  const required: readonly VisualModelId[] = [
    'column_concrete_square',
    'table_slab',
    'chair_simple',
    'shelf_block',
    'machine_box',
    'ceiling_bulb',
    'ceiling_light_panel',
    'meat_ceiling_lamp',
    'lamp_stand',
    'stove_block',
    'sink_basin',
    'toilet_bowl',
    'container_crate',
    'container_small_box',
    'container_tall_cabinet',
    'trash_bin',
    'corridor_wall_relief',
    'corridor_side_ledge',
    'corridor_floor_threshold',
    'floor_tile_shard',
    'brick_fragment',
    'collector_floor_pipe',
    'linoleum_peel',
    'linoleum_scrap',
    'paper_sheet',
    'newspaper_sheet',
    'floor_crumb',
    'organic_stalactite',
    'organic_wall_bulge',
    'cave_stalactite',
    'cave_wall_protrusion',
    'meat_wall_fold',
    'meat_floor_fold',
    'collector_gutter',
    'billboard_prop',
  ];
  for (const id of required) assert.equal(ALL_VISUAL_MODEL_IDS.includes(id), true, `${id} must be registered`);
});

test('corridor panels and threshold base models stay micro scale', () => {
  const wallPanels: readonly VisualModelId[] = [
    'wall_panel_flat',
    'wall_panel_screen',
    'corridor_wall_relief',
    'corridor_side_ledge',
    'organic_wall_bulge',
    'cave_wall_protrusion',
    'meat_wall_fold',
  ];
  for (const id of wallPanels) {
    const bounds = maybeVisualModelDef(id)!.bounds;
    assert.equal(bounds.x <= 0.34, true, `${id} wall length`);
    assert.equal(bounds.y <= 0.07, true, `${id} wall depth`);
    assert.equal(bounds.z <= 0.18, true, `${id} wall height`);
  }

  const threshold = maybeVisualModelDef('corridor_floor_threshold')!.bounds;
  assert.equal(threshold.x <= 0.4, true, 'corridor_floor_threshold length');
  assert.equal(threshold.y <= 0.06, true, 'corridor_floor_threshold width');
  assert.equal(threshold.z <= 0.03, true, 'corridor_floor_threshold height');

  const ceilingPanel = maybeVisualModelDef('ceiling_light_panel')!.bounds;
  assert.equal(ceilingPanel.x <= 0.45, true, 'ceiling_light_panel length');
  assert.equal(ceilingPanel.y <= 0.25, true, 'ceiling_light_panel width');
  assert.equal(ceilingPanel.z <= 0.06, true, 'ceiling_light_panel height');
});
