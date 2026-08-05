import { ItemType, type ItemDef } from '../core/types';
import { PHYS_WEAPON_ROLE_TIERS, type WeaponRoleTier } from './weapons';
import { PSI_WEAPON_ROLE_TIERS } from './psi';
import { ITEMS } from './items';
import {
  CRAFT_MATERIAL_IDS,
  type CraftMaterialId,
  type CraftVector,
  type MutableCraftVector,
  craftMaterialIndex,
  emptyCraftVector,
} from './craft_materials';

const RARE_MATERIALS = ['cybernetics', 'psimatter', 'metamatter'] as const satisfies readonly CraftMaterialId[];
const WEAPON_ROLE_TIERS: Record<string, WeaponRoleTier> = {
  ...PHYS_WEAPON_ROLE_TIERS,
  ...PSI_WEAPON_ROLE_TIERS,
};

export const INTENTIONAL_RARE_MATERIAL_ITEMS: Record<string, readonly CraftMaterialId[]> = {
  gauss: ['cybernetics'],
  plasma: ['cybernetics'],
  bfg: ['cybernetics', 'metamatter'],
  gravity_beam_emitter: ['cybernetics', 'metamatter'],
  grn420_gravizhernov: ['cybernetics', 'metamatter'],
  ato41_atomic_flamer: ['cybernetics', 'metamatter'],
  ammo_energy: ['cybernetics'],
  psi_strike: ['psimatter'],
  psi_rupture: ['psimatter'],
  psi_storm: ['psimatter'],
  psi_brainburn: ['psimatter'],
  psi_madness: ['psimatter'],
  psi_control: ['psimatter'],
  psi_shield: ['psimatter'],
  psi_possession: ['psimatter', 'metamatter'],
  psi_phase: ['psimatter', 'metamatter'],
  psi_mark: ['psimatter'],
  psi_recall: ['psimatter'],
  psi_beam: ['psimatter'],
  psi_concrete_splinter: ['psimatter'],
  psi_shadow_lance: ['psimatter'],
  psi_order_seal: ['psimatter'],
  psi_void_needle: ['psimatter', 'metamatter'],
  psi_meat_hook: ['psimatter'],
  psi_siren_pulse: ['psimatter'],
  strange_clot: ['psimatter'],
  psi_dust: ['psimatter'],
  meat_rune: ['psimatter'],
  bottled_voice: ['psimatter'],
  siren_shard: ['psimatter'],
  void_spike: ['psimatter', 'metamatter'],
  idol_chernobog: ['psimatter'],
  holy_water: ['psimatter'],
  istotit_candle: ['psimatter'],
  blue_glow_sample_sealed: ['psimatter'],
  blue_glow_sample_open: ['psimatter'],
  slime_sample_silver: ['psimatter'],
  slime_sample_silver_open: ['psimatter'],
  slime_sample_seroburmaline: ['psimatter'],
  void_archive_warrant: ['metamatter'],
  chernobog_redacted_central_note: ['metamatter'],
};

const MATERIAL_TAGS: Readonly<Record<CraftMaterialId, readonly string[]>> = {
  mechanics: ['tool', 'repair', 'machine', 'weapon_part', 'breach', 'door_work', 'pump', 'filter', 'seal'],
  electronics: ['electronics', 'battery', 'radio', 'terminal', 'detector', 'lamp', 'circuit', 'wire', 'signal', 'screen'],
  consumables: ['document', 'paper', 'permit', 'coupon', 'receipt', 'form', 'resident_good', 'hygiene', 'bait', 'ration', 'trade'],
  bio: ['bait_meat', 'bait_fungal', 'zhelemish', 'mold', 'fungus', 'slime', 'sample', 'tissue', 'corpse', 'blood_plant', 'meat'],
  chemical: ['medicine', 'reagent', 'decon', 'fuel', 'acid', 'alkali', 'napalm', 'incendiary', 'smoke', 'contaminant', 'cleanup'],
  metal: ['metal', 'weapon', 'ammo', 'rifle', 'shotgun', 'grenade', 'bayonet', 'rail', 'armor', 'serial'],
  cybernetics: ['cybernetics', 'rare_energy', 'net', 'safeguard', 'silicon_net_well'],
  psimatter: ['psi', 'cult', 'istotit', 'siren', 'void'],
  metamatter: ['metamatter', 'void', 'chernobog', 'deletion_beam', 'gravity_aoe'],
};

