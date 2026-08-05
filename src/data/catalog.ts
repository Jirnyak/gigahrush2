/* ── Game data catalogue — barrel re-export ──────────────────── */
/*  Отдельные модули:
 *    weapons.ts  — WeaponStats + физ. оружие
 *    psi.ts      — ПСИ-сгустки
 *    rooms.ts    — RoomDef + ROOM_DEFS
 *    items.ts    — ITEMS
 *    names.ts    — randomName, freshNeeds
 *    notes.ts    — NOTES (лор-записки)
 */

import {
  PHYS_WEAPON_ROLE_TIERS,
  PHYS_WEAPON_STATS,
  WEAPON_ROLE_LABELS,
  type WeaponRoleTier,
  type WeaponStats,
} from './weapons';
import { PSI_WEAPON_ROLE_TIERS, PSI_WEAPON_STATS } from './psi';

// Merged weapon registry (physical + PSI)
export const WEAPON_STATS: Record<string, WeaponStats> = {
  ...PHYS_WEAPON_STATS,
  ...PSI_WEAPON_STATS,
};

export const WEAPON_ROLE_TIERS: Record<string, WeaponRoleTier> = {
  ...PHYS_WEAPON_ROLE_TIERS,
  ...PSI_WEAPON_ROLE_TIERS,
};

export type { WeaponRoleTier, WeaponStats } from './weapons';
export { WEAPON_ROLE_LABELS };
export { ROOM_DEFS, type RoomDef } from './rooms';
export { ITEMS } from './items';
export {
  CRAFT_MATERIAL_IDS,
  CRAFT_MATERIALS,
  type CraftMaterialDef,
  type CraftMaterialId,
  type CraftVector,
  type MutableCraftVector,
} from './craft_materials';
export { ITEM_COMPOSITIONS, INTENTIONAL_RARE_MATERIAL_ITEMS } from './item_composition';
export {
  CRAFT_RECIPES,
  CRAFT_RECIPE_EXCEPTIONS,
  type CraftRecipeDef,
  type CraftRecipeTier,
  type CraftStationKind,
} from './craft_recipes';
export { randomName, type NameResult, freshNeeds } from './names';
export { NOTES } from './notes';
export {
  PLOT_CHAIN,
  designNpcFloorKey,
  getPlotDef,
  isPlotNpc,
  plotNpcHomeFloorKey,
  registerAuthoredNpc,
  registerFloorSideQuest,
  storyNpcFloorKey,
  type PlotNpcDef,
  type PlotStep,
} from './plot';
export { PLOT_ROOMS, type PlotRoomDef } from './plot_rooms';
export { generateNpcTradeItems } from './occupation_profiles';
export {
  allNpcPackages,
  compileNpcPackageForEditor,
  getNpcPackage,
  getNpcPackageByPlotNpcId,
  npcPackageDisplayName,
  plotNpcIdFromPackage,
  registerNpcPackage,
  registerNpcPackageFromPlotNpc,
  registerNpcPackages,
  validateNpcPackages,
  type NpcPackageDef,
} from './npc_packages';
export { ZHELEMISH_DEFS, ZHELEMISH_ITEM_IDS, getZhelemishDef, validateZhelemishDefs, type ZhelemishDef, type ZhelemishItemId } from './zhelemish_defs';
