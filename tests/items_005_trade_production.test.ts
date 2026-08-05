import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const UTILITY_SCRAP_ITEM_IDS = [
  'blueprint_t1_folder',
  'blueprint_t2_folder',
  'blueprint_t3_folder',
  'weapon_blueprint_t2',
  'homemade_ammo_instruction',
  'scrubbed_serial_plate',
  'stolen_filter_pack',
  'black_market_shells',
  'contraband_shocker_parts',
  'junior_tech_case',
  'sound_emitter',
  'keyboard_unit',
  'screen_unit',
  'krona_battery',
  'heating_element',
  'electrode_pack',
  'water_filter_regulator',
  'pump_impeller',
  'vent_damper_plate',
  'rail_switch_handle',
  'rail_signal_lamp',
  'rail_spike_pack',
  'track_diagram_scrap',
  'roller_brush',
  'aerosol_paint_maiden',
  'plastic_sheet',
  'ceramic_shards_pack',
  'cardboard_stack',
  'rubber_tube',
  'bottle_empty',
  'sugar_pack',
  'braga_bucket',
  'moonshine_still_part',
  'dice_bone',
  'resident_trinket_box',
  'party_portrait_pin',
  'stolen_terminal_stamp',
  'market_weight_scale',
] as const;

const PRODUCTION_RESOURCE_ITEMS = UTILITY_SCRAP_ITEM_IDS.filter(id => ![
  'dice_bone',
  'resident_trinket_box',
].includes(id));

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

function factoryRecipeIds(factoryId: string): Set<string> {
  return new Set(FACTORIES.find(factory => factory.id === factoryId)?.recipes.map(recipe => recipe.id) ?? []);
}

test('utility scrap trade and production definitions are present and keyed', () => {
  for (const id of UTILITY_SCRAP_ITEM_IDS) {
    assert.equal(ITEMS[id]?.id, id, `${id} must exist`);
    assert.ok(ITEMS[id].value >= 0, `${id} must be tradeable`);
  }

  assert.equal(ITEMS.black_market_shells.type, ItemType.AMMO);
  assert.deepEqual(ITEMS.black_market_shells.spawnRooms, []);
  assert.equal(ITEMS.black_market_shells.spawnW, 0);
  assert.equal(ITEMS.sugar_pack.type, ItemType.FOOD);

  for (const id of ['weapon_blueprint_t2', 'stolen_filter_pack', 'contraband_shocker_parts', 'stolen_terminal_stamp']) {
    assert.ok(ITEMS[id].tags?.includes('contraband'), `${id} must publish contraband tags`);
  }
});

test('utility scrap production goods map to explicit economy resources', () => {
  for (const id of PRODUCTION_RESOURCE_ITEMS) {
    assert.ok(resourceForItem(id), `${id} must map to a resource or be resident loot only`);
  }

  assert.equal(resourceForItem('black_market_shells')?.id, 'ammo');
  assert.equal(resourceForItem('sugar_pack')?.id, 'food');
  assert.equal(resourceForItem('keyboard_unit')?.id, 'tools');
});

test('utility scrap goods are reachable from containers, black market stock and factories', () => {
  assert.ok(containerPoolIds(ContainerKind.FILING_CABINET).has('blueprint_t1_folder'));
  assert.ok(containerPoolIds(ContainerKind.SAFE).has('blueprint_t3_folder'));
  assert.ok(containerPoolIds(ContainerKind.SECRET_STASH).has('black_market_shells'));
  assert.ok(containerPoolIds(ContainerKind.TOOL_LOCKER).has('screen_unit'));
  assert.ok(containerPoolIds(ContainerKind.FRIDGE).has('sugar_pack'));

  const marketStock = new Set(BLACK_MARKET_88_STOCK.map(row => row.itemId));
  for (const id of ['black_market_shells', 'stolen_filter_pack', 'weapon_blueprint_t2', 'contraband_shocker_parts']) {
    assert.ok(marketStock.has(id), `${id} must be sold at Black Market 88`);
  }

  assert.ok(factoryRecipeIds('illegal_ammo_smelter').has('cast_black_market_shells'));
  assert.ok(factoryRecipeIds('illegal_ammo_smelter').has('scrub_weapon_serials'));
  assert.ok(factoryRecipeIds('utility_room').has('strip_terminal_units'));
  assert.ok(factoryRecipeIds('utility_room').has('service_water_filter'));
  assert.ok(factoryRecipeIds('communal_kitchen').has('start_braga_bucket'));
});

test('black market shells unpack into ordinary shell ammo before being consumed', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'black_market_shells', count: 1 }] });
  const state = makeGameState({ time: 40 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'black_market_shells'), 0);
  assert.equal(countInventoryItem(player, 'ammo_shells'), 4);
  assert.ok(state.msgs.some(line => line.text.includes('Чёрнорыночная дробь разобрана')));
});
