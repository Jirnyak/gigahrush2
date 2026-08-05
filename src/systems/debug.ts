/* ── Debug menu: commands + overlay rendering ────────────────── */

import {
  W, Cell, Feature, RoomType, Faction, ZoneFaction, LiftDirection, FloorLevel,
  EntityType, MonsterKind, Occupation, AIGoal, ItemType,
  type Entity, type GameState, type ItemDef, type WorldContainer,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { freshNeeds, randomName, ITEMS } from '../data/catalog';
import { getStack } from '../data/items';
import { PSI_WEAPON_STATS } from '../data/psi';
import { getPermitDef, type PermitAccessTag } from '../data/permits';
import { FACTION_NAMES } from '../data/relations';
import { MONSTERS, monsterTypeName } from '../entities/monster';
import { monsterSpr, Spr } from '../render/sprite_index';
import { awardXP, randomRPG, getMaxHp } from './rpg';
import { isDebugNoClipEnabled, toggleDebugNoClip } from './psi';
import { cycleForcedSamosborVariant, forceNextSamosborVariant, getActiveSamosborVariant } from './samosbor_variants_runtime';
import {
  clearSamosborDirectorCooldowns,
  forceNextSamosborDirectorBeat,
  summarizeSamosborDirector,
} from './samosbor_director';
import { ensureWorldEventState, getImportantEvents, publishEvent, summarizeImportantEventsByFloorZone } from './events';
import { summarizeRoomMemoryForRoom } from './room_memory';
import { describeContainer, ensureRoomContainers, firstNearbyContainer, nearbyContainers, takeFromContainer } from './containers';
import { changeResourceStock, getAdjustedItemPrice, getResourceScarcity, summarizeEconomy } from './economy';
import { controlBindingLabel, menuCloseHint } from './controls';
import { tickProduction, summarizeProduction } from './production';
import { addItem, removeItem } from './inventory';
import { findActorPermit, recordPermitAccess, recordPermitExposure } from './permits';
import { publishMaronaryShavingAcquired } from './maronary_shaving';
import { spawnContract, spawnContractById, spawnGovnyakCourierContract, summarizeContracts } from './contracts';
import { debugForcePneumomailCapsule } from './pneumomail';
import { populationItemSummary } from './balance';
import { getSamosborDebugLines } from './samosbor';
import { territoryOwnerAtIndex } from './territory';
import { floorCatalogDebugLines } from './floor_catalog';
import { summarizeHeatline } from './heatline';
import { summarizeCarnivorousFungus } from './carnivorous_fungus';
import { summarizeHladonColdPockets } from './hladon';
import { ensureFloorInstanceState, floorInstanceIdentityLine, floorInstanceLabel, summarizeFloorInstances } from './floor_instances';
import {
  currentFloorRunEntry,
  floorRunEntryKind,
  floorRunEntryRouteId,
  resolveFloorRunRoute,
  summarizeFloorRun,
} from './procedural_floors';
import { summarizeProceduralSmog } from './procedural_anomalies';
import { debugSpawnBadAppleWorld, summarizeBadAppleWorld } from './procedural_anomalies/bad_apple_world';
import { debugForceVoidProtocol } from './void_protocols';
import { forceFactionEvent, summarizeFactionEvents } from './faction_events';
import { debugTriggerRouteCue, routeCueCount } from './route_cues';
import { debugCreateWrongDoorRemap } from './wrong_door';
import { debugForceHermodoorBorer } from './hermodoor_borer';
import { debugStartSamosborWaveAtPlayer } from './samosbor_wave';
import { debugForcePseudoliftNearPlayer, pseudoliftDebugSummary } from './pseudolift';
import { createSwarmSourceEntity, registerSwarmNestSource } from './swarm_nests';
import { DESIGN_FLOOR_ROUTES, type DesignFloorId } from '../data/design_floors';
import { FLOOR_INSTANCES } from '../data/floor_instances';
import { type FloorAnomalyId } from '../data/procedural_floors';
import { isDebugOnePunchManEnabled, keepDebugOnePunchManAlive, toggleDebugOnePunchMan } from './debug_cheats';
import { fitText } from '../render/ui_text';
import {
  grantNetTerminalGenAccess,
  placeNetTerminalGenTerminal,
  placeNetTerminalGenTerminalsForCurrentFloor,
  summarizeNetTerminalGen,
} from './net_terminal_gen';
import {
  clearCurrentMapEditorPatch,
  openMapEditor,
  replayMapEditorPatchForCurrentFloor,
  summarizeMapEditor,
} from './map_editor';
import { revealWholeMap } from './map_exploration';
import { getAiStats } from './ai';
import { canSpawnEntityType, entitySpawnSlots } from './entity_limits';
import { CHALK_ITEM_ID } from './chalk';
import { isPlayerEntity } from './player_actor';

/* ── Command execution ───────────────────────────────────────── */

const CATALOG_DEBUG_SEARCHES = ['', 'numbered', '404', 'school', 'hospital', 'market'];
const DEBUG_SAMOSBOR_WARNING_SECONDS = 12;
const DEBUG_MONSTER_SCAN_CAP = 192;
const DEBUG_CONTAINER_ROUTE_RADIUS = 2;
const EXPEDITION_PROOF_CONTRACT_ID = 'exp_maint_pressure_repair';
const DEBUG_ROUTE_FLOOD_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DEBUG_VERIFICATION_CONTRACT_IDS = [
  'exp_living_emergency_roster',
  'exp_ministry_safe_override',
  'exp_kvartiry_ration_stamp',
  'exp_maint_pressure_repair',
  'exp_hell_bottled_voice_retrieve',
  'exp_void_archive_warrant',
] as const;
const DEBUG_ECONOMY_PULSES = [
  { resourceId: 'drink_water', itemId: 'water', delta: -90, label: 'вода' },
  { resourceId: 'medicine', itemId: 'bandage', delta: -55, label: 'медицина' },
  { resourceId: 'ammo', itemId: 'ammo_9mm', delta: -65, label: 'патроны' },
] as const;
export const SMOKE_STRESS_HOOK_ID = 'stress_spawn' as const;
export const SMOKE_DEBUG_COMMAND_IDS = {
  teleportLiving: 'teleport_living',
  teleportMaintenance: 'teleport_maintenance',
  forceFactionEvent: 'force_faction_event',
  rareSamosbor: 'rare_samosbor',
  expeditionSetup: 'smoke_expedition_setup',
  expeditionProofPrep: 'expedition_proof_prep',
  expeditionProofLiftReady: 'expedition_proof_lift_ready',
  expeditionProofCollectorsArrival: 'expedition_proof_collectors_arrival',
  expeditionProofRisk: 'expedition_proof_risk',
  expeditionProofContainer: 'expedition_proof_container',
  expeditionProofSamosborWarning: 'expedition_proof_samosbor_warning',
  expeditionProofReturn: 'expedition_proof_return',
} as const;
const DEBUG_MONSTER_PACKS: Record<FloorLevel, readonly MonsterKind[]> = {
  [FloorLevel.MINISTRY]: [MonsterKind.PECHATEED, MonsterKind.KONTORSHCHIK, MonsterKind.PARAGRAPH, MonsterKind.PROTOKOLNIK, MonsterKind.SHOVNIK, MonsterKind.LAMPOGLAZ, MonsterKind.KANTSELYARSKIY_IDOL, MonsterKind.LOZHNYY_DUKH, MonsterKind.TONKAYA_TEN, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.HEAD_SLUG, MonsterKind.CHERVIE_AVATAR, MonsterKind.MUKHOZHUK_HOST, MonsterKind.BEZEKHIY, MonsterKind.SPORE_CARPET],
  [FloorLevel.KVARTIRY]: [MonsterKind.REBAR, MonsterKind.NELYUD, MonsterKind.KRYSNOZHKA, MonsterKind.POMOYNY_ROY, MonsterKind.GREEN_DOG, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.OBZHIVALSHCHIK, MonsterKind.ZHORNAYA_TVAR, MonsterKind.DIKIY_MERTVYAK, MonsterKind.HEAD_SLUG, MonsterKind.BEZEKHIY, MonsterKind.TRESKOTNIK, MonsterKind.GNILUSHKA, MonsterKind.SPORE_CARPET],
  [FloorLevel.LIVING]: [MonsterKind.SBORKA, MonsterKind.SHADOW, MonsterKind.NELYUD, MonsterKind.LAMPOGLAZ, MonsterKind.POMOYNY_ROY, MonsterKind.GREEN_DOG, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.BLACK_LIQUIDATOR, MonsterKind.OBZHIVALSHCHIK, MonsterKind.TUMANNIK, MonsterKind.FOG_SHARK, MonsterKind.ZHORNAYA_TVAR, MonsterKind.SOBRANNYY, MonsterKind.SLIME_WOMAN, MonsterKind.BORSHCHEVIK, MonsterKind.BLOOD_PLANT, MonsterKind.HEAD_SLUG, MonsterKind.LOZHNYY_DUKH, MonsterKind.DIKIY_MERTVYAK, MonsterKind.BEZEKHIY, MonsterKind.TRESKOTNIK, MonsterKind.TONKAYA_TEN, MonsterKind.GNILUSHKA, MonsterKind.SPORE_CARPET],
  [FloorLevel.MAINTENANCE]: [MonsterKind.TUBE_EEL, MonsterKind.POLZUN, MonsterKind.KOSTOREZ, MonsterKind.SAFEGUARD, MonsterKind.BETONOED, MonsterKind.POMOYNY_ROY, MonsterKind.SWARM, MonsterKind.GREEN_DOG, MonsterKind.PANELNIK, MonsterKind.PAUPSINA, MonsterKind.SOBRANNYY, MonsterKind.SLIME_WOMAN, MonsterKind.BORSHCHEVIK, MonsterKind.BLOOD_PLANT, MonsterKind.OLGOY, MonsterKind.VODYANOY_KOSHMAR, MonsterKind.ZAKALENNAYA_ARMATURA, MonsterKind.HEAD_SLUG, MonsterKind.CHERVIE_AVATAR, MonsterKind.MUKHOZHUK_HOST, MonsterKind.TRUBNYY_AVTOMAT, MonsterKind.FOG_SHARK, MonsterKind.SPORE_CARPET],
  [FloorLevel.HELL]: [MonsterKind.HERALD, MonsterKind.KOSTOREZ, MonsterKind.KHOROVAYA_MATKA, MonsterKind.TVAR, MonsterKind.TUMANNIK, MonsterKind.FOG_SHARK, MonsterKind.ZHORNAYA_TVAR, MonsterKind.SOBRANNYY, MonsterKind.BLOOD_PLANT, MonsterKind.SWARM, MonsterKind.OLGOY, MonsterKind.ZAKALENNAYA_ARMATURA, MonsterKind.TRESKOTNIK, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY],
  [FloorLevel.VOID]: [MonsterKind.PARAGRAPH, MonsterKind.EYE, MonsterKind.SPIRIT, MonsterKind.SAFEGUARD, MonsterKind.LOZHNYY_DUKH, MonsterKind.TONKAYA_TEN, MonsterKind.CHERVIE_AVATAR, MonsterKind.GLUBINNAYA_TEN, MonsterKind.LISHENNYY],
};
const DEBUG_PERMIT_PACK = [
  'official_permit_slip',
  'forged_permit_slip',
  'raionsovet_floor_pass',
  'forged_raionsovet_pass',
  'bank_debt_paper',
  'forged_bank_debt_paper',
  'debt_settlement_receipt',
  'confiscation_warrant',
  'ministry_clean_stamp',
  'blank_form',
  'ink_bottle',
] as const;
let catalogDebugSearchIndex = 0;
let debugVerificationContractIndex = 0;
let debugEconomyPulseIndex = 0;
let debugFloorInstanceCursor = 0;

type BaseDebugCommandId =
  | 'spawn_all_weapons'
  | 'spawn_all_psi'
  | 'spawn_all_tools'
  | 'spawn_monsters'
  | 'spawn_npc'
  | 'spawn_items'
  | 'grant_xp'
  | 'cycle_samosbor_variant'
  | 'toggle_noclip'
  | 'revealmap'
  | 'recent_events'
  | 'economy_prices'
  | 'nearby_containers'
  | 'take_from_container'
  | 'force_production_tick'
  | 'spawn_system_contract'
  | 'balance_catalog'
  | 'elevator_instances'
  | 'void_protocols'
  | 'faction_events'
  | 'force_faction_event'
  | 'force_cult_procession'
  | 'samosbor_director_state'
  | 'force_samosbor_director_beat'
  | 'clear_samosbor_director_cooldowns'
  | 'teleport_ministry'
  | 'teleport_kvartiry'
  | 'teleport_living'
  | 'teleport_maintenance'
  | 'teleport_hell'
  | 'teleport_void'
  | 'teleport_random_procedural'
  | 'smoke_expedition_setup'
  | 'rare_samosbor'
  | 'force_maronary_samosbor'
  | 'route_cue_nearest'
  | 'force_maronary_wrong_door'
  | 'grant_maronary_shaving'
  | 'force_istotit_samosbor'
  | 'teleport_smog'
  | 'teleport_false_safe_block'
  | 'teleport_hladon'
  | 'govnyak_courier_contract'
  | 'force_pneumomail_capsule'
  | 'force_hermodoor_borer'
  | 'force_liquidator_cult_clash'
  | 'debug_false_cleanup_patrol'
  | 'debug_mukhozhuk_host'
  | 'debug_chervie_site'
  | 'spawn_chalk'
  | 'toggle_onepunchman'
  | 'grant_net_terminal_gen_access'
  | 'place_net_terminal_gen_terminals'
  | 'place_net_terminal_gen_in_front'
  | 'open_map_editor'
  | 'net_terminal_gen_status'
  | 'replay_current_map_patch'
  | 'clear_current_map_patch'
  | 'teleport_fractal_floor'
  | 'teleport_mirror_run'
  | 'teleport_radio_chess'
  | 'teleport_cement_memory'
  | 'teleport_conveyor_sorter'
  | 'teleport_wall_snake'
  | 'teleport_section_shift'
  | 'teleport_conway_life'
  | 'teleport_rail_trains'
  | 'spawn_bad_apple_world'
  | 'spawn_sculpture'
  | 'verification_contract_route'
  | 'publish_verification_event'
  | 'route_floor_summary'
  | 'arm_floor_instance'
  | 'samosbor_warning_window'
  | 'economy_scarcity_pulse'
  | 'floor_monster_pack'
  | 'route_to_container'
  | 'teleport_zombie_apocalypse'
  | 'expedition_proof_prep'
  | 'expedition_proof_lift_ready'
  | 'expedition_proof_collectors_arrival'
  | 'expedition_proof_risk'
  | 'expedition_proof_container'
  | 'expedition_proof_samosbor_warning'
  | 'expedition_proof_return'
  | 'grant_permit_pack'
  | 'check_permit_access'
  | 'spoil_permit'
  | 'force_pseudolift'
  | 'debug_samosbor_small_wave';

const DESIGN_FLOOR_COMMAND_ID_PREFIX = 'teleport_design_floor:';

export type DebugCommandId = BaseDebugCommandId | `${typeof DESIGN_FLOOR_COMMAND_ID_PREFIX}${DesignFloorId}`;

interface DebugCommandDef {
  id: DebugCommandId;
  label: string;
}

export type DebugCommandAction =
  | { type: 'teleport_story_floor'; floor: FloorLevel }
  | { type: 'teleport_random_procedural_floor' }
  | { type: 'teleport_procedural_anomaly'; anomalyId: FloorAnomalyId }
  | { type: 'teleport_design_floor'; id: DesignFloorId; floor: FloorLevel; z: number; label: string; color: string }
  | { type: 'refresh_world_data' };

function movePlayerToSmokeLift(world: World, player: Entity, entities: Entity[]): boolean {
  let fallback: { x: number; y: number; angle: number } | null = null;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const lx = i % W;
    const ly = (i / W) | 0;
    const dirs = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];
    for (const dir of dirs) {
      const px = world.wrap(lx + dir.dx);
      const py = world.wrap(ly + dir.dy);
      const pi = world.idx(px, py);
      if (world.cells[pi] === Cell.LIFT || world.solid(px, py)) continue;
      const spot = {
        x: px + 0.5,
        y: py + 0.5,
        angle: Math.atan2((ly + 0.5) - (py + 0.5), (lx + 0.5) - (px + 0.5)),
      };
      fallback ??= spot;
      const actorTooClose = entities.some(e => (
        (e.type === EntityType.NPC || e.type === EntityType.MONSTER)
        && e.alive
        && world.dist2(spot.x, spot.y, e.x, e.y) < 9
      ));
      if (!actorTooClose) {
        player.x = spot.x;
        player.y = spot.y;
        player.angle = spot.angle;
        player.pitch = 0;
        return true;
      }
    }
  }
  if (!fallback) return false;
  player.x = fallback.x;
  player.y = fallback.y;
  player.angle = fallback.angle;
  player.pitch = 0;
  return true;
}

