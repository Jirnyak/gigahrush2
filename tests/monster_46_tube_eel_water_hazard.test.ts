import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, MonsterKind, W, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { generateOverflowSluice } from '../src/gen/maintenance/overflow_sluice';
import {
  cleanCellHazardsNear,
  getCellHazardMoveMultiplier,
  getPlayerHazardWarning,
  replaceCellHazards,
} from '../src/systems/cell_hazards';
import { makeGameState } from './helpers';

function playerAt(x: number, y: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    name: 'Вы',
  };
}

test('overflow sluice ties eel water, warnings, bait, and harpoon counters together', () => {
  const world = new World();
  const entities: Entity[] = [];
  generateOverflowSluice({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const bypass = world.rooms.find(room => room.name.includes('Затопленный обводной склад'));
  assert.ok(bypass, 'missing flooded bypass room');

  let hazardCell = -1;
  for (let y = bypass.y; y < bypass.y + bypass.h && hazardCell < 0; y++) {
    for (let x = bypass.x; x < bypass.x + bypass.w; x++) {
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.WATER) continue;
      if (getCellHazardMoveMultiplier(world, playerAt(x, y)) < 1) {
        hazardCell = ci;
        break;
      }
    }
  }
  assert.notEqual(hazardCell, -1, 'wet bypass cells should register a local route hazard');

  const hx = hazardCell % W;
  const hy = (hazardCell / W) | 0;
  const player = playerAt(hx, hy);
  const warning = getPlayerHazardWarning(world, player);
  assert.ok(warning, 'wet route should show a HUD warning');
  assert.match(warning.detail, /гарпун|приман/);
  assert.equal(warning.trapped, false, 'water should slow and warn without acting like adhesive slime');

  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 15 });
  assert.equal(cleanCellHazardsNear(world, player.x, player.y, 2, state, player, 'fire'), 0, 'water risk should not be burned away like residue');
  assert.ok(getCellHazardMoveMultiplier(world, player) < 1, 'non-cleanable water risk should remain active');

  const rebuilt = new World();
  replaceCellHazards(rebuilt, world);
  assert.ok(getCellHazardMoveMultiplier(rebuilt, player) < 1, 'registered wet risk should survive POI rebuild copy');

  const eels = entities.filter(e => e.type === EntityType.MONSTER && e.monsterKind === MonsterKind.TUBE_EEL);
  assert.ok(eels.length >= 2, 'sluice should spawn water eels');
  for (const eel of eels) {
    assert.equal(world.cells[world.idx(Math.floor(eel.x), Math.floor(eel.y))], Cell.WATER, 'tube eel should start in water');
  }

  const inventories = entities.flatMap(e => e.inventory ?? []);
  assert.ok(inventories.some(item => item.defId === 'harpoon_gun'), 'Egor should expose harpoon counterplay');
  assert.ok(inventories.some(item => item.defId === 'ammo_harpoon'), 'sluice route should expose harpoon ammo');
  assert.ok(inventories.some(item => item.defId === 'bread' || item.defId === 'govnyak_roll'), 'sluice route should expose bait inputs');
});
