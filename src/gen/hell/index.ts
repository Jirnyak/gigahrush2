/* ── Hell level generator (Floor 2) — organic ising caves ────── */

import {
  W, Cell, Tex, Feature, Faction, Occupation, LiftDirection,
  type Entity,
  EntityType, AIGoal, MonsterKind, FloorLevel, ZoneFaction,
} from '../../core/types';
import { World } from '../../core/world';
import { randomName, freshNeeds } from '../../data/catalog';
import { rng, pick, ensureConnectivity, placeLifts, generateZones } from '../shared';
import { placeProceduralScreens } from '../procedural_screens';
import { HELL_POPULATION_PROFILE } from '../../data/population_profiles';
import { activeActorCountAtDefaultSoftLimit } from '../../data/entity_limits';
import { territorySharesForStoryFloor } from '../../data/floor_territory';
import { chooseFloorMonsterKind } from '../../data/monster_ecology';
import { sampleNaturalPopulationCells, type NaturalPopulationProfile, type PlacementFieldAnchor } from '../population_placement';
import { MONSTERS } from '../../entities/monster';
import { calcZoneLevel, randomRPG, scaleMonsterHp, scaleMonsterSpeed, gaussianLevel, getMaxHp } from '../../systems/rpg';
import { entitySpawnSlots } from '../../systems/entity_limits';
import { initializeCellTerritory } from '../../systems/territory';
import { Spr, monsterSpr } from '../../render/sprite_index';
import { runHellContent } from './content_manifest';
import { buildHellGeometry, imprintHellArenaValleys, type HellGeometry } from './geometry';

const PSI_IDS = ['psi_strike', 'psi_rupture', 'psi_madness', 'psi_storm', 'psi_brainburn'];

const HELL_POPULATION = HELL_POPULATION_PROFILE;
const HELL_MONSTER_PROFILE = HELL_POPULATION.monsters;
const HELL_CULTIST_PROFILE = HELL_POPULATION.cultists;
const HELL_LIQUIDATOR_PROFILE = HELL_POPULATION.liquidators;

const HELL_POPULATION_EXCLUDED_MONSTERS: readonly MonsterKind[] = [MonsterKind.SPORE_CARPET];

type SpawnFaction = Faction.CULTIST | Faction.LIQUIDATOR;

export function generateHell(generationSeed = 0x4d594153): { world: World; entities: Entity[]; spawnX: number; spawnY: number } {
  const world = new World();
  const entities: Entity[] = [];
  let nextId = 1;

  const field = buildIsingCaveField();
  paintHellTerrain(world, field);
  const hellGeometry = buildHellGeometry(world);

  const spawnCell = findNearestFloor(world, W >> 1, W >> 1) ?? world.idx(W >> 1, W >> 1);
  const spawnX = (spawnCell % W) + 0.5;
  const spawnY = ((spawnCell / W) | 0) + 0.5;

  ensureConnectivity(world, spawnX, spawnY);
  paintMissingOrganicTextures(world);

  placeLifts(world, 12, LiftDirection.UP);
  placeLifts(world, 6, LiftDirection.DOWN);
  ensureConnectivity(world, spawnX, spawnY);
  paintMissingOrganicTextures(world);
  generateZones(world);
  retuneHellZones(world);
  for (const z of world.zones) z.level = calcZoneLevel(z.cx, z.cy, FloorLevel.HELL) + 2;
  initializeCellTerritory(world, {
    seed: generationSeed,
    targetShares: territorySharesForStoryFloor(FloorLevel.HELL),
  });

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.FLOOR && Math.random() < 0.0035) {
      world.features[i] = Feature.LAMP;
    }
  }
  world.bakeLights();

  seedHellPopulation(
    world,
    entities,
    { v: nextId },
    activeActorCountAtDefaultSoftLimit(HELL_MONSTER_PROFILE.initial),
    activeActorCountAtDefaultSoftLimit(HELL_CULTIST_PROFILE.initial),
    activeActorCountAtDefaultSoftLimit(HELL_LIQUIDATOR_PROFILE.initial),
    0,
    hellGeometry,
  );
  nextId = entities.reduce((mx, e) => Math.max(mx, e.id), nextId) + 1;

  seedLoot(world, entities, { v: nextId });

  // Manifest-owned side content
  nextId = runHellContent(world, entities, nextId);

  placeProceduralScreens(world, FloorLevel.HELL);

  return { world, entities, spawnX, spawnY };
}