function cv(
  mechanics = 0,
  electronics = 0,
  consumables = 0,
  bio = 0,
  chemical = 0,
  metal = 0,
  cybernetics = 0,
  psimatter = 0,
  metamatter = 0,
): CraftVector {
  return [mechanics, electronics, consumables, bio, chemical, metal, cybernetics, psimatter, metamatter];
}

function tagsOf(def: ItemDef): readonly string[] {
  return def.tags ?? [];
}

function hasAnyTag(def: ItemDef, tags: readonly string[]): boolean {
  const current = tagsOf(def);
  return tags.some(tag => current.includes(tag));
}

function idHasAny(id: string, parts: readonly string[]): boolean {
  return parts.some(part => id.includes(part));
}

function add(weights: MutableCraftVector, material: CraftMaterialId, amount: number): void {
  weights[craftMaterialIndex(material)] += amount;
}

function totalForItem(def: ItemDef): number {
  const v = def.value;
  let total = v <= 2 ? 1
    : v <= 8 ? 2
      : v <= 20 ? 3
        : v <= 60 ? 5
          : v <= 150 ? 8
            : v <= 400 ? 11
              : v <= 1_200 ? 16
                : v <= 5_000 ? 24
                  : v <= 15_000 ? 35
                    : v <= 50_000 ? 58
                      : v <= 100_000 ? 82
                        : v <= 250_000 ? 128
                          : 180;

  if (def.type === ItemType.AMMO) total = Math.max(2, Math.round(total * 0.55));
  if (def.type === ItemType.FOOD || def.type === ItemType.DRINK) total = Math.min(total, v >= 30 ? 6 : 4);
  if (def.type === ItemType.NOTE || hasAnyTag(def, ['document', 'permit', 'coupon', 'receipt', 'form'])) total = Math.min(total, v >= 100 ? 8 : 5);
  if (def.type === ItemType.KEY) total = Math.max(total, 3);
  if (WEAPON_ROLE_TIERS[def.id] === 'rare_energy' || WEAPON_ROLE_TIERS[def.id] === 'psi') total = Math.max(total, 35);
  if (INTENTIONAL_RARE_MATERIAL_ITEMS[def.id]?.includes('metamatter')) total = Math.max(total, 90);
  return total;
}

