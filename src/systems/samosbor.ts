import { xorshift32 } from '../core/rand';
/* ── САМОСБОР — the maze restructures itself ─────────────────── */
/*   Every floor runs a local wave from a random mutable map point. */
/*   Protected rooms, hermowalls and lifts are preserved.           */

import {
  W, Cell, DoorState, ZoneFaction, FloorLevel, RoomType, Tex, Feature, ContainerKind, Faction,
  type Entity, type GameState, type Msg, type Room, type WorldContainer, type WorldEventType,
  EntityType, AIGoal, MonsterKind, Occupation,
  msg,
} from '../core/types';
import { World, replaceWorldFromGeneration, type WorldGridDirtyRect } from '../core/world';
import { secureRandom } from "../core/rand";
import { ITEMS, NOTES, freshNeeds, randomName } from '../data/catalog';
import { MAX_INVENTORY_SLOTS } from '../data/inventory_limits';
import { addFactionRelMutual } from '../data/relations';
import { getStack, spawnCount } from '../data/items';
import { chooseFloorMonsterKind } from '../data/monster_ecology';
import { MONSTERS } from '../entities/monster';
import { Spr } from '../render/sprite_index';
import { stampMark, MarkType } from './surface_marks';
import { forceHide } from './ai';
import { SeedRng } from '../core/rand';
import {
  playIstotitBell,
  playMaronaryPing,
  playMaronarySignal,
  playSamosborAlarm,
  playSamosborRoomSiren,
  playSoundAt,
  playVeretarSignal,
  setAmbientDroneMode,
  type AmbientDroneMode,
} from './audio';
import { recordPlayerDamage } from './damage';
import { reassignQuestGivers } from './quests';
import { regrowMaze } from '../gen/living';
import { floorLevelDisplayName, generateFloor, type FloorGeneration } from '../gen/floor_manifest';
import { clearPathBlockerRegion, rebuildPathBlockersFromWorldObjects } from '../gen/path_blockers';
import { flashSamosborWarningScreens } from '../gen/procedural_screens';
import { rng, pick, weightedPick } from '../gen/shared';
import { getMaxHp, scaleMonsterHp, scaleMonsterSpeed, randomRPG } from './rpg';
import { publishEvent } from './events';
import { generateNpcLoadout } from './procedural_loot';
import { setDoorState } from './door_state';

import {
  ensureFloorRunState,
  nextFloorRunSamosborCooldown,
  nextFloorRunSamosborDuration,
  SAMOSBOR_DURATION_MAX_SEC,
  SAMOSBOR_DURATION_MIN_SEC,
} from './procedural_floors';
import { controlHint } from './controls';
import { ENTITY_MASK_ACTOR, ENTITY_MASK_NPC, ENTITY_MASK_VISIBLE, ensureEntityIndex, rebuildEntityIndex } from './entity_index';
import { assignPersistentAlifeNpcFromEntity, recordAlifeNpcDeath, rewriteAlifeNpcIdentityFromEntity } from './alife';
import { getSamosborLocalShelters } from './samosbor_hooks';
import { replaceCellHazards } from './cell_hazards';
import { tickSamosborDirector } from './samosbor_director';
import { ensureRoomContainers } from './containers';
import { replaceRouteCueStateForRebuild } from './route_cues';
import { replaceEmergencyPanelStateForRebuild } from './emergency_panels';
import { changeResourceStock } from './economy';
import { observeRumorEvent } from './rumor';
import { publishNoise } from './noise';
import { getNpcMemory } from './npc_memory';
import {
  freezeNavigationCacheForWorld,
  steerEntityTowardCell,
  tryAssignPathToCell,
  unfreezeNavigationCacheForWorld,
} from './ai/pathfinding';
import { pushNpcBarkMessage } from './ai/barks';
import { hearingRadiusMetersForActor } from './hearing';
import { createMaronaryWrongDoorRemap } from './wrong_door';
import { canSpawnEntityType, entitySpawnSlots } from './entity_limits';
import {
  blocksHermodoorBorerSeal,
  clearHermodoorBorerForRebuild,
  queuePostSamosborHermodoorBorer,
  updateHermodoorBorer,
} from './hermodoor_borer';
import {
  applyFrontFieldStitch,
  cancelSamosborWave,
  clearSamosborWaveSnapshot,
  getSamosborWaveDebugLines,
  isSamosborWaveActive,
  isSamosborWaveDebugActive,
  tickSamosborWave,
} from './samosbor_wave';
import {
  type ActiveSamosborVariant,
  type SamosborAftermathBeatDef,
  type SamosborSubsystemId,
  getSamosborAftermathBeats,
  getSamosborVariantName,
  samosborVariantHasSubsystem,
} from '../data/samosbor_variants';
import {
  chooseSamosborVariant,
  clearActiveSamosborVariant,
  getActiveSamosborVariant,
  getForcedSamosborVariant,
  getLastSamosborVariant,
} from './samosbor_variants_runtime';
import { isPlayerEntity } from './player_actor';
import {
  paintTerritoryDisc,
  setTerritoryOwnerAtIndex,
  syncZoneMetadataFromTerritory,
  territoryOwnerAt,
  territoryOwnerAtIndex,
} from './territory';

const MONSTERS_PER_SAMOSBOR = 16;
const RANDOM_MAP_MONSTERS_PER_SAMOSBOR = 22;
const FOG_SAMPLES_PER_TICK = 128;  // random cells sampled per tick for fog spread (doubled for global chaos)
const FOG_SPAWN_INTERVAL  = 1.0;   // seconds between monster spawns in fog
const SEAL_BEFORE_END = 10;        // seal apartments 10 seconds before samosbor ends
const SAMOSBOR_DIRECTOR_ACTIVE_INTERVAL = 12;
const SAMOSBOR_WARNING_WINDOW = 30; // warning 30s before impact
const SAMOSBOR_WARNING_SCREEN_RADIUS = 42;
const SAMOSBOR_WARNING_SCREEN_CAP = 8;
const SAMOSBOR_WARNING_BARK_RADIUS2 = 28 * 28;
const SAMOSBOR_WARNING_BARK_CAP = 3;
const SAMOSBOR_ROOM_SIREN_INTERVAL = 1.35;
const SAMOSBOR_ROOM_SIREN_SOURCE_CAP = 4;
const SAMOSBOR_ROOM_SIREN_RADIUS = 30;
const SAMOSBOR_FOG_EFFECT_SEARCH_ATTEMPTS = 96;
const SAMOSBOR_FOG_EFFECT_ENTITY_CAP = 10;
const SAMOSBOR_FOG_EFFECT_NOTICE_INTERVAL = 4;
const MARONARY_SOURCE_RADIUS = 34;
const MARONARY_SOURCE_CAP = 3;
const MARONARY_WRONG_DOOR_RADIUS = 24;
const MARONARY_PING_INTERVAL = 4.75;
const MARONARY_GLOW_RADIUS = 2.65;
const MARONARY_GLOW_DAMAGE_PER_SECOND = 3;
const MARONARY_GLOW_INTERVAL = 0.7;
const MARONARY_GLOW_ACTOR_CAP = 8;
const ISTOTIT_SHELTER_SEARCH_RADIUS = 46;
const ISTOTIT_SHELTER_CANDIDATE_CAP = 9;
const ISTOTIT_SUPPLY_TAG = 'istotit_supply';
const ISTOTIT_DECISION_RADIUS2 = 4.5 * 4.5;
const ISTOTIT_DECISION_RADIUS = Math.sqrt(ISTOTIT_DECISION_RADIUS2);
const PLAYER_SHELTER_DOOR_CAP = 12;
const UNSHELTERED_HP_DAMAGE = 4;
const UNSHELTERED_PSI_DAMAGE = 3;
const SAMOSBOR_RANDOM_ENTITY_TRANSFER_INTERVAL = 1;
const SAMOSBOR_RANDOM_ENTITY_TRANSFER_ENTITY_ATTEMPTS = 32;
const SAMOSBOR_RANDOM_ENTITY_TRANSFER_CELL_ATTEMPTS = 384;
const SAMOSBOR_PLAYER_PRESSURE_INTERVAL = 1;
const SAMOSBOR_PLAYER_PRESSURE_MIN_RADIUS = 8;
const SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS = 24;
const SAMOSBOR_PLAYER_PRESSURE_PICK_ATTEMPTS = 12;
const AFTERMATH_FACTION_CONTROL_CAP = 96;
const FOG_DIRS_X = [1, -1, 0, 0];
const FOG_DIRS_Y = [0, 0, 1, -1];
const RANDOM_NPC_FACTIONS = [
  Faction.CITIZEN,
  Faction.LIQUIDATOR,
  Faction.CULTIST,
  Faction.SCIENTIST,
  Faction.WILD,
] as const;
const RANDOM_NPC_OCCUPATIONS = [
  Occupation.HOUSEWIFE,
  Occupation.LOCKSMITH,
  Occupation.SECRETARY,
  Occupation.ELECTRICIAN,
  Occupation.COOK,
  Occupation.DOCTOR,
  Occupation.TURNER,
  Occupation.MECHANIC,
  Occupation.STOREKEEPER,
  Occupation.ALCOHOLIC,
  Occupation.SCIENTIST,
  Occupation.TRAVELER,
  Occupation.PILGRIM,
  Occupation.HUNTER,
  Occupation.PRIEST,
  Occupation.PERFORMER,
] as const;
const RANDOM_WALL_TEX = [Tex.CONCRETE, Tex.BRICK, Tex.PANEL, Tex.TILE_W, Tex.METAL, Tex.ROTTEN, Tex.CURTAIN, Tex.DARK, Tex.PIPE, Tex.MEAT, Tex.VOID_WALL, Tex.MARBLE] as const;
const RANDOM_FLOOR_TEX = [Tex.F_CONCRETE, Tex.F_LINO, Tex.F_TILE, Tex.F_WOOD, Tex.F_CARPET, Tex.F_WATER, Tex.F_MEAT, Tex.F_GUT, Tex.F_VOID, Tex.F_RED_CARPET, Tex.F_GREEN_CARPET, Tex.F_MARBLE_TILE, Tex.F_PARQUET] as const;
const RANDOM_FEATURES = [Feature.NONE, Feature.LAMP, Feature.TABLE, Feature.CHAIR, Feature.BED, Feature.STOVE, Feature.SINK, Feature.TOILET, Feature.SHELF, Feature.MACHINE, Feature.APPARATUS, Feature.DESK, Feature.CANDLE, Feature.SCREEN] as const;

function cellDirtyRect(ci: number): WorldGridDirtyRect {
  return { x: ci % W, y: (ci / W) | 0, w: 1, h: 1 };
}

function pushCellDirtyRect(out: WorldGridDirtyRect[], ci: number): void {
  out.push(cellDirtyRect(ci));
}

function wrapAxisRects(start: number, length: number): Array<{ start: number; length: number }> {
  if (length >= W) return [{ start: 0, length: W }];
  const s = ((start % W) + W) % W;
  if (s + length <= W) return [{ start: s, length }];
  return [
    { start: s, length: W - s },
    { start: 0, length: (s + length) % W },
  ];
}

function squareDirtyRects(cx: number, cy: number, radius: number): WorldGridDirtyRect[] {
  const r = Math.max(0, Math.floor(radius));
  const size = Math.min(W, r * 2 + 1);
  const xs = wrapAxisRects(Math.floor(cx) - r, size);
  const ys = wrapAxisRects(Math.floor(cy) - r, size);
  const rects: WorldGridDirtyRect[] = [];
  for (const y of ys) {
    for (const x of xs) rects.push({ x: x.start, y: y.start, w: x.length, h: y.length });
  }
  return rects;
}

let samosborSealed = false;       // track whether apartments were sealed this samosbor
let activeSamosborZoneId = -1;
let activeSamosborPreviousZoneFaction: ZoneFaction | null = null;
let activeSamosborPreviousTerritory: { idx: number; owner: ZoneFaction }[] = [];
let activeSamosborPreviousZoneFogged = false;
let knownSamosborTime = 0;
let samosborDirectorAccum = 0;
let maronaryPingAccum = 0;
let maronaryGlowAccum = 0;
let randomEntityTransferAccum = 0;
let maronaryGlowNoticeAt = -Infinity;
let maronaryGlowCells: number[] = [];
let playerPressureSpawnAccum = 0;
let activeSamosborScale: 'full' = 'full';

let istotitShelterRoomIds: number[] = [];
let istotitShelterCycle = -1;
let istotitShelterFloor = FloorLevel.LIVING;
let istotitSupplyContainerIds: number[] = [];
let istotitDecisionCycle = -1;
let istotitDecision = '';
let samosborPlayerShelterRoomId = -1;

/* ── Multi-front chaotic wave engine ──────────────────────────── */
/*   Instead of a single fog origin, samosbor launches 3–8        */
/*   simultaneous fronts across the entire floor. Each front       */
/*   propagates as cracks, waves, tendrils, or flashes, mutating   */
/*   cells and spawning monsters as it goes.                       */

type SamosborFrontType = 'crack' | 'wave' | 'tendril' | 'flash';

interface SamosborFront {
  type: SamosborFrontType;
  originIdx: number;
  frontier: number[];       // BFS queue of cell indices to process
  head: number;             // read pointer into frontier
  budget: number;           // cells to process per tick
  speed: number;            // multiplier for budget
  age: number;              // ticks alive
  maxAge: number;           // auto-expire after this many ticks
  processed: number;        // total cells processed
  changed: number;          // total cells mutated
  monstersSpawned: number;
  dead: boolean;
  visited: Set<number>;     // persistent BFS visited set — avoids O(N) rebuild per tick
}

const FRONT_MIN_COUNT = 6;
const FRONT_MAX_COUNT = 14;
const FRONT_BUDGET_CRACK   = 16;     // narrow, fast
const FRONT_BUDGET_WAVE    = 36;    // wide, steady
const FRONT_BUDGET_TENDRIL = 12;     // long, winding
const FRONT_BUDGET_FLASH   = 96;    // instant burst, short-lived
const FRONT_MAX_AGE_CRACK   = 300;
const FRONT_MAX_AGE_WAVE    = 500;
const FRONT_MAX_AGE_TENDRIL = 400;
const FRONT_MAX_AGE_FLASH   = 30;   // flashes die fast
const FRONT_MONSTER_CELL_INTERVAL = 30; // spawn 1 monster per N processed cells
const FRONT_TYPES: SamosborFrontType[] = ['crack', 'wave', 'tendril', 'flash'];
const FRONT_TYPE_WEIGHTS: Record<SamosborFrontType, number> = {
  crack: 45, wave: 25, tendril: 20, flash: 10,
};

let activeSamosborFronts: SamosborFront[] = [];
let frontTouchedCells = new Set<number>(); // all cells mutated by fronts (for post-samosbor stitch)
let samosborFrontTickAccum = 0;
export const SAMOSBOR_FRONT_TICK_INTERVAL = 0.05; // 20 Hz front processing
export const SAMOSBOR_FRONT_MAX_CATCHUP_TICKS = 2; // cap catch-up to prevent multi-tick bursts on FPS drops

function pickFrontType(): SamosborFrontType {
  let total = 0;
  for (const t of FRONT_TYPES) total += FRONT_TYPE_WEIGHTS[t];
  let roll = Math.random() * total;
  for (const t of FRONT_TYPES) {
    roll -= FRONT_TYPE_WEIGHTS[t];
    if (roll <= 0) return t;
  }
  return 'wave';
}

function frontBudget(type: SamosborFrontType): number {
  switch (type) {
    case 'crack':   return FRONT_BUDGET_CRACK;
    case 'wave':    return FRONT_BUDGET_WAVE;
    case 'tendril': return FRONT_BUDGET_TENDRIL;
    case 'flash':   return FRONT_BUDGET_FLASH;
  }
}

function frontMaxAge(type: SamosborFrontType): number {
  switch (type) {
    case 'crack':   return FRONT_MAX_AGE_CRACK;
    case 'wave':    return FRONT_MAX_AGE_WAVE;
    case 'tendril': return FRONT_MAX_AGE_TENDRIL;
    case 'flash':   return FRONT_MAX_AGE_FLASH;
  }
}

function canFrontMutateCell(world: World, ci: number, shelterSet: ReadonlySet<number>): boolean {
  if (world.aptMask[ci] || world.hermoWall[ci]) return false;
  if (world.cells[ci] === Cell.LIFT) return false;
  const roomId = world.roomMap[ci];
  if (roomId >= 0 && shelterSet.has(roomId)) return false;
  return true;
}

function frontExpandNeighbors(
  world: World,
  ci: number,
  type: SamosborFrontType,
  frontier: number[],
  visited: Set<number>,
  shelterSet: ReadonlySet<number>,
): void {
  const x = ci % W;
  const y = (ci / W) | 0;
  // Random start index for organic feel — zero allocs vs array+shuffle
  const start = (Math.random() * 4) | 0;

  const maxExpand = type === 'crack' ? 2 : type === 'tendril' ? 2 : type === 'flash' ? 4 : 4;
  let added = 0;
  for (let i = 0; i < 4; i++) {
    if (added >= maxExpand) break;
    const d = (start + i) & 3;
    const nx = world.wrap(x + FOG_DIRS_X[d]);
    const ny = world.wrap(y + FOG_DIRS_Y[d]);
    const ni = world.idx(nx, ny);
    if (visited.has(ni)) continue;
    if (!canFrontMutateCell(world, ni, shelterSet)) continue;
    const cell = world.cells[ni];
    // Allow floor, water, door AND walls (walls get carved or grown)
    if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.WALL) continue;

    // Walls are accepted into frontier with reduced probability to keep organic spread
    if (cell === Cell.WALL) {
      if (type === 'crack' && Math.random() > 0.6) continue;
      if (type === 'tendril' && Math.random() > 0.45) continue;
      if (type === 'wave' && Math.random() > 0.5) continue;
      if (type === 'flash' && Math.random() > 0.7) continue;
    }

    // Crack: prefer corridors (no room), random branch 20%
    if (type === 'crack' && cell !== Cell.WALL) {
      if (world.roomMap[ni] >= 0 && Math.random() > 0.2) continue;
    }
    // Tendril: follow corridors, occasional room entry
    if (type === 'tendril' && cell !== Cell.WALL) {
      if (world.roomMap[ni] >= 0 && Math.random() > 0.35) continue;
    }
    visited.add(ni);
    frontier.push(ni);
    added++;
  }
}

function frontWalkableNeighborCount(world: World, ci: number): number {
  const x = ci % W;
  const y = (ci / W) | 0;
  let count = 0;
  for (let d = 0; d < 4; d++) {
    const ni = world.idx(world.wrap(x + FOG_DIRS_X[d]), world.wrap(y + FOG_DIRS_Y[d]));
    const c = world.cells[ni];
    if (c === Cell.FLOOR || c === Cell.WATER || c === Cell.DOOR) count++;
  }
  return count;
}

function frontAdjacentLiftOrProtected(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let d = 0; d < 4; d++) {
    const ni = world.idx(world.wrap(x + FOG_DIRS_X[d]), world.wrap(y + FOG_DIRS_Y[d]));
    if (world.cells[ni] === Cell.LIFT || world.aptMask[ni] || world.hermoWall[ni]) return true;
    if (world.features[ni] === Feature.LIFT_BUTTON) return true;
  }
  return false;
}

/** Flags returned by mutateFrontCell for batched dirty marking */
const FRONT_DIRTY_NONE     = 0;
const FRONT_DIRTY_CELLS    = 1;
const FRONT_DIRTY_FLOOR_TX = 2;
const FRONT_DIRTY_WALL_TX  = 4;
const FRONT_DIRTY_SURFACE  = 8;
const FRONT_DIRTY_FOG      = 16;

function mutateFrontCell(
  world: World,
  ci: number,
  variant: ActiveSamosborVariant,
): number /* dirty flags bitmask */ {
  const cell = world.cells[ci];
  let flags = FRONT_DIRTY_NONE;

  // ── Wall → Floor: carve new corridor (~40% of walls encountered) ──
  if (cell === Cell.WALL) {
    if (frontAdjacentLiftOrProtected(world, ci)) return FRONT_DIRTY_NONE;
    if (frontWalkableNeighborCount(world, ci) < 1) return FRONT_DIRTY_NONE;
    if (Math.random() < 0.60) {
      if (world.cells[ci] === Cell.DOOR) world.removeDoorAt(ci);
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = RANDOM_FLOOR_TEX[(Math.random() * RANDOM_FLOOR_TEX.length) | 0];
      world.wallTex[ci] = RANDOM_WALL_TEX[(Math.random() * RANDOM_WALL_TEX.length) | 0];
      if (world.roomMap[ci] >= 0) world.roomMap[ci] = -1;
      if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
      world.fog[ci] = Math.min(255, 180 + ((Math.random() * 75) | 0));
      world.tissue[ci] = Math.min(255, 160 + ((Math.random() * 95) | 0));
      frontTouchedCells.add(ci);
      return FRONT_DIRTY_CELLS | FRONT_DIRTY_FLOOR_TX | FRONT_DIRTY_WALL_TX | FRONT_DIRTY_SURFACE | FRONT_DIRTY_FOG;
    }
    // Even if not carved, mutate the wall texture
    world.wallTex[ci] = RANDOM_WALL_TEX[(Math.random() * RANDOM_WALL_TEX.length) | 0];
    return FRONT_DIRTY_WALL_TX | FRONT_DIRTY_SURFACE;
  }

  // ── Floor/Water/Door cells ──

  // Floor → Wall: grow wall (~22% — block passages, create chaos)
  if (cell === Cell.FLOOR && Math.random() < 0.22) {
    if (!frontAdjacentLiftOrProtected(world, ci) && frontWalkableNeighborCount(world, ci) >= 3) {
      if (world.cells[ci] === Cell.DOOR) world.removeDoorAt(ci);
      if (world.features[ci] !== Feature.NONE) world.features[ci] = Feature.NONE;
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = RANDOM_WALL_TEX[(Math.random() * RANDOM_WALL_TEX.length) | 0];
      if (world.roomMap[ci] >= 0) world.roomMap[ci] = -1;
      world.fog[ci] = 0;
      world.tissue[ci] = 0;
      frontTouchedCells.add(ci);
      return FRONT_DIRTY_CELLS | FRONT_DIRTY_WALL_TX | FRONT_DIRTY_SURFACE | FRONT_DIRTY_FOG;
    }
  }

  // ── Standard floor/water/door mutations (fog, tissue, textures, features) ──
  // Set fog
  if (world.fog[ci] < 200) {
    world.fog[ci] = Math.min(255, 200 + ((Math.random() * 55) | 0));
    flags |= FRONT_DIRTY_FOG;
  }

  // Set tissue overlay
  const tissueBase = Math.max(150, Math.round(180 * (1 + variant.visual.fogDensityBonus * 10)));
  if (world.tissue[ci] < tissueBase) {
    world.tissue[ci] = Math.min(255, tissueBase + ((Math.random() * (255 - tissueBase)) | 0));
    flags |= FRONT_DIRTY_FOG;
  }

  // Floor texture mutation (~55%)
  if (cell === Cell.FLOOR && Math.random() < 0.55) {
    world.floorTex[ci] = RANDOM_FLOOR_TEX[(Math.random() * RANDOM_FLOOR_TEX.length) | 0];
    flags |= FRONT_DIRTY_FLOOR_TX | FRONT_DIRTY_SURFACE;
  }

  // Wall texture on adjacent walls (~35%)
  if (Math.random() < 0.35) {
    const x = ci % W;
    const y = (ci / W) | 0;
    for (let d = 0; d < 4; d++) {
      const ni = world.idx(world.wrap(x + FOG_DIRS_X[d]), world.wrap(y + FOG_DIRS_Y[d]));
      if (world.cells[ni] === Cell.WALL && !world.aptMask[ni] && !world.hermoWall[ni]) {
        world.wallTex[ni] = RANDOM_WALL_TEX[(Math.random() * RANDOM_WALL_TEX.length) | 0];
        flags |= FRONT_DIRTY_WALL_TX | FRONT_DIRTY_SURFACE;
        break;
      }
    }
  }

  // Feature mutation (~22%)
  if (Math.random() < 0.22 && cell === Cell.FLOOR) {
    world.features[ci] = RANDOM_FEATURES[(Math.random() * RANDOM_FEATURES.length) | 0];
    flags |= FRONT_DIRTY_SURFACE;
  }

  if (flags) frontTouchedCells.add(ci);
  return flags;
}

function createFrontAtCell(world: World, ci: number, shelterSet: ReadonlySet<number>): SamosborFront | null {
  if (!canFrontMutateCell(world, ci, shelterSet)) return null;
  const cell = world.cells[ci];
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return null;
  const type = pickFrontType();
  return {
    type,
    originIdx: ci,
    frontier: [ci],
    head: 0,
    budget: frontBudget(type),
    speed: 0.8 + Math.random() * 0.5,
    age: 0,
    maxAge: frontMaxAge(type),
    processed: 0,
    changed: 0,
    monstersSpawned: 0,
    dead: false,
    visited: new Set([ci]),
  };
}

