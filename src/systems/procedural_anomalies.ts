/* ── Runtime hooks for bounded procedural floor anomalies ─────── */

import {
  W,
  Cell,
  type Entity,
  type GameState,
  type Room,
  type WorldEventSeverity,
  Feature,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import {
  FALSE_SAFE_BLOCK_DISCOVERED,
  FALSE_SAFE_BLOCK_RESOLVED,
  FALSE_SAFE_BLOCK_ROOM_PREFIX,
  FALSE_SAFE_BLOCK_TAG,
  anomalyById,
  type ProceduralFloorSpec,
} from '../data/procedural_floors';
import { consumeToolDurability, hasItem, removeItem } from './inventory';
import { publishEvent } from './events';
import { currentProceduralFloorSpec } from './procedural_floors';
import { updateCementMemoryAnomaly, tryUseCementMemoryAnomaly } from './procedural_anomalies/cement_memory';
import { updateConveyorSorterAnomaly, tryUseConveyorSorterAnomaly } from './procedural_anomalies/conveyor_sorter';
import { updateConwayLifeAnomaly, tryUseConwayLifeAnomaly } from './procedural_anomalies/conway_life';
import {
  badAppleWorldInteractionTargetId,
  tryUseBadAppleWorldAnomaly,
  updateBadAppleWorldAnomaly,
} from './procedural_anomalies/bad_apple_world';
import {
  livingTunnelsInteractionTargetId,
  tryUseLivingTunnelsAnomaly,
  updateLivingTunnelsAnomaly,
} from './procedural_anomalies/living_tunnels';
import { updateRadioChessAnomaly, tryUseRadioChessAnomaly } from './procedural_anomalies/radio_chess';
import {
  sandpilePerekrytieInteractionTargetId,
  tryUseSandpilePerekrytieAnomaly,
  updateSandpilePerekrytieAnomaly,
} from './procedural_anomalies/sandpile_perekrytie';
import { updateSectionShiftAnomaly, tryUseSectionShiftAnomaly } from './procedural_anomalies/section_shift';
import { updateWallSnakeAnomaly, tryUseWallSnakeAnomaly } from './procedural_anomalies/wall_snake';
import { isPlayerEntity } from './player_actor';

type SmogProtection = 'filter' | 'wet_cloth' | 'cloth_ready' | 'none';

interface SmogRuntime {
  runtimeKey: string;
  sourceIdx: number;
  wasInside: boolean;
  pressureAccum: number;
  lastMsgTime: number;
  sourceFound: boolean;
  wetClothUntil: number;
  filterWear: number;
}

export interface ProceduralSmogStatus {
  active: boolean;
  handled: boolean;
  inside: boolean;
  intensity: number;
  sourceDistance: number;
  sourceFound: boolean;
  protection: SmogProtection;
  prompt: string;
}

const WET_CLOTH_SECONDS = 75;
const WET_RAG_BUNDLE_ITEM = 'wet_rag_bundle';
const WET_RAG_BUNDLE_SECONDS = 45;
const PRESSURE_TICK_SECONDS = 2.5;
const FILTER_WEAR_UNITS = 42;
const SMOG_ENTER_FOG = 64;
const WATER_FOR_CLOTH = ['water', 'filtered_water', 'metal_water', 'boiler_water'];
const TELEPORT_COUNTER_ITEMS = ['lift_scheme', 'elevator_access_order'] as const;
const TELEPORT_COUNTER_TOOL = 'radio';
const FALSE_SAFE_RUMOR_IDS = ['faction_cultist_after_fog'];
const smogRuntimeByState = new WeakMap<GameState, SmogRuntime>();
interface DynamicTopologyTags {
  livingTunnels: boolean;
  wallSnake: boolean;
  sectionShift: boolean;
  sandpilePerekrytie: boolean;
}

const dynamicTopologyTagsByWorld = new WeakMap<World, DynamicTopologyTags>();

function dynamicTopologyTags(world: World): DynamicTopologyTags {
  const cached = dynamicTopologyTagsByWorld.get(world);
  if (cached) return cached;
  const tags: DynamicTopologyTags = { livingTunnels: false, wallSnake: false, sectionShift: false, sandpilePerekrytie: false };
  for (const room of world.rooms) {
    const name = room?.name ?? '';
    if (name.includes('[living_tunnel:')) tags.livingTunnels = true;
    if (name.includes('[wall_snake:')) tags.wallSnake = true;
    if (name.includes('[section_shift:')) tags.sectionShift = true;
    if (name.includes('[sandpile_perekrytie:')) tags.sandpilePerekrytie = true;
    if (tags.livingTunnels && tags.wallSnake && tags.sectionShift && tags.sandpilePerekrytie) break;
  }
  dynamicTopologyTagsByWorld.set(world, tags);
  return tags;
}

function anomalyTags(spec: ProceduralFloorSpec): string[] {
  const tags = ['anomaly', `anomaly_${spec.anomalyId}`];
  if (spec.anomalyId === 'false_safe_block') tags.push(FALSE_SAFE_BLOCK_TAG, 'cult', 'shelter');
  if (spec.anomalyId === 'smog') tags.push('smog', 'visibility', 'govnyak', 'contraband');
  if (spec.anomalyId === 'samosbor_seed') tags.push('samosbor', 'fog');
  if (spec.anomalyId === 'teleport_cells') tags.push('topology');
  if (spec.anomalyId === 'mushroom_mycelium') tags.push('mushroom');
  if (spec.anomalyId === 'hladon') tags.push('cold', 'hladon', 'heat_counter');
  if (spec.anomalyId === 'fractal_floor') tags.push('fractal', 'maze', 'topology', 'documents');
  if (spec.anomalyId === 'mirror_run') tags.push('mirror', 'duality', 'teleport', 'loot');
  if (spec.anomalyId === 'radio_chess') tags.push('pattern', 'radio', 'timing', 'movement');
  if (spec.anomalyId === 'cement_memory') tags.push('trail', 'pressure', 'no_backtracking', 'samosbor');
  if (spec.anomalyId === 'conveyor_sorter') tags.push('conveyor', 'items', 'industrial', 'movement');
  if (spec.anomalyId === 'wall_snake') tags.push('moving_walls', 'predator', 'crush', 'loot_sink');
  if (spec.anomalyId === 'living_tunnels') tags.push('living_tunnels', 'topology', 'moving_walls', 'repair', 'route_pressure');
  if (spec.anomalyId === 'section_shift') tags.push('topology', 'moving_rooms', 'crush', 'toroid');
  if (spec.anomalyId === 'conway_life') tags.push('cellular', 'topology', 'moving_walls', 'math');
  if (spec.anomalyId === 'rail_trains') tags.push('rail', 'transit', 'crush', 'industrial');
  if (spec.anomalyId === 'bad_apple_world') tags.push('video', 'screen', 'topology', 'cult_media');
  if (spec.anomalyId === 'zombie_apocalypse') tags.push('zombie', 'crowd', 'infection', 'quarantine');
  if (spec.anomalyId === 'sandpile_perekrytie') tags.push('topology', 'collapse', 'crush', 'pressure', 'industrial');
  return tags;
}

export function proceduralAnomalyEventTags(spec: ProceduralFloorSpec | undefined): string[] {
  if (!spec || spec.anomalyId === 'none') return [];
  return anomalyTags(spec);
}

export function proceduralAnomalyEventData(spec: ProceduralFloorSpec | undefined): Record<string, unknown> {
  if (!spec || spec.anomalyId === 'none') return {};
  const def = anomalyById(spec.anomalyId);
  return {
    proceduralAnomaly: spec.anomalyId,
    proceduralAnomalyTitle: def.title,
    proceduralKey: spec.key,
    floorZ: spec.z,
    danger: spec.danger,
    ...(spec.anomalyId === 'false_safe_block' ? { rumorIds: FALSE_SAFE_RUMOR_IDS } : {}),
  };
}

function smogRuntimeKey(state: GameState): string {
  const spec = currentProceduralFloorSpec(state);
  if (!spec) return `floor:${state.currentFloor}`;
  return `${spec.key}:${spec.z}:${spec.seed}:${spec.anomalyId}`;
}

function runtimeFor(state: GameState, world: World): SmogRuntime {
  const runtimeKey = smogRuntimeKey(state);
  const current = smogRuntimeByState.get(state);
  if (current && current.runtimeKey === runtimeKey && current.sourceIdx === world.anomalySmogSource) return current;
  const next: SmogRuntime = {
    runtimeKey,
    sourceIdx: world.anomalySmogSource,
    wasInside: false,
    pressureAccum: 0,
    lastMsgTime: -Infinity,
    sourceFound: false,
    wetClothUntil: 0,
    filterWear: 0,
  };
  smogRuntimeByState.set(state, next);
  return next;
}

function currentWaterForCloth(player: Entity): string {
  for (const id of WATER_FOR_CLOTH) if (hasItem(player, id)) return id;
  return '';
}

function protectionFor(player: Entity, state: GameState, runtime: SmogRuntime, autoPrepare: boolean): SmogProtection {
  if (hasItem(player, 'gasmask_filter')) return 'filter';
  if (runtime.wetClothUntil > state.time) return 'wet_cloth';
  if (hasItem(player, WET_RAG_BUNDLE_ITEM)) {
    if (!autoPrepare) return 'cloth_ready';
    if (removeItem(player, WET_RAG_BUNDLE_ITEM, 1)) {
      const item = ITEMS[WET_RAG_BUNDLE_ITEM];
      runtime.wetClothUntil = state.time + WET_RAG_BUNDLE_SECONDS;
      publishEvent(state, {
        type: 'player_use_item',
        zoneId: playerZoneId(player),
        x: player.x,
        y: player.y,
        actorId: player.id,
        actorName: player.name ?? 'Вы',
        actorFaction: player.faction,
        itemId: WET_RAG_BUNDLE_ITEM,
        itemName: item?.name ?? 'Мокрые тряпки',
        itemCount: 1,
        itemValue: item?.value ?? 0,
        severity: 2,
        privacy: 'private',
        tags: ['player', 'inventory', 'smog', 'wet_cloth', 'wet_rag_bundle', 'spent'],
        data: { durationSeconds: WET_RAG_BUNDLE_SECONDS },
      });
      state.msgs.push(msg('Мокрые тряпки прижаты к лицу. Этого хватит только на короткий рывок.', state.time, '#9cf'));
      return 'wet_cloth';
    }
  }
  const waterId = currentWaterForCloth(player);
  if (!hasItem(player, 'cloth_roll') || !waterId) return 'none';
  if (!autoPrepare) return 'cloth_ready';

  removeItem(player, 'cloth_roll', 1);
  removeItem(player, waterId, 1);
  runtime.wetClothUntil = state.time + WET_CLOTH_SECONDS;
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: playerZoneId(player),
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: 'cloth_roll',
    itemName: 'Влажная ткань',
    itemCount: 1,
    itemValue: 0,
    severity: 2,
    privacy: 'private',
    tags: ['player', 'inventory', 'smog', 'wet_cloth'],
    data: { waterId, durationSeconds: WET_CLOTH_SECONDS },
  });
  state.msgs.push(msg('Ткань смочена и прижата к лицу. Смог стал терпимее.', state.time, '#9cf'));
  return 'wet_cloth';
}

