/* ── Carnivorous fungus room: local hazard + explicit counterplay ─ */

import {
  Cell, EntityType, Faction, Feature, ProjType, Tex,
  type Entity, type GameState, type Room, type WorldEventSeverity, msg,
} from '../core/types';
import { World } from '../core/world';
import { ITEMS } from '../data/catalog';
import { addFactionRelMutual } from '../data/relations';
import { stampMark, MarkType } from './surface_marks';
import { Spr } from '../render/sprite_index';
import { addItem, hasItem, removeItem } from './inventory';
import { publishEvent } from './events';

const ROOM_PREFIX = 'Плотоядная грибница';
const TAG_NEUTRALIZED = '[соль 0]';
const TAG_BURNED = '[зола 0]';
const TAG_FED = '[сыта]';
const TAG_HARVESTED = '[срезан]';
const SALT_ITEM = 'rock_salt';
const DECON_FLUID_ITEM = 'decon_fluid';
const INCENDIARY_12G_ITEM = 'ammo_12g_incendiary';
const REAGENT_ITEM = 'antifungal_ointment';
const HAZARD_RADIUS2 = 4.2 * 4.2;
const NEARBY_RADIUS2 = 72 * 72;

let trackedWorld: World | null = null;
let scanAccum = 0;
let hazardAccum = 0;
let nextHazardMsgAt = 0;
const discoveredRooms = new Set<number>();
const fedCorpseIds = new Set<number>();

function resetForWorld(world: World): void {
  if (trackedWorld === world) return;
  trackedWorld = world;
  scanAccum = 0;
  hazardAccum = 0;
  nextHazardMsgAt = 0;
  discoveredRooms.clear();
  fedCorpseIds.clear();
}

export function isCarnivorousFungusRoom(room: Room | null | undefined): room is Room {
  return !!room && room.name.includes(ROOM_PREFIX);
}

function roomHas(room: Room, tag: string): boolean {
  return room.name.includes(tag);
}

function roomActive(room: Room): boolean {
  return isCarnivorousFungusRoom(room) && !roomHas(room, TAG_NEUTRALIZED) && !roomHas(room, TAG_BURNED);
}

function addRoomTag(room: Room, tag: string): void {
  if (!room.name.includes(tag)) room.name = `${room.name} ${tag}`;
}

function roomCenter(room: Room): { x: number; y: number } {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function eventZone(world: World, x: number, y: number): number {
  return world.zoneMap[world.idx(Math.floor(x), Math.floor(y))];
}

function publishFungusEvent(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  type: 'room_regrown' | 'hazard_trapped' | 'hazard_cleaned' | 'player_pick_item' | 'monster_bait_consumed' | 'faction_relation_changed',
  severity: WorldEventSeverity,
  tags: string[],
  data: Record<string, unknown>,
  itemId?: string,
): void {
  const item = itemId ? ITEMS[itemId] : undefined;
  publishEvent(state, {
    type,
    zoneId: eventZone(world, player.x, player.y),
    roomId: room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId,
    itemName: item?.name,
    itemCount: itemId ? 1 : undefined,
    itemValue: item?.value,
    severity,
    privacy: 'local',
    tags: ['fungus', 'carnivorous_fungus', 'zhelemish', ...tags],
    data: { roomName: room.name, ...data },
  });
}

function damagePlayer(player: Entity, amount: number): void {
  if (player.hp === undefined) return;
  player.hp = Math.max(1, player.hp - amount);
}

function markRoomSafe(world: World, room: Room, burned: boolean): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = room.x + dx;
      const y = room.y + dy;
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id) continue;
      if (world.floorTex[ci] === Tex.F_GUT) world.floorTex[ci] = burned ? Tex.F_CONCRETE : Tex.F_TILE;
      if (world.fog[ci] > 0) world.fog[ci] = burned ? Math.min(world.fog[ci], 25) : 0;
    }
  }
  const center = roomCenter(room);
  stampMark(
    world,
    center.x, center.y,
    0.5, 0.5,
    burned ? 4.8 : 3.4,
    burned ? MarkType.SCORCH : MarkType.POOL,
    113_000 + room.id,
    burned ? 18 : 185,
    burned ? 12 : 190,
    burned ? 8 : 155,
    burned ? 230 : 170,
  );
  world.markFloorTexDirty();
  world.markFogDirty();
}