function spawnSamosborFronts(
  world: World,
  _entities: Entity[],
  _variant: ActiveSamosborVariant,
  shelterRoomIds: readonly number[],
): SamosborFront[] {
  const count = FRONT_MIN_COUNT + ((Math.random() * (FRONT_MAX_COUNT - FRONT_MIN_COUNT + 1)) | 0);
  const fronts: SamosborFront[] = [];
  const usedZones = new Set<number>();
  const shelterSet = new Set(shelterRoomIds);

  for (let attempt = 0; attempt < 2000 && fronts.length < count; attempt++) {
    const ci = (Math.random() * W * W) | 0;
    if (!canFrontMutateCell(world, ci, shelterSet)) continue;
    const cell = world.cells[ci];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    // Avoid clustering: different zones preferred
    const zid = world.zoneMap[ci];
    if (zid >= 0 && usedZones.has(zid) && Math.random() > 0.3) continue;
    if (zid >= 0) usedZones.add(zid);
    const front = createFrontAtCell(world, ci, shelterSet);
    if (front) fronts.push(front);
  }
  return fronts;
}

function tickSamosborFront(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  front: SamosborFront,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  samosborCount: number,
  shelterSet: ReadonlySet<number>,
): { processed: number; changed: number; batchFlags: number } {
  if (front.dead) return { processed: 0, changed: 0, batchFlags: FRONT_DIRTY_NONE };
  front.age++;
  // Waves should not die by age, only when they run out of cells to process.
  if (front.frontier.length === 0) {
    front.dead = true;
    return { processed: 0, changed: 0, batchFlags: FRONT_DIRTY_NONE };
  }

  const budgetThisTick = Math.max(1, Math.round(front.budget * front.speed));
  let processed = 0;
  let changed = 0;
  let batchFlags = FRONT_DIRTY_NONE;

  for (let i = 0; i < budgetThisTick && front.frontier.length > 0; i++) {
    let pickIdx: number;
    if (front.type === 'wave' || front.type === 'flash') {
      pickIdx = (Math.random() * front.frontier.length) | 0;
    } else {
      const lookback = Math.min(front.frontier.length, front.type === 'crack' ? 12 : 36);
      pickIdx = front.frontier.length - 1 - ((Math.random() * lookback) | 0);
    }
    const ci = front.frontier[pickIdx];
    const last = front.frontier.pop()!;
    if (pickIdx < front.frontier.length) {
      front.frontier[pickIdx] = last;
    }
    processed++;
    front.processed++;

    if (canFrontMutateCell(world, ci, shelterSet)) {
      const flags = mutateFrontCell(world, ci, variant);
      if (flags) {
        changed++;
        batchFlags |= flags;
        frontTickDirtyCells.push(ci);
      }
      front.changed++;

      // Spawn monster every N processed cells
      if (front.processed % FRONT_MONSTER_CELL_INTERVAL === 0) {
        if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci] && canSpawnEntityType(entities, EntityType.MONSTER)) {
          const kind = pickMonsterKindForWave(floor, samosborCount);
          entities.push(createMonster(world, nextId, kind, (ci % W) + 0.5, ((ci / W) | 0) + 0.5, floor));
          front.monstersSpawned++;
        }
      }
    }

    // Expand frontier — use persistent visited set
    frontExpandNeighbors(world, ci, front.type, front.frontier, front.visited, shelterSet);
  }

  return { processed, changed, batchFlags };
}


/** Shared per-tick dirty cell collector — reused across fronts to avoid allocs */

export function getSamosborFrontTickAccumForTests(): number {
  return samosborFrontTickAccum;
}

export function setSamosborFrontTickAccumForTests(val: number): void {
  samosborFrontTickAccum = val;
}

export function setActiveSamosborFrontsForTests(fronts: any[]): void {
  activeSamosborFronts = fronts as any;
}

const frontTickDirtyCells: number[] = [];

function tickAllSamosborFronts(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  samosborCount: number,
  shelterSet: ReadonlySet<number>,
): void {
  let allFlags = FRONT_DIRTY_NONE;
  frontTickDirtyCells.length = 0;
  for (const front of activeSamosborFronts) {
    const result = tickSamosborFront(world, entities, nextId, front, variant, floor, samosborCount, shelterSet);
    allFlags |= result.batchFlags;
  }
  // Prune dead fronts
  activeSamosborFronts = activeSamosborFronts.filter(f => !f.dead);

  if (!allFlags) return;

  // ── Batch dirty marks with per-cell rects for incremental GPU uploads ──
  const rects: WorldGridDirtyRect[] = [];
  for (let i = 0; i < frontTickDirtyCells.length; i++) {
    const ci = frontTickDirtyCells[i];
    rects.push({ x: ci % W, y: (ci / W) | 0, w: 1, h: 1 });
  }
  if (allFlags & FRONT_DIRTY_CELLS)    world.markCellsDirty(rects);
  if (allFlags & FRONT_DIRTY_FLOOR_TX) world.markFloorTexDirty(rects);
  if (allFlags & FRONT_DIRTY_WALL_TX)  world.markWallTexDirty(rects);
  if (allFlags & FRONT_DIRTY_SURFACE)  world.markSurfaceCellsDirty(frontTickDirtyCells);
  if (allFlags & FRONT_DIRTY_FOG)      { world.markFogDirty(rects); world.markTissueDirty(rects); }
}

function clearSamosborFronts(): void {
  activeSamosborFronts = [];
  samosborFrontTickAccum = 0;
  // Note: frontTouchedCells is NOT cleared here — it's consumed by the stitch phase after samosbor ends
}

export function getSamosborFrontDebugLines(): string[] {
  if (activeSamosborFronts.length === 0) return [];
  const lines: string[] = [];
  for (const front of activeSamosborFronts) {
    const status = front.dead ? '✗' : '●';
    const qLen = front.frontier.length;
    lines.push(`  ${status} ${front.type} age=${front.age} proc=${front.processed} chg=${front.changed} mon=${front.monstersSpawned} q=${qLen}`);
  }
  return lines;
}

export interface SamosborRoomSirenSource {
  roomId: number;
  x: number;
  y: number;
  seed: number;
}

interface PendingAftermath {
  state: GameState;
  variant: ActiveSamosborVariant;
  floor: FloorLevel;
  zoneId: number;
  x: number;
  y: number;
  samosborCount: number;
  endedAt: number;
  istotitDecision?: string;
}

interface AftermathRuntime {
  lastAt: number;
  runs: number;
}

const aftermathRuntime = new Map<string, AftermathRuntime>();
let pendingAftermath: PendingAftermath | null = null;
let lastAftermathAt = -Infinity;
let lastAftermathBeatIds: string[] = [];
let lastAftermathFloor = FloorLevel.LIVING;
let lastVeretarAreaLeaks = 0;
let lastVeretarAreaLeakAt = -Infinity;
let lastSamosborFogEffectNoticeAt = -Infinity;
let istotitBellFollowNoticeAt = -Infinity;
let istotitBellResistNoticeAt = -Infinity;
let samosborRoomSirenWorld: World | null = null;
let samosborRoomSirenFloor = FloorLevel.LIVING;
let samosborRoomSirenCycle = -1;
let samosborRoomSirenAccum = 0;
let samosborRoomSirenSources: SamosborRoomSirenSource[] = [];

export interface SamosborWarningSnapshot {
  floor: FloorLevel;
  floorName: string;
  zoneId: number;
  zoneX: number;
  zoneY: number;
  variantId: string;
  variantName: string;
  tint: string;
  warningLine: string;
  actionLine: string;
  shelterHintLine: string;
  gameplaySignal: string;
  secondsLeft: number;
  screenCount: number;
  greenSourceCount: number;
  wrongDoorX?: number;
  wrongDoorY?: number;
  shelterRoomIds: readonly number[];
  signals: SamosborWarningSignals;
}

export interface SamosborWarningSignals {
  audioLine: string;
  screenLine: string;
  hazardLine: string;
  npcLine: string;
  visualLine: string;
  logLine: string;
  signalCode: string;
  channels: readonly string[];
  channelLines: readonly string[];
}

export interface SamosborCompulsion {
  x: number;
  y: number;
  strength: number;
  distance: number;
}

export interface SamosborActiveInstructionSnapshot {
  zoneId: number;
  variantId: string;
  variantName: string;
  tint: string;
  actionLine: string;
  shelterHintLine: string;
  secondsLeft: number;
  shelterRoomIds: readonly number[];
}

interface SamosborWarningRuntime {
  cycle: number;
  floor: FloorLevel;
  zoneId: number;
  zoneX: number;
  zoneY: number;
  startedAt: number;
  variant: ActiveSamosborVariant;
  warningLine: string;
  actionLine: string;
  shelterHintLine: string;
  screenCount: number;
  greenSourceCount: number;
  wrongDoorIdx: number;
  signals: SamosborWarningSignals;
}

let samosborWarning: SamosborWarningRuntime | null = null;

function clearMaronaryGlowRuntime(): void {
  maronaryGlowAccum = 0;
  maronaryGlowNoticeAt = -Infinity;
  maronaryGlowCells = [];
}

function clearIstotitShelters(): void {
  istotitShelterRoomIds = [];
  istotitShelterCycle = -1;
  istotitSupplyContainerIds = [];
}

function clearSamosborWarning(clearVariant: boolean, resetDrone = true): void {
  samosborWarning = null;
  if (resetDrone) setAmbientDroneMode('normal');
  if (clearVariant) {
    clearActiveSamosborVariant();
    clearIstotitShelters();
    clearMaronaryGlowRuntime();
  }
}

function clearSamosborRoomSirens(): void {
  samosborRoomSirenWorld = null;
  samosborRoomSirenCycle = -1;
  samosborRoomSirenAccum = 0;
  samosborRoomSirenSources = [];
}

function roomCenter(world: World, room: Room): { x: number; y: number } {
  return {
    x: world.wrap(room.x + room.w * 0.5),
    y: world.wrap(room.y + room.h * 0.5),
  };
}

function buildSamosborRoomSirenSources(world: World): SamosborRoomSirenSource[] {
  const sources: SamosborRoomSirenSource[] = [];
  for (const room of world.rooms) {
    if (!room || room.type !== RoomType.LIVING || room.w <= 1 || room.h <= 1) continue;
    const center = roomCenter(world, room);
    sources.push({
      roomId: room.id,
      x: center.x,
      y: center.y,
      seed: Math.imul(room.id + 17, 131) ^ Math.imul(room.x + 31, 17) ^ room.y,
    });
  }
  return sources;
}

export function getSamosborRoomSirenSourcesForTests(world: World): readonly SamosborRoomSirenSource[] {
  return buildSamosborRoomSirenSources(world);
}

function ensureSamosborRoomSirens(world: World, state: GameState): void {
  if (
    samosborRoomSirenWorld === world &&
    samosborRoomSirenFloor === state.currentFloor &&
    samosborRoomSirenCycle === state.samosborCount
  ) {
    return;
  }
  samosborRoomSirenWorld = world;
  samosborRoomSirenFloor = state.currentFloor;
  samosborRoomSirenCycle = state.samosborCount;
  samosborRoomSirenAccum = SAMOSBOR_ROOM_SIREN_INTERVAL;
  samosborRoomSirenSources = buildSamosborRoomSirenSources(world);
}

function selectNearestSamosborRoomSirens(
  world: World,
  player: Entity,
): SamosborRoomSirenSource[] {
  const selected: Array<{ source: SamosborRoomSirenSource; dist2: number }> = [];
  let worst = -1;
  let worstDist2 = -1;
  for (const source of samosborRoomSirenSources) {
    const dist2 = world.dist2(player.x, player.y, source.x, source.y);
    if (selected.length < SAMOSBOR_ROOM_SIREN_SOURCE_CAP) {
      selected.push({ source, dist2 });
      if (dist2 > worstDist2) {
        worstDist2 = dist2;
        worst = selected.length - 1;
      }
      continue;
    }
    if (dist2 >= worstDist2 || worst < 0) continue;
    selected[worst] = { source, dist2 };
    worst = 0;
    worstDist2 = selected[0].dist2;
    for (let i = 1; i < selected.length; i++) {
      if (selected[i].dist2 > worstDist2) {
        worstDist2 = selected[i].dist2;
        worst = i;
      }
    }
  }
  selected.sort((a, b) => a.dist2 - b.dist2);
  return selected.map(item => item.source);
}

function tickSamosborRoomSirens(world: World, entities: Entity[], state: GameState, dt: number): void {
  if (!state.samosborActive) return;
  const player = findPlayer(entities);
  if (!player) return;
  ensureSamosborRoomSirens(world, state);
  if (samosborRoomSirenSources.length === 0) return;
  samosborRoomSirenAccum += dt;
  if (samosborRoomSirenAccum < SAMOSBOR_ROOM_SIREN_INTERVAL) return;
  samosborRoomSirenAccum = 0;

  const sources = selectNearestSamosborRoomSirens(world, player);
  for (const source of sources) {
    playSoundAt(() => playSamosborRoomSiren(source.seed + state.samosborCount * 97), source.x, source.y);
    publishNoise(state, {
      x: source.x,
      y: source.y,
      floor: state.currentFloor,
      radius: SAMOSBOR_ROOM_SIREN_RADIUS,
      ttl: SAMOSBOR_ROOM_SIREN_INTERVAL * 1.45,
      source: 'siren',
      severity: 4,
      tags: ['samosbor', 'siren', 'living_room', 'room_siren'],
    });
  }
}

export function resetSamosborRuntimeForTests(): void {
  samosborSealed = false;
  activeSamosborZoneId = -1;
  activeSamosborPreviousZoneFaction = null;
  activeSamosborPreviousTerritory = [];
  activeSamosborPreviousZoneFogged = false;
  knownSamosborTime = 0;
  samosborDirectorAccum = 0;
  maronaryPingAccum = 0;
  randomEntityTransferAccum = 0;
  playerPressureSpawnAccum = 0;
  clearMaronaryGlowRuntime();
  samosborPlayerShelterRoomId = -1;
  pendingAftermath = null;
  lastAftermathAt = -Infinity;
  lastAftermathBeatIds = [];
  lastAftermathFloor = FloorLevel.LIVING;
  lastVeretarAreaLeaks = 0;
  lastVeretarAreaLeakAt = -Infinity;
  lastSamosborFogEffectNoticeAt = -Infinity;
  istotitBellFollowNoticeAt = -Infinity;
  istotitBellResistNoticeAt = -Infinity;
  fogSpawnAccum = 0;
  activeSamosborScale = 'full';
  clearSamosborRoomSirens();
  clearSamosborFronts();
  frontTouchedCells.clear();
  cancelSamosborWave();
  unfreezeNavigationCacheForWorld();
  aftermathRuntime.clear();
  clearSamosborWarning(true);
  istotitDecisionCycle = -1;
  istotitDecision = '';
  for (const shelter of getSamosborLocalShelters()) shelter.clear?.();
}

function hasSamosborSubsystem(variant: ActiveSamosborVariant, subsystem: SamosborSubsystemId): boolean {
  return samosborVariantHasSubsystem(variant, subsystem);
}

function isIstotit(variant: ActiveSamosborVariant): boolean {
  return variant.def.id === 'istotit';
}

function nearestSamosborShelterCenter(world: World, player: Entity, roomIds: readonly number[]): { x: number; y: number; dist2: number } | null {
  let best: { x: number; y: number; dist2: number } | null = null;
  for (const roomId of roomIds) {
    const room = world.rooms[roomId];
    if (!room) continue;
    const x = world.wrap(room.x + Math.floor(room.w / 2)) + 0.5;
    const y = world.wrap(room.y + Math.floor(room.h / 2)) + 0.5;
    const dist2 = world.dist2(player.x, player.y, x, y);
    if (!best || dist2 < best.dist2) best = { x, y, dist2 };
  }
  return best;
}

export function updateIstotitBellCompulsion(
  world: World,
  state: GameState,
  player: Entity,
  resisting: boolean,
): SamosborCompulsion | null {
  const variant = getActiveSamosborVariant();
  if (!state.samosborActive || !variant || !hasSamosborSubsystem(variant, 'bell_compulsion')) return null;
  const room = world.roomAt(player.x, player.y);
  const shelterRoomIds = getSamosborShelterRoomIds(state);
  if (room && shelterRoomIds.includes(room.id)) return null;

  const shelter = nearestSamosborShelterCenter(world, player, shelterRoomIds);
  const zone = activeSamosborZoneId >= 0 ? world.zones[activeSamosborZoneId] : undefined;
  const tx = shelter?.x ?? (zone ? zone.cx + 0.5 : W / 2 + 0.5);
  const ty = shelter?.y ?? (zone ? zone.cy + 0.5 : W / 2 + 0.5);
  const dx = world.delta(player.x, tx);
  const dy = world.delta(player.y, ty);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1.25) return null;

  if (resisting) {
    if (state.time >= istotitBellResistNoticeAt + 3.5) {
      istotitBellResistNoticeAt = state.time;
      state.msgs.push(msg('Вы держите шаг против колокола. Отпустите - ноги снова пойдут к жёлтому контуру.', state.time, '#d6a64b'));
    }
    return null;
  }

  const steering = steerEntityTowardCell(world, player, Math.floor(tx), Math.floor(ty));
  if (!steering) return null;

  if (state.time >= istotitBellFollowNoticeAt + 5) {
    istotitBellFollowNoticeAt = state.time;
    state.msgs.push(msg(`Колокол ставит шаг за вас. Удерживайте ${controlHint('interact')}, чтобы сопротивляться.`, state.time, '#d6a64b'));
  }
  return { x: steering.x, y: steering.y, strength: 0.52, distance: dist };
}

function isMaronary(variant: ActiveSamosborVariant): boolean {
  return variant.def.id === 'maronary';
}

function isVeretar(variant: ActiveSamosborVariant): boolean {
  return variant.def.id === 'veretar';
}

function hasPreparedHermeticSeal(world: World, room: Room): boolean {
  if (room.doors.length === 0 || room.doors.length > PLAYER_SHELTER_DOOR_CAP) return false;
  let hermeticDoors = 0;
  for (const di of room.doors) {
    const door = world.doors.get(di);
    if (!door || door.state !== DoorState.HERMETIC_CLOSED) return false;
    hermeticDoors++;
  }
  return hermeticDoors > 0;
}

function trySealPreparedPlayerRoom(world: World, state: GameState, room: Room | null): Room | null {
  if (!room || room.sealed || !hasPreparedHermeticSeal(world, room)) return room;
  let blocked = false;
  for (const di of room.doors) {
    if (blocksHermodoorBorerSeal(world, state, di, room.id)) blocked = true;
  }
  if (blocked) {
    room.sealed = false;
    return room;
  }
  room.sealed = true;
  return room;
}

function findNearbyDoorIdx(world: World, cx: number, cy: number, radius: number): number {
  const r2 = radius * radius;
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.DOOR || !world.doors.has(ci)) continue;
      const d2 = world.dist2(cx + 0.5, cy + 0.5, x + 0.5, y + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = ci;
      }
    }
  }
  return bestIdx;
}

function applyUnshelteredPressure(player: Entity, state: GameState, detail: string): { hpDamage: number; psiDamage: number } {
  let hpDamage = 0;
  let psiDamage = 0;
  if (player.hp !== undefined) {
    const before = player.hp;
    player.hp = Math.max(1, player.hp - UNSHELTERED_HP_DAMAGE);
    hpDamage = before - player.hp;
    if (hpDamage > 0) {
      state.dmgFlash = Math.max(state.dmgFlash, 0.3);
      state.dmgSeed = (state.dmgSeed + 23) | 0;
      recordPlayerDamage(state, undefined, hpDamage, `${detail}: -${hpDamage}`, 'samosbor');
    }
  }
  if (player.rpg) {
    const beforePsi = player.rpg.psi;
    player.rpg.psi = Math.max(0, player.rpg.psi - UNSHELTERED_PSI_DAMAGE);
    psiDamage = beforePsi - player.rpg.psi;
  }
  return { hpDamage, psiDamage };
}

function resolvePlayerShelterAtSeal(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
): void {
  const player = findPlayer(entities);
  if (!player) return;

  const px = world.wrap(Math.floor(player.x));
  const py = world.wrap(Math.floor(player.y));
  const ci = world.idx(px, py);
  const room = trySealPreparedPlayerRoom(world, state, world.roomAt(player.x, player.y));
  const zoneId = world.zoneMap[ci];
  const nearestDoorIdx = room && room.doors.length > 0
    ? room.doors[0]
    : findNearbyDoorIdx(world, px, py, 5);

  if (room?.sealed) {
    samosborPlayerShelterRoomId = room.id;
    state.msgs.push(msg(`Укрытие принято: ${room.name}. Гермодверь держит.`, state.time, variant.def.tint));
    publishEvent(state, {
      type: 'door_sealed',
      zoneId,
      roomId: room.id,
      x: nearestDoorIdx >= 0 ? nearestDoorIdx % W : px,
      y: nearestDoorIdx >= 0 ? (nearestDoorIdx / W) | 0 : py,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      targetName: 'Гермодверь',
      severity: 3,
      privacy: 'local',
      tags: ['samosbor', 'shelter', 'success', 'prepared', `samosbor_${variant.def.id}`],
      data: {
        outcome: 'prepared_shelter',
        roomName: room.name,
        roomId: room.id,
        doorCount: Math.min(room.doors.length, PLAYER_SHELTER_DOOR_CAP),
        samosborCount: state.samosborCount,
        variantId: variant.def.id,
        prepared: hasPreparedHermeticSeal(world, room),
      },
    });
    return;
  }

  const pressure = applyUnshelteredPressure(player, state, `${variant.def.displayName}: вне рабочей гермы`);
  state.msgs.push(msg('Вы остались снаружи рабочей гермы. Давление самосбора ударило напрямую.', state.time, '#f66'));
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId,
    roomId: room?.id,
    x: px,
    y: py,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity: 4,
    privacy: 'local',
    tags: ['samosbor', 'shelter', 'failure', 'unprepared', `samosbor_${variant.def.id}`],
    data: {
      outcome: 'unprepared_shelter',
      warning: 'Укрытие сорвано: игрок остался вне рабочей гермы.',
      roomName: room?.name,
      roomId: room?.id,
      nearestDoorIdx: nearestDoorIdx >= 0 ? nearestDoorIdx : undefined,
      nearestDoorState: nearestDoorIdx >= 0 ? world.doors.get(nearestDoorIdx)?.state : undefined,
      hpDamage: pressure.hpDamage,
      psiDamage: pressure.psiDamage,
      samosborCount: state.samosborCount,
      variantId: variant.def.id,
    },
  });
}

export function resolvePlayerShelterAtSealForTests(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
): void {
  resolvePlayerShelterAtSeal(world, entities, state, variant);
}

function samosborEventTags(
  variant: ActiveSamosborVariant,
  base: string[],
  wrongDoor = false,
): string[] {
  const tags = [...base, `samosbor_${variant.def.id}`];
  if (variant.noSiren) tags.push('no_siren');
  if (isMaronary(variant)) {
    tags.push('green_source');
    if (wrongDoor) tags.push('wrong_door');
  }
  if (isVeretar(variant)) tags.push('white_area', 'area_leak');
  return tags;
}

function istotitSheltersMatch(state?: GameState): boolean {
  if (istotitShelterRoomIds.length === 0) return false;
  if (!state) return true;
  if (state.currentFloor !== istotitShelterFloor) return false;
  if (state.samosborActive) return state.samosborCount === istotitShelterCycle;
  return state.samosborCount === istotitShelterCycle || state.samosborCount + 1 === istotitShelterCycle;
}

function activeIstotitDecision(state: GameState): string | undefined {
  return istotitDecisionCycle === state.samosborCount ? istotitDecision || undefined : undefined;
}

function mergeRoomIds(ids: readonly number[], more: readonly number[]): number[] {
  const out = [...ids];
  for (const id of more) if (!out.includes(id)) out.push(id);
  return out;
}

function prepareLocalSamosborShelters(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
  zoneId: number,
  zoneX: number,
  zoneY: number,
): readonly number[] {
  let roomIds: readonly number[] = [];
  for (const shelter of getSamosborLocalShelters()) {
    const prepared = shelter.prepare?.({ world, entities, state, variant, zoneId, zoneX, zoneY }) ?? [];
    if (prepared.length > 0) roomIds = mergeRoomIds(roomIds, prepared);
  }
  return roomIds;
}

function getLocalSamosborShelterRoomIds(state?: GameState): readonly number[] {
  let roomIds: readonly number[] = [];
  for (const shelter of getSamosborLocalShelters()) {
    const ids = shelter.getRoomIds?.(state) ?? [];
    if (ids.length > 0) roomIds = mergeRoomIds(roomIds, ids);
  }
  return roomIds;
}

function notifyLocalSamosborShelterEnd(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  variant: ActiveSamosborVariant | null,
): void {
  for (const shelter of getSamosborLocalShelters()) {
    shelter.onEnd?.({ world, entities, state, nextId, variant });
  }
}

function clearLocalSamosborShelters(state?: GameState): void {
  for (const shelter of getSamosborLocalShelters()) shelter.clear?.(state);
}

function getLocalSamosborShelterDebugLines(): string[] {
  const lines: string[] = [];
  for (const shelter of getSamosborLocalShelters()) {
    const line = shelter.debugLine?.();
    if (line) lines.push(line);
  }
  return lines;
}