function playerZoneId(player: Entity, world?: World): number | undefined {
  if (!world) return undefined;
  return world.zoneMap[world.idx(Math.floor(player.x), Math.floor(player.y))];
}

function countItem(player: Entity, defId: string): number {
  let count = 0;
  for (const item of player.inventory ?? []) {
    if (item.defId === defId) count += item.count;
  }
  return count;
}

function wearSmogFilter(world: World, player: Entity, state: GameState, runtime: SmogRuntime, intensity: number): void {
  runtime.filterWear += 0.75 + intensity;
  if (runtime.filterWear < FILTER_WEAR_UNITS) return;
  runtime.filterWear -= FILTER_WEAR_UNITS;
  if (!removeItem(player, 'gasmask_filter', 1)) {
    runtime.filterWear = 0;
    return;
  }

  const remaining = countItem(player, 'gasmask_filter');
  const item = ITEMS.gasmask_filter;
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: playerZoneId(player, world),
    roomId: world.roomMap[world.idx(Math.floor(player.x), Math.floor(player.y))],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: 'gasmask_filter',
    itemName: item.name,
    itemCount: 1,
    itemValue: item.value,
    severity: 3,
    privacy: 'private',
    tags: ['player', 'inventory', 'smog', 'filter', 'spent'],
    data: {
      reason: 'smog_exposure',
      remainingFilters: remaining,
    },
  });
  state.msgs.push(msg(
    remaining > 0
      ? `Фильтр намок и ушёл в расход. Осталось: ${remaining}.`
      : 'Фильтр намок и ушёл в расход. Дальше только обход или влажная ткань.',
    state.time,
    '#9cf',
  ));
}