function fungusHazardCell(world: World, room: Room, x: number, y: number): boolean {
  if (!roomActive(room)) return false;
  const ci = world.idx(x, y);
  if (world.roomMap[ci] !== room.id) return false;
  if (world.floorTex[ci] === Tex.F_GUT) return true;
  const feature = world.features[ci] as Feature;
  if (feature === Feature.APPARATUS || feature === Feature.MACHINE) return true;
  const center = roomCenter(room);
  return world.dist2(x + 0.5, y + 0.5, center.x + 0.5, center.y + 0.5) <= HAZARD_RADIUS2;
}

function findNeutralizer(player: Entity): string {
  if (hasItem(player, SALT_ITEM)) return SALT_ITEM;
  if (hasItem(player, DECON_FLUID_ITEM)) return DECON_FLUID_ITEM;
  if (hasItem(player, INCENDIARY_12G_ITEM)) return INCENDIARY_12G_ITEM;
  if (hasItem(player, REAGENT_ITEM)) return REAGENT_ITEM;
  return '';
}

function neutralizerEventTag(itemId: string): string {
  if (itemId === SALT_ITEM) return 'salt';
  if (itemId === DECON_FLUID_ITEM) return 'decon';
  return 'reagent';
}

function neutralizerMessage(itemId: string): string {
  if (itemId === SALT_ITEM) return 'Соль взяла грибницу сухим кругом. В центре остался варёный желемыш.';
  if (itemId === DECON_FLUID_ITEM) return 'Раствор снял грибницу щёлочным кругом. В центре остался варёный желемыш.';
  return 'Противогрибковый реагент усадил грибницу. В центре остался варёный желемыш.';
}

function dropReward(world: World, entities: Entity[], nextId: { v: number }, room: Room, defId: string, count = 1): void {
  const candidates: [number, number][] = [
    [room.x + 2, room.y + room.h - 3],
    [room.x + room.w - 3, room.y + 2],
    [room.x + 2, room.y + 2],
    [room.x + room.w - 3, room.y + room.h - 3],
  ];
  for (const [x, y] of candidates) {
    const ci = world.idx(x, y);
    if (world.roomMap[ci] !== room.id || world.cells[ci] !== Cell.FLOOR) continue;
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
      inventory: [{ defId, count }],
    });
    return;
  }
}

function neutralizeRoom(world: World, entities: Entity[], nextId: { v: number }, player: Entity, state: GameState, room: Room, itemId: string): void {
  removeItem(player, itemId, 1);
  addRoomTag(room, TAG_NEUTRALIZED);
  markRoomSafe(world, room, false);
  addItem(player, 'zhelemish_boiled', 1);
  dropReward(world, entities, nextId, room, 'zhelemish_dried', 1);
  addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, 1);
  state.msgs.push(msg(neutralizerMessage(itemId), state.time, '#9f8'));
  publishFungusEvent(world, player, state, room, 'hazard_cleaned', 4, ['neutralized', neutralizerEventTag(itemId), 'counterplay'], {
    consumed: itemId,
    reward: ['zhelemish_boiled', 'zhelemish_dried'],
    relationDelta: 1,
  }, itemId);
}

function burnRoom(world: World, entities: Entity[], nextId: { v: number }, player: Entity, state: GameState, room: Room, itemId?: string): void {
  addRoomTag(room, TAG_BURNED);
  markRoomSafe(world, room, true);
  dropReward(world, entities, nextId, room, 'zhelemish_dried', 1);
  state.msgs.push(msg('Грибница вспыхнула и сжалась в чёрный сладкий пепел.', state.time, '#fa4'));
  publishFungusEvent(world, player, state, room, 'hazard_cleaned', 4, ['burned', 'fire', 'counterplay'], {
    reward: ['zhelemish_dried'],
    consumed: itemId,
  }, itemId);
}

