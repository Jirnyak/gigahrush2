/* ── Weapon stats registry — melee & ranged physical weapons ─── */

import { Spr } from '../render/sprite_index';
import { ProjType, DamageType } from '../core/types';

export interface WeaponStats {
  dmg: number;
  damageType?: DamageType;
  durability: number;   // max durability for melee (0 = infinite/fists)
  range: number;        // melee reach in cells
  hitRadius?: number;   // melee hit capsule radius (e.g. 0.5 for fists, wider for large weapons)
  speed: number;        // attack cooldown seconds
  magazineSize?: number;
  reloadTime?: number;
  isRanged: boolean;

  ammoType?: string;    // item def id for ammo
  projSpeed?: number;   // projectile speed (cells/sec)
  pellets?: number;     // projectiles per shot (shotgun)
  spread?: number;      // spread angle in radians
  projSprite?: number;  // sprite index for projectile
  psiCost?: number;     // PSI cost per cast (if set, uses PSI instead of ammo)
  aoeRadius?: number;   // AoE explosion radius on projectile impact
  psiEffect?: string;   // instant PSI effect id (non-projectile spells)
  projType?: ProjType;  // special projectile behaviour
  deletionBeam?: boolean; // instant bounded beam that deletes cells/entities
  beamRange?: number;   // max deletion beam range in cells
  beamWidth?: number;   // half-width of deletion beam in cells
  soundId?: string;     // weapon sound id (for dispatching)
  knockback?: number;   // melee stop distance in cells, capped by systems
}

export type WeaponRoleTier =
  | 'unarmed'
  | 'melee_emergency'
  | 'industrial_tool'
  | 'melee_reach'
  | 'melee_heavy'
  | 'melee_control'
  | 'makarov_precise'
  | 'pistol_sidegrade'
  | 'rifle_precision'
  | 'shotgun_corridor_stop'
  | 'ammo_burn'
  | 'grenade'
  | 'rare_energy'
  | 'fuel_clear'
  | 'psi';

export const WEAPON_ROLE_LABELS: Record<WeaponRoleTier, string> = {
  unarmed: 'кулаки',
  melee_emergency: 'авар. ближ.',
  industrial_tool: 'индустр.',
  melee_reach: 'длинн. ближ.',
  melee_heavy: 'тяж. ближ.',
  melee_control: 'стоп-ближ.',
  makarov_precise: 'точный ПМ',
  pistol_sidegrade: 'особ. пист.',
  rifle_precision: 'винт. точн.',
  shotgun_corridor_stop: 'стоппер',
  ammo_burn: 'расход патр.',
  grenade: 'взрыв',
  rare_energy: 'редк. энерго',
  fuel_clear: 'зачистка',
  psi: 'ПСИ',
};