function sourcePosition(world: World): { x: number; y: number } {
  const idx = world.anomalySmogSource;
  return { x: idx % W, y: (idx / W) | 0 };
}

function isCurrentSmogFloor(state: GameState): boolean {
  return currentProceduralFloorSpec(state)?.anomalyId === 'smog';
}

function publishSmogEvent(
  state: GameState,
  world: World,
  player: Entity,
  type: 'smog_entered' | 'smog_source_found' | 'smog_source_handled',
  severity: WorldEventSeverity,
  tags: string[],
  data: Record<string, unknown>,
): void {
  const spec = currentProceduralFloorSpec(state);
  publishEvent(state, {
    type,
    zoneId: playerZoneId(player, world),
    roomId: world.roomMap[world.idx(Math.floor(player.x), Math.floor(player.y))],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy: 'local',
    tags: ['smog', 'procedural', spec?.key ?? 'procedural_floor', ...tags],
    data: {
      floorZ: spec?.z,
      danger: spec?.danger,
      anomalyId: spec?.anomalyId,
      sourceIdx: world.anomalySmogSource,
      ...data,
    },
  });
}

function teleportCounterItemId(player: Entity): string {
  if (player.tool === TELEPORT_COUNTER_TOOL && hasItem(player, TELEPORT_COUNTER_TOOL)) return TELEPORT_COUNTER_TOOL;
  for (const id of TELEPORT_COUNTER_ITEMS) if (hasItem(player, id)) return id;
  return '';
}