export function getSamosborShelterRoomIds(state?: GameState): readonly number[] {
  const istotitRooms = istotitSheltersMatch(state) ? istotitShelterRoomIds : [];
  const localRooms = getLocalSamosborShelterRoomIds(state);
  if (localRooms.length === 0) return istotitRooms;
  if (istotitRooms.length === 0) return localRooms;
  return mergeRoomIds(istotitRooms, localRooms);
}

export function getSamosborWarningSnapshot(state?: GameState): SamosborWarningSnapshot | null {
  if (!samosborWarning) return null;
  if (state) {
    if (state.samosborActive) return null;
    if (state.currentFloor !== samosborWarning.floor) return null;
    if (state.samosborCount !== samosborWarning.cycle) return null;
    if (state.samosborTimer > SAMOSBOR_WARNING_WINDOW + 0.5) return null;
  }
  const secondsLeft = state
    ? Math.max(0, Math.ceil(state.samosborTimer))
    : Math.max(0, Math.ceil(SAMOSBOR_WARNING_WINDOW - (knownSamosborTime - samosborWarning.startedAt)));
  return {
    floor: samosborWarning.floor,
    floorName: floorLevelDisplayName(samosborWarning.floor),
    zoneId: samosborWarning.zoneId,
    zoneX: samosborWarning.zoneX,
    zoneY: samosborWarning.zoneY,
    variantId: samosborWarning.variant.def.id,
    variantName: samosborWarning.variant.def.displayName,
    tint: samosborWarning.variant.def.tint,
    warningLine: samosborWarning.warningLine,
    actionLine: samosborWarning.actionLine,
    shelterHintLine: samosborWarning.shelterHintLine,
    gameplaySignal: samosborWarning.variant.def.gameplaySignal,
    secondsLeft,
    screenCount: samosborWarning.screenCount,
    greenSourceCount: samosborWarning.greenSourceCount,
    wrongDoorX: samosborWarning.wrongDoorIdx >= 0 ? samosborWarning.wrongDoorIdx % W : undefined,
    wrongDoorY: samosborWarning.wrongDoorIdx >= 0 ? (samosborWarning.wrongDoorIdx / W) | 0 : undefined,
    shelterRoomIds: getSamosborShelterRoomIds(state),
    signals: samosborWarning.signals,
  };
}

export function getSamosborActiveInstructionSnapshot(state?: GameState): SamosborActiveInstructionSnapshot | null {
  const variant = getActiveSamosborVariant();
  if (!variant || (state && !state.samosborActive)) return null;
  const shelterRoomIds = getSamosborShelterRoomIds(state);
  return {
    zoneId: activeSamosborZoneId,
    variantId: variant.def.id,
    variantName: variant.def.displayName,
    tint: variant.def.tint,
    actionLine: samosborActiveActionLine(variant, shelterRoomIds.length, samosborSealed),
    shelterHintLine: samosborShelterHintLine(variant, shelterRoomIds.length),
    secondsLeft: state ? Math.max(0, Math.ceil(state.samosborTimer)) : 0,
    shelterRoomIds,
  };
}

function chooseIstotitShelterRooms(world: World, cx: number, cy: number, count: number): number[] {
  const radius2 = ISTOTIT_SHELTER_SEARCH_RADIUS * ISTOTIT_SHELTER_SEARCH_RADIUS;
  const candidates: { id: number; d2: number }[] = [];
  for (const room of world.rooms) {
    if (!room || room.w < 3 || room.h < 3 || room.doors.length === 0) continue;
    let hasUsableDoor = false;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      if (door && door.state !== DoorState.LOCKED) {
        hasUsableDoor = true;
        break;
      }
    }
    if (!hasUsableDoor) continue;
    const d2 = world.dist2(cx + 0.5, cy + 0.5, room.x + room.w / 2, room.y + room.h / 2);
    if (d2 > radius2) continue;
    candidates.push({ id: room.id, d2 });
  }
  candidates.sort((a, b) => a.d2 - b.d2);
  const pool = candidates.slice(0, ISTOTIT_SHELTER_CANDIDATE_CAP);
  const ids: number[] = [];
  while (ids.length < count && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    ids.push(pool[i].id);
    pool[i] = pool[pool.length - 1];
    pool.pop();
  }
  return ids;
}

function nextContainerId(world: World): number {
  let id = 1;
  for (const container of world.containers) if (container.id >= id) id = container.id + 1;
  return id;
}

function findRoomFloorCell(world: World, roomId: number): { x: number; y: number } | null {
  const room = world.rooms[roomId];
  if (!room) return null;
  const cx = world.wrap(room.x + Math.floor(room.w / 2));
  const cy = world.wrap(room.y + Math.floor(room.h / 2));
  const centerIdx = world.idx(cx, cy);
  if (world.cells[centerIdx] === Cell.FLOOR && world.roomMap[centerIdx] === roomId && world.containersAt(cx, cy).length === 0) {
    return { x: cx, y: cy };
  }
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const wx = world.wrap(x);
      const wy = world.wrap(y);
      const ci = world.idx(wx, wy);
      if (world.cells[ci] !== Cell.FLOOR || world.roomMap[ci] !== roomId) continue;
      if (world.containersAt(wx, wy).length > 0) continue;
      return { x: wx, y: wy };
    }
  }
  return null;
}

function addIstotitSupplyContainer(world: World, state: GameState, roomId: number): number {
  if (world.containers.some(c => c.roomId === roomId && c.floor === state.currentFloor && c.tags.includes(ISTOTIT_SUPPLY_TAG))) {
    return 0;
  }
  const pos = findRoomFloorCell(world, roomId);
  const room = world.rooms[roomId];
  if (!pos || !room) return 0;
  const inventory = [
    ITEMS.istotit_candle ? { defId: 'istotit_candle', count: 1 } : null,
    ITEMS.water ? { defId: 'water', count: 1 } : null,
    ITEMS.bread ? { defId: 'bread', count: 1 } : null,
  ].filter((item): item is { defId: string; count: number } => item !== null);
  const container: WorldContainer = {
    id: nextContainerId(world),
    x: pos.x,
    y: pos.y,
    floor: state.currentFloor,
    roomId,
    zoneId: world.zoneMap[world.idx(pos.x, pos.y)],
    kind: ContainerKind.EMERGENCY_BOX,
    name: `Церковный свечной запас: ${room.name}`,
    inventory,
    capacitySlots: 5,
    faction: Faction.CITIZEN,
    access: 'faction',
    discovered: true,
    tags: [ISTOTIT_SUPPLY_TAG, 'istotit', 'church', 'shelter'],
  };
  world.addContainer(container);
  istotitSupplyContainerIds.push(container.id);
  stampMark(world, pos.x, pos.y, 0.5, 0.5, 0.36, MarkType.PSI, 86_000 + container.id, 214, 166, 75, 150);
  return 1;
}

function stampIstotitGoldDust(world: World, x: number, y: number, count: number, seedBase: number): number {
  let stamped = 0;
  for (let i = 0; i < count; i++) {
    const px = world.wrap(x + rng(-2, 2));
    const py = world.wrap(y + rng(-2, 2));
    const ci = world.idx(px, py);
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
    stampMark(world, px, py, Math.random(), Math.random(), 0.22 + Math.random() * 0.18, MarkType.PSI, seedBase + i * 977, 214, 166, 75, 125);
    stamped++;
  }
  return stamped;
}

function prepareIstotitShelters(world: World, state: GameState, variant: ActiveSamosborVariant, cx: number, cy: number): readonly number[] {
  if (!hasSamosborSubsystem(variant, 'istotit_shelters') || variant.shelterRoomCount <= 0) {
    clearIstotitShelters();
    return [];
  }
  const count = Math.max(1, Math.min(3, variant.shelterRoomCount + (Math.random() < 0.35 ? 1 : 0)));
  istotitShelterRoomIds = chooseIstotitShelterRooms(world, cx, cy, count);
  istotitShelterCycle = state.samosborCount + 1;
  istotitShelterFloor = state.currentFloor;
  istotitDecisionCycle = -1;
  istotitDecision = '';
  for (const roomId of istotitShelterRoomIds) {
    const room = world.rooms[roomId];
    if (!room) continue;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      if (!door || door.state === DoorState.LOCKED) continue;
      setDoorState(world, door, DoorState.HERMETIC_OPEN);
      door.timer = Math.max(door.timer, 12);
    }
    addIstotitSupplyContainer(world, state, roomId);
    stampIstotitGoldDust(world, world.wrap(room.x + Math.floor(room.w / 2)), world.wrap(room.y + Math.floor(room.h / 2)), 2, 85_000 + roomId * 31);
  }
  return istotitShelterRoomIds;
}

function isIstotitShelterDoor(world: World, doorIdx: number): boolean {
  const door = world.doors.get(doorIdx);
  if (!door) return false;
  return istotitShelterRoomIds.includes(door.roomA) || istotitShelterRoomIds.includes(door.roomB);
}

function rememberIstotitDecision(state: GameState, kind: string): boolean {
  if (istotitDecisionCycle === state.samosborCount && istotitDecision) return false;
  istotitDecisionCycle = state.samosborCount;
  istotitDecision = kind;
  return true;
}

function publishIstotitDecision(
  world: World,
  player: Entity,
  state: GameState,
  kind: string,
  severity: 2 | 3 | 4 | 5,
  extra: Record<string, unknown> = {},
): void {
  const x = Math.floor(player.x);
  const y = Math.floor(player.y);
  const ci = world.idx(x, y);
  const roomId = world.roomMap[ci];
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: world.zoneMap[ci],
    roomId: roomId >= 0 ? roomId : undefined,
    x,
    y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy: severity >= 4 ? 'local' : 'private',
    tags: ['samosbor', 'istotit', 'decision', kind, 'samosbor_istotit'],
    data: {
      decision: kind,
      shelterRoomIds: istotitShelterRoomIds,
      supplyContainerIds: istotitSupplyContainerIds,
      ...extra,
    },
  });
}

function nearestIstotitNpc(world: World, entities: Entity[], player: Entity, roomId: number): Entity | null {
  let best: Entity | null = null;
  let bestD2 = ISTOTIT_DECISION_RADIUS2;
  ensureEntityIndex(entities).queryRadiusCapped(player.x, player.y, ISTOTIT_DECISION_RADIUS, istotitNpcQuery, ENTITY_MASK_NPC, 64);
  for (const e of istotitNpcQuery) {
    if (!e.alive || e.type !== EntityType.NPC || e.faction === Faction.WILD) continue;
    const d2 = world.dist2(player.x, player.y, e.x, e.y);
    if (d2 > bestD2) continue;
    const npcRoomId = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
    if (npcRoomId === roomId && d2 > 1.2) continue;
    best = e;
    bestD2 = d2;
  }
  istotitNpcQuery.length = 0;
  return best;
}

function guideNpcToShelter(world: World, npc: Entity, roomId: number): void {
  if (!npc.ai) return;
  const room = world.rooms[roomId];
  if (!room) return;
  const tx = world.wrap(room.x + Math.floor(room.w / 2));
  const ty = world.wrap(room.y + Math.floor(room.h / 2));
  const status = tryAssignPathToCell(world, npc, tx, ty);
  npc.ai.pi = 0;
  npc.ai.tx = tx;
  npc.ai.ty = ty;
  npc.ai.goal = status !== 'not_found' ? AIGoal.FLEE : AIGoal.IDLE;
  npc.ai.timer = 6;
}

function istotitAdmitNpc(world: World, entities: Entity[], player: Entity, state: GameState, roomId: number): boolean {
  if (!rememberIstotitDecision(state, 'admit_npc')) return false;
  const npc = nearestIstotitNpc(world, entities, player, roomId);
  if (!npc) {
    istotitDecisionCycle = -1;
    istotitDecision = '';
    return false;
  }
  guideNpcToShelter(world, npc, roomId);
  if (player.needs) {
    player.needs.water = Math.max(0, player.needs.water - 6);
    player.needs.sleep = Math.max(0, player.needs.sleep - 5);
  }
  if (player.rpg) player.rpg.psi = Math.max(0, player.rpg.psi - 4);
  addFactionRelMutual(Faction.CITIZEN, Faction.PLAYER, 1);
  state.msgs.push(msg(`${npc.name ?? 'Сосед'} вписан в ведомость у жёлтой гермы. Воды и воздуха стало меньше.`, state.time, '#d6a64b'));
  publishIstotitDecision(world, player, state, 'admit_npc', 3, { targetId: npc.id, targetName: npc.name, roomId });
  return true;
}

function istotitShelterAlone(world: World, player: Entity, state: GameState, roomId: number): boolean {
  if (!rememberIstotitDecision(state, 'shelter_alone')) return false;
  const room = world.rooms[roomId];
  if (!room) return false;
  room.sealed = true;
  for (const di of room.doors) {
    const door = world.doors.get(di);
    if (!door || door.state === DoorState.LOCKED) continue;
    setDoorState(world, door, DoorState.HERMETIC_CLOSED);
    door.timer = 0;
  }
  addFactionRelMutual(Faction.CITIZEN, Faction.PLAYER, -1);
  state.msgs.push(msg('Вы закрыли жёлтую герму изнутри. Ведомость оставит пустую строку за тем, кто стучал снаружи.', state.time, '#d6a64b'));
  publishIstotitDecision(world, player, state, 'shelter_alone', 3, { roomId });
  return true;
}

function istotitFollowBell(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextId: { v: number },
  lookX: number,
  lookY: number,
): boolean {
  if (!rememberIstotitDecision(state, 'follow_bell')) return false;
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const dust = stampIstotitGoldDust(world, x, y, 5, 84_000 + state.samosborCount * 101);
  if (player.hp !== undefined) {
    const before = player.hp;
    player.hp = Math.max(1, player.hp - 6);
    const hpDamage = before - player.hp;
    state.dmgFlash = Math.max(state.dmgFlash, 0.22);
    state.dmgSeed = (state.dmgSeed + 17) | 0;
    if (hpDamage > 0) recordPlayerDamage(state, undefined, hpDamage, `Истотит: пошли на колокол -${hpDamage}`, 'samosbor');
  }
  if (player.rpg) player.rpg.psi = Math.max(0, player.rpg.psi - 8);
  const pos = Math.random() < 0.45 ? findWalkableNear(world, x, y, 4, 9) : null;
  let spawned = 0;
  if (pos && canSpawnEntityType(entities, EntityType.MONSTER)) {
    entities.push(createMonster(world, nextId, MonsterKind.EYE, pos.x + 0.5, pos.y + 0.5, state.currentFloor, true));
    spawned = 1;
  }
  state.msgs.push(msg(
    spawned > 0
      ? 'Вы пошли на колокол. У жёлтой метки открылся глаз; до укрытия теперь придётся пробиваться.'
      : 'Вы пошли на колокол. На полу осталась жёлтая пыль, а путь к герме стал длиннее.',
    state.time,
    '#d6a64b',
  ));
  publishIstotitDecision(world, player, state, 'follow_bell', spawned > 0 ? 5 : 4, { dust, spawned });
  return true;
}

function istotitDisruptRite(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextId: { v: number },
  doorIdx: number,
): boolean {
  if (!rememberIstotitDecision(state, 'disrupt_rite')) return false;
  const door = world.doors.get(doorIdx);
  if (!door) return false;
  setDoorState(world, door, DoorState.HERMETIC_OPEN);
  door.timer = Math.max(door.timer, 4);
  const x = doorIdx % W;
  const y = (doorIdx / W) | 0;
  const pos = findWalkableNear(world, x, y, 3, 7);
  let spawned = 0;
  if (pos && canSpawnEntityType(entities, EntityType.MONSTER)) {
    entities.push(createMonster(world, nextId, MonsterKind.SBORKA, pos.x + 0.5, pos.y + 0.5, state.currentFloor, true));
    spawned = 1;
  }
  addFactionRelMutual(Faction.CITIZEN, Faction.PLAYER, -2);
  state.msgs.push(msg('Вы сорвали церковный порядок. Жёлтая герма открылась; внутри стало небезопасно.', state.time, '#f84'));
  publishIstotitDecision(world, player, state, 'disrupt_rite', 5, { doorIdx, spawned });
  return true;
}

export function tryUseSamosborVariantInteraction(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  nextId: { v: number },
  lookX: number,
  lookY: number,
): boolean {
  const active = getActiveSamosborVariant();
  if (!state.samosborActive || !active) return false;
  for (const shelter of getSamosborLocalShelters()) {
    if (shelter.tryInteract?.({ world, entities, player, state, nextId, variant: active, lookX, lookY })) return true;
  }
  if (!hasSamosborSubsystem(active, 'istotit_shelters') || !istotitSheltersMatch(state)) return false;
  const lx = world.wrap(Math.floor(lookX));
  const ly = world.wrap(Math.floor(lookY));
  const lookIdx = world.idx(lx, ly);
  if (world.containersAt(lx, ly).some(c => c.discovered || c.access !== 'secret')) return false;

  const playerRoomId = world.roomMap[world.idx(Math.floor(player.x), Math.floor(player.y))];
  const inShelter = istotitShelterRoomIds.includes(playerRoomId);
  if (!inShelter && world.cells[lookIdx] === Cell.DOOR && isIstotitShelterDoor(world, lookIdx)) {
    return istotitDisruptRite(world, entities, player, state, nextId, lookIdx);
  }
  if (world.cells[lookIdx] === Cell.DOOR || world.cells[lookIdx] === Cell.LIFT) return false;
  if (activeIstotitDecision(state)) return false;

  if (inShelter) {
    if (nearestIstotitNpc(world, entities, player, playerRoomId)) {
      return istotitAdmitNpc(world, entities, player, state, playerRoomId);
    }
    return istotitShelterAlone(world, player, state, playerRoomId);
  }

  return istotitFollowBell(world, entities, player, state, nextId, lookX, lookY);
}

function stampMaronarySourceMark(world: World, ci: number, seed: number, radius = 0.42): void {
  const x = ci % W;
  const y = (ci / W) | 0;
  stampMark(world, x, y, 0.5, 0.5, radius, MarkType.MARONARY, seed, 53, 255, 102, 175, world.cells[ci] === Cell.WALL);
}

interface RankedCellCandidate {
  idx: number;
  d2: number;
  priority: number;
}

function pushRankedCellCandidate(
  world: World,
  out: RankedCellCandidate[],
  seen: Set<number>,
  ci: number,
  cx: number,
  cy: number,
  maxRadius: number,
  priority: number,
): void {
  if (seen.has(ci)) return;
  const x = ci % W;
  const y = (ci / W) | 0;
  const d2 = world.dist2(cx + 0.5, cy + 0.5, x + 0.5, y + 0.5);
  if (d2 > maxRadius * maxRadius) return;
  seen.add(ci);
  out.push({ idx: ci, d2, priority });
}

function compareRankedCellCandidates(a: RankedCellCandidate, b: RankedCellCandidate): number {
  return a.priority - b.priority || a.d2 - b.d2 || a.idx - b.idx;
}

function stampMaronarySources(world: World, cx: number, cy: number): number[] {
  const candidates: RankedCellCandidate[] = [];
  const seen = new Set<number>();

  for (const ci of world.screenCells) {
    pushRankedCellCandidate(world, candidates, seen, ci, cx, cy, MARONARY_SOURCE_RADIUS, 0);
  }

  for (const [di, door] of world.doors) {
    if (door.state === DoorState.LOCKED) continue;
    if (world.aptMask[di]) continue;
    pushRankedCellCandidate(world, candidates, seen, di, cx, cy, MARONARY_SOURCE_RADIUS, 1);
  }

  const selected = candidates
    .sort(compareRankedCellCandidates)
    .slice(0, MARONARY_SOURCE_CAP)
    .map(candidate => candidate.idx);

  if (selected.length === 0) {
    const pos = findWalkableNear(world, cx, cy, 1, 10);
    if (pos) selected.push(world.idx(pos.x, pos.y));
  }

  for (let i = 0; i < selected.length; i++) {
    stampMaronarySourceMark(world, selected[i], 82_000 + selected[i] + i * 577);
  }
  return selected;
}

function chooseMaronaryWrongDoorClue(world: World, cx: number, cy: number): number {
  let bestIdx = -1;
  let bestD2 = MARONARY_WRONG_DOOR_RADIUS * MARONARY_WRONG_DOOR_RADIUS;
  for (const [di, door] of world.doors) {
    if (door.state === DoorState.LOCKED || world.aptMask[di]) continue;
    const x = di % W;
    const y = (di / W) | 0;
    const d2 = world.dist2(cx + 0.5, cy + 0.5, x + 0.5, y + 0.5);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIdx = di;
    }
  }
  if (bestIdx >= 0) {
    stampMaronarySourceMark(world, bestIdx, 84_000 + bestIdx, 0.55);
  }
  return bestIdx;
}

function addMaronaryGlowCell(cells: number[], ci: number): void {
  if (ci < 0) return;
  if (!cells.includes(ci)) cells.push(ci);
}

function rememberMaronaryGlowCells(sourceCells: readonly number[], wrongDoorIdx: number): number {
  const next: number[] = [];
  for (const ci of sourceCells) addMaronaryGlowCell(next, ci);
  addMaronaryGlowCell(next, wrongDoorIdx);
  maronaryGlowCells = next;
  maronaryGlowAccum = 0;
  return next.length;
}

function prepareMaronaryWarningClues(
  world: World,
  variant: ActiveSamosborVariant,
  cx: number,
  cy: number,
): { greenSourceCount: number; wrongDoorIdx: number } {
  if (!hasSamosborSubsystem(variant, 'maronary_sources') && !hasSamosborSubsystem(variant, 'wrong_door')) {
    return { greenSourceCount: 0, wrongDoorIdx: -1 };
  }
  const sourceCells = hasSamosborSubsystem(variant, 'maronary_sources') ? stampMaronarySources(world, cx, cy) : [];
  const wrongDoorIdx = hasSamosborSubsystem(variant, 'wrong_door') ? chooseMaronaryWrongDoorClue(world, cx, cy) : -1;
  const greenSourceCount = rememberMaronaryGlowCells(sourceCells, wrongDoorIdx);
  return {
    greenSourceCount,
    wrongDoorIdx,
  };
}

const maronaryGlowActors: Entity[] = [];
const istotitNpcQuery: Entity[] = [];

function maronaryGlowSourceCenter(ci: number): { x: number; y: number } {
  return { x: (ci % W) + 0.5, y: ((ci / W) | 0) + 0.5 };
}

function forceMaronaryGlowFlee(world: World, e: Entity, sx: number, sy: number): void {
  if (!e.ai || isPlayerEntity(e)) return;
  const dx = world.delta(sx, e.x);
  const dy = world.delta(sy, e.y);
  const len = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
  e.ai.goal = AIGoal.FLEE;
  e.ai.tx = world.wrap(Math.floor(e.x + dx / len * 8));
  e.ai.ty = world.wrap(Math.floor(e.y + dy / len * 8));
  e.ai.path = [];
  e.ai.pi = 0;
  e.ai.timer = Math.max(e.ai.timer, 1.2);
}

function applyMaronaryGlowDamage(world: World, state: GameState, e: Entity, amount: number, sx: number, sy: number): number {
  if (!e.alive || e.hp === undefined || amount <= 0) return 0;
  const before = e.hp;
  if (isPlayerEntity(e)) {
    e.hp = Math.max(1, e.hp - amount);
  } else {
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp <= 0) {
      e.alive = false;
      e.hp = 0;
    } else {
      forceMaronaryGlowFlee(world, e, sx, sy);
    }
  }
  const actual = before - e.hp;
  if (actual <= 0) return 0;
  if (isPlayerEntity(e)) {
    const maxHp = Math.max(1, e.maxHp ?? 100);
    state.dmgFlash = Math.max(state.dmgFlash, Math.min(1, 0.2 + actual / maxHp));
    state.dmgSeed = (state.dmgSeed + 53) | 0;
    recordPlayerDamage(state, undefined, actual, `Маронарий: зелёное свечение -${actual}`, 'samosbor');
  }
  return actual;
}

function hasDamagedMaronaryGlowActor(ids: readonly number[], id: number): boolean {
  for (const damagedId of ids) if (damagedId === id) return true;
  return false;
}

