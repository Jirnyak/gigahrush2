import { Entity, DamageType } from '../core/types';
import { ITEMS } from '../data/catalog';

export function calculateDamage(baseDamage: number, damageType: DamageType | undefined, target: Entity): number {
  let resist = 0;
  if (target.armorDefId) {
    const armorDef = ITEMS[target.armorDefId];
    if (armorDef && armorDef.resistances && damageType !== undefined) {
      resist = armorDef.resistances[damageType] ?? 0;
    }
  }
  return Math.max(0, baseDamage * (100 - resist) / 100);
}

export function applyHitStaggerAndKnockback(target: Entity, sourceX: number, sourceY: number, damage: number): void {
  if (damage <= 0 || !target.alive) return;
  const maxHp = target.maxHp || 100;
  const ratio = damage / maxHp;
  
  // Noticeable hit -> Apply stagger and knockback
  if (ratio > 0.01) {
    // Asymptotic stagger up to 1 second
    const staggerTime = Math.min(1.0, (ratio * 1.5) / (ratio * 1.5 + 0.2));
    target.staggerTimer = Math.max(target.staggerTimer ?? 0, staggerTime);
    if (target.ai) target.ai.staggerTimer = Math.max(target.ai.staggerTimer ?? 0, staggerTime);
    
    // Knockback
    let dx = target.x - sourceX;
    let dy = target.y - sourceY;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
      dx /= dist;
      dy /= dist;
      // push force scales with stagger intensity (cells/sec)
      const pushForce = staggerTime * 12.0; 
      target.vx = (target.vx ?? 0) + dx * pushForce;
      target.vy = (target.vy ?? 0) + dy * pushForce;
    }
  }
}