function publishTeleportCellsEvent(
  state: GameState,
  world: World,
  player: Entity,
  counterId: string,
  sourceIdx: number,
  targetIdx: number,
): void {
  const spec = currentProceduralFloorSpec(state);
  const item = ITEMS[counterId];
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: playerZoneId(player, world),
    roomId: world.roomMap[world.idx(Math.floor(player.x), Math.floor(player.y))],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: counterId,
    itemName: item?.name ?? counterId,
    itemCount: 1,
    itemValue: item?.value ?? 0,
    severity: 3,
    privacy: 'local',
    tags: ['player', 'procedural', 'anomaly', 'teleport_cells', 'route_anchor', counterId],
    data: {
      proceduralKey: spec?.key,
      floorZ: spec?.z,
      danger: spec?.danger,
      sourceIdx,
      targetIdx,
    },
  });
}

export function getProceduralSmogStatus(world: World, player: Entity, state: GameState): ProceduralSmogStatus {
  const runtime = runtimeFor(state, world);
  const active = isCurrentSmogFloor(state) && world.anomalySmogSource >= 0;
  const pci = world.idx(Math.floor(player.x), Math.floor(player.y));
  const intensity = active ? world.fog[pci] / 255 : 0;
  const source = active ? sourcePosition(world) : { x: player.x, y: player.y };
  const sourceDistance = active ? world.dist(player.x, player.y, source.x + 0.5, source.y + 0.5) : Infinity;
  const protection = protectionFor(player, state, runtime, false);
  const inside = active && !world.anomalySmogHandled && world.fog[pci] >= SMOG_ENTER_FOG;
  const prompt = active && !world.anomalySmogHandled && sourceDistance <= 2.4
    ? 'E: перекрыть источник смога'
    : inside
      ? protection === 'filter'
        ? 'фильтр держит смог'
        : protection === 'wet_cloth'
          ? 'влажная ткань спасает горло'
          : protection === 'cloth_ready'
            ? 'влажная ткань готова'
            : 'кашель: нужен фильтр или обход'
      : '';
  return {
    active,
    handled: world.anomalySmogHandled,
    inside,
    intensity,
    sourceDistance,
    sourceFound: runtime.sourceFound || sourceDistance <= 6,
    protection,
    prompt,
  };
}

export function proceduralSmogFogDensityBonus(world: World, player: Entity, state: GameState): number {
  const status = getProceduralSmogStatus(world, player, state);
  if (!status.inside) return 0;
  const protectionMult = status.protection === 'filter' ? 0.35 : status.protection === 'wet_cloth' ? 0.55 : 1;
  return (0.012 + status.intensity * 0.025) * protectionMult;
}

