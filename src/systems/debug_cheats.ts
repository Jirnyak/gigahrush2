import { EntityType, type Entity } from '../core/types';

let debugOnePunchMan = false;

export function isDebugOnePunchManEnabled(): boolean {
  return debugOnePunchMan;
}

export function toggleDebugOnePunchMan(): boolean {
  debugOnePunchMan = !debugOnePunchMan;
  return debugOnePunchMan;
}

export function debugOnePunchMeleeDamage(target: Entity, normalDamage: number): number {
  if (!debugOnePunchMan) return normalDamage;
  if (target.type !== EntityType.MONSTER && target.type !== EntityType.NPC) return normalDamage;
  return Math.max(normalDamage, Math.ceil(target.hp ?? target.maxHp ?? 1));
}

export function keepDebugOnePunchManAlive(player: Entity): void {
  if (!debugOnePunchMan) return;
  player.alive = true;
  player.maxHp = Math.max(1, player.maxHp ?? 100);
  player.hp = player.maxHp;
}

