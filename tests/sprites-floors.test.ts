import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, ContainerKind, DoorState, EntityType, Feature, FloorLevel, LiftDirection, MonsterKind, Occupation, Tex, W, type Entity } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { entityUsesProceduralSprite, generateNpcProfileSprite, generateProceduralEntitySprite, isFloor69FemaleSprite } from '../src/entities/procedural_visuals';
import { NPC_VISUAL_FLOOR69_FEMALE } from '../src/entities/npc_visuals';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { generateFloor, isFloorLevel } from '../src/gen/floor_manifest';
import { measureLivingShelterShells } from '../src/gen/living/geometry';
import { S } from '../src/render/pixutil';
import {
  containerSpr,
  featureSpr,
  monsterSpr,
  authoredNpcSpr,
  authoredNpcSpriteGeneratorOffset,
  Spr,
  SPRITE_CONTAINER_KINDS,
  SPRITE_FEATURES,
  SPRITE_MONSTER_KINDS,
} from '../src/render/sprite_index';
import { generateSprites } from '../src/render/sprites';
import { generateTextures } from '../src/render/textures';
import { rebuildWorld } from '../src/systems/samosbor';
import { testGenerationMatrix } from './generator_helpers';

const cachedFloors = new Map<string, ReturnType<typeof generateFloor>>();
let cachedFloor69: ReturnType<typeof generateDesignFloor> | undefined;

function floorForRead(floor: FloorLevel, seed?: number): ReturnType<typeof generateFloor> {
  const key = `${floor}:${seed ?? 'default'}`;
  let generated = cachedFloors.get(key);
  if (!generated) {
    generated = seed === undefined ? generateFloor(floor) : generateFloor(floor, seed);
    cachedFloors.set(key, generated);
  }
  return generated;
}

function floor69ForRead(): ReturnType<typeof generateDesignFloor> {
  cachedFloor69 ??= generateDesignFloor('floor_69');
  return cachedFloor69;
}

function spriteHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (let i = 0; i < sprite.length; i++) {
    h ^= sprite[i];
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function alphaMaskHash(sprite: Uint32Array): number {
  let h = 2166136261;
  for (let i = 0; i < sprite.length; i++) {
    h ^= (sprite[i] >>> 24) === 0 ? 0 : 1;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function opaquePixels(sprite: Uint32Array): number {
  let opaque = 0;
  for (const px of sprite) if ((px >>> 24) !== 0) opaque++;
  return opaque;
}

function spritePixel(sprite: Uint32Array, x: number, y: number): number {
  return sprite[y * S + x];
}

test('sprite registry and generated sheet stay aligned', () => {
  const sprites = generateSprites();

  assert.equal(sprites.length, Spr.TOTAL);
  assert.equal(featureSpr(Feature.DESK), Spr.DESK);
  assert.equal(Spr.FEATURE_BASE, Spr.DESK + 1);
  assert.equal(Spr.ART_NUDE_3, Spr.ART_NUDE_BASE + 3);
  assert.equal(Spr.F69_FEMALE_NPC_BASE, Spr.ART_NUDE_3 + 1);
  assert.equal(Spr.F69_FEMALE_NPC_7 + 1, Spr.TOTAL);
  for (let i = 0; i < sprites.length; i++) {
    assert.ok(sprites[i].length === S * S || sprites[i].length === 128 * 128, `Sprite ${i} has unexpected length: ${sprites[i].length}`);
    assert.ok(opaquePixels(sprites[i]) > 0, `sprite ${i} should not be blank`);
  }

  const seenHashes = new Map<number, number>();
  for (let i = 0; i < sprites.length; i++) {
    const hash = spriteHash(sprites[i]);
    const prev = seenHashes.get(hash);
    assert.equal(prev, undefined, `sprite ${i} duplicates sprite ${prev}`);
    seenHashes.set(hash, i);
  }

  const monsterKinds = Object.values(MonsterKind)
    .filter((value): value is MonsterKind => typeof value === 'number')
    .sort((a, b) => a - b);
  assert.deepEqual(SPRITE_MONSTER_KINDS, monsterKinds);
  const monsterSlots = SPRITE_MONSTER_KINDS.map(monsterSpr);
  assert.equal(new Set(monsterSlots).size, SPRITE_MONSTER_KINDS.length);
  for (const i of monsterSlots) {
    assert.ok(i >= 0 && i < Spr.TOTAL, `monster sprite ${i} should be in the atlas`);
    assert.ok(opaquePixels(sprites[i]) > 80, `monster sprite ${i} should not be blank`);
  }

  const featureIds = [Feature.DESK, ...SPRITE_FEATURES];
  assert.equal((SPRITE_FEATURES as readonly Feature[]).includes(Feature.DESK), false);
  const featureSlots = featureIds.map(featureSpr);
  assert.equal(new Set(featureSlots).size, featureIds.length);
  for (const i of featureSlots) {
    assert.ok(i >= 0 && i < Spr.TOTAL, `feature sprite ${i} should be in the atlas`);
    assert.ok(opaquePixels(sprites[i]) > 80, `feature sprite ${i} should not be blank`);
  }

  const containerKinds = Object.values(ContainerKind)
    .filter((value): value is ContainerKind => typeof value === 'number')
    .sort((a, b) => a - b);
  assert.deepEqual(SPRITE_CONTAINER_KINDS, containerKinds);
  const containerSlots = SPRITE_CONTAINER_KINDS.map(containerSpr);
  assert.equal(new Set(containerSlots).size, SPRITE_CONTAINER_KINDS.length);
  for (const i of containerSlots) {
    assert.ok(i >= 0 && i < Spr.TOTAL, `container sprite ${i} should be in the atlas`);
    assert.ok(opaquePixels(sprites[i]) > 80, `container sprite ${i} should not be blank`);
  }

  const projectileSprites = [
    Spr.EYE_BOLT,
    Spr.WEB_BOLT,
    Spr.WET_LINE_BOLT,
    Spr.BULLET,
    Spr.PELLET,
    Spr.NAIL,
    Spr.PSI_BOLT,
    Spr.PLASMA_BOLT,
    Spr.HOSTILE_BULLET,
    Spr.HOSTILE_PELLET,
    Spr.HOSTILE_NAIL,
    Spr.HOSTILE_PSI_BOLT,
    Spr.HOSTILE_PLASMA_BOLT,
    Spr.HOSTILE_FLAME_BOLT,
    Spr.GAUSS_BOLT,
    Spr.BFG_BOLT,
    Spr.FLAME_BOLT,
    Spr.GRENADE,
  ];
  for (const i of projectileSprites) {
    assert.ok(i >= 0 && i < Spr.TOTAL, `projectile sprite ${i} should be in the atlas`);
    assert.ok(opaquePixels(sprites[i]) > 20, `projectile sprite ${i} should not be blank`);
  }
  assert.notEqual(spriteHash(sprites[Spr.WEB_BOLT]), spriteHash(sprites[Spr.PARAGRAPH_BOLT]));
  assert.notEqual(spriteHash(sprites[Spr.WET_LINE_BOLT]), spriteHash(sprites[Spr.HOSTILE_PLASMA_BOLT]));

  const worldObjectSprites = [
    featureSpr(Feature.TABLE),
    featureSpr(Feature.CHAIR),
    featureSpr(Feature.BED),
    featureSpr(Feature.SHELF),
    featureSpr(Feature.MACHINE),
    featureSpr(Feature.SCREEN),
    containerSpr(ContainerKind.WOODEN_CHEST),
    containerSpr(ContainerKind.METAL_CABINET),
    containerSpr(ContainerKind.SAFE),
    containerSpr(ContainerKind.TRASH_BIN),
  ];
  for (const i of worldObjectSprites) {
    assert.ok(i >= 0 && i < Spr.TOTAL, `world object sprite ${i} should be in the atlas`);
    assert.ok(opaquePixels(sprites[i]) > 80, `world object sprite ${i} should not be blank`);
  }

  for (let i = Spr.ART_NUDE_BASE; i <= Spr.ART_NUDE_3; i++) {
    assert.ok(opaquePixels(sprites[i]) > 200, `art sprite ${i} should not be blank`);
  }
  for (let i = Spr.F69_FEMALE_NPC_BASE; i <= Spr.F69_FEMALE_NPC_7; i++) {
    assert.ok(opaquePixels(sprites[i]) > 200, `F69 fallback sprite ${i} should not be blank`);
  }
});

test('NPC profile sprite helper keeps authored slots and special NPC visual families', () => {
  const sprites = generateSprites();
  const gordonSlot = authoredNpcSpr('gordon_freeman');
  const gordon = generateNpcProfileSprite(123, Occupation.SCIENTIST, undefined, false, gordonSlot);
  const ira = generateNpcProfileSprite(456, Occupation.TRAVELER, undefined, true, Spr.F69_FEMALE_NPC_3, NPC_VISUAL_FLOOR69_FEMALE);
  const traveler = generateNpcProfileSprite(456, Occupation.TRAVELER, undefined, true, Occupation.TRAVELER);

  assert.equal(gordonSlot, Spr.GORDON);
  assert.equal(authoredNpcSpriteGeneratorOffset(gordonSlot) >= 0, true);
  assert.equal(spriteHash(gordon), spriteHash(sprites[Spr.GORDON]));
  assert.notEqual(spriteHash(ira), spriteHash(traveler));
  assert.notEqual(spriteHash(ira), spriteHash(sprites[Spr.F69_FEMALE_NPC_3]));
});

test('texture atlas procedural ranges stay allocated and filled', () => {
  const textures = generateTextures();

  assert.equal(textures.length, Tex.COUNT);
  assert.equal(Tex.PORTRAIT_BASE + 64, Tex.POSTER_BASE);
  assert.equal(Tex.POSTER_BASE + 64, Tex.F_PARQUET);
  assert.equal(Tex.F_CARPET_EDGE_BASE + 16, Tex.SCREEN_BASE);
  assert.equal(Tex.SCREEN_BASE + 32, Tex.LARVA_BODY);
  assert.equal(Tex.LARVA_BODY + 1, Tex.DOOR_HERMETIC);
  assert.equal(Tex.DOOR_HERMETIC + 1, Tex.COUNT);

  const ranges: readonly [string, number, number][] = [
    ['slides', Tex.SLIDE_1, Tex.SLIDE_8],
    ['hints', Tex.HINT_1, Tex.HINT_LORE],
    ['portraits', Tex.PORTRAIT_BASE, Tex.PORTRAIT_BASE + 63],
    ['posters', Tex.POSTER_BASE, Tex.POSTER_BASE + 63],
    ['carpet edges', Tex.F_CARPET_EDGE_BASE, Tex.F_CARPET_EDGE_BASE + 15],
    ['screens', Tex.SCREEN_BASE, Tex.SCREEN_BASE + 31],
  ];

  for (const [name, first, last] of ranges) {
    assert.ok(first >= 0 && last < Tex.COUNT && first <= last, `${name} range should fit the atlas`);
    for (let i = first; i <= last; i++) {
      assert.equal(textures[i].length, S * S, `${name} texture ${i} should have atlas-sized pixels`);
      assert.ok(opaquePixels(textures[i]) > S * S / 2, `${name} texture ${i} should not be blank`);
    }
  }

  for (let i = 0; i < textures.length; i++) {
    assert.equal(textures[i].length, S * S);
    assert.ok(opaquePixels(textures[i]) > 0, `texture ${i} should not be blank`);
  }
});

test('special NPC visual family overrides occupation procedural fallback when present', () => {
  const f69Npc: Entity = {
    id: 6901,
    type: EntityType.NPC,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: Spr.F69_FEMALE_NPC_0,
    npcVisualId: NPC_VISUAL_FLOOR69_FEMALE,
    occupation: Occupation.TRAVELER,
    isFemale: true,
  };
  const travelerNpc: Entity = {
    ...f69Npc,
    id: 6902,
    sprite: Occupation.TRAVELER,
  };
  const authoredNpc: Entity = {
    ...f69Npc,
    id: 6904,
    sprite: Spr.VETERAN,
    npcVisualId: undefined,
  };
  const f69AtlasFallback: Entity = {
    ...f69Npc,
    id: 6905,
    npcVisualId: undefined,
  };

  assert.equal(isFloor69FemaleSprite(f69Npc.sprite), true);
  assert.equal(entityUsesProceduralSprite(f69Npc), true);
  assert.equal(generateProceduralEntitySprite(f69Npc)?.length, S * S);
  assert.notEqual(spriteHash(generateProceduralEntitySprite(f69Npc)!), spriteHash(generateSprites()[Spr.F69_FEMALE_NPC_0]));
  assert.equal(entityUsesProceduralSprite(f69AtlasFallback), false);
  assert.equal(generateProceduralEntitySprite(f69AtlasFallback), null);
  assert.equal(entityUsesProceduralSprite(travelerNpc), true);
  assert.equal(generateProceduralEntitySprite(travelerNpc)?.length, S * S);
  assert.equal(entityUsesProceduralSprite(authoredNpc), false);
  assert.equal(generateProceduralEntitySprite(authoredNpc), null);
});

test('ordinary procedural NPC sprites keep legacy humanoid silhouettes with seeded color variation', () => {
  const sprites = generateSprites();
  const cases: Entity[] = [
    {
      id: 7101,
      type: EntityType.NPC,
      x: 1,
      y: 1,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 1,
      sprite: Occupation.DOCTOR,
      occupation: Occupation.DOCTOR,
      faction: undefined,
      isFemale: true,
      plotNpcId: 'olga',
      spriteSeed: 11,
    },
    {
      id: 7102,
      type: EntityType.NPC,
      x: 2,
      y: 1,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 1,
      sprite: Occupation.HUNTER,
      occupation: Occupation.HUNTER,
      faction: undefined,
      isFemale: false,
      plotNpcId: 'barni',
      spriteSeed: 12,
    },
    {
      id: 7103,
      type: EntityType.NPC,
      x: 3,
      y: 1,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 1,
      sprite: Occupation.SCIENTIST,
      occupation: Occupation.SCIENTIST,
      faction: undefined,
      isFemale: false,
      plotNpcId: 'yakov',
      spriteSeed: 13,
    },
  ];
  const generatedByPlotNpcId = new Map<string, Uint32Array>();

  for (const entity of cases) {
    const generated = generateProceduralEntitySprite(entity);
    assert.ok(generated, `${entity.plotNpcId} should still get a seeded procedural NPC texture`);
    generatedByPlotNpcId.set(entity.plotNpcId ?? '', generated);
    const atlas = sprites[entity.sprite];
    assert.equal(alphaMaskHash(generated), alphaMaskHash(atlas), `${entity.plotNpcId} should keep the legacy atlas silhouette`);
    assert.equal(opaquePixels(generated), opaquePixels(atlas), `${entity.plotNpcId} should not grow needle limbs outside the old mask`);
    assert.notEqual(spriteHash(generated), spriteHash(atlas), `${entity.plotNpcId} should keep per-entity color/detail variation`);
  }

  const olga = generatedByPlotNpcId.get('olga')!;
  assert.equal(spritePixel(olga, 30, 15), spritePixel(sprites[Occupation.DOCTOR], 30, 15), 'Olga should keep the old left eye pixel');
  assert.equal(spritePixel(olga, 34, 15), spritePixel(sprites[Occupation.DOCTOR], 34, 15), 'Olga should keep the old right eye pixel');

  const yakov = generatedByPlotNpcId.get('yakov')!;
  assert.equal(spritePixel(yakov, 29, 15), spritePixel(sprites[Occupation.SCIENTIST], 29, 15), 'Yakov should keep the old left glasses pixel');
  assert.equal(spritePixel(yakov, 30, 15), spritePixel(sprites[Occupation.SCIENTIST], 30, 15), 'Yakov should keep the old left pupil pixel');
  assert.equal(spritePixel(yakov, 34, 15), spritePixel(sprites[Occupation.SCIENTIST], 34, 15), 'Yakov should keep the old right pupil pixel');
  assert.equal(spritePixel(yakov, 35, 15), spritePixel(sprites[Occupation.SCIENTIST], 35, 15), 'Yakov should keep the old right glasses pixel');

  const barniA = generateProceduralEntitySprite(cases[1]);
  const barniB = generateProceduralEntitySprite({ ...cases[1], id: 7105, spriteSeed: 15 });
  assert.ok(barniA && barniB);
  assert.notEqual(spriteHash(barniA), spriteHash(barniB), 'ordinary non-art NPC variants should remain seeded, not one fixed atlas copy');
});

test('cult visual NPCs keep the newer procedural hood treatment', () => {
  const sprites = generateSprites();
  const pilgrim: Entity = {
    id: 7201,
    type: EntityType.NPC,
    x: 1,
    y: 1,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: Occupation.PILGRIM,
    occupation: Occupation.PILGRIM,
    isFemale: false,
    spriteSeed: 21,
  };
  const generated = generateProceduralEntitySprite(pilgrim);

  assert.ok(generated);
  assert.notEqual(alphaMaskHash(generated), alphaMaskHash(sprites[Occupation.PILGRIM]));
});

test('floor manifest validates known floors and rejects invalid ids', () => {
  assert.equal(isFloorLevel(FloorLevel.MINISTRY), true);
  assert.equal(isFloorLevel(FloorLevel.VOID), true);
  assert.equal(isFloorLevel(-1), false);
  assert.equal(isFloorLevel(999), false);
  assert.equal(isFloorLevel('2'), false);
});

testGenerationMatrix('all floor generators return playable spawn cells and live actors', () => {
  const floors = [
    FloorLevel.MINISTRY,
    FloorLevel.KVARTIRY,
    FloorLevel.LIVING,
    FloorLevel.MAINTENANCE,
    FloorLevel.HELL,
    FloorLevel.VOID,
  ];

  for (const floor of floors) {
    const generated = floorForRead(floor);
    const sx = Math.floor(generated.spawnX);
    const sy = Math.floor(generated.spawnY);
    const spawnIdx = generated.world.idx(sx, sy);

    assert.equal(generated.world.cells.length, 1024 * 1024);
    assert.ok(
      generated.world.cells[spawnIdx] === Cell.FLOOR || generated.world.cells[spawnIdx] === Cell.WATER,
      `floor ${floor} spawn must be passable`,
    );
    assert.equal(generated.world.solid(sx, sy), false, `floor ${floor} spawn must not be solid`);
    assert.equal(generated.world.zones.length, 64, `floor ${floor} should have 64 zones`);
    assert.ok(generated.entities.some(e => e.alive && (e.type === EntityType.NPC || e.type === EntityType.MONSTER)));
  }
});

testGenerationMatrix('living generation places AG89 Istotit supply cache quest content', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const plotNpcIds = new Set(generated.entities
    .filter(e => e.type === EntityType.NPC && e.plotNpcId)
    .map(e => e.plotNpcId));

  assert.equal(generated.world.rooms.some(room => room?.name === 'Общий свечной запас'), true);
  for (const id of ['ag89_agafa_svechnaya', 'ag89_savva_guard', 'ag89_markel_report', 'ag89_lida_barter']) {
    assert.equal(plotNpcIds.has(id), true, `${id} should spawn with AG89 supply cache`);
  }
});

testGenerationMatrix('living plot NPCs spawn with authored survivability and levels', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const byPlotNpcId = new Map(generated.entities
    .filter(e => e.type === EntityType.NPC && e.plotNpcId)
    .map(e => [e.plotNpcId, e]));
  const yakov = byPlotNpcId.get('yakov');
  const vanka = byPlotNpcId.get('vanka');

  assert.ok(yakov, 'Yakov should spawn on Living floor');
  assert.equal(yakov.hp, 800);
  assert.equal(yakov.maxHp, 800);
  assert.equal(yakov.rpg?.level, 10);
  assert.ok(vanka, 'Vanka should spawn on Living floor');
  assert.equal(vanka.hp, 300);
  assert.equal(vanka.maxHp, 300);
  assert.equal(vanka.rpg?.level, 2);
});

testGenerationMatrix('living start tutorial rooms keep samosbor-proof hermowalls', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  for (const name of ['Актовый зал', 'Оружейная']) {
    const room = generated.world.rooms.find(r => r?.name === name);
    assert.ok(room, `${name} should be generated`);
    let protectedWalls = 0;
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        if (dx !== -1 && dx !== room.w && dy !== -1 && dy !== room.h) continue;
        const idx = generated.world.idx(room.x + dx, room.y + dy);
        if (generated.world.cells[idx] === Cell.WALL && generated.world.hermoWall[idx]) protectedWalls++;
      }
    }
    assert.ok(protectedWalls > 0, `${name} should have hermowall perimeter cells`);
    assert.ok(room.doors.length > 0, `${name} should expose at least one hermodoor`);
    assert.ok(room.doors.some(idx => {
      const door = generated.world.doors.get(idx);
      return door &&
        (door.state === DoorState.HERMETIC_OPEN || door.state === DoorState.HERMETIC_CLOSED) &&
        generated.world.aptMask[idx] === 1 &&
        generated.world.hermoWall[idx] === 1;
    }), `${name} should have samosbor-proof hermodoor metadata`);
  }
});