export function updateProceduralAnomalies(world: World, player: Entity, state: GameState, dt: number): void {
  updateBadAppleWorldAnomaly(world, player, state, dt);
  const topologyTags = dynamicTopologyTags(world);
  if (topologyTags.wallSnake) updateWallSnakeAnomaly(world, player, state, dt);
  if (topologyTags.livingTunnels) updateLivingTunnelsAnomaly(world, player, state, dt);
  if (topologyTags.sectionShift) updateSectionShiftAnomaly(world, player, state, dt);
  if (topologyTags.sandpilePerekrytie) updateSandpilePerekrytieAnomaly(world, player, state, dt);
  const spec = currentProceduralFloorSpec(state);
  if (spec?.anomalyId !== 'smog') {
    if (world.anomalySmogSource >= 0) runtimeFor(state, world).wasInside = false;
    if (!spec || spec.anomalyId === 'none') return;
    if (spec.anomalyId === 'radio_chess') updateRadioChessAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'cement_memory') updateCementMemoryAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'conveyor_sorter') updateConveyorSorterAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'wall_snake' && !topologyTags.wallSnake) updateWallSnakeAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'living_tunnels' && !topologyTags.livingTunnels) updateLivingTunnelsAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'section_shift' && !topologyTags.sectionShift) updateSectionShiftAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'sandpile_perekrytie' && !topologyTags.sandpilePerekrytie) updateSandpilePerekrytieAnomaly(world, player, state, dt);
    else if (spec.anomalyId === 'conway_life') updateConwayLifeAnomaly(world, player, state, dt);
    return;
  }

  if (world.anomalySmogSource < 0 || world.anomalySmogHandled || !isPlayerEntity(player)) {
    if (world.anomalySmogSource >= 0) runtimeFor(state, world).wasInside = false;
    return;
  }

  const runtime = runtimeFor(state, world);
  const pci = world.idx(Math.floor(player.x), Math.floor(player.y));
  const intensity = world.fog[pci] / 255;
  const inside = world.fog[pci] >= SMOG_ENTER_FOG;
  const source = sourcePosition(world);
  const sourceDistance = world.dist(player.x, player.y, source.x + 0.5, source.y + 0.5);
  const protection = protectionFor(player, state, runtime, inside);

  if (sourceDistance <= 6 && !runtime.sourceFound) {
    runtime.sourceFound = true;
    publishSmogEvent(state, world, player, 'smog_source_found', 3, ['source', 'found'], {
      sourceDistance: Math.round(sourceDistance * 10) / 10,
      smogCells: world.anomalySmogCells.length,
    });
  }

  if (inside && !runtime.wasInside) {
    runtime.wasInside = true;
    publishSmogEvent(state, world, player, 'smog_entered', 3, ['entered', 'visibility', protection], {
      fog: world.fog[pci],
      protection,
      sourceDistance: Math.round(sourceDistance * 10) / 10,
    });
  } else if (!inside) {
    runtime.wasInside = false;
    runtime.pressureAccum = 0;
    return;
  }

  runtime.pressureAccum += dt;
  if (runtime.pressureAccum < PRESSURE_TICK_SECONDS) return;
  runtime.pressureAccum -= PRESSURE_TICK_SECONDS;

  if (player.needs) {
    const thirst = protection === 'filter' ? 0.15 : protection === 'wet_cloth' ? 0.45 : 1.1;
    player.needs.water = Math.max(0, player.needs.water - thirst * (0.7 + intensity));
    player.needs.sleep = Math.max(0, player.needs.sleep - 0.12 * intensity);
  }
  if (protection === 'filter') wearSmogFilter(world, player, state, runtime, intensity);

  if (protection === 'none' || protection === 'cloth_ready') {
    const hpLoss = Math.max(1, Math.round(1 + intensity * 2));
    player.hp = Math.max(1, (player.hp ?? 100) - hpLoss);
    if (state.time - runtime.lastMsgTime > 8) {
      runtime.lastMsgTime = state.time;
      state.msgs.push(msg(`Кашель режет горло: -${hpLoss} HP. Источник можно перекрыть или обойти.`, state.time, '#b98'));
    }
  } else if (state.time - runtime.lastMsgTime > 14) {
    runtime.lastMsgTime = state.time;
    state.msgs.push(msg(protection === 'filter'
      ? 'Фильтр гасит смог, но путь всё равно мутный.'
      : 'Влажная ткань держит горло, но вода уходит быстрее.',
    state.time, '#9cf'));
  }
}

