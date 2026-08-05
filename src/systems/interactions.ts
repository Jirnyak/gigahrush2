import { isArenaOverlayOpen, closeArena, moveArenaSelection, activateArenaSelection } from './arena';
import {
  Cell,
  DoorState,
  EntityType,
  Feature,
  LiftDirection,
  W,
  msg,
  type Entity,
  type GameState,
  type Item,
  type WorldContainer,
} from '../core/types';
import { World } from '../core/world';
import { hashSeed, seededRandom } from '../core/rand';
import { ITEMS } from '../data/catalog';
import { getComputerDef } from '../data/computers';
import { getGamblingMachineDef } from '../data/gambling';
import { getNetHackTerminalDef } from '../data/net_hack';
import { tryUseCarnivorousFungus } from './carnivorous_fungus';
import {
  findContentInteractionTarget,
  tryUseContentInteraction,
  type ContentCraftMenuRequest,
  type ContentRecipeLearnRequest,
} from './content_hooks';
import './interactive';
import { ensureRoomContainers } from './containers';
import {
  clearComputers,
  closeComputer,
  copyComputerData,
  getComputerAt,
  isComputerOverlayOpen,
  moveComputerPage,
  openComputer,
  placeComputer,
} from './computers';
import { getCultProcessionPrompt, tryInteractCultProcession } from './faction_events';
import { isHostile } from './factions';
import { setDoorState, damageDoor } from './door_state';
import { getActiveFloorInstance } from './floor_instances';
import { findGnilushkaInteractionTarget, tryUseGnilushkaInteraction } from './gnilushka';
import {
  activateGamblingBet,
  clearGamblingMachines,
  closeGamblingMachine,
  getGamblingMachineAt,
  isGamblingOverlayOpen,
  moveGamblingPreset,
  openGamblingMachine,
  placeGamblingMachine,
} from './gambling';
import { tryUseHeatlinePressure } from './heatline';
import { tryRepairHermodoorBorerDamage } from './hermodoor_borer';
import { hladonInteractionTargetId, tryUseHladonColdPocketCounter } from './hladon';
import { getEmergencyPanelAt, tryUseEmergencyPanel } from './emergency_panels';
import {
  activateFastElevator,
  closeFastElevator,
  isFastElevatorOverlayOpen,
  moveFastElevatorSelection,
  openFastElevator,
} from './fast_elevator';
import { ENTITY_MASK_ITEM_DROP, ENTITY_MASK_NPC, ensureEntityIndex } from './entity_index';
import { pickupDrop } from './inventory';
import { tryUseMetroRoute } from './metro';
import {
  attemptNetHack,
  clearNetHackTerminals,
  closeNetHackTerminal,
  getNetHackTerminalAt,
  isNetHackOverlayOpen,
  openNetHackTerminal,
  placeNetHackTerminal,
} from './net_hack';
import { completeTutorial } from './tutorial';
import { consumeQuietDoorCharge, publishDoorNoise } from './noise';
import {
  activateNetTerminalBank,
  closeNetTerminalGen,
  isNetTerminalBankOpen,
  isNetTerminalGenDeniedOpen,
  isNetTerminalGenTarget,
  moveNetTerminalBankAction,
  moveNetTerminalBankPreset,
  tryUseNetTerminalGen,
} from './net_terminal_gen';
import { tryUsePneumomailTube } from './pneumomail';
import { pseudoliftPrompt, tryUsePseudolift } from './pseudolift';
import { floorRunLiftPrompt, currentFloorRunLabel } from './procedural_floors';
import { proceduralAnomalyInteractionTargetId, tryUseProceduralFloorAnomaly } from './procedural_anomalies';
import { railTrainInteractionTargetId, tryUseRailTrain } from './rail_trains';
import { isRouteCueTarget, routeObjectiveLiftPromptSuffix, tryUseRouteCue } from './route_cues';
import { tryUseSamosborVariantInteraction } from './samosbor';
import { tryCoverSeroburmalineSource } from './seroburmaline';
import { findSlimevikInteractionTarget, tryUseSlimevikInteraction } from './slimevik';
import { portalAllowsCasinoLikeContent } from './platform_bridge';

export type InteractableKind =
  | 'instant'
  | 'door'
  | 'lift'
  | 'item_drop'
  | 'npc'
  | 'container'
  | 'rail_train'
  | 'gambling'
  | 'computer'
  | 'net_hack'
  | 'emergency_panel';