function isSmokeDebugRun(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('smoke');
}

function stabilizeSmokeRecovery(world: World, player: Entity, entities: Entity[]): void {
  movePlayerToSmokeLift(world, player, entities);
  player.alive = true;
  player.maxHp = Math.max(100, player.maxHp ?? 100);
  player.hp = player.maxHp;
}

function formatDebugZ(z: number): string {
  return z > 0 ? `+${z}` : `${z}`;
}

function currentPlayerZone(world: World, player: Entity): number | undefined {
  const x = world.wrap(Math.floor(player.x));
  const y = world.wrap(Math.floor(player.y));
  const zone = world.zoneMap[world.idx(x, y)];
  return zone >= 0 ? zone : undefined;
}

function currentPlayerRoom(world: World, player: Entity): number | undefined {
  const x = world.wrap(Math.floor(player.x));
  const y = world.wrap(Math.floor(player.y));
  const room = world.roomMap[world.idx(x, y)];
  return room >= 0 ? room : undefined;
}

function routeEntryLine(prefix: string, entry: ReturnType<typeof currentFloorRunEntry> | null): string {
  if (!entry) return `${prefix}: нет остановки`;
  const kind = entry.spec
    ? `proc ${entry.spec.anomalyId} d${entry.spec.danger}`
    : entry.designFloorId
      ? `design ${entry.designFloorId}`
      : `story ${FloorLevel[entry.baseFloor]}`;
  return `${prefix}: Z${formatDebugZ(entry.z)} ${kind} ${entry.label}`;
}

function debugRouteWindowLines(state: GameState): string[] {
  return [
    routeEntryLine('now', currentFloorRunEntry(state)),
    routeEntryLine('up', resolveFloorRunRoute(state, LiftDirection.UP)),
    routeEntryLine('down', resolveFloorRunRoute(state, LiftDirection.DOWN)),
  ];
}

interface DebugRouteFloorMetrics {
  passableCells: number;
  reachableCells: number;
  rooms: number;
  reachableRooms: number;
  functionalRooms: number;
  reachableFunctionalRooms: number;
  lifts: number;
  liftsUp: number;
  liftsDown: number;
  reachableLifts: number;
  reachableLiftsUp: number;
  reachableLiftsDown: number;
  playerBad: number;
  entityBad: number;
  containerBad: number;
}

function isDebugPassableCell(cell: number): boolean {
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function addDebugReachableRoom(world: World, roomSeen: Uint8Array, ci: number): void {
  const roomId = world.roomMap[ci];
  if (roomId >= 0 && roomId < roomSeen.length) roomSeen[roomId] = 1;
}

function countDebugBadPlacements(world: World, player: Entity, entities: Entity[]): Pick<DebugRouteFloorMetrics, 'playerBad' | 'entityBad' | 'containerBad'> {
  const playerBad = world.solid(Math.floor(player.x), Math.floor(player.y)) ? 1 : 0;
  let entityBad = 0;
  for (const e of entities) {
    if (!e.alive || isPlayerEntity(e) || e.type === EntityType.PROJECTILE || e.phasing) continue;
    if (world.solid(Math.floor(e.x), Math.floor(e.y))) entityBad++;
  }
  let containerBad = 0;
  for (const c of world.containers) {
    if (world.solid(c.x, c.y)) containerBad++;
  }
  return { playerBad, entityBad, containerBad };
}

function debugRouteFloorMetrics(world: World, player: Entity, entities: Entity[]): DebugRouteFloorMetrics {
  const reachable = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  const roomSeen = new Uint8Array(world.rooms.length);
  let passableCells = 0;
  let lifts = 0;
  let liftsUp = 0;
  let liftsDown = 0;

  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (isDebugPassableCell(cell)) passableCells++;
    if (cell !== Cell.LIFT) continue;
    lifts++;
    if (world.liftDir[i] === LiftDirection.UP) liftsUp++;
    else liftsDown++;
  }

  let head = 0;
  let tail = 0;
  let reachableCells = 0;
  const start = world.idx(Math.floor(player.x), Math.floor(player.y));
  if (isDebugPassableCell(world.cells[start])) {
    reachable[start] = 1;
    queue[tail++] = start;
    reachableCells = 1;
    addDebugReachableRoom(world, roomSeen, start);
  }

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of DEBUG_ROUTE_FLOOD_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (reachable[ni] || !isDebugPassableCell(world.cells[ni])) continue;
      reachable[ni] = 1;
      queue[tail++] = ni;
      reachableCells++;
      addDebugReachableRoom(world, roomSeen, ni);
    }
  }

  let reachableLifts = 0;
  let reachableLiftsUp = 0;
  let reachableLiftsDown = 0;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let ok = false;
    for (const [dx, dy] of DEBUG_ROUTE_FLOOD_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) {
        ok = true;
        break;
      }
    }
    if (!ok) continue;
    reachableLifts++;
    if (world.liftDir[i] === LiftDirection.UP) reachableLiftsUp++;
    else reachableLiftsDown++;
  }

  let reachableRooms = 0;
  let functionalRooms = 0;
  let reachableFunctionalRooms = 0;
  for (const room of world.rooms) {
    if (!room) continue;
    if (roomSeen[room.id]) reachableRooms++;
    if (room.type === RoomType.CORRIDOR) continue;
    functionalRooms++;
    if (roomSeen[room.id]) reachableFunctionalRooms++;
  }

  return {
    passableCells,
    reachableCells,
    rooms: world.rooms.length,
    reachableRooms,
    functionalRooms,
    reachableFunctionalRooms,
    lifts,
    liftsUp,
    liftsDown,
    reachableLifts,
    reachableLiftsUp,
    reachableLiftsDown,
    ...countDebugBadPlacements(world, player, entities),
  };
}

function debugRouteFloorSummaryLines(world: World, player: Entity, entities: Entity[], state: GameState): string[] {
  const entry = currentFloorRunEntry(state);
  const metrics = debugRouteFloorMetrics(world, player, entities);
  const badPlacements = metrics.playerBad + metrics.entityBad + metrics.containerBad;
  const story = entry.storyFloor !== undefined ? FloorLevel[entry.storyFloor] : 'none';
  const design = entry.designFloorId ?? 'none';
  const procedural = entry.spec?.key ?? 'none';
  const anomaly = entry.spec?.anomalyId ?? 'none';
  const out = [
    `identity z=${formatDebugZ(entry.z)} route=${floorRunEntryRouteId(entry)} kind=${floorRunEntryKind(entry)} base=${FloorLevel[entry.baseFloor]} story=${story} design=${design} procedural=${procedural}`,
    `label=${entry.label}`,
    floorInstanceIdentityLine(state),
    `reach cells=${metrics.reachableCells}/${metrics.passableCells} rooms=${metrics.reachableRooms}/${metrics.rooms} functional=${metrics.reachableFunctionalRooms}/${metrics.functionalRooms}`,
    `lifts reachable=${metrics.reachableLifts}/${metrics.lifts} up=${metrics.reachableLiftsUp}/${metrics.liftsUp} down=${metrics.reachableLiftsDown}/${metrics.liftsDown}`,
    `anomaly spec=${anomaly} teleports=${world.anomalyTeleports.size} smogCells=${world.anomalySmogCells.length} smogHandled=${world.anomalySmogHandled ? 1 : 0} railTracks=${world.railTracks.length} railTrains=${world.railTrains.length}`,
    `bad placements=${badPlacements} player=${metrics.playerBad} entities=${metrics.entityBad} containers=${metrics.containerBad}`,
  ];
  if (entry.spec) {
    out.push(`procedural geom=${entry.spec.geometryId} faction=${entry.spec.majorityId} danger=${entry.spec.danger} seed=${entry.spec.seed}`);
  }
  for (const line of debugRouteWindowLines(state)) out.push(line);
  for (const line of summarizeFloorRun(state).slice(0, 4)) out.push(`run ${line}`);
  for (const line of summarizeFloorInstances(state).slice(0, 3)) out.push(`lift ${line}`);
  for (const line of summarizeProceduralSmog(world, state).slice(0, 2)) out.push(line);
  for (const line of summarizeCarnivorousFungus(world, 2)) out.push(line);
  for (const line of summarizeHladonColdPockets(world, player, 2)) out.push(line);
  for (const line of summarizeBadAppleWorld(world).slice(0, 2)) out.push(line);
  return out;
}

function spawnDebugVerificationContract(state: GameState): string[] {
  for (let step = 0; step < DEBUG_VERIFICATION_CONTRACT_IDS.length; step++) {
    const idx = (debugVerificationContractIndex + step) % DEBUG_VERIFICATION_CONTRACT_IDS.length;
    const id = DEBUG_VERIFICATION_CONTRACT_IDS[idx];
    if (state.quests.some(q => q.contractId === id)) continue;
    debugVerificationContractIndex = idx + 1;
    const created = spawnContractById(state, id, ['debug_route', 'verification']);
    return [
      created ? `created ${id}` : `failed ${id}`,
      ...summarizeContracts(state, 5),
    ];
  }
  return ['all verification contracts already exist in quest history', ...summarizeContracts(state, 5)];
}