function tickMaronaryGlowDamage(
  world: World,
  entities: Entity[],
  state: GameState,
  dt: number,
  variant: ActiveSamosborVariant | null,
): void {
  if (!variant || !hasSamosborSubsystem(variant, 'source_glow') || maronaryGlowCells.length === 0) {
    maronaryGlowAccum = 0;
    return;
  }

  maronaryGlowAccum += dt;
  if (maronaryGlowAccum < MARONARY_GLOW_INTERVAL) return;
  const elapsed = Math.min(1.5, maronaryGlowAccum);
  maronaryGlowAccum = 0;
  const damage = Math.max(1, Math.round(MARONARY_GLOW_DAMAGE_PER_SECOND * elapsed));
  const damagedIds: number[] = [];
  const player = findPlayer(entities);
  let playerDamage = 0;
  let hitCount = 0;
  let sourceX = 0;
  let sourceY = 0;
  const index = ensureEntityIndex(entities);

  for (const sourceCell of maronaryGlowCells) {
    const source = maronaryGlowSourceCenter(sourceCell);
    sourceX = source.x;
    sourceY = source.y;
    index.queryRadiusCapped(source.x, source.y, MARONARY_GLOW_RADIUS, maronaryGlowActors, ENTITY_MASK_ACTOR, MARONARY_GLOW_ACTOR_CAP);
    if (player && world.dist2(source.x, source.y, player.x, player.y) <= MARONARY_GLOW_RADIUS * MARONARY_GLOW_RADIUS) {
      maronaryGlowActors.push(player);
    }
    for (const e of maronaryGlowActors) {
      if (hasDamagedMaronaryGlowActor(damagedIds, e.id)) continue;
      const actual = applyMaronaryGlowDamage(world, state, e, damage, source.x, source.y);
      if (actual <= 0) continue;
      damagedIds.push(e.id);
      hitCount++;
      if (isPlayerEntity(e)) playerDamage += actual;
    }
  }

  if (playerDamage <= 0 || state.time < maronaryGlowNoticeAt + 2.5) return;
  maronaryGlowNoticeAt = state.time;
  state.msgs.push(msg('Зелёное свечение Маронария жжёт кожу. Отойдите от источника.', state.time, variant.def.tint));
  publishEvent(state, {
    type: 'samosbor_warning',
    x: sourceX,
    y: sourceY,
    actorId: player?.id,
    actorName: player?.name ?? 'Вы',
    actorFaction: player?.faction,
    severity: 4,
    privacy: 'local',
    tags: ['samosbor', 'maronary', 'green_source', 'glow_damage', 'samosbor_maronary'],
    data: {
      damage: playerDamage,
      hitCount,
      sourceCells: maronaryGlowCells.length,
      radius: MARONARY_GLOW_RADIUS,
    },
  });
}

export function setMaronaryGlowCellsForTests(cells: readonly number[]): void {
  maronaryGlowCells = [...cells];
  maronaryGlowAccum = 0;
}

export function tickMaronaryGlowDamageForTests(
  world: World,
  entities: Entity[],
  state: GameState,
  dt: number,
  variant: ActiveSamosborVariant | null,
): void {
  tickMaronaryGlowDamage(world, entities, state, dt, variant);
}

function canSeedRandomSamosborOrigin(world: World, idx: number): boolean {
  if (world.aptMask[idx] || world.hermoWall[idx]) return false;
  const cell = world.cells[idx];
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return false;
  return territoryOwnerAtIndex(world, idx) !== ZoneFaction.SAMOSBOR;
}

function chooseWarningZone(world: World, _entities: Entity[]): { id: number; cx: number; cy: number } {
  for (let attempt = 0; attempt < 768; attempt++) {
    const x = Math.floor(Math.random() * W);
    const y = Math.floor(Math.random() * W);
    const idx = world.idx(x, y);
    if (!canSeedRandomSamosborOrigin(world, idx)) continue;
    const zone = world.zones[world.zoneMap[idx]];
    return { id: zone?.id ?? -1, cx: x, cy: y };
  }

  const candidates = world.zones.filter(zone => zone && territoryOwnerAt(world, zone.cx, zone.cy) !== ZoneFaction.SAMOSBOR);
  if (candidates.length > 0) {
    const zone = candidates[Math.floor(Math.random() * candidates.length)];
    return { id: zone.id, cx: zone.cx, cy: zone.cy };
  }
  return { id: -1, cx: Math.floor(Math.random() * W), cy: Math.floor(Math.random() * W) };
}

function samosborShortActionLine(variant: ActiveSamosborVariant, shelterCount: number): string {
  if (isIstotit(variant)) return shelterCount > 0
    ? 'К жёлтой герме. Внутри решайте: впустить или закрыться.'
    : 'К укрытию. Не отвечайте голосам.';
  if (isMaronary(variant)) return 'Не смотрите в зелёный источник. Проверьте дверь.';
  if (isVeretar(variant)) return 'От белой щели. К тёмной герме или из зоны.';
  if (variant.def.id === 'wet') return 'С воды к сухой герме или выше по полу.';
  if (variant.def.id === 'electric') return 'От ламп. Закройтесь раньше или уходите.';
  if (variant.def.id === 'meat') return 'От тёплых швов. В центр прохода или из зоны.';
  return 'К гермодвери или выйдите из зоны.';
}

function samosborShelterHintLine(variant: ActiveSamosborVariant, shelterCount: number): string {
  if (shelterCount > 0) return 'Укрытие отмечено. Мест мало.';
  if (isIstotit(variant)) return 'Дверь держите закрытой. Голосам не отвечать.';
  if (isMaronary(variant)) return 'Не выбирайте дверь по зелёному свету.';
  if (isVeretar(variant)) return 'Белое окно не выход.';
  return 'Если гермы нет рядом - выйдите из зоны.';
}

function samosborActiveActionLine(
  variant: ActiveSamosborVariant,
  shelterCount: number,
  sealed: boolean,
): string {
  if (sealed) {
    if (isIstotit(variant)) return 'Дверь держите закрытой. Голосам не отвечать.';
    if (isMaronary(variant)) return 'Не смотрите в источник. Проверьте номер двери.';
    if (isVeretar(variant)) return 'От белой щели. Не открывайте раму.';
    return 'Оставайтесь за гермой. Снаружи - уходите из зоны.';
  }
  return samosborShortActionLine(variant, shelterCount);
}

function warningActionLine(zoneId: number, seconds: number, variant: ActiveSamosborVariant, shelterCount: number): string {
  const zoneText = zoneId >= 0 ? `зона ${zoneId + 1}` : 'локальная зона';
  return `${samosborHudEventName(variant)} через ${seconds}с: ${zoneText}. ${samosborShortActionLine(variant, shelterCount)}`;
}

function samosborHudEventName(variant: ActiveSamosborVariant): string {
  if (isIstotit(variant)) return 'ИСТОТИТ';
  if (isMaronary(variant)) return 'МАРОНАРИЙ';
  if (isVeretar(variant)) return 'ВЕРЕТАР';
  if (variant.def.id === 'wet') return 'МОКРЫЙ САМОСБОР';
  if (variant.def.id === 'electric') return 'ЭЛЕКТРОСБОР';
  if (variant.def.id === 'meat') return 'МЯСНОЙ САМОСБОР';
  return 'САМОСБОР';
}

function warningSignalCode(variant: ActiveSamosborVariant): string {
  switch (variant.def.id) {
    case 'wet': return 'ВОД';
    case 'electric': return 'ЭЛК';
    case 'meat': return 'МЯС';
    case 'maronary': return 'МАР';
    case 'istotit': return 'ИСТ';
    case 'veretar': return 'ВЕР';
    default: return 'СБОР';
  }
}

function samosborWarningLogName(variant: ActiveSamosborVariant): string {
  switch (variant.def.id) {
    case 'classic': return 'классический самосбор';
    case 'wet': return 'мокрый самосбор';
    case 'electric': return 'электросбор';
    case 'meat': return 'мясной самосбор';
    default: return variant.def.displayName;
  }
}

function samosborWarningLogLine(seconds: number, variant: ActiveSamosborVariant): string {
  const left = Math.max(0, Math.ceil(seconds));
  return `Через ${left}с ожидается ${samosborWarningLogName(variant)}.`;
}

function warningAudioLine(variant: ActiveSamosborVariant): string {
  if (variant.def.audioCue === 'bell') return 'звук: низкий колокол вместо сирены';
  if (variant.def.audioCue === 'beep') return 'звук: высокий писк; не идти на источник';
  if (variant.def.audioCue === 'distant_alarm') return 'звук: внешняя тревога за белым окном';
  if (variant.def.audioCue === 'siren') return 'звук: штатная сирена';
  if (variant.noSiren) return 'звук: штатной сирены нет';
  return 'звук: штатная сирена';
}

function ambientDroneModeForVariant(variant: ActiveSamosborVariant): AmbientDroneMode {
  if (variant.def.audioCue === 'bell') return 'istotit';
  if (variant.def.audioCue === 'beep') return 'maronary';
  if (variant.def.audioCue === 'distant_alarm') return 'veretar';
  return variant.noSiren ? 'samosbor' : 'samosbor';
}

function warningHazardLine(
  variant: ActiveSamosborVariant,
  wrongDoorIdx: number,
  shelterCount: number,
): string {
  if (isMaronary(variant) && wrongDoorIdx >= 0) return 'опасность: повтор двери; зелёное свечение жжёт';
  if (isMaronary(variant)) return 'опасность: зелёный источник жжёт; держаться в стороне';
  if (isIstotit(variant) && shelterCount > 0) return `укрытия: жёлтые комнаты ${shelterCount}; мест мало, список короткий`;
  if (isVeretar(variant)) return 'опасность: белое пятно вместо комнаты';
  return 'опасность: зона риска рядом; выйти или закрыться';
}

function buildWarningSignals(
  variant: ActiveSamosborVariant,
  screenCount: number,
  barkCount: number,
  wrongDoorIdx: number,
  shelterCount: number,
  seconds: number,
): SamosborWarningSignals {
  const audioLine = warningAudioLine(variant);
  const screenLine = screenCount > 0
    ? `экраны: ${screenCount} табло мигают; проверь ближайшее`
    : 'экраны: рядом нет табло';
  const hazardLine = warningHazardLine(variant, wrongDoorIdx, shelterCount);
  const npcLine = barkCount > 0
    ? `соседи: ${barkCount} предупреждения; слушай короткие команды`
    : 'соседи: никого рядом';
  const visualLine = screenCount > 0
    ? `визуал: ${screenCount} табло; ${hazardLine}`
    : `визуал: ${hazardLine}`;
  const channels = ['hud', 'log', 'hazard'];
  if (screenCount > 0) channels.push('screens');
  if (barkCount > 0) channels.push('npc_barks');
  if (!variant.noSiren || variant.def.audioCue) channels.push('audio');
  return {
    audioLine,
    screenLine,
    hazardLine,
    npcLine,
    visualLine,
    logLine: samosborWarningLogLine(seconds, variant),
    signalCode: warningSignalCode(variant),
    channels,
    channelLines: [audioLine, visualLine, npcLine],
  };
}

function playVariantWarningCue(variant: ActiveSamosborVariant): void {
  setAmbientDroneMode(ambientDroneModeForVariant(variant));
  if (variant.def.audioCue === 'bell') {
    playIstotitBell();
    return;
  }
  if (variant.def.audioCue === 'beep') {
    playMaronarySignal();
    return;
  }
  if (variant.def.audioCue === 'distant_alarm') {
    playVeretarSignal();
    return;
  }
  if (variant.def.audioCue === 'siren' || !variant.noSiren) playSamosborAlarm();
}

function warningBarkForVariant(variant: ActiveSamosborVariant, isFemale: boolean): string {
  switch (variant.def.id) {
    case 'istotit':
      return isFemale
        ? 'Колокола слышишь? К жёлтой герме. Внутри решай: впустить соседа или закрыться одной!'
        : 'Сирена сорвалась в колокола. В укрытие, чужим голосам не отвечай!';
    case 'maronary':
      return isFemale
        ? 'Писк слышишь? Не смотри в зелёное, номер двери проверь!'
        : 'Зелёный источник не трогай взглядом. Дверь сверяй по карте!';
    case 'veretar':
      return isFemale
        ? 'Занавеску держи двумя руками. Там не наш двор!'
        : 'Белое окно не двор. Оттащи свидетеля и к тёмной герме!';
    case 'wet':
      return isFemale
        ? 'Вода пошла по полу. Не стой в низине, к сухой двери!'
        : 'Мокрый сбор идёт. С пола уходи, дверь закрывай раньше!';
    case 'electric':
      return isFemale
        ? 'Свет моргает. От ламп к герме, пока привод живой!'
        : 'Озон чувствуешь? Не смотри на лампы, к двери!';
    case 'meat':
      return isFemale
        ? 'Стены пахнут мясом. Тихой комнате не верь!'
        : 'Мясо в стенах пошло. Не стой где тепло, беги из зоны!';
    default:
      return isFemale
        ? 'Слышишь? К герме, пока уплотнитель держит!'
        : 'Сирена пошла. Ноги к герме, голову вниз!';
  }
}

function pushWarningBarks(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
  zoneX: number,
  zoneY: number,
): number {
  let barked = 0;
  let checked = 0;
  const player = entities.find(e => e.alive && isPlayerEntity(e));
  for (const e of entities) {
    if (barked >= SAMOSBOR_WARNING_BARK_CAP || checked >= 512) break;
    checked++;
    if (!e.alive || isPlayerEntity(e) || e.type !== EntityType.NPC || !e.name) continue;
    if (world.dist2(zoneX + 0.5, zoneY + 0.5, e.x, e.y) > SAMOSBOR_WARNING_BARK_RADIUS2) continue;
    const line = warningBarkForVariant(variant, e.isFemale === true);
    if (!pushNpcBarkMessage(e, state.msgs, state.time, line, '#fc4', {
      listener: player,
      radiusMeters: hearingRadiusMetersForActor(player, state.npcLogRadiusMeters),
      dist2: (x1, y1, x2, y2) => world.dist2(x1, y1, x2, y2),
    })) continue;
    observeRumorEvent(e, {
      type: 'samosbor_warning',
      severity: 4,
      floor: state.currentFloor,
      zoneId: world.zoneMap[world.idx(Math.floor(e.x), Math.floor(e.y))],
      tags: ['samosbor', 'warning', 'bark', `samosbor_${variant.def.id}`],
    }, state.time);
    barked++;
  }
  return barked;
}

function ensureSamosborWarning(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
): SamosborWarningRuntime {
  if (
    samosborWarning &&
    samosborWarning.floor === state.currentFloor &&
    samosborWarning.cycle === state.samosborCount
  ) {
    return samosborWarning;
  }
  if (samosborWarning) clearSamosborWarning(true);

  const variant = getActiveSamosborVariant() ?? chooseSamosborVariant(state.currentFloor);
  const zone = chooseWarningZone(world, entities);
  const seconds = Math.max(0, Math.ceil(state.samosborTimer));
  const istotitShelterRoomIds = prepareIstotitShelters(world, state, variant, zone.cx, zone.cy);
  const localShelterRoomIds = prepareLocalSamosborShelters(world, entities, state, variant, zone.id, zone.cx, zone.cy);
  const shelterRoomIds = mergeRoomIds(istotitShelterRoomIds, localShelterRoomIds);
  const actionLine = samosborShortActionLine(variant, shelterRoomIds.length);
  const shelterHintLine = samosborShelterHintLine(variant, shelterRoomIds.length);
  const countdownLine = warningActionLine(zone.id, seconds, variant, shelterRoomIds.length);
  const warningLine = pick(variant.def.warningLines) ?? countdownLine;
  const screenCount = flashSamosborWarningScreens(
    world,
    zone.cx,
    zone.cy,
    SAMOSBOR_WARNING_SCREEN_RADIUS,
    SAMOSBOR_WARNING_SCREEN_CAP,
  );
  const maronaryClue = prepareMaronaryWarningClues(world, variant, zone.cx, zone.cy);

  const barkCount = pushWarningBarks(world, entities, state, variant, zone.cx, zone.cy);
  const signals = buildWarningSignals(
    variant,
    screenCount,
    barkCount,
    maronaryClue.wrongDoorIdx,
    shelterRoomIds.length,
    seconds,
  );
  const signalMsg = msg(signals.logLine, state.time, variant.def.tint);
  const signalListener = entities.find(e => e.alive && isPlayerEntity(e));
  signalMsg.floor = state.currentFloor;
  signalMsg.zoneId = zone.id >= 0 ? zone.id : undefined;
  signalMsg.x = zone.cx;
  signalMsg.y = zone.cy;
  signalMsg.distanceMeters = signalListener
    ? Math.max(0, Math.round(Math.sqrt(world.dist2(zone.cx, zone.cy, signalListener.x, signalListener.y))))
    : undefined;
  signalMsg.hud = true;
  signalMsg.hudPriority = 96;
  state.msgs.push(signalMsg);
  state.msgLog.push({
    text: signalMsg.text,
    color: signalMsg.color,
    day: signalMsg.day,
    hour: signalMsg.hour,
    minute: signalMsg.minute,
    floor: signalMsg.floor,
    zoneId: signalMsg.zoneId,
    x: signalMsg.x,
    y: signalMsg.y,
    distanceMeters: signalMsg.distanceMeters,
  });
  if (state.msgLog.length > 500) state.msgLog.splice(0, state.msgLog.length - 500);

  samosborWarning = {
    cycle: state.samosborCount,
    floor: state.currentFloor,
    zoneId: zone.id,
    zoneX: zone.cx,
    zoneY: zone.cy,
    startedAt: state.time,
    variant,
    warningLine,
    actionLine,
    shelterHintLine,
    screenCount,
    greenSourceCount: maronaryClue.greenSourceCount,
    wrongDoorIdx: maronaryClue.wrongDoorIdx,
    signals,
  };

  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: zone.id >= 0 ? zone.id : undefined,
    x: zone.cx,
    y: zone.cy,
    severity: 4,
    privacy: 'public',
    tags: samosborEventTags(variant, ['samosbor', 'warning', 'prewarning', 'variant'], maronaryClue.wrongDoorIdx >= 0),
    data: {
      warningChannels: [...signals.channels],
      variantId: variant.def.id,
      variantName: variant.def.displayName,
      warning: warningLine,
      actionLine,
      shelterHintLine,
      secondsToImpact: seconds,
      screenCount,
      greenSourceCount: maronaryClue.greenSourceCount,
      wrongDoorIdx: maronaryClue.wrongDoorIdx >= 0 ? maronaryClue.wrongDoorIdx : undefined,
      shelterRoomIds,
      signals: {
        audio: signals.audioLine,
        screen: signals.screenLine,
        hazard: signals.hazardLine,
        npc: signals.npcLine,
      },
    },
  });
  tickSamosborDirector(world, entities, state, nextId, variant, 'pre_samosbor');
  playVariantWarningCue(variant);
  return samosborWarning;
}

/* ── Update samosbor timer and trigger ────────────────────────── */
export function updateSamosbor(
  world: World,
  entities: Entity[],
  state: GameState,
  dt: number,
  nextId: { v: number },
  replacementProvider?: () => FloorGeneration | undefined,
  scheduleLocalPatch?: (runPatch: () => void) => void,
): boolean {
  if (state.gameOver) return false;

  knownSamosborTime = state.time;
  state.samosborTimer -= dt;
  if (!state.samosborActive && isSamosborWaveActive() && !isSamosborWaveDebugActive()) {
    cancelSamosborWave();
    activeSamosborScale = 'full';
  }

  if (!state.samosborActive && state.samosborTimer > SAMOSBOR_WARNING_WINDOW + 0.5 && samosborWarning) {
    clearSamosborWarning(true);
  }
  if (!state.samosborActive && state.samosborTimer <= SAMOSBOR_WARNING_WINDOW) {
    ensureSamosborWarning(world, entities, state, nextId);
  }
  updateHermodoorBorer(world, entities, state, dt, nextId);

  if (!state.samosborActive && state.samosborTimer <= 0) {
    // ── START samosbor: capture zone + spawn mobs (doors stay open!) ──
    const warning = ensureSamosborWarning(world, entities, state, nextId);
    const variant = warning.variant;
    const warningZoneId = warning.zoneId;
    state.samosborActive = true;
    cancelSamosborWave();
    clearSamosborWaveSnapshot();
    freezeNavigationCacheForWorld(world);
    state.samosborTimer = Math.max(
      SAMOSBOR_DURATION_MIN_SEC,
      Math.min(SAMOSBOR_DURATION_MAX_SEC, nextFloorRunSamosborDuration(state) * variant.durationMult),
    );
    state.samosborCount++;
    fogSpawnAccum = 0;
    samosborSealed = false;
    activeSamosborZoneId = -1;
    activeSamosborPreviousZoneFaction = null;
    activeSamosborPreviousTerritory = [];
    activeSamosborPreviousZoneFogged = false;
    activeSamosborScale = 'full';
    samosborDirectorAccum = 0;
    maronaryPingAccum = 0;
    randomEntityTransferAccum = 0;
    playerPressureSpawnAccum = 0;
    samosborPlayerShelterRoomId = -1;
    state.msgs.push(msg(variant.def.startLine ?? '⚠ САМОСБОР НАЧАЛСЯ ⚠', state.time, variant.def.tint));
    publishEvent(state, {
      type: 'samosbor_started',
      severity: 5,
      privacy: 'public',
      tags: samosborEventTags(variant, ['samosbor', 'start', 'danger', 'variant'], warning.wrongDoorIdx >= 0),
      data: {
        variantId: variant.def.id,
        variantName: variant.def.displayName,
        samosborCount: state.samosborCount,
        greenSourceCount: warning.greenSourceCount,
        wrongDoorIdx: warning.wrongDoorIdx >= 0 ? warning.wrongDoorIdx : undefined,
      },
    });
    if (hasSamosborSubsystem(variant, 'wrong_door')) {
      createMaronaryWrongDoorRemap(
        world,
        entities,
        state,
        'maronary_start',
        warning.wrongDoorIdx >= 0 ? warning.wrongDoorIdx : undefined,
      );
    }

    // Switch some armed NPCs to CIVIL_DEFENSE during samosbor
    for (const npc of entities) {
      if (npc.type !== EntityType.NPC || !npc.alive) continue;
      const armed = !!npc.weapon || npc.faction === Faction.LIQUIDATOR;
      if (armed && Math.random() < 0.3) {
        if (npc.originalOccupation === undefined) {
           npc.originalOccupation = npc.occupation;
        }
        npc.occupation = Occupation.CIVIL_DEFENSE;
      }
    }

    // NPCs hide (citizens/scientists only — handled by forceHide)
    forceHide(entities, state.msgs, state.time, world, state.clock, getSamosborShelterRoomIds(state));

    // Capture a zone with фиолетовый туман + spawn fog boss
    activeSamosborZoneId = captureZone(
      world,
      entities,
      nextId,
      state,
      variant,
      warningZoneId,
      warning.zoneX,
      warning.zoneY,
      warning.greenSourceCount,
      warning.wrongDoorIdx,
    );
    activeSamosborScale = 'full';
    clearSamosborWarning(false, false);

    // Spawn the first pressure pulse. These monsters are born from samosbor,
    // but are not leashed to the captured fog/light seed.
    spawnMonsters(world, entities, nextId, state.samosborCount, variant, state.currentFloor);

    // Spawn extra map pressure; ongoing escalation is handled by active fog samples.
    spawnRandomMapMonsters(world, entities, nextId, state.samosborCount, variant, state.currentFloor);

    // Launch multi-front chaotic waves across the entire floor
    clearSamosborFronts();
    activeSamosborFronts = spawnSamosborFronts(world, entities, variant, getSamosborShelterRoomIds(state));
  }

  // ── Seal apartments 10 seconds before samosbor ends ──
  const activeVariant = getActiveSamosborVariant();
  tickMaronaryGlowDamage(world, entities, state, dt, activeVariant);
  if (activeVariant && hasSamosborSubsystem(activeVariant, 'room_sirens')) tickSamosborRoomSirens(world, entities, state, dt);
  else clearSamosborRoomSirens();
  const sealBeforeEnd = Math.max(0, SEAL_BEFORE_END + (activeVariant?.sealTimingDelta ?? 0));
  if (state.samosborActive && activeVariant && !samosborSealed && state.samosborTimer <= sealBeforeEnd) {
    const sealedShelters = sealApartments(world, entities, state, getSamosborShelterRoomIds(state));
    samosborSealed = true;
    resolvePlayerShelterAtSeal(world, entities, state, activeVariant);
    const sealText = activeVariant.sealTimingDelta > 0
      ? 'ГЕРМЫ: досрочное закрытие. Кто у ручки - внутрь сейчас.'
      : activeVariant.sealTimingDelta < 0
        ? 'ГЕРМЫ: задержка закрытия. Не стой в коридоре, ищи второй контур.'
        : 'ГЕРМЫ: закрываются. Не стойте снаружи; зайдите в комнату или ищите второй контур.';
    state.msgs.push(msg(sealText, state.time, '#fa0'));
    if (sealedShelters > 0) state.msgs.push(msg('Жёлтые гермы закрылись мягко. Внутри стало теснее.', state.time, activeVariant.def.tint));
  }

  // ── Fog/light spread is universal ──
  spreadFog(world);
  // ── Debug wave (not used during real samosbor — always full-scale fronts) ──
  if (isSamosborWaveDebugActive() && isSamosborWaveActive()) {
    tickSamosborWave(world, entities, state);
  }

  // ── Tick multi-front chaotic wave engine during active samosbor ──
  if (state.samosborActive && activeVariant && activeSamosborFronts.length > 0) {
    samosborFrontTickAccum += dt;
    // Cap catch-up to avoid multi-tick bursts on FPS drops
    let catchup = 0;
    const shelterSet = new Set(getSamosborShelterRoomIds(state));
    while (samosborFrontTickAccum >= SAMOSBOR_FRONT_TICK_INTERVAL && catchup < SAMOSBOR_FRONT_MAX_CATCHUP_TICKS) {
      samosborFrontTickAccum -= SAMOSBOR_FRONT_TICK_INTERVAL;
      catchup++;
      tickAllSamosborFronts(world, entities, nextId, activeVariant, state.currentFloor, state.samosborCount, shelterSet);
    }
    // Drain excess accumulated time beyond cap
    if (samosborFrontTickAccum > SAMOSBOR_FRONT_TICK_INTERVAL * SAMOSBOR_FRONT_MAX_CATCHUP_TICKS) {
      samosborFrontTickAccum = SAMOSBOR_FRONT_TICK_INTERVAL * 0.5;
    }
  }

  // ── Spawn monsters in fogged areas during samosbor ──
  if (state.samosborActive) {
    if (activeVariant) {
      if (isMaronary(activeVariant)) {
        maronaryPingAccum += dt;
        if (maronaryPingAccum >= MARONARY_PING_INTERVAL) {
          maronaryPingAccum = 0;
          playMaronaryPing();
        }
      } else {
        maronaryPingAccum = 0;
      }
      samosborDirectorAccum += dt;
      if (samosborDirectorAccum >= SAMOSBOR_DIRECTOR_ACTIVE_INTERVAL) {
        samosborDirectorAccum = 0;
        tickSamosborDirector(world, entities, state, nextId, activeVariant, 'active_cadence');
      }
    }
    if (activeVariant && hasSamosborSubsystem(activeVariant, 'random_transfer')) {
      randomEntityTransferAccum += dt;
      for (let i = 0; randomEntityTransferAccum >= SAMOSBOR_RANDOM_ENTITY_TRANSFER_INTERVAL && i < 4; i++) {
        randomEntityTransferAccum -= SAMOSBOR_RANDOM_ENTITY_TRANSFER_INTERVAL;
        tickRandomEntityTransfer(world, entities, state, activeVariant);
      }
    } else {
      randomEntityTransferAccum = 0;
    }
    fogSpawnAccum += dt;
    const fogSpawnInterval = Math.max(0.25, FOG_SPAWN_INTERVAL * (activeVariant?.fogSpawnIntervalMult ?? 1));
    if (fogSpawnAccum >= fogSpawnInterval) {
      fogSpawnAccum -= fogSpawnInterval;
      if (activeVariant) tickSamosborFogEffects(world, entities, state, nextId, state.samosborCount, activeVariant, state.currentFloor);
    }
    playerPressureSpawnAccum += dt;
    for (let i = 0; playerPressureSpawnAccum >= SAMOSBOR_PLAYER_PRESSURE_INTERVAL && i < 4; i++) {
      playerPressureSpawnAccum -= SAMOSBOR_PLAYER_PRESSURE_INTERVAL;
      if (activeVariant) spawnSamosborPlayerPressureMonster(world, entities, state, nextId, activeVariant, state.currentFloor);
    }
  }

  if (state.samosborActive && state.samosborTimer <= 0) {
    // Restore professions
    for (const npc of entities) {
      if (npc.type === EntityType.NPC && npc.alive && npc.originalOccupation !== undefined) {
        npc.occupation = npc.originalOccupation;
        npc.originalOccupation = undefined;
      }
    }

    // ── END samosbor: unseal, mark for rebuild ──
    const endedVariant = getActiveSamosborVariant();
    const aftermathZone = activeSamosborZoneId >= 0 ? world.zones[activeSamosborZoneId] : undefined;
    const endedIstotitDecision = endedVariant?.def.id === 'istotit'
      ? activeIstotitDecision(state) ?? 'none'
      : undefined;
    state.samosborActive = false;
    state.samosborTimer = nextFloorRunSamosborCooldown(state);
    const endLine = endedVariant?.def.id === 'istotit'
      ? 'Истотит отзвонил. Жёлтая пыль осталась на плинтусах, ведомость - на руках.'
      : endedVariant?.def.id === 'maronary'
        ? 'Маронарий смолк. Зелёные метки остались у дверей. Проверь номер двери до сна.'
      : endedVariant?.def.id === 'veretar'
        ? 'Веретар отступил. Белый песок остался в швах; проверь, все ли вышли из укрытия.'
      : 'Отбой прошёл. Проверь дверь, карту и тех, кто должен был выйти за тобой.';
    state.msgs.push(msg(endLine, state.time, endedVariant?.def.tint ?? '#aa4'));
    publishEvent(state, {
      type: 'samosbor_ended',
      zoneId: activeSamosborZoneId >= 0 ? activeSamosborZoneId : undefined,
      x: aftermathZone?.cx,
      y: aftermathZone?.cy,
      severity: 5,
      privacy: 'public',
      tags: endedVariant
        ? samosborEventTags(endedVariant, ['samosbor', 'end', 'regrow', 'aftermath_pending'])
        : ['samosbor', 'end', 'regrow', 'samosbor_unknown', 'aftermath_pending'],
      data: {
        samosborCount: state.samosborCount,
        variantId: endedVariant?.def.id,
        variantName: endedVariant?.def.displayName,
        nextTimer: state.samosborTimer,
        istotitDecision: endedIstotitDecision,
      },
    });
    if (endedVariant) {
      pendingAftermath = {
        state,
        variant: endedVariant,
        floor: state.currentFloor,
        zoneId: activeSamosborZoneId,
        x: aftermathZone?.cx ?? Math.floor(findPlayer(entities)?.x ?? W / 2),
        y: aftermathZone?.cy ?? Math.floor(findPlayer(entities)?.y ?? W / 2),
        samosborCount: state.samosborCount,
        endedAt: state.time,
        istotitDecision: endedIstotitDecision,
      };
    }
    clearActiveSamosborVariant();
    samosborDirectorAccum = 0;
    maronaryPingAccum = 0;
    clearMaronaryGlowRuntime();
    clearSamosborRoomSirens();
    clearSamosborFronts();
    world.clearTissue();

    const localShelterRoomIds = getLocalSamosborShelterRoomIds(state);
    notifyLocalSamosborShelterEnd(world, entities, state, nextId, endedVariant ?? null);

    // Unseal apartment doors
    unsealApartments(world);
    if (samosborPlayerShelterRoomId >= 0) unsealRooms(world, [samosborPlayerShelterRoomId]);
    unsealRooms(world, mergeRoomIds(istotitShelterRoomIds, localShelterRoomIds));
    samosborPlayerShelterRoomId = -1;
    clearIstotitShelters();
    clearLocalSamosborShelters(state);

    // Re-roll contextual NPC assignment givers after the shock.
    reassignQuestGivers(entities);
    queuePostSamosborHermodoorBorer(world, state);
    restoreCapturedSamosborZone(world);
    unfreezeNavigationCacheForWorld(world);

    activeSamosborScale = 'full';

    // Full-scale fronts already mutated geometry in real-time.
    // Now stitch: generate a fresh floor and sew it into the world at touched cells.
    const stitchFloor = state.currentFloor;
    const touched = new Set(frontTouchedCells);
    frontTouchedCells.clear();
    const doStitch = (): void => {
      const replacement = replacementProvider?.() ?? generateFloor(stitchFloor, ensureFloorRunState(state).runSeed, state.tutorialMode);
      applyFrontFieldStitch(world, state, touched, replacement);
      applyPendingSamosborAftermathAfterWave(world, entities, nextId, stitchFloor);
    };
    if (scheduleLocalPatch) {
      scheduleLocalPatch(doStitch);
    } else {
      doStitch();
    }
    
    
    return false;
  }

  return false;
}