testGenerationMatrix('living start tutorial hall exposes a public low-level loot locker', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const hall = generated.world.rooms.find(room => room?.name === 'Актовый зал');
  assert.ok(hall, 'act hall should be generated');
  const locker = generated.world.containers.find(container => container.name === 'Учебный шкафчик вылазки');
  assert.ok(locker, 'tutorial hall should contain a starter locker');
  const idx = generated.world.idx(locker.x, locker.y);
  const expectedIds = ['water', 'bread', 'bandage'];
  const actualIds = locker.inventory.map(item => item.defId);

  assert.equal(locker.kind, ContainerKind.EMERGENCY_BOX);
  assert.equal(locker.access, 'public');
  assert.equal(locker.discovered, true);
  assert.equal(locker.roomId, hall.id);
  assert.equal(generated.world.containerMap.get(idx)?.includes(locker.id), true);
  assert.equal(generated.world.features[idx], Feature.SHELF);
  assert.deepEqual(actualIds, expectedIds);
  assert.equal(locker.inventory.every(item => item.count > 0), true);
  assert.equal(locker.x <= hall.x + 2 && locker.y >= hall.y + hall.h - 3, true, 'starter locker should sit in a tutorial-room corner');
});

testGenerationMatrix('living macro routes keep landmarks, lifts and apartment shelters reachable', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const { world } = generated;
  const audit = auditReachability(world, world.idx(Math.floor(generated.spawnX), Math.floor(generated.spawnY)));

  function isRoomReachable(room: NonNullable<(typeof world.rooms)[number]>): boolean {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        if (audit.reachable[world.idx(room.x + dx, room.y + dy)]) return true;
      }
    }
    return false;
  }

  function namedRoomReachable(name: string): boolean {
    const room = world.rooms.find(r => r?.name.includes(name));
    assert.ok(room, `${name} should be generated`);
    return isRoomReachable(room);
  }

  for (const name of ['Актовый зал', 'Оружейная', 'Лаборатория', 'Комната Ваньки', 'Толкучка']) {
    assert.equal(namedRoomReachable(name), true, `${name} should be reachable from living spawn`);
  }

  let upLift = false;
  let downLift = false;
  let publicRouteCells = 0;
  let serviceRouteCells = 0;
  let shelterRouteCells = 0;
  for (let i = 0; i < world.cells.length; i++) {
    const x = i % W;
    const y = (i / W) | 0;
    if (world.cells[i] === Cell.LIFT) {
      const reachableLift = !!(
        audit.reachable[world.idx(x + 1, y)] ||
        audit.reachable[world.idx(x - 1, y)] ||
        audit.reachable[world.idx(x, y + 1)] ||
        audit.reachable[world.idx(x, y - 1)]
      );
      if (reachableLift && world.liftDir[i] === LiftDirection.UP) upLift = true;
      if (reachableLift && world.liftDir[i] === LiftDirection.DOWN) downLift = true;
      continue;
    }
    if (!audit.reachable[i] || world.aptMask[i] || world.roomMap[i] >= 0 || world.cells[i] !== Cell.FLOOR) continue;
    if (world.floorTex[i] === Tex.F_TILE) publicRouteCells++;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (world.wallTex[ni] === Tex.PIPE) serviceRouteCells++;
      if (world.wallTex[ni] === Tex.HERMO_WALL) shelterRouteCells++;
    }
  }
  assert.equal(upLift, true, 'living route should expose a reachable up lift');
  assert.equal(downLift, true, 'living route should expose a reachable down lift');
  assert.equal(publicRouteCells > 80, true, 'public route should be visibly tiled');
  assert.equal(serviceRouteCells > 40, true, 'service bypass should be visibly piped');
  assert.equal(shelterRouteCells > 40, true, 'shelter route should be visibly hermetic');

  let reachableRooms = 0;
  let totalAptRooms = 0;
  for (let ri = 0; ri < world.apartmentRoomCount; ri++) {
    const room = world.rooms[ri];
    if (!room) continue;
    if (room.apartmentId < 0) continue;
    totalAptRooms++;
    if (isRoomReachable(room)) reachableRooms++;
  }
  assert.equal(reachableRooms > totalAptRooms * 0.8, true, `most permanent rooms should be reachable (${reachableRooms}/${totalAptRooms})`);
  const shell = measureLivingShelterShells(world);
  assert.equal(shell.roomCount > 0, true, 'living generation should measure hermetic shelter shells');
  assert.equal(shell.shellCells > 0, true, 'living generation should expose walkable shelter shell cells');
});