export interface InteractionContext {
  world: World;
  state: GameState;
  player: Entity;
  entities: Entity[];
  nextEntityId: { v: number };
  lookX: number;
  lookY: number;
  readOnly?: boolean;
  switchFloor?: (direction: LiftDirection, message?: string, color?: string, allowElevatorAnomaly?: boolean, targetZ?: number) => void;
  movePlayerToMetroRoom?: (roomName: string) => boolean;
  openNpcMenu?: (npc: Entity) => void;
  openContainerMenu?: (container: WorldContainer) => void;
  openCraftMenu?: (request: ContentCraftMenuRequest) => void;
  learnRecipe?: (request: ContentRecipeLearnRequest) => boolean;
  openMapEditor?: (world: World, player: Entity, state: GameState, terminal?: { x: number; y: number }) => void;
  playDoor?: () => void;
  routeHintsVisible?: boolean;
  manualItemPickup?: boolean;
  onPickedDrop?: (drop: Entity, pickedItems: readonly Item[]) => void;
}

export interface InteractionTarget {
  id: number;
  defId: string;
  kind: InteractableKind;
  x: number;
  y: number;
  priority: number;
  prompt: string;
  colorSeed: number;
  disabledReason?: string;
  itemName?: string;
  itemDesc?: string;
  itemCount?: number;
  itemValue?: number;
}

export interface InteractionResult {
  handled: boolean;
  openedOverlay?: boolean;
  worldChanged?: boolean;
  message?: string;
}

export interface InteractableOverlayInput {
  escEdge: boolean;
  interactEdge: boolean;
  upNav: boolean;
  dnNav: boolean;
  leftNav: boolean;
  rightNav: boolean;
}

export type InteractableOverlayKind = 'none' | 'gambling' | 'computer' | 'net_hack' | 'net_terminal' | 'fast_elevator' | 'arena';

export interface InteractableOverlaySnapshot {
  open: boolean;
  kind: InteractableOverlayKind;
}

const INTERACTABLE_ROOM_ATTEMPTS = 384;
const INTERACTABLE_RANDOM_ATTEMPTS = 1024;
const NPC_INTERACTION_RANGE = 2.25;
const NPC_INTERACTION_MIN_FORWARD = 0.35;
const NPC_INTERACTION_BODY_RADIUS = 0.33;
const NPC_INTERACTION_QUERY_CAP = 48;
const NPC_INTERACTION_RAY_STEP_CAP = 12;
const ITEM_INTERACTION_RANGE = 2.2;
const ITEM_INTERACTION_MIN_FORWARD = 0.2;
const ITEM_INTERACTION_BODY_RADIUS = 0.42;
const ITEM_INTERACTION_QUERY_CAP = 64;
const npcInteractionQuery: Entity[] = [];
const itemInteractionQuery: Entity[] = [];

function target(
  kind: InteractableKind,
  id: number,
  defId: string,
  x: number,
  y: number,
  priority: number,
  prompt: string,
): InteractionTarget {
  return { id, defId, kind, x, y, priority, prompt, colorSeed: id };
}

function activeVisitLiftHint(ctx: InteractionContext, direction: LiftDirection): string {
  return ctx.routeHintsVisible ? routeObjectiveLiftPromptSuffix(ctx.state, direction) : '';
}

function liftPrompt(ctx: InteractionContext, idx: number): string {
  const dir = ctx.world.liftDir[idx] as LiftDirection;
  const activeInstance = getActiveFloorInstance(ctx.state);
  if (activeInstance) {
    const route = currentFloorRunLabel(ctx.state) ?? 'плановый маршрут';
    return ` ${dir === LiftDirection.UP ? '↑' : '↓'} НОМЕРНОЙ №${activeInstance.displayNumber} -> ${route}`;
  }
  return ` ${floorRunLiftPrompt(ctx.state, dir)}${activeVisitLiftHint(ctx, dir)}`;
}

function interactionSpriteScale(e: Entity): number {
  return Math.max(0.35, Math.min(1.6, e.spriteScale ?? 1));
}

function interactionRayBlocked(world: World, px: number, py: number, dirX: number, dirY: number, maxDist: number): boolean {
  if (maxDist <= 0) return false;
  let mapX = Math.floor(px);
  let mapY = Math.floor(py);
  const ddx = dirX === 0 ? Infinity : Math.abs(1 / dirX);
  const ddy = dirY === 0 ? Infinity : Math.abs(1 / dirY);
  const stepX = dirX < 0 ? -1 : 1;
  const stepY = dirY < 0 ? -1 : 1;
  let sdx = dirX < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
  let sdy = dirY < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;

  for (let step = 0; step < NPC_INTERACTION_RAY_STEP_CAP; step++) {
    const dist = Math.min(sdx, sdy);
    if (dist >= maxDist) return false;
    if (sdx < sdy) {
      sdx += ddx;
      mapX += stepX;
    } else {
      sdy += ddy;
      mapY += stepY;
    }
    if (world.solid(mapX, mapY)) return true;
  }
  return false;
}