export function tryHandleSmogSource(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  if (!isCurrentSmogFloor(state) || world.anomalySmogSource < 0 || world.anomalySmogHandled) return false;
  const source = sourcePosition(world);
  const lookDist2 = world.dist2(lookX, lookY, source.x + 0.5, source.y + 0.5);
  const playerDist2 = world.dist2(player.x, player.y, source.x + 0.5, source.y + 0.5);
  if (lookDist2 > 3.2 || playerDist2 > 8.5) return false;

  const prepared = hasItem(player, 'wrench') || hasItem(player, 'valve_tag') || player.tool === 'vacuum' || hasItem(player, 'gasmask_filter');
  let cleared = 0;
  for (const ci of world.anomalySmogCells) {
    if (world.fog[ci] <= 34) continue;
    world.fog[ci] = 24 + ((ci * 17) & 15);
    cleared++;
  }
  world.anomalySmogHandled = true;
  world.setFeatureAt(world.anomalySmogSource, Feature.MACHINE);
  world.markFogDirty();

  if (!prepared) {
    player.hp = Math.max(1, (player.hp ?? 100) - 8);
    if (player.needs) player.needs.water = Math.max(0, player.needs.water - 6);
  }

  publishSmogEvent(state, world, player, 'smog_source_handled', 4, ['source', 'handled', prepared ? 'prepared' : 'bare_hands'], {
    clearedCells: cleared,
    prepared,
    usedWrench: hasItem(player, 'wrench'),
    usedValveTag: hasItem(player, 'valve_tag'),
    usedVacuum: player.tool === 'vacuum',
  });
  state.msgs.push(msg(prepared
    ? 'Источник смога перекрыт. Коридоры снова различимы.'
    : 'Источник смога перекрыт голыми руками. Горло и кожа запомнили.',
  state.time, prepared ? '#8cf' : '#f84'));
  return true;
}

function tryUseTeleportCellsCounter(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const spec = currentProceduralFloorSpec(state);
  if (spec?.anomalyId !== 'teleport_cells') return false;
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (world.features[ci] !== Feature.SCREEN) return false;
  const targetIdx = world.anomalyTeleports.get(ci);
  if (targetIdx === undefined) return false;
  if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 8.5) return false;

  const counterId = teleportCounterItemId(player);
  if (!counterId) {
    state.msgs.push(msg('Экран перескока дрожит. Нужна схема лифтов, приказ доступа или включенная рация.', state.time, '#fa4'));
    return true;
  }

  if (counterId === TELEPORT_COUNTER_TOOL) consumeToolDurability(player, 5, state.msgs, state.time, state);
  else removeItem(player, counterId, 1);
  world.anomalyTeleports.delete(ci);
  world.anomalyTeleports.delete(targetIdx);
  publishTeleportCellsEvent(state, world, player, counterId, ci, targetIdx);
  state.msgs.push(msg('Перескок заякорен. Эта пара клеток больше не рвет маршрут.', state.time, '#8cf'));
  return true;
}

export function summarizeProceduralSmog(world: World, state: GameState): string[] {
  const spec = currentProceduralFloorSpec(state);
  if (spec?.anomalyId !== 'smog') return [];
  if (world.anomalySmogSource < 0) return ['smog: spec active, source not generated'];
  const source = sourcePosition(world);
  const roomId = world.roomMap[world.anomalySmogSource];
  return [
    `smog: ${world.anomalySmogHandled ? 'handled' : 'active'} source=${source.x},${source.y} room=${roomId} cells=${world.anomalySmogCells.length}`,
    'smog choices: filter, wet cloth, reroute, or E on source with wrench/valve/vacuum',
  ];
}

function falseSafeRoom(room: Room | undefined): room is Room {
  return !!room && room.name.includes(FALSE_SAFE_BLOCK_ROOM_PREFIX);
}

function falseSafeRoomAt(world: World, x: number, y: number): Room | undefined {
  const ci = world.idx(x, y);
  const roomId = world.roomMap[ci];
  return roomId >= 0 ? world.rooms[roomId] : undefined;
}

function falseSafeHasFlag(world: World, flag: string): boolean {
  return world.rooms.some(room => falseSafeRoom(room) && room.name.includes(flag));
}

function markFalseSafeRooms(world: World, flag: string): void {
  for (const room of world.rooms) {
    if (!falseSafeRoom(room) || room.name.includes(flag)) continue;
    room.name = `${room.name}; ${flag}`;
  }
}

function revealFalseSafeStashes(world: World): number {
  let revealed = 0;
  for (const container of world.containers) {
    if (!container.tags.includes(FALSE_SAFE_BLOCK_TAG) || container.discovered) continue;
    container.discovered = true;
    revealed++;
  }
  return revealed;
}

function setFalseSafeFog(world: World, density: number): void {
  let touched = false;
  for (const room of world.rooms) {
    if (!falseSafeRoom(room)) continue;
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const ci = world.idx(x, y);
        if (world.roomMap[ci] !== room.id) continue;
        if (world.cells[ci] === Cell.WALL || world.cells[ci] === Cell.LIFT) continue;
        world.fog[ci] = Math.max(world.fog[ci], density);
        touched = true;
      }
    }
  }
  if (touched) world.markFogDirty();
}