function buildIsingCaveField(): Uint8Array {
  const field = new Uint8Array(W * W);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const coarse = hash2(x >> 5, y >> 5, 100) * 0.55;
      const medium = hash2(x >> 3, y >> 3, 101) * 0.3;
      const fine = hash2(x >> 1, y >> 1, 102) * 0.15;
      field[y * W + x] = coarse + medium + fine > 0.72 ? 1 : 0;
    }
  }
  imprintHellArenaValleys(field);

  for (let iter = 0; iter < 4; iter++) {
    for (let parity = 0; parity < 2; parity++) {
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          if (((x + y) & 1) !== parity) continue;
          const idx = y * W + x;
          const n4 = countNeighbors(field, x, y, false);
          const n8 = countNeighbors(field, x, y, true);
          const localField = (hash2(x, y, 110 + iter) - 0.5) * 0.85;
          const energy = (n4 - 2.75) * 1.75 + (n8 - 4.5) * 0.1 + localField;
          field[idx] = energy >= 0 ? 1 : 0;
        }
      }
    }
  }

  carveOrganicBranches(field);
  imprintHellArenaValleys(field);

  for (let pass = 0; pass < 2; pass++) {
    const next = field.slice();
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const n4 = countNeighbors(field, x, y, false);
        const n8 = countNeighbors(field, x, y, true);
        if (field[idx]) next[idx] = (n4 >= 1 && n8 >= 2) ? 1 : 0;
        else next[idx] = (n4 >= 3 && n8 >= 5) ? 1 : 0;
      }
    }
    field.set(next);
  }

  for (let pass = 0; pass < 2; pass++) {
    const next = field.slice();
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (!field[idx]) continue;
        const n4 = countNeighbors(field, x, y, false);
        const n8 = countNeighbors(field, x, y, true);
        if (n4 <= 1 || n8 <= 2) next[idx] = 0;
      }
    }
    field.set(next);
  }

  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy > 25) continue;
      field[((W >> 1) + dy) * W + ((W >> 1) + dx)] = 1;
    }
  }
  imprintHellArenaValleys(field);

  return field;
}

function carveOrganicBranches(field: Uint8Array): void {
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const walkers = 210;

  for (let i = 0; i < walkers; i++) {
    let x = rng(0, W - 1);
    let y = rng(0, W - 1);
    let dir = rng(0, dirs.length - 1);
    const len = rng(70, 240);
    let width = 1;
    let fatTimer = 0;

    for (let step = 0; step < len; step++) {
      if (fatTimer <= 0) {
        const swell = hash2(x + step, y - step, 120 + i);
        if (swell > 0.985) {
          width = 3;
          fatTimer = rng(6, 18);
        } else if (swell > 0.9) {
          width = 2;
          fatTimer = rng(8, 28);
        } else {
          width = 1;
        }
      } else {
        fatTimer--;
      }

      carveBubble(field, x, y, width);

      if (hash2(x + step * 3, y - step, 121) > 0.83) {
        dir = (dir + (hash2(x - step, y + step * 2, 122) > 0.5 ? 1 : 3)) & 3;
      }
      if (hash2(x + i, y + step, 123) > 0.965) {
        const branchDir = (dir + (hash2(x + step, y + i, 124) > 0.5 ? 1 : 3)) & 3;
        carveBranch(field, x, y, branchDir, rng(18, 72));
      }

      x = wrapCoord(x + dirs[dir][0]);
      y = wrapCoord(y + dirs[dir][1]);
    }
  }
}

function carveBranch(field: Uint8Array, startX: number, startY: number, dir: number, len: number): void {
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let x = startX;
  let y = startY;
  for (let step = 0; step < len; step++) {
    const widen = hash2(x + step, y - step, 126) > 0.96 ? 2 : 1;
    carveBubble(field, x, y, widen);
    if (hash2(x - step, y + step, 127) > 0.88) {
      dir = (dir + (hash2(x, y, 128) > 0.5 ? 1 : 3)) & 3;
    }
    x = wrapCoord(x + dirs[dir][0]);
    y = wrapCoord(y + dirs[dir][1]);
  }
}

function carveBubble(field: Uint8Array, x: number, y: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 1) continue;
      field[wrapCoord(y + dy) * W + wrapCoord(x + dx)] = 1;
    }
  }
}