export const PHYS_WEAPON_STATS: Record<string, WeaponStats> = {
  '':       { dmg: 3,  durability: 0,   range: 0.5, speed: 0.34, isRanged: false, knockback: 0.06, hitRadius: 0.5 },
  knife:    { dmg: 7,  durability: 32,  range: 0.5, speed: 0.20, isRanged: false, knockback: 0.10, hitRadius: 0.5 },
  wrench:   { dmg: 12, durability: 115, range: 1.45, speed: 0.43, isRanged: false, knockback: 0.20 },
  pipe:     { dmg: 19, durability: 60,  range: 1.85, speed: 0.64, isRanged: false, knockback: 0.36, hitRadius: 0.7 },
  rebar:    { dmg: 24, durability: 95,  range: 2.1,  speed: 0.82, isRanged: false, knockback: 0.42 },
  axe:      { dmg: 34, durability: 65,  range: 1.5,  speed: 0.94, isRanged: false, knockback: 0.34 },
  chainsaw: { dmg: 42, durability: 14,  range: 1.35, speed: 0.21, isRanged: false, soundId: 'chainsaw', knockback: 0.18 },
  makarov: { magazineSize: 8, dmg: 22, durability: 0,   range: 0,    speed: 0.52, isRanged: true, ammoType: 'ammo_9mm',      projSpeed: 22, pellets: 1, spread: 0.012, projSprite: Spr.BULLET },
  ppsh:     { dmg: 8,  durability: 0,   range: 0,    speed: 0.07, isRanged: true, ammoType: 'ammo_9mm',      projSpeed: 18, pellets: 1, spread: 0.15,  projSprite: Spr.BULLET, soundId: 'ppsh' },
  shotgun:  { dmg: 12, durability: 0,   range: 0,    speed: 1.2,  isRanged: true, ammoType: 'ammo_shells',   projSpeed: 15, pellets: 7, spread: 0.34,  projSprite: Spr.PELLET, soundId: 'shotgun' },
  nailgun:  { dmg: 14, durability: 0,   range: 0,    speed: 0.33, isRanged: true, ammoType: 'ammo_nails',    projSpeed: 20, pellets: 1, spread: 0.014, projSprite: Spr.NAIL, soundId: 'nailgun' },
  ak47: { magazineSize: 30, dmg: 26, durability: 0,   range: 0,    speed: 0.14, isRanged: true, ammoType: 'ammo_762',      projSpeed: 25, pellets: 1, spread: 0.09,  projSprite: Spr.BULLET },
  machinegun:{ dmg: 13, durability: 0,  range: 0,    speed: 0.05, isRanged: true, ammoType: 'ammo_belt',     projSpeed: 21, pellets: 1, spread: 0.20,  projSprite: Spr.BULLET, soundId: 'machinegun' },
  grenade:  { dmg: 90, durability: 0,   range: 0,    speed: 1.9,  isRanged: true, ammoType: 'grenade',       projSpeed: 9,  pellets: 1, spread: 0,     projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 4.5, soundId: 'grenade' },
  gauss:    { dmg: 180, durability: 0,  range: 0,    speed: 2.6,  isRanged: true, ammoType: 'ammo_energy',   projSpeed: 44, pellets: 1, spread: 0,     projSprite: Spr.GAUSS_BOLT, soundId: 'gauss' },
  plasma:   { dmg: 26, durability: 0,   range: 0,    speed: 0.16, isRanged: true, ammoType: 'ammo_energy',   projSpeed: 14, pellets: 1, spread: 0.18,  projSprite: Spr.PLASMA_BOLT, soundId: 'plasma' },
  bfg:      { dmg: 270, durability: 0,  range: 0,    speed: 4.5,  isRanged: true, ammoType: 'ammo_energy',   projSpeed: 6.5, pellets: 1, spread: 0,    projSprite: Spr.BFG_BOLT, projType: ProjType.BFG, aoeRadius: 9, soundId: 'bfg' },
  gravity_beam_emitter: { magazineSize: Infinity, dmg: 500, durability: 0, range: 0, speed: 7.5, isRanged: true, ammoType: 'ammo_energy', pellets: 1, spread: 0, projSprite: Spr.GAUSS_BOLT, projType: ProjType.BEAM, deletionBeam: true, beamRange: 30, beamWidth: 0.72, soundId: 'bfg' },
  grn420_gravizhernov: { magazineSize: 1, dmg: 210, durability: 0, range: 0, speed: 5.8, isRanged: true, ammoType: 'ammo_energy', projSpeed: 5.4, pellets: 1, spread: 0.012, projSprite: Spr.BFG_BOLT, projType: ProjType.BFG, aoeRadius: 7.2, soundId: 'bfg' },
  flamethrower: { magazineSize: Infinity, dmg: 6, durability: 0, range: 0,    speed: 0.06, isRanged: true, ammoType: 'ammo_fuel',     projSpeed: 7,  pellets: 1, spread: 0.26,  projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, soundId: 'flame' },
  hammer:   { dmg: 13, durability: 65,  range: 1.35, speed: 0.33, isRanged: false, knockback: 0.22 },
  crowbar:  { dmg: 24, durability: 120, range: 1.75, speed: 0.72, isRanged: false, knockback: 0.40 },
  sledgehammer:{ dmg: 52, durability: 85, range: 1.7, speed: 1.35, isRanged: false, knockback: 0.65 },
  fire_hook:{ dmg: 18, durability: 80,  range: 2.35, speed: 0.86, isRanged: false, knockback: 0.36 },
  entrenching_spade:{ dmg: 16, durability: 100, range: 1.45, speed: 0.43, isRanged: false, knockback: 0.20 },
  bayonet:  { dmg: 13, durability: 65,  range: 1.8,  speed: 0.29, isRanged: false, knockback: 0.12 },
  chain:    { dmg: 14, durability: 75,  range: 2.05, speed: 0.48, isRanged: false, knockback: 0.24 },
  metal_chair:{ dmg: 18, durability: 22, range: 1.65, speed: 0.90, isRanged: false, knockback: 0.58 },
  tt_pistol: { magazineSize: 8, dmg: 34, durability: 0, range: 0, speed: 0.55, isRanged: true, ammoType: 'ammo_762tt', projSpeed: 23, pellets: 1, spread: 0.050, projSprite: Spr.BULLET },
  nagant: { magazineSize: 7, dmg: 48, durability: 0, range: 0, speed: 1.25, isRanged: true, ammoType: 'ammo_nagant', projSpeed: 23, pellets: 1, spread: 0.006, projSprite: Spr.BULLET },
  homemade_pistol: { magazineSize: 1, dmg: 27, durability: 0, range: 0, speed: 0.92, isRanged: true, ammoType: 'ammo_9mm', projSpeed: 15, pellets: 1, spread: 0.20, projSprite: Spr.BULLET },
  toz_shotgun: { magazineSize: 2, dmg: 11, durability: 0, range: 0, speed: 1.6, isRanged: true, ammoType: 'ammo_shells', projSpeed: 20, pellets: 8, spread: 0.13, projSprite: Spr.PELLET, soundId: 'shotgun' },
  harpoon_gun: { magazineSize: 1, dmg: 88, durability: 0, range: 0, speed: 2.35, isRanged: true, ammoType: 'ammo_harpoon', projSpeed: 18, pellets: 1, spread: 0.003, projSprite: Spr.NAIL, soundId: 'nailgun' },
  rusty_rake:{ dmg: 10, durability: 28, range: 2.15, speed: 0.92, isRanged: false, knockback: 0.22, hitRadius: 0.9 },
  liquidator_rake:{ dmg: 11, durability: 70, range: 2.2, speed: 0.68, isRanged: false, knockback: 0.26, hitRadius: 0.9 },
  rake_bayonet:{ dmg: 14, durability: 55, range: 2.0, speed: 0.38, isRanged: false, knockback: 0.12, hitRadius: 0.9 },
  liquidator_axe:{ dmg: 38, durability: 110, range: 1.5, speed: 1.08, isRanged: false, knockback: 0.42 },
  shock_baton:{ dmg: 9, durability: 80, range: 1.4, speed: 0.30, isRanged: false, knockback: 0.48 },
  rubber_club:{ dmg: 8, durability: 90, range: 1.5, speed: 0.42, isRanged: false, knockback: 0.55 },
  karkarov_pistol: { magazineSize: 8, dmg: 18, durability: 0, range: 0, speed: 0.48, isRanged: true, ammoType: 'ammo_9mm', projSpeed: 21, pellets: 1, spread: 0.035, projSprite: Spr.BULLET },
  zatychkin_pistol: { magazineSize: 8, dmg: 17, durability: 0, range: 0, speed: 0.18, isRanged: true, ammoType: 'ammo_9mm', projSpeed: 20, pellets: 1, spread: 0.08, projSprite: Spr.BULLET },
  slyoznev_pps41: { magazineSize: 71, dmg: 7, durability: 0, range: 0, speed: 0.055, isRanged: true, ammoType: 'ammo_9mm', projSpeed: 18, pellets: 1, spread: 0.19, projSprite: Spr.BULLET, soundId: 'ppsh' },
  eralashnikov_auto: { magazineSize: 30, dmg: 23, durability: 0, range: 0, speed: 0.12, isRanged: true, ammoType: 'ammo_762', projSpeed: 24, pellets: 1, spread: 0.11, projSprite: Spr.BULLET },
  nosin_rifle: { magazineSize: 5, dmg: 55, durability: 0, range: 0, speed: 1.45, isRanged: true, ammoType: 'ammo_762', projSpeed: 26, pellets: 1, spread: 0.018, projSprite: Spr.BULLET },
  moskvin_rifle: { magazineSize: 5, dmg: 76, durability: 0, range: 0, speed: 1.90, isRanged: true, ammoType: 'ammo_762', projSpeed: 29, pellets: 1, spread: 0.006, projSprite: Spr.BULLET },
  losyash_rifle: { magazineSize: 1, dmg: 140, durability: 0, range: 0, speed: 2.85, isRanged: true, ammoType: 'rifle_bolt_pack', projSpeed: 32, pellets: 1, spread: 0.002, projSprite: Spr.NAIL, soundId: 'nailgun' },
  ptrs_liquidator: { magazineSize: 5, dmg: 170, durability: 0, range: 0, speed: 4.25, isRanged: true, ammoType: 'ammo_harpoon', projSpeed: 34, pellets: 1, spread: 0.0015, projSprite: Spr.NAIL, soundId: 'nailgun' },
  tanev_svt40: { magazineSize: 10, dmg: 105, durability: 0, range: 0, speed: 2.55, isRanged: true, ammoType: 'ammo_762', projSpeed: 33, pellets: 1, spread: 0.002, projSprite: Spr.BULLET },
  ato41_atomic_flamer: { magazineSize: Infinity, dmg: 160, durability: 0, range: 0, speed: 4.8, isRanged: true, ammoType: 'ato41_atomic_flamer', pellets: 1, spread: 0, projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, deletionBeam: true, beamRange: 12, beamWidth: 0.52, soundId: 'flame' },
  chizh3_shotgun: { magazineSize: 2, dmg: 13, durability: 0, range: 0, speed: 1.0, isRanged: true, ammoType: 'ammo_shells', projSpeed: 17, pellets: 8, spread: 0.24, projSprite: Spr.PELLET, soundId: 'shotgun' },
  conscripts_doublebarrel: { magazineSize: 2, dmg: 10, durability: 0, range: 0, speed: 1.45, isRanged: true, ammoType: 'ammo_shells', projSpeed: 15, pellets: 7, spread: 0.28, projSprite: Spr.PELLET, soundId: 'shotgun' },
  rb91_auto_shotgun: { magazineSize: 10, dmg: 11, durability: 0, range: 0, speed: 0.65, isRanged: true, ammoType: 'ammo_shells', projSpeed: 16, pellets: 9, spread: 0.30, projSprite: Spr.PELLET, soundId: 'shotgun' },
  chest_failsafe_charge: { magazineSize: Infinity, dmg: 175, durability: 0, range: 0, speed: 3.4, isRanged: true, ammoType: 'chest_failsafe_charge', projSpeed: 3.5, pellets: 1, spread: 0, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 6.2, soundId: 'grenade' },
  granit4u_belt_shotgun: { magazineSize: 20, dmg: 8, durability: 0, range: 0, speed: 2.35, isRanged: true, ammoType: 'ammo_shells', projSpeed: 14, pellets: 12, spread: 0.46, projSprite: Spr.PELLET, soundId: 'shotgun' },
  pushkin_shotgun: { magazineSize: 6, dmg: 14, durability: 0, range: 0, speed: 0.82, isRanged: true, ammoType: 'ammo_shells', projSpeed: 19, pellets: 6, spread: 0.12, projSprite: Spr.PELLET, soundId: 'shotgun' },
  rpl23_lmg: { magazineSize: 100, dmg: 14, durability: 0, range: 0, speed: 0.06, isRanged: true, ammoType: 'ammo_belt', projSpeed: 22, pellets: 1, spread: 0.17, projSprite: Spr.BULLET, soundId: 'machinegun' },
  p41_heavy_mg: { magazineSize: 100, dmg: 18, durability: 0, range: 0, speed: 0.045, isRanged: true, ammoType: 'ammo_belt', projSpeed: 21, pellets: 1, spread: 0.24, projSprite: Spr.BULLET, soundId: 'machinegun' },
  roks47_flamethrower: { magazineSize: Infinity, dmg: 7, durability: 0, range: 0, speed: 0.07, isRanged: true, ammoType: 'napalm_mix', projSpeed: 7, pellets: 2, spread: 0.22, projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, soundId: 'flame' },
  agnia_a130: { magazineSize: Infinity, dmg: 4, durability: 0, range: 0, speed: 0.075, isRanged: true, ammoType: 'ammo_fuel', projSpeed: 8, pellets: 2, spread: 0.16, projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, soundId: 'flame' },
  o15_multijet_flamer: { magazineSize: Infinity, dmg: 6, durability: 0, range: 0, speed: 0.18, isRanged: true, ammoType: 'napalm_mix', projSpeed: 7.5, pellets: 3, spread: 0.12, projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, soundId: 'flame' },
  shmk_disposable: { magazineSize: Infinity, dmg: 11, durability: 0, range: 0, speed: 1.6, isRanged: true, ammoType: 'shmk_disposable', projSpeed: 6, pellets: 8, spread: 0.42, projSprite: Spr.FLAME_BOLT, projType: ProjType.FLAME, soundId: 'flame' },
  foam_grenade_6p10: { magazineSize: Infinity, dmg: 18, durability: 0, range: 0, speed: 1.8, isRanged: true, ammoType: 'foam_grenade_6p10', projSpeed: 8, pellets: 1, spread: 0, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 5.5, soundId: 'grenade' },
  brt2_foam_projector: { magazineSize: Infinity, dmg: 12, durability: 0, range: 0, speed: 1.05, isRanged: true, ammoType: 'foam_grenade_6p10', projSpeed: 13, pellets: 1, spread: 0.018, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 3.6, soundId: 'grenade' },
  pbrog1_foam_launcher: { magazineSize: Infinity, dmg: 24, durability: 0, range: 0, speed: 2.1, isRanged: true, ammoType: 'pbrog1_foam_launcher', projSpeed: 12, pellets: 1, spread: 0.006, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 4.8, soundId: 'grenade' },
  breach_charge: { magazineSize: Infinity, dmg: 130, durability: 0, range: 0, speed: 2.4, isRanged: true, ammoType: 'breach_charge', projSpeed: 5, pellets: 1, spread: 0, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 3.4, soundId: 'grenade' },
  concrete_breaker_grenade: { magazineSize: Infinity, dmg: 105, durability: 0, range: 0, speed: 2.05, isRanged: true, ammoType: 'concrete_breaker_grenade', projSpeed: 8, pellets: 1, spread: 0, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 3.8, soundId: 'grenade' },
  pistol_grenade_launcher: { magazineSize: 1, dmg: 70, durability: 0, range: 0, speed: 2.2, isRanged: true, ammoType: 'grenade', projSpeed: 12, pellets: 1, spread: 0.015, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 3.6, soundId: 'grenade' },
  party_might_launcher: { magazineSize: 4, dmg: 110, durability: 0, range: 0, speed: 3.0, isRanged: true, ammoType: 'grenade', projSpeed: 11, pellets: 1, spread: 0.006, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 4.8, soundId: 'grenade' },
  g41_grenade_launcher: { magazineSize: 6, dmg: 125, durability: 0, range: 0, speed: 3.7, isRanged: true, ammoType: 'grenade', projSpeed: 10, pellets: 1, spread: 0.002, projSprite: Spr.GRENADE, projType: ProjType.GRENADE, aoeRadius: 5.6, soundId: 'grenade' },
  tracked_zhernov:{ dmg: 96, durability: 16, range: 1.25, speed: 2.4, isRanged: false, knockback: 0.82 },
};

