/* ── Scripted A-Life-like arrivals for authored plot beats ────── */

import {
  AIGoal,
  Cell,
  EntityType,
  LiftDirection,
  W,
  msg,
  type Entity,
  type GameState,
  type Item,
} from '../core/types';
import { World } from '../core/world';
import { freshNeeds, randomName } from '../data/catalog';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName, type NpcPackageDef } from '../data/npc_packages';
import { PLOT_CHAIN } from '../data/plot';
import { SCRIPTED_ARRIVALS, type ScriptedArrivalDef, type ScriptedArrivalEscortDef } from '../data/scripted_arrivals';
import { entitySpawnSlots } from './entity_limits';
import { assignPersistentAlifeNpcFromEntity, bindReservedPlotNpcAlifeRecord, currentAlifeFloorKey, isPlotNpcDead } from './alife';
import { publishEvent } from './events';
import { currentFloorRunEntry } from './procedural_floors';
import { freshRPG, randomRPG, getMaxHp } from './rpg';
import { tryAssignPathToCell } from './ai/pathfinding';

function scriptedArrivalStepIndex(def: ScriptedArrivalDef): number {
  return PLOT_CHAIN.findIndex(step => step.eventTags?.includes(def.triggerPlotEventTag));
}

function shouldSpawnScriptedArrival(def: ScriptedArrivalDef, state: GameState, entities: readonly Entity[]): boolean {
  const stepIndex = scriptedArrivalStepIndex(def);
  if (stepIndex < 0) return false;
  if (state.currentFloor !== def.currentFloor) return false;
  if (def.currentStoryFloor !== undefined && currentFloorRunEntry(state).storyFloor !== def.currentStoryFloor) return false;
  if (!state.quests.some(q => q.plotStepIndex === stepIndex && q.done && !q.failed)) return false;
  if (state.quests.some(q => q.plotStepIndex !== undefined && q.plotStepIndex > stepIndex)) return false;
  if (entities.some(e => e.type === EntityType.NPC && e.alive && e.plotNpcId === def.leaderPlotNpcId)) return false;
  return !isPlotNpcDead(state, def.leaderPlotNpcId);
}

function passable(world: World, x: number, y: number): boolean {
  const cell = world.cells[world.idx(x, y)];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.LIFT;
}

function nearestStandCell(world: World, cell: number): number {
  const x = cell % W;
  const y = (cell / W) | 0;
  if (passable(world, x, y)) return cell;
  for (let r = 1; r <= 5; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = world.idx(x + dx, y + dy);
        if (passable(world, (ci % W), (ci / W) | 0)) return ci;
      }
    }
  }
  return cell;
}

