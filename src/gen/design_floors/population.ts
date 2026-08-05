import {
  AIGoal,
  EntityType,
  Faction,
  FloorLevel,
  MonsterKind,
  Occupation,
  RoomType,
  W,
  type Entity,
} from '../../core/types';
import { hashSeed } from '../../core/rand';
import type { DesignFloorRouteDef } from '../../data/design_floors';
import {
  designFloorPopulationProfile,
  type WeightedDesignValue,
} from '../../data/design_floor_population';
import { chooseFloorMonsterKind } from '../../data/monster_ecology';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG } from '../../systems/rpg';
import { entitySpawnSlots } from '../../systems/entity_limits';
import type { FloorGeneration } from '../floor_manifest';
import { sampleNaturalPopulationCells } from '../population_placement';

function rand32(seed: number, serial: number, salt: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(serial ^ 0xc2b2ae35, 0x27d4eb2d) + salt;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 0x100000000;
}

function pickWeighted<T>(items: readonly WeightedDesignValue<T>[], seed: number, serial: number, salt: number): T {
  let total = 0;
  for (const item of items) total += Math.max(0, item.weight);
  if (total <= 0) return items[0].value;
  let roll = rand32(seed, serial, salt) * total;
  for (const item of items) {
    roll -= Math.max(0, item.weight);
    if (roll <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1;
}

function nextEntityId(entities: readonly Entity[]): number {
  let next = 1;
  for (const entity of entities) next = Math.max(next, entity.id + 1);
  return next;
}

function roomTypeAt(generation: FloorGeneration, cell: number): RoomType | undefined {
  const rid = generation.world.roomMap[cell];
  return rid >= 0 ? generation.world.rooms[rid]?.type : RoomType.CORRIDOR;
}

function designMonsterFloor(route: DesignFloorRouteDef): FloorLevel {
  if (route.z <= -48) return FloorLevel.VOID;
  if (route.z <= -34) return FloorLevel.HELL;
  if (route.z <= -14) return FloorLevel.MAINTENANCE;
  if (route.z >= 42) return FloorLevel.MAINTENANCE;
  return route.baseFloor;
}

function makeAmbientNpcTemplate(
  id: number,
  cell: number,
  route: DesignFloorRouteDef,
  noun: string,
  npcLevel: number,
  serial: number,
  seed: number,
  faction: Faction,
  occupation: Occupation,
): Entity {
  const x = cell % W;
  const y = (cell / W) | 0;
  const child = occupation === Occupation.CHILD;
  const hp = child ? 55 : Math.round(70 + Math.min(95, Math.abs(route.z) * 1.3 + npcLevel * 7));
  return {
    id,
    type: EntityType.NPC,
    x: x + 0.5,
    y: y + 0.5,
    angle: rand32(seed, serial, 77) * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: child ? 0.78 : 0.95 + rand32(seed, serial, 79) * 0.42,
    sprite: occupation,
    spriteScale: child ? 0.6 : undefined,
    name: `${route.displayName}: ${noun} ${serial + 1}`,
    hp,
    maxHp: hp,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    faction,
    occupation,
    isTraveler: occupation === Occupation.TRAVELER || occupation === Occupation.HUNTER || occupation === Occupation.PILGRIM,
    assignedRoomId: -1,
    questId: -1,
    canGiveQuest: false,
    rpg: randomRPG(child ? 1 : npcLevel),
  };
}

function spawnAmbientNpcTemplates(generation: FloorGeneration, route: DesignFloorRouteDef, firstId: number): number {
  const profile = designFloorPopulationProfile(route);
  if (profile.npcTarget <= 0) {
    let write = 0;
    for (let read = 0; read < generation.entities.length; read++) {
      const entity = generation.entities[read];
      if (isAmbientNpcTemplate(entity)) continue;
      generation.entities[write++] = entity;
    }
    generation.entities.length = write;
    return firstId;
  }
  const existing = generation.entities.filter(isAmbientNpcTemplate).length;
  const requested = Math.max(0, profile.npcTarget - existing);
  const count = entitySpawnSlots(generation.entities, EntityType.NPC, requested);
  if (count <= 0) return firstId;
  const seed = hashSeed(`design-pop:npc:${route.id}:${route.z}`, route.z);
  const cells = sampleNaturalPopulationCells(generation.world, count, profile.npcPlacement, seed);
  let nextId = firstId;
  for (let i = 0; i < cells.length; i++) {
    const faction = pickWeighted(profile.npcFactions, seed, i, 101);
    const occupation = pickWeighted(profile.npcOccupations, seed, i, 301);
    generation.entities.push(makeAmbientNpcTemplate(nextId++, cells[i], route, profile.npcNoun, profile.npcLevel, i, seed, faction, occupation));
  }
  return nextId;
}

function spawnDesignMonsters(generation: FloorGeneration, route: DesignFloorRouteDef, firstId: number): number {
  const profile = designFloorPopulationProfile(route);
  if (profile.monsterTarget <= 0) return firstId;
  const existing = generation.entities.filter(entity => entity.alive && entity.type === EntityType.MONSTER).length;
  const requested = Math.max(0, profile.monsterTarget - existing);
  const count = entitySpawnSlots(generation.entities, EntityType.MONSTER, requested);
  if (count <= 0) return firstId;
  const seed = hashSeed(`design-pop:monster:${route.id}:${route.z}`, route.z);
  const cells = sampleNaturalPopulationCells(generation.world, count, profile.monsterPlacement, seed);
  const floor = designMonsterFloor(route);
  let nextId = firstId;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const x = cell % W;
    const y = (cell / W) | 0;
    let monsterRoll = 0;
    const kind = chooseFloorMonsterKind({
      floor,
      roomType: roomTypeAt(generation, cell),
      floorTags: [
        route.id,
        ...profile.monsterTags,
        route.baseFloor === FloorLevel.MINISTRY ? 'documents' : '',
        route.baseFloor === FloorLevel.MAINTENANCE ? 'industrial' : '',
      ].filter(Boolean),
      samosborCount: Math.max(1, route.danger),
      allowRare: false,
      allowOffFloor: true,
      biasKinds: profile.monsterBiasKinds,
      routePressure: Math.min(4, Math.floor(Math.abs(route.z) / 12)),
      rng: () => rand32(seed, i, 503 + monsterRoll++),
    });
    const def = MONSTERS[kind];
    if (!def) continue;
    const zoneLevel = generation.world.zones[generation.world.zoneMap[cell]]?.level ?? route.danger;
    const level = Math.max(1, Math.min(12, profile.monsterLevel + Math.floor(zoneLevel / 2)));
    const hp = Math.round(def.hp * (0.75 + level * 0.13));
    generation.entities.push({
      id: nextId++,
      type: EntityType.MONSTER,
      x: x + 0.5,
      y: y + 0.5,
      angle: rand32(seed, i, 709) * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: def.speed * (0.95 + Math.min(0.35, Math.abs(route.z) * 0.006)),
      sprite: monsterSpr(kind),
      hp,
      maxHp: hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(level),
      phasing: kind === MonsterKind.SPIRIT || kind === MonsterKind.SHADOW || kind === MonsterKind.TONKAYA_TEN || kind === MonsterKind.GLUBINNAYA_TEN,
    });
  }
  return nextId;
}

export function applyDesignFloorPopulationField(generation: FloorGeneration, route: DesignFloorRouteDef): void {
  let nextId = nextEntityId(generation.entities);
  nextId = spawnAmbientNpcTemplates(generation, route, nextId);
  spawnDesignMonsters(generation, route, nextId);
}
