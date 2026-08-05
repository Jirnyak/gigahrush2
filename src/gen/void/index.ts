/* ── Void level generator — island graph and folded geometry ─── */
/*   Green/black abstract space with honest impossible routes.    */
/*   Late threat: Creator (Творец) — green proof contour.         */
/*   Reached by normal lower-route descent after the Herald gate. */

import {
  W, Cell, Feature,
  type Entity,
  EntityType, AIGoal, MonsterKind, FloorLevel,
} from '../../core/types';
import { World } from '../../core/world';

import { rng, generateZones } from '../shared';
import { VOID_POPULATION_PROFILE } from '../../data/population_profiles';
import { activeActorCountAtDefaultSoftLimit } from '../../data/entity_limits';
import { calcZoneLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { entitySpawnSlots } from '../../systems/entity_limits';
import { MONSTERS } from '../../entities/monster';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { runVoidContent } from './content_manifest';
import { applyVoidRevealLighting, buildVoidGeometry, paintVoidDefaults } from './geometry';

export function generateVoid(): { world: World; entities: Entity[]; spawnX: number; spawnY: number } {
  const world = new World();
  const entities: Entity[] = [];
  let nextId = 1;

  /* ══════════════════════════════════════════════════════════════
     Phase 1: Impossible-but-honest macro graph
     ══════════════════════════════════════════════════════════════ */
  const layout = buildVoidGeometry(world);
  const spawnX = layout.spawnX;
  const spawnY = layout.spawnY;

  paintVoidDefaults(world);

  /* ══════════════════════════════════════════════════════════════
     Phase 2: Zones
     ══════════════════════════════════════════════════════════════ */
  generateZones(world);
  for (const z of world.zones) z.level = calcZoneLevel(z.cx, z.cy, FloorLevel.VOID) + 5;

  nextId = runVoidContent(world, entities, nextId, spawnX, spawnY);
  paintVoidDefaults(world);

  /* ══════════════════════════════════════════════════════════════
     Phase 3: Sparse eerie lighting
     ══════════════════════════════════════════════════════════════ */
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR && Math.random() < 0.0015) {
      world.features[i] = Feature.LAMP;
    }
  }
  world.bakeLights();

  /* ══════════════════════════════════════════════════════════════
     Phase 4: Creator — return condition
     ══════════════════════════════════════════════════════════════ */
  const bossX = layout.bossX;
  const bossY = layout.bossY;

  const creatorDef = MONSTERS[MonsterKind.CREATOR];
  const bossLevel = 20;
  const rpg = randomRPG(bossLevel);
  const bossHp = Math.round(scaleMonsterHp(creatorDef.hp, bossLevel));
  entities.push({
    id: nextId++, type: EntityType.MONSTER,
    x: bossX + 0.5, y: bossY + 0.5,
    angle: 0, pitch: 0, alive: true,
    speed: scaleMonsterSpeed(creatorDef.speed, bossLevel),
    sprite: monsterSpr(MonsterKind.CREATOR),
    name: 'Творец',
    hp: bossHp, maxHp: bossHp,
    monsterKind: MonsterKind.CREATOR, attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
    spriteScale: 1.5,
  });

  // The encounter must read clearly from range despite the abstract sprite.
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy <= 25) {
        const ci = world.idx(bossX + dx, bossY + dy);
        if (world.cells[ci] === Cell.FLOOR) {
          world.features[ci] = Feature.LAMP;
        }
      }
    }
  }
  world.bakeLights();
  applyVoidRevealLighting(world);

  /* ══════════════════════════════════════════════════════════════
     Phase 5: Guardian monsters scattered
     ══════════════════════════════════════════════════════════════ */
  const voidKinds = [
    MonsterKind.SHADOW, MonsterKind.GLUBINNAYA_TEN, MonsterKind.NIGHTMARE, MonsterKind.EYE,
    MonsterKind.REBAR, MonsterKind.BETONNIK, MonsterKind.SPIRIT,
    MonsterKind.LOZHNYY_DUKH,
  ];
  const guardianTarget = entitySpawnSlots(entities, EntityType.MONSTER, activeActorCountAtDefaultSoftLimit(VOID_POPULATION_PROFILE.guardians));
  for (let i = 0; i < guardianTarget; i++) {
    const cell = randomFloorCell(world, spawnX, spawnY, 26);
    if (cell < 0) continue;
    const kind = voidKinds[rng(0, voidKinds.length - 1)];
    const mdef = MONSTERS[kind];
    if (!mdef) continue;
    const x = (cell % W) + 0.5;
    const y = ((cell / W) | 0) + 0.5;
    const zid = world.zoneMap[cell];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 15) : 15;
    const mRpg = randomRPG(zoneLevel);
    const mHp = Math.round(scaleMonsterHp(mdef.hp, zoneLevel));
    entities.push({
      id: nextId++, type: EntityType.MONSTER,
      x, y,
      angle: Math.random() * Math.PI * 2, pitch: 0,
      alive: true,
      speed: scaleMonsterSpeed(mdef.speed, zoneLevel),
      sprite: monsterSpr(kind),
      hp: mHp, maxHp: mHp,
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: mRpg,
      phasing: kind === MonsterKind.SPIRIT,
    });
  }

  /* ══════════════════════════════════════════════════════════════
     Phase 6: Loot
     ══════════════════════════════════════════════════════════════ */
  const drops = ['canned', 'bandage', 'pills', 'antidep', 'ammo_energy', 'ammo_762', 'grenade'];
  for (let i = 0; i < VOID_POPULATION_PROFILE.lootDrops; i++) {
    const cell = randomFloorCell(world, spawnX, spawnY, 8);
    if (cell < 0) continue;
    entities.push({
      id: nextId++, type: EntityType.ITEM_DROP,
      x: (cell % W) + 0.5, y: ((cell / W) | 0) + 0.5,
      angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
      inventory: [{ defId: drops[rng(0, drops.length - 1)], count: rng(1, 3) }],
    });
  }

  return { world, entities, spawnX, spawnY };
}

function randomFloorCell(world: World, avoidX = -1000, avoidY = -1000, minDist = 0): number {
  const minDist2 = minDist * minDist;
  for (let attempt = 0; attempt < 2048; attempt++) {
    const cell = rng(0, W * W - 1);
    if (world.cells[cell] !== Cell.FLOOR) continue;
    if (minDist > 0 && world.dist2(avoidX, avoidY, cell % W, (cell / W) | 0) < minDist2) continue;
    return cell;
  }
  return -1;
}
