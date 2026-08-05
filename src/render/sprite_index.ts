/* ── Sprite index registry — auto-computed, zero hardcoding ──── */
/*   Adding a new monster? Just add to MonsterKind enum and       */
/*   monster.ts registry. All sprite indices adjust automatically.*/
/*                                                                 */
/*   Layout: [NPCs | Travelers | Priest | Performer | named NPCs | ItemDrop | */
/*            Monsters | EyeBolt | ParagraphBolt | WebBolt | WetLineBolt | Desk | */
/*            Feature objects |                                    */
/*            Container objects |                                 */
/*            Bullet | Pellet | Nail | PsiBolt | PlasmaBolt |     */
/*            Hostile projectile variants | GaussBolt | BfgBolt | */
/*            FlameBolt | Grenade | TrainCar |                    */
/*            ArtNude variants | F69 female NPCs ]               */

import { ContainerKind, Feature, MonsterKind } from '../core/types';
import { AUTHORED_NPC_SPRITE_GENERATORS, NPC_SPRITE_GENERATORS } from '../entities/npc';
import { ART_NUDE_VARIANTS, F69_FEMALE_NPC_VARIANTS } from './art_sprites';

export const SPRITE_MONSTER_KINDS = Object.values(MonsterKind)
  .filter((value): value is MonsterKind => typeof value === 'number')
  .sort((a, b) => a - b);

export const SPRITE_FEATURES = [
  Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.BED, Feature.STOVE,
  Feature.SINK, Feature.TOILET, Feature.SHELF, Feature.MACHINE, Feature.APPARATUS,
  Feature.LIFT_BUTTON, Feature.SLIDE, Feature.CANDLE, Feature.SCREEN,
] as const satisfies readonly Feature[];

export const SPRITE_CONTAINER_KINDS = Object.values(ContainerKind)
  .filter((value): value is ContainerKind => typeof value === 'number')
  .sort((a, b) => a - b);

const NPC_COUNT     = NPC_SPRITE_GENERATORS.length;
const TRAVELER_COUNT = 3;
const PRIEST_COUNT   = 1;
const PERFORMER_COUNT = 1;
const AUTHORED_NPC_COUNT = AUTHORED_NPC_SPRITE_GENERATORS.length;
const MONSTER_COUNT  = SPRITE_MONSTER_KINDS.length;
const FEATURE_SPRITE_COUNT = SPRITE_FEATURES.length; // Feature.DESK reuses the standalone Desk slot.
const CONTAINER_SPRITE_COUNT = SPRITE_CONTAINER_KINDS.length;

let _i = 0;
_i += NPC_COUNT;          // occupation NPC sprites
_i += TRAVELER_COUNT;     // traveler sprites
_i += PRIEST_COUNT;       // priest sprite
_i += PERFORMER_COUNT;    // performer sprite
const _AUTHORED_NPC_BASE = _i; _i += AUTHORED_NPC_COUNT;
const _ITEM_DROP = _i++;
const _MON_BASE  = _i; _i += MONSTER_COUNT;
const _EYE_BOLT  = _i++;
const _PARAGRAPH_BOLT = _i++;
const _WEB_BOLT = _i++;
const _WET_LINE_BOLT = _i++;
const _DESK      = _i++;
const _FEATURE_BASE = _i; _i += FEATURE_SPRITE_COUNT;
const _CONTAINER_BASE = _i; _i += CONTAINER_SPRITE_COUNT;
const _BULLET    = _i++;
const _PELLET    = _i++;
const _NAIL      = _i++;
const _PSI_BOLT  = _i++;
const _PLASMA_BOLT = _i++;
const _HOSTILE_BULLET = _i++;
const _HOSTILE_PELLET = _i++;
const _HOSTILE_NAIL = _i++;
const _HOSTILE_PSI_BOLT = _i++;
const _HOSTILE_PLASMA_BOLT = _i++;
const _HOSTILE_FLAME_BOLT = _i++;
const _GAUSS_BOLT  = _i++;
const _BFG_BOLT    = _i++;
const _FLAME_BOLT  = _i++;
const _GRENADE     = _i++;
const _TRAIN_CAR   = _i++;
const _ART_NUDE_BASE = _i; _i += ART_NUDE_VARIANTS;
const _F69_FEMALE_NPC_BASE = _i; _i += F69_FEMALE_NPC_VARIANTS;

export function authoredNpcSpriteOffset(id: string): number {
  return AUTHORED_NPC_SPRITE_GENERATORS.findIndex(def => def.id === id);
}

export function authoredNpcSpr(id: string): number {
  const offset = authoredNpcSpriteOffset(id);
  if (offset < 0) throw new Error(`[SPRITE] unknown authored NPC sprite "${id}"`);
  return _AUTHORED_NPC_BASE + offset;
}

export function authoredNpcSpriteGeneratorOffset(sprite: number): number {
  const offset = Math.trunc(sprite) - _AUTHORED_NPC_BASE;
  return offset >= 0 && offset < AUTHORED_NPC_COUNT ? offset : -1;
}

export function isAuthoredNpcSpr(sprite: number): boolean {
  return authoredNpcSpriteGeneratorOffset(sprite) >= 0;
}

