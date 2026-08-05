/* ── Void trace seal — local protocol backlash room ───────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, ContainerKind, DoorState, EntityType, AIGoal, Faction, Feature, FloorLevel,
  MonsterKind, Occupation, RoomType, Tex, msg,
  type Entity, type GameState, type Item, type WorldContainer, type WorldEvent, type WorldEventType,
} from '../../core/types';
import { World } from '../../core/world';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { publishEvent, registerWorldEventObserver as observeWorldEvents } from '../../systems/events';
import { hasItem, removeItem } from '../../systems/inventory';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor, findClearArea, placeDoorAt, stampRoom } from '../shared';
import { isPlayerEntity } from '../../systems/player_actor';
import { requireSpawnedPlotNpcFromPackage } from '../plot_npc_spawn';

const CLERK_ID = 'floor20_void_protocol_clerk';
const NEIGHBOR_ID = 'floor20_void_borrowed_neighbor';
const PROTOCOL_ID = 'trace_seal';
const PROTOCOL_NAME = 'Запечатать след';
const TAG_RULE = 'void_rule';
const TAG_PROTOCOL = 'trace_seal';
const TAG_SEAL = 'seal';
const TAG_LEAVE_EVIDENCE = 'leave_evidence';
const TAG_DONE = 'resolved';
const CONTEXT_CAP = 8;
const TRACE_SEAL_COSTS = [
  { itemId: 'seal_wax', label: 'сургуч' },
  { itemId: 'ammo_energy', label: 'энергоячейка' },
  { itemId: 'psi_stabilizer', label: 'ПСИ-стабилизатор' },
] as const;

const CLERK_DEF: PlotNpcDef = {
  name: 'Клерк протокола следа',
  isFemale: false,
  faction: Faction.SCIENTIST,
  occupation: Occupation.SECRETARY,
  sprite: Occupation.SECRETARY,
  hp: 180,
  maxHp: 180,
  money: 0,
  speed: 0.8,
  inventory: [{ defId: 'note', count: 1 }],
  talkLines: [
    'Форма короткая: запечатать след или оставить его уликой. Первый вариант закрывает проход, второй зовет свидетеля.',
    'Цель уже выбрана черным ящиком. Не бегайте по этажу: смотрите номер в записке.',
    'Запечатаете след - заплатите сургучом, ячейкой или здоровьем. Соседний проход закроется на месте.',
  ],
  talkLinesPost: [
    'Под сиреной пишите одно действие и цену. Длинную формулировку дверь не примет.',
    'Черный ящик печатает адрес следа. Бумагу потом можно показать клерку или двери.',
  ],
};

const NEIGHBOR_DEF: PlotNpcDef = {
  name: 'Соседка, взятая взаймы',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 120,
  maxHp: 120,
  money: 4,
  speed: 0.9,
  inventory: [{ defId: 'bread', count: 1 }],
  talkLines: [
    'Я открыла дверь на площадке за хлебом. Шагнула сюда, а моя квартира осталась за другой ручкой.',
    'Не прячь след ради тишины. Закроешь соседний проход - люди за ним перестанут отвечать.',
    'Если запечатаешь, я хотя бы буду знать, какая дверь меня утащила.',
  ],
  talkLinesPost: [
    'Соседний проход уже закрыт. За ним кашляли, теперь молчат - это на вашей бумаге.',
    'Меня вернут не туда. Но улика с адресом останется, и меня будут искать не по слухам.',
  ],
};

registerSideQuest(CLERK_ID, CLERK_DEF, []);
registerSideQuest(NEIGHBOR_ID, NEIGHBOR_DEF, []);

interface TraceSealContext {
  world: World;
  entities: Entity[];
  roomId: number;
  sealContainerId: number;
  evidenceContainerId: number;
  targetDoorIdx: number;
  backlashDoorIdx: number;
}

const traceSealContexts: TraceSealContext[] = [];

function registerTraceSealContext(ctx: TraceSealContext): void {
  const existing = traceSealContexts.find(item => item.world === ctx.world && item.roomId === ctx.roomId);
  if (existing) {
    existing.entities = ctx.entities;
    existing.sealContainerId = ctx.sealContainerId;
    existing.evidenceContainerId = ctx.evidenceContainerId;
    existing.targetDoorIdx = ctx.targetDoorIdx;
    existing.backlashDoorIdx = ctx.backlashDoorIdx;
    return;
  }
  traceSealContexts.push(ctx);
  if (traceSealContexts.length > CONTEXT_CAP) traceSealContexts.splice(0, traceSealContexts.length - CONTEXT_CAP);
}

function eventHasTags(event: WorldEvent, ...tags: string[]): boolean {
  return tags.every(tag => event.tags.includes(tag));
}

function findTraceSealContext(event: WorldEvent): TraceSealContext | undefined {
  if (event.containerId === undefined) return undefined;
  for (let i = traceSealContexts.length - 1; i >= 0; i--) {
    const ctx = traceSealContexts[i];
    if (ctx.sealContainerId === event.containerId || ctx.evidenceContainerId === event.containerId) return ctx;
  }
  return undefined;
}

function addContainerTag(container: WorldContainer | undefined, tag: string): void {
  if (container && !container.tags.includes(tag)) container.tags.push(tag);
}

function choiceAlreadyMade(ctx: TraceSealContext): boolean {
  const seal = ctx.world.containerById.get(ctx.sealContainerId);
  const evidence = ctx.world.containerById.get(ctx.evidenceContainerId);
  return !!(seal?.tags.includes(TAG_DONE) || evidence?.tags.includes(TAG_DONE));
}

function markChoice(ctx: TraceSealContext, branch: string): void {
  const seal = ctx.world.containerById.get(ctx.sealContainerId);
  const evidence = ctx.world.containerById.get(ctx.evidenceContainerId);
  addContainerTag(seal, TAG_DONE);
  addContainerTag(evidence, TAG_DONE);
  addContainerTag(seal, branch);
  addContainerTag(evidence, branch);
}

function targetKey(ctx: TraceSealContext): string {
  return `void:door:${ctx.roomId}:${ctx.targetDoorIdx}`;
}

function pushHud(state: GameState, line: string, color: string): void {
  state.msgs.push(msg(line, state.time, color));
}

function publishProtocol(
  state: GameState,
  ctx: TraceSealContext,
  event: WorldEvent,
  phase: 'obtained' | 'started' | 'backlash' | 'rejected',
  line: string,
  severity: 2 | 3 | 4,
  branch: string,
  data: Record<string, unknown> = {},
): void {
  publishEvent(state, {
    type: `void_protocol_${phase}` as WorldEventType,
    severity,
    privacy: phase === 'rejected' ? 'private' : 'local',
    zoneId: event.zoneId,
    roomId: ctx.roomId,
    x: event.x,
    y: event.y,
    actorId: 0,
    actorName: 'Вы',
    tags: ['void_protocol', phase, PROTOCOL_ID, 'black_box', branch].slice(0, 8),
    data: {
      protocolId: PROTOCOL_ID,
      protocolName: PROTOCOL_NAME,
      targetKey: targetKey(ctx),
      sourceContainerId: event.containerId,
      branch,
      ...data,
    },
  });
  pushHud(state, line, phase === 'backlash' ? '#f8c' : '#8ff');
}

function playerInContext(ctx: TraceSealContext): Entity | undefined {
  return ctx.entities.find(e => isPlayerEntity(e) && e.alive);
}

function nextEntityId(entities: Entity[]): number {
  let id = 1;
  for (const e of entities) id = Math.max(id, e.id + 1);
  return id;
}

function spawnTraceThreat(ctx: TraceSealContext, kind: MonsterKind, name: string, x: number, y: number): void {
  const world = ctx.world;
  const def = MONSTERS[kind];
  if (!def) return;
  const sx = world.wrap(x);
  const sy = world.wrap(y);
  if (world.cells[world.idx(sx, sy)] !== Cell.FLOOR) return;
  const zoneId = world.zoneMap[world.idx(sx, sy)];
  const level = Math.max(14, world.zones[zoneId]?.level ?? 14);
  const hp = Math.round(scaleMonsterHp(def.hp, level));
  ctx.entities.push({
    id: nextEntityId(ctx.entities),
    type: EntityType.MONSTER,
    x: sx + 0.5,
    y: sy + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    phasing: kind === MonsterKind.SPIRIT,
  });
}

function spawnBacklashParagraph(ctx: TraceSealContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  spawnTraceThreat(ctx, MonsterKind.PARAGRAPH, 'Параграф черного ящика', room.x + room.w - 3, room.y + room.h - 3);
}

function spawnEvidenceWitness(ctx: TraceSealContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  spawnTraceThreat(ctx, MonsterKind.SPIRIT, 'Свидетель оставленного следа', room.x + room.w - 4, room.y + 2);
}

function markTraceBranch(ctx: TraceSealContext, branch: 'seal' | 'leave_evidence'): void {
  const world = ctx.world;
  const room = world.rooms[ctx.roomId];
  if (!room) return;
  const x = world.wrap(room.x + (room.w >> 1));
  const y = world.wrap(room.y + (room.h >> 1));
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.FLOOR) {
    world.features[ci] = branch === 'seal' ? Feature.APPARATUS : Feature.SCREEN;
    stampSurfaceSplat(world, x, y, 0.5, 0.5, branch === 'seal' ? 0.5 : 0.68, branch === 'seal' ? 0.72 : 0.48, room.id * 43 + (branch === 'seal' ? 11 : 19), branch === 'seal' ? 80 : 220, 240, branch === 'seal' ? 255 : 190, true);
  }
  if (!room.name.includes(branch === 'seal' ? 'след запечатан' : 'улика оставлена')) {
    room.name = `${room.name}; ${branch === 'seal' ? 'след запечатан' : 'улика оставлена'}`;
  }
}

function spendTraceSealCost(player: Entity, state: GameState): { label: string; itemId?: string; hpCost: number } {
  for (const cost of TRACE_SEAL_COSTS) {
    if (!hasItem(player, cost.itemId)) continue;
    removeItem(player, cost.itemId, 1);
    return { label: cost.label, itemId: cost.itemId, hpCost: 0 };
  }
  if (player.hp !== undefined) {
    player.hp = Math.max(1, player.hp - 4);
    state.dmgFlash = Math.max(state.dmgFlash, 0.25);
  }
  return { label: 'здоровье', hpCost: 4 };
}

function sealTraceTarget(ctx: TraceSealContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (room) room.sealed = true;
  const target = ctx.world.doors.get(ctx.targetDoorIdx);
  if (target) {
    target.state = DoorState.HERMETIC_CLOSED;
    target.timer = Math.max(target.timer, 90);
  }
  const backlash = ctx.world.doors.get(ctx.backlashDoorIdx);
  if (backlash) {
    backlash.state = DoorState.HERMETIC_CLOSED;
    backlash.timer = Math.max(backlash.timer, 18);
  }
}

function leaveTraceEvidence(ctx: TraceSealContext): void {
  const room = ctx.world.rooms[ctx.roomId];
  if (!room) return;
  room.sealed = false;
  const target = ctx.world.doors.get(ctx.targetDoorIdx);
  if (target) {
    target.state = DoorState.OPEN;
    target.timer = 0;
  }
  const backlash = ctx.world.doors.get(ctx.backlashDoorIdx);
  if (backlash) {
    backlash.state = DoorState.OPEN;
    backlash.timer = 0;
  }
  markTraceBranch(ctx, 'leave_evidence');
  ctx.entities.push({
    id: nextEntityId(ctx.entities),
    type: EntityType.ITEM_DROP,
    x: room.x + (room.w >> 1) + 0.5,
    y: room.y + 2.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{
      defId: 'note',
      count: 1,
      data: { text: `${targetKey(ctx)}: след оставлен уликой, дверь не запечатана.` },
    }],
  });
}

function applyTraceSeal(ctx: TraceSealContext, state: GameState, event: WorldEvent): void {
  markChoice(ctx, 'sealed');
  const player = playerInContext(ctx);
  const cost = player ? spendTraceSealCost(player, state) : { label: 'нет плательщика', hpCost: 0 };
  sealTraceTarget(ctx);
  markTraceBranch(ctx, 'seal');
  publishProtocol(state, ctx, event, 'obtained', `Получен протокол: ${PROTOCOL_NAME}.`, 3, TAG_SEAL, {
    cost: cost.label,
    costItemId: cost.itemId,
    hpCost: cost.hpCost,
  });
  publishProtocol(state, ctx, event, 'started', `След запечатан. Цена: ${cost.label}.`, 4, TAG_SEAL, {
    cost: cost.label,
    costItemId: cost.itemId,
    hpCost: cost.hpCost,
  });
  spawnBacklashParagraph(ctx);
  publishProtocol(state, ctx, event, 'backlash', 'Отдача: соседний проход закрылся; за ним больше не слышно людей.', 4, TAG_SEAL, {
    spawned: 'paragraph',
  });
}

function applyTraceEvidence(ctx: TraceSealContext, state: GameState, event: WorldEvent): void {
  markChoice(ctx, 'evidence_left');
  leaveTraceEvidence(ctx);
  publishProtocol(state, ctx, event, 'obtained', `Получен протокол: ${PROTOCOL_NAME}.`, 3, TAG_LEAVE_EVIDENCE, {
    cost: 'none',
  });
  publishProtocol(state, ctx, event, 'started', 'След оставлен уликой. Дверь остается открытой, но спорной.', 3, TAG_LEAVE_EVIDENCE, {
    counterplay: 'route_stays_open',
  });
  const player = playerInContext(ctx);
  if (player) player.psiMadness = Math.max(player.psiMadness ?? 0, 2);
  spawnEvidenceWitness(ctx);
  publishProtocol(state, ctx, event, 'backlash', 'Отдача: улика позвала свидетеля.', 3, TAG_LEAVE_EVIDENCE, {
    spawned: 'spirit',
  });
}

function handleTraceSealEvent(state: GameState, event: WorldEvent): void {
  if (event.type !== 'container_opened' && event.type !== 'item_stolen') return;
  if (!eventHasTags(event, TAG_RULE, TAG_PROTOCOL)) return;
  const ctx = findTraceSealContext(event);
  if (!ctx) return;
  if (choiceAlreadyMade(ctx)) {
    publishProtocol(state, ctx, event, 'rejected', 'Протокол уже выбран.', 2, 'repeat');
    return;
  }
  if (eventHasTags(event, TAG_SEAL)) applyTraceSeal(ctx, state, event);
  else if (eventHasTags(event, TAG_LEAVE_EVIDENCE)) applyTraceEvidence(ctx, state, event);
}

observeWorldEvents(handleTraceSealEvent);

function setVoidRoomTextures(world: World, rx: number, ry: number, rw: number, rh: number): void {
  for (let dy = -1; dy <= rh; dy++) {
    for (let dx = -1; dx <= rw; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      if (dx >= 0 && dx < rw && dy >= 0 && dy < rh) {
        world.floorTex[ci] = Tex.F_VOID;
      } else {
        world.wallTex[ci] = Tex.VOID_WALL;
      }
    }
  }
}

function nextContainerId(world: World): number {
  let id = world.containers.length + 1;
  while (world.containerById.has(id) || world.containers.some(c => c.id === id)) id++;
  return id;
}

function addTraceContainer(
  world: World,
  roomId: number,
  x: number,
  y: number,
  name: string,
  inventory: Item[],
  tags: string[],
): number {
  const id = nextContainerId(world);
  const container: WorldContainer = {
    id,
    x: world.wrap(x),
    y: world.wrap(y),
    floor: FloorLevel.VOID,
    roomId,
    zoneId: world.zoneMap[world.idx(x, y)],
    kind: ContainerKind.SECRET_STASH,
    name,
    inventory,
    capacitySlots: 3,
    access: 'public',
    discovered: true,
    tags,
  };
  world.addContainer(container);
  return id;
}

function spawnProtocolNpc(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  plotNpcId: string,
  _def: PlotNpcDef,
  x: number,
  y: number,
): void {
  const px = world.wrap(x) + 0.5;
  const py = world.wrap(y) + 0.5;
  requireSpawnedPlotNpcFromPackage(entities, nextId, plotNpcId, px, py, {
    angle: 0,
    canGiveQuest: false,
    aiTarget: { x: px, y: py },
  });
}

export function generateTraceSealProtocol(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  spawnX: number,
  spawnY: number,
): void {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const rw = 15;
  const rh = 9;
  const pos = findClearArea(world, sx, sy, rw, rh, 34, 62);
  const rx = pos ? pos.x : world.wrap(sx + 44);
  const ry = pos ? pos.y : world.wrap(sy + 18);
  const room = stampRoom(world, world.rooms.length, RoomType.OFFICE, rx, ry, rw, rh, -1);
  room.name = 'Черный ящик подъезда';
  room.wallTex = Tex.VOID_WALL;
  room.floorTex = Tex.F_VOID;
  setVoidRoomTextures(world, room.x, room.y, room.w, room.h);

  const doorY = world.wrap(room.y + (room.h >> 1));
  placeDoorAt(world, room.x - 1, doorY, room.id);
  carveCorridor(world, sx, sy, room.x - 2, doorY);
  const entrance = world.doors.get(world.idx(room.x - 1, doorY));
  if (entrance) {
    entrance.state = DoorState.OPEN;
    entrance.timer = 0;
  }

  const targetY = world.wrap(room.y + 2);
  const backlashY = world.wrap(room.y + room.h - 3);
  placeDoorAt(world, room.x + room.w, targetY, room.id);
  placeDoorAt(world, room.x + room.w, backlashY, room.id);
  const targetDoorIdx = world.idx(room.x + room.w, targetY);
  const backlashDoorIdx = world.idx(room.x + room.w, backlashY);
  const targetDoor = world.doors.get(targetDoorIdx);
  const backlashDoor = world.doors.get(backlashDoorIdx);
  if (targetDoor) targetDoor.state = DoorState.HERMETIC_OPEN;
  if (backlashDoor) backlashDoor.state = DoorState.OPEN;

  for (let dx = 2; dx < room.w - 2; dx += 3) {
    world.features[world.idx(room.x + dx, room.y + 2)] = Feature.DESK;
  }
  world.features[world.idx(room.x + 1, room.y + 1)] = Feature.SCREEN;
  world.features[world.idx(room.x + room.w - 2, room.y + 1)] = Feature.APPARATUS;
  world.features[world.idx(room.x + 2, room.y + room.h - 2)] = Feature.LAMP;
  world.features[world.idx(room.x + room.w - 3, room.y + room.h - 2)] = Feature.LAMP;

  spawnProtocolNpc(world, entities, nextId, CLERK_ID, CLERK_DEF, room.x + 3, room.y + room.h - 3);
  spawnProtocolNpc(world, entities, nextId, NEIGHBOR_ID, NEIGHBOR_DEF, room.x + room.w - 4, room.y + room.h - 3);

  const sealContainerId = addTraceContainer(
    world,
    room.id,
    room.x + 5,
    room.y + (room.h >> 1),
    'Бланк: запечатать след',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ПРОТОКОЛ: запечатать выбранный след. Заплатите сургучом, энергоячейкой или здоровьем; соседний проход закроется.' },
    }],
    [TAG_RULE, TAG_PROTOCOL, TAG_SEAL],
  );
  const evidenceContainerId = addTraceContainer(
    world,
    room.id,
    room.x + room.w - 6,
    room.y + (room.h >> 1),
    'Бланк: оставить след уликой',
    [{
      defId: 'note',
      count: 1,
      data: { text: 'ПРОТОКОЛ: оставить выбранный след уликой. Проход останется открыт, но появится свидетель.' },
    }],
    [TAG_RULE, TAG_PROTOCOL, TAG_LEAVE_EVIDENCE, 'evidence'],
  );
  addTraceContainer(
    world,
    room.id,
    room.x + (room.w >> 1),
    room.y + 2,
    'Черный ящик: назначенный след',
    [{
      defId: 'note',
      count: 1,
      data: { text: `TRACE ${targetKey({ world, entities, roomId: room.id, sealContainerId, evidenceContainerId, targetDoorIdx, backlashDoorIdx })}: цель указана на этой бумаге; бегать по этажу не надо.` },
    }],
    ['void_trace', 'black_box', 'floor20_void'],
  );

  registerTraceSealContext({
    world,
    entities,
    roomId: room.id,
    sealContainerId,
    evidenceContainerId,
    targetDoorIdx,
    backlashDoorIdx,
  });
}