/* ── Seal all apartment clusters (hermetic doors) ─────────────── */
function sealApartments(world: World, entities: Entity[], state: GameState, extraRoomIds: readonly number[] = []): number {
  // Build set of apartmentIds that have alive resident NPCs
  const occupiedApts = new Set<number>();
  for (const e of entities) {
    if (e.type === EntityType.NPC && e.alive && e.familyId !== undefined && e.familyId >= 0) {
      occupiedApts.add(e.familyId);
    }
  }

  const aptCount = world.apartmentRoomCount;
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    // Only seal apartments that have living residents
    if (room.apartmentId < 0 || !occupiedApts.has(room.apartmentId)) continue;
    let blocked = false;
    for (const di of room.doors) {
      if (blocksHermodoorBorerSeal(world, state, di, room.id)) blocked = true;
    }
    if (blocked) {
      room.sealed = false;
      continue;
    }
    room.sealed = true;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      setDoorState(world, door, DoorState.HERMETIC_CLOSED);
    }
  }
  let sealedExtra = 0;
  for (const roomId of extraRoomIds) {
    const room = world.rooms[roomId];
    if (!room || room.sealed) continue;
    let blocked = false;
    for (const di of room.doors) {
      if (blocksHermodoorBorerSeal(world, state, di, room.id)) blocked = true;
    }
    if (blocked) {
      room.sealed = false;
      continue;
    }
    room.sealed = true;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      setDoorState(world, door, DoorState.HERMETIC_CLOSED);
    }
    sealedExtra++;
  }
  return sealedExtra;
}

/* ── Unseal all apartment rooms ───────────────────────────────── */
function unsealApartments(world: World): void {
  const aptCount = world.apartmentRoomCount;
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    if (!room || !room.sealed) continue;
    room.sealed = false;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      if (door && door.state === DoorState.HERMETIC_CLOSED) {
        setDoorState(world, door, DoorState.HERMETIC_OPEN);
      }
    }
  }
}

function unsealRooms(world: World, roomIds: readonly number[]): void {
  for (const roomId of roomIds) {
    const room = world.rooms[roomId];
    if (!room || !room.sealed) continue;
    room.sealed = false;
    for (const di of room.doors) {
      const door = world.doors.get(di);
      if (door && door.state === DoorState.HERMETIC_CLOSED) {
        setDoorState(world, door, DoorState.HERMETIC_OPEN);
      }
    }
  }
}

/* ── Full world rebuild (except apartments) — runs AFTER samosbor ends ── */

function fogCanRemainAfterRebuild(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.WATER;
}

function preserveSamosborFogAfterRebuild(world: World, previousFog: Uint8Array): void {
  for (let i = 0; i < previousFog.length; i++) {
    const fog = previousFog[i];
    if (fog <= world.fog[i]) continue;
    if (!fogCanRemainAfterRebuild(world.cells[i])) continue;
    world.fog[i] = fog;
  }
}

export function rebuildWorld(
  world: World, entities: Entity[], nextId: { v: number }, _samosborCount: number,
  floor: FloorLevel = FloorLevel.LIVING,
  replacement?: FloorGeneration,
  isTutorial?: boolean,
): void {
  clearHermodoorBorerForRebuild(world);
  if (replacement || floor !== FloorLevel.LIVING) {
    // Non-living floors fully regenerate; generated NPCs/monsters are replaced, player survives.
    const kept: Entity[] = [];
    for (const e of entities) {
      if (!e.alive) continue;
      if (isPlayerEntity(e)) {
        kept.push(e);
      }
    }
    entities.length = 0;
    const gen = replacement ?? generateFloor(floor, undefined, isTutorial);
    const previousFog = world.fog.slice();
    // Full-floor rebuilds use the fresh generator-owned masks exactly:
    // authored shelters may keep aptMask/hermoWall, while unmarked volatile cells lose stale protection.
    replaceWorldFromGeneration(world, gen);
    preserveSamosborFogAfterRebuild(world, previousFog);
    replaceCellHazards(world, gen.world);
    replaceRouteCueStateForRebuild(world, gen.world);
    replaceEmergencyPanelStateForRebuild(world, gen.world);
    // Restore kept entities + merge new entities from generator
    for (const e of kept) entities.push(e);
    for (const e of gen.entities) {
      e.id = nextId.v++;
      entities.push(e);
    }
    relocateBlockedEntities(world, entities);
    ensureRoomContainers(world, floor);
    applyPendingSamosborAftermath(world, entities, nextId, floor);
    refreshPathBlockersAfterSamosborRebuild(world, entities, _samosborCount);
    return;
  }

  // Living floor: only rebuild volatile maze, keep apartments
  const aptCount = world.apartmentRoomCount;

  // Kill projectiles and remove loose visible props outside apartments
  let writeIdx = 0;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type === EntityType.PROJECTILE) {
      continue;
    }
    if (e.type === EntityType.ITEM_DROP || e.type === EntityType.BILLBOARD) {
      const rid = world.roomMap[world.idx(Math.floor(e.x), Math.floor(e.y))];
      if (rid < 0 || rid >= aptCount) {
        continue;
      }
    }
    entities[writeIdx++] = e;
  }
  entities.length = writeIdx;

  // Regenerate the entire volatile maze
  replaceRouteCueStateForRebuild(world);
  replaceEmergencyPanelStateForRebuild(world);
  regrowMaze(world);
  relocateBlockedEntities(world, entities);

  // Spawn new items in volatile rooms within the shared item soft limit.
  let itemSlots = entitySpawnSlots(entities, EntityType.ITEM_DROP, Number.MAX_SAFE_INTEGER);
  for (let ri = aptCount; ri < world.rooms.length; ri++) {
    if (itemSlots <= 0) break;
    const room = world.rooms[ri];
    if (!room || room.w < 3 || room.h < 3) continue;
    const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    const zid = world.zoneMap[ci];
    const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 1) : 1;
    const valueThreshold = zoneLevel * 15 + 10;
    const adjusted = Object.values(ITEMS)
      .filter(it => it.spawnRooms.includes(room.type))
      .map(it => ({ ...it, spawnW: (1000 / (it.value + 10)) * Math.min(1, (valueThreshold + 5) / Math.max(1, it.value)) }))
      .filter(it => it.spawnW >= 0.01);
    const numItems = rng(0, 1);
    for (let n = 0; n < numItems; n++) {
      if (itemSlots <= 0) break;
      const def = weightedPick(adjusted);
      if (!def) continue;
      const ix = room.x + rng(1, Math.max(1, room.w - 2));
      const iy = room.y + rng(1, Math.max(1, room.h - 2));
      entities.push({
        id: nextId.v++, type: EntityType.ITEM_DROP,
        x: ix + 0.5, y: iy + 0.5, angle: 0, pitch: 0, alive: true, speed: 0, sprite: Spr.ITEM_DROP,
        inventory: [{ defId: def.id, count: rng(1, spawnCount(def)), data: def.id === 'note' ? pick(NOTES) : undefined }],
      });
      itemSlots--;
    }
  }
  ensureRoomContainers(world, floor);
  applyPendingSamosborAftermath(world, entities, nextId, floor);
  refreshPathBlockersAfterSamosborRebuild(world, entities, _samosborCount);
}

function refreshPathBlockersAfterSamosborRebuild(world: World, entities: readonly Entity[], seed: number): void {
  rebuildPathBlockersFromWorldObjects(world, seed);
  const player = findPlayer(entities);
  if (!player) return;
  clearPathBlockerRegion(world, Math.floor(player.x) - 1, Math.floor(player.y) - 1, 3, 3);
}

function findPlayer(entities: readonly Entity[]): Entity | undefined {
  return entities.find(e => isPlayerEntity(e) && e.alive);
}

function relocateEntityIfBlocked(world: World, e: Entity): void {
  if (!e.alive || e.type === EntityType.PROJECTILE) return;
  const ci = world.idx(Math.floor(e.x), Math.floor(e.y));
  if (!world.solid(ci % W, (ci / W) | 0)) return;

  const sx = Math.floor(e.x);
  const sy = Math.floor(e.y);
  for (let r = 1; r <= 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(sx + dx);
        const y = world.wrap(sy + dy);
        if (world.solid(x, y)) continue;
        e.x = x + 0.5;
        e.y = y + 0.5;
        return;
      }
    }
  }
}

function relocateBlockedEntities(world: World, entities: Entity[]): void {
  for (const e of entities) relocateEntityIfBlocked(world, e);
}

function aftermathCenter(world: World, entities: Entity[], pending: PendingAftermath, preferPlayer: boolean): { x: number; y: number } {
  const player = findPlayer(entities);
  if (preferPlayer && player) return { x: Math.floor(player.x), y: Math.floor(player.y) };
  const zone = pending.zoneId >= 0 ? world.zones[pending.zoneId] : undefined;
  if (zone) return { x: zone.cx, y: zone.cy };
  if (player) return { x: Math.floor(player.x), y: Math.floor(player.y) };
  return { x: pending.x, y: pending.y };
}

function beatReady(def: SamosborAftermathBeatDef, now: number): boolean {
  const rt = aftermathRuntime.get(def.id);
  if (!rt) return true;
  if (rt.runs >= def.maxRuns) return false;
  return now - rt.lastAt >= def.cooldownSec;
}

function pickAftermathBeat(
  defs: readonly SamosborAftermathBeatDef[],
  used: Set<string>,
  now: number,
  samosborCount: number,
): SamosborAftermathBeatDef | null {
  let total = 0;
  for (const def of defs) {
    if (used.has(def.id) || !beatReady(def, now)) continue;
    if (samosborCount < (def.minSamosborCount ?? 0)) continue;
    total += def.weight;
  }
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const def of defs) {
    if (used.has(def.id) || !beatReady(def, now)) continue;
    if (samosborCount < (def.minSamosborCount ?? 0)) continue;
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return null;
}

function applyPendingSamosborAftermath(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  floor: FloorLevel,
): void {
  const pending = pendingAftermath;
  if (!pending || pending.floor !== floor) return;
  pendingAftermath = null;

  const state = pending.state;

  if (pending.variant.def.id === 'meat') {
    const rng = new SeedRng(state.time + pending.samosborCount * 1337);
    const count = 3 + Math.floor(rng.nextU32() / 4294967296 * 3); // 3 to 5
    const slots = entitySpawnSlots(entities, EntityType.MONSTER, count);

    // Find valid corridor cells for spawn
    const corridorCells: number[] = [];
    for (let ci = 0; ci < world.cells.length; ci++) {
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) {
        corridorCells.push(ci);
      }
    }

    for (let i = 0; i < slots && corridorCells.length > 0; i++) {
      const idx = Math.floor(rng.nextU32() / 4294967296 * corridorCells.length);
      const ci = corridorCells[idx];
      corridorCells[idx] = corridorCells[corridorCells.length - 1];
      corridorCells.pop();

      const x = (ci % W) + 0.5;
      const y = ((ci / W) | 0) + 0.5;
      entities.push(createMonster(world, nextId, MonsterKind.NIGHTMARE, x, y, floor));
    }
  }
  knownSamosborTime = state.time;
  const defs = getSamosborAftermathBeats(pending.variant.def.id, floor);
  const target = 1;
  const used = new Set<string>();
  const applied: string[] = [];

  while (applied.length < target && used.size < defs.length) {
    const def = pickAftermathBeat(defs, used, state.time, pending.samosborCount);
    if (!def) break;
    used.add(def.id);
    if (!applySamosborAftermathBeat(def, pending, world, entities, nextId)) continue;
    const rt = aftermathRuntime.get(def.id) ?? { lastAt: -Infinity, runs: 0 };
    rt.lastAt = state.time;
    rt.runs++;
    aftermathRuntime.set(def.id, rt);
    applied.push(def.id);
  }

  if (applied.length > 0) {
    lastAftermathAt = state.time;
    lastAftermathBeatIds = applied;
    lastAftermathFloor = floor;
  }
  tickSamosborDirector(world, entities, state, nextId, pending.variant, 'post_samosbor');
}

export function applyPendingSamosborAftermathAfterWave(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  floor: FloorLevel,
): void {
  applyPendingSamosborAftermath(world, entities, nextId, floor);
}

function eventTypeForAftermath(def: SamosborAftermathBeatDef): WorldEventType {
  switch (def.effect) {
    case 'production_shortage':
      return 'room_lacked_resources';
    case 'container_theft':
      return 'item_stolen';
    case 'door_fault':
      return 'door_opened';
    case 'route_block':
      return 'door_sealed';
    case 'item_residue':
      return 'samosbor_warning';
    default:
      return 'samosbor_warning';
  }
}

function publishAftermath(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  x: number,
  y: number,
  data: Record<string, unknown> = {},
): void {
  const itemId = typeof data.itemId === 'string' ? data.itemId : def.itemId;
  const monsterKind = typeof data.monsterKind === 'number' ? data.monsterKind as MonsterKind : def.monsterKind;
  const containerId = typeof data.containerId === 'number' ? data.containerId : undefined;
  const roomId = typeof data.roomId === 'number' ? data.roomId : undefined;
  const targetId = typeof data.targetId === 'number' ? data.targetId : undefined;
  pending.state.msgs.push(msg(def.message, pending.state.time, pending.variant.def.tint));
  publishEvent(pending.state, {
    type: eventTypeForAftermath(def),
    zoneId: pending.zoneId >= 0 ? pending.zoneId : undefined,
    roomId,
    x,
    y,
    targetId,
    targetName: monsterKind !== undefined ? MONSTERS[monsterKind]?.name : undefined,
    itemId,
    itemName: itemId ? ITEMS[itemId]?.name ?? itemId : undefined,
    itemCount: typeof data.itemCount === 'number' ? data.itemCount : undefined,
    monsterKind,
    containerId,
    severity: def.severity,
    privacy: 'local',
    tags: [
      'samosbor',
      'aftermath',
      def.effect,
      `samosbor_${pending.variant.def.id}`,
      ...def.tags,
    ].slice(0, 8),
    data: {
      beatId: def.id,
      beatTitle: def.title,
      variantId: pending.variant.def.id,
      variantName: pending.variant.def.displayName,
      samosborCount: pending.samosborCount,
      istotitDecision: pending.istotitDecision,
      ...data,
    },
  });
}

function applySamosborAftermathBeat(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
  nextId: { v: number },
): boolean {
  switch (def.effect) {
    case 'fog_residue':
      return applyFogResidue(def, pending, world, entities, false);
    case 'door_fault':
      return applyDoorFault(def, pending, world, entities);
    case 'route_block':
      return applyRouteBlock(def, pending, world, entities);
    case 'monster_aftershock':
      return applyMonsterAftershock(def, pending, world, entities, nextId);
    case 'rumor_seed':
      return applyRumorSeed(def, pending, world, entities);
    case 'production_shortage':
      return applyProductionShortage(def, pending, world, entities);
    case 'faction_panic':
      return applyFactionPanic(def, pending, world, entities);
    case 'container_theft':
      return applyContainerTheft(def, pending, world, entities);
    case 'false_all_clear':
      return applyFogResidue(def, pending, world, entities, true);
    case 'item_residue':
      return applyItemResidue(def, pending, world, entities, nextId);
  }
  return false;
}

function applyFogResidue(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
  preferPlayer: boolean,
): boolean {
  const c = aftermathCenter(world, entities, pending, preferPlayer);
  const radius = Math.max(2, Math.min(10, def.radius));
  const r2 = radius * radius;
  const strength = def.fogStrength ?? 120;
  let changed = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = world.wrap(c.x + dx);
      const y = world.wrap(c.y + dy);
      const i = world.idx(x, y);
      if (world.aptMask[i] || (world.cells[i] !== Cell.FLOOR && world.cells[i] !== Cell.DOOR)) continue;
      if (world.fog[i] >= strength) continue;
      world.fog[i] = strength;
      changed++;
    }
  }
  if (changed <= 0) return false;
  world.markFogDirty(squareDirtyRects(c.x, c.y, radius));
  publishAftermath(def, pending, c.x, c.y, { cells: changed, radius, fogStrength: strength });
  return true;
}

function findLocalDoor(world: World, x: number, y: number, radius: number): number {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = world.idx(x + dx, y + dy);
      if (world.cells[i] === Cell.DOOR && world.doors.has(i)) return i;
    }
  }
  return -1;
}

function doorTouchesApartment(world: World, door: { roomA: number; roomB: number }): boolean {
  const roomA = door.roomA >= 0 ? world.rooms[door.roomA] : undefined;
  const roomB = door.roomB >= 0 ? world.rooms[door.roomB] : undefined;
  return (roomA?.apartmentId ?? -1) >= 0 || (roomB?.apartmentId ?? -1) >= 0;
}

function findRouteScarDoor(world: World, x: number, y: number, radius: number): number {
  let bestIdx = -1;
  let bestD2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const di = world.idx(x + dx, y + dy);
      if (world.cells[di] !== Cell.DOOR || world.aptMask[di]) continue;
      const door = world.doors.get(di);
      if (!door || door.state === DoorState.LOCKED || door.state === DoorState.HERMETIC_CLOSED) continue;
      if (doorTouchesApartment(world, door)) continue;
      const d2 = world.dist2(x + 0.5, y + 0.5, (di % W) + 0.5, ((di / W) | 0) + 0.5);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = di;
      }
    }
  }
  return bestIdx;
}

function stampAftermathDoorMark(
  world: World,
  di: number,
  pending: PendingAftermath,
  def: SamosborAftermathBeatDef,
): string {
  const x = di % W;
  const y = (di / W) | 0;
  if (pending.variant.def.id === 'maronary') {
    stampMaronarySourceMark(world, di, 86_000 + di, 0.52);
    return 'maronary_ring';
  }
  if (pending.variant.def.id === 'istotit') {
    stampMark(world, x, y, 0.5, 0.5, 0.38, MarkType.PSI, 86_000 + di, 214, 166, 75, 150);
    return 'gold_dust';
  }
  if (pending.variant.def.id === 'veretar') {
    stampMark(world, x, y, 0.5, 0.5, 0.38, MarkType.SPLAT, 86_000 + di, 244, 241, 223, 150);
    return 'white_scar';
  }
  if (def.tags.includes('water') || pending.variant.def.id === 'wet') {
    stampMark(world, x, y, 0.5, 0.5, 0.42, MarkType.DRIP, 86_000 + di, 70, 100, 120, 120);
    return 'wet_drag';
  }
  stampMark(world, x, y, 0.5, 0.5, 0.38, MarkType.SCORCH, 86_000 + di, 94, 82, 70, 135, true);
  return 'scorch';
}