testGenerationMatrix('living start tutorial desks are feature props, not billboard entities', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const tutorialRoomIds = new Set(
    generated.world.rooms
      .filter(room => room?.name === 'Актовый зал' || room?.name === 'Оружейная')
      .map(room => room.id),
  );
  let tutorDeskFeatures = 0;
  for (let i = 0; i < generated.world.features.length; i++) {
    if (generated.world.features[i] === Feature.DESK && tutorialRoomIds.has(generated.world.roomMap[i])) {
      tutorDeskFeatures++;
    }
  }
  const tutorDeskBillboards = generated.entities.filter(e =>
    e.type === EntityType.BILLBOARD &&
    e.sprite === Spr.DESK &&
    tutorialRoomIds.has(generated.world.roomMap[generated.world.idx(Math.floor(e.x), Math.floor(e.y))]));

  assert.ok(tutorDeskFeatures >= 19, `tutorial desks and armory counter should be feature props: ${tutorDeskFeatures}`);
  assert.equal(tutorDeskBillboards.length, 0);
  assert.ok(generated.entities.some(e =>
    e.type === EntityType.ITEM_DROP &&
    e.sprite === Spr.ITEM_DROP &&
    e.inventory?.some(slot => slot.defId === 'ammo_9mm' && slot.count > 0)));
});