for (const [id, ws] of Object.entries(PHYS_WEAPON_STATS)) {
  if (!ws.isRanged) {
    if (id === 'chainsaw') {
      ws.magazineSize = 50;
      ws.reloadTime = 2.0;
      ws.ammoType = 'ammo_fuel';
    } else {
      ws.magazineSize = 1;
      ws.reloadTime = ws.speed;
    }
  }
}

export const PHYS_WEAPON_ROLE_TIERS: Record<string, WeaponRoleTier> = {
  '': 'unarmed',
  knife: 'melee_emergency',
  wrench: 'industrial_tool',
  pipe: 'melee_emergency',
  rebar: 'melee_reach',
  axe: 'melee_heavy',
  chainsaw: 'industrial_tool',
  makarov: 'makarov_precise',
  ppsh: 'ammo_burn',
  shotgun: 'shotgun_corridor_stop',
  nailgun: 'industrial_tool',
  ak47: 'ammo_burn',
  machinegun: 'ammo_burn',
  grenade: 'grenade',
  gauss: 'rare_energy',
  plasma: 'rare_energy',
  bfg: 'rare_energy',
  gravity_beam_emitter: 'rare_energy',
  grn420_gravizhernov: 'rare_energy',
  flamethrower: 'fuel_clear',
  hammer: 'industrial_tool',
  crowbar: 'industrial_tool',
  sledgehammer: 'melee_control',
  fire_hook: 'melee_reach',
  entrenching_spade: 'industrial_tool',
  bayonet: 'melee_reach',
  chain: 'melee_reach',
  metal_chair: 'melee_control',
  tt_pistol: 'pistol_sidegrade',
  nagant: 'pistol_sidegrade',
  homemade_pistol: 'pistol_sidegrade',
  toz_shotgun: 'shotgun_corridor_stop',
  harpoon_gun: 'industrial_tool',
  rusty_rake: 'melee_reach',
  liquidator_rake: 'melee_reach',
  rake_bayonet: 'melee_reach',
  liquidator_axe: 'melee_heavy',
  shock_baton: 'melee_control',
  rubber_club: 'melee_control',
  karkarov_pistol: 'pistol_sidegrade',
  zatychkin_pistol: 'pistol_sidegrade',
  slyoznev_pps41: 'ammo_burn',
  eralashnikov_auto: 'ammo_burn',
  nosin_rifle: 'rifle_precision',
  moskvin_rifle: 'rifle_precision',
  losyash_rifle: 'rifle_precision',
  ptrs_liquidator: 'rifle_precision',
  tanev_svt40: 'rifle_precision',
  ato41_atomic_flamer: 'fuel_clear',
  chizh3_shotgun: 'shotgun_corridor_stop',
  conscripts_doublebarrel: 'shotgun_corridor_stop',
  rb91_auto_shotgun: 'shotgun_corridor_stop',
  chest_failsafe_charge: 'grenade',
  granit4u_belt_shotgun: 'shotgun_corridor_stop',
  pushkin_shotgun: 'shotgun_corridor_stop',
  rpl23_lmg: 'ammo_burn',
  p41_heavy_mg: 'ammo_burn',
  roks47_flamethrower: 'fuel_clear',
  agnia_a130: 'fuel_clear',
  o15_multijet_flamer: 'fuel_clear',
  shmk_disposable: 'fuel_clear',
  foam_grenade_6p10: 'grenade',
  brt2_foam_projector: 'grenade',
  pbrog1_foam_launcher: 'grenade',
  breach_charge: 'grenade',
  concrete_breaker_grenade: 'grenade',
  pistol_grenade_launcher: 'grenade',
  party_might_launcher: 'grenade',
  g41_grenade_launcher: 'grenade',
  tracked_zhernov: 'melee_heavy',
};