const _VETERAN = authoredNpcSpr('veteran_stepanych');
const _GORDON = authoredNpcSpr('gordon_freeman');
const _MADOKA = authoredNpcSpr('meduka_meguku');
const _PAKHOM = authoredNpcSpr('pahom_bratishka');

/** Named sprite indices — import these instead of magic numbers */
export const Spr = {
  AUTHORED_NPC_BASE: _AUTHORED_NPC_BASE,
  AUTHORED_NPC_COUNT,
  VETERAN:   _VETERAN,
  GORDON:    _GORDON,
  MADOKA:    _MADOKA,
  PAKHOM:    _PAKHOM,
  ITEM_DROP: _ITEM_DROP,
  EYE_BOLT:  _EYE_BOLT,
  PARAGRAPH_BOLT: _PARAGRAPH_BOLT,
  WEB_BOLT: _WEB_BOLT,
  WET_LINE_BOLT: _WET_LINE_BOLT,
  DESK:      _DESK,
  FEATURE_BASE: _FEATURE_BASE,
  CONTAINER_BASE: _CONTAINER_BASE,
  BULLET:    _BULLET,
  PELLET:    _PELLET,
  NAIL:      _NAIL,
  PSI_BOLT:  _PSI_BOLT,
  PLASMA_BOLT: _PLASMA_BOLT,
  HOSTILE_BULLET: _HOSTILE_BULLET,
  HOSTILE_PELLET: _HOSTILE_PELLET,
  HOSTILE_NAIL: _HOSTILE_NAIL,
  HOSTILE_PSI_BOLT: _HOSTILE_PSI_BOLT,
  HOSTILE_PLASMA_BOLT: _HOSTILE_PLASMA_BOLT,
  HOSTILE_FLAME_BOLT: _HOSTILE_FLAME_BOLT,
  GAUSS_BOLT:  _GAUSS_BOLT,
  BFG_BOLT:    _BFG_BOLT,
  FLAME_BOLT:  _FLAME_BOLT,
  GRENADE:     _GRENADE,
  TRAIN_CAR:   _TRAIN_CAR,
  ART_NUDE_BASE: _ART_NUDE_BASE,
  ART_NUDE_0:  _ART_NUDE_BASE,
  ART_NUDE_1:  _ART_NUDE_BASE + 1,
  ART_NUDE_2:  _ART_NUDE_BASE + 2,
  ART_NUDE_3:  _ART_NUDE_BASE + 3,
  F69_FEMALE_NPC_BASE: _F69_FEMALE_NPC_BASE,
  F69_FEMALE_NPC_0: _F69_FEMALE_NPC_BASE,
  F69_FEMALE_NPC_1: _F69_FEMALE_NPC_BASE + 1,
  F69_FEMALE_NPC_2: _F69_FEMALE_NPC_BASE + 2,
  F69_FEMALE_NPC_3: _F69_FEMALE_NPC_BASE + 3,
  F69_FEMALE_NPC_4: _F69_FEMALE_NPC_BASE + 4,
  F69_FEMALE_NPC_5: _F69_FEMALE_NPC_BASE + 5,
  F69_FEMALE_NPC_6: _F69_FEMALE_NPC_BASE + 6,
  F69_FEMALE_NPC_7: _F69_FEMALE_NPC_BASE + 7,
  TOTAL:     _i,
};

const MONSTER_SPRITE_INDEX: Partial<Record<MonsterKind, number>> = {};
for (let i = 0; i < SPRITE_MONSTER_KINDS.length; i++) {
  MONSTER_SPRITE_INDEX[SPRITE_MONSTER_KINDS[i]] = _MON_BASE + i;
}

const FEATURE_SPRITE_INDEX: Partial<Record<Feature, number>> = {
  [Feature.DESK]: _DESK,
};
for (let i = 0; i < SPRITE_FEATURES.length; i++) {
  FEATURE_SPRITE_INDEX[SPRITE_FEATURES[i]] = _FEATURE_BASE + i;
}

const CONTAINER_SPRITE_INDEX: Partial<Record<ContainerKind, number>> = {};
for (let i = 0; i < SPRITE_CONTAINER_KINDS.length; i++) {
  CONTAINER_SPRITE_INDEX[SPRITE_CONTAINER_KINDS[i]] = _CONTAINER_BASE + i;
}

/** Compute sprite index for a monster kind — always correct regardless of monster count */
export function monsterSpr(kind: MonsterKind): number {
  return MONSTER_SPRITE_INDEX[kind] ?? -1;
}

export function featureSpr(feature: Feature): number {
  return FEATURE_SPRITE_INDEX[feature] ?? -1;
}

export function containerSpr(kind: ContainerKind): number {
  return CONTAINER_SPRITE_INDEX[kind] ?? -1;
}

/** Runtime sprite swap for non-player shooters using player weapon data */
export function hostileProjectileSprite(sprite: number): number {
  switch (sprite) {
    case Spr.BULLET: return Spr.HOSTILE_BULLET;
    case Spr.PELLET: return Spr.HOSTILE_PELLET;
    case Spr.NAIL: return Spr.HOSTILE_NAIL;
    case Spr.PSI_BOLT: return Spr.HOSTILE_PSI_BOLT;
    case Spr.PLASMA_BOLT: return Spr.HOSTILE_PLASMA_BOLT;
    case Spr.FLAME_BOLT: return Spr.HOSTILE_FLAME_BOLT;
    default: return sprite;
  }
}
