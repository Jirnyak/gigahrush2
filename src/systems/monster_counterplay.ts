/* ── Shared hooks for monster-specific counterplay outcomes ──── */

import { MonsterKind, type Entity, type GameState } from '../core/types';
import { World } from '../core/world';
import {
  borshchevikProjectileDamage,
  isBorshchevikCuttingWeapon,
  isBorshchevikFireProjectile,
  recordBorshchevikBurned,
  recordBorshchevikCut,
} from './borshchevik';
import {
  bloodPlantProjectileDamage,
  isBloodPlantCuttingWeapon,
  isBloodPlantFireProjectile,
  recordBloodPlantBurned,
  recordBloodPlantRootCut,
} from './blood_plant';
import {
  fogSharkProjectileDamage,
  isFogSharkFireProjectile,
  isFogSharkFireWeapon,
  recordFogSharkIgnited,
  type FogSharkCollateralKillHandler,
} from './fog_shark';
import {
  isSwarmFireProjectile,
  recordSwarmFireDeath,
  swarmProjectileDamage,
} from './swarm_nests';

export function adjustMonsterProjectileDamage(target: Entity, projectile: Entity, baseDamage: number): number {
  const plantAdjusted = borshchevikProjectileDamage(target, projectile, baseDamage);
  const bloodPlantAdjusted = bloodPlantProjectileDamage(target, projectile, plantAdjusted);
  const fogAdjusted = fogSharkProjectileDamage(target, projectile, bloodPlantAdjusted);
  return swarmProjectileDamage(target, projectile, fogAdjusted);
}

export function recordMonsterProjectileDeath(
  world: World,
  state: GameState,
  target: Entity,
  projectile: Entity,
  actor?: Entity,
  onKill?: FogSharkCollateralKillHandler,
  _entities?: readonly Entity[],
): void {
  if (target.monsterKind === MonsterKind.BORSHCHEVIK && isBorshchevikFireProjectile(projectile)) {
    recordBorshchevikBurned(world, state, target, actor);
  }
  if (target.monsterKind === MonsterKind.BLOOD_PLANT && isBloodPlantFireProjectile(projectile)) {
    recordBloodPlantBurned(world, state, target, actor);
  }
  if (target.monsterKind === MonsterKind.FOG_SHARK && isFogSharkFireProjectile(projectile)) {
    recordFogSharkIgnited(world, state, target, actor, onKill);
  }
  if (target.monsterKind === MonsterKind.SWARM && isSwarmFireProjectile(projectile)) {
    recordSwarmFireDeath(world, state, target, actor);
  }
}

export function recordMonsterMeleeDeath(
  world: World,
  state: GameState,
  target: Entity,
  weaponId: string | undefined,
  actor?: Entity,
  onKill?: FogSharkCollateralKillHandler,
  _entities?: readonly Entity[],
): void {
  if (target.monsterKind === MonsterKind.BORSHCHEVIK && isBorshchevikCuttingWeapon(weaponId)) {
    recordBorshchevikCut(world, state, target, actor);
  }
  if (target.monsterKind === MonsterKind.BLOOD_PLANT && isBloodPlantCuttingWeapon(weaponId)) {
    recordBloodPlantRootCut(world, state, target, actor);
  }
  if (target.monsterKind === MonsterKind.FOG_SHARK && isFogSharkFireWeapon(weaponId)) {
    recordFogSharkIgnited(world, state, target, actor, onKill);
  }
}