function publishDebugVerificationEvent(world: World, player: Entity, state: GameState): string {
  const event = publishEvent(state, {
    type: 'rumor_observed',
    zoneId: currentPlayerZone(world, player),
    roomId: currentPlayerRoom(world, player),
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    targetName: 'debug verification route',
    severity: 4,
    privacy: 'local',
    tags: ['debug', 'verification', 'events', 'rumor_observed'],
    data: {
      source: 'debug_menu',
      routeZ: currentFloorRunEntry(state).z,
      samosborActive: state.samosborActive,
    },
  });
  return `published ${event.type}#${event.id} sev${event.severity}`;
}

function applyDebugEconomyPulse(world: World, player: Entity, state: GameState): string[] {
  const pulse = DEBUG_ECONOMY_PULSES[debugEconomyPulseIndex++ % DEBUG_ECONOMY_PULSES.length];
  const before = getResourceScarcity(state, pulse.resourceId);
  const ok = changeResourceStock(state, pulse.resourceId, pulse.delta);
  const after = getResourceScarcity(state, pulse.resourceId);
  if (ok) {
    publishEvent(state, {
      type: 'room_lacked_resources',
      zoneId: currentPlayerZone(world, player),
      roomId: currentPlayerRoom(world, player),
      x: player.x,
      y: player.y,
      actorId: player.id,
      actorName: player.name ?? 'Вы',
      actorFaction: player.faction,
      itemId: pulse.itemId,
      itemName: ITEMS[pulse.itemId]?.name ?? pulse.itemId,
      severity: 4,
      privacy: 'local',
      tags: ['debug', 'economy', 'shortage', pulse.resourceId],
      data: {
        source: 'debug_menu',
        resourceId: pulse.resourceId,
        stockDelta: pulse.delta,
        scarcityBefore: before,
        scarcityAfter: after,
      },
    });
  }
  return [
    ok
      ? `${pulse.label}: x${before.toFixed(2)} -> x${after.toFixed(2)} price ${getAdjustedItemPrice(state, pulse.itemId)}`
      : `${pulse.label}: resource missing`,
    ...summarizeEconomy(state, 5),
  ];
}

function passableDebugCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  return (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) && !world.solid(x, y);
}

function entityBlocksDebugSpawn(world: World, entities: Entity[], x: number, y: number): boolean {
  let scanned = 0;
  for (const e of entities) {
    if (++scanned > DEBUG_MONSTER_SCAN_CAP) break;
    if (!e.alive || e.type === EntityType.ITEM_DROP || e.type === EntityType.PROJECTILE) continue;
    if (world.dist2(x + 0.5, y + 0.5, e.x, e.y) < 1.2) return true;
  }
  return false;
}

function findDebugMonsterSpot(
  world: World,
  player: Entity,
  entities: Entity[],
  index: number,
  total: number,
): { x: number; y: number } | null {
  const spread = Math.max(0.35, Math.min(0.9, Math.PI / Math.max(3, total)));
  const base = player.angle + (index - (total - 1) / 2) * spread;
  for (const dist of [3.2, 4.4, 5.8, 7.0]) {
    for (const offset of [0, 0.45, -0.45, 0.9, -0.9]) {
      const x = world.wrap(Math.floor(player.x + Math.cos(base + offset) * dist));
      const y = world.wrap(Math.floor(player.y + Math.sin(base + offset) * dist));
      if (!passableDebugCell(world, x, y)) continue;
      if (entityBlocksDebugSpawn(world, entities, x, y)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return null;
}

const DEBUG_FOG_SHARK_FOG_CAP = 40;

function seedDebugFogSharkPatch(world: World, kind: MonsterKind, x: number, y: number): number {
  if (kind !== MonsterKind.FOG_SHARK) return 0;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let cells = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (cells >= DEBUG_FOG_SHARK_FOG_CAP) break;
      if (dx * dx + dy * dy > 18) continue;
      const px = world.wrap(cx + dx);
      const py = world.wrap(cy + dy);
      if (world.solid(px, py)) continue;
      const ci = world.idx(px, py);
      world.fog[ci] = Math.max(world.fog[ci], 88);
      cells++;
    }
  }
  if (cells > 0) world.markFogDirty();
  return cells;
}

function seedDebugLishennyyLight(world: World, player: Entity, kind: MonsterKind): number {
  if (kind !== MonsterKind.LISHENNYY) return 0;
  for (const dist of [2, 3, 4]) {
    const x = world.wrap(Math.floor(player.x + Math.cos(player.angle) * dist));
    const y = world.wrap(Math.floor(player.y + Math.sin(player.angle) * dist));
    if (!passableDebugCell(world, x, y)) continue;
    world.setFeatureAt(world.idx(x, y), Feature.LAMP);
    return 1;
  }
  return 0;
}

function spawnDebugMonsterPack(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): string[] {
  const kinds = DEBUG_MONSTER_PACKS[state.currentFloor];
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, kinds.length);
  let spawned = 0;
  const names: string[] = [];
  for (let i = 0; i < kinds.length && spawned < slots; i++) {
    const kind = kinds[i];
    const def = MONSTERS[kind];
    const spot = findDebugMonsterSpot(world, player, entities, i, kinds.length);
    if (!def || !spot) continue;
    if (kind === MonsterKind.SWARM) {
      const source = createSwarmSourceEntity(nextEntityId.v++, spot.x, spot.y, player.rpg?.level ?? 2);
      source.angle = Math.atan2(player.y - spot.y, player.x - spot.x);
      entities.push(source);
      registerSwarmNestSource(world, {
        id: `debug_swarm_nest_${source.id}`,
        x: source.x,
        y: source.y,
        sourceEntityId: source.id,
        activationRadius: 36,
        spawnRadius: 4.5,
        spawnCooldown: 1.2,
        maxChildren: 6,
      });
      spawned++;
      names.push(`${monsterTypeName(kind)}+source`);
      publishEvent(state, {
        type: 'monster_sighted',
        zoneId: currentPlayerZone(world, player),
        x: spot.x,
        y: spot.y,
        targetId: source.id,
        targetName: source.name,
        monsterKind: kind,
        severity: 3,
        privacy: 'local',
        tags: ['debug', 'monster', 'swarm', 'source', 'verification', 'counterplay'],
        data: {
          source: 'debug_menu',
          counterplay: def.counterplay,
          maxChildren: 6,
        },
      });
      continue;
    }
    const monster: Entity = {
      id: nextEntityId.v++,
      type: EntityType.MONSTER,
      x: spot.x,
      y: spot.y,
      angle: Math.atan2(player.y - spot.y, player.x - spot.x),
      pitch: 0,
      alive: true,
      speed: def.speed,
      sprite: def.sprite,
      hp: def.hp,
      maxHp: def.hp,
      monsterKind: kind,
      attackCd: 0,
      ai: { goal: AIGoal.WANDER, tx: spot.x, ty: spot.y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(player.rpg?.level ?? 1),
      phasing: kind === MonsterKind.SPIRIT,
    };
    entities.push(monster);
    const debugFogCells = seedDebugFogSharkPatch(world, kind, spot.x, spot.y);
    const debugLightCells = seedDebugLishennyyLight(world, player, kind);
    spawned++;
    names.push(debugLightCells > 0 ? `${monsterTypeName(kind)}+light` : debugFogCells > 0 ? `${monsterTypeName(kind)}+fog` : monsterTypeName(kind));
    publishEvent(state, {
      type: 'monster_sighted',
      zoneId: currentPlayerZone(world, player),
      x: spot.x,
      y: spot.y,
      targetId: monster.id,
      targetName: monsterTypeName(kind),
      monsterKind: kind,
      severity: 3,
      privacy: 'local',
      tags: ['debug', 'monster', 'verification', 'counterplay'],
      data: {
        source: 'debug_menu',
        counterplay: def.counterplay,
        debugFogCells,
        debugLightCells,
      },
    });
  }
  return spawned > 0
    ? [`spawned ${spawned}: ${names.join(', ')}`]
    : ['no passable spawn cells in front of player'];
}

function spawnDebugFalseCleanupPatrol(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): string[] {
  const kind = MonsterKind.BLACK_LIQUIDATOR;
  const def = MONSTERS[kind];
  const target = 3;
  const slots = entitySpawnSlots(entities, EntityType.MONSTER, target);
  let spawned = 0;
  for (let i = 0; i < slots; i++) {
    const spot = findDebugMonsterSpot(world, player, entities, i, target);
    if (!spot) continue;
    entities.push({
      id: nextEntityId.v++,
      type: EntityType.MONSTER,
      x: spot.x,
      y: spot.y,
      angle: Math.atan2(player.y - spot.y, player.x - spot.x),
      pitch: 0,
      alive: true,
      speed: def.speed,
      sprite: def.sprite,
      hp: def.hp,
      maxHp: def.hp,
      monsterKind: kind,
      attackCd: def.attackRate,
      ai: { goal: AIGoal.WANDER, tx: spot.x, ty: spot.y, path: [], pi: 0, stuck: 0, timer: 0 },
      rpg: randomRPG(player.rpg?.level ?? 1),
      spriteSeed: (nextEntityId.v * 2654435761) >>> 0,
    });
    spawned++;
  }
  if (spawned > 0) {
    state.samosborCount = Math.max(state.samosborCount, 3);
    publishEvent(state, {
      type: 'false_liquidator_knock',
      zoneId: currentPlayerZone(world, player),
      x: player.x,
      y: player.y,
      targetName: 'debug false cleanup patrol',
      monsterKind: kind,
      severity: 3,
      privacy: 'local',
      tags: ['debug', 'monster', 'black_liquidator', 'false_cleanup'],
      data: { source: 'debug_menu', monsterCount: spawned },
    });
  }
  return spawned > 0
    ? [`fake cleanup patrol spawned: ${spawned}`]
    : ['no passable spawn cells for fake cleanup patrol'];
}

function nearestDebugMukhozhukNpc(world: World, player: Entity, entities: Entity[]): Entity | null {
  let best: Entity | null = null;
  let bestD2 = 9 * 9;
  for (const e of entities) {
    if (!e.alive || e.type !== EntityType.NPC || !e.ai || e.plotNpcId !== undefined) continue;
    const d2 = world.dist2(player.x, player.y, e.x, e.y);
    if (d2 >= bestD2) continue;
    best = e;
    bestD2 = d2;
  }
  return best;
}

function turnNpcIntoDebugMukhozhuk(npc: Entity, player: Entity): void {
  const def = MONSTERS[MonsterKind.MUKHOZHUK_HOST];
  npc.type = EntityType.MONSTER;
  npc.monsterKind = MonsterKind.MUKHOZHUK_HOST;
  npc.name = `${npc.name ?? 'Носитель'}: мухожук`;
  npc.speed = def.speed;
  npc.sprite = def.sprite;
  npc.hp = Math.max(npc.hp ?? 1, Math.round(def.hp * 0.78));
  npc.maxHp = Math.max(npc.maxHp ?? 1, def.hp);
  npc.attackCd = 0;
  npc.ai = { goal: AIGoal.HUNT, tx: Math.floor(player.x), ty: Math.floor(player.y), path: [], pi: 0, stuck: 0, timer: 0, combatTargetId: player.id };
  npc.inventory = [
    ...(npc.inventory ?? []),
    { defId: 'quarantine_medcard', count: 1 },
  ].slice(0, 12);
}

function spawnDebugMukhozhukHost(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): string[] {
  const existingNpc = nearestDebugMukhozhukNpc(world, player, entities);
  let host: Entity;
  let mode = 'spawned';
  if (existingNpc) {
    turnNpcIntoDebugMukhozhuk(existingNpc, player);
    host = existingNpc;
    mode = 'infected_nearest_npc';
  } else {
    if (!canSpawnEntityType(entities, EntityType.MONSTER)) return ['monster entity limit reached'];
    const spot = findDebugMonsterSpot(world, player, entities, 0, 1);
    if (!spot) return ['no passable spawn cell in front of player'];
    const def = MONSTERS[MonsterKind.MUKHOZHUK_HOST];
    host = {
      id: nextEntityId.v++,
      type: EntityType.MONSTER,
      x: spot.x,
      y: spot.y,
      angle: Math.atan2(player.y - spot.y, player.x - spot.x),
      pitch: 0,
      alive: true,
      speed: def.speed,
      sprite: def.sprite,
      hp: def.hp,
      maxHp: def.hp,
      name: 'Ревизор-носитель: мухожук',
      monsterKind: MonsterKind.MUKHOZHUK_HOST,
      attackCd: 0,
      ai: { goal: AIGoal.HUNT, tx: Math.floor(player.x), ty: Math.floor(player.y), path: [], pi: 0, stuck: 0, timer: 0, combatTargetId: player.id },
      rpg: randomRPG(player.rpg?.level ?? 1),
      faction: Faction.LIQUIDATOR,
      occupation: Occupation.DIRECTOR,
      inventory: [{ defId: 'quarantine_medcard', count: 1 }],
    };
    entities.push(host);
  }

  publishEvent(state, {
    type: 'mukhozhuk_exposed',
    zoneId: currentPlayerZone(world, player),
    roomId: currentPlayerRoom(world, player),
    x: host.x,
    y: host.y,
    actorId: host.id,
    actorName: host.name,
    actorFaction: host.faction,
    targetId: player.id,
    targetName: player.name ?? 'Вы',
    targetFaction: player.faction,
    monsterKind: MonsterKind.MUKHOZHUK_HOST,
    severity: 4,
    privacy: 'local',
    tags: ['debug', 'monster', 'mukhozhuk', 'parasite_leader', mode],
    data: {
      source: 'debug_menu',
      mode,
      counterplay: MONSTERS[MonsterKind.MUKHOZHUK_HOST]?.counterplay,
      rumorIds: ['monster_mukhozhuk_host_command', 'ecology_mukhozhuk_quarantine'],
    },
  });
  return [`${mode}: ${host.name ?? monsterTypeName(MonsterKind.MUKHOZHUK_HOST)} #${host.id}`];
}

function placeDebugChervieFeature(world: World, x: number, y: number, feature: Feature): boolean {
  const wx = world.wrap(x);
  const wy = world.wrap(y);
  if (!passableDebugCell(world, wx, wy)) return false;
  world.setFeatureAt(world.idx(wx, wy), feature);
  return true;
}

function spawnDebugChervieSite(
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): string[] {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return ['monster entity limit reached'];
  const spot = findDebugMonsterSpot(world, player, entities, 0, 1);
  if (!spot) return ['no passable spawn cell in front of player'];
  const kind = MonsterKind.CHERVIE_AVATAR;
  const def = MONSTERS[kind];
  const mx = Math.floor(spot.x);
  const my = Math.floor(spot.y);
  let apparatus = false;
  let screen = false;
  const sourceOffsets = [
    { dx: 1, dy: 0, feature: Feature.APPARATUS },
    { dx: -1, dy: 0, feature: Feature.SCREEN },
    { dx: 0, dy: 1, feature: Feature.APPARATUS },
    { dx: 0, dy: -1, feature: Feature.SCREEN },
    { dx: 2, dy: 1, feature: Feature.SCREEN },
    { dx: -2, dy: -1, feature: Feature.APPARATUS },
  ] as const;
  for (const source of sourceOffsets) {
    const placed = placeDebugChervieFeature(world, mx + source.dx, my + source.dy, source.feature);
    if (!placed) continue;
    if (source.feature === Feature.APPARATUS) apparatus = true;
    if (source.feature === Feature.SCREEN) screen = true;
  }

  const monster: Entity = {
    id: nextEntityId.v++,
    type: EntityType.MONSTER,
    x: spot.x,
    y: spot.y,
    angle: Math.atan2(player.y - spot.y, player.x - spot.x),
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(kind),
    hp: def.hp,
    maxHp: def.hp,
    name: 'Червие отладочного экрана',
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.HUNT, tx: Math.floor(player.x), ty: Math.floor(player.y), path: [], pi: 0, stuck: 0, timer: 0, combatTargetId: player.id },
    rpg: randomRPG(player.rpg?.level ?? 1),
  };
  entities.push(monster);
  publishEvent(state, {
    type: 'chervie_signal',
    zoneId: currentPlayerZone(world, player),
    roomId: currentPlayerRoom(world, player),
    x: monster.x,
    y: monster.y,
    actorId: monster.id,
    actorName: monster.name,
    actorFaction: monster.faction,
    targetId: player.id,
    targetName: player.name ?? 'Вы',
    targetFaction: player.faction,
    monsterKind: kind,
    severity: 4,
    privacy: 'local',
    tags: ['debug', 'monster', 'chervie', 'net', 'screen', 'apparatus'],
    data: {
      source: 'debug_menu',
      apparatus,
      screen,
      counterplay: def.counterplay,
      rumorIds: ['monster_chervie_avatar_screen', 'ecology_chervie_avatar_disconnect'],
    },
  });
  return [`chervie site: avatar #${monster.id}, apparatus=${apparatus ? 1 : 0}, screen=${screen ? 1 : 0}`];
}