function harvestRoom(world: World, player: Entity, state: GameState, room: Room): void {
  if (roomHas(room, TAG_HARVESTED)) {
    state.msgs.push(msg('Грибница уже срезана. Остались зубы и мокрый запах.', state.time, '#888'));
    return;
  }
  addRoomTag(room, TAG_HARVESTED);
  damagePlayer(player, 12);
  addItem(player, 'zhelemish_raw', 2);
  state.dmgFlash = Math.max(state.dmgFlash, 0.35);
  state.msgs.push(msg('Вы срезали желемыш из пасти. Кожа спорит, но добыча в кармане.', state.time, '#bf8'));
  publishFungusEvent(world, player, state, room, 'player_pick_item', 3, ['harvested', 'risky_harvest'], {
    damage: 12,
    reward: ['zhelemish_raw', 'zhelemish_raw'],
  }, 'zhelemish_raw');
}

export function tryUseCarnivorousFungus(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const lookRoomId = world.roomMap[world.idx(Math.floor(lookX), Math.floor(lookY))];
  const lookRoom = lookRoomId >= 0 ? world.rooms[lookRoomId] : null;
  const playerRoom = world.roomAt(player.x, player.y);
  const room = isCarnivorousFungusRoom(lookRoom)
    ? lookRoom
    : isCarnivorousFungusRoom(playerRoom)
      ? playerRoom
      : null;
  if (!room) return false;

  if (roomHas(room, TAG_BURNED)) {
    state.msgs.push(msg('Пепел грибницы хрустит под ногой. Здесь уже не кормят.', state.time, '#888'));
    return true;
  }

  if (roomHas(room, TAG_NEUTRALIZED)) {
    if (roomHas(room, TAG_HARVESTED)) {
      state.msgs.push(msg('Обработанная грибница уже срезана. Дальше только мокрая труха.', state.time, '#888'));
      return true;
    }
    addRoomTag(room, TAG_HARVESTED);
    addItem(player, 'zhelemish_dried', 1);
    state.msgs.push(msg('Из сухого круга снят безопасный желемыш.', state.time, '#9f8'));
    publishFungusEvent(world, player, state, room, 'player_pick_item', 2, ['harvested', 'safe_harvest', 'neutralized'], {
      reward: ['zhelemish_dried'],
    }, 'zhelemish_dried');
    return true;
  }

  const neutralizer = findNeutralizer(player);
  if (neutralizer) {
    if (neutralizer === INCENDIARY_12G_ITEM) {
      removeItem(player, neutralizer, 1);
      burnRoom(world, entities, nextId, player, state, room, neutralizer);
      return true;
    }
    neutralizeRoom(world, entities, nextId, player, state, room, neutralizer);
    return true;
  }

  harvestRoom(world, player, state, room);
  return true;
}

function updatePlayerHazard(world: World, player: Entity, state: GameState): void {
  const room = world.roomAt(player.x, player.y);
  if (!isCarnivorousFungusRoom(room)) return;

  if (!discoveredRooms.has(room.id)) {
    discoveredRooms.add(room.id);
    state.msgs.push(msg('У входа кости лежат сухо: плотоядная грибница ждёт мясо, соль, раствор или огонь.', state.time, '#bf8'));
    publishFungusEvent(world, player, state, room, 'room_regrown', 3, ['discovered', 'warning'], {
      warning: 'corpse-fed fungus room',
      counterplay: ['avoid', 'salt', 'decon_fluid', 'fire', 'bait', 'risky_harvest'],
    });
  }

  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  if (!fungusHazardCell(world, room, px, py)) return;

  damagePlayer(player, 4);
  state.dmgFlash = Math.max(state.dmgFlash, 0.2);
  if (state.time >= nextHazardMsgAt) {
    state.msgs.push(msg('Грибница цепляет подошвы и пробует кровь. К краю, к соли или к огню.', state.time, '#f84'));
    publishFungusEvent(world, player, state, room, 'hazard_trapped', 3, ['hazard', 'area_denial'], {
      damage: 4,
      hazardName: 'плотоядная грибница',
    });
    nextHazardMsgAt = state.time + 3.5;
  }
}

function baitItemId(drop: Entity): string {
  for (const item of drop.inventory ?? []) {
    if (item.count <= 0) continue;
    if (item.defId === 'rawmeat' || item.defId === 'infected_mushroom') return item.defId;
  }
  return '';
}

