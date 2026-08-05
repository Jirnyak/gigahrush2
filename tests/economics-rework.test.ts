import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import {
  ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER,
  ECONOMY_PSI_MIN_VALUE,
  ECONOMY_PSI_WEAPON_IDS,
  ECONOMY_RARE_ENERGY_WEAPON_IDS,
  ECONOMY_TOP_GEAR_MIN_VALUES,
  economyProgressBandForDepth,
  proceduralContainerValueCap,
  proceduralLootValueCap,
} from '../src/data/economics';
import { PSI_WEAPON_STATS } from '../src/data/psi';
import { PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER } from '../src/data/procedural_floors';
import { resourceForItem } from '../src/data/resources';
import { calculateQuestReward } from '../src/systems/quest_rewards';

test('economy weapon ladder prices PSI, energy and late gear for long progression', () => {
  assert.deepEqual([...ECONOMY_PSI_WEAPON_IDS].sort(), Object.keys(PSI_WEAPON_STATS).sort());

  for (const id of ECONOMY_PSI_WEAPON_IDS) {
    const def = ITEMS[id];
    assert.ok(def, `${id} must exist`);
    assert.equal(def.type, ItemType.WEAPON, `${id} must stay a universal weapon item`);
    assert.ok(def.value >= ECONOMY_PSI_MIN_VALUE, `${id} must cost at least ${ECONOMY_PSI_MIN_VALUE}`);
    assert.equal(resourceForItem(id)?.id, 'psi', `${id} must trade through the PSI resource`);
  }

  for (const [id, minValue] of Object.entries(ECONOMY_TOP_GEAR_MIN_VALUES)) {
    assert.ok((ITEMS[id]?.value ?? 0) >= minValue, `${id} must stay above its top-gear floor`);
  }

  for (const id of ECONOMY_RARE_ENERGY_WEAPON_IDS) {
    assert.equal(resourceForItem(id)?.id, 'electronics', `${id} must use the rare electronics economy`);
  }

  assert.ok(ITEMS.ammo_energy.value >= 100 && ITEMS.ammo_energy.value <= 500);
  assert.ok(ITEMS.psi_stabilizer.value >= 250);
});

test('physical weapon price floors keep early cash meaningful and late weapons expensive', () => {
  for (const id of ['homemade_pistol', 'karkarov_pistol', 'makarov']) {
    assert.ok((ITEMS[id]?.value ?? 0) >= 300, `${id} must not be cheaper than an early sidearm floor`);
  }
  assert.ok(ITEMS.karkarov_pistol.value < ITEMS.makarov.value);

  for (const id of ['shotgun', 'toz_shotgun', 'conscripts_doublebarrel', 'ppsh', 'slyoznev_pps41']) {
    assert.ok((ITEMS[id]?.value ?? 0) >= 900, `${id} must not fit casual starting cash`);
  }

  for (const id of [
    'ak47', 'eralashnikov_auto', 'nosin_rifle', 'moskvin_rifle',
    'flamethrower', 'agnia_a130', 'roks47_flamethrower',
    'machinegun', 'rpl23_lmg', 'pistol_grenade_launcher',
    'party_might_launcher', 'g41_grenade_launcher',
  ]) {
    assert.ok((ITEMS[id]?.value ?? 0) >= 5_000, `${id} must live in the midgame weapon economy`);
  }

  assert.ok(ITEMS.losyash_rifle.value >= 40_000);
  assert.ok(ITEMS.granit4u_belt_shotgun.value >= 100_000);
});

test('procedural loot caps are danger and depth bounded', () => {
  assert.deepEqual(PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER, ECONOMY_PROCEDURAL_LOOT_VALUE_CAP_BY_DANGER);
  assert.equal(economyProgressBandForDepth(0), 'E0');
  assert.equal(economyProgressBandForDepth(-46), 'E4');

  assert.equal(proceduralLootValueCap(5), 250_000);
  assert.equal(proceduralLootValueCap(5, 0), 90);
  assert.equal(proceduralLootValueCap(5, -46), 250_000);
  assert.equal(proceduralContainerValueCap(ContainerKind.EMERGENCY_BOX, 5, -46), 180);
  assert.equal(proceduralContainerValueCap(ContainerKind.WEAPON_CRATE, 5, 0), 90);
  assert.equal(proceduralContainerValueCap(ContainerKind.WEAPON_CRATE, 5, -46), 250_000);
});

test('quest reward math scales by depth and tags while save difficulty stays bounded', () => {
  const early = calculateQuestReward({
    objectiveKind: 'talk',
    currentZ: 0,
    targetZ: 0,
    danger: 1,
    risk: 1,
  });
  assert.equal(early.band, 'E0');
  assert.ok(early.moneyReward > 0);
  assert.ok(early.moneyReward <= early.moneyCap);
  assert.ok(early.difficulty <= 10);

  const deepNoMajor = calculateQuestReward({
    objectiveKind: 'hold',
    objectiveValue: 500_000,
    currentZ: 0,
    targetZ: -50,
    danger: 5,
    risk: 5,
    giverLevel: 60,
    giverWealth: 5_000_000,
  });
  assert.equal(deepNoMajor.band, 'E4');
  assert.equal(deepNoMajor.moneyCap, 99_000);
  assert.ok(deepNoMajor.moneyReward <= 99_000);
  assert.ok(deepNoMajor.difficulty <= 10);

  const deepMajor = calculateQuestReward({
    objectiveKind: 'hold',
    objectiveValue: 500_000,
    currentZ: 0,
    targetZ: -50,
    danger: 5,
    risk: 5,
    giverLevel: 60,
    giverWealth: 5_000_000,
    tags: ['major_asset'],
  });
  assert.equal(deepMajor.moneyCap, 250_000);
  assert.ok(deepMajor.moneyReward > deepNoMajor.moneyReward);
  assert.ok(deepMajor.difficulty <= 10);
});