function applyDoorFault(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  const c = aftermathCenter(world, entities, pending, true);
  let di = findLocalDoor(world, c.x, c.y, Math.min(18, def.radius));
  if (di < 0) {
    const zc = aftermathCenter(world, entities, pending, false);
    di = findLocalDoor(world, zc.x, zc.y, Math.min(18, def.radius));
  }
  const door = di >= 0 ? world.doors.get(di) : undefined;
  if (!door) return false;
  const oldState = door.state;
  setDoorState(world, door, oldState === DoorState.HERMETIC_CLOSED || oldState === DoorState.HERMETIC_OPEN
    ? DoorState.HERMETIC_OPEN
    : DoorState.OPEN);
  door.timer = Math.max(door.timer, 45);
  const doorMark = stampAftermathDoorMark(world, di, pending, def);
  publishAftermath(def, pending, di % W, (di / W) | 0, {
    doorIdx: di,
    oldState,
    newState: door.state,
    doorMarked: true,
    doorMark,
    wrongDoor: pending.variant.def.id === 'maronary' || def.tags.includes('wrong_door'),
  });
  return true;
}

function applyRouteBlock(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  const c = aftermathCenter(world, entities, pending, false);
  let di = findRouteScarDoor(world, c.x, c.y, Math.min(18, def.radius));
  if (di < 0) {
    const pc = aftermathCenter(world, entities, pending, true);
    di = findRouteScarDoor(world, pc.x, pc.y, Math.min(18, def.radius));
  }
  const door = di >= 0 ? world.doors.get(di) : undefined;
  if (!door) return false;
  const oldState = door.state;
  setDoorState(world, door, DoorState.HERMETIC_CLOSED);
  door.timer = 0;
  const x = di % W;
  const y = (di / W) | 0;
  stampMark(world, x, y, 0.5, 0.5, 0.42, MarkType.SCORCH, 88_000 + di, 116, 96, 84, 150, true);
  publishAftermath(def, pending, x, y, {
    doorIdx: di,
    oldState,
    newState: door.state,
    routeBlocked: true,
  });
  return true;
}

function findWalkableNear(world: World, x: number, y: number, minRadius: number, maxRadius: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 80; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const r = minRadius + Math.random() * Math.max(1, maxRadius - minRadius);
    const tx = world.wrap(Math.round(x + Math.cos(a) * r));
    const ty = world.wrap(Math.round(y + Math.sin(a) * r));
    const i = world.idx(tx, ty);
    if (world.cells[i] === Cell.FLOOR && !world.aptMask[i]) return { x: tx, y: ty };
  }
  for (let r = minRadius; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const tx = world.wrap(x + dx);
        const ty = world.wrap(y + dy);
        const i = world.idx(tx, ty);
        if (world.cells[i] === Cell.FLOOR && !world.aptMask[i]) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

function applyMonsterAftershock(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
  nextId: { v: number },
): boolean {
  const c = aftermathCenter(world, entities, pending, true);
  const targetCount = Math.max(1, Math.min(4, Math.floor(def.monsterCount ?? 1)));
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, targetCount);
  if (slots <= 0) return false;
  const kind = def.monsterKind ?? MonsterKind.TVAR;
  const spawnedIds: number[] = [];
  let firstPos: { x: number; y: number } | null = null;
  for (let i = 0; i < slots; i++) {
    const pos = findWalkableNear(world, c.x, c.y, 5 + i, Math.max(7 + i, def.radius + i * 2));
    if (!pos) continue;
    const monster = createMonster(world, nextId, kind, pos.x + 0.5, pos.y + 0.5, pending.floor, true);
    entities.push(monster);
    spawnedIds.push(monster.id);
    if (!firstPos) firstPos = pos;
  }
  if (!firstPos || spawnedIds.length === 0) return false;
  publishAftermath(def, pending, firstPos.x, firstPos.y, {
    monsterKind: kind,
    targetId: spawnedIds[0],
    targetIds: spawnedIds,
    monsterCount: spawnedIds.length,
    spawnCap: targetCount,
  });
  return true;
}

function applyItemResidue(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
  nextId: { v: number },
): boolean {
  const itemId = def.itemId;
  if (!itemId || !ITEMS[itemId]) return false;
  const c = aftermathCenter(world, entities, pending, true);
  const pos = findWalkableNear(world, c.x, c.y, 1, Math.max(3, def.radius));
  if (!pos) return false;
  const item: Entity = {
    id: nextId.v++,
    type: EntityType.ITEM_DROP,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId: itemId, count: 1 }],
  };
  entities.push(item);
  if (itemId === 'veretar_sand' || itemId === 'overexposed_photo') {
    stampMark(world, pos.x, pos.y, 0.5, 0.5, 0.42, MarkType.SPLAT, 93_000 + item.id, 244, 241, 223, 170);
  } else if (itemId === 'maronary_shaving') {
    stampMark(world, pos.x, pos.y, 0.5, 0.5, 0.34, MarkType.PSI, 87_000 + item.id, 80, 240, 100, 140);
  }
  publishAftermath(def, pending, pos.x, pos.y, { itemId, itemCount: 1, targetId: item.id });
  return true;
}

function localNpcs(world: World, entities: Entity[], x: number, y: number, radius: number, limit: number): Entity[] {
  const out: Entity[] = [];
  const r2 = radius * radius;
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.NPC) continue;
    if (world.dist2(x + 0.5, y + 0.5, e.x, e.y) > r2) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

function applyRumorSeed(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  const c = aftermathCenter(world, entities, pending, true);
  let npcs = localNpcs(world, entities, c.x, c.y, def.radius, 8);
  if (npcs.length === 0) {
    const zc = aftermathCenter(world, entities, pending, false);
    npcs = localNpcs(world, entities, zc.x, zc.y, def.radius, 8);
  }
  if (npcs.length === 0) {
    publishAftermath(def, pending, c.x, c.y, { npcCount: 0, rumorSpawned: true, rumorCarrier: 'world_event' });
    return true;
  }
  for (const npc of npcs) {
    observeRumorEvent(npc, {
      type: 'samosbor_warning',
      severity: def.severity,
      floor: pending.floor,
      zoneId: pending.zoneId >= 0 ? pending.zoneId : undefined,
      tags: ['samosbor', 'aftermath', ...def.tags],
      itemId: def.itemId,
      monsterKind: def.monsterKind,
    }, pending.state.time);
  }
  publishAftermath(def, pending, c.x, c.y, { npcCount: npcs.length, rumorSpawned: true, rumorCarrier: 'npc_memory' });
  return true;
}

function applyProductionShortage(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  const resourceId = def.resourceId ?? 'labor';
  const delta = -Math.max(4, 6 + pending.samosborCount * 2);
  if (!changeResourceStock(pending.state, resourceId, delta, pending.floor)) return false;
  const c = aftermathCenter(world, entities, pending, false);
  const room = world.roomAt(c.x, c.y);
  publishAftermath(def, pending, c.x, c.y, { resourceId, delta, roomId: room?.id });
  return true;
}

function factionToAftermathControl(faction: Faction | undefined): ZoneFaction | null {
  if (faction === Faction.LIQUIDATOR) return ZoneFaction.LIQUIDATOR;
  if (faction === Faction.CULTIST) return ZoneFaction.CULTIST;
  if (faction === Faction.WILD) return ZoneFaction.WILD;
  if (faction === Faction.CITIZEN || faction === Faction.SCIENTIST || faction === Faction.PLAYER) return ZoneFaction.CITIZEN;
  return null;
}

function defaultAftermathControlFaction(pending: PendingAftermath): ZoneFaction {
  if (pending.variant.def.id === 'meat') return ZoneFaction.CULTIST;
  if (pending.variant.def.id === 'electric' || pending.variant.def.id === 'wet') return ZoneFaction.LIQUIDATOR;
  return ZoneFaction.CITIZEN;
}

function pickAftermathControlFaction(pending: PendingAftermath, npcs: readonly Entity[]): ZoneFaction {
  for (const npc of npcs) {
    const zf = factionToAftermathControl(npc.faction);
    if (zf !== null && zf !== ZoneFaction.CITIZEN) return zf;
  }
  return defaultAftermathControlFaction(pending);
}

function applyAftermathFactionControl(
  world: World,
  cx: number,
  cy: number,
  zoneId: number,
  zf: ZoneFaction,
  radius: number,
): number {
  if (zoneId < 0) return 0;
  const r = Math.max(2, Math.min(10, radius));
  const changed = paintTerritoryDisc(world, cx, cy, r, zf, {
    cellCap: AFTERMATH_FACTION_CONTROL_CAP,
    zoneId,
    preserveSamosbor: true,
    passableOnly: true,
  });
  if (changed > 0) syncZoneMetadataFromTerritory(world, [zoneId]);
  return changed;
}

function applyFactionPanic(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  const c = aftermathCenter(world, entities, pending, true);
  const npcs = localNpcs(world, entities, c.x, c.y, def.radius, 12).filter(e => e.ai);
  for (const npc of npcs) {
    const ai = npc.ai!;
    const dx = world.delta(c.x + 0.5, npc.x);
    const dy = world.delta(c.y + 0.5, npc.y);
    const len = Math.max(0.1, Math.sqrt(dx * dx + dy * dy));
    const tx = world.wrap(Math.floor(npc.x + dx / len * 14));
    const ty = world.wrap(Math.floor(npc.y + dy / len * 14));
    const status = tryAssignPathToCell(world, npc, tx, ty);
    ai.pi = 0;
    ai.tx = tx;
    ai.ty = ty;
    ai.goal = status !== 'not_found' ? AIGoal.FLEE : AIGoal.WANDER;
    ai.timer = 5;
    getNpcMemory(npc, pending.state.time).fear = 100;
  }
  const zoneId = world.zoneMap[world.idx(c.x, c.y)];
  const controlFaction = pickAftermathControlFaction(pending, npcs);
  const controlCells = applyAftermathFactionControl(world, c.x, c.y, zoneId, controlFaction, Math.min(10, def.radius));
  if (npcs.length === 0 && controlCells === 0) return false;
  publishAftermath(def, pending, c.x, c.y, {
    npcCount: npcs.length,
    controlCells,
    controlFaction,
    factionStateAltered: controlCells > 0,
  });
  return true;
}

function addAftermathContainerTag(container: WorldContainer, tag: string): void {
  if (!container.tags.includes(tag)) container.tags.push(tag);
}

function canReceiveContainerItem(container: WorldContainer, itemId: string): boolean {
  const def = ITEMS[itemId];
  if (!def) return false;
  const stackMax = getStack(def);
  return container.inventory.some(item => item.defId === itemId && item.data === undefined && item.count < stackMax)
    || container.inventory.length < MAX_INVENTORY_SLOTS;
}

function addOneContainerItem(container: WorldContainer, itemId: string, data?: unknown): boolean {
  const def = ITEMS[itemId];
  if (!def) return false;
  const stackMax = getStack(def);
  for (const item of container.inventory) {
    if (item.defId !== itemId || item.data !== undefined || data !== undefined || item.count >= stackMax) continue;
    item.count++;
    return true;
  }
  if (container.inventory.length >= MAX_INVENTORY_SLOTS) return false;
  container.inventory.push({ defId: itemId, count: 1, data });
  return true;
}

function chooseContainerLoot(container: WorldContainer, preferredItemId?: string): { slotIdx: number; itemId: string; data?: unknown } | null {
  if (preferredItemId) {
    const preferredIdx = container.inventory.findIndex(item => item.defId === preferredItemId && item.count > 0 && !!ITEMS[item.defId]);
    if (preferredIdx >= 0) {
      const item = container.inventory[preferredIdx];
      return { slotIdx: preferredIdx, itemId: item.defId, data: item.count === 1 ? item.data : undefined };
    }
  }
  for (let slotIdx = 0; slotIdx < container.inventory.length; slotIdx++) {
    const item = container.inventory[slotIdx];
    if (item.count > 0 && ITEMS[item.defId]) return { slotIdx, itemId: item.defId, data: item.count === 1 ? item.data : undefined };
  }
  return null;
}

function removeOneContainerItem(container: WorldContainer, slotIdx: number): boolean {
  const item = container.inventory[slotIdx];
  if (!item || item.count <= 0) return false;
  item.count--;
  if (item.count <= 0) container.inventory.splice(slotIdx, 1);
  return true;
}

function findLootReceiver(
  world: World,
  pending: PendingAftermath,
  source: WorldContainer,
  itemId: string,
  radius: number,
): WorldContainer | null {
  const r2 = radius * radius;
  let best: WorldContainer | null = null;
  let bestScore = Infinity;
  for (const container of world.containers) {
    if (container.id === source.id || container.floor !== pending.floor) continue;
    if (!canReceiveContainerItem(container, itemId)) continue;
    const d2 = world.dist2(source.x + 0.5, source.y + 0.5, container.x + 0.5, container.y + 0.5);
    if (d2 > r2 && container.zoneId !== source.zoneId && container.zoneId !== pending.zoneId) continue;
    const accessBias = container.access === 'public' ? -60 : container.access === 'room' ? -30 : 0;
    const seenBias = container.discovered ? -20 : 0;
    const zoneBias = container.zoneId === source.zoneId ? -20 : 0;
    const score = d2 + accessBias + seenBias + zoneBias;
    if (score < bestScore) {
      bestScore = score;
      best = container;
    }
  }
  return best;
}

function moveAftermathLoot(
  world: World,
  pending: PendingAftermath,
  source: WorldContainer,
  def: SamosborAftermathBeatDef,
): Record<string, unknown> {
  const loot = chooseContainerLoot(source, def.itemId);
  if (!loot) return { lootMoved: false };
  const receiver = findLootReceiver(world, pending, source, loot.itemId, Math.max(6, def.radius));
  if (!receiver || !removeOneContainerItem(source, loot.slotIdx)) return { lootMoved: false };
  if (!addOneContainerItem(receiver, loot.itemId, loot.data)) {
    addOneContainerItem(source, loot.itemId, loot.data);
    return { lootMoved: false };
  }
  source.stolenItemIds ??= [];
  source.stolenItemIds.push(loot.itemId);
  source.lastAuditAt = pending.state.time;
  source.discovered = true;
  receiver.discovered = true;
  addAftermathContainerTag(source, 'aftermath_loot_source');
  addAftermathContainerTag(receiver, 'aftermath_loot_receiver');
  return {
    lootMoved: true,
    itemId: loot.itemId,
    itemCount: 1,
    sourceContainerId: source.id,
    receiverContainerId: receiver.id,
    receiverAccess: receiver.access,
  };
}

function applyContainerTheft(
  def: SamosborAftermathBeatDef,
  pending: PendingAftermath,
  world: World,
  entities: Entity[],
): boolean {
  ensureRoomContainers(world, pending.floor);
  const c = aftermathCenter(world, entities, pending, true);
  let best = world.containers.find(container =>
    container.access !== 'public' &&
    container.floor === pending.floor && world.dist2(c.x + 0.5, c.y + 0.5, container.x + 0.5, container.y + 0.5) <= def.radius * def.radius);
  best ??= world.containers.find(container =>
    container.floor === pending.floor && world.dist2(c.x + 0.5, c.y + 0.5, container.x + 0.5, container.y + 0.5) <= def.radius * def.radius);
  if (!best) {
    const zc = aftermathCenter(world, entities, pending, false);
    best = world.containers.find(container =>
      container.access !== 'public' &&
      container.floor === pending.floor && container.zoneId === pending.zoneId &&
      world.dist2(zc.x + 0.5, zc.y + 0.5, container.x + 0.5, container.y + 0.5) <= def.radius * def.radius);
    best ??= world.containers.find(container =>
      container.floor === pending.floor && container.zoneId === pending.zoneId &&
      world.dist2(zc.x + 0.5, zc.y + 0.5, container.x + 0.5, container.y + 0.5) <= def.radius * def.radius);
  }
  if (!best) return false;
  const oldAccess = best.access;
  best.discovered = true;
  if (best.access === 'locked') best.access = 'faction';
  addAftermathContainerTag(best, 'aftermath_unsealed');
  const moved = moveAftermathLoot(world, pending, best, def);
  if (moved.lootMoved !== true && def.itemId && ITEMS[def.itemId] && addOneContainerItem(best, def.itemId)) {
    moved.itemId = def.itemId;
    moved.itemCount = 1;
    moved.lootSeeded = true;
  }
  publishAftermath(def, pending, best.x, best.y, {
    containerId: best.id,
    oldAccess,
    newAccess: best.access,
    ...moved,
  });
  return true;
}

export function getSamosborDebugLines(): string[] {
  const active = getActiveSamosborVariant();
  const last = getLastSamosborVariant();
  const forced = getForcedSamosborVariant();
  const warning = getSamosborWarningSnapshot();
  let cooldown = 0;
  let hasCooldown = false;
  for (const def of getSamosborAftermathBeats(last ?? 'classic', lastAftermathFloor)) {
    const rt = aftermathRuntime.get(def.id);
    if (!rt || rt.runs >= def.maxRuns) continue;
    const remaining = Math.max(0, Math.ceil(rt.lastAt + def.cooldownSec - knownSamosborTime));
    if (!hasCooldown || remaining < cooldown) cooldown = remaining;
    hasCooldown = true;
  }
  const beats = lastAftermathBeatIds.length > 0 ? lastAftermathBeatIds.join(',') : '-';
  const warningZone = warning ? (warning.zoneId >= 0 ? `зона ${warning.zoneId + 1}` : 'локально') : '-';
  const veretarLeakAge = Number.isFinite(lastVeretarAreaLeakAt)
    ? `${Math.max(0, Math.round(knownSamosborTime - lastVeretarAreaLeakAt))}s ago`
    : '-';
  const istotitLine = `Истотит: shelters=${istotitShelterRoomIds.length} supplies=${istotitSupplyContainerIds.length} decision=${istotitDecision || '-'}`;
  const localShelterLines = getLocalSamosborShelterDebugLines();

  // Front summary
  const aliveFronts = activeSamosborFronts.filter(f => !f.dead);
  const totalProcessed = activeSamosborFronts.reduce((s, f) => s + f.processed, 0);
  const totalChanged = activeSamosborFronts.reduce((s, f) => s + f.changed, 0);
  const totalMonstersFromFronts = activeSamosborFronts.reduce((s, f) => s + f.monstersSpawned, 0);

  return [
    `Самосбор: ${active ? active.def.displayName : '-'} | scale=${activeSamosborScale} zone=${activeSamosborZoneId >= 0 ? activeSamosborZoneId + 1 : '-'} sealed=${samosborSealed ? 'Y' : 'N'}`,
    `Предупреждение: ${warning ? `${warning.variantName} ${warningZone} ${warning.secondsLeft}s` : '-'}`,
    `Прошлый: ${getSamosborVariantName(last)} | Следующий: ${getSamosborVariantName(forced)}`,
    istotitLine,
    `Фронты: ${aliveFronts.length}/${activeSamosborFronts.length} alive | cells=${totalProcessed} changed=${totalChanged} mobs=${totalMonstersFromFronts}`,
    ...getSamosborWaveDebugLines(),
    ...getSamosborFrontDebugLines(),
    ...localShelterLines,
    `Веретар: area_leak=${lastVeretarAreaLeaks} ${veretarLeakAge}`,
    `Последствия: ${beats}  cd ${hasCooldown ? cooldown : 0}s${pendingAftermath ? ' pending' : ''}`,
    `Последний aftermath: ${Number.isFinite(lastAftermathAt) ? Math.max(0, Math.round(knownSamosborTime - lastAftermathAt)) + 's ago' : '-'}`,
  ];
}

/* ── Shared helpers for monster creation ───────────────────────── */
function pickMonsterKindForWave(floor: FloorLevel, samosborCount: number): MonsterKind {
  return chooseFloorMonsterKind({
    floor,
    floorTags: ['samosbor', 'fog'],
    samosborCount,
    allowRare: samosborCount >= 4 && Math.random() < 0.08,
  });
}

function createMonster(world: World, nextId: { v: number }, kind: MonsterKind, x: number, y: number, _floor: FloorLevel, _forceVariant = false): Entity {
  const def = MONSTERS[kind];
  const ci = world.idx(Math.floor(x), Math.floor(y));
  const zid = world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 1) : 1;
  const rpg = randomRPG(zoneLevel);
  const hpBase = scaleMonsterHp(def.hp, zoneLevel);
  const hpFinal = Math.round(hpBase * (1 + 0.1 * rpg.str));
  const goal = kind === MonsterKind.BLACK_LIQUIDATOR ? AIGoal.WANDER : AIGoal.HUNT;
  const monster: Entity = {
    id: nextId.v++,
    type: EntityType.MONSTER,
    x, y,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp: hpFinal,
    maxHp: hpFinal,
    monsterKind: kind,
    attackCd: def.attackRate,
    ai: { goal, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
    phasing: kind === MonsterKind.SPIRIT,
  };
  return monster;
}

function raiseMonsterToAtLeastLevel(monster: Entity, kind: MonsterKind, minLevel: number): boolean {
  const currentLevel = Math.max(1, Math.floor(monster.rpg?.level ?? 1));
  if (currentLevel >= minLevel) return false;
  const def = MONSTERS[kind];
  const rpg = randomRPG(minLevel);
  const level = rpg.level;
  const hpBase = scaleMonsterHp(def.hp, level);
  const hpFinal = Math.max(1, Math.round(hpBase * (1 + 0.1 * rpg.str)));
  monster.rpg = rpg;
  monster.hp = hpFinal;
  monster.maxHp = hpFinal;
  monster.speed = scaleMonsterSpeed(def.speed, level);
  return true;
}

function randomEnumValue<T extends number>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function randomMonsterKindWeighted(floor: FloorLevel, samosborCount: number): MonsterKind {
  return chooseFloorMonsterKind({
    floor,
    floorTags: ['samosbor', 'fog', 'rewrite'],
    samosborCount,
    allowRare: samosborCount >= 4 && Math.random() < 0.08,
    floorAffinity: 'weighted',
  });
}

function randomItemIdDifferent(current?: string): string {
  const ids = Object.keys(ITEMS);
  if (ids.length === 0) return current ?? 'bread';
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (id !== current) return id;
  }
  return ids.find(id => id !== current) ?? ids[0];
}

function randomItemStack(defId: string): { defId: string; count: number; data?: unknown } {
  const def = ITEMS[defId];
  const count = def ? Math.max(1, Math.min(spawnCount(def), getStack(def))) : 1;
  const data = defId === 'note' ? pick(NOTES) : undefined;
  return data === undefined ? { defId, count } : { defId, count, data };
}

function randomNpcLevel(): number {
  return Math.max(1, Math.min(100, 1 + Math.floor(Math.pow(Math.random(), 1.55) * 100)));
}

function randomNpcInventory(faction: Faction, level: number): { inventory: { defId: string; count: number; data?: unknown }[]; weapon?: string; tool?: string } {
  const rollWeapon = Math.random();
  const numPockets = 1 + Math.floor(Math.random() * 4);
  const rollPockets = Array.from({ length: numPockets }, () => Math.random());
  
  const loadout = generateNpcLoadout(faction, level, 3, rollWeapon, rollPockets);
  
  return {
    inventory: loadout.inventory ?? [],
    weapon: loadout.weapon,
    tool: loadout.tool,
  };
}