function adjacentContainerRouteSpot(world: World, container: WorldContainer): { x: number; y: number } | null {
  for (let r = 1; r <= DEBUG_CONTAINER_ROUTE_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = world.wrap(container.x + dx);
        const y = world.wrap(container.y + dy);
        if (passableDebugCell(world, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function routePlayerToNearestContainer(world: World, player: Entity, state: GameState): string[] {
  const created = ensureRoomContainers(world, state.currentFloor);
  let best: WorldContainer | null = null;
  let bestScore = Infinity;
  for (const c of world.containers) {
    if (c.floor !== state.currentFloor) continue;
    const route = adjacentContainerRouteSpot(world, c);
    if (!route) continue;
    const theftBias = c.access === 'faction' || c.access === 'owner' ? -500 : 0;
    const lootBias = c.inventory.length > 0 ? -250 : 0;
    const score = world.dist2(player.x, player.y, c.x + 0.5, c.y + 0.5) + theftBias + lootBias;
    if (score >= bestScore) continue;
    best = c;
    bestScore = score;
  }
  if (!best) return [`created=${created}; no routeable containers on floor`];
  const spot = adjacentContainerRouteSpot(world, best);
  if (!spot) return [`created=${created}; nearest container has no adjacent cell`];
  player.x = spot.x + 0.5;
  player.y = spot.y + 0.5;
  player.angle = Math.atan2((best.y + 0.5) - player.y, (best.x + 0.5) - player.x);
  player.pitch = 0;
  return [`created=${created}; routed to ${describeContainer(best)}`];
}

function armLocalFloorInstance(world: World, player: Entity, state: GameState): string[] {
  const candidates = FLOOR_INSTANCES.filter(def => def.baseFloor === state.currentFloor);
  if (candidates.length === 0) return [`no numbered loop uses ${FloorLevel[state.currentFloor]} as base; teleport to another story floor first`];
  const def = candidates[debugFloorInstanceCursor++ % candidates.length];
  const store = ensureFloorInstanceState(state, state.currentFloor);
  const instance = {
    id: def.id,
    displayNumber: def.displayNumber,
    title: def.title,
    baseFloor: def.baseFloor,
    seed: Math.floor(Math.random() * 0x7fffffff),
    seedTag: def.seedTag,
    risk: def.risk,
    enteredAt: state.time,
    fromFloor: state.currentFloor,
    intendedFloor: state.currentFloor,
    direction: LiftDirection.DOWN,
    returnFloor: state.currentFloor,
  };
  store.current = instance;
  store.discovered[def.id] = true;
  store.anomalyCount++;
  store.lastAnomalyAt = state.time;
  store.lastRoll = 0;
  publishEvent(state, {
    type: 'elevator_anomaly',
    floor: def.baseFloor,
    zoneId: currentPlayerZone(world, player),
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity: 4,
    privacy: 'local',
    tags: ['debug', 'elevator', 'floor_instance', def.id, 'wrong_route'],
    data: {
      source: 'debug_menu',
      displayNumber: def.displayNumber,
      title: def.title,
      seed: instance.seed,
      seedTag: instance.seedTag,
      risk: instance.risk,
      fromFloor: instance.fromFloor,
      intendedFloor: instance.intendedFloor,
      returnFloor: instance.returnFloor,
    },
  });
  return [
    `armed ${floorInstanceLabel(instance)}`,
    'use any lift once to publish loop exit and return to stable route',
  ];
}

function setSamosborWarningWindow(state: GameState): string {
  if (state.samosborActive) {
    state.samosborTimer = Math.min(state.samosborTimer, DEBUG_SAMOSBOR_WARNING_SECONDS);
    return `active samosbor ends in <=${DEBUG_SAMOSBOR_WARNING_SECONDS}s`;
  }
  state.samosborTimer = DEBUG_SAMOSBOR_WARNING_SECONDS;
  return `warning window set to ${DEBUG_SAMOSBOR_WARNING_SECONDS}s`;
}

function spawnSmokeTarget(world: World, player: Entity, entities: Entity[], nextEntityId: { v: number }): boolean {
  if (!canSpawnEntityType(entities, EntityType.MONSTER)) return false;
  const def = MONSTERS[MonsterKind.SBORKA];
  const baseAngles = [player.angle, player.angle + 0.45, player.angle - 0.45, player.angle + Math.PI];
  for (const angle of baseAngles) {
    for (const dist of [3.5, 2.5, 4.5]) {
      const x = player.x + Math.cos(angle) * dist;
      const y = player.y + Math.sin(angle) * dist;
      if (world.solid(Math.floor(x), Math.floor(y))) continue;
      const monster: Entity = {
        id: nextEntityId.v++, type: EntityType.MONSTER,
        x, y,
        angle: angle + Math.PI, pitch: 0, alive: true,
        speed: def.speed, sprite: def.sprite,
        hp: Math.min(def.hp, 18), maxHp: Math.min(def.hp, 18),
        monsterKind: MonsterKind.SBORKA, attackCd: 0,
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        rpg: randomRPG(player.rpg?.level ?? 1),
      };
      entities.push(monster);
      return true;
    }
  }
  return false;
}

function grantDebugPermitPack(player: Entity): string[] {
  const granted: string[] = [];
  for (const id of DEBUG_PERMIT_PACK) {
    if (addItem(player, id, 1)) granted.push(ITEMS[id]?.name ?? id);
  }
  return granted.length > 0
    ? [`выдано: ${granted.slice(0, 6).join(', ')}${granted.length > 6 ? ` +${granted.length - 6}` : ''}`]
    : ['нет места под документы'];
}

function debugPermitTagForFloor(floor: FloorLevel): PermitAccessTag {
  if (floor === FloorLevel.MINISTRY) return 'ministry_n3';
  if (floor === FloorLevel.KVARTIRY) return 'quarantine';
  return 'general_admin';
}

function checkDebugPermitAccess(world: World, player: Entity, state: GameState): string[] {
  const preferred = debugPermitTagForFloor(state.currentFloor);
  const permit = findActorPermit(player, [preferred, 'general_admin', 'archive', 'bank_debt', 'bank_vault']);
  if (!permit) return ['нет пропуска с подходящим access tag'];
  const tag = permit.accessTags.includes(preferred) ? preferred : permit.accessTags[0];
  recordPermitAccess(state, player, world, permit, `debug:${tag}`, tag);
  return [`${ITEMS[permit.itemId]?.name ?? permit.itemId}: ${tag}`];
}

function spoilDebugPermit(world: World, player: Entity, state: GameState): string[] {
  for (const slot of player.inventory ?? []) {
    const permit = getPermitDef(slot.defId);
    if (!permit || slot.count <= 0) continue;
    removeItem(player, slot.defId, 1);
    addItem(player, 'bleached_document', 1);
    recordPermitExposure(state, player, world, permit, 'debug:spoiled_permit', 'debug_spoil');
    return [`испорчен: ${ITEMS[permit.itemId]?.name ?? permit.itemId}`];
  }
  return ['нет пропуска для порчи'];
}

const DEBUG_PSI_CLOT_IDS = new Set(Object.keys(PSI_WEAPON_STATS));

function isDebugPsiClot(id: string): boolean {
  return DEBUG_PSI_CLOT_IDS.has(id);
}

function debugItemDrop(def: ItemDef): { defId: string; count: number } {
  return { defId: def.id, count: getStack(def) };
}

function debugWeaponAndAmmoDrops(): { defId: string; count: number }[] {
  const weapons: { defId: string; count: number }[] = [];
  const ammo: { defId: string; count: number }[] = [];
  for (const def of Object.values(ITEMS)) {
    if (def.type === ItemType.WEAPON && !isDebugPsiClot(def.id)) weapons.push(debugItemDrop(def));
    else if (def.type === ItemType.AMMO) ammo.push(debugItemDrop(def));
  }
  return [...weapons, ...ammo];
}

function debugPsiClotDrops(): { defId: string; count: number }[] {
  const out: { defId: string; count: number }[] = [];
  for (const id of Object.keys(PSI_WEAPON_STATS)) {
    const def = ITEMS[id];
    if (def) out.push(debugItemDrop(def));
  }
  return out;
}

function debugToolDrops(): { defId: string; count: number }[] {
  return Object.values(ITEMS)
    .filter(def => def.type === ItemType.TOOL)
    .map(debugItemDrop);
}

function debugOtherItemDrops(): { defId: string; count: number }[] {
  return Object.values(ITEMS)
    .filter(def => (
      def.type !== ItemType.WEAPON
      && def.type !== ItemType.AMMO
      && def.type !== ItemType.TOOL
      && !isDebugPsiClot(def.id)
    ))
    .map(debugItemDrop);
}

function debugItemDropSpot(world: World, player: Entity, index: number): { x: number; y: number } {
  const angle = player.angle + index * Math.PI * 2;
  const radius = 2;
  return {
    x: world.wrap(player.x + Math.cos(angle) * radius),
    y: world.wrap(player.y + Math.sin(angle) * radius),
  };
}

function spawnDebugItemDropsAroundPlayer(
  world: World,
  player: Entity,
  entities: Entity[],
  nextEntityId: { v: number },
  items: readonly { defId: string; count: number }[],
  label: string,
): string {
  const slots = entitySpawnSlots(entities, EntityType.ITEM_DROP, items.length);
  for (let i = 0; i < slots; i++) {
    const spot = debugItemDropSpot(world, player, i / Math.max(1, slots));
    entities.push({
      id: nextEntityId.v++,
      type: EntityType.ITEM_DROP,
      x: spot.x,
      y: spot.y,
      angle: 0,
      pitch: 0,
      alive: true,
      speed: 0,
      sprite: Spr.ITEM_DROP,
      inventory: [items[i]],
    });
  }
  if (slots >= items.length) return `${label}: разложено ${slots}`;
  return `${label}: разложено ${slots}/${items.length}, лимит предметов`;
}

export function execDebugCommand(
  idx: number,
  world: World,
  player: Entity,
  entities: Entity[],
  state: GameState,
  nextEntityId: { v: number },
): DebugCommandAction | null {
  const execIdx = debugCommandExecutionIndex(idx);
  if (execIdx < 0) return null;
  if (execIdx >= DESIGN_FLOOR_COMMAND_START) {
    const def = DESIGN_FLOOR_ROUTES[execIdx - DESIGN_FLOOR_COMMAND_START];
    if (def) {
      return {
        type: 'teleport_design_floor',
        id: def.id,
        floor: def.baseFloor,
        z: def.z,
        label: def.displayName,
        color: def.color,
      };
    }
  }

  switch (execIdx) {
    case 0: { // All physical weapons + ammo — spawn as drops around player
      state.msgs.push(msg(`[DEBUG] ${spawnDebugItemDropsAroundPlayer(world, player, entities, nextEntityId, debugWeaponAndAmmoDrops(), 'оружие+патроны')}`, state.time, '#ff0'));
      break;
    }
    case 1: { // Spawn one of each monster nearby
      const kinds = Object.values(MonsterKind).filter((v): v is MonsterKind => typeof v === 'number');
      const slots = entitySpawnSlots(entities, EntityType.MONSTER, kinds.length);
      for (let i = 0; i < slots; i++) {
        const k = kinds[i];
        const def = MONSTERS[k];
        const ang = (i / kinds.length) * Math.PI * 2;
        const monster: Entity = {
          id: nextEntityId.v++, type: EntityType.MONSTER,
          x: player.x + Math.cos(ang) * 4,
          y: player.y + Math.sin(ang) * 4,
          angle: ang + Math.PI, pitch: 0, alive: true,
          speed: def.speed, sprite: def.sprite,
          hp: def.hp, maxHp: def.hp,
          monsterKind: k, attackCd: 0,
          ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
          rpg: randomRPG(player.rpg?.level ?? 1),
          phasing: k === MonsterKind.SPIRIT,
        };
        entities.push(monster);
        seedDebugFogSharkPatch(world, k, monster.x, monster.y);
      }
      state.msgs.push(msg('Все монстры заспавнены', state.time, '#ff0'));
      break;
    }
    case 2: { // Spawn random NPC nearby
      if (!canSpawnEntityType(entities, EntityType.NPC)) {
        state.msgs.push(msg('Лимит NPC достигнут', state.time, '#f88'));
        break;
      }
      const nm = randomName();
      const rpg = randomRPG(player.rpg?.level ?? 1);
      const maxHp = getMaxHp(rpg);
      const factions = [Faction.CITIZEN, Faction.LIQUIDATOR, Faction.CULTIST, Faction.WILD];
      const faction = factions[Math.floor(Math.random() * factions.length)];
      entities.push({
        id: nextEntityId.v++, type: EntityType.NPC,
        x: player.x + Math.cos(player.angle) * 2,
        y: player.y + Math.sin(player.angle) * 2,
        angle: player.angle + Math.PI, pitch: 0, alive: true,
        speed: 1.2, sprite: Occupation.TRAVELER,
        name: nm.name, firstName: nm.firstName, lastName: nm.lastName, isFemale: nm.female,
        needs: freshNeeds(), hp: maxHp, maxHp,
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        inventory: [], faction, occupation: Occupation.TRAVELER, isTraveler: true,
        rpg, money: 20 + Math.floor(Math.random() * 80),
      });
      state.msgs.push(msg(`NPC ${nm.name} заспавнен`, state.time, '#ff0'));
      break;
    }
    case 3: { // Spawn all non-weapon/non-ammo/non-tool items nearby
      state.msgs.push(msg(`[DEBUG] ${spawnDebugItemDropsAroundPlayer(world, player, entities, nextEntityId, debugOtherItemDrops(), 'остальные предметы')}`, state.time, '#ff0'));
      break;
    }
    case 4: { // Give 1M XP
      awardXP(player, 1_000_000, state.msgs, state.time);
      state.msgs.push(msg('+1 000 000 XP', state.time, '#ff0'));
      break;
    }
    case 5: { // Cycle forced samosbor variant + start (full scale = global fronts)
      const variantId = cycleForcedSamosborVariant();
      state.samosborTimer = 0;
      state.msgs.push(msg(`[DEBUG] Следующий самосбор: ${variantId} (глобальный)`, state.time, '#ff0'));
      break;
    }
    case 6: { // Toggle noclip
      const enabled = toggleDebugNoClip();
      state.msgs.push(msg(
        `[DEBUG] Noclip ${enabled ? 'включён' : 'выключен'}`,
        state.time,
        '#ff0',
      ));
      break;
    }
    case 7: { // Recent important world events
      const store = ensureWorldEventState(state);
      state.msgs.push(msg(
        `[EVENTS] recent=${store.recentEvents.count}/${store.recentEvents.capacity} important=${store.importantEvents.count}/${store.importantEvents.capacity}`,
        state.time,
        '#ff0',
      ));
      const important = getImportantEvents(state, 10);
      if (important.length === 0) {
        state.msgs.push(msg('[EVENTS] important: none', state.time, '#888'));
        break;
      }
      for (let i = important.length - 1; i >= 0; i--) {
        const e = important[i];
        const zone = e.zoneId !== undefined ? ` z${e.zoneId + 1}` : '';
        state.msgs.push(msg(`[EVENTS] #${e.id} ${e.type}${zone} sev${e.severity}`, state.time, '#ccf'));
      }
      for (const row of summarizeImportantEventsByFloorZone(state, 8)) {
        const zone = row.zoneId >= 0 ? `z${row.zoneId + 1}` : 'z?';
        state.msgs.push(msg(
          `[EVENTS] floor ${row.floor} ${zone}: ${row.count} imp, max${row.maxSeverity}, last ${row.lastType}#${row.lastId}`,
          state.time,
          '#9cf',
        ));
      }
      break;
    }
    case 8: { // Economy prices
      for (const line of summarizeEconomy(state, 10)) state.msgs.push(msg(`[PRICE] ${line}`, state.time, '#ccf'));
      for (const id of ['water', 'bread', 'bandage', 'ammo_9mm', 'pipe', 'note']) {
        state.msgs.push(msg(`[PRICE] ${ITEMS[id]?.name ?? id}: ${getAdjustedItemPrice(state, id)}₽`, state.time, '#ccf'));
      }
      break;
    }
    case 9: { // Containers near player
      const made = ensureRoomContainers(world, state.currentFloor);
      if (made > 0) state.msgs.push(msg(`[CONT] создано: ${made}`, state.time, '#ff0'));
      const list = nearbyContainers(world, player, 3);
      if (list.length === 0) {
        state.msgs.push(msg(`[CONT] рядом нет. всего=${world.containers.length}`, state.time, '#888'));
        break;
      }
      for (const c of list.slice(0, 5)) state.msgs.push(msg(`[CONT] ${describeContainer(c)}`, state.time, '#ccf'));
      break;
    }
    case 10: { // Take first item from nearest container
      ensureRoomContainers(world, state.currentFloor);
      const c = firstNearbyContainer(world, player);
      if (!c) {
        state.msgs.push(msg('[CONT] рядом нет контейнера', state.time, '#888'));
        break;
      }
      const ok = takeFromContainer(c, player, 0, 1, { state, world, entities });
      state.msgs.push(msg(ok ? `[CONT] взято из #${c.id}` : `[CONT] #${c.id} пуст/недоступен`, state.time, ok ? '#4f4' : '#f84'));
      break;
    }
    case 11: { // Force production tick
      const made = tickProduction(state, world, true);
      for (const line of summarizeProduction(state, 5)) state.msgs.push(msg(`[PROD] ${line}`, state.time, made > 0 ? '#4f4' : '#888'));
      break;
    }
    case 12: { // Spawn/list system quest
      spawnContract(state);
      for (const line of summarizeContracts(state, 6)) state.msgs.push(msg(`[QUEST] ${line}`, state.time, '#6cf'));
      break;
    }
    case 13: { // Population, item count, and floor pocket catalog
      for (const line of populationItemSummary(world, entities, state)) state.msgs.push(msg(`[BAL] ${line}`, state.time, '#ccf'));
      const search = CATALOG_DEBUG_SEARCHES[catalogDebugSearchIndex++ % CATALOG_DEBUG_SEARCHES.length];
      const query = search
        ? { search, limit: 6 }
        : { baseFloor: state.currentFloor, limit: 6 };
      for (const line of floorCatalogDebugLines(query)) state.msgs.push(msg(`[CAT] ${line}`, state.time, '#ccf'));
      for (const line of summarizeHeatline(world)) state.msgs.push(msg(line, state.time, '#f84'));
      for (const line of summarizeCarnivorousFungus(world)) state.msgs.push(msg(line, state.time, '#bf8'));
      for (const line of summarizeHladonColdPockets(world, player)) state.msgs.push(msg(line, state.time, '#8cf'));
      break;
    }
    case 14: { // Elevator floor instance state
      for (const line of summarizeFloorRun(state)) state.msgs.push(msg(`[FLOOR] ${line}`, state.time, '#8cf'));
      for (const line of summarizeFloorInstances(state)) state.msgs.push(msg(`[LIFT] ${line}`, state.time, '#f4a'));
      break;
    }
    case 15: { // VOID protocols: grant/apply/list bounded state
      for (const line of debugForceVoidProtocol(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[VOID] ${line}`, state.time, '#8ff'));
      }
      break;
    }
    case 16: { // Faction event scheduler
      for (const line of summarizeFactionEvents(state, world, player, entities)) {
        state.msgs.push(msg(`[FACT] ${line}`, state.time, '#ccf'));
      }
      break;
    }
    case 17: { // Force faction event in current zone
      state.msgs.push(msg(forceFactionEvent(state, world, player, entities, nextEntityId), state.time, '#ff0'));
      break;
    }
    case 18: { // Force cult procession in current zone
      state.msgs.push(msg(forceFactionEvent(state, world, player, entities, nextEntityId, 'cult_procession'), state.time, '#ff0'));
      break;
    }
    case 19: { // Samosbor director state
      for (const line of summarizeSamosborDirector(state)) state.msgs.push(msg(`[DIR] ${line}`, state.time, '#ccf'));
      break;
    }
    case 20: { // Force next samosbor director beat
      const result = forceNextSamosborDirectorBeat(world, entities, state, nextEntityId, getActiveSamosborVariant());
      state.msgs.push(msg(
        result.fired ? `[DIR] forced ${result.beatId}` : `[DIR] ${result.reasonCode}`,
        state.time,
        result.fired ? '#4f4' : '#f84',
      ));
      break;
    }
    case 21: { // Clear samosbor director cooldowns
      clearSamosborDirectorCooldowns(state);
      state.msgs.push(msg('[DIR] cooldowns cleared', state.time, '#ff0'));
      break;
    }
    case 22: return { type: 'teleport_story_floor', floor: FloorLevel.MINISTRY };
    case 23: return { type: 'teleport_story_floor', floor: FloorLevel.KVARTIRY };
    case 24: return { type: 'teleport_story_floor', floor: FloorLevel.LIVING };
    case 25: return { type: 'teleport_story_floor', floor: FloorLevel.MAINTENANCE };
    case 26: return { type: 'teleport_story_floor', floor: FloorLevel.HELL };
    case 27: return { type: 'teleport_story_floor', floor: FloorLevel.VOID };
    case 28: return { type: 'teleport_random_procedural_floor' };
    case 29: { // Smoke expedition setup
      addItem(player, 'makarov', 1);
      addItem(player, 'ammo_9mm', 30);
      player.weapon = 'makarov';
      const moved = movePlayerToSmokeLift(world, player, entities);
      const target = spawnSmokeTarget(world, player, entities, nextEntityId);
      const contract = spawnContract(state);
      state.msgs.push(msg(
        `[SMOKE] kit=${player.weapon} lift=${moved ? 'ready' : 'missing'} target=${target ? 'spawned' : 'skipped'} contract=${contract ? 'created' : 'skipped'}`,
        state.time,
        moved && contract ? '#4f4' : '#f84',
      ));
      break;
    }
    case 30: { // Force Veretar variant + start (full scale)
      forceNextSamosborVariant('veretar');
      if (!state.samosborActive) state.samosborTimer = 0;
      if (isSmokeDebugRun()) stabilizeSmokeRecovery(world, player, entities);
      state.msgs.push(msg(
        state.samosborActive
          ? '[DEBUG] Следующий самосбор: Веретар (глобальный) после текущего'
          : '[DEBUG] Следующий самосбор: Веретар (глобальный)',
        state.time,
        '#f4f1df',
      ));
      break;
    }
    case 31: { // Force Maronary variant + start (full scale)
      forceNextSamosborVariant('maronary');
      state.samosborTimer = 0;
      state.msgs.push(msg('[DEBUG] Следующий самосбор: Маронарий (глобальный)', state.time, '#35ff66'));
      break;
    }
    case 32: { // Route cue audio/HUD smoke
      const count = routeCueCount(world);
      state.msgs.push(msg(`[CUE] registered=${count}`, state.time, count > 0 ? '#9f7' : '#fa4'));
      for (const line of debugTriggerRouteCue(world, player, state)) {
        state.msgs.push(msg(`[CUE] ${line}`, state.time, '#9f7'));
      }
      break;
    }
    case 33: { // Force Maronary wrong-door remap
      const ok = debugCreateWrongDoorRemap(world, player, state);
      state.msgs.push(msg(
        ok ? '[MAR] неправильная дверь создана' : '[MAR] рядом нет подходящей пары дверей',
        state.time,
        ok ? '#35ff66' : '#f84',
      ));
      break;
    }
    case 34: { // Grant Maronary shaving
      const ok = addItem(player, 'maronary_shaving', 1);
      if (ok) publishMaronaryShavingAcquired(player, state, 'debug_grant');
      state.msgs.push(msg(ok ? '[MAR] зелёная стружка выдана' : '[MAR] нет места для стружки', state.time, ok ? '#fc4' : '#f84'));
      break;
    }
    case 35: { // Force Istotit variant + start (full scale)
      forceNextSamosborVariant('istotit');
      state.samosborTimer = 0;
      state.msgs.push(msg('[DEBUG] Следующий самосбор: Истотит (глобальный)', state.time, '#d6a64b'));
      break;
    }
    case 36: return { type: 'teleport_procedural_anomaly', anomalyId: 'smog' };
    case 37: return { type: 'teleport_procedural_anomaly', anomalyId: 'false_safe_block' };
    case 38: return { type: 'teleport_procedural_anomaly', anomalyId: 'hladon' };
    case 39: { // Govnyak courier route choice
      const created = spawnGovnyakCourierContract(state, player);
      for (const line of summarizeContracts(state, 6)) state.msgs.push(msg(`[QUEST] ${line}`, state.time, created ? '#6cf' : '#888'));
      break;
    }
    case 40: { // Force pneumomail capsule
      for (const line of debugForcePneumomailCapsule(world, player, state)) {
        state.msgs.push(msg(`[PMAIL] ${line}`, state.time, '#8cf'));
      }
      break;
    }
    case 41: { // Force hermodoor borer QA route
      for (const line of debugForceHermodoorBorer(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[BORER] ${line}`, state.time, '#fb6'));
      }
      break;
    }
    case 42: { // Force liquidator-cult clash
      state.msgs.push(msg(forceFactionEvent(state, world, player, entities, nextEntityId, 'cult_liquidator_clash'), state.time, '#ff0'));
      break;
    }
    case 43: { // Toggle Onepunchman cheat
      const enabled = toggleDebugOnePunchMan();
      if (enabled) keepDebugOnePunchManAlive(player);
      state.msgs.push(msg(
        `[DEBUG] ONEPUNCHMAN ${enabled ? 'включён' : 'выключен'}`,
        state.time,
        enabled ? '#ff0' : '#888',
      ));
      break;
    }
    case 44: { // Grant Net Terminal Gen access
      grantNetTerminalGenAccess(state);
      state.msgs.push(msg('[НЕТ-ГЕН] доступ выдан', state.time, '#63f6ff'));
      break;
    }
    case 45: { // Place generated terminals on current floor
      const count = placeNetTerminalGenTerminalsForCurrentFloor(world, state, { debug: true, max: 4, clearExisting: true, source: 'debug' });
      state.msgs.push(msg(`[НЕТ-ГЕН] терминалов: ${count}`, state.time, count > 0 ? '#63f6ff' : '#f84'));
      return { type: 'refresh_world_data' };
    }
    case 46: { // Place terminal in front of player
      const x = Math.floor(player.x + Math.cos(player.angle) * 1.5);
      const y = Math.floor(player.y + Math.sin(player.angle) * 1.5);
      const terminal = placeNetTerminalGenTerminal(world, x, y, undefined, 'debug');
      state.msgs.push(msg(terminal ? `[НЕТ-ГЕН] терминал ${terminal.x},${terminal.y}` : '[НЕТ-ГЕН] нет подходящей клетки', state.time, terminal ? '#63f6ff' : '#f84'));
      return { type: 'refresh_world_data' };
    }
    case 47: { // Open map editor
      state.showDebug = false;
      openMapEditor(world, player, state);
      break;
    }
    case 48: { // Net Terminal Gen and map editor status
      for (const line of summarizeNetTerminalGen(state, player)) state.msgs.push(msg(`[НЕТ-ГЕН] ${line}`, state.time, '#63f6ff'));
      for (const line of summarizeMapEditor(state)) state.msgs.push(msg(`[MAPEDIT] ${line}`, state.time, '#9fdbc6'));
      break;
    }
    case 49: { // Replay current map patch
      const applied = replayMapEditorPatchForCurrentFloor(world, entities, player, state, nextEntityId);
      state.msgs.push(msg(`[MAPEDIT] replay ${applied}`, state.time, applied > 0 ? '#9fdbc6' : '#888'));
      return { type: 'refresh_world_data' };
    }
    case 50: { // Clear current map patch
      const cleared = clearCurrentMapEditorPatch(state);
      state.msgs.push(msg(cleared ? '[MAPEDIT] patch cleared' : '[MAPEDIT] patch empty', state.time, cleared ? '#9fdbc6' : '#888'));
      break;
    }
    case 51: return { type: 'teleport_procedural_anomaly', anomalyId: 'fractal_floor' };
    case 52: return { type: 'teleport_procedural_anomaly', anomalyId: 'mirror_run' };
    case 53: return { type: 'teleport_procedural_anomaly', anomalyId: 'radio_chess' };
    case 54: return { type: 'teleport_procedural_anomaly', anomalyId: 'cement_memory' };
    case 55: return { type: 'teleport_procedural_anomaly', anomalyId: 'conveyor_sorter' };
    case 56: return { type: 'teleport_procedural_anomaly', anomalyId: 'wall_snake' };
    case 57: return { type: 'teleport_procedural_anomaly', anomalyId: 'section_shift' };
    case 58: return { type: 'teleport_procedural_anomaly', anomalyId: 'conway_life' };
    case 59: return { type: 'teleport_procedural_anomaly', anomalyId: 'rail_trains' };
    case 60: {
      for (const line of debugSpawnBadAppleWorld(world, player, state)) state.msgs.push(msg(`[BADAPPLE] ${line}`, state.time, '#fff'));
      return { type: 'refresh_world_data' };
    }
    case 61: { // Verification contract route
      for (const line of spawnDebugVerificationContract(state)) state.msgs.push(msg(`[CONTRACT-DEBUG] ${line}`, state.time, '#6cf'));
      break;
    }
    case 62: { // Publish verification event
      state.msgs.push(msg(`[EVENTS-DEBUG] ${publishDebugVerificationEvent(world, player, state)}`, state.time, '#ff0'));
      break;
    }
    case 63: { // Route floor summary
      for (const line of debugRouteFloorSummaryLines(world, player, entities, state)) state.msgs.push(msg(`[ROUTE] ${line}`, state.time, '#8cf'));
      break;
    }
    case 64: { // Arm current-floor numbered lift anomaly
      for (const line of armLocalFloorInstance(world, player, state)) state.msgs.push(msg(`[LIFT-DEBUG] ${line}`, state.time, '#f4a'));
      break;
    }
    case 65: { // Samosbor warning window
      state.msgs.push(msg(`[SAMOSBOR-DEBUG] ${setSamosborWarningWindow(state)}`, state.time, '#fa4'));
      break;
    }
    case 66: { // Economy scarcity pulse
      for (const line of applyDebugEconomyPulse(world, player, state)) state.msgs.push(msg(`[ECON-DEBUG] ${line}`, state.time, '#ccf'));
      break;
    }
    case 67: { // Floor-specific monster counterplay pack
      for (const line of spawnDebugMonsterPack(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[MON-DEBUG] ${line}`, state.time, '#f88'));
      }
      break;
    }
    case 68: { // Route to nearest useful container
      for (const line of routePlayerToNearestContainer(world, player, state)) state.msgs.push(msg(`[CONT-DEBUG] ${line}`, state.time, '#ccf'));
      break;
    }
    case 69: return { type: 'teleport_procedural_anomaly', anomalyId: 'zombie_apocalypse' };
    case 70: { // Expedition proof prep
      addItem(player, 'makarov', 1);
      addItem(player, 'ammo_9mm', 40);
      addItem(player, 'water', 2);
      addItem(player, 'bread', 2);
      addItem(player, 'bandage', 2);
      player.weapon = 'makarov';
      const created = spawnContractById(state, EXPEDITION_PROOF_CONTRACT_ID, ['debug_route', 'expedition_proof']);
      state.msgs.push(msg(`[EXPEDITION] prep kit=${player.weapon} contract=${created ? 'created' : 'existing'}`, state.time, '#6cf'));
      break;
    }
    case 71: { // Expedition proof lift ready
      const moved = movePlayerToSmokeLift(world, player, entities);
      state.msgs.push(msg(`[EXPEDITION] lift=${moved ? 'ready' : 'missing'}`, state.time, moved ? '#4f4' : '#f84'));
      break;
    }
    case 72: return { type: 'teleport_story_floor', floor: FloorLevel.MAINTENANCE };
    case 73: {
      state.msgs.push(msg(forceFactionEvent(state, world, player, entities, nextEntityId), state.time, '#ff0'));
      break;
    }
    case 74: {
      for (const line of routePlayerToNearestContainer(world, player, state)) state.msgs.push(msg(`[EXPEDITION] ${line}`, state.time, '#ccf'));
      break;
    }
    case 75: {
      state.msgs.push(msg(`[EXPEDITION] ${setSamosborWarningWindow(state)}`, state.time, '#fa4'));
      break;
    }
    case 76: return { type: 'teleport_story_floor', floor: FloorLevel.LIVING };
    case 77: {
      for (const line of debugStartSamosborWaveAtPlayer(world, player, entities, state, 'small')) {
        state.msgs.push(msg(`[SAMOSBOR-WAVE] ${line}`, state.time, '#c8f'));
      }
      return { type: 'refresh_world_data' };
    }
    case 78: {
      for (const line of grantDebugPermitPack(player)) state.msgs.push(msg(`[PERMIT] ${line}`, state.time, '#fc6'));
      break;
    }
    case 79: {
      for (const line of checkDebugPermitAccess(world, player, state)) state.msgs.push(msg(`[PERMIT] ${line}`, state.time, '#fc6'));
      break;
    }
    case 80: {
      for (const line of spoilDebugPermit(world, player, state)) state.msgs.push(msg(`[PERMIT] ${line}`, state.time, '#f84'));
      break;
    }
    case 81: {
      for (const line of debugForcePseudoliftNearPlayer(world, player, state)) {
        state.msgs.push(msg(`[PSEUDOLIFT] ${line}`, state.time, '#fc4'));
      }
      return { type: 'refresh_world_data' };
    }
    case 82: {
      for (const line of spawnDebugFalseCleanupPatrol(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[FALSE-CLEANUP] ${line}`, state.time, '#f84'));
      }
      return { type: 'refresh_world_data' };
    }
    case 83: {
      for (const line of spawnDebugMukhozhukHost(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[MUKHOZHUK] ${line}`, state.time, '#ce8'));
      }
      return { type: 'refresh_world_data' };
    }
    case 84: {
      for (const line of spawnDebugChervieSite(world, player, entities, state, nextEntityId)) {
        state.msgs.push(msg(`[CHERVIE] ${line}`, state.time, '#6f8'));
      }
      return { type: 'refresh_world_data' };
    }
    case 85: {
      const cells = revealWholeMap(world);
      state.msgs.push(msg(`[DEBUG] revealmap: открыто клеток ${cells}`, state.time, '#ff0'));
      break;
    }
    case 86: {
      if (!canSpawnEntityType(entities, EntityType.ITEM_DROP)) {
        state.msgs.push(msg('[DEBUG] лимит предметов: мелок не заспавнен', state.time, '#f84'));
        break;
      }
      entities.push({
        id: nextEntityId.v++,
        type: EntityType.ITEM_DROP,
        x: player.x + Math.cos(player.angle) * 1.4,
        y: player.y + Math.sin(player.angle) * 1.4,
        angle: 0,
        pitch: 0,
        alive: true,
        speed: 0,
        sprite: Spr.ITEM_DROP,
        inventory: [{ defId: CHALK_ITEM_ID, count: 1 }],
      });
      state.msgs.push(msg('[DEBUG] мелок заспавнен перед игроком', state.time, '#ff0'));
      break;
    }
    case 87: {
      state.msgs.push(msg(`[DEBUG] ${spawnDebugItemDropsAroundPlayer(world, player, entities, nextEntityId, debugPsiClotDrops(), 'ПСИ-сгустки')}`, state.time, '#ff0'));
      break;
    }
    case 88: {
      state.msgs.push(msg(`[DEBUG] ${spawnDebugItemDropsAroundPlayer(world, player, entities, nextEntityId, debugToolDrops(), 'инструменты')}`, state.time, '#ff0'));
      break;
    }
    case 89: {
      const def = MONSTERS[MonsterKind.SCULPTURE];
      const ang = player.angle;
      entities.push({
        id: nextEntityId.v++, type: EntityType.MONSTER,
        x: player.x + Math.cos(ang) * 4,
        y: player.y + Math.sin(ang) * 4,
        angle: ang + Math.PI, pitch: 0, alive: true,
        speed: def.speed, sprite: def.sprite,
        hp: def.hp, maxHp: def.hp,
        monsterKind: MonsterKind.SCULPTURE, attackCd: 0,
        ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
        rpg: randomRPG(player.rpg?.level ?? 1),
        phasing: false,
      });
      state.msgs.push(msg('[DEBUG] Скульптура заспавнена перед игроком', state.time, '#ff0'));
      break;
    }
  }
  return null;
}

/* ── Debug overlay rendering (fullscreen two-column) ─────────── */

const ZONE_FACTION_NAMES: Record<ZoneFaction, string> = {
  [ZoneFaction.CITIZEN]: 'Граждане',
  [ZoneFaction.LIQUIDATOR]: 'Ликвидаторы',
  [ZoneFaction.CULTIST]: 'Культисты',
  [ZoneFaction.SAMOSBOR]: 'Самосбор',
  [ZoneFaction.WILD]: 'Дикие',
  [ZoneFaction.SCIENTIST]: 'Учёные',
};

const BASE_CMD_DEFS = [
  { id: 'spawn_all_weapons', label: 'Всё оружие + патроны' },
  { id: 'spawn_monsters', label: 'Спавн монстров' },
  { id: 'spawn_npc', label: 'Спавн NPC' },
  { id: 'spawn_items', label: 'Все остальные предметы' },
  { id: 'grant_xp', label: '1 000 000 XP' },
  { id: 'cycle_samosbor_variant', label: 'Цикл варианта + самосбор' },
  { id: 'toggle_noclip', label: 'Noclip' },
  { id: 'recent_events', label: 'Последние события' },
  { id: 'economy_prices', label: 'Цены экономики' },
  { id: 'nearby_containers', label: 'Контейнеры рядом' },
  { id: 'take_from_container', label: 'Взять из контейнера' },
  { id: 'force_production_tick', label: 'Тик производства' },
  { id: 'spawn_system_contract', label: 'Системное задание: создать/список' },
  { id: 'balance_catalog', label: 'Баланс + каталог карманов' },
  { id: 'elevator_instances', label: 'Лифтовые инстансы' },
  { id: 'void_protocols', label: 'VOID: форс/список' },
  { id: 'faction_events', label: 'Фракционные события' },
  { id: 'force_faction_event', label: 'Форсировать событие фракции' },
  { id: 'force_cult_procession', label: 'Форсировать культовую процессию' },
  { id: 'samosbor_director_state', label: 'Директор: состояние' },
  { id: 'force_samosbor_director_beat', label: 'Директор: force beat' },
  { id: 'clear_samosbor_director_cooldowns', label: 'Директор: clear cooldown' },
  { id: 'teleport_ministry', label: 'ТП: Министерство' },
  { id: 'teleport_kvartiry', label: 'ТП: Квартиры' },
  { id: 'teleport_living', label: 'ТП: Жилая зона' },
  { id: 'teleport_maintenance', label: 'ТП: Коллекторы' },
  { id: 'teleport_hell', label: 'ТП: Мясной низ' },
  { id: 'teleport_void', label: 'ТП: Пустота' },
  { id: 'teleport_random_procedural', label: 'ТП: случайный процедурный' },
  { id: 'smoke_expedition_setup', label: 'Smoke: expedition setup' },
  { id: 'rare_samosbor', label: 'ВЕРЕТАР: force + самосбор' },
  { id: 'force_maronary_samosbor', label: 'МАРОНАРИЙ: force + самосбор' },
  { id: 'route_cue_nearest', label: 'Route cue: trigger nearest' },
  { id: 'force_maronary_wrong_door', label: 'МАРОНАРИЙ: wrong door' },
  { id: 'grant_maronary_shaving', label: 'МАРОНАРИЙ: выдать стружку' },
  { id: 'force_istotit_samosbor', label: 'ИСТОТИТ: force + самосбор' },
  { id: 'teleport_smog', label: 'ТП: говнячный смог' },
  { id: 'teleport_false_safe_block', label: 'ТП: тихий блок' },
  { id: 'teleport_hladon', label: 'ТП: хладон' },
  { id: 'govnyak_courier_contract', label: 'ГОВНЯК: курьерский пакет' },
  { id: 'force_pneumomail_capsule', label: 'ПНЕВМОПОЧТА: капсула' },
  { id: 'force_hermodoor_borer', label: 'ГЕРМО: точильщик QA' },
  { id: 'force_liquidator_cult_clash', label: 'Форсировать стычку ликвидаторов и культа' },
  { id: 'toggle_onepunchman', label: 'ONEPUNCHMAN' },
  { id: 'grant_net_terminal_gen_access', label: 'НЕТ-ГЕН: выдать доступ' },
  { id: 'place_net_terminal_gen_terminals', label: 'НЕТ-ГЕН: расставить терминалы' },
  { id: 'place_net_terminal_gen_in_front', label: 'НЕТ-ГЕН: терминал перед игроком' },
  { id: 'open_map_editor', label: 'РЕДАКТОР КАРТЫ: открыть' },
  { id: 'net_terminal_gen_status', label: 'НЕТ-ГЕН/РЕДАКТОР: статус' },
  { id: 'replay_current_map_patch', label: 'РЕДАКТОР КАРТЫ: повторить патч' },
  { id: 'clear_current_map_patch', label: 'РЕДАКТОР КАРТЫ: очистить патч' },
  { id: 'teleport_fractal_floor', label: 'ТП: фрактал' },
  { id: 'teleport_mirror_run', label: 'ТП: зеркало' },
  { id: 'teleport_radio_chess', label: 'ТП: радио-шахматы' },
  { id: 'teleport_cement_memory', label: 'ТП: цементная память' },
  { id: 'teleport_conveyor_sorter', label: 'ТП: конвейер' },
  { id: 'teleport_wall_snake', label: 'ТП: змейка' },
  { id: 'teleport_section_shift', label: 'ТП: секционный сдвиг' },
  { id: 'teleport_conway_life', label: 'ТП: игра жизнь' },
  { id: 'teleport_rail_trains', label: 'ТП: поезда' },
  { id: 'spawn_bad_apple_world', label: 'BAD APPLE: эксперимент отключён' },
  { id: 'verification_contract_route', label: 'VERIFY: контрактный маршрут' },
  { id: 'publish_verification_event', label: 'VERIFY: событие в лог/слух' },
  { id: 'route_floor_summary', label: 'ROUTE: floor summary' },
  { id: 'arm_floor_instance', label: 'VERIFY: номерная петля лифта' },
  { id: 'samosbor_warning_window', label: 'VERIFY: окно предупреждения самосбора' },
  { id: 'economy_scarcity_pulse', label: 'VERIFY: дефицит экономики' },
  { id: 'floor_monster_pack', label: 'VERIFY: монстры этажа' },
  { id: 'route_to_container', label: 'VERIFY: маршрут к контейнеру' },
  { id: 'teleport_zombie_apocalypse', label: 'ТП: зомби-апокалипсис' },
  { id: 'expedition_proof_prep', label: 'EXPEDITION: подготовка' },
  { id: 'expedition_proof_lift_ready', label: 'EXPEDITION: лифт готов' },
  { id: 'expedition_proof_collectors_arrival', label: 'EXPEDITION: прибытие в Коллекторы' },
  { id: 'expedition_proof_risk', label: 'EXPEDITION: риск маршрута' },
  { id: 'expedition_proof_container', label: 'EXPEDITION: контейнер маршрута' },
  { id: 'expedition_proof_samosbor_warning', label: 'EXPEDITION: предупреждение самосбора' },
  { id: 'expedition_proof_return', label: 'EXPEDITION: возврат домой' },
  { id: 'debug_samosbor_small_wave', label: 'SAMOSBOR: малая волна у игрока' },
  { id: 'grant_permit_pack', label: 'PERMIT: выдать пакет' },
  { id: 'check_permit_access', label: 'PERMIT: проверить доступ' },
  { id: 'spoil_permit', label: 'PERMIT: испортить пропуск' },
  { id: 'force_pseudolift', label: 'PSEUDOLIFT: ловушка у лифта' },
  { id: 'debug_false_cleanup_patrol', label: 'SAMOSBOR: ложная зачистка' },
  { id: 'debug_mukhozhuk_host', label: 'MUKHOZHUK: носитель у игрока' },
  { id: 'debug_chervie_site', label: 'CHERVIE: экранный узел' },
  { id: 'revealmap', label: 'REVEALMAP: открыть всю карту' },
  { id: 'spawn_chalk', label: 'DEBUG: спавн мелка' },
  { id: 'spawn_all_psi', label: 'Все ПСИ-сгустки' },
  { id: 'spawn_all_tools', label: 'Все инструменты' },
  { id: 'spawn_sculpture', label: 'Спавн Скульптуры' },
] as const satisfies readonly DebugCommandDef[];

const BASE_CMD_VISUAL_BEFORE_DESIGN = [
  'spawn_all_weapons',
  'spawn_all_psi',
  'spawn_all_tools',
  'spawn_items',
  'grant_xp',
  'toggle_noclip',
  'revealmap',
  'toggle_onepunchman',
  'grant_net_terminal_gen_access',
  'place_net_terminal_gen_terminals',
  'place_net_terminal_gen_in_front',
  'open_map_editor',
  'net_terminal_gen_status',
  'replay_current_map_patch',
  'clear_current_map_patch',
  'grant_permit_pack',
  'check_permit_access',
  'spoil_permit',
  'spawn_monsters',
  'floor_monster_pack',
  'spawn_npc',
  'spawn_chalk',
  'spawn_bad_apple_world',
  'debug_samosbor_small_wave',
  'debug_false_cleanup_patrol',
  'debug_mukhozhuk_host',
  'debug_chervie_site',
  'teleport_living',
  'teleport_ministry',
  'teleport_kvartiry',
  'teleport_maintenance',
  'teleport_hell',
  'teleport_void',
  'teleport_random_procedural',
  'teleport_smog',
  'teleport_false_safe_block',
  'teleport_hladon',
  'teleport_fractal_floor',
  'teleport_mirror_run',
  'teleport_radio_chess',
  'teleport_cement_memory',
  'teleport_conveyor_sorter',
  'teleport_wall_snake',
  'teleport_section_shift',
  'teleport_conway_life',
  'teleport_rail_trains',
  'teleport_zombie_apocalypse',
] as const satisfies readonly BaseDebugCommandId[];

const BASE_CMD_VISUAL_AFTER_DESIGN = [
  'cycle_samosbor_variant',
  'rare_samosbor',
  'force_maronary_samosbor',
  'force_istotit_samosbor',
  'samosbor_director_state',
  'force_samosbor_director_beat',
  'clear_samosbor_director_cooldowns',
  'samosbor_warning_window',
  'recent_events',
  'faction_events',
  'force_faction_event',
  'force_cult_procession',
  'force_liquidator_cult_clash',
  'publish_verification_event',
  'economy_prices',
  'economy_scarcity_pulse',
  'force_production_tick',
  'nearby_containers',
  'take_from_container',
  'route_to_container',
  'balance_catalog',
  'elevator_instances',
  'route_floor_summary',
  'arm_floor_instance',
  'force_pseudolift',
  'spawn_system_contract',
  'govnyak_courier_contract',
  'verification_contract_route',
  'smoke_expedition_setup',
  'expedition_proof_prep',
  'expedition_proof_lift_ready',
  'expedition_proof_collectors_arrival',
  'expedition_proof_risk',
  'expedition_proof_container',
  'expedition_proof_samosbor_warning',
  'expedition_proof_return',
  'void_protocols',
  'route_cue_nearest',
  'force_maronary_wrong_door',
  'grant_maronary_shaving',
  'force_pneumomail_capsule',
  'force_hermodoor_borer',
  'spawn_sculpture',
] as const satisfies readonly BaseDebugCommandId[];

function designFloorCommandId(id: DesignFloorId): DebugCommandId {
  return `${DESIGN_FLOOR_COMMAND_ID_PREFIX}${id}` as DebugCommandId;
}

const DESIGN_FLOOR_COMMAND_START = BASE_CMD_DEFS.length;
const BASE_CMD_DEF_BY_ID = new Map<BaseDebugCommandId, DebugCommandDef>();
const BASE_CMD_EXEC_INDEX_BY_ID = new Map<BaseDebugCommandId, number>();
for (let i = 0; i < BASE_CMD_DEFS.length; i++) {
  BASE_CMD_DEF_BY_ID.set(BASE_CMD_DEFS[i].id, BASE_CMD_DEFS[i]);
  BASE_CMD_EXEC_INDEX_BY_ID.set(BASE_CMD_DEFS[i].id, i);
}

function commandDef(id: BaseDebugCommandId): DebugCommandDef {
  const def = BASE_CMD_DEF_BY_ID.get(id);
  if (!def) throw new Error(`Unknown debug command id: ${id}`);
  return def;
}

const CMD_DEFS: readonly DebugCommandDef[] = [
  ...BASE_CMD_VISUAL_BEFORE_DESIGN.map(commandDef),
  ...DESIGN_FLOOR_ROUTES.map(def => ({
    id: designFloorCommandId(def.id),
    label: `ТП: ${def.displayName} (${def.z > 0 ? `+${def.z}` : def.z})`,
  })),
  ...BASE_CMD_VISUAL_AFTER_DESIGN.map(commandDef),
];
const CMD_LABELS = CMD_DEFS.map(def => def.label);
const DEBUG_COMMAND_INDEX_BY_ID = new Map<DebugCommandId, number>();
for (let i = 0; i < CMD_DEFS.length; i++) DEBUG_COMMAND_INDEX_BY_ID.set(CMD_DEFS[i].id, i);

export const DEBUG_COMMAND_COUNT = CMD_LABELS.length;

function designFloorCommandIndex(id: DebugCommandId): number {
  if (!id.startsWith(DESIGN_FLOOR_COMMAND_ID_PREFIX)) return -1;
  const designId = id.slice(DESIGN_FLOOR_COMMAND_ID_PREFIX.length) as DesignFloorId;
  const idx = DESIGN_FLOOR_ROUTES.findIndex(def => def.id === designId);
  return idx < 0 ? -1 : DESIGN_FLOOR_COMMAND_START + idx;
}

function debugCommandExecutionIndex(displayIdx: number): number {
  const def = CMD_DEFS[displayIdx];
  if (!def) return -1;
  const designIdx = designFloorCommandIndex(def.id);
  if (designIdx >= 0) return designIdx;
  return BASE_CMD_EXEC_INDEX_BY_ID.get(def.id as BaseDebugCommandId) ?? -1;
}

export function getDebugCommandIds(): readonly DebugCommandId[] {
  return CMD_DEFS.map(def => def.id);
}

export function getDebugCommandIndex(id: DebugCommandId): number {
  return DEBUG_COMMAND_INDEX_BY_ID.get(id) ?? -1;
}

declare global {
  interface Window {
    __gigahrushDebugCommandIndex?: (id: DebugCommandId) => number;
    __gigahrushDebugCommandIds?: () => readonly DebugCommandId[];
  }
}

if (typeof window !== 'undefined') {
  window.__gigahrushDebugCommandIndex = getDebugCommandIndex;
  window.__gigahrushDebugCommandIds = getDebugCommandIds;
}

interface DebugInfoLine {
  text: string;
  color: string;
}

let debugInfoPage = 0;

export function moveDebugInfoPage(delta: number): void {
  debugInfoPage = Math.max(0, debugInfoPage + delta);
}

export function resetDebugInfoPage(): void {
  debugInfoPage = 0;
}

export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  w: number, h: number,
  world: World,
  entities: Entity[],
  state: GameState,
  debugSel: number,
): void {
  const uiScale = Math.max(0.8, Math.min(4.2, Math.min(sx, sy)));
  sx = uiScale;
  sy = uiScale;

  /* ── Gather stats ─────────────────────────────────────────── */
  let totalAlive = 0;
  let totalItems = 0;
  // Count all living entities (NPC + monsters) by faction
  // Monsters get their own "faction" slot = 99
  const MONSTER_SLOT = 99;
  const factionCount: Record<number, number> = {};

  for (const e of entities) {
    if (!e.alive) continue;
    if (e.type === EntityType.NPC) {
      totalAlive++;
      factionCount[e.faction ?? -1] = (factionCount[e.faction ?? -1] || 0) + 1;
    } else if (e.type === EntityType.MONSTER) {
      totalAlive++;
      factionCount[MONSTER_SLOT] = (factionCount[MONSTER_SLOT] || 0) + 1;
    } else if (e.type === EntityType.ITEM_DROP) {
      totalItems++;
    }
  }

  // Territory cells per owner
  const zoneFactionCells: Record<number, number> = {};
  for (let i = 0; i < W * W; i++) {
    const f = territoryOwnerAtIndex(world, i);
    zoneFactionCells[f] = (zoneFactionCells[f] || 0) + 1;
  }

  let funcRooms = 0;
  for (const r of world.rooms) if (r && r.type !== RoomType.CORRIDOR) funcRooms++;
  let lifts = 0, liftsUp = 0, liftsDown = 0;
  for (let i = 0; i < W * W; i++) if (world.cells[i] === Cell.LIFT) {
    lifts++;
    if (world.liftDir[i] === LiftDirection.UP) liftsUp++; else liftsDown++;
  }

  /* ── Layout ───────────────────────────────────────────────── */
  const fs = Math.round(7 * sy);
  const lh = Math.round(10 * sy);
  const pad = 12 * sx;
  const margin = 6 * sx;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.98)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 1 * sx;
  ctx.strokeRect(margin, margin, w - margin * 2, h - margin * 2);

  ctx.font = `${fs}px monospace`;
  ctx.textBaseline = 'top';

  // Divider at 55% width
  const divX = Math.round(w * 0.55);
  ctx.strokeStyle = 'rgba(255,255,0,0.2)';
  ctx.beginPath();
  ctx.moveTo(divX, margin);
  ctx.lineTo(divX, h - margin);
  ctx.stroke();

  /* ── Left column ──────────────────────────────────────────── */
  const lx = margin + pad;
  const leftTop = margin + pad;
  const leftHintY = h - margin - pad - lh * 1.4;
  const leftMaxW = Math.max(20 * sx, divX - lx - pad);
  const infoLines: DebugInfoLine[] = [];
  const row = (t: string, c: string) => {
    infoLines.push({ text: t, color: c });
  };
  const gap = () => { infoLines.push({ text: '', color: '#000' }); };

  row(`Существа: ${totalAlive}  Предметы: ${totalItems}`, '#aaa');
  row(`Комнаты: ${funcRooms}  Лифты: ${lifts} (↑${liftsUp} ↓${liftsDown})`, '#aaa');
  row(`Noclip: ${isDebugNoClipEnabled() ? 'ON' : 'OFF'}`, isDebugNoClipEnabled() ? '#ff0' : '#666');
  row(`ONEPUNCHMAN: ${isDebugOnePunchManEnabled() ? 'ON' : 'OFF'}`, isDebugOnePunchManEnabled() ? '#ff0' : '#666');
  const ai = getAiStats();
  row(`AI: live ${ai.liveAi} upd ${ai.updated} npc ${ai.updatedNpc} mob ${ai.updatedMonster} skip ${ai.skipped}`, '#9cf');
  row(`AI факт: plot ${ai.plot} boss ${ai.bosses} atk ${ai.activeAttackers} proj ${ai.projectileOwners}/${ai.projectiles}`, '#9cf');
  for (const line of summarizeFloorRun(state).slice(0, 2)) row(`Этажи: ${line}`, '#8cf');
  const playerEntity = entities.find(e => isPlayerEntity(e));
  for (const line of summarizeRoomMemoryForRoom(state.currentFloor, playerEntity ? currentPlayerRoom(world, playerEntity) : undefined)) row(line, '#dc9');
  for (const line of summarizeProceduralSmog(world, state).slice(0, 2)) row(`Смог: ${line}`, '#b98');
  for (const line of summarizeBadAppleWorld(world).slice(0, 2)) row(`BadApple: ${line}`, '#eee');
  for (const line of summarizeFloorInstances(state).slice(0, 2)) row(`Лифт: ${line}`, '#f4a');
  for (const line of pseudoliftDebugSummary(state).slice(0, 2)) row(`Псевдолифт: ${line}`, '#fc4');
  for (const line of getSamosborDebugLines()) row(line, '#9cf');
  gap();

  // All factions — unified: NPC factions + monsters
  row('Фракции', '#ff0');
  for (let f = 0; f <= 4; f++) {
    const name = FACTION_NAMES[f as Faction] ?? `#${f}`;
    row(`  ${name}: ${factionCount[f] || 0}`, '#bbb');
  }
  row(`  Монстры: ${factionCount[MONSTER_SLOT] || 0}`, '#c66');
  gap();

  // Territory
  row('Территория', '#ff0');
  const zfOrder = [ZoneFaction.CITIZEN, ZoneFaction.LIQUIDATOR, ZoneFaction.CULTIST, ZoneFaction.SCIENTIST, ZoneFaction.WILD, ZoneFaction.SAMOSBOR];
  for (const zf of zfOrder) {
    row(`  ${ZONE_FACTION_NAMES[zf]}: ${zoneFactionCells[zf] || 0}`, '#bbb');
  }

  const leftRows = Math.max(1, Math.floor((leftHintY - leftTop - lh * 0.4) / lh));
  const leftPageCount = Math.max(1, Math.ceil(infoLines.length / leftRows));
  debugInfoPage = Math.max(0, Math.min(leftPageCount - 1, debugInfoPage));
  const leftStart = debugInfoPage * leftRows;
  const leftEnd = Math.min(infoLines.length, leftStart + leftRows);
  let y = leftTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin + 1 * sx, leftTop - sy, Math.max(1, divX - margin - 2 * sx), Math.max(lh, leftHintY - leftTop));
  ctx.clip();

  for (let i = leftStart; i < leftEnd; i++) {
    const line = infoLines[i];
    if (line.text) {
      ctx.fillStyle = line.color;
      ctx.fillText(fitText(ctx, line.text, leftMaxW), lx, y);
    }
    y += lh;
  }
  ctx.restore();

  ctx.fillStyle = '#555';
  ctx.fillText(
    fitText(ctx, `${controlBindingLabel('menuLeft')}/${controlBindingLabel('menuRight')} инфо ${debugInfoPage + 1}/${leftPageCount}`, leftMaxW),
    lx,
    leftHintY + lh * 0.6,
  );

  /* ── Right column: commands ───────────────────────────────── */
  const rx = divX + pad;
  const commandTop = margin + pad;
  const hintY = h - margin - pad - lh * 2;
  const visibleRows = Math.max(1, Math.floor((hintY - commandTop - lh * 0.5) / lh));
  const maxStart = Math.max(0, CMD_LABELS.length - visibleRows);
  const scrollStart = Math.min(maxStart, Math.max(0, debugSel - Math.floor(visibleRows * 0.5)));
  const scrollEnd = Math.min(CMD_LABELS.length, scrollStart + visibleRows);
  let ry = commandTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(divX + 2 * sx, commandTop - sy, w - divX - margin - 4 * sx, Math.max(lh, hintY - commandTop));
  ctx.clip();

  for (let i = scrollStart; i < scrollEnd; i++) {
    const sel = i === debugSel;
    const label = fitText(ctx, `${sel ? '▸' : ' '} ${i + 1}. ${CMD_LABELS[i]}`, w - rx - margin - 12 * sx);
    if (sel) {
      ctx.fillStyle = 'rgba(255,255,0,0.12)';
      ctx.fillRect(divX + 2 * sx, ry - 1 * sy, w - divX - margin - 4 * sx, lh);
      ctx.fillStyle = '#ff0';
      ctx.fillText(label, rx, ry);
    } else {
      ctx.fillStyle = '#ccc';
      ctx.fillText(label, rx, ry);
    }
    ry += lh;
  }
  ctx.restore();

  if (CMD_LABELS.length > visibleRows) {
    const trackX = w - margin - 6 * sx;
    const trackY = commandTop;
    const trackH = Math.max(lh, hintY - commandTop);
    const thumbH = Math.max(lh, trackH * (visibleRows / CMD_LABELS.length));
    const thumbY = trackY + (trackH - thumbH) * (scrollStart / Math.max(1, maxStart));
    ctx.fillStyle = 'rgba(255,255,0,0.14)';
    ctx.fillRect(trackX, trackY, 2 * sx, trackH);
    ctx.fillStyle = '#ff0';
    ctx.fillRect(trackX, thumbY, 2 * sx, thumbH);
  }

  // Hints pinned to bottom-right
  ry = hintY + lh * 0.6;
  ctx.fillStyle = '#555';
  const range = CMD_LABELS.length > visibleRows ? ` ${scrollStart + 1}-${scrollEnd}/${CMD_LABELS.length}` : '';
  ctx.fillText(fitText(ctx, `${controlBindingLabel('menuUp')}/${controlBindingLabel('menuDown')}${range}  ${controlBindingLabel('gameMenu')} выбрать  ${controlBindingLabel('debug')}/${menuCloseHint()} закрыть`, w - rx - margin), rx, ry);
}