function feedRoom(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
  state: GameState,
  room: Room,
  source: 'bait' | 'monster_corpse' | 'npc_corpse',
  itemId?: string,
): void {
  addRoomTag(room, TAG_FED);
  const center = roomCenter(room);
  stampMark(world, center.x, center.y, 0.5, 0.5, 2.7, MarkType.POOL, 113_700 + room.id, 74, 135, 46, 190);
  dropReward(world, entities, nextId, room, source === 'bait' ? 'zhelemish_raw' : 'zhelemish_dried', 1);

  if (source === 'npc_corpse') {
    addFactionRelMutual(Faction.PLAYER, Faction.CITIZEN, -3);
    addFactionRelMutual(Faction.PLAYER, Faction.LIQUIDATOR, -2);
    publishFungusEvent(world, player, state, room, 'faction_relation_changed', 3, ['corpse_handling', 'social'], {
      factionDeltas: { citizen: -3, liquidator: -2 },
    });
  }

  state.msgs.push(msg(
    source === 'bait'
      ? 'Мясо ушло под шляпки. Грибница отпустила свежий желемыш у края.'
      : 'Труп дёрнулся под мицелием. У края подсохла полезная пластина.',
    state.time,
    '#bf8',
  ));
  publishFungusEvent(world, player, state, room, 'monster_bait_consumed', 4, ['fed', source], {
    source,
    consumed: itemId ?? source,
    reward: source === 'bait' ? 'zhelemish_raw' : 'zhelemish_dried',
  }, itemId);
}

function updateNearbyFeeds(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  player: Entity,
  state: GameState,
): void {
  let handled = 0;
  for (const e of entities) {
    if (handled >= 5) break;
    if (world.dist2(player.x, player.y, e.x, e.y) > NEARBY_RADIUS2) continue;
    const room = world.roomAt(e.x, e.y);
    if (!room || !roomActive(room)) continue;

    if (e.type === EntityType.PROJECTILE && e.alive && e.projType === ProjType.FLAME) {
      burnRoom(world, entities, nextId, player, state, room);
      handled++;
      continue;
    }

    if (e.type === EntityType.ITEM_DROP && e.alive) {
      const bait = baitItemId(e);
      if (!bait) continue;
      e.alive = false;
      feedRoom(world, entities, nextId, player, state, room, 'bait', bait);
      handled++;
      continue;
    }

    if ((e.type === EntityType.MONSTER || e.type === EntityType.NPC) && !e.alive && !fedCorpseIds.has(e.id)) {
      fedCorpseIds.add(e.id);
      feedRoom(world, entities, nextId, player, state, room, e.type === EntityType.NPC ? 'npc_corpse' : 'monster_corpse');
      handled++;
    }
  }
}

export function updateCarnivorousFungus(
  world: World,
  entities: Entity[],
  player: Entity,
  state: GameState,
  dt: number,
  nextId: { v: number },
): void {
  if (!player.alive) return;
  resetForWorld(world);

  hazardAccum += dt;
  if (hazardAccum >= 0.55) {
    hazardAccum = 0;
    updatePlayerHazard(world, player, state);
  }

  scanAccum += dt;
  if (scanAccum >= 0.35) {
    scanAccum = 0;
    updateNearbyFeeds(world, entities, nextId, player, state);
  }
}

export function summarizeCarnivorousFungus(world: World, limit = 8): string[] {
  const rooms = world.rooms.filter(isCarnivorousFungusRoom);
  if (rooms.length === 0) return ['[FUNGUS] плотоядные комнаты не найдены'];

  let active = 0;
  let neutralized = 0;
  let burned = 0;
  let fed = 0;
  for (const room of rooms) {
    if (roomHas(room, TAG_BURNED)) burned++;
    else if (roomHas(room, TAG_NEUTRALIZED)) neutralized++;
    else active++;
    if (roomHas(room, TAG_FED)) fed++;
  }

  const lines = [`[FUNGUS] rooms=${rooms.length} active=${active} neutralized=${neutralized} burned=${burned} fed=${fed}`];
  for (const room of rooms.slice(0, limit)) {
    const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    lines.push(`[FUNGUS] #${room.id} z${world.zoneMap[ci] + 1} ${room.name}`);
  }
  return lines;
}