function publishFalseSafeRumor(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  outcome: string,
  severity: 3 | 4,
  privacy: 'local' | 'public',
  extra: Record<string, unknown> = {},
): void {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const ci = world.idx(px, py);
  publishEvent(state, {
    type: 'rumor_observed',
    zoneId: world.zoneMap[ci],
    roomId: room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy,
    tags: ['procedural', 'anomaly', FALSE_SAFE_BLOCK_TAG, 'cult', outcome],
    data: {
      anomalyId: 'false_safe_block',
      outcome,
      roomName: room.name,
      rumorIds: FALSE_SAFE_RUMOR_IDS,
      ...extra,
    },
  });
}

function discoverFalseSafeBlock(world: World, player: Entity, state: GameState, room: Room, outcome: string): void {
  const revealed = revealFalseSafeStashes(world);
  markFalseSafeRooms(world, FALSE_SAFE_BLOCK_DISCOVERED);
  state.msgs.push(msg('Табло молчит: сирена здесь не заведена в сеть. Под чистым полом культовая метка и чужой запас.', state.time, '#fa4'));
  publishFalseSafeRumor(world, player, state, room, outcome, 4, 'local', { revealedStashes: revealed });
}

function reportFalseSafeBlock(world: World, player: Entity, state: GameState, room: Room): void {
  state.msgs.push(msg('Вы пустили слух о тихом блоке. Теперь укрытие не только ваше решение.', state.time, '#8cf'));
  publishFalseSafeRumor(world, player, state, room, 'reported', 3, 'public');
}

function resolveFalseSafeMarker(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  ci: number,
  spec: ProceduralFloorSpec,
): void {
  const toolId = player.tool ?? '';
  if (toolId !== 'cleaning_kit' && toolId !== 'jackhammer') {
    if (!falseSafeHasFlag(world, FALSE_SAFE_BLOCK_DISCOVERED)) {
      discoverFalseSafeBlock(world, player, state, room, 'marker_touched');
    } else {
      state.msgs.push(msg('Черная ладонь держится под лаком. Нужен чистящий комплект или отбойник.', state.time, '#f84'));
    }
    return;
  }

  consumeToolDurability(player, toolId === 'cleaning_kit' ? 8 : 1, state.msgs, state.time, state);
  world.setFeatureAt(ci, Feature.NONE);
  markFalseSafeRooms(world, FALSE_SAFE_BLOCK_DISCOVERED);
  markFalseSafeRooms(world, FALSE_SAFE_BLOCK_RESOLVED);
  revealFalseSafeStashes(world);
  setFalseSafeFog(world, 72);
  state.samosborTimer = Math.max(35, state.samosborTimer - (18 + spec.danger * 6));
  const item = ITEMS[toolId];
  state.msgs.push(msg('Метка сорвана. Тихий блок зашумел, запас остался чужим.', state.time, '#f4a'));
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: world.zoneMap[world.idx(Math.floor(player.x), Math.floor(player.y))],
    roomId: room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: toolId,
    itemName: item?.name ?? toolId,
    severity: 4,
    privacy: 'local',
    tags: ['player', 'procedural', 'anomaly', FALSE_SAFE_BLOCK_TAG, 'cult', 'marker_resolved'],
    data: {
      anomalyId: 'false_safe_block',
      roomName: room.name,
      timerCost: 18 + spec.danger * 6,
      rumorIds: FALSE_SAFE_RUMOR_IDS,
    },
  });
}

function tryUseFalseSafeBlock(
  world: World,
  player: Entity,
  state: GameState,
  spec: ProceduralFloorSpec,
  lookX: number,
  lookY: number,
): boolean {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  const feature = world.features[ci] as Feature;
  if (feature !== Feature.SCREEN && feature !== Feature.APPARATUS) return false;
  const room = falseSafeRoomAt(world, x, y);
  if (!falseSafeRoom(room)) return false;

  if (feature === Feature.SCREEN) {
    if (!falseSafeHasFlag(world, FALSE_SAFE_BLOCK_DISCOVERED)) discoverFalseSafeBlock(world, player, state, room, 'screen_checked');
    else reportFalseSafeBlock(world, player, state, room);
    return true;
  }

  if (falseSafeHasFlag(world, FALSE_SAFE_BLOCK_RESOLVED)) {
    state.msgs.push(msg('Маркер уже сорван. Тишина больше не держит этот блок.', state.time, '#888'));
    return true;
  }
  resolveFalseSafeMarker(world, player, state, room, ci, spec);
  return true;
}