testGenerationMatrix('living art study sprites are billboards, not empty item drops', () => {
  const generated = floorForRead(FloorLevel.LIVING);
  const artProps = generated.entities.filter(e =>
    e.type === EntityType.BILLBOARD &&
    e.sprite >= Spr.ART_NUDE_BASE &&
    e.sprite <= Spr.ART_NUDE_3);

  assert.equal(artProps.length >= 4, true);
  assert.equal(artProps.every(e => e.spriteScale === 0.88 && !e.inventory?.length), true);
});

testGenerationMatrix('floor 69 floor screens are registered as signal screen cells', () => {
  const generated = floor69ForRead();
  const screenFeatureCells: number[] = [];
  for (let i = 0; i < generated.world.features.length; i++) {
    if (generated.world.features[i] === Feature.SCREEN) screenFeatureCells.push(i);
  }

  assert.ok(screenFeatureCells.length >= 2);
  for (const ci of screenFeatureCells) {
    assert.equal(generated.world.screenCells.includes(ci), true, `screen feature cell ${ci} should be in screenCells`);
  }
});

testGenerationMatrix('non-living samosbor rebuild replaces stale generated actors but keeps player', () => {
  const generated = generateFloor(FloorLevel.MAINTENANCE);
  const entities = [...generated.entities];
  entities.push(
    {
      id: 9001,
      type: EntityType.NPC, persistentNpcId: 'player',
      x: generated.spawnX,
      y: generated.spawnY,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: 0,
    },
    {
      id: 9002,
      type: EntityType.NPC,
      x: generated.spawnX + 1,
      y: generated.spawnY,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: 0,
    },
    {
      id: 9003,
      type: EntityType.MONSTER,
      x: generated.spawnX + 2,
      y: generated.spawnY,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: 0,
    },
  );

  rebuildWorld(generated.world, entities, { v: 10000 }, 1, FloorLevel.MAINTENANCE);

  const player = entities.find(e => e.id === 9001);
  assert.ok(player);
  assert.equal(entities.some(e => e.id === 9002), false);
  assert.equal(entities.some(e => e.id === 9003), false);
  assert.ok(entities.some(e => e.id >= 10000 && (e.type === EntityType.NPC || e.type === EntityType.MONSTER)));
  const playerCell = generated.world.cells[generated.world.idx(Math.floor(player.x), Math.floor(player.y))];
  assert.ok(playerCell === Cell.FLOOR || playerCell === Cell.WATER);
});