function countNeighbors(field: Uint8Array, x: number, y: number, diagonals: boolean): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!diagonals && dx !== 0 && dy !== 0) continue;
      count += field[wrapCoord(y + dy) * W + wrapCoord(x + dx)] ? 1 : 0;
    }
  }
  return count;
}

function paintHellTerrain(world: World, field: Uint8Array): void {
  for (let i = 0; i < W * W; i++) {
    if (field[i]) {
      world.cells[i] = Cell.FLOOR;
    } else {
      world.cells[i] = Cell.WALL;
    }
  }
  paintOrganicTextures(world);
}

function paintOrganicTextures(world: World): void {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (world.cells[i] === Cell.FLOOR) {
        world.floorTex[i] = pickHellFloorTex(x, y);
        world.wallTex[i] = 0;
      } else if (world.cells[i] === Cell.WALL) {
        world.wallTex[i] = pickHellWallTex(x, y);
        world.floorTex[i] = 0;
      }
    }
  }
}

function paintMissingOrganicTextures(world: World): void {
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (world.cells[i] === Cell.FLOOR && world.floorTex[i] === 0) {
        world.floorTex[i] = pickHellFloorTex(x, y);
        world.wallTex[i] = 0;
      } else if (world.cells[i] === Cell.WALL && world.wallTex[i] === 0) {
        world.wallTex[i] = pickHellWallTex(x, y);
        world.floorTex[i] = 0;
      } else if (world.cells[i] === Cell.ABYSS) {
        world.floorTex[i] = Tex.F_ABYSS;
        world.wallTex[i] = 0;
      }
    }
  }
}

function pickHellWallTex(x: number, y: number): Tex {
  const gut = hash2(x >> 2, y >> 2, 130) * 0.65 + hash2(x >> 4, y >> 4, 131) * 0.35;
  return gut > 0.6 ? Tex.GUT : Tex.MEAT;
}

function pickHellFloorTex(x: number, y: number): Tex {
  const gut = hash2(x >> 1, y >> 1, 132) * 0.55 + hash2(x >> 3, y >> 3, 133) * 0.45;
  return gut > 0.67 ? Tex.F_GUT : Tex.F_MEAT;
}

function findNearestFloor(world: World, x: number, y: number): number | null {
  for (let r = 0; r < 64; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const cx = wrapCoord(x + dx);
        const cy = wrapCoord(y + dy);
        const idx = cy * W + cx;
        if (world.cells[idx] === Cell.FLOOR) return idx;
      }
    }
  }
  return null;
}

function retuneHellZones(world: World): void {
  for (const zone of world.zones) {
    const roll = hash2(zone.cx, zone.cy, 140);
    if (roll < 0.58) zone.faction = ZoneFaction.CULTIST;
    else if (roll < 0.9) zone.faction = ZoneFaction.LIQUIDATOR;
    else zone.faction = ZoneFaction.WILD;
    zone.hqRoomId = -1;
  }
}

function seedHellPopulation(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  monsters: number,
  cultists: number,
  liquidators: number,
  samosborCount: number,
  geometry: HellGeometry,
): void {
  spawnHellMonsterBatch(world, entities, nextId, monsters, samosborCount, geometry);
  spawnFactionAgentBatch(world, entities, nextId, Faction.CULTIST, cultists, geometry);
  spawnFactionAgentBatch(world, entities, nextId, Faction.LIQUIDATOR, liquidators, geometry);
}

function seedLoot(world: World, entities: Entity[], nextId: { v: number }): void {
  const drops = ['canned', 'bandage', 'pills', 'pipe', 'knife', 'water', 'ammo_9mm', 'ammo_nails', 'rebar', 'antidep',
    'ammo_belt', 'ammo_energy', 'ammo_fuel', 'grenade'];
  const dropSlots = entitySpawnSlots(entities, EntityType.ITEM_DROP, 280);
  for (let i = 0; i < dropSlots; i++) {
    const cell = randomFloorCell(world);
    if (cell < 0) continue;
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: (cell % W) + 0.5,
      y: ((cell / W) | 0) + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [{ defId: pick(drops), count: rng(1, 2) }],
    });
  }
}

