import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, ContainerKind, EntityType, Faction, FloorLevel, ItemType, MonsterKind, RoomType, type Entity, type Msg } from '../src/core/types';
import { World } from '../src/core/world';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS, WEAPON_STATS } from '../src/data/catalog';
import { CONTRACTS } from '../src/data/contracts';
import { MAX_ITEM_STACK } from '../src/data/inventory_limits';
import { getPermitDef } from '../src/data/permits';
import { PSI_WEAPON_STATS } from '../src/data/psi';
import { RESOURCES, resourceForItem, resourceForItemType } from '../src/data/resources';
import { ITEM_TAGS, getStack, itemEquipSlot, spawnCount } from '../src/data/items';
import {
  addItem,
  consumeAmmo,
  consumeDurability,
  countAmmo,
  getEquippedDurability,
  getEquippedToolDurability,
  getInventorySlotActionInfo,
  getWeaponReadiness,
  getWeaponStats,
  inventoryItemCategory,
  useItem,
} from '../src/systems/inventory';
import {
  awardXP,
  adjustedPsiCost,
  freshRPG,
  getMaxHp,
  getMaxPsi,
  intPsiCostMult,
  meleeDamage,
  questDifficulty,
  questMoneyReward,
  questXpReward,
  RPG_ATTRIBUTE_CAP,
  RPG_LEVEL_CAP,
  rpgStatEffects,
  regenPsi,
  scaleMonsterDmg,
  scaleMonsterHp,
  spendAttrPoint,
  strHeavyWeaponSpeedMult,
  totalXpForLevel,
  xpForLevel,
  xpForMonsterKill,
} from '../src/systems/rpg';
import {
  activeZhelemishSkin,
  applyZhelemishSkin,
  cureZhelemishSkin,
  updateZhelemishSkinStatus,
  zhelemishHealingMult,
  zhelemishIncomingMeleeDamage,
  zhelemishMoveMult,
} from '../src/systems/status';
import { getRecentEvents } from '../src/systems/events';
import { tryFactionCombat } from '../src/systems/ai/combat';
import { rebuildEntityIndex } from '../src/systems/entity_index';
import { makeGameState } from './helpers';

function makePlayer(): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 50,
    maxHp: 100,
    inventory: [],
    weapon: '',
    faction: Faction.PLAYER,
    name: 'Вы',
    rpg: freshRPG(1),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function descNumber(desc: string, re: RegExp): number | undefined {
  const match = re.exec(desc);
  return match ? Number(match[1].replace(',', '.')) : undefined;
}

test('item stack rules keep weapons single-slot and commodities stackable', () => {
  assert.equal(getStack(ITEMS.bread), MAX_ITEM_STACK);
  assert.equal(getStack(ITEMS.pipe), 1);
  assert.equal(spawnCount(ITEMS.ammo_9mm), 4);
  assert.equal(spawnCount(ITEMS.pipe), 1);

  const player = makePlayer();
  assert.equal(addItem(player, 'bread', 1200), true);
  assert.deepEqual(player.inventory?.map(i => i.count), [255, 255, 255, 255, 180]);

  assert.equal(addItem(player, 'pipe', 2), true);
  const pipes = player.inventory?.filter(i => i.defId === 'pipe') ?? [];
  assert.equal(pipes.length, 2);
  assert.ok(pipes.every(i => (i.data as { dur?: number }).dur === WEAPON_STATS.pipe.durability));
});

test('ip4 gasmask is finite respiratory PPE in the tools economy', () => {
  const def = ITEMS.ip4_gasmask;
  assert.equal(def.type, ItemType.TOOL);
  assert.equal(def.durability, 90);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.ok(ITEM_TAGS.ip4_gasmask.includes('respiratory_ppe'));

  const player = makePlayer();
  const msgs: Msg[] = [];
  assert.equal(addItem(player, def.id, 1), true);
  useItem(player, 0, msgs, 12);
  assert.equal(player.tool, def.id);
  assert.deepEqual(getEquippedToolDurability(player), { cur: 90, max: 90 });
});

