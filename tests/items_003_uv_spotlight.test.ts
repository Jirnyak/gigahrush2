import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Faction, ItemType, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  droppedToolLightScore,
  equippedToolLightScore,
  passiveToolLightRenderIntensity,
  toolLightDef,
} from '../src/data/tool_lights';
import { generateLiquidatorArchive } from '../src/gen/ministry/liquidator_archive';
import { MarkType, stampMark } from '../src/systems/surface_marks';
import { UV_SPOTLIGHT_FX_SECONDS, useUvSpotlight, uvSpotlightRenderIntensity } from '../src/systems/uv_spotlight';
import { makeGameState, makeTestPlayer } from './helpers';

test('uv spotlight is liquidator cleanup gear with resource pressure', () => {
  const def = ITEMS.uv_spotlight;

  assert.equal(def.type, ItemType.TOOL);
  assert.equal(def.durability, 36);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.STORAGE]);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['tool', 'liquidator', 'cleanup', 'uv', 'directed_light']) {
    assert.ok(ITEM_TAGS.uv_spotlight?.includes(tag), `uv_spotlight must publish ${tag} tag`);
  }
  assert.equal(ITEM_TAGS.uv_spotlight?.includes('weapon'), false);
});

test('uv spotlight stays a tool pulse, not a weapon or passive lamp', () => {
  const def = ITEMS.uv_spotlight;
  const lightDef = toolLightDef(def.id);

  assert.equal(WEAPON_STATS[def.id], undefined);
  assert.match(def.desc, /Слот инструмента/);
  assert.match(def.desc, /по взгляду/);
  assert.equal(lightDef?.passive, false);
  assert.equal(passiveToolLightRenderIntensity(def.id, { cur: 36, max: 36 }), 0);
  assert.equal(equippedToolLightScore(def.id), 0);
  assert.equal(droppedToolLightScore(def.id), 0);
  assert.equal(lightDef?.renderIntensity, 0);
  assert.equal(uvSpotlightRenderIntensity(0), 0);
  assert.ok(uvSpotlightRenderIntensity(UV_SPOTLIGHT_FX_SECONDS) > 0.9);
  assert.ok(uvSpotlightRenderIntensity(UV_SPOTLIGHT_FX_SECONDS * 2) <= 1.05);
});

test('uv spotlight reveals only dark blue-black residue marks', () => {
  const world = new World();
  for (let y = 9; y <= 11; y++) {
    for (let x = 8; x <= 20; x++) world.set(x, y, Cell.FLOOR);
  }

  stampMark(world, 13, 10, 0.5, 0.5, 0.42, MarkType.POOL, 3003, 3, 5, 8, 230);
  stampMark(world, 15, 10, 0.5, 0.5, 0.42, MarkType.BULLET, 3004, 18, 16, 14, 220);

  const residueIdx = world.idx(13, 10);
  const bulletIdx = world.idx(15, 10);
  const residueBefore = new Uint8Array(world.surfaceMap.get(residueIdx)!);
  const bulletBefore = new Uint8Array(world.surfaceMap.get(bulletIdx)!);
  const player = makeTestPlayer({
    x: 10.5,
    y: 10.5,
    angle: 0,
    tool: 'uv_spotlight',
    inventory: [{ defId: 'uv_spotlight', count: 1, data: { dur: 36 } }],
  });
  const state = makeGameState();

  const result = useUvSpotlight(world, [player], player, state);

  assert.ok(result);
  assert.equal(result.revealed, 1);
  assert.notDeepEqual([...world.surfaceMap.get(residueIdx)!], [...residueBefore]);
  assert.deepEqual([...world.surfaceMap.get(bulletIdx)!], [...bulletBefore]);
});

test('uv spotlight is reachable from the Ministry liquidator archive stash', () => {
  const world = new World();
  const entities = [];

  generateLiquidatorArchive(world, 0, entities, { v: 1 }, 512, 512);

  const stash = world.containers.find(container => container.inventory.some(item => item.defId === 'uv_spotlight'));
  assert.ok(stash, 'liquidator archive should expose uv_spotlight');
  assert.equal(stash.faction, Faction.LIQUIDATOR);
  assert.equal(stash.access, 'faction');
  assert.ok(stash.tags.includes('liquidator'));
});