export function proceduralAnomalyInteractionTargetId(
  world: World,
  state: GameState,
  lookX: number,
  lookY: number,
): number | null {
  if (isCurrentSmogFloor(state) && world.anomalySmogSource >= 0 && !world.anomalySmogHandled) {
    const source = sourcePosition(world);
    const lookDist2 = world.dist2(lookX, lookY, source.x + 0.5, source.y + 0.5);
    if (lookDist2 <= 3.2) return world.anomalySmogSource + 520000;
  }

  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  const feature = world.features[ci] as Feature;
  const badAppleTarget = badAppleWorldInteractionTargetId(world, lookX, lookY);
  if (badAppleTarget !== null) return badAppleTarget;
  const topologyTags = dynamicTopologyTags(world);
  if (topologyTags.sandpilePerekrytie) {
    const sandpileTarget = sandpilePerekrytieInteractionTargetId(world, lookX, lookY);
    if (sandpileTarget !== null) return sandpileTarget;
  }
  if (topologyTags.livingTunnels) {
    const livingTunnelTarget = livingTunnelsInteractionTargetId(world, lookX, lookY);
    if (livingTunnelTarget !== null) return livingTunnelTarget;
  }
  if (feature !== Feature.SCREEN && feature !== Feature.APPARATUS) return null;
  const room = world.rooms[world.roomMap[ci]];
  const taggedDynamicRoom = room?.name.includes('[wall_snake:') === true || room?.name.includes('[section_shift:') === true;
  const spec = currentProceduralFloorSpec(state);
  if (!spec) return taggedDynamicRoom ? ci + 530000 : null;
  if (spec.anomalyId === 'false_safe_block') return falseSafeRoom(falseSafeRoomAt(world, x, y)) ? ci + 400000 : null;
  if (spec.anomalyId === 'teleport_cells' && feature === Feature.SCREEN && world.anomalyTeleports.has(ci)) return ci + 550000;
  if (
    spec.anomalyId === 'radio_chess' ||
    spec.anomalyId === 'cement_memory' ||
    spec.anomalyId === 'conveyor_sorter' ||
    spec.anomalyId === 'wall_snake' ||
    spec.anomalyId === 'living_tunnels' ||
    spec.anomalyId === 'section_shift' ||
    spec.anomalyId === 'conway_life'
  ) return ci + 530000;
  return null;
}

export function tryUseProceduralFloorAnomaly(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  if (tryHandleSmogSource(world, player, state, lookX, lookY)) return true;
  if (tryUseBadAppleWorldAnomaly(world, player, state, lookX, lookY)) return true;
  if (tryUseTeleportCellsCounter(world, player, state, lookX, lookY)) return true;
  const topologyTags = dynamicTopologyTags(world);
  if (topologyTags.wallSnake && tryUseWallSnakeAnomaly(world, player, state, lookX, lookY)) return true;
  if (topologyTags.livingTunnels && tryUseLivingTunnelsAnomaly(world, player, state, lookX, lookY)) return true;
  if (topologyTags.sectionShift && tryUseSectionShiftAnomaly(world, player, state, lookX, lookY)) return true;
  if (topologyTags.sandpilePerekrytie && tryUseSandpilePerekrytieAnomaly(world, player, state, lookX, lookY)) return true;
  const spec = currentProceduralFloorSpec(state);
  if (!spec) return false;
  if (spec.anomalyId === 'false_safe_block') return tryUseFalseSafeBlock(world, player, state, spec, lookX, lookY);
  if (spec.anomalyId === 'radio_chess') return tryUseRadioChessAnomaly(world, player, state, lookX, lookY);
  if (spec.anomalyId === 'cement_memory') return tryUseCementMemoryAnomaly(world, player, state, lookX, lookY);
  if (spec.anomalyId === 'conveyor_sorter') return tryUseConveyorSorterAnomaly(world, player, state, lookX, lookY);
  if (spec.anomalyId === 'conway_life') return tryUseConwayLifeAnomaly(world, player, state, lookX, lookY);
  if (spec.anomalyId === 'sandpile_perekrytie') return tryUseSandpilePerekrytieAnomaly(world, player, state, lookX, lookY);
  return false;
}