test('rusty rake is a weak reachable cleanup reach weapon', () => {
  const item = ITEMS.rusty_rake;
  const stats = WEAPON_STATS.rusty_rake;

  assert.equal(item.type, ItemType.WEAPON);
  assert.equal(resourceForItem(item.id)?.id, 'metal');
  assert.ok(item.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(item.spawnRooms.includes(RoomType.LIVING));
  assert.ok(item.tags?.includes('cleanup'));
  assert.ok(item.tags?.includes('liquidator'));
  assert.equal(stats.isRanged, false);
  assert.ok(stats.range > WEAPON_STATS.knife.range);
  assert.ok(stats.range < WEAPON_STATS.fire_hook.range);
  assert.ok(stats.dmg < WEAPON_STATS.pipe.dmg);
  assert.ok(stats.durability < WEAPON_STATS.fire_hook.durability);
});

test('liquidator rake is weak cleanup reach gear with reachable sources', () => {
  const item = ITEMS.liquidator_rake;
  const stats = WEAPON_STATS.liquidator_rake;
  const cleanupContract = CONTRACTS.find(def => def.id === 'exp_maint_furnace_burn_residue');

  assert.equal(item.type, ItemType.WEAPON);
  assert.equal(stats.isRanged, false);
  assert.ok(stats.dmg < WEAPON_STATS.fire_hook.dmg);
  assert.ok(stats.range > WEAPON_STATS.pipe.range);
  assert.ok(stats.range < WEAPON_STATS.fire_hook.range);
  assert.equal(stats.durability, 70);
  assert.ok(ITEM_TAGS.liquidator_rake?.includes('liquidator'));
  assert.ok(ITEM_TAGS.liquidator_rake?.includes('cleanup'));
  assert.ok(ITEM_TAGS.liquidator_rake?.includes('slime_clean'));
  assert.equal(resourceForItem(item.id)?.id, 'tools');
  assert.ok(item.spawnRooms.includes(RoomType.HQ));
  assert.ok(item.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(cleanupContract?.extraRewards?.some(reward => reward.defId === item.id));
});

test('using items equips weapons and consumes medicine only once', () => {
  const player = makePlayer();
  const msgs: Msg[] = [];

  addItem(player, 'knife', 1);
  useItem(player, 0, msgs, 10);
  assert.equal(player.weapon, 'knife');
  assert.equal(player.inventory?.length, 1);

  addItem(player, 'bandage', 1);
  player.hp = 20;
  useItem(player, 1, msgs, 11);
  assert.equal(player.hp, 35);
  assert.equal(player.inventory?.some(i => i.defId === 'bandage'), false);
});

test('inventory Enter toggles equipped weapon and active tool off', () => {
  const player = makePlayer();
  const msgs: Msg[] = [];

  assert.equal(addItem(player, 'knife', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter экипировать');
  useItem(player, 0, msgs, 20);
  assert.equal(player.weapon, 'knife');
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter снять');

  useItem(player, 0, msgs, 21);
  assert.equal(player.weapon, '');
  assert.deepEqual(player.inventory?.map(item => item.defId), ['knife']);

  assert.equal(addItem(player, 'ip4_gasmask', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 1)?.useLabel, 'Enter в инструмент');
  useItem(player, 1, msgs, 22);
  assert.equal(player.tool, 'ip4_gasmask');
  assert.equal(getInventorySlotActionInfo(player, 1)?.useLabel, 'Enter снять');

  useItem(player, 1, msgs, 23);
  assert.equal(player.tool, '');
  assert.deepEqual(player.inventory?.map(item => item.defId), ['knife', 'ip4_gasmask']);
  assert.ok(msgs.some(entry => /Оружие снято/.test(entry.text)));
  assert.ok(msgs.some(entry => /Инструмент снят/.test(entry.text)));
});

test('painkiller pack is reachable medicine with sleep tradeoff', () => {
  const item = ITEMS.painkiller_pack;
  const player = makePlayer();
  const msgs: Msg[] = [];

  assert.equal(item.type, ItemType.MEDICINE);
  assert.ok(item.spawnRooms.includes(RoomType.MEDICAL));
  assert.equal(resourceForItem(item.id)?.id, 'medicine');
  assert.ok(ITEM_TAGS.painkiller_pack?.includes('pain'));

  player.hp = 40;
  player.needs = { food: 100, water: 80, sleep: 30, pee: 0, poo: 0 };
  addItem(player, item.id, 1);
  useItem(player, 0, msgs, 12);

  assert.equal(player.hp, 50);
  assert.equal(player.needs.sleep, 24);
  assert.equal(player.inventory?.some(i => i.defId === item.id), false);
});

test('using zhelemish resource applies timed skin and antifungal medicine cures it', () => {
  const player = makePlayer();
  const state = makeGameState({ time: 20 });
  const msgs: Msg[] = [];

  addItem(player, 'zhelemish_dried', 1);
  addItem(player, 'antifungal_ointment', 1);
  useItem(player, 0, msgs, 20, state);
  assert.equal(activeZhelemishSkin(player, 20)?.source, 'zhelemish_treated');
  assert.equal(player.inventory?.some(i => i.defId === 'zhelemish_dried'), false);

  player.hp = 40;
  useItem(player, 0, msgs, 21, state);
  assert.equal(activeZhelemishSkin(player, 21), undefined);
  assert.equal(player.hp, 60);
  assert.ok(getRecentEvents(state).some(e => e.type === 'player_status_cured'));
});

test('ammo and durability consumption update equipped combat state', () => {
  const player = makePlayer();

  addItem(player, 'makarov', 1);
  addItem(player, 'ammo_9mm', 2);
  player.weapon = 'makarov';
  player.currentMag = 8;
  player.attackCd = 0.25;
  assert.equal(getWeaponStats(player).isRanged, true);
  assert.equal(countAmmo(player), 2);
  let readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, '9мм 8/2');
  assert.equal(readiness.cooldownLabel, 'КД 0.3с');
  assert.equal(readiness.cannotFireReason, '');
  assert.equal(consumeAmmo(player), true);
  assert.equal(countAmmo(player), 2);

  player.weapon = '';
  player.tool = 'psi_rupture';
  player.rpg!.psi = 1;
  readiness = getWeaponReadiness(player);
  assert.equal(readiness.resourceLabel, `ПСИ 1/100 -${WEAPON_STATS.psi_rupture.psiCost}`);
  assert.equal(readiness.cannotFireReason, 'нет ПСИ');

  player.weapon = 'knife';
  addItem(player, 'knife', 1);
  readiness = getWeaponReadiness(player);
  assert.equal(readiness.range, WEAPON_STATS.knife.range);
  assert.equal(readiness.knockback, WEAPON_STATS.knife.knockback);
  assert.equal(readiness.reachLabel, 'дист 0.5');
  assert.equal(readiness.controlLabel, 'стоп 0.1');
  const before = getEquippedDurability(player);
  assert.equal(before?.max, WEAPON_STATS.knife.durability);
  const msgs: Msg[] = [];
  for (let i = 0; i < WEAPON_STATS.knife.durability - 1; i++) {
    assert.equal(consumeDurability(player, msgs, 20), false);
  }
  assert.equal(consumeDurability(player, msgs, 21), true);
  assert.equal(player.weapon, '');
  assert.equal(player.inventory?.some(i => i.defId === 'knife'), false);
});

test('liquidator weapon wave uses existing ammo and self-ammo paths', () => {
  const shotgunner = makePlayer();
  addItem(shotgunner, 'chizh3_shotgun', 1);
  addItem(shotgunner, 'ammo_shells', 3);
  shotgunner.weapon = 'chizh3_shotgun';
  shotgunner.currentMag = 1;
  let readiness = getWeaponReadiness(shotgunner);
  assert.equal(readiness.resourceLabel, 'дробь 1/3');
  assert.equal(readiness.damageLabel, '13x8');
  assert.equal(consumeAmmo(shotgunner), true);
  assert.equal(countAmmo(shotgunner), 3);

  const flamer = makePlayer();
  addItem(flamer, 'roks47_flamethrower', 1);
  addItem(flamer, 'napalm_mix', 2);
  flamer.weapon = 'roks47_flamethrower';
  readiness = getWeaponReadiness(flamer);
  assert.equal(readiness.resourceLabel, 'напалм 2');
  assert.equal(readiness.damageLabel, '7x2');

  const disposable = makePlayer();
  addItem(disposable, 'shmk_disposable', 2);
  disposable.weapon = 'shmk_disposable';
  readiness = getWeaponReadiness(disposable);
  assert.equal(readiness.resourceLabel, 'ШМК 2');
  assert.equal(consumeAmmo(disposable), true);
  assert.equal(countAmmo(disposable), 1);
});

test('NPC melee stop pushes targets through the generic faction combat path', () => {
  const world = new World();
  for (let y = 508; y <= 512; y++) {
    for (let x = 508; x <= 512; x++) world.set(x, y, Cell.FLOOR);
  }

  const attacker: Entity = {
    id: 10,
    type: EntityType.NPC,
    x: 510,
    y: 510,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.LIQUIDATOR,
    weapon: 'pipe',
    currentMag: 1,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
  const target: Entity = {
    id: 11,
    type: EntityType.MONSTER,
    x: 511,
    y: 510,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    monsterKind: MonsterKind.SBORKA,
  };
  const beforeDist = world.dist(attacker.x, attacker.y, target.x, target.y);

  assert.equal(tryFactionCombat(world, [attacker, target], attacker, 0.1, 5, [], { v: 100 }), true);
  assert.equal(target.hp, 100 - WEAPON_STATS.pipe.dmg);
  assert.ok(world.dist(attacker.x, attacker.y, target.x, target.y) > beforeDist);
  assert.ok((target.attackCd ?? 0) > 0);
});

test('hostile stronger NPC chases the player instead of returning to routine AI', () => {
  const world = new World();
  for (let y = 506; y <= 514; y++) {
    for (let x = 506; x <= 520; x++) world.set(x, y, Cell.FLOOR);
  }

  const player = makePlayer();
  player.id = 1;
  player.x = 516;
  player.y = 510;
  player.hp = 30;
  player.maxHp = 30;
  const hunter: Entity = {
    id: 12,
    type: EntityType.NPC,
    x: 510,
    y: 510,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 240,
    maxHp: 240,
    faction: Faction.CITIZEN,
    playerRelation: -80,
    weapon: '',
    rpg: freshRPG(30),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
  const entities = [player, hunter];
  rebuildEntityIndex(entities);

  assert.equal(tryFactionCombat(world, entities, hunter, 0.1, 5, [], { v: 100 }), true);
  assert.equal(hunter.ai?.goal, AIGoal.HUNT);
  assert.equal(hunter.ai?.combatTargetId, player.id);
});

test('runtime faction combat can skip dead-player full scans with an explicit sentinel', () => {
  const world = new World();
  for (let y = 506; y <= 514; y++) {
    for (let x = 506; x <= 520; x++) world.set(x, y, Cell.FLOOR);
  }

  const player = makePlayer();
  player.id = 1;
  player.x = 516;
  player.y = 510;
  const civilian: Entity = {
    id: 14,
    type: EntityType.NPC,
    x: 510,
    y: 510,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2,
    sprite: 0,
    hp: 30,
    maxHp: 30,
    faction: Faction.CITIZEN,
    playerRelation: -80,
    weapon: '',
    rpg: freshRPG(1),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
  const entities = [player, civilian];
  rebuildEntityIndex(entities);

  assert.equal(tryFactionCombat(world, entities, civilian, 0.1, 5, [], { v: 100 }, undefined, null), false);
  assert.equal(tryFactionCombat(world, entities, civilian, 0.1, 5, [], { v: 100 }), true);
  assert.equal(civilian.ai?.combatTargetId, player.id);
});

test('hostile weaker NPC flees a nearby stronger player', () => {
  const world = new World();
  for (let y = 506; y <= 514; y++) {
    for (let x = 506; x <= 520; x++) world.set(x, y, Cell.FLOOR);
  }

  const player = makePlayer();
  player.id = 1;
  player.x = 516;
  player.y = 510;
  player.hp = 200;
  player.maxHp = 200;
  player.weapon = 'sledgehammer';
  player.rpg = freshRPG(10);
  const scared: Entity = {
    id: 13,
    type: EntityType.NPC,
    x: 510,
    y: 510,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 2,
    sprite: 0,
    hp: 20,
    maxHp: 20,
    faction: Faction.CITIZEN,
    playerRelation: -80,
    weapon: '',
    rpg: freshRPG(1),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
  const entities = [player, scared];
  rebuildEntityIndex(entities);

  assert.equal(tryFactionCombat(world, entities, scared, 0.1, 5, [], { v: 100 }), true);
  assert.equal(scared.ai?.goal, AIGoal.FLEE);
  assert.equal(scared.ai?.combatTargetId, player.id);
});

test('PSI weapon ids, resources, and effect bindings stay coherent', () => {
  const instantEffects = new Set(['storm', 'brain_burn', 'madness', 'control', 'shield', 'possession', 'phase', 'mark', 'recall', 'beam']);
  const statIds = Object.keys(PSI_WEAPON_STATS).sort();
  const itemIds = Object.values(ITEMS)
    .filter(def => def.type === ItemType.WEAPON && def.id.startsWith('psi_'))
    .map(def => def.id)
    .sort();

  assert.deepEqual(itemIds, statIds);

  for (const id of statIds) {
    const item = ITEMS[id];
    const stats = PSI_WEAPON_STATS[id];
    assert.equal(WEAPON_STATS[id], stats, `${id} must be exported through weapon catalogue`);
    assert.equal(item.type, ItemType.WEAPON, `${id} must be a weapon item`);
    assert.equal(itemEquipSlot(item), 'tool', `${id} must equip through the tool slot`);
    assert.ok((stats.psiCost ?? 0) > 0, `${id} must spend PSI`);
    assert.equal(stats.durability, 0, `${id} must not use durability`);
    assert.equal(stats.range, 0, `${id} must not masquerade as melee`);

    if (stats.isRanged) {
      assert.ok((stats.projSpeed ?? 0) > 0, `${id} ranged PSI needs projectile speed`);
      assert.equal(stats.psiEffect, undefined, `${id} should not mix projectile and instant effects`);
    } else {
      assert.ok(stats.psiEffect && instantEffects.has(stats.psiEffect), `${id} has unknown instant effect`);
    }
  }

  assert.ok(PSI_WEAPON_STATS.psi_void_needle.psiCost! < freshRPG(1).maxPsi);
  assert.ok(PSI_WEAPON_STATS.psi_brainburn.psiCost! >= PSI_WEAPON_STATS.psi_storm.psiCost!);
});

test('PSI weapon descriptions match executable cost and damage numbers', () => {
  for (const [id, stats] of Object.entries(PSI_WEAPON_STATS)) {
    const item = ITEMS[id];
    assert.ok(item, `${id} must have an item definition`);

    const descCost = descNumber(item.desc, /(\d+(?:[,.]\d+)?)\s*ПСИ/u);
    assert.equal(descCost, stats.psiCost, `${id} description PSI cost must match PSI_WEAPON_STATS`);

    const descDamage = descNumber(item.desc, /(\d+(?:[,.]\d+)?)\s*урона/u);
    if (descDamage !== undefined) {
      assert.equal(descDamage, stats.dmg, `${id} description damage must match PSI_WEAPON_STATS`);
    }
  }
});

test('PSI recovery is explicit, tagged, and bounded by item values', () => {
  const player = makePlayer();
  player.rpg!.psi = 2;
  regenPsi(player, 999);
  assert.equal(player.rpg?.psi, 2);

  const restorers: [string, number][] = [
    ['pills', 3],
    ['antidep', 12],
    ['calm_brew', 5],
    ['holy_water', 10],
    ['psi_stabilizer', 20],
  ];

  for (const [id, expectedPsi] of restorers) {
    const p = makePlayer();
    p.rpg!.psi = 0;
    p.rpg!.maxPsi = 50;
    ITEMS[id].use?.(p);
    assert.equal(p.rpg?.psi, expectedPsi, `${id} PSI restore changed`);
    assert.ok(ITEM_TAGS[id]?.includes('psi_restore'), `${id} must publish psi_restore tag`);
  }

  assert.ok(ITEMS.psi_stabilizer.spawnW < ITEMS.pills.spawnW);
});

test('audited survival documents, drinks, and rare trophies have economy roles', () => {
  const byId = Object.fromEntries(RESOURCES.map(resource => [resource.id, resource]));

  assert.equal(resourceForItemType(ItemType.DRINK)?.id, 'drink_water');
  for (const id of ['tea', 'kompot', 'instant_coffee', 'siren_energy', 'calm_brew']) {
    assert.ok(byId.drink_water.itemIds.includes(id), `${id} must follow water scarcity`);
  }

  for (const id of [
    'official_permit_slip', 'weapon_permit_signed', 'ammo_issue_order',
    'official_quarantine_clearance', 'elevator_access_order', 'void_archive_warrant',
    'pneumomail_capsule', 'p14_gasmask_receipt', 'cleanup_order_stub',
  ]) {
    assert.ok(byId.documents.itemIds.includes(id), `${id} must affect document scarcity`);
    assert.ok(ITEM_TAGS[id]?.includes('document'), `${id} must publish document tags`);
  }
  assert.ok(byId.documents.itemIds.includes('nii_sample_container'), 'sample container must affect document scarcity');
  assert.ok(byId.slime_samples.itemIds.includes('nii_sample_container'), 'sample container must remain in the sampleware economy');
  assert.ok(ITEM_TAGS.nii_sample_container?.includes('sampleware'));
  assert.ok(ITEM_TAGS.nii_sample_container?.includes('document'));
  assert.equal(ITEM_TAGS.nii_sample_container?.includes('sample'), false, 'empty sampleware must not be treated as a taken sample');
  assert.equal(getStack(ITEMS.nii_sample_container), 4);

  for (const id of ['bottled_voice', 'siren_shard', 'void_spike']) {
    assert.ok(byId.psi.itemIds.includes(id), `${id} must price as a PSI/void trophy`);
    assert.ok(ITEM_TAGS[id]?.includes('rare_trophy'), `${id} must publish rare trophy tags`);
  }

  assert.ok(byId.electronics.itemIds.includes('field_radio_battery'));
  assert.deepEqual(ITEMS.field_radio_battery.spawnRooms, [RoomType.STORAGE, RoomType.OFFICE]);

  assert.equal(resourceForItem('asbestos_cord')?.id, 'tools');
  assert.ok(byId.tools.itemIds.includes('asbestos_cord'));
  assert.equal(ITEMS.asbestos_cord.name, 'Асбестовая верёвка');
  assert.deepEqual(ITEMS.asbestos_cord.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  for (const tag of ['repair', 'heatline', 'hermetic', 'seal_input', 'cold_counter']) {
    assert.ok(ITEM_TAGS.asbestos_cord?.includes(tag), `asbestos_cord must publish ${tag}`);
  }

  assert.equal(resourceForItem('ozk_patch')?.id, 'tools');
  assert.deepEqual(ITEMS.ozk_patch.spawnRooms, [RoomType.MEDICAL, RoomType.HQ, RoomType.STORAGE]);
  assert.ok(ITEM_TAGS.ozk_patch?.includes('repair_input'));
  assert.ok(ITEMS.ozk_patch.tags?.includes('liquidator'));

  assert.ok(byId.contraband.itemIds.includes('shark_scale'));
  assert.ok(ITEMS.shark_scale.spawnW > 0);
  assert.ok(byId.tools.itemIds.includes('cleanup_tongs'));
  assert.equal(ITEMS.cleanup_tongs.type, ItemType.TOOL);
  assert.ok(ITEM_TAGS.cleanup_tongs?.includes('sample_handling'));

  assert.equal(resourceForItem('lime_bucket')?.id, 'tools');
  assert.deepEqual(ITEMS.lime_bucket.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(ITEMS.lime_bucket.stack, 1);
  for (const tag of ['cleanup', 'lime', 'sanitary', 'evidence', 'heavy']) {
    assert.ok(ITEM_TAGS.lime_bucket?.includes(tag), `lime_bucket must publish ${tag}`);
  }
});

test('P14 gasmask receipt is an Office/HQ document with a black-market spend path', () => {
  const def = ITEMS.p14_gasmask_receipt;
  assert.equal(def.name, 'Квитанция 8П14');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  const player = makePlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const msgs: Msg[] = [];
  assert.equal(addItem(player, def.id, 1), true);

  useItem(player, 0, msgs, 30, state);

  assert.equal(player.inventory?.some(item => item.defId === def.id), false);
  assert.equal(player.money, 28);
  const sale = getRecentEvents(state, { type: 'player_sell_item', limit: 1 })[0];
  assert.equal(sale.itemId, def.id);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('liquidator'));
});

test('cleanup order stub is a liquidator document with access and sale choices', () => {
  const def = ITEMS.cleanup_order_stub;
  assert.equal(def.name, 'Корешок приказа на зачистку');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.ok(ITEM_TAGS.cleanup_order_stub?.includes('liquidator'));

  const permit = getPermitDef(def.id);
  assert.ok(permit);
  assert.ok(permit.accessTags.includes('archive'));
  assert.ok(permit.accessTags.includes('general_admin'));

  const player = makePlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const msgs: Msg[] = [];
  assert.equal(addItem(player, def.id, 1), true);

  useItem(player, 0, msgs, 30, state);

  assert.equal(player.inventory?.some(item => item.defId === def.id), false);
  assert.equal(player.money, 46);
  const sale = getRecentEvents(state, { type: 'player_sell_item', limit: 1 })[0];
  assert.equal(sale.itemId, def.id);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('trade'));
});

test('RPG rewards, attribute spend, and scaling formulas remain stable', () => {
  const player = makePlayer();
  const msgs: Msg[] = [];

  awardXP(player, xpForLevel(2), msgs, 30);
  assert.equal(player.rpg?.level, 2);
  assert.equal(player.rpg?.attrPoints, 1);
  assert.equal(spendAttrPoint(player, 'str'), true);
  assert.equal(player.rpg?.str, 1);
  assert.equal(player.maxHp, getMaxHp(player.rpg!));

  const psiPlanner = makePlayer();
  psiPlanner.rpg!.attrPoints = 1;
  psiPlanner.rpg!.psi = 5;
  assert.equal(spendAttrPoint(psiPlanner, 'int'), true);
  assert.equal(psiPlanner.rpg?.maxPsi, getMaxPsi(psiPlanner.rpg!));
  assert.equal(psiPlanner.rpg?.psi, 6);

  assert.equal(xpForMonsterKill(MonsterKind.SBORKA, 1), 10);
  assert.equal(xpForMonsterKill(MonsterKind.CREATOR, 1), 10_000);
  assert.equal(scaleMonsterHp(100, 3), 124);
  assert.equal(scaleMonsterDmg(10, 3), 12);

  const difficulty = questDifficulty(30, 100, 2);
  assert.equal(difficulty, 8);
  assert.equal(questXpReward(difficulty), 160);
  assert.equal(questMoneyReward(difficulty), 40);
  assert.equal(ITEMS.water.type, ItemType.DRINK);
});

test('totalXpForLevel correctly computes cumulative xp', () => {
  // xpForLevel(1) = 0
  assert.equal(totalXpForLevel(1), 0);
  // clamped to 1
  assert.equal(totalXpForLevel(-5), 0);

  // xpForLevel(1) + xpForLevel(2) = 0 + 100 = 100
  assert.equal(totalXpForLevel(2), 100);

  // xpForLevel(1) + xpForLevel(2) + xpForLevel(3) = 0 + 100 + 145 = 245
  assert.equal(totalXpForLevel(3), 245);

  // clamp level
  assert.equal(totalXpForLevel(RPG_LEVEL_CAP + 10), totalXpForLevel(RPG_LEVEL_CAP));
});

test('RPG progression clamps runtime levels and attributes to the shared cap', () => {
  assert.equal(RPG_LEVEL_CAP <= 255, true);
  assert.equal(RPG_ATTRIBUTE_CAP <= 255, true);

  const player = makePlayer();
  const msgs: Msg[] = [];
  player.rpg = freshRPG(RPG_LEVEL_CAP - 1);
  player.rpg.xp = xpForLevel(RPG_LEVEL_CAP) - 1;

  awardXP(player, 10_000_000, msgs, 45);

  assert.equal(player.rpg.level, RPG_LEVEL_CAP);
  assert.equal(player.rpg.xp, 0);
  assert.ok(msgs.some(item => item.text.includes(`УРОВЕНЬ ${RPG_LEVEL_CAP}`)));

  player.rpg.attrPoints = 1;
  player.rpg.str = RPG_ATTRIBUTE_CAP;
  assert.equal(spendAttrPoint(player, 'str'), false);
  assert.equal(player.rpg.attrPoints, 1);
});

test('RPG stat effects avoid hard caps and appear in weapon readiness', () => {
  const high = freshRPG(30);
  high.str = 50;
  high.agi = 50;
  high.int = 50;
  const effects = rpgStatEffects(high);
  assert.equal(effects.maxHp, 194);
  assert.equal(effects.maxPsi, 194);
  assert.equal(effects.meleeDamageMult, 1.5);
  assert.equal(round3(effects.heavyWeaponSpeedMult), 0.286);
  assert.equal(effects.moveSpeedMult, 1.5);
  assert.equal(round3(effects.attackCooldownMult), 0.5);
  assert.equal(round3(effects.rangedSpreadMult), 0.143);
  assert.equal(round3(effects.xpMult), 1.982);
  assert.equal(round3(effects.psiCostMult), 0.364);
  assert.equal(effects.psiDurationBonusSec, 50);

  const bruiser = makePlayer();
  bruiser.rpg!.str = 3;
  bruiser.rpg!.agi = 2;
  bruiser.weapon = 'sledgehammer';
  addItem(bruiser, 'sledgehammer', 1);
  const heavyStats = getWeaponStats(bruiser);
  assert.equal(
    Math.round(heavyStats.speed * 1000) / 1000,
    Math.round(WEAPON_STATS.sledgehammer.speed * strHeavyWeaponSpeedMult(bruiser.rpg!, WEAPON_STATS.sledgehammer.speed) * 1000) / 1000,
  );
  const heavyReadiness = getWeaponReadiness(bruiser);
  assert.equal(heavyReadiness.damage, 54);
  assert.match(heavyReadiness.statLabel, /СИЛ урон \+3%/);
  assert.match(heavyReadiness.statLabel, /тяж\. темп -13%/);
  assert.match(heavyReadiness.statLabel, /ЛОВ КД -4%/);

  const psiUser = makePlayer();
  psiUser.rpg!.int = 2;
  psiUser.rpg!.maxPsi = getMaxPsi(psiUser.rpg!);
  psiUser.rpg!.psi = psiUser.rpg!.maxPsi;
  psiUser.tool = 'psi_rupture';
  const psiReadiness = getWeaponReadiness(psiUser);
  assert.equal(psiReadiness.resourceLabel, 'ПСИ 102/102 -7.5');
  assert.match(psiReadiness.statLabel, /ИНТ ПСИ -6%/);
});

test('melee weapon damage receives level and strength scaling', () => {
  const rpg = freshRPG(5);
  rpg.str = 10;

  assert.equal(meleeDamage(rpg, '', WEAPON_STATS[''].dmg), 6);
  assert.equal(meleeDamage(rpg, 'knife', WEAPON_STATS.knife.dmg), 12);
  assert.equal(meleeDamage(rpg, 'sledgehammer', WEAPON_STATS.sledgehammer.dmg), 62);
});

test('INT improves PSI economy without a hard floor', () => {
  const rpg = freshRPG(10);

  assert.equal(adjustedPsiCost(20, rpg), 20);
  rpg.int = 2;
  assert.equal(adjustedPsiCost(20, rpg), 18.7);
  rpg.int = 10;
  assert.equal(round3(intPsiCostMult(rpg)), 0.741);
  assert.equal(adjustedPsiCost(20, rpg), 14.8);
  rpg.int = 50;
  assert.equal(adjustedPsiCost(20, rpg), 7.3);
});

test('zhelemish skin timing, costs, and combat formulas stay bounded', () => {
  const player = makePlayer();
  player.needs = { food: 100, water: 50, sleep: 100, pee: 0, poo: 0 };
  player.rpg!.psi = 5;
  const state = makeGameState({ time: 10 });

  const applied = applyZhelemishSkin(player, 10, 'zhelemish_raw', state, () => 0);
  assert.equal(applied.badReaction, true);
  assert.equal(player.needs.water, 42);
  assert.equal(player.rpg?.psi, 3);
  assert.equal(zhelemishIncomingMeleeDamage(player, 10, 10), 7);
  assert.equal(zhelemishMoveMult(player, 10), 0.82);
  assert.equal(zhelemishHealingMult(player, 10), 0.55);

  state.time = 12;
  updateZhelemishSkinStatus(player, state, 2);
  assert.equal(Math.round(player.needs.water * 100) / 100, 41.85);
  assert.ok(getRecentEvents(state).some(e => e.type === 'player_status_bad_reaction'));

  assert.equal(cureZhelemishSkin(player, 12, state.msgs, state, 'antibiotic'), true);
  assert.equal(activeZhelemishSkin(player, 12), undefined);

  applyZhelemishSkin(player, 20, 'zhelemish_treated');
  state.time = 200;
  updateZhelemishSkinStatus(player, state, 1);
  assert.equal(activeZhelemishSkin(player, 200), undefined);
});