function findFriendlyNpc(ctx: InteractionContext): Entity | null {
  const dirX = Math.cos(ctx.player.angle);
  const dirY = Math.sin(ctx.player.angle);
  let best: Entity | null = null;
  let bestScore = Infinity;
  ensureEntityIndex(ctx.entities).queryRadiusCapped(
    ctx.player.x,
    ctx.player.y,
    NPC_INTERACTION_RANGE,
    npcInteractionQuery,
    ENTITY_MASK_NPC,
    NPC_INTERACTION_QUERY_CAP,
  );
  for (const e of npcInteractionQuery) {
    if (e.type !== EntityType.NPC || !e.alive) continue;
    if (isHostile(e, ctx.player) || isHostile(ctx.player, e)) continue;
    const dx = ctx.world.delta(ctx.player.x, e.x);
    const dy = ctx.world.delta(ctx.player.y, e.y);
    const forward = dx * dirX + dy * dirY;
    if (forward <= NPC_INTERACTION_MIN_FORWARD || forward > NPC_INTERACTION_RANGE) continue;
    const side = -dx * dirY + dy * dirX;
    const bodyRadius = Math.max(0.18, Math.min(0.5, NPC_INTERACTION_BODY_RADIUS * interactionSpriteScale(e)));
    if (Math.abs(side) > bodyRadius) continue;
    if (interactionRayBlocked(ctx.world, ctx.player.x, ctx.player.y, dirX, dirY, forward - bodyRadius)) continue;
    const score = forward + Math.abs(side) * 0.5;
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

function firstPickupItem(drop: Entity): { defId: string; count: number } | null {
  for (const item of drop.inventory ?? []) {
    if (item && item.count > 0 && typeof item.defId === 'string') return { defId: item.defId, count: item.count };
  }
  return null;
}

function findItemDrop(ctx: InteractionContext): Entity | null {
  const dirX = Math.cos(ctx.player.angle);
  const dirY = Math.sin(ctx.player.angle);
  let best: Entity | null = null;
  let bestScore = Infinity;
  ensureEntityIndex(ctx.entities).queryRadiusCapped(
    ctx.player.x,
    ctx.player.y,
    ITEM_INTERACTION_RANGE,
    itemInteractionQuery,
    ENTITY_MASK_ITEM_DROP,
    ITEM_INTERACTION_QUERY_CAP,
  );
  for (const e of itemInteractionQuery) {
    if (e.type !== EntityType.ITEM_DROP || !e.alive || !firstPickupItem(e)) continue;
    const dx = ctx.world.delta(ctx.player.x, e.x);
    const dy = ctx.world.delta(ctx.player.y, e.y);
    const forward = dx * dirX + dy * dirY;
    if (forward <= ITEM_INTERACTION_MIN_FORWARD || forward > ITEM_INTERACTION_RANGE) continue;
    const side = -dx * dirY + dy * dirX;
    const bodyRadius = Math.max(0.25, Math.min(0.65, ITEM_INTERACTION_BODY_RADIUS * interactionSpriteScale(e)));
    if (Math.abs(side) > bodyRadius) continue;
    if (interactionRayBlocked(ctx.world, ctx.player.x, ctx.player.y, dirX, dirY, forward - bodyRadius)) continue;
    const score = forward + Math.abs(side) * 0.75;
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

function itemDropInteractionTarget(drop: Entity): InteractionTarget | null {
  const item = firstPickupItem(drop);
  if (!item) return null;
  const def = ITEMS[item.defId];
  return {
    ...target('item_drop', drop.id, item.defId, drop.x, drop.y, 52, ' поднять'),
    itemName: def?.name ?? item.defId,
    itemDesc: def?.desc ?? '',
    itemCount: item.count,
    itemValue: def?.value ?? 0,
  };
}

function findContainer(ctx: InteractionContext, discoverSecret: boolean): WorldContainer | null {
  const lx = Math.floor(ctx.lookX);
  const ly = Math.floor(ctx.lookY);
  const exact = ctx.world.containersAt(lx, ly);
  const visible = exact.find(c => c.discovered || c.access !== 'secret');
  if (visible) return visible;
  if (discoverSecret) {
    const secret = exact.find(c => c.access === 'secret' && !c.discovered);
    if (secret && ctx.world.dist2(ctx.player.x, ctx.player.y, secret.x + 0.5, secret.y + 0.5) <= 2.25) {
      secret.discovered = true;
      ctx.state.msgs.push(msg('Вы нашли тайник.', ctx.state.time, '#c8f'));
      return secret;
    }
  }
  return null;
}

function lookIdx(ctx: InteractionContext): number {
  return ctx.world.idx(Math.floor(ctx.lookX), Math.floor(ctx.lookY));
}

function findHighPriorityTargetForLook(ctx: InteractionContext): InteractionTarget | null {
  const idx = lookIdx(ctx);
  if (isNetTerminalGenTarget(ctx.world, ctx.state, ctx.lookX, ctx.lookY)) {
    return target('computer', idx + 910000, 'net_terminal_gen', Math.floor(ctx.lookX), Math.floor(ctx.lookY), 20, ' НЕТ');
  }

  const railId = railTrainInteractionTargetId(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY);
  if (railId !== null) return target('rail_train', railId, 'rail_train', ctx.lookX, ctx.lookY, 30, ' поезд');

  const gambling = portalAllowsCasinoLikeContent() ? getGamblingMachineAt(ctx.world, ctx.lookX, ctx.lookY) : null;
  if (gambling) {
    const def = getGamblingMachineDef(gambling.defId);
    return target('gambling', gambling.idx + 960000, gambling.defId, gambling.x, gambling.y, 40, ` ${def?.prompt ?? 'ставка'}`);
  }

  const computer = getComputerAt(ctx.world, ctx.lookX, ctx.lookY);
  if (computer) {
    const def = getComputerDef(computer.defId);
    return target('computer', computer.idx + 970000, computer.defId, computer.x, computer.y, 45, ` ${def?.prompt ?? 'компьютер'}`);
  }

  const hack = getNetHackTerminalAt(ctx.world, ctx.lookX, ctx.lookY);
  if (hack) {
    const def = getNetHackTerminalDef(hack.defId);
    return target('net_hack', hack.idx + 980000, hack.defId, hack.x, hack.y, 48, ` ${def?.prompt ?? 'взлом'}`);
  }

  const panel = getEmergencyPanelAt(ctx.world, ctx.lookX, ctx.lookY);
  if (panel) {
    return target('emergency_panel', panel.idx + 620000, panel.defId, panel.x, panel.y, 49, ' аварийный щиток');
  }

  return null;
}

function findNormalPriorityTargetForLook(ctx: InteractionContext): InteractionTarget | null {
  const idx = lookIdx(ctx);
  const pseudoLift = pseudoliftPrompt(ctx.world, ctx.state, ctx.lookX, ctx.lookY);
  if (pseudoLift) return target('lift', idx + 205000, 'pseudolift', idx % W, (idx / W) | 0, 58, pseudoLift);

  const cell = ctx.world.cells[idx];
  if (cell === Cell.LIFT && ctx.world.features[idx] === Feature.MACHINE) {
    return target('instant', idx + 975000, 'fast_elevator', idx % W, (idx / W) | 0, 60, ' скоростной лифт');
  }
  if (cell === Cell.LIFT) {
    return target('lift', idx + 200000, 'lift', idx % W, (idx / W) | 0, 60, liftPrompt(ctx, idx));
  }

  const contentTarget = findContentInteractionTarget(ctx);
  if (contentTarget) return target('instant', contentTarget.id, contentTarget.targetId, contentTarget.x, contentTarget.y, contentTarget.priority, contentTarget.prompt);

  if (isRouteCueTarget(ctx.world, ctx.player, ctx.lookX, ctx.lookY)) {
    return target('instant', idx + 470000, 'route_cue', idx % W, (idx / W) | 0, 80, ' маршрут');
  }
  const anomalyTargetId = hladonInteractionTargetId(ctx.world, ctx.lookX, ctx.lookY)
    ?? proceduralAnomalyInteractionTargetId(ctx.world, ctx.state, ctx.lookX, ctx.lookY);
  if (anomalyTargetId !== null) {
    return target('instant', anomalyTargetId, 'anomaly', idx % W, (idx / W) | 0, 90, ' аномалия');
  }

  if (cell === Cell.DOOR && ctx.world.doors.has(idx)) {
    const door = ctx.world.doors.get(idx);
    const isHermetic = door?.state === DoorState.HERMETIC_CLOSED || door?.state === DoorState.HERMETIC_OPEN;
    return target('door', idx + 100000, 'door', idx % W, (idx / W) | 0, 100, isHermetic ? ' гермодверь' : ' дверь');
  }

  const container = findContainer(ctx, false);
  if (container) {
    return target('container', container.id + 300000, 'container', container.x, container.y, 110, ' контейнер');
  }

  return null;
}

export function findInteractionTarget(ctx: InteractionContext): InteractionTarget | null {
  const processionHint = getCultProcessionPrompt(ctx.world, ctx.state, ctx.player);
  if (processionHint) return target('instant', 850000 + processionHint.length, 'cult_procession', ctx.player.x, ctx.player.y, 10, processionHint);

  const angle = Math.atan2(ctx.lookY - ctx.player.y, ctx.lookX - ctx.player.x);
  const nearX = ctx.player.x + Math.cos(angle) * 0.7;
  const nearY = ctx.player.y + Math.sin(angle) * 0.7;
  const nearCtx: InteractionContext = { ...ctx, lookX: nearX, lookY: nearY };

  const nearHigh = findHighPriorityTargetForLook(nearCtx);
  if (nearHigh) return nearHigh;
  const farHigh = findHighPriorityTargetForLook(ctx);
  if (farHigh) return farHigh;

  const slimevik = findSlimevikInteractionTarget(ctx.world, ctx.player, ctx.entities);
  if (slimevik) return target('instant', slimevik.id + 640000, 'slimevik', slimevik.x, slimevik.y, 55, ' слизневик');

  const gnilushka = findGnilushkaInteractionTarget(ctx.world, ctx.player, ctx.entities);
  if (gnilushka) return target('instant', gnilushka.id + 645000, 'gnilushka', gnilushka.x, gnilushka.y, 54, ' разговор');

  const npc = findFriendlyNpc(ctx);
  if (npc) return target('npc', npc.id, 'npc', npc.x, npc.y, 50, ' разговор');

  if (ctx.manualItemPickup) {
    const itemDrop = findItemDrop(ctx);
    if (itemDrop) return itemDropInteractionTarget(itemDrop);
  }

  const nearNormal = findNormalPriorityTargetForLook(nearCtx);
  if (nearNormal) return nearNormal;
  return findNormalPriorityTargetForLook(ctx);
}

function activateDoor(ctx: InteractionContext, idx: number): InteractionResult {
  const door = ctx.world.doors.get(idx);
  if (!door) return { handled: false };
  const hermeticDoor = door.state === DoorState.HERMETIC_CLOSED || door.state === DoorState.HERMETIC_OPEN;
  if (door.state === DoorState.CLOSED || door.state === DoorState.HERMETIC_CLOSED) {
    if (door.state === DoorState.HERMETIC_CLOSED && ctx.state.samosborActive) {
      const broke = damageDoor(ctx.world, door, 5);
      if (broke) {
        ctx.state.msgs.push(msg('Дверь выбита!', ctx.state.time, '#4a4'));
      } else {
        ctx.state.msgs.push(msg('Дверь герметично заперта! (Удар -5)', ctx.state.time, '#f44'));
      }
    } else {
      const quietDoor = consumeQuietDoorCharge(ctx.player, ctx.state.time);
      setDoorState(ctx.world, door, door.state === DoorState.HERMETIC_CLOSED ? DoorState.HERMETIC_OPEN : DoorState.OPEN);
      door.timer = 0;
      ctx.state.msgs.push(msg(quietDoor ? 'Дверь открыта тихо' : 'Дверь открыта', ctx.state.time, quietDoor ? '#8cf' : '#aaa'));
      ctx.playDoor?.();
      publishDoorNoise(ctx.state, ctx.player, idx, hermeticDoor, quietDoor);
    }
  } else if (door.state === DoorState.OPEN || door.state === DoorState.HERMETIC_OPEN) {
    const quietDoor = consumeQuietDoorCharge(ctx.player, ctx.state.time);
    setDoorState(ctx.world, door, door.state === DoorState.HERMETIC_OPEN ? DoorState.HERMETIC_CLOSED : DoorState.CLOSED);
    ctx.state.msgs.push(msg(quietDoor ? 'Дверь закрыта тихо' : 'Дверь закрыта', ctx.state.time, quietDoor ? '#8cf' : '#aaa'));
    ctx.playDoor?.();
    publishDoorNoise(ctx.state, ctx.player, idx, hermeticDoor, quietDoor);
  } else if (door.state === DoorState.LOCKED) {
    const keyId = door.keyId || 'key';
    if (ctx.player.inventory?.some(i => i.defId === keyId)) {
      const quietDoor = consumeQuietDoorCharge(ctx.player, ctx.state.time);
      setDoorState(ctx.world, door, DoorState.OPEN);
      ctx.state.msgs.push(msg(quietDoor ? 'Дверь отперта тихо' : 'Дверь отперта ключом', ctx.state.time, quietDoor ? '#8cf' : '#4a4'));
      publishDoorNoise(ctx.state, ctx.player, idx, false, quietDoor);
      if (ctx.state.tutorialMode && keyId === 'tut_cafe_key') {
        completeTutorial(ctx.state);
      }
    } else {
      const broke = damageDoor(ctx.world, door, 5);
      if (broke) {
        ctx.state.msgs.push(msg('Дверь выбита!', ctx.state.time, '#4a4'));
      } else {
        ctx.state.msgs.push(msg('Заперто. Нужен ключ. (Удар -5)', ctx.state.time, '#f84'));
      }
    }
  }
  return { handled: true };
}

function activateMetro(ctx: InteractionContext): InteractionResult {
  const metro = tryUseMetroRoute(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY);
  if (!metro) return { handled: false };
  if (!metro.destination) {
    ctx.state.msgs.push(msg(metro.message, ctx.state.time, metro.color));
  } else if (metro.destination.kind === 'local') {
    if (ctx.movePlayerToMetroRoom?.(metro.destination.roomName)) {
      ctx.state.msgs.push(msg(metro.message, ctx.state.time, metro.color));
    } else {
      ctx.state.msgs.push(msg('Метро дернулось, но карман не найден.', ctx.state.time, '#f84'));
    }
  } else {
    const delta = metro.destination.floor - ctx.state.currentFloor;
    if (delta === 1) ctx.switchFloor?.(LiftDirection.DOWN, metro.message, metro.color, false);
    else if (delta === -1) ctx.switchFloor?.(LiftDirection.UP, metro.message, metro.color, false);
    else ctx.state.msgs.push(msg('Эта линия пока берет только соседние этажи.', ctx.state.time, '#888'));
  }
  return { handled: true };
}

function activateHighPriorityInteractionForLook(ctx: InteractionContext): InteractionResult {
  const netTerminal = tryUseNetTerminalGen(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY, ctx.entities, ctx.nextEntityId);
  if (netTerminal.handled) {
    if (netTerminal.access) ctx.openMapEditor?.(ctx.world, ctx.player, ctx.state, netTerminal.terminal);
    return { handled: true, openedOverlay: true };
  }

  if (tryUseRailTrain(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };

  const gambling = portalAllowsCasinoLikeContent() ? getGamblingMachineAt(ctx.world, ctx.lookX, ctx.lookY) : null;
  if (gambling) {
    openGamblingMachine(ctx.state, gambling);
    return { handled: true, openedOverlay: true };
  }

  const computer = getComputerAt(ctx.world, ctx.lookX, ctx.lookY);
  if (computer) {
    openComputer(ctx.state, computer);
    return { handled: true, openedOverlay: true };
  }

  const hack = getNetHackTerminalAt(ctx.world, ctx.lookX, ctx.lookY);
  if (hack) {
    openNetHackTerminal(ctx.state, hack);
    return { handled: true, openedOverlay: true };
  }

  if (tryUseEmergencyPanel(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) {
    return { handled: true, openedOverlay: true };
  }

  return { handled: false };
}

function activateNormalPriorityInteractionForLook(ctx: InteractionContext): InteractionResult {
  const idx = lookIdx(ctx);

  if (tryUsePseudolift(ctx.world, ctx.entities, ctx.nextEntityId, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) {
    return { handled: true, worldChanged: true };
  }

  if (ctx.world.cells[idx] === Cell.LIFT && ctx.world.features[idx] === Feature.MACHINE) {
    openFastElevator(ctx.state, ctx.player);
    return { handled: true, openedOverlay: true };
  }

  if (ctx.world.cells[idx] === Cell.LIFT) {
    ctx.switchFloor?.(ctx.world.liftDir[idx] as LiftDirection);
    return { handled: true, worldChanged: true };
  }

  const metro = activateMetro(ctx);
  if (metro.handled) return metro;

  if (tryUseHeatlinePressure(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryUseCarnivorousFungus(ctx.world, ctx.entities, ctx.nextEntityId, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryUsePneumomailTube(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryCoverSeroburmalineSource(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true, worldChanged: true };
  if (tryUseHladonColdPocketCounter(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  const content = tryUseContentInteraction(ctx);
  if (content.handled) return content;

  if (tryUseRouteCue(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryUseProceduralFloorAnomaly(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryUseSamosborVariantInteraction(ctx.world, ctx.entities, ctx.player, ctx.state, ctx.nextEntityId, ctx.lookX, ctx.lookY)) return { handled: true };
  if (tryRepairHermodoorBorerDamage(ctx.world, ctx.player, ctx.state, ctx.lookX, ctx.lookY)) return { handled: true };

  if (ctx.world.cells[idx] === Cell.DOOR) {
    const door = activateDoor(ctx, idx);
    if (door.handled) return door;
  }

  ensureRoomContainers(ctx.world, ctx.state.currentFloor);
  const container = findContainer(ctx, true);
  if (container) {
    ctx.openContainerMenu?.(container);
    return { handled: true, openedOverlay: true };
  }

  return { handled: false };
}

export function activateInteraction(ctx: InteractionContext): InteractionResult {
  if (tryInteractCultProcession(ctx.state, ctx.world, ctx.player, ctx.entities)) return { handled: true };

  const angle = Math.atan2(ctx.lookY - ctx.player.y, ctx.lookX - ctx.player.x);
  const nearX = ctx.player.x + Math.cos(angle) * 0.7;
  const nearY = ctx.player.y + Math.sin(angle) * 0.7;
  const nearCtx: InteractionContext = { ...ctx, lookX: nearX, lookY: nearY };

  const nearHigh = activateHighPriorityInteractionForLook(nearCtx);
  if (nearHigh.handled) return nearHigh;
  const farHigh = activateHighPriorityInteractionForLook(ctx);
  if (farHigh.handled) return farHigh;

  if (tryUseGnilushkaInteraction(ctx.world, ctx.player, ctx.state, ctx.entities, ctx.nextEntityId)) return { handled: true, worldChanged: true };
  if (tryUseSlimevikInteraction(ctx.world, ctx.player, ctx.state, ctx.entities, ctx.nextEntityId)) return { handled: true, worldChanged: true };

  const npc = findFriendlyNpc(ctx);
  if (npc) {
    ctx.openNpcMenu?.(npc);
    return { handled: true, openedOverlay: true };
  }

  if (ctx.manualItemPickup) {
    const itemDrop = findItemDrop(ctx);
    if (itemDrop) {
      const result = pickupDrop(ctx.world, itemDrop, ctx.player, ctx.state.msgs, ctx.state.time, ctx.state, ctx.onPickedDrop);
      return { handled: result.handled };
    }
  }

  const nearNormal = activateNormalPriorityInteractionForLook(nearCtx);
  if (nearNormal.handled) return nearNormal;
  return activateNormalPriorityInteractionForLook(ctx);
}

export function isInteractableOverlayOpen(): boolean {
  if (isArenaOverlayOpen()) return true;
  return isGamblingOverlayOpen()
    || isComputerOverlayOpen()
    || isNetHackOverlayOpen()
    || isNetTerminalBankOpen()
    || isNetTerminalGenDeniedOpen()
    || isFastElevatorOverlayOpen();
}

export function getInteractableOverlaySnapshot(): InteractableOverlaySnapshot {
  if (isGamblingOverlayOpen()) return { open: true, kind: 'gambling' };
  if (isComputerOverlayOpen()) return { open: true, kind: 'computer' };
  if (isNetHackOverlayOpen()) return { open: true, kind: 'net_hack' };
  if (isNetTerminalBankOpen() || isNetTerminalGenDeniedOpen()) return { open: true, kind: 'net_terminal' };
  if (isFastElevatorOverlayOpen()) return { open: true, kind: 'fast_elevator' };
  if (isArenaOverlayOpen()) return { open: true, kind: 'arena' };
  return { open: false, kind: 'none' };
}

export function closeInteractableOverlay(): void {
  closeGamblingMachine();
  closeComputer();
  closeNetHackTerminal();
  closeNetTerminalGen();
  closeFastElevator();
  closeArena();
}

export function handleInteractableOverlayInput(input: InteractableOverlayInput, ctx: Pick<InteractionContext, 'world' | 'state' | 'player' | 'switchFloor'>): InteractionResult {
  if (input.escEdge) {
    closeInteractableOverlay();
    return { handled: true };
  }


  if (isArenaOverlayOpen()) {
    if (input.upNav || input.leftNav) moveArenaSelection(-1);
    if (input.dnNav || input.rightNav) moveArenaSelection(1);
    if (input.interactEdge) activateArenaSelection(ctx);
    return { handled: true };
  }

  if (isFastElevatorOverlayOpen()) {
    if (input.upNav || input.leftNav) moveFastElevatorSelection(-1);
    if (input.dnNav || input.rightNav) moveFastElevatorSelection(1);
    if (input.interactEdge && ctx.switchFloor) activateFastElevator(ctx.world, ctx.state, ctx.player, ctx.switchFloor);
    return { handled: true };
  }

  if (isNetTerminalBankOpen()) {
    if (input.upNav) moveNetTerminalBankAction(-1);
    if (input.dnNav) moveNetTerminalBankAction(1);
    if (input.leftNav) moveNetTerminalBankPreset(-1);
    if (input.rightNav) moveNetTerminalBankPreset(1);
    if (input.interactEdge) activateNetTerminalBank(ctx.state, ctx.player);
    return { handled: true };
  }

  if (isNetTerminalGenDeniedOpen()) {
    return { handled: true };
  }

  if (isGamblingOverlayOpen()) {
    if (input.upNav || input.leftNav) moveGamblingPreset(-1);
    if (input.dnNav || input.rightNav) moveGamblingPreset(1);
    if (input.interactEdge) activateGamblingBet(ctx.world, ctx.state, ctx.player);
    return { handled: true };
  }

  if (isComputerOverlayOpen()) {
    if (input.upNav || input.leftNav) moveComputerPage(-1);
    if (input.dnNav || input.rightNav) moveComputerPage(1);
    if (input.interactEdge) copyComputerData(ctx.world, ctx.state, ctx.player);
    return { handled: true };
  }

  if (isNetHackOverlayOpen()) {
    if (input.interactEdge) attemptNetHack(ctx.world, ctx.state, ctx.player);
    return { handled: true };
  }

  return { handled: false };
}

function isCandidateCell(world: World, idx: number): boolean {
  return !world.aptMask[idx]
    && !world.hermoWall[idx]
    && (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER)
    && world.features[idx] === Feature.NONE;
}

function findGeneratedInteractableCell(world: World, rng: () => number, used: Set<number>): number {
  for (let attempt = 0; attempt < INTERACTABLE_ROOM_ATTEMPTS; attempt++) {
    if (world.rooms.length === 0) break;
    const room = world.rooms[Math.floor(rng() * world.rooms.length)];
    if (!room || room.w < 3 || room.h < 3) continue;
    const x = world.wrap(room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2)));
    const y = world.wrap(room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2)));
    const idx = world.idx(x, y);
    if (!used.has(idx) && isCandidateCell(world, idx)) return idx;
  }
  for (let attempt = 0; attempt < INTERACTABLE_RANDOM_ATTEMPTS; attempt++) {
    const idx = world.idx(Math.floor(rng() * W), Math.floor(rng() * W));
    if (!used.has(idx) && isCandidateCell(world, idx)) return idx;
  }
  return -1;
}

export function placeGeneratedInteractablesForCurrentFloor(world: World, state: GameState): number {
  clearComputers();
  closeComputer();
  closeInteractableOverlay();

  clearGamblingMachines();
  clearNetHackTerminals();

  const seed = hashSeed(`interactables:${state.currentFloor}:${world.rooms.length}`, state.currentFloor * 4099 + world.rooms.length + 1777);
  const rng = seededRandom(seed);
  const used = new Set<number>();
  let placed = 0;

  if (portalAllowsCasinoLikeContent()) {
    const gamblingCell = findGeneratedInteractableCell(world, rng, used);
    if (gamblingCell >= 0) {
      used.add(gamblingCell);
      if (placeGamblingMachine(world, gamblingCell % W, (gamblingCell / W) | 0, rng() < 0.5 ? 'roulette' : 'slots')) placed++;
    }
  }

  const computerCell = findGeneratedInteractableCell(world, rng, used);
  if (computerCell >= 0) {
    used.add(computerCell);
    if (placeComputer(world, computerCell % W, (computerCell / W) | 0, rng() < 0.5 ? 'floor_archive' : 'dispatch_terminal')) placed++;
  }

  const hackCell = findGeneratedInteractableCell(world, rng, used);
  if (hackCell >= 0) {
    used.add(hackCell);
    if (placeNetHackTerminal(world, hackCell % W, (hackCell / W) | 0, rng() < 0.65 ? 'service_gate' : 'archive_gate')) placed++;
  }

  return placed;
}