function rewriteActorAsRandomNpc(state: GameState, entity: Entity, variant: ActiveSamosborVariant): void {
  const faction = randomEnumValue(RANDOM_NPC_FACTIONS);
  const occupation = randomEnumValue(RANDOM_NPC_OCCUPATIONS);
  const named = randomName(faction);
  const rpg = randomRPG(randomNpcLevel());
  const maxHp = getMaxHp(rpg);
  const loadout = randomNpcInventory(faction, rpg.level);
  const wasPlayer = isPlayerEntity(entity);
  if (entity.type === EntityType.NPC && entity.plotNpcId && entity.alifeId === undefined) {
    recordAlifeNpcDeath(state, entity);
    delete entity.plotNpcId;
  }
  entity.name = wasPlayer ? `${named.name} (вы)` : named.name;
  entity.firstName = named.firstName;
  entity.lastName = named.lastName;
  entity.isFemale = named.female;
  entity.faction = wasPlayer ? Faction.PLAYER : faction;
  entity.occupation = occupation;
  entity.sprite = occupation;
  entity.spriteSeed = Math.floor(Math.random() * 0x7fffffff) + 1;
  entity.speed = 1.2;
  entity.needs = freshNeeds();
  entity.rpg = rpg;
  entity.maxHp = maxHp;
  entity.hp = maxHp;
  entity.money = Math.floor(Math.random() * (40 + rpg.level * 8));
  entity.inventory = loadout.inventory;
  entity.weapon = loadout.weapon;
  entity.tool = loadout.tool;
  entity.ai = wasPlayer ? entity.ai : { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
  entity.questId = -1;
  entity.canGiveQuest = !wasPlayer && Math.random() < 0.10;
  entity.familyId = Math.floor(secureRandom() * 1_000_000_000);
  if (entity.type === EntityType.NPC && entity.alifeId !== undefined) rewriteAlifeNpcIdentityFromEntity(state, entity);
  if (wasPlayer) {
    state.dmgFlash = Math.max(state.dmgFlash, 0.25);
    state.dmgSeed = (state.dmgSeed + 71) | 0;
  }
  publishEvent(state, {
    type: 'samosbor_warning',
    x: entity.x,
    y: entity.y,
    actorId: wasPlayer ? entity.id : undefined,
    actorName: wasPlayer ? entity.name : undefined,
    targetId: wasPlayer ? undefined : entity.id,
    targetName: entity.name,
    severity: wasPlayer ? 5 : 4,
    privacy: wasPlayer ? 'private' : 'local',
    tags: ['samosbor', 'fog_effect', 'maronary', 'rewrite', `samosbor_${variant.def.id}`],
    data: {
      effect: 'rewrite_actor',
      faction,
      occupation,
      level: rpg.level,
      persistentNpcId: entity.persistentNpcId,
      alifeId: entity.alifeId,
      playerTransformed: wasPlayer,
    },
  });
}

function rewriteMonsterAsRandom(world: World, entity: Entity, floor: FloorLevel, samosborCount: number): void {
  const kind = randomMonsterKindWeighted(floor, samosborCount);
  const def = MONSTERS[kind];
  const level = randomNpcLevel();
  const rpg = randomRPG(level);
  const hpBase = scaleMonsterHp(def.hp, level);
  const hpFinal = Math.max(1, Math.round(hpBase * (1 + 0.08 * rpg.str)));
  entity.monsterKind = kind;
  entity.sprite = def.sprite;
  entity.spriteScale = undefined;
  entity.speed = scaleMonsterSpeed(def.speed, level);
  entity.hp = hpFinal;
  entity.maxHp = hpFinal;
  entity.attackCd = def.attackRate;
  entity.rpg = rpg;
  entity.ai = { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 };
  entity.phasing = kind === MonsterKind.SPIRIT;
  entity.isFogBoss = false;
  entity.fogBossZone = undefined;
  const ci = world.idx(Math.floor(entity.x), Math.floor(entity.y));
  entity.angle = Math.random() * Math.PI * 2;
  entity.pitch = 0;
  entity.x = (ci % W) + 0.5;
  entity.y = ((ci / W) | 0) + 0.5;
}

const samosborFogEffectEntities: Entity[] = [];

function entityOnFogCell(world: World, entities: Entity[], ci: number): Entity | null {
  samosborFogEffectEntities.length = 0;
  const x = ci % W;
  const y = (ci / W) | 0;
  ensureEntityIndex(entities).queryRadiusCapped(
    x + 0.5,
    y + 0.5,
    0.72,
    samosborFogEffectEntities,
    ENTITY_MASK_VISIBLE,
    SAMOSBOR_FOG_EFFECT_ENTITY_CAP,
  );
  const exact = samosborFogEffectEntities.filter(e =>
    e.alive &&
    world.idx(Math.floor(e.x), Math.floor(e.y)) === ci &&
    e.type !== EntityType.BILLBOARD &&
    e.type !== EntityType.PROJECTILE);
  if (exact.length === 0) return null;
  exact.sort((a, b) => a.type - b.type);
  return exact[0];
}

function findAdjacentWall(world: World, ci: number): number {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let i = 0; i < FOG_DIRS_X.length; i++) {
    const ni = world.idx(x + FOG_DIRS_X[i], y + FOG_DIRS_Y[i]);
    if (world.cells[ni] === Cell.WALL && !world.aptMask[ni] && !world.hermoWall[ni]) return ni;
  }
  return -1;
}

function mutateWorldCellByMaronary(world: World, ci: number): string {
  if (world.aptMask[ci] || world.hermoWall[ci] || world.cells[ci] === Cell.LIFT) return '';
  const adjacentWall = findAdjacentWall(world, ci);
  if (adjacentWall >= 0 && Math.random() < 0.45) {
    world.wallTex[adjacentWall] = randomEnumValue(RANDOM_WALL_TEX);
    world.markWallTexDirty(cellDirtyRect(adjacentWall));
    stampMaronarySourceMark(world, adjacentWall, 94_000 + adjacentWall, 0.38);
    return 'wall_texture';
  }
  if (world.features[ci] !== Feature.NONE || Math.random() < 0.45) {
    const old = world.features[ci];
    let next = randomEnumValue(RANDOM_FEATURES);
    if (RANDOM_FEATURES.length > 1) {
      for (let attempt = 0; attempt < 6 && next === old; attempt++) next = randomEnumValue(RANDOM_FEATURES);
    }
    if (world.setFeatureAt(ci, next, true, cellDirtyRect(ci))) {
      stampMaronarySourceMark(world, ci, 95_000 + ci, 0.32);
      return 'feature';
    }
  }
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) {
    world.floorTex[ci] = randomEnumValue(RANDOM_FLOOR_TEX);
    world.markFloorTexDirty(cellDirtyRect(ci));
    return 'floor_texture';
  }
  return '';
}

function mutateItemDropByMaronary(entity: Entity): string {
  const current = entity.inventory?.[0]?.defId;
  const nextId = randomItemIdDifferent(current);
  entity.inventory = [randomItemStack(nextId)];
  entity.sprite = Spr.ITEM_DROP;
  return nextId;
}

function mutateContainerByMaronary(world: World, ci: number): string {
  const x = ci % W;
  const y = (ci / W) | 0;
  const container = world.containersAt(x, y)[0];
  if (!container) return '';
  const current = container.inventory[0]?.defId;
  const nextId = randomItemIdDifferent(current);
  if (container.inventory.length === 0) container.inventory.push(randomItemStack(nextId));
  else container.inventory[0] = randomItemStack(nextId);
  container.name = `Маронарный ${container.name}`.slice(0, 96);
  container.discovered = true;
  if (!container.tags.includes('maronary_rewritten')) container.tags.push('maronary_rewritten');
  return nextId;
}

function notifySamosborFogEffect(state: GameState, variant: ActiveSamosborVariant, text: string): void {
  if (state.time < lastSamosborFogEffectNoticeAt + SAMOSBOR_FOG_EFFECT_NOTICE_INTERVAL) return;
  lastSamosborFogEffectNoticeAt = state.time;
  state.msgs.push(msg(text, state.time, variant.def.tint));
}

function applyMaronaryFogEffectAtCell(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  samosborCount: number,
  ci: number,
): boolean {
  const target = entityOnFogCell(world, entities, ci);
  let effect = '';
  let targetId: number | undefined;
  let targetName: string | undefined;
  if (target) {
    targetId = target.id;
    targetName = target.name;
    if (isPlayerEntity(target) || target.type === EntityType.NPC) {
      rewriteActorAsRandomNpc(state, target, variant);
      effect = isPlayerEntity(target) ? 'player_rewritten' : 'npc_rewritten';
      targetName = target.name;
    } else if (target.type === EntityType.MONSTER) {
      rewriteMonsterAsRandom(world, target, floor, samosborCount);
      effect = 'monster_rewritten';
      targetName = MONSTERS[target.monsterKind ?? MonsterKind.SBORKA]?.name;
    } else if (target.type === EntityType.ITEM_DROP) {
      const itemId = mutateItemDropByMaronary(target);
      effect = 'item_rewritten';
      targetName = ITEMS[itemId]?.name ?? itemId;
    }
  }
  if (!effect) {
    const itemId = mutateContainerByMaronary(world, ci);
    if (itemId) {
      effect = 'container_item_rewritten';
      targetName = ITEMS[itemId]?.name ?? itemId;
    }
  }
  if (!effect) effect = mutateWorldCellByMaronary(world, ci);
  if (!effect) return false;
  const x = ci % W;
  const y = (ci / W) | 0;
  notifySamosborFogEffect(state, variant, 'Маронарий заменил анкету вещи в зелёном тумане. Проверь имя, лут и карту.');
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: world.zoneMap[ci],
    x,
    y,
    targetId,
    targetName,
    severity: effect === 'player_rewritten' ? 5 : 4,
    privacy: effect === 'player_rewritten' ? 'private' : 'local',
    tags: ['samosbor', 'fog_effect', 'maronary', 'rewrite', `samosbor_${variant.def.id}`],
    data: { effect, fog: world.fog[ci] },
  });
  return true;
}

function removeContainerAt(world: World, ci: number): WorldContainer | null {
  const container = world.containersAt(ci % W, (ci / W) | 0)[0];
  if (!container) return null;
  const idx = world.containers.indexOf(container);
  if (idx >= 0) world.containers.splice(idx, 1);
  world.rebuildContainerMap();
  return container;
}

function whitenDeletedCell(world: World, ci: number): string {
  if (world.aptMask[ci] || world.hermoWall[ci] || world.cells[ci] === Cell.LIFT) return '';
  const oldCell = world.cells[ci];
  const rect = cellDirtyRect(ci);
  if (oldCell === Cell.DOOR) world.removeDoorAt(ci);
  if (oldCell === Cell.WALL || oldCell === Cell.DOOR || oldCell === Cell.FLOOR || oldCell === Cell.WATER) {
    world.cells[ci] = Cell.FLOOR;
    world.roomMap[ci] = -1;
    world.setFeatureAt(ci, Feature.NONE, true, rect);
    world.floorTex[ci] = Tex.F_MARBLE_TILE;
    world.markCellsDirty(rect);
    world.markFloorTexDirty(rect);
    stampMark(world, ci % W, (ci / W) | 0, 0.5, 0.5, 0.46, MarkType.SPLAT, 96_000 + ci, 244, 241, 223, 155);
    return oldCell === Cell.WALL ? 'wall_deleted' : oldCell === Cell.DOOR ? 'door_deleted' : 'cell_whitened';
  }
  return '';
}

function applyVeretarFogEffectAtCell(
  world: World,
  entities: Entity[],
  state: GameState,
  variant: ActiveSamosborVariant,
  ci: number,
): boolean {
  const target = entityOnFogCell(world, entities, ci);
  let effect = '';
  let targetId: number | undefined;
  let targetName: string | undefined;
  if (target) {
    targetId = target.id;
    targetName = target.name;
    if (isPlayerEntity(target)) {
      const damage = Math.max(9999, target.hp ?? target.maxHp ?? 100);
      target.hp = 0;
      target.alive = false;
      recordPlayerDamage(state, undefined, damage, 'Веретар: белый свет удалил игрока', 'samosbor');
      state.dmgFlash = 1;
      state.dmgSeed = (state.dmgSeed + 101) | 0;
      effect = 'player_deleted';
    } else {
      if (target.type === EntityType.NPC) recordAlifeNpcDeath(state, target);
      target.hp = 0;
      target.alive = false;
      effect = target.type === EntityType.NPC ? 'npc_deleted' : target.type === EntityType.MONSTER ? 'monster_deleted' : 'item_deleted';
    }
  }
  if (!effect) {
    const container = removeContainerAt(world, ci);
    if (container) {
      effect = 'container_deleted';
      targetName = container.name;
    }
  }
  if (!effect) {
    const wallCi = findAdjacentWall(world, ci);
    effect = wallCi >= 0 && Math.random() < 0.55 ? whitenDeletedCell(world, wallCi) : whitenDeletedCell(world, ci);
  }
  if (!effect) return false;
  const x = ci % W;
  const y = (ci / W) | 0;
  notifySamosborFogEffect(state, variant, 'Веретар вырезал кусок мира белым светом. Там больше нечего подбирать.');
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: world.zoneMap[ci],
    x,
    y,
    targetId,
    targetName,
    severity: effect === 'player_deleted' ? 5 : 4,
    privacy: effect === 'player_deleted' ? 'private' : 'local',
    tags: ['samosbor', 'fog_effect', 'veretar', 'delete', `samosbor_${variant.def.id}`],
    data: { effect, fog: world.fog[ci] },
  });
  return true;
}

function healActorByIstotit(state: GameState, entity: Entity, variant: ActiveSamosborVariant): boolean {
  const maxHp = entity.maxHp ?? (entity.rpg ? getMaxHp(entity.rpg) : 100);
  const before = entity.hp ?? maxHp;
  entity.maxHp = maxHp;
  entity.hp = Math.min(maxHp, before + Math.max(8, Math.round(maxHp * 0.18)));
  if (entity.needs) {
    entity.needs.food = Math.min(100, entity.needs.food + 8);
    entity.needs.water = Math.min(100, entity.needs.water + 8);
    entity.needs.sleep = Math.min(100, entity.needs.sleep + 6);
  }
  if (entity.rpg) entity.rpg.psi = Math.min(entity.rpg.maxPsi, entity.rpg.psi + 8);
  notifySamosborFogEffect(state, variant, 'Истотит подлечил живое в золотом тумане. Созидание не выбирает сторону.');
  return (entity.hp ?? before) > before;
}

function createIstotitThingAtCell(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  floor: FloorLevel,
  samosborCount: number,
  ci: number,
): string {
  if (world.cells[ci] !== Cell.FLOOR || world.aptMask[ci]) return '';
  const x = ci % W;
  const y = (ci / W) | 0;
  const roll = Math.random();
  if (roll < 0.32 && canSpawnEntityType(entities, EntityType.ITEM_DROP)) {
    const itemId = randomItemIdDifferent();
    entities.push({
      id: nextId.v++,
      type: EntityType.ITEM_DROP,
      x: x + 0.5,
      y: y + 0.5,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [randomItemStack(itemId)],
    });
    return 'item_created';
  }
  if (roll < 0.58 && canSpawnEntityType(entities, EntityType.MONSTER)) {
    const kind = randomMonsterKindWeighted(floor, samosborCount);
    entities.push(createMonster(world, nextId, kind, x + 0.5, y + 0.5, floor, true));
    return 'monster_created';
  }
  if (roll < 0.76 && canSpawnEntityType(entities, EntityType.NPC)) {
    const faction = randomEnumValue(RANDOM_NPC_FACTIONS);
    const occupation = randomEnumValue(RANDOM_NPC_OCCUPATIONS);
    const named = randomName(faction);
    const rpg = randomRPG(randomNpcLevel());
    const maxHp = getMaxHp(rpg);
    const loadout = randomNpcInventory(faction, rpg.level);
    const entity: Entity = {
      id: nextId.v++,
      type: EntityType.NPC,
      x: x + 0.5,
      y: y + 0.5,
      angle: Math.random() * Math.PI * 2,
      pitch: 0,
      alive: true,
      speed: 1.2,
      sprite: occupation,
      spriteSeed: Math.floor(Math.random() * 0x7fffffff) + 1,
      name: named.name,
      firstName: named.firstName,
      lastName: named.lastName,
      isFemale: named.female,
      faction,
      occupation,
      needs: freshNeeds(),
      hp: maxHp,
      maxHp,
      ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
      inventory: loadout.inventory,
      weapon: loadout.weapon,
      tool: loadout.tool,
      rpg,
      questId: -1,
      canGiveQuest: Math.random() < 0.10,
      familyId: Math.floor(secureRandom() * 1_000_000_000),
      money: Math.floor(Math.random() * (40 + rpg.level * 8)),
    };
    // Истотит is the diegetic non-natural human creation path; the new body
    // must still receive a persistent A-Life identity before it can remain.
    if (!assignPersistentAlifeNpcFromEntity(state, entity, entities)) return '';
    entities.push(entity);
    return 'npc_created';
  }
  if (roll < 0.9) {
    if (world.setFeatureAt(ci, randomEnumValue(RANDOM_FEATURES), true, cellDirtyRect(ci))) return 'feature_created';
  }
  world.floorTex[ci] = randomEnumValue(RANDOM_FLOOR_TEX);
  world.markFloorTexDirty(cellDirtyRect(ci));
  return 'floor_reseeded';
}

function applyIstotitFogEffectAtCell(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  samosborCount: number,
  ci: number,
): boolean {
  const target = entityOnFogCell(world, entities, ci);
  let effect = '';
  let targetId: number | undefined;
  let targetName: string | undefined;
  if (target && (isPlayerEntity(target) || target.type === EntityType.NPC || target.type === EntityType.MONSTER)) {
    healActorByIstotit(state, target, variant);
    effect = target.type === EntityType.MONSTER ? 'monster_healed' : isPlayerEntity(target) ? 'player_healed' : 'npc_healed';
    targetId = target.id;
    targetName = target.name ?? (target.monsterKind !== undefined ? MONSTERS[target.monsterKind]?.name : undefined);
  } else {
    effect = createIstotitThingAtCell(world, entities, state, nextId, floor, samosborCount, ci);
  }
  if (!effect) return false;
  const x = ci % W;
  const y = (ci / W) | 0;
  notifySamosborFogEffect(state, variant, 'Истотит создал что-то в золотом тумане. Проверь, полезное оно или голодное.');
  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: world.zoneMap[ci],
    x,
    y,
    targetId,
    targetName,
    severity: effect.includes('created') ? 4 : 3,
    privacy: 'local',
    tags: ['samosbor', 'fog_effect', 'istotit', 'create', `samosbor_${variant.def.id}`],
    data: {
      effect,
      fog: world.fog[ci],
      ...(effect === 'npc_created' ? { reason: 'samosbor', intent: 'istotit_creation' } : {}),
    },
  });
  return true;
}

function spawnOneFogMonsterAtCell(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  ci: number,
): boolean {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return false;
  if (world.cells[ci] !== Cell.FLOOR || world.aptMask[ci]) return false;
  const kind = variant.extraEyes > 0 && Math.random() < 0.25
    ? MonsterKind.EYE
    : pickMonsterKindForWave(floor, samosborCount);
  entities.push(createMonster(world, nextId, kind, (ci % W) + 0.5, ((ci / W) | 0) + 0.5, floor));
  return true;
}

function applyWetFogEffectAtCell(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  ci: number,
): boolean {
  if (world.aptMask[ci]) return false;
  const currentCell = world.cells[ci];
  if (currentCell !== Cell.FLOOR && currentCell !== Cell.WATER) return false;

  const rand = xorshift32((nextId.v + ci) ^ samosborCount);

  // Wet samosbor converts some floor to water
  if (currentCell === Cell.FLOOR && rand() < 0.15) {
    world.cells[ci] = Cell.WATER;
    world.markCellsDirty(cellDirtyRect(ci));
    return true; // We performed a world alteration
  }

  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return false;

  const isWater = world.cells[ci] === Cell.WATER;
  // If it's water, very high chance to spawn fog shark. If floor, moderate chance.
  let kind: MonsterKind;
  if (isWater && rand() < 0.8) {
    kind = MonsterKind.FOG_SHARK;
  } else if (!isWater && rand() < 0.4) {
    kind = MonsterKind.FOG_SHARK;
  } else if (variant.extraEyes > 0 && rand() < 0.25) {
    kind = MonsterKind.EYE;
  } else {
    kind = pickMonsterKindForWave(floor, samosborCount);
  }

  entities.push(createMonster(world, nextId, kind, (ci % W) + 0.5, ((ci / W) | 0) + 0.5, floor));
  return true;
}

function applySamosborFogEffectAtCell(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  ci: number,
): boolean {
  if (world.fog[ci] <= 100) return false;
  if (hasSamosborSubsystem(variant, 'fog_rewrite')) return applyMaronaryFogEffectAtCell(world, entities, state, variant, floor, samosborCount, ci);
  if (hasSamosborSubsystem(variant, 'fog_delete')) return applyVeretarFogEffectAtCell(world, entities, state, variant, ci);
  if (hasSamosborSubsystem(variant, 'fog_create')) return applyIstotitFogEffectAtCell(world, entities, state, nextId, variant, floor, samosborCount, ci);
  if (hasSamosborSubsystem(variant, 'wet_spawn_shark')) return applyWetFogEffectAtCell(world, entities, nextId, samosborCount, variant, floor, ci);
  return spawnOneFogMonsterAtCell(world, entities, nextId, samosborCount, variant, floor, ci);
}

export function applySamosborFogEffectAtCellForTests(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
  ci: number,
): boolean {
  return applySamosborFogEffectAtCell(world, entities, state, nextId, samosborCount, variant, floor, ci);
}

function pushVeretarLeakCandidate(
  world: World,
  out: RankedCellCandidate[],
  seen: Set<number>,
  ci: number,
  cx: number,
  cy: number,
  maxRadius: number,
  priority: number,
): void {
  if (world.aptMask[ci]) return;
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) return;
  pushRankedCellCandidate(world, out, seen, ci, cx, cy, maxRadius, priority);
}

function pushVeretarLeakFloorNear(
  world: World,
  out: RankedCellCandidate[],
  seen: Set<number>,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  maxRadius: number,
  priority: number,
): void {
  pushVeretarLeakCandidate(world, out, seen, world.idx(sx, sy), cx, cy, maxRadius, priority);
  for (let i = 0; i < FOG_DIRS_X.length; i++) {
    const x = world.wrap(sx + FOG_DIRS_X[i]);
    const y = world.wrap(sy + FOG_DIRS_Y[i]);
    pushVeretarLeakCandidate(world, out, seen, world.idx(x, y), cx, cy, maxRadius, priority);
  }
}

function collectVeretarLeakCandidates(world: World, cx: number, cy: number, maxRadius: number): number[] {
  const out: RankedCellCandidate[] = [];
  const seen = new Set<number>();
  for (const [ci] of world.doors) {
    pushVeretarLeakCandidate(world, out, seen, ci, cx, cy, maxRadius, 0);
  }

  for (const ci of world.screenCells) {
    const sx = ci % W;
    const sy = (ci / W) | 0;
    pushVeretarLeakFloorNear(world, out, seen, sx, sy, cx, cy, maxRadius, 1);
  }

  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      if (dx * dx + dy * dy > maxRadius * maxRadius) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.features[ci] === Feature.SCREEN || world.features[ci] === Feature.LIFT_BUTTON) {
        pushVeretarLeakFloorNear(world, out, seen, x, y, cx, cy, maxRadius, 2);
      }
    }
  }

  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      if (dx * dx + dy * dy > maxRadius * maxRadius) continue;
      const x = world.wrap(cx + dx);
      const y = world.wrap(cy + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.aptMask[ci]) continue;
      for (let i = 0; i < FOG_DIRS_X.length; i++) {
        const ni = world.idx(world.wrap(x + FOG_DIRS_X[i]), world.wrap(y + FOG_DIRS_Y[i]));
        if (world.cells[ni] === Cell.WALL) {
          pushVeretarLeakCandidate(world, out, seen, ci, cx, cy, maxRadius, 3);
          break;
        }
      }
    }
  }

  return out
    .sort(compareRankedCellCandidates)
    .slice(0, 64)
    .map(candidate => candidate.idx);
}

/* ── Spawn monsters in corridors ──────────────────────────────── */
function spawnMonsters(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
): void {
  const corridorCells: number[] = [];
  for (let i = 0; i < 5000; i++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] < 0) {
      corridorCells.push(ci);
    }
  }

  const count = Math.max(1, Math.round((MONSTERS_PER_SAMOSBOR + Math.floor(samosborCount * 1.5)) * variant.spawnMult));
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, count);
  for (let i = 0; i < slots && corridorCells.length > 0; i++) {
    const ci = corridorCells.splice(Math.floor(Math.random() * corridorCells.length), 1)[0];
    const kind = pickMonsterKindForWave(floor, samosborCount);
    entities.push(createMonster(world, nextId, kind, (ci % W) + 0.5, Math.floor(ci / W) + 0.5, floor));
  }
}

/* ── Spawn an extra map-wide monster pulse ───────────────────── */
function spawnRandomMapMonsters(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
): void {
  const target = Math.max(1, Math.round(RANDOM_MAP_MONSTERS_PER_SAMOSBOR * variant.spawnMult));
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, target);
  if (slots <= 0) return;
  let spawned = 0;

  for (let attempt = 0; attempt < 5000 && spawned < slots; attempt++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.cells[ci] !== Cell.FLOOR) continue;
    const x = ci % W;
    const y = (ci / W) | 0;
    // Skip apartment rooms
    const rid = world.roomMap[ci];
    if (rid >= 0 && rid < world.apartmentRoomCount) continue;

    const kind = pickMonsterKindForWave(floor, samosborCount);
    entities.push(createMonster(world, nextId, kind, x + 0.5, y + 0.5, floor));
    spawned++;
  }
}

const samosborPlayerPressurePreferredCells: number[] = [];
const samosborPlayerPressureFallbackCells: number[] = [];
const samosborPlayerPressureOccupants: Entity[] = [];

function isPlayerInAcceptedSamosborShelter(world: World, state: GameState, player: Entity): boolean {
  const room = world.roomAt(player.x, player.y);
  if (!room || !room.sealed) return false;
  if (room.id === samosborPlayerShelterRoomId) return true;
  return getSamosborShelterRoomIds(state).includes(room.id);
}

function samosborDirectLineBlocked(world: World, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = world.wrap(Math.floor(ax + dx * t));
    const y = world.wrap(Math.floor(ay + dy * t));
    if (world.solid(x, y)) return true;
  }
  return false;
}

