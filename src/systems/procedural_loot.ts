import { Faction, type ItemDef, ItemType, type Item } from '../core/types';
import { ITEMS, itemEquipSlot, itemDefHasTag } from '../data/items';

export interface LootProfile {
  weaponMult?: number;
  ammoMult?: number;
  toolMult?: number;
  medicineMult?: number;
  foodMult?: number;
  drinkMult?: number;
  miscMult?: number;
  tagWeights?: Record<string, number>;
}

export const FACTION_LOOT_PROFILES: Record<Faction, LootProfile> = {
  [Faction.LIQUIDATOR]: { weaponMult: 3, ammoMult: 4, toolMult: 2, tagWeights: { 'liquidator': 5, 'firearm': 4, 'military': 3 } },
  [Faction.CULTIST]: { weaponMult: 1, medicineMult: 2, tagWeights: { 'psi': 5, 'psi_restore': 4, 'cult': 3 } },
  [Faction.SCIENTIST]: { toolMult: 3, medicineMult: 3, tagWeights: { 'science': 5, 'energy': 4, 'nii': 3 } },
  [Faction.WILD]: { weaponMult: 2, tagWeights: { 'melee': 4, 'homemade': 3, 'pipe': 5 } },
  [Faction.CITIZEN]: { foodMult: 3, drinkMult: 3, miscMult: 2, tagWeights: { 'resident_good': 5, 'trash': 3 } },
  [Faction.PLAYER]: {},
};

export function calculateMaxLootValue(level: number, danger: number, faction: Faction): number {
  let base = 10 + (level * 3) + (danger * 10);
  if (faction === Faction.LIQUIDATOR) base += 20;
  if (faction === Faction.SCIENTIST) base += 15;
  return base;
}

const ITEMS_ARRAY = Object.freeze(Object.values(ITEMS));

export function buildLootPool(profile: LootProfile, maxAllowedValue: number): { item: ItemDef, weight: number }[] {
  const pool: { item: ItemDef, weight: number }[] = [];
  for (const item of ITEMS_ARRAY) {
    if (item.value > maxAllowedValue) continue;

    let baseWeight = item.spawnW || 0;
    if (baseWeight <= 0) continue;

    if (profile.weaponMult && item.type === ItemType.WEAPON) baseWeight *= profile.weaponMult;
    if (profile.ammoMult && item.type === ItemType.AMMO) baseWeight *= profile.ammoMult;
    if (profile.toolMult && item.type === ItemType.TOOL) baseWeight *= profile.toolMult;
    if (profile.medicineMult && item.type === ItemType.MEDICINE) baseWeight *= profile.medicineMult;
    if (profile.foodMult && item.type === ItemType.FOOD) baseWeight *= profile.foodMult;
    if (profile.drinkMult && item.type === ItemType.DRINK) baseWeight *= profile.drinkMult;
    if (profile.miscMult && item.type === ItemType.MISC) baseWeight *= profile.miscMult;

    if (profile.tagWeights) {
      for (const [tag, weight] of Object.entries(profile.tagWeights)) {
        if (itemDefHasTag(item, tag)) {
          baseWeight *= weight;
        }
      }
    }

    if (baseWeight > 0) {
      pool.push({ item, weight: baseWeight });
    }
  }
  return pool;
}

export function pickLootFromPool(pool: { item: ItemDef, weight: number }[], roll: number): ItemDef | undefined {
  if (pool.length === 0) return undefined;
  let totalWeight = 0;
  for (const p of pool) totalWeight += p.weight;
  
  let target = roll * totalWeight;
  let selected = pool[pool.length - 1].item;

  for (const p of pool) {
    target -= p.weight;
    if (target <= 0) {
      selected = p.item;
      break;
    }
  }
  return selected;
}