function arrivalCellNearLift(
  world: World,
  targetX: number,
  targetY: number,
  fallbackX: number,
  fallbackY: number,
  preferredDirection?: LiftDirection,
): number {
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const dir = world.liftDir[i];
    const lx = i % W;
    const ly = (i / W) | 0;
    const stand = nearestStandCell(world, i);
    const baseScore = world.dist2(targetX, targetY, lx + 0.5, ly + 0.5) + (preferredDirection === undefined || dir === preferredDirection ? 0 : 64);
    const jitter = ((lx * 11 + ly * 13) % 100) * 0.001;
    const score = baseScore + jitter;
    if (score < bestScore) {
      best = stand;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  return nearestStandCell(world, world.idx(Math.floor(fallbackX), Math.floor(fallbackY)));
}

function arrivalAnchor(def: ScriptedArrivalDef, state: GameState, world: World, player: Entity): { x: number; y: number } {
  const stepIndex = scriptedArrivalStepIndex(def);
  const quest = state.quests.find(q => q.plotStepIndex === stepIndex);
  const room = quest?.targetRoom !== undefined
    ? world.rooms[quest.targetRoom]
    : quest?.targetRoomName
      ? world.rooms.find(r => r?.name === quest.targetRoomName)
      : undefined;
  if (!room) return { x: player.x, y: player.y };
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

function sendToAnchor(world: World, entity: Entity, anchor: { x: number; y: number }): void {
  if (!entity.ai) return;
  entity.ai.goal = AIGoal.GOTO;
  entity.ai.tx = Math.floor(anchor.x);
  entity.ai.ty = Math.floor(anchor.y);
  const status = tryAssignPathToCell(world, entity, entity.ai.tx, entity.ai.ty);
  if (status === 'not_found') entity.ai.goal = AIGoal.WANDER;
}

function packageItems(items: readonly Item[] | undefined): Item[] {
  return (items ?? []).map(item => ({ ...item }));
}

function packageMaxHp(pack: NpcPackageDef): number {
  return Math.max(1, pack.runtime?.maxHp ?? pack.runtime?.hp ?? 100);
}

function packageHp(pack: NpcPackageDef): number {
  return Math.max(1, Math.min(pack.runtime?.hp ?? packageMaxHp(pack), packageMaxHp(pack)));
}

function packageSpeed(pack: NpcPackageDef): number {
  return Math.max(0.1, Math.min(20, pack.runtime?.speed ?? 1.2));
}

function spawnArrivalLeader(
  def: ScriptedArrivalDef,
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  cell: number,
  anchor: { x: number; y: number },
  floorKey: string,
): boolean {
  const pack = getNpcPackageByPlotNpcId(def.leaderPlotNpcId);
  const plotNpcId = pack?.content?.plotNpcId;
  if (!pack || plotNpcId !== def.leaderPlotNpcId) return false;
  const x = cell % W;
  const y = (cell / W) | 0;
  const major: Entity & { npcPackageId: string } = {
    id: nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: packageSpeed(pack),
    sprite: pack.visual.sprite ?? pack.affiliation.occupation,
    spriteSeed: pack.visual.spriteSeed,
    npcVisualId: pack.visual.npcVisualId,
    name: npcPackageDisplayName(pack),
    isFemale: pack.demographics.sex === 'female',
    age: pack.demographics.age,
    sex: pack.demographics.sex,
    needs: freshNeeds(),
    hp: packageHp(pack),
    maxHp: packageMaxHp(pack),
    money: pack.wealth.cashRubles ?? 0,
    accountRubles: pack.wealth.accountRubles,
    rpg: freshRPG(pack.rpg.level),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: packageItems(pack.loadout.inventory),
    weapon: def.leaderWeapon ?? pack.loadout.weapon,
    tool: pack.loadout.tool,
    faction: pack.affiliation.faction,
    occupation: pack.affiliation.occupation,
    plotNpcId,
    npcPackageId: pack.id,
    canGiveQuest: pack.runtime?.canGiveQuest ?? true,
    questId: -1,
    isTraveler: def.leaderTraveler === true,
  };
  if (!bindReservedPlotNpcAlifeRecord(state, major, plotNpcId, floorKey)) return false;
  sendToAnchor(world, major, anchor);
  entities.push(major);
  return true;
}

function spawnArrivalEscort(
  def: ScriptedArrivalEscortDef,
  world: World,
  entities: Entity[],
  state: GameState,
  nextId: { v: number },
  cell: number,
  anchor: { x: number; y: number },
  idx: number,
  floorKey: string,
): number | null {
  const x = world.wrap((cell % W) + (idx % 3) - 1);
  const y = world.wrap(((cell / W) | 0) + Math.floor(idx / 3));
  if (!passable(world, x, y)) return null;
  const name = randomName(def.faction);
  const rpg = randomRPG(def.level);
  const maxHp = Math.round(getMaxHp(rpg) * def.hpMultiplier);
  const weapon = def.weapons[idx % def.weapons.length] ?? def.weapons[0] ?? 'makarov';
  const ammo = def.ammoByWeapon[weapon] ?? def.defaultAmmo;
  const npc: Entity = {
    id: nextId.v++, type: EntityType.NPC,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0, alive: true, speed: def.speedBase + Math.random() * def.speedSpread,
    sprite: def.occupation,
    name: name.name, firstName: name.firstName, lastName: name.lastName, isFemale: name.female,
    needs: freshNeeds(), hp: maxHp, maxHp,
    money: 20 + Math.floor(Math.random() * 50),
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    inventory: [
      { defId: weapon, count: 1 },
      { defId: ammo.defId, count: ammo.count },
      ...def.inventory.map(item => ({ ...item })),
    ],
    weapon,
    faction: def.faction,
    occupation: def.occupation,
    isTraveler: def.traveler === true,
    questId: -1,
    rpg,
  };
  if (!assignPersistentAlifeNpcFromEntity(state, npc, entities, floorKey)) return null;
  sendToAnchor(world, npc, anchor);
  entities.push(npc);
  return npc.alifeId ?? null;
}

function executeScriptedArrival(def: ScriptedArrivalDef, world: World, entities: Entity[], player: Entity, state: GameState, nextId: { v: number }): boolean {
  const anchor = arrivalAnchor(def, state, world, player);
  const cell = arrivalCellNearLift(world, anchor.x, anchor.y, player.x, player.y, def.preferredLiftDirection);
  const toFloorKey = currentAlifeFloorKey(state);
  if (!spawnArrivalLeader(def, world, entities, state, nextId, cell, anchor, toFloorKey)) return false;
  const guardAlifeIds: number[] = [];
  const escort = def.escort;
  const slots = escort ? entitySpawnSlots(entities, EntityType.NPC, escort.count) : 0;
  for (let i = 0; i < slots; i++) {
    const alifeId = escort ? spawnArrivalEscort(escort, world, entities, state, nextId, cell, anchor, i, toFloorKey) : null;
    if (alifeId !== null) guardAlifeIds.push(alifeId);
  }
  const leaderPack = getNpcPackageByPlotNpcId(def.leaderPlotNpcId);
  publishEvent(state, {
    type: 'faction_event',
    x: cell % W,
    y: (cell / W) | 0,
    targetName: leaderPack ? npcPackageDisplayName(leaderPack) : def.leaderPlotNpcId,
    targetFaction: leaderPack?.affiliation.faction,
    severity: def.eventSeverity,
    privacy: 'public',
    tags: [...def.eventTags],
    data: {
      arrivalId: def.id,
      plotNpcId: def.leaderPlotNpcId,
      fromFloorKey: def.sourceFloorKey,
      toFloorKey,
      guardCount: guardAlifeIds.length,
      guardAlifeIds,
    },
  });
  state.msgs.push(msg(def.message, state.time, '#8cf'));
  return true;
}

export function updateScriptedArrivals(world: World, entities: Entity[], player: Entity, state: GameState, nextId: { v: number }): boolean {
  for (const def of SCRIPTED_ARRIVALS) {
    if (shouldSpawnScriptedArrival(def, state, entities)) {
      return executeScriptedArrival(def, world, entities, player, state, nextId);
    }
  }
  return false;
}
