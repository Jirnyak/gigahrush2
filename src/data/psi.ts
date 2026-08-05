/* ── ПСИ сгустки — PSI weapon stats ──────────────────────────── */

import type { WeaponStats } from './weapons';
import type { WeaponRoleTier } from './weapons';
import { DamageType } from '../core/types';
import { Spr } from '../render/sprite_index';

export const PSI_WEAPON_STATS: Record<string, WeaponStats> = {
  psi_strike:   { damageType: DamageType.PSI, dmg: 12, durability: 0, range: 0, speed: 0.42, isRanged: true,  psiCost: 3,  projSpeed: 18, projSprite: Spr.PSI_BOLT },
  psi_rupture:  { damageType: DamageType.PSI, dmg: 18, durability: 0, range: 0, speed: 1.25, isRanged: true,  psiCost: 8,  projSpeed: 12, projSprite: Spr.PSI_BOLT, aoeRadius: 3 },
  psi_storm:    { damageType: DamageType.PSI, dmg: 18, durability: 0, range: 0, speed: 1.75, isRanged: false, psiCost: 19, psiEffect: 'storm' },
  psi_brainburn:{ damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 1.8,  isRanged: false, psiCost: 22, psiEffect: 'brain_burn' },
  psi_madness:  { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 1.05, isRanged: false, psiCost: 10, psiEffect: 'madness' },
  psi_control:  { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 1.35, isRanged: false, psiCost: 20, psiEffect: 'control' },
  psi_shield:   { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 0.9,  isRanged: false, psiCost: 12, psiEffect: 'shield' },
  psi_possession:{ damageType: DamageType.PSI, dmg: 0, durability: 0, range: 0, speed: 1.6,  isRanged: false, psiCost: 26, psiEffect: 'possession' },
  psi_phase:    { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 1.0,  isRanged: false, psiCost: 17, psiEffect: 'phase' },
  psi_mark:     { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 0.40, isRanged: false, psiCost: 4,  psiEffect: 'mark' },
  psi_recall:   { damageType: DamageType.PSI, dmg: 0,  durability: 0, range: 0, speed: 0.65, isRanged: false, psiCost: 8,  psiEffect: 'recall' },
  psi_beam:     { damageType: DamageType.PSI, dmg: 28, durability: 0, range: 0, speed: 0.75, isRanged: false, psiCost: 14, psiEffect: 'beam' },
  psi_concrete_splinter:{ damageType: DamageType.PSI, dmg: 23, durability: 0, range: 0, speed: 0.72, isRanged: true, psiCost: 6, projSpeed: 17, projSprite: Spr.PSI_BOLT },
  psi_shadow_lance:{ damageType: DamageType.PSI, dmg: 44, durability: 0, range: 0, speed: 0.95, isRanged: true, psiCost: 12, projSpeed: 25, projSprite: Spr.PSI_BOLT },
  psi_order_seal:{ damageType: DamageType.PSI, dmg: 27, durability: 0, range: 0, speed: 1.25, isRanged: true, psiCost: 12, projSpeed: 12, projSprite: Spr.PSI_BOLT, aoeRadius: 2.2 },
  psi_void_needle:{ damageType: DamageType.PSI, dmg: 96, durability: 0, range: 0, speed: 1.7, isRanged: true, psiCost: 23, projSpeed: 29, projSprite: Spr.PSI_BOLT },
  psi_meat_hook:{ damageType: DamageType.PSI, dmg: 50, durability: 0, range: 0, speed: 1.25, isRanged: true, psiCost: 13, projSpeed: 10, projSprite: Spr.PSI_BOLT },
  psi_siren_pulse:{ damageType: DamageType.PSI, dmg: 22, durability: 0, range: 0, speed: 1.35, isRanged: true, psiCost: 13, projSpeed: 18, projSprite: Spr.PSI_BOLT, aoeRadius: 3 },
};

export const PSI_WEAPON_ROLE_TIERS: Record<string, WeaponRoleTier> = Object.fromEntries(
  Object.keys(PSI_WEAPON_STATS).map(id => [id, 'psi' satisfies WeaponRoleTier]),
);