function baseWeights(def: ItemDef): MutableCraftVector {
  const weights = emptyCraftVector();
  const role = WEAPON_ROLE_TIERS[def.id];

  switch (def.type) {
    case ItemType.FOOD:
      add(weights, 'bio', 5);
      add(weights, 'consumables', 2);
      if (hasAnyTag(def, ['contaminant', 'experimental', 'bait_risky', 'zhelemish']) || idHasAny(def.id, ['infected', 'govnyak'])) add(weights, 'chemical', 2);
      break;
    case ItemType.DRINK:
      add(weights, 'consumables', 4);
      add(weights, 'chemical', 2);
      if (idHasAny(def.id, ['brew', 'kompot', 'coffee', 'energy'])) add(weights, 'bio', 1);
      break;
    case ItemType.MEDICINE:
      add(weights, 'chemical', 5);
      add(weights, 'consumables', 3);
      if (hasAnyTag(def, ['medical', 'zhelemish']) || idHasAny(def.id, ['bandage', 'morphine', 'syringe', 'cotton'])) add(weights, 'bio', 1);
      break;
    case ItemType.AMMO:
      add(weights, 'metal', 4);
      add(weights, 'chemical', 3);
      add(weights, 'consumables', 1);
      if (hasAnyTag(def, ['energy']) || idHasAny(def.id, ['energy'])) add(weights, 'electronics', 2);
      if (hasAnyTag(def, ['chemical', 'incendiary', 'fuel', 'foam'])) add(weights, 'chemical', 2);
      break;
    case ItemType.WEAPON:
      if (role === 'psi') {
        add(weights, 'psimatter', 6);
        add(weights, 'bio', 2);
        add(weights, 'chemical', 2);
        break;
      }
      if (role === 'rare_energy') {
        add(weights, 'electronics', 5);
        add(weights, 'mechanics', 3);
        add(weights, 'metal', 4);
        add(weights, 'chemical', 1);
        break;
      }
      if (role === 'grenade' || hasAnyTag(def, ['grenade', 'explosive', 'breach'])) {
        add(weights, 'chemical', 5);
        add(weights, 'metal', 3);
        add(weights, 'mechanics', 2);
        if (def.value >= 2_000) add(weights, 'electronics', 1);
        break;
      }
      if (role === 'fuel_clear' || hasAnyTag(def, ['flame', 'fuel_clear'])) {
        add(weights, 'mechanics', 3);
        add(weights, 'metal', 3);
        add(weights, 'chemical', 5);
        add(weights, 'electronics', 1);
        break;
      }
      add(weights, 'metal', 5);
      add(weights, 'mechanics', 4);
      if (role === 'ammo_burn' || role === 'pistol_sidegrade' || role === 'makarov_precise' || role === 'rifle_precision' || role === 'shotgun_corridor_stop') {
        add(weights, 'electronics', def.value >= 5_000 ? 2 : 1);
        add(weights, 'chemical', 1);
      }
      break;
    case ItemType.TOOL:
      add(weights, 'mechanics', 5);
      add(weights, 'metal', 3);
      add(weights, 'consumables', 1);
      if (hasAnyTag(def, ['electronics', 'battery', 'light', 'radio']) || idHasAny(def.id, ['flashlight', 'vacuum', 'detector', 'radio'])) add(weights, 'electronics', 4);
      if (hasAnyTag(def, ['cleanup', 'decon', 'filter'])) add(weights, 'chemical', 1);
      break;
    case ItemType.KEY:
      add(weights, 'metal', 3);
      add(weights, 'mechanics', 1);
      add(weights, 'consumables', 1);
      break;
    case ItemType.NOTE:
      add(weights, 'consumables', 4);
      if (hasAnyTag(def, ['terminal', 'electronics'])) add(weights, 'electronics', 1);
      break;
    case ItemType.MISC:
      applyMiscWeights(def, weights);
      break;
  }

  for (const material of CRAFT_MATERIAL_IDS) {
    if (hasAnyTag(def, MATERIAL_TAGS[material])) add(weights, material, 1);
  }

  for (const material of INTENTIONAL_RARE_MATERIAL_ITEMS[def.id] ?? []) {
    add(weights, material, material === 'metamatter' ? 3 : 2);
  }

  for (const material of RARE_MATERIALS) {
    if (!INTENTIONAL_RARE_MATERIAL_ITEMS[def.id]?.includes(material)) {
      weights[craftMaterialIndex(material)] = 0;
    }
  }

  return weights;
}