function samosborCellInPlayerFrontCone(world: World, player: Entity, x: number, y: number): boolean {
  const dx = world.delta(player.x, x + 0.5);
  const dy = world.delta(player.y, y + 0.5);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 0.001) return true;
  const dot = (Math.cos(player.angle) * dx + Math.sin(player.angle) * dy) / len;
  return dot > 0.45;
}

function collectSamosborPlayerPressureCells(world: World, player: Entity): number[] {
  samosborPlayerPressurePreferredCells.length = 0;
  samosborPlayerPressureFallbackCells.length = 0;
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const playerRoomId = world.roomAt(player.x, player.y)?.id ?? -1;
  const minSq = SAMOSBOR_PLAYER_PRESSURE_MIN_RADIUS * SAMOSBOR_PLAYER_PRESSURE_MIN_RADIUS;
  const maxSq = SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS * SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS;

  for (let dy = -SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS; dy <= SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS; dy++) {
    for (let dx = -SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS; dx <= SAMOSBOR_PLAYER_PRESSURE_MAX_RADIUS; dx++) {
      const dSqGrid = dx * dx + dy * dy;
      if (dSqGrid < minSq || dSqGrid > maxSq) continue;
      const x = world.wrap(px + dx);
      const y = world.wrap(py + dy);
      const ci = world.idx(x, y);
      if (world.cells[ci] !== Cell.FLOOR || world.aptMask[ci] || world.hermoWall[ci]) continue;
      const roomId = world.roomMap[ci];
      if (roomId >= 0 && roomId < world.apartmentRoomCount) continue;
      const dSq = world.dist2(player.x, player.y, x + 0.5, y + 0.5);
      if (dSq < minSq || dSq > maxSq) continue;

      const blocked = samosborDirectLineBlocked(world, player.x, player.y, x + 0.5, y + 0.5);
      if (blocked) {
        samosborPlayerPressurePreferredCells.push(ci);
        continue;
      }
      const differentRoom = playerRoomId >= 0 && roomId >= 0 && roomId !== playerRoomId;
      if (differentRoom || !samosborCellInPlayerFrontCone(world, player, x, y)) {
        samosborPlayerPressureFallbackCells.push(ci);
      }
    }
  }

  return samosborPlayerPressurePreferredCells.length > 0
    ? samosborPlayerPressurePreferredCells
    : samosborPlayerPressureFallbackCells;
}

function samosborPressureCellOccupied(entities: Entity[], ci: number): boolean {
  const x = (ci % W) + 0.5;
  const y = ((ci / W) | 0) + 0.5;
  ensureEntityIndex(entities).queryRadiusCapped(
    x,
    y,
    1.2,
    samosborPlayerPressureOccupants,
    ENTITY_MASK_ACTOR,
    1,
  );
  return samosborPlayerPressureOccupants.length > 0;
}

function pickSamosborPlayerPressureCell(world: World, entities: Entity[], player: Entity): number {
  const pool = collectSamosborPlayerPressureCells(world, player);
  for (let attempt = 0; attempt < SAMOSBOR_PLAYER_PRESSURE_PICK_ATTEMPTS && pool.length > 0; attempt++) {
    const poolIdx = Math.floor(Math.random() * pool.length);
    const ci = pool[poolIdx];
    if (samosborPressureCellOccupied(entities, ci)) {
      pool[poolIdx] = pool[pool.length - 1];
      pool.pop();
      continue;
    }
    return ci;
  }
  return -1;
}

function armSamosborPressureMonster(world: World, monster: Entity, player: Entity): void {
  const tx = world.wrap(Math.floor(player.x));
  const ty = world.wrap(Math.floor(player.y));
  monster.ai = monster.ai ?? { goal: AIGoal.HUNT, tx, ty, path: [], pi: 0, stuck: 0, timer: 0 };
  monster.ai.goal = AIGoal.HUNT;
  monster.ai.combatTargetId = player.id;
  monster.ai.tx = tx;
  monster.ai.ty = ty;
  monster.ai.path = [];
  monster.ai.pi = 0;
  monster.ai.stuck = 0;
  monster.ai.timer = 0;
  tryAssignPathToCell(world, monster, tx, ty);
}

function spawnSamosborPlayerPressureMonster(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
): boolean {
  if (!state.samosborActive || !canSpawnEntityType(entities, EntityType.MONSTER)) return false;
  const player = findPlayer(entities);
  if (!player || isPlayerInAcceptedSamosborShelter(world, state, player)) return false;

  const ci = pickSamosborPlayerPressureCell(world, entities, player);
  if (ci < 0) return false;

  const kind = variant.extraEyes > 0 && Math.random() < 0.25
    ? MonsterKind.EYE
    : pickMonsterKindForWave(floor, state.samosborCount);
  const x = (ci % W) + 0.5;
  const y = ((ci / W) | 0) + 0.5;
  const monster = createMonster(world, nextId, kind, x, y, floor);
  const playerLevel = Math.max(1, Math.floor(player.rpg?.level ?? 1));
  const minMonsterLevel = playerLevel + 1;
  const raised = raiseMonsterToAtLeastLevel(monster, kind, minMonsterLevel);
  armSamosborPressureMonster(world, monster, player);
  entities.push(monster);

  publishEvent(state, {
    type: 'samosbor_warning',
    zoneId: world.zoneMap[ci] >= 0 ? world.zoneMap[ci] : undefined,
    roomId: world.roomMap[ci] >= 0 ? world.roomMap[ci] : undefined,
    x,
    y,
    actorId: monster.id,
    actorName: MONSTERS[kind]?.name,
    targetId: player.id,
    targetName: player.name ?? 'Вы',
    targetFaction: player.faction,
    monsterKind: kind,
    severity: 4,
    privacy: 'local',
    tags: ['samosbor', 'player_pressure', 'spawn', 'target_player', `samosbor_${variant.def.id}`],
    data: {
      playerLevel,
      monsterLevel: monster.rpg?.level,
      minMonsterLevel,
      raised,
      distance: Math.round(Math.sqrt(world.dist2(player.x, player.y, x, y))),
      variantId: variant.def.id,
    },
  });
  return true;
}

export function spawnSamosborPlayerPressureMonsterForTests(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
): boolean {
  return spawnSamosborPlayerPressureMonster(world, entities, state, nextId, variant, floor);
}

function stampVeretarAreaLeak(world: World, cx: number, cy: number, radius: number): number {
  let placed = 0;
  let fogDirty = false;
  const fogRects: WorldGridDirtyRect[] = [];
  const target = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.18 ? 1 : 0);
  const maxRadius = Math.max(4, radius + 4);
  const candidates = collectVeretarLeakCandidates(world, cx, cy, maxRadius);
  for (let attempt = 0; attempt < 96 && placed < target; attempt++) {
    let ci: number;
    if (candidates.length > 0) {
      const idx = Math.floor(Math.random() * candidates.length);
      ci = candidates[idx];
      const last = candidates.length - 1;
      if (idx !== last) {
        candidates[idx] = candidates[last];
      }
      candidates.pop();
    } else {
      ci = world.idx(world.wrap(cx + rng(-maxRadius, maxRadius)), world.wrap(cy + rng(-maxRadius, maxRadius)));
    }
    const x = ci % W;
    const y = (ci / W) | 0;
    if (world.aptMask[ci]) continue;
    if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.DOOR) continue;
    const seed = 91_000 + ci + placed * 977;
    stampMark(world, x, y, Math.random(), Math.random(), 0.44 + Math.random() * 0.24, MarkType.SPLAT, seed, 244, 241, 223, 150);
    const door = world.doors.get(ci);
    if (door) {
      if (door.state === DoorState.CLOSED) setDoorState(world, door, DoorState.OPEN);
      if (door.state === DoorState.OPEN || door.state === DoorState.HERMETIC_OPEN) door.timer = Math.max(door.timer, 22);
    }
    if (world.fog[ci] < 150) {
      world.fog[ci] = 150;
      fogDirty = true;
      pushCellDirtyRect(fogRects, ci);
    }
    placed++;
  }
  if (fogDirty) world.markFogDirty(fogRects);
  lastVeretarAreaLeaks = placed;
  lastVeretarAreaLeakAt = knownSamosborTime;
  return placed;
}

function restoreCapturedSamosborZone(world: World): void {
  if (activeSamosborZoneId < 0 || activeSamosborPreviousZoneFaction === null) return;
  const zone = world.zones[activeSamosborZoneId];
  if (!zone) return;
  for (const cell of activeSamosborPreviousTerritory) {
    if (territoryOwnerAtIndex(world, cell.idx) === ZoneFaction.SAMOSBOR) setTerritoryOwnerAtIndex(world, cell.idx, cell.owner);
  }
  zone.fogged = activeSamosborPreviousZoneFogged;
  syncZoneMetadataFromTerritory(world, [zone.id]);
  activeSamosborPreviousZoneFaction = null;
  activeSamosborPreviousTerritory = [];
  activeSamosborPreviousZoneFogged = false;
}

function captureSamosborTerritory(world: World, zoneId: number): number {
  activeSamosborPreviousTerritory = [];
  let changed = 0;
  for (let i = 0; i < W * W; i++) {
    if (world.zoneMap[i] !== zoneId) continue;
    const owner = territoryOwnerAtIndex(world, i);
    if (owner === ZoneFaction.SAMOSBOR) continue;
    activeSamosborPreviousTerritory.push({ idx: i, owner });
    if (setTerritoryOwnerAtIndex(world, i, ZoneFaction.SAMOSBOR)) changed++;
  }
  if (changed > 0) syncZoneMetadataFromTerritory(world, [zoneId]);
  return changed;
}

/* ── Capture warned zone with фиолетовый туман ───────────────── */
function captureZone(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  state: GameState,
  variant: ActiveSamosborVariant,
  preferredZoneId = -1,
  preferredX?: number,
  preferredY?: number,
  warningGreenSourceCount = 0,
  warningWrongDoorIdx = -1,
): number {
  const preferredZone = preferredZoneId >= 0 ? world.zones[preferredZoneId] : undefined;
  const candidates = world.zones.filter(z => territoryOwnerAt(world, z.cx, z.cy) !== ZoneFaction.SAMOSBOR);
  if (candidates.length === 0) return -1;

  const zone = preferredZone && territoryOwnerAt(world, preferredZone.cx, preferredZone.cy) !== ZoneFaction.SAMOSBOR
    ? preferredZone
    : candidates[Math.floor(Math.random() * candidates.length)];
  const sourceX = Number.isFinite(preferredX) ? world.wrap(Math.floor(preferredX as number)) : zone.cx;
  const sourceY = Number.isFinite(preferredY) ? world.wrap(Math.floor(preferredY as number)) : zone.cy;
  const previousFaction = territoryOwnerAt(world, sourceX, sourceY);
  activeSamosborPreviousZoneFaction = previousFaction;
  activeSamosborPreviousZoneFogged = zone.fogged;
  zone.fogged = true;
  const capturedCells = captureSamosborTerritory(world, zone.id);
  const istotit = isIstotit(variant);
  const maronary = isMaronary(variant);

  // Seed fog/light at the random local source point inside the captured zone.
  const ci = world.idx(sourceX, sourceY);
  let fogDirty = false;
  let wallDirty = false;
  let floorDirty = false;
  if (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR) {
    if (world.fog[ci] !== 255) {
      world.fog[ci] = 255;
      fogDirty = true;
    }
  }
  // Seed fog in a small radius around the source. Variant multiplier changes only this bounded seed.
  const fogRadius = Math.max(2, Math.min(7, Math.round(5 * Math.sqrt(variant.fogSeedMult))));
  const fogSeedRects = squareDirtyRects(sourceX, sourceY, fogRadius);
  const fogRadiusSq = fogRadius * fogRadius;
  const fogStrength = Math.max(90, Math.min(230, Math.round(200 * variant.fogSeedMult)));
  const markHellMeat = state.currentFloor === FloorLevel.HELL &&
    (hasSamosborSubsystem(variant, 'hell_meat_walls') || variant.modifiers.some(m => m.meatWallsOnHell));
  let veretarAreaLeaks = 0;
  for (let dy = -fogRadius; dy <= fogRadius; dy++) {
    for (let dx = -fogRadius; dx <= fogRadius; dx++) {
      if (dx * dx + dy * dy > fogRadiusSq) continue;
      const fi = world.idx(sourceX + dx, sourceY + dy);
      if (world.cells[fi] === Cell.FLOOR) {
        if (world.fog[fi] !== fogStrength) {
          world.fog[fi] = fogStrength;
          fogDirty = true;
        }
        if (markHellMeat) {
          if (world.floorTex[fi] !== Tex.F_MEAT) {
            world.floorTex[fi] = Tex.F_MEAT;
            floorDirty = true;
          }
        }
      } else if (markHellMeat && world.cells[fi] === Cell.WALL) {
        if (world.wallTex[fi] !== Tex.MEAT) {
          world.wallTex[fi] = Tex.MEAT;
          wallDirty = true;
        }
      }
    }
  }
  if (hasSamosborSubsystem(variant, 'veretar_area_leak') || variant.modifiers.some(m => m.id === 'area_leak')) {
    veretarAreaLeaks = stampVeretarAreaLeak(world, sourceX, sourceY, fogRadius);
  }
  if (fogDirty) world.markFogDirty(fogSeedRects);
  if (wallDirty) world.markWallTexDirty(fogSeedRects);
  if (floorDirty) world.markFloorTexDirty(fogSeedRects);

  // Spawn fog boss at the source point (10% chance Матка, otherwise random boss)
  const isMatka = Math.random() < 0.1;
  const bossKind = istotit ? MonsterKind.EYE : isMatka ? MonsterKind.MATKA :
    [MonsterKind.BETONNIK, MonsterKind.REBAR, MonsterKind.NIGHTMARE][Math.floor(Math.random() * 3)];
  const bossDef = MONSTERS[bossKind];
  const zoneLevel = zone.level ?? 1;
  const rpg = randomRPG(zoneLevel + 3); // boss is stronger
  const hpBase = scaleMonsterHp(bossDef.hp, zoneLevel + 3);
  const hpFinal = Math.round(hpBase * (1 + 0.1 * rpg.str) * (istotit ? 1.35 : 2)); // lighter boss during Istotit
  // Find a walkable cell near the source point for boss spawn.
  let bx = sourceX, by = sourceY;
  for (let r = 0; r < 10; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const bi = world.idx(sourceX + dx, sourceY + dy);
        if (world.cells[bi] === Cell.FLOOR) { bx = world.wrap(sourceX + dx); by = world.wrap(sourceY + dy); r = 99; break; }
      }
      if (r >= 99) break;
    }
  }
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return zone.id;
  const bossId = nextId.v++;
  const boss: Entity = {
    id: bossId,
    type: EntityType.MONSTER,
    x: bx + 0.5, y: by + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(bossDef.speed, zoneLevel),
    sprite: bossDef.sprite,
    spriteScale: 1.5,

    hp: hpFinal,
    maxHp: hpFinal,
    monsterKind: bossKind,
    attackCd: bossDef.attackRate,
    ai: { goal: AIGoal.HUNT, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg,
    isFogBoss: true,
    fogBossZone: zone.id,
  };
  entities.push(boss);

  const extraEyeSlots = entitySpawnSlots(entities, EntityType.MONSTER, variant.extraEyes);
  for (let i = 0; i < extraEyeSlots; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ex = world.wrap(sourceX + rng(-8, 8));
      const ey = world.wrap(sourceY + rng(-8, 8));
      const ei = world.idx(ex, ey);
      if (world.cells[ei] !== Cell.FLOOR) continue;
      entities.push(createMonster(world, nextId, MonsterKind.EYE, ex + 0.5, ey + 0.5, state.currentFloor, true));
      break;
    }
  }

  const zoneLine = istotit
    ? `Зона ${zone.id + 1}: Истотит держит жёлтые гермы. Двери не трогать.`
    : maronary
      ? `Зона ${zone.id + 1}: Маронарий. Зелёный источник и повтор двери на карте.`
    : isVeretar(variant)
      ? `Зона ${zone.id + 1}: ${variant.def.displayName}. Белое пятно лезет через окно.`
    : `Зона ${zone.id + 1}: ${variant.def.displayName}. Туман пошёл по щелям.`;
  state.msgs.push(msg(zoneLine, state.time, variant.def.tint));
  publishEvent(state, {
    type: 'samosbor_zone_captured',
    zoneId: zone.id,
    x: sourceX,
    y: sourceY,
    severity: 5,
    privacy: 'public',
    tags: [
      ...samosborEventTags(variant, ['samosbor', 'zone', 'fog', 'danger'], warningWrongDoorIdx >= 0),
      ...(veretarAreaLeaks > 0 ? ['area_leak'] : []),
    ].slice(0, 8),
    data: {
      previousFaction,
      newFaction: ZoneFaction.SAMOSBOR,
      zoneLevel,
      variantId: variant.def.id,
      areaLeaks: veretarAreaLeaks,
      capturedCells,
      sourceX,
      sourceY,
      greenSourceCount: warningGreenSourceCount,
      wrongDoorIdx: warningWrongDoorIdx >= 0 ? warningWrongDoorIdx : undefined,
    },
  });
  const bossLine = istotit
    ? `Глаз ведомости открылся в зоне ${zone.id + 1}. Убейте его, чтобы туман отпустил герму.`
    : maronary
      ? `Маронарий вывел крупную тварь в зоне ${zone.id + 1}. Убейте её или уходите от повторённой двери.`
    : isVeretar(variant)
      ? `Тварь у белого окна появилась в зоне ${zone.id + 1}. Убейте её, чтобы проход не ушёл в пятно.`
    : `Крупная тварь вышла из тумана в зоне ${zone.id + 1}. Убейте её или уходите за герму.`;
  state.msgs.push(msg(bossLine, state.time, istotit || maronary || isVeretar(variant) ? variant.def.tint : '#f4a'));
  publishEvent(state, {
    type: 'fog_boss_spawned',
    zoneId: zone.id,
    x: bx + 0.5,
    y: by + 0.5,
    targetId: bossId,
    targetName: MONSTERS[bossKind]?.name ?? 'Босс тумана',
    monsterKind: bossKind,
    severity: 4,
    privacy: 'public',
    tags: ['samosbor', 'fog', 'boss', `samosbor_${variant.def.id}`],
    data: { hp: hpFinal, zoneLevel, variantId: variant.def.id, bossTitle: istotit ? 'Глаз ведомости' : isVeretar(variant) ? 'Тварь у белого окна' : undefined },
  });
  return zone.id;
}

function trySpreadFogFromCell(world: World, ci: number, dirtyRects: WorldGridDirtyRect[]): boolean {
  if (world.fog[ci] < 50) return false;
  if (world.aptMask[ci] || world.hermoWall[ci]) return false;
  const fromCell = world.cells[ci];
  if (fromCell !== Cell.FLOOR && fromCell !== Cell.WATER) return false;
  let fogDirty = false;

  if (world.fog[ci] < 255) {
    world.fog[ci] = Math.min(255, world.fog[ci] + 2) as number;
    fogDirty = true;
    pushCellDirtyRect(dirtyRects, ci);
  }

  const dir = (Math.random() * 4) | 0;
  const dx = FOG_DIRS_X[dir];
  const dy = FOG_DIRS_Y[dir];
  const x = ci % W;
  const y = (ci / W) | 0;
  const ni = world.idx(x + dx, y + dy);

  if (world.fog[ni] > 0) return fogDirty;
  if (world.aptMask[ni] || world.hermoWall[ni]) return fogDirty;
  if (world.cells[ni] === Cell.DOOR) return fogDirty;
  if (world.cells[ni] !== Cell.FLOOR && world.cells[ni] !== Cell.WATER) return fogDirty;

  world.fog[ni] = 128 + ((Math.random() * 127) | 0);
  pushCellDirtyRect(dirtyRects, ni);
  return true;
}

/* ── Spread fog one tick — cheap random-cell approach ────────── */
function spreadFog(world: World): void {
  const total = W * W;
  let fogDirty = false;
  const dirtyRects: WorldGridDirtyRect[] = [];

  for (let s = 0; s < FOG_SAMPLES_PER_TICK; s++) {
    fogDirty = trySpreadFogFromCell(world, (Math.random() * total) | 0, dirtyRects) || fogDirty;
  }
  if (fogDirty) world.markFogDirty(dirtyRects);
}

function randomTransferEntity(entities: Entity[]): Entity | null {
  if (entities.length === 0) return null;
  for (let attempt = 0; attempt < SAMOSBOR_RANDOM_ENTITY_TRANSFER_ENTITY_ATTEMPTS; attempt++) {
    const entity = entities[Math.floor(Math.random() * entities.length)];
    if (entity?.alive && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.BILLBOARD) return entity;
  }
  const start = Math.floor(Math.random() * entities.length);
  const limit = Math.min(entities.length, 512);
  for (let i = 0; i < limit; i++) {
    const entity = entities[(start + i) % entities.length];
    if (entity.alive && entity.type !== EntityType.PROJECTILE && entity.type !== EntityType.BILLBOARD) return entity;
  }
  return null;
}

function randomTransferCell(world: World): number {
  for (let attempt = 0; attempt < SAMOSBOR_RANDOM_ENTITY_TRANSFER_CELL_ATTEMPTS; attempt++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.aptMask[ci] || world.hermoWall[ci]) continue;
    const cell = world.cells[ci];
    if (cell === Cell.FLOOR || cell === Cell.WATER) return ci;
  }
  return -1;
}

function moveEntityToCell(entity: Entity, ci: number): void {
  entity.x = (ci % W) + 0.5;
  entity.y = ((ci / W) | 0) + 0.5;
  entity.angle = Math.random() * Math.PI * 2;
  if (entity.ai) {
    entity.ai.path = [];
    entity.ai.pi = 0;
    entity.ai.stuck = 0;
    entity.ai.tx = ci % W;
    entity.ai.ty = (ci / W) | 0;
  }
}

function tickRandomEntityTransfer(world: World, entities: Entity[], state: GameState, variant?: ActiveSamosborVariant): boolean {
  const entity = randomTransferEntity(entities);
  if (!entity) return false;
  const ci = randomTransferCell(world);
  if (ci < 0) return false;
  const fromX = Math.floor(entity.x);
  const fromY = Math.floor(entity.y);
  moveEntityToCell(entity, ci);
  rebuildEntityIndex(entities, 'manual');
  if (isPlayerEntity(entity)) {
    const toX = ci % W;
    const toY = (ci / W) | 0;
    state.msgs.push(msg('Самосбор переставил вас в другую точку карты.', state.time, variant?.def.tint ?? '#f4a'));
    publishEvent(state, {
      type: 'samosbor_warning',
      x: toX,
      y: toY,
      actorId: entity.id,
      actorName: entity.name ?? 'Вы',
      actorFaction: entity.faction,
      severity: 5,
      privacy: 'private',
      tags: ['samosbor', 'random_transfer', 'teleport', variant ? `samosbor_${variant.def.id}` : 'samosbor_unknown'],
      data: { fromX, fromY, toX, toY },
    });
  }
  return true;
}

export function tickRandomEntityTransferForTests(
  world: World,
  entities: Entity[],
  state: GameState,
  variant?: ActiveSamosborVariant,
): boolean {
  return tickRandomEntityTransfer(world, entities, state, variant);
}

/* ── Clear fog when fog boss is killed ────────────────────────── */
export function clearFogInZone(world: World, zoneId: number, msgs: Msg[], time: number, state?: GameState): void {
  const zone = world.zones[zoneId];
  if (!zone) return;
  zone.fogged = false;
  // Clear all fog cells belonging to this zone
  let fogDirty = false;
  const fogRects: WorldGridDirtyRect[] = [];
  for (let i = 0; i < W * W; i++) {
    if (world.zoneMap[i] === zoneId && world.fog[i] !== 0) {
      world.fog[i] = 0;
      fogDirty = true;
      pushCellDirtyRect(fogRects, i);
    }
  }
  if (fogDirty) world.markFogDirty(fogRects);
  msgs.push(msg(
    `Туман в зоне ${zoneId} ушёл. Ликвидаторы могут заходить.`,
    time, '#4f4',
  ));
  if (state) {
    publishEvent(state, {
      type: 'fog_boss_killed',
      zoneId,
      x: zone.cx,
      y: zone.cy,
      severity: 5,
      privacy: 'public',
      tags: ['samosbor', 'fog', 'boss', 'clear'],
    });
  }
}

/* ── Apply active samosbor effect in fogged areas ─────────────── */
let fogSpawnAccum = 0;
function tickSamosborFogEffects(
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  samosborCount: number,
  variant: ActiveSamosborVariant,
  floor: FloorLevel,
): void {
  for (let attempt = 0; attempt < SAMOSBOR_FOG_EFFECT_SEARCH_ATTEMPTS; attempt++) {
    const ci = Math.floor(Math.random() * W * W);
    if (world.fog[ci] <= 100) continue;
    const cell = world.cells[ci];
    if (cell !== Cell.FLOOR && cell !== Cell.WATER) continue;
    if (applySamosborFogEffectAtCell(world, entities, state, nextId, samosborCount, variant, floor, ci)) return;
  }
}