function spawnHellMonsterBatch(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  requested: number,
  samosborCount: number,
  geometry: HellGeometry,
): number {
  const count = entitySpawnSlots(entities, EntityType.MONSTER, requested);
  const cells = sampleHellPopulationCells(world, count, HELL_MONSTER_PROFILE, hellPopulationSeed(11, nextId.v), hellPopulationAnchors(geometry, 'monster'));
  let spawned = 0;
  for (const cell of cells) {
    spawnHellMonsterAtCell(world, entities, nextId, cell, samosborCount);
    spawned++;
  }
  return spawned;
}

function spawnHellMonsterAtCell(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  cell: number,
  samosborCount: number,
): void {
  const x = (cell % W) + 0.5;
  const y = ((cell / W) | 0) + 0.5;
  entities.push(createHellMonster(world, nextId, pickHellMonsterKind(samosborCount), x, y));
}

function spawnFactionAgentBatch(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  faction: SpawnFaction,
  requested: number,
  geometry: HellGeometry,
): number {
  const count = entitySpawnSlots(entities, EntityType.NPC, requested);
  const seed = hellPopulationSeed(faction === Faction.CULTIST ? 23 : 37, nextId.v);
  const cells = sampleHellPopulationCells(world, count, profileForFaction(faction), seed, hellPopulationAnchors(geometry, faction === Faction.CULTIST ? 'cultist' : 'liquidator'));
  let spawned = 0;
  for (const cell of cells) {
    entities.push(faction === Faction.CULTIST
      ? createHellCultist(world, nextId, cell)
      : createHellLiquidator(world, nextId, cell));
    spawned++;
  }
  return spawned;
}

function profileForFaction(faction: SpawnFaction): NaturalPopulationProfile {
  return faction === Faction.CULTIST
    ? { ...HELL_CULTIST_PROFILE, preferredTerritory: ZoneFaction.CULTIST, preferredTerritoryShare: 0.78 }
    : { ...HELL_LIQUIDATOR_PROFILE, preferredTerritory: ZoneFaction.LIQUIDATOR, preferredTerritoryShare: 0.72 };
}

function sampleHellPopulationCells(
  world: World,
  count: number,
  profile: NaturalPopulationProfile,
  seed: number,
  anchors: readonly PlacementFieldAnchor[],
): number[] {
  const effectiveProfile = anchors.length > 0
    ? { ...profile, anchors, smoothingPasses: 2, smoothingBlend: 0.58 }
    : profile;
  return sampleNaturalPopulationCells(world, count, effectiveProfile, seed);
}

function hellPopulationSeed(kind: number, nextId: number): number {
  return 4003 + kind * 10007 + nextId * 17;
}

type HellPopulationAnchorKind = 'monster' | 'cultist' | 'liquidator';

function hellPopulationAnchors(geometry: HellGeometry, kind: HellPopulationAnchorKind): PlacementFieldAnchor[] {
  if (kind === 'monster') {
    return [
      ...geometry.populationAnchors.monster,
      ...attenuatedSafeAnchors(geometry, 0.38),
    ];
  }
  if (kind === 'cultist') {
    return [
      ...geometry.populationAnchors.cultist,
      ...attenuatedSafeAnchors(geometry, 0.52),
    ];
  }
  return [
    ...geometry.populationAnchors.liquidator,
    ...attenuatedSafeAnchors(geometry, 0.78),
  ];
}

function attenuatedSafeAnchors(geometry: HellGeometry, weight: number): PlacementFieldAnchor[] {
  return geometry.populationAnchors.safe.map(anchor => ({ ...anchor, weight }));
}

function createHellMonster(world: World, nextId: { v: number }, kind: MonsterKind, x: number, y: number): Entity {
  const def = MONSTERS[kind] ?? MONSTERS[MonsterKind.TVAR];
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 10) : 10;
  const bonus = kind === MonsterKind.BETONNIK || kind === MonsterKind.MATKA || kind === MonsterKind.KHOROVAYA_MATKA ? 3 : 1;
  const rpg = randomRPG(zoneLevel + bonus);
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel + bonus) * (1 + rpg.str * 0.1));
  return {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x,
    y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel + Math.max(1, bonus - 1)),
    sprite: monsterSpr(kind),
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
    phasing: kind === MonsterKind.SPIRIT,
  };
}