function applyMiscWeights(def: ItemDef, weights: MutableCraftVector): void {
  if (hasAnyTag(def, ['document', 'permit', 'coupon', 'receipt', 'form', 'paper', 'audit']) || idHasAny(def.id, ['note', 'book', 'pass', 'permit', 'coupon', 'receipt', 'order', 'warrant', 'form', 'card', 'stamp', 'tag', 'label', 'roster', 'docket', 'index'])) {
    add(weights, 'consumables', 5);
    if (idHasAny(def.id, ['stamp', 'tag', 'key', 'plate', 'seal'])) add(weights, 'metal', 1);
    if (idHasAny(def.id, ['terminal', 'screen', 'mail', 'pneumo'])) add(weights, 'electronics', 1);
  }
  if (hasAnyTag(def, ['slime', 'sample', 'zhelemish', 'fungus', 'mold', 'blood_plant']) || idHasAny(def.id, ['sample', 'slime', 'mold', 'zhelemish', 'tissue', 'swab', 'corpse'])) {
    add(weights, 'bio', 5);
    add(weights, 'chemical', 3);
    add(weights, 'consumables', 1);
  }
  if (hasAnyTag(def, ['reagent', 'fuel', 'decon', 'acid', 'alkali', 'paint', 'brewing']) || idHasAny(def.id, ['acid', 'alcohol', 'spirit', 'fluid', 'powder', 'lime', 'paint', 'fuel', 'napalm'])) {
    add(weights, 'chemical', 5);
    add(weights, 'consumables', 2);
  }
  if (hasAnyTag(def, ['electronics', 'battery', 'wire', 'terminal', 'lamp', 'screen']) || idHasAny(def.id, ['battery', 'circuit', 'wire', 'relay', 'lamp', 'keyboard', 'screen', 'emitter'])) {
    add(weights, 'electronics', 5);
    add(weights, 'mechanics', 1);
    add(weights, 'consumables', 1);
  }
  if (hasAnyTag(def, ['metal', 'repair_input', 'weapon_component', 'rail']) || idHasAny(def.id, ['metal', 'gear', 'spring', 'barrel', 'magazine', 'plate', 'bolt', 'spike', 'rail'])) {
    add(weights, 'metal', 5);
    add(weights, 'mechanics', 3);
  }
  if (hasAnyTag(def, ['contraband', 'govnyak']) || idHasAny(def.id, ['govnyak', 'cigs', 'shaving'])) {
    add(weights, 'consumables', 2);
    add(weights, 'bio', 2);
    add(weights, 'chemical', 2);
  }
  if (weights.every(value => value === 0)) {
    add(weights, 'consumables', 2);
    if (def.value >= 20) add(weights, 'mechanics', 1);
  }
}

function allocate(total: number, weights: MutableCraftVector): CraftVector {
  const positive = weights.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  if (positive === 0) return cv(0, 0, Math.max(1, total), 0, 0, 0, 0, 0, 0);

  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const out = emptyCraftVector();
  const remainders = weights.map((weight, index) => {
    const raw = weight > 0 ? total * weight / weightTotal : 0;
    const base = Math.floor(raw);
    out[index] = base;
    return { index, remainder: raw - base, weight };
  });

  let assigned = out.reduce((sum, value) => sum + value, 0);
  remainders.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight || a.index - b.index);
  for (const entry of remainders) {
    if (assigned >= total) break;
    if (entry.weight <= 0) continue;
    out[entry.index]++;
    assigned++;
  }

  if (assigned === 0) out[remainders.find(entry => entry.weight > 0)?.index ?? 2] = 1;
  return out;
}

function ensureIntentionalRareMinimum(itemId: string, vector: CraftVector): CraftVector {
  const intended = INTENTIONAL_RARE_MATERIAL_ITEMS[itemId] ?? [];
  if (intended.length === 0) return vector;
  const out: MutableCraftVector = [...vector];
  for (const material of intended) {
    const index = craftMaterialIndex(material);
    if (out[index] > 0) continue;
    const donor = out
      .map((value, donorIndex) => ({ value, donorIndex }))
      .filter(entry => entry.value > 1 && !RARE_MATERIALS.includes(CRAFT_MATERIAL_IDS[entry.donorIndex] as typeof RARE_MATERIALS[number]))
      .sort((a, b) => b.value - a.value)[0];
    if (donor) out[donor.donorIndex]--;
    out[index]++;
  }
  return out;
}

export function compositionForItemDef(def: ItemDef): CraftVector {
  return ensureIntentionalRareMinimum(def.id, allocate(totalForItem(def), baseWeights(def)));
}

export const ITEM_COMPOSITIONS: Record<string, CraftVector> = Object.freeze(
  Object.fromEntries(Object.values(ITEMS).map(def => [def.id, compositionForItemDef(def)])),
);

export interface ItemCompositionDef {
  itemId: string;
  components: CraftVector;
  craftable?: boolean;
  discoverable?: boolean;
  station?: 'any' | 'workbench' | 'lathe' | 'lab' | 'net_terminal';
  recipeTier?: 0 | 1 | 2 | 3 | 4;
  tags?: readonly string[];
}

export function itemComposition(itemId: string): ItemCompositionDef | undefined {
  const components = ITEM_COMPOSITIONS[itemId];
  return components ? { itemId, components, craftable: true, discoverable: true } : undefined;
}
