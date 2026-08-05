import fs from 'fs';

const path = 'src/gen/maintenance/index.ts';
let code = fs.readFileSync(path, 'utf8');

const regexToReplace = /\/\* ══════════════════════════════════════════════════════════════\n     Phase 9: Lights \(sparse — at room centers \+ rare tunnel lamps\)(?:.|\n)*?\/\* ══════════════════════════════════════════════════════════════\n     Phase 12-14e: Manifest-owned maintenance content/;

const helpers = `
function placeLights(world: World, rooms: Room[]): void {
  const half = Math.floor(CELL / 2);
  for (const room of rooms) {
    const cx = room.x + Math.floor(room.w / 2);
    const cy = room.y + Math.floor(room.h / 2);
    const ci = world.idx(cx, cy);
    if (world.cells[ci] === Cell.FLOOR) world.features[ci] = Feature.LAMP;
  }
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      if (Math.random() < 0.06) {
        const ci = world.idx(world.wrap(gx * CELL + half), world.wrap(gy * CELL + half));
        if (world.cells[ci] === Cell.FLOOR && world.features[ci] === 0)
          world.features[ci] = Feature.LAMP;
      }
    }
  }
  world.bakeLights();
}

function placeItems(entities: Entity[], rooms: Room[], nextIdStart: number): number {
  let nextId = nextIdStart;
  for (const room of rooms) {
    const numItems = rng(0, 3);
    for (let n = 0; n < numItems; n++) {
      const defs = ['pipe', 'wrench', 'flashlight', 'bandage', 'water', 'canned', 'bread', 'ammo_fuel', 'grenade'];
      const defId = pick(defs);
      const ix = room.x + rng(0, Math.max(0, room.w - 1));
      const iy = room.y + rng(0, Math.max(0, room.h - 1));
      entities.push({
        id: nextId++, type: EntityType.ITEM_DROP,
        x: ix + 0.5, y: iy + 0.5, angle: 0, pitch: 0,
        alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId, count: 1 }],
      });
    }
  }
  return nextId;
}

function placeMonsters(world: World, entities: Entity[], nextIdStart: number): number {
  let nextId = nextIdStart;
  let monsterCount = 0;
  const monsterTarget = entitySpawnSlots(entities, EntityType.MONSTER, activeActorCountAtDefaultSoftLimit(MAINTENANCE_MONSTER_TARGET_AT_DEFAULT_CAP));
  for (let attempt = 0; attempt < 50_000 && monsterCount < monsterTarget; attempt++) {
    const ci = rng(0, W * W - 1);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const mx = (ci % W) + 0.5, my = ((ci / W) | 0) + 0.5;
    const kind = Math.random() < 0.10
      ? pick([MonsterKind.EYE, MonsterKind.NIGHTMARE, MonsterKind.REBAR, MonsterKind.BETONNIK, MonsterKind.MATKA])
      : pick([
      MonsterKind.SBORKA, MonsterKind.SBORKA,
      MonsterKind.POLZUN,
      MonsterKind.ZOMBIE,
      MonsterKind.SHADOW,
      MonsterKind.TVAR,
    ]);
    const mstats: Record<number, { hp: number; speed: number; sprite: number }> = {
      [MonsterKind.SBORKA]: { hp: 5,  speed: 2.8, sprite: monsterSpr(MonsterKind.SBORKA) },
      [MonsterKind.TVAR]:   { hp: 40, speed: 1.8, sprite: monsterSpr(MonsterKind.TVAR) },
      [MonsterKind.POLZUN]: { hp: 80, speed: 1.0, sprite: monsterSpr(MonsterKind.POLZUN) },
      [MonsterKind.ZOMBIE]: { hp: 25, speed: 1.4, sprite: monsterSpr(MonsterKind.ZOMBIE) },
      [MonsterKind.SHADOW]: { hp: 45, speed: 2.4, sprite: monsterSpr(MonsterKind.SHADOW) },
      [MonsterKind.EYE]:       { hp: 30,  speed: 2.0, sprite: monsterSpr(MonsterKind.EYE) },
      [MonsterKind.NIGHTMARE]: { hp: 60,  speed: 2.2, sprite: monsterSpr(MonsterKind.NIGHTMARE) },
      [MonsterKind.REBAR]:     { hp: 55,  speed: 1.6, sprite: monsterSpr(MonsterKind.REBAR) },
      [MonsterKind.BETONNIK]:  { hp: 120, speed: 1.2, sprite: monsterSpr(MonsterKind.BETONNIK) },
      [MonsterKind.MATKA]:     { hp: 100, speed: 1.0, sprite: monsterSpr(MonsterKind.MATKA) },
    };
    const def = mstats[kind];
    if (!def) continue;
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 5) : 5;
    const rpg = randomRPG(zoneLevel);
    entities.push({
      id: nextId++, type: EntityType.MONSTER,
      x: mx, y: my, angle: Math.random() * Math.PI * 2, pitch: 0,
      alive: true, speed: scaleMonsterSpeed(def.speed, zoneLevel), sprite: def.sprite,
      hp: scaleMonsterHp(def.hp, zoneLevel), maxHp: scaleMonsterHp(def.hp, zoneLevel),
      monsterKind: kind, attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg,
    });
    monsterCount++;
  }
  return nextId;
}
`;

const replacement = `/* ══════════════════════════════════════════════════════════════
     Phase 9-11: Entities & Environment
     ══════════════════════════════════════════════════════════════ */
  placeLights(world, rooms);
  nextId = placeItems(entities, rooms, nextId);
  nextId = placeMonsters(world, entities, nextId);

  /* ══════════════════════════════════════════════════════════════
     Phase 12-14e: Manifest-owned maintenance content`;

let newCode = code.replace(regexToReplace, replacement);

newCode = newCode + helpers;

fs.writeFileSync(path, newCode);
