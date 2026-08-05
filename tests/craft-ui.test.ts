import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { CRAFT_MATERIAL_DEFS, type CraftVector, type MutableCraftVector } from '../src/data/craft_materials';
import {
  clampCraftCursor,
  craftEntryActionText,
  craftMenuEntries,
  craftMenuFallbackText,
  craftMaterialTextParts,
  craftVectorLine,
  materialPanelLegendRows,
  materialPanelRows,
} from '../src/render/craft_ui';
import { craftMenuLayout, type UiRect } from '../src/render/ui_layout';
import { fitTextStable } from '../src/render/ui_text';
import type {
  CraftMenuDisassembleEntry,
  CraftMenuRecipeEntry,
  CraftMenuSnapshot,
} from '../src/systems/crafting';

const zeroVector = (): MutableCraftVector => [0, 0, 0, 0, 0, 0, 0, 0, 0];

const ctx = {
  font: '10px monospace',
  measureText(text: string) {
    const px = Number(/^(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
    return { width: text.length * px * 0.62 } as TextMetrics;
  },
} as CanvasRenderingContext2D;

function assertRectInside(rect: UiRect, w: number, h: number): void {
  assert.ok(rect.x >= -0.001);
  assert.ok(rect.y >= -0.001);
  assert.ok(rect.x + rect.w <= w + 0.001);
  assert.ok(rect.y + rect.h <= h + 0.001);
}

function snapshot(overrides: Partial<CraftMenuSnapshot> = {}): CraftMenuSnapshot {
  return {
    mode: 'craft',
    stationKind: 'lathe',
    materials: zeroVector(),
    recipes: [],
    inventory: [],
    knownRecipes: [],
    disassemblyItems: [],
    ...overrides,
  };
}

function recipe(overrides: Partial<CraftMenuRecipeEntry> = {}): CraftMenuRecipeEntry {
  return {
    kind: 'recipe',
    id: 'craft_item_pipe',
    recipeId: 'craft_item_pipe',
    itemId: 'pipe',
    itemName: 'Труба',
    name: 'Труба',
    description: 'Обычная труба.',
    resultCount: 1,
    components: [1, 0, 0, 0, 0, 2, 0, 0, 0] as CraftVector,
    station: 'lathe',
    tier: 0,
    tags: [],
    canCraft: true,
    craftable: true,
    missing: zeroVector(),
    missingMaterials: {},
    ...overrides,
  };
}

function disassembly(overrides: Partial<CraftMenuDisassembleEntry> = {}): CraftMenuDisassembleEntry {
  return {
    kind: 'disassemble',
    slotIndex: 0,
    itemId: 'pipe',
    itemName: 'Труба',
    name: 'Труба',
    description: 'Обычная труба.',
    count: 1,
    components: [1, 0, 0, 0, 0, 2, 0, 0, 0] as CraftVector,
    canDisassemble: true,
    possibleOutputs: [
      { materialId: 'mechanics', label: 'МЕХ', weight: 1 },
      { materialId: 'metal', label: 'МАТ', weight: 2 },
    ],
    ...overrides,
  };
}

test('craft menu layout fits base, desktop widescreen, and mobile portrait canvases', () => {
  for (const [w, h] of [[320, 200], [1920, 1080], [390, 844]] as const) {
    const layout = craftMenuLayout(w, h);
    for (const rect of [layout.title, layout.list, layout.detail, layout.materials, layout.bottom, layout.close, layout.icon]) {
      assertRectInside(rect, w, h);
    }
    assert.ok(layout.list.x + layout.list.w <= layout.detail.x + 0.001);
    assert.ok(layout.detail.x + layout.detail.w <= layout.materials.x + 0.001);
    assert.ok(layout.list.y + layout.list.h <= layout.bottom.y + 0.001);
    assert.ok(layout.rowH > 0);
    assert.ok(layout.materialRowH > 0);
  }
});

test('craft material panel always exposes nine fitting labels', () => {
  const materials = [0, 1, 12, 123, 999, 1000, 10000, 999999, 42] as CraftVector;
  const rows = materialPanelRows(materials);
  const layout = craftMenuLayout(320, 200);
  ctx.font = `${7 * layout.scale}px monospace`;

  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map(row => row.split(' ')[0]), CRAFT_MATERIAL_DEFS.map(def => def.shortName));
  for (const row of rows) {
    const fitted = fitTextStable(ctx, row, layout.materials.w - 10 * layout.scale);
    assert.ok(ctx.measureText(fitted).width <= layout.materials.w - 10 * layout.scale + 0.001, row);
  }
});

test('craft material panel decodes every short code inside the material column', () => {
  const materials = [0, 1, 12, 123, 999, 1000, 10000, 999999, 42] as CraftVector;
  const rows = materialPanelLegendRows(materials);
  const layout = craftMenuLayout(320, 200);
  const codeW = 36 * layout.scale;
  const nameW = layout.materials.w - 50 * layout.scale;

  assert.equal(rows.length, 9);
  assert.deepEqual(rows.map(row => row.name), CRAFT_MATERIAL_DEFS.map(def => def.name));

  ctx.font = `${7 * layout.scale}px monospace`;
  for (const row of rows) {
    assert.ok(ctx.measureText(fitTextStable(ctx, row.code, codeW)).width <= codeW + 0.001, row.code);
  }

  ctx.font = `${4 * layout.scale}px monospace`;
  for (const row of rows) {
    assert.equal(fitTextStable(ctx, row.name, nameW), row.name);
    assert.ok(ctx.measureText(row.name).width <= nameW + 0.001, row.name);
  }
});

test('craft vector labels keep material colors and disambiguate metal from metamatter', () => {
  const vector = [0, 0, 0, 0, 1, 2, 0, 0, 3] as CraftVector;
  const parts = craftMaterialTextParts(vector);

  assert.deepEqual(parts.map(part => `${part.label}:${part.value}`), ['ХИМ:1', 'МАТ:2', 'МЕТ:3']);
  assert.deepEqual(parts.map(part => part.color), [
    CRAFT_MATERIAL_DEFS[4].color,
    CRAFT_MATERIAL_DEFS[5].color,
    CRAFT_MATERIAL_DEFS[8].color,
  ]);
  assert.equal(craftVectorLine(vector), 'ХИМ 1  МАТ 2  МЕТ 3');
});

test('selected recipe missing-material line fits compact detail panel', () => {
  const missing = [12, 9, 8, 7, 6, 5, 4, 3, 2] as MutableCraftVector;
  const entry = recipe({ craftable: false, missing, blockedReason: 'insufficient_materials' });
  const layout = craftMenuLayout(320, 200);
  ctx.font = `${6.2 * layout.scale}px monospace`;
  const line = craftEntryActionText(entry);
  const fitted = fitTextStable(ctx, line, layout.detail.w - 10 * layout.scale);

  assert.ok(line.startsWith('НЕДОСТАЕТ:'));
  assert.ok(ctx.measureText(fitted).width <= layout.detail.w - 10 * layout.scale + 0.001);
});

test('empty craft and disassembly snapshots expose fallback text', () => {
  assert.deepEqual(craftMenuEntries(snapshot({ mode: 'craft' })), []);
  assert.equal(craftMenuFallbackText('craft'), 'Известных рецептов нет.');

  assert.deepEqual(craftMenuEntries(snapshot({ mode: 'disassemble', stationKind: 'workbench' })), []);
  assert.equal(craftMenuFallbackText('disassemble'), 'Инвентарь пуст.');
});

test('craft menu entries follow the active mode and cursor clamps after shrink', () => {
  const before = snapshot({
    mode: 'disassemble',
    stationKind: 'workbench',
    inventory: [disassembly({ slotIndex: 0 }), disassembly({ slotIndex: 1 }), disassembly({ slotIndex: 2 })],
  });
  const after = snapshot({
    mode: 'disassemble',
    stationKind: 'workbench',
    inventory: [disassembly({ slotIndex: 0 })],
  });

  assert.equal(craftMenuEntries(before).length, 3);
  assert.equal(clampCraftCursor(2, before), 2);
  assert.equal(clampCraftCursor(2, after), 0);
});