function createHellCultist(world: World, nextId: { v: number }, cell: number): Entity {
  const zid = world.zoneMap[cell];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 10) : 10;
  const npcLevel = gaussianLevel(zoneLevel + 3, 2);
  const rpg = randomRPG(npcLevel);
  const maxHp = Math.round(getMaxHp(rpg) * 1.55);
  const nm = randomName(Faction.CULTIST);
  const psiId = pick(PSI_IDS);
  const hasPsi = Math.random() < 0.72;
  return {
    id: nextId.v++,
    type: EntityType.NPC,
    x: (cell % W) + 0.5,
    y: ((cell / W) | 0) + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.45 + Math.random() * 0.35,
    sprite: Occupation.PILGRIM,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: hasPsi ? [{ defId: psiId, count: 1 }] : [{ defId: 'rebar', count: 1 }],
    weapon: hasPsi ? psiId : 'rebar',
    familyId: -1,
    faction: Faction.CULTIST,
    occupation: Occupation.PILGRIM,
    isTraveler: true,
    questId: -1,
    rpg,
  };
}

function createHellLiquidator(world: World, nextId: { v: number }, cell: number): Entity {
  const zid = world.zoneMap[cell];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 10) : 10;
  const npcLevel = gaussianLevel(zoneLevel + 4, 2);
  const rpg = randomRPG(npcLevel);
  const maxHp = Math.round(getMaxHp(rpg) * 1.75);
  const nm = randomName(Faction.LIQUIDATOR);
  const roll = Math.random();
  let weapon = 'rebar';
  let inventory = [{ defId: 'rebar', count: 1 }];
  if (roll < 0.25) {
    weapon = 'makarov';
    inventory = [{ defId: 'makarov', count: 1 }, { defId: 'ammo_9mm', count: 24 }];
  } else if (roll < 0.40) {
    weapon = 'shotgun';
    inventory = [{ defId: 'shotgun', count: 1 }, { defId: 'ammo_shells', count: 10 }];
  } else if (roll < 0.55) {
    weapon = 'nailgun';
    inventory = [{ defId: 'nailgun', count: 1 }, { defId: 'ammo_nails', count: 30 }];
  } else if (roll < 0.65) {
    weapon = 'ppsh';
    inventory = [{ defId: 'ppsh', count: 1 }, { defId: 'ammo_9mm', count: 60 }];
  } else if (roll < 0.75) {
    weapon = 'machinegun';
    inventory = [{ defId: 'machinegun', count: 1 }, { defId: 'ammo_belt', count: 100 }];
  } else if (roll < 0.82) {
    weapon = 'plasma';
    inventory = [{ defId: 'plasma', count: 1 }, { defId: 'ammo_energy', count: 20 }];
  } else if (roll < 0.87) {
    weapon = 'gauss';
    inventory = [{ defId: 'gauss', count: 1 }, { defId: 'ammo_energy', count: 10 }];
  }
  return {
    id: nextId.v++,
    type: EntityType.NPC,
    x: (cell % W) + 0.5,
    y: ((cell / W) | 0) + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: 1.35 + Math.random() * 0.25,
    sprite: Occupation.HUNTER,
    name: nm.name,
    firstName: nm.firstName,
    lastName: nm.lastName,
    isFemale: nm.female,
    needs: freshNeeds(),
    hp: maxHp,
    maxHp,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory,
    weapon,
    familyId: -1,
    faction: Faction.LIQUIDATOR,
    occupation: Occupation.HUNTER,
    isTraveler: true,
    questId: -1,
    rpg,
  };
}

function pickHellMonsterKind(samosborCount: number): MonsterKind {
  return chooseFloorMonsterKind({
    floor: FloorLevel.HELL,
    floorTags: ['hell', 'meat', 'deep', 'cult'],
    samosborCount: Math.max(4, samosborCount),
    allowRare: true,
    excludeKinds: HELL_POPULATION_EXCLUDED_MONSTERS,
  });
}

function randomFloorCell(world: World): number {
  for (let attempt = 0; attempt < 2048; attempt++) {
    const cell = rng(0, W * W - 1);
    if (world.cells[cell] === Cell.FLOOR) return cell;
  }
  return -1;
}

function hash2(x: number, y: number, seed: number): number {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  n = Math.imul(n ^ (n >> 13), 1103515245);
  n ^= n >> 16;
  return (n & 0x7fffffff) / 0x7fffffff;
}

function wrapCoord(v: number): number {
  return ((v % W) + W) % W;
}