export function generateNpcLoadout(faction: Faction, level: number, danger: number, rollWeapon: number, rollPockets: number[]): { weapon?: string; tool?: string; inventory?: Item[] } {
  const profile = FACTION_LOOT_PROFILES[faction] || {};
  const maxVal = calculateMaxLootValue(level, danger, faction);
  
  // 1. Pick weapon
  const weaponProfile = { ...profile, tagWeights: { ...profile.tagWeights } };
  weaponProfile.foodMult = 0; weaponProfile.drinkMult = 0; weaponProfile.medicineMult = 0; weaponProfile.miscMult = 0; weaponProfile.ammoMult = 0; weaponProfile.toolMult = 0;
  weaponProfile.weaponMult = (weaponProfile.weaponMult || 1) * 10; 
  
  const weaponPool = buildLootPool(weaponProfile, maxVal).filter(p => p.item.type === ItemType.WEAPON || itemEquipSlot(p.item) === 'tool');
  let weaponDef = pickLootFromPool(weaponPool, rollWeapon);

  let weaponId: string | undefined;
  let toolId: string | undefined;
  const inventory: Item[] = [];

  // Explicitly give cultists a PSI clot, regardless of maxVal limits
  // But we use rollWeapon directly to simulate the pick.
  if (faction === Faction.CULTIST && rollWeapon > 0.02) {
    const clotId = rollWeapon > 0.85 ? 'psi_storm' : 'psi_strike';
    weaponDef = ITEMS[clotId];
  }

  if (weaponDef) {
    if (itemEquipSlot(weaponDef) === 'tool') toolId = weaponDef.id;
    else weaponId = weaponDef.id;
    
    inventory.push({ defId: weaponDef.id, count: 1 });
    
    if (itemDefHasTag(weaponDef, 'ammo_9mm')) inventory.push({ defId: 'ammo_9mm', count: 10 + Math.floor(rollWeapon * 20) });
    else if (itemDefHasTag(weaponDef, 'ammo_762')) inventory.push({ defId: 'ammo_762', count: 10 + Math.floor(rollWeapon * 20) });
    else if (itemDefHasTag(weaponDef, 'ammo_shells')) inventory.push({ defId: 'ammo_shells', count: 4 + Math.floor(rollWeapon * 8) });
  }

  // 2. Pick pockets
  const pocketProfile = { ...profile };
  pocketProfile.weaponMult = 0;
  const pocketPool = buildLootPool(pocketProfile, Math.max(5, maxVal * 0.5));
  
  for (const r of rollPockets) {
    const item = pickLootFromPool(pocketPool, r);
    if (item) {
      inventory.push({ defId: item.id, count: 1 });
    }
  }

  return { weapon: weaponId, tool: toolId, inventory: inventory.length > 0 ? inventory : undefined };
}

export function generateContainerLoot(tags: readonly string[], proceduralValueCap: number | undefined, level: number, rollItems: number[]): Item[] {
  const profile: LootProfile = { tagWeights: {} };
  
  if (tags.includes('food')) { profile.foodMult = 3; profile.drinkMult = 2; }
  if (tags.includes('medical')) { profile.medicineMult = 4; }
  if (tags.includes('weapon')) { profile.weaponMult = 3; profile.ammoMult = 3; }
  if (tags.includes('ammo')) { profile.ammoMult = 4; }
  if (tags.includes('tools')) { profile.toolMult = 4; }
  if (tags.includes('paper') || tags.includes('valuable')) { profile.miscMult = 3; }
  
  for (const tag of tags) {
    if (!profile.tagWeights) profile.tagWeights = {};
    profile.tagWeights[tag] = 5;
  }

  const maxVal = proceduralValueCap ?? (10 + level * 10);
  const pool = buildLootPool(profile, maxVal);
  
  const inventory: Item[] = [];
  for (const r of rollItems) {
    const itemDef = pickLootFromPool(pool, r);
    if (itemDef) {
      inventory.push({ defId: itemDef.id, count: 1 });
    }
  }
  return inventory;
}

export function generateMerchantStock(faction: Faction | undefined, level: number, danger: number, rollItems: number[]): Item[] {
  const baseFaction = faction ?? Faction.CITIZEN;
  const profile = FACTION_LOOT_PROFILES[baseFaction] || {};
  const maxVal = calculateMaxLootValue(level, danger, baseFaction) * 3; // Merchants sell higher-tier items
  
  const pool = buildLootPool(profile, maxVal);
  
  const inventory: Item[] = [];
  for (const r of rollItems) {
    const itemDef = pickLootFromPool(pool, r);
    if (itemDef) {
      inventory.push({ defId: itemDef.id, count: 1 });
    }
  }
  return inventory;
}
