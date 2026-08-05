/* ── Heatline Zero inspection helpers ───────────────────────────
 * Static hazard rooms only: no pressure tick, no cell heat field.
 */

import { stampSurfaceSplat } from './surface_marks';
import {
  Cell,
  Feature,
  FloorLevel,
  RoomType,
  type Entity,
  type GameState,
  type Room,
  msg,
} from '../core/types';
import { World } from '../core/world';
import { addItem, hasItem, removeItem } from './inventory';
import { publishEvent } from './events';
import { isPlayerEntity } from './player_actor';

const HEATLINE_PREFIX = 'Теплотрасса Ноль';
const HEATLINE_RESOLVED = 'сброс открыт';
const HEATLINE_PARTIAL_CORD = 'частичный шнур';
const HEATLINE_PARTIAL_SEALANT = 'частичный герметик';
const HEATLINE_VENTED = 'аварийный выброс';

type HeatlineOutcome = 'full_repair' | 'partial_repair' | 'shortcut' | 'vent_failure' | 'blocked';
type HeatlinePart = 'cord' | 'sealant';

let nextPressureUseAt = 0;
let pressureCooldownState: GameState | null = null;

function isHeatlineRoom(room: Room): boolean {
  return room.name.includes(HEATLINE_PREFIX);
}

function heatTag(room: Room): string {
  if (room.name.includes('ремонт')) return 'repair';
  if (room.name.includes('обход')) return 'safe';
  if (room.name.includes('обваренный') || room.name.includes('короткий ход')) return 'hazard';
  if (room.name.includes('вентиль') || room.name.includes('сброс') || room.name.includes('частичный')) return 'valve';
  return 'static';
}

function roomTypeName(type: RoomType): string {
  switch (type) {
    case RoomType.BATHROOM: return 'bath';
    case RoomType.CORRIDOR: return 'corridor';
    case RoomType.PRODUCTION: return 'prod';
    case RoomType.STORAGE: return 'store';
    default: return `type${type}`;
  }
}

function heatlineRooms(world: World): Room[] {
  return world.rooms.filter(r => r && isHeatlineRoom(r));
}

function heatlineResolved(world: World): boolean {
  return heatlineRooms(world).some(room => room.name.includes(HEATLINE_RESOLVED));
}

function heatlinePartialPart(world: World): HeatlinePart | null {
  if (heatlineRooms(world).some(room => room.name.includes(HEATLINE_PARTIAL_CORD))) return 'cord';
  if (heatlineRooms(world).some(room => room.name.includes(HEATLINE_PARTIAL_SEALANT))) return 'sealant';
  return null;
}

function heatlineVented(world: World): boolean {
  return heatlineRooms(world).some(room => room.name.includes(HEATLINE_VENTED));
}

function findHeatlineRoom(world: World, tag: string): Room | undefined {
  return heatlineRooms(world).find(room => heatTag(room) === tag);
}

function isPressureTarget(feature: Feature): boolean {
  return feature === Feature.MACHINE || feature === Feature.APPARATUS || feature === Feature.LAMP;
}

function pressureTargetRoom(world: World, lookX: number, lookY: number): Room | null {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (!isPressureTarget(world.features[ci] as Feature)) return null;

  const roomId = world.roomMap[ci];
  if (roomId < 0) return null;
  const room = world.rooms[roomId];
  if (!room || !isHeatlineRoom(room)) return null;

  const tag = heatTag(room);
  return tag === 'valve' || tag === 'repair' || tag === 'hazard' ? room : null;
}

function pressureCooldownReady(state: GameState): boolean {
  if (pressureCooldownState !== state || nextPressureUseAt > state.time + 10) {
    pressureCooldownState = state;
    nextPressureUseAt = 0;
  }
  return state.time >= nextPressureUseAt;
}

function forRoomCells(world: World, room: Room, fn: (ci: number, x: number, y: number) => void): void {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      fn(world.idx(x, y), x, y);
    }
  }
}

function setRoomFog(world: World, room: Room, density: number, mode: 'set' | 'max' | 'min'): void {
  forRoomCells(world, room, ci => {
    const cell = world.cells[ci];
    if (cell === Cell.WALL || cell === Cell.LIFT) return;
    if (mode === 'set') world.fog[ci] = density;
    else if (mode === 'max') world.fog[ci] = Math.max(world.fog[ci], density);
    else world.fog[ci] = Math.min(world.fog[ci], density);
  });
}

function stampSteamResidue(world: World, room: Room, seedBase: number, hot: boolean): void {
  const y = room.y + Math.floor(room.h / 2);
  for (let dx = 2; dx < room.w - 2; dx += 4) {
    stampSurfaceSplat(world,
      room.x + dx, y,
      0.5, 0.5, hot ? 0.36 : 0.24,
      hot ? 130 : 80,
      seedBase + room.id * 31 + dx,
      hot ? 120 : 55,
      hot ? 45 : 105,
      hot ? 12 : 110,
    );
  }
}

function damagePlayer(player: Entity, amount: number): void {
  if (player.hp === undefined) return;
  player.hp = Math.max(1, player.hp - amount);
}

function publishHeatlineEvent(
  world: World,
  player: Entity,
  state: GameState,
  room: Room,
  outcome: HeatlineOutcome,
  severity: 2 | 3 | 4,
  itemId: string,
  itemName: string,
  data: Record<string, unknown>,
): void {
  const px = Math.floor(player.x);
  const py = Math.floor(player.y);
  const ci = world.idx(px, py);
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: world.zoneMap[ci],
    roomId: room.id,
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId,
    itemName,
    severity,
    privacy: isPlayerEntity(player) ? 'local' : 'private',
    tags: ['player', 'maintenance', 'heatline', 'pressure', outcome],
    data: {
      system: 'heatline_zero',
      outcome,
      roomName: room.name,
      rumorIds: ['maint_heatline_manual_reroute'],
      ...data,
    },
  });
}

function consumeHeatlineParts(player: Entity, needCord: boolean, needSealant: boolean): string[] {
  const consumed: string[] = [];
  if (needCord && removeItem(player, 'asbestos_cord', 1)) consumed.push('asbestos_cord');
  if (needSealant && removeItem(player, 'sealant_tube', 1)) consumed.push('sealant_tube');
  return consumed;
}

function consumeFailedPart(player: Entity, hasCord: boolean, hasSealant: boolean): string[] {
  if (hasSealant && removeItem(player, 'sealant_tube', 1)) return ['sealant_tube'];
  if (hasCord && removeItem(player, 'asbestos_cord', 1)) return ['asbestos_cord'];
  return [];
}

function eventItem(consumed: readonly string[], fallback: string): { id: string; name: string } {
  const id = consumed[0] ?? fallback;
  switch (id) {
    case 'asbestos_cord': return { id, name: 'Асбестовая верёвка' };
    case 'sealant_tube': return { id, name: 'Герметик' };
    case 'valve_tag': return { id, name: 'Бирка вентиля' };
    default: return { id: 'manometer', name: 'Манометр' };
  }
}

function applyPressureResolution(world: World, clean: boolean, recoveredFrom: HeatlinePart | 'vented' | null): void {
  const valve = findHeatlineRoom(world, 'valve');
  const hazard = findHeatlineRoom(world, 'hazard');
  const safe = findHeatlineRoom(world, 'safe');
  const repair = findHeatlineRoom(world, 'repair');
  const hazardId = hazard?.id ?? -1;

  if (valve) valve.name = clean
    ? `Теплотрасса Ноль: ручной сброс открыт давление 0${recoveredFrom ? ' после доводки' : ''}`
    : 'Теплотрасса Ноль: ручной сброс открыт без стрелки';
  if (hazard) hazard.name = clean
    ? 'Теплотрасса Ноль: остывший короткий ход жар 0 давление 0'
    : 'Теплотрасса Ноль: слепой короткий ход пар 1 давление 0';
  if (safe) safe.name = clean
    ? 'Теплотрасса Ноль: душевой обход резерв'
    : 'Теплотрасса Ноль: душевой обход мокрый резерв';
  if (repair) repair.name = clean
    ? 'Теплотрасса Ноль: ремонтный ящик опечатан после сброса'
    : 'Теплотрасса Ноль: ремонтный ящик пуст после слепого сброса';

  for (const room of heatlineRooms(world)) {
    const isHazard = room.id === hazardId;
    if (clean || !isHazard) setRoomFog(world, room, 0, 'set');
    else setRoomFog(world, room, 75, 'min');
    stampSteamResidue(world, room, clean ? 6100 : 7200, !clean && isHazard);
  }
  world.markFogDirty();
}

function applyPartialRepair(world: World, part: HeatlinePart): void {
  const valve = findHeatlineRoom(world, 'valve');
  const hazard = findHeatlineRoom(world, 'hazard');
  const safe = findHeatlineRoom(world, 'safe');
  const repair = findHeatlineRoom(world, 'repair');

  if (valve) valve.name = `Теплотрасса Ноль: ${part === 'cord' ? HEATLINE_PARTIAL_CORD : HEATLINE_PARTIAL_SEALANT} давление 1`;
  if (hazard) hazard.name = 'Теплотрасса Ноль: приглушенный короткий ход жар 1 давление 1';
  if (safe) safe.name = 'Теплотрасса Ноль: душевой обход основной жар 0';
  if (repair) repair.name = `Теплотрасса Ноль: ремонтный ящик ждет ${part === 'cord' ? 'герметик' : 'асбестовый шнур'}`;

  for (const room of heatlineRooms(world)) {
    const tag = heatTag(room);
    if (tag === 'hazard') setRoomFog(world, room, 68, 'min');
    else if (tag === 'safe') setRoomFog(world, room, 0, 'set');
    else setRoomFog(world, room, 18, 'min');
    stampSteamResidue(world, room, part === 'cord' ? 6400 : 6500, tag === 'hazard');
  }
  world.markFogDirty();
}

function applyPressureFailure(world: World): void {
  const valve = findHeatlineRoom(world, 'valve');
  const hazard = findHeatlineRoom(world, 'hazard');
  const repair = findHeatlineRoom(world, 'repair');

  if (valve) valve.name = `Теплотрасса Ноль: вентильная ${HEATLINE_VENTED} давление 3`;
  if (hazard) hazard.name = `Теплотрасса Ноль: обваренный коридор ${HEATLINE_VENTED} пар 3`;
  if (repair) repair.name = `Теплотрасса Ноль: ремонтный ящик мокрый после ${HEATLINE_VENTED}`;

  for (const room of heatlineRooms(world)) {
    const tag = heatTag(room);
    if (tag === 'safe') continue;
    setRoomFog(world, room, tag === 'hazard' ? 155 : 95, 'max');
    stampSteamResidue(world, room, 8300, true);
  }
  world.markFogDirty();
}

export function tryUseHeatlinePressure(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const room = pressureTargetRoom(world, lookX, lookY);
  if (!room) return false;

  if (state.currentFloor !== FloorLevel.MAINTENANCE) return false;
  if (!pressureCooldownReady(state)) {
    state.msgs.push(msg('Вентиль еще стучит после прошлого поворота.', state.time, '#888'));
    return true;
  }
  nextPressureUseAt = state.time + 1.2;

  const hasCord = hasItem(player, 'asbestos_cord');
  const hasSealant = hasItem(player, 'sealant_tube');
  const hasGauge = hasItem(player, 'manometer');
  const partialPart = heatlinePartialPart(world);
  const needCord = partialPart !== 'cord';
  const needSealant = partialPart !== 'sealant';
  const hasInstalledCord = !needCord || hasCord;
  const hasInstalledSealant = !needSealant || hasSealant;

  if (heatlineResolved(world)) {
    state.msgs.push(msg('Теплотрасса уже сброшена. Короткий ход условно безопасен.', state.time, '#8cf'));
    publishHeatlineEvent(world, player, state, room, 'blocked', 2, 'valve_tag', 'Бирка вентиля', { reason: 'already_resolved' });
    return true;
  }

  if (heatlineVented(world) && !(hasGauge && hasInstalledCord && hasInstalledSealant) && !(hasInstalledCord && hasInstalledSealant)) {
    state.msgs.push(msg('Пар уже сорвал вентиль. Без полного комплекта повторять нечего: только слушать, как сохнет ожог.', state.time, '#888'));
    publishHeatlineEvent(world, player, state, room, 'blocked', 2, 'manometer', 'Манометр', {
      reason: 'already_vented',
      missing: [
        ...(hasInstalledCord ? [] : ['asbestos_cord']),
        ...(hasInstalledSealant ? [] : ['sealant_tube']),
        ...(hasGauge ? [] : ['manometer']),
      ],
    });
    nextPressureUseAt = state.time + 1.5;
    return true;
  }

  if (hasInstalledCord && hasInstalledSealant && hasGauge) {
    const wasVented = heatlineVented(world);
    const consumed = consumeHeatlineParts(player, needCord, needSealant);
    const item = eventItem(consumed, 'manometer');
    applyPressureResolution(world, true, partialPart ?? (wasVented ? 'vented' : null));
    addItem(player, 'valve_tag', 1);
    addItem(player, 'filtered_water', 1);
    state.msgs.push(msg('Манометр дрогнул и успокоился. Давление сброшено, короткий ход остыл.', state.time, '#6cf'));
    publishHeatlineEvent(world, player, state, room, 'full_repair', 4, item.id, item.name, {
      consumed,
      checkedWith: 'manometer',
      installedFromPartial: partialPart,
      recoveredFromVented: wasVented,
      reward: ['valve_tag', 'filtered_water'],
    });
    nextPressureUseAt = state.time + 2.5;
    return true;
  }

  if (hasInstalledCord && hasInstalledSealant) {
    const wasVented = heatlineVented(world);
    const consumed = consumeHeatlineParts(player, needCord, needSealant);
    const item = eventItem(consumed, 'manometer');
    applyPressureResolution(world, false, partialPart ?? (wasVented ? 'vented' : null));
    damagePlayer(player, 10);
    addItem(player, 'valve_tag', 1);
    state.msgs.push(msg('Слепой сброс сработал. Пар ушел в соседей, коридор открыт, кожа спорит.', state.time, '#fa4'));
    publishHeatlineEvent(world, player, state, room, 'shortcut', 4, item.id, item.name, {
      consumed,
      missing: 'manometer',
      installedFromPartial: partialPart,
      recoveredFromVented: wasVented,
      damage: 10,
      reward: ['valve_tag'],
    });
    nextPressureUseAt = state.time + 3.5;
    return true;
  }

  if (!partialPart && hasGauge && (hasCord || hasSealant)) {
    const part: HeatlinePart = hasCord ? 'cord' : 'sealant';
    const consumed = consumeHeatlineParts(player, part === 'cord', part === 'sealant');
    applyPartialRepair(world, part);
    addItem(player, 'metal_water', 1);
    state.msgs.push(msg(
      part === 'cord'
        ? 'Шнур лег на вентиль. Давление стало терпимым, но без герметика короткий ход не открыт.'
        : 'Герметик схватил шов. Давление стало терпимым, но без шнура короткий ход не открыт.',
      state.time,
      '#8cf',
    ));
    publishHeatlineEvent(world, player, state, room, 'partial_repair', 3, part === 'cord' ? 'asbestos_cord' : 'sealant_tube', part === 'cord' ? 'Асбестовая верёвка' : 'Герметик', {
      consumed,
      installed: part === 'cord' ? 'asbestos_cord' : 'sealant_tube',
      missing: part === 'cord' ? 'sealant_tube' : 'asbestos_cord',
      checkedWith: 'manometer',
      reward: ['metal_water'],
    });
    nextPressureUseAt = state.time + 2.2;
    return true;
  }

  if (partialPart) {
    state.msgs.push(msg(
      partialPart === 'cord'
        ? 'Частичный шнур уже держит. Нужен герметик; без него вентиль только злится.'
        : 'Частичный герметик уже держит. Нужен асбестовый шнур; без него вентиль только злится.',
      state.time,
      '#888',
    ));
    publishHeatlineEvent(world, player, state, room, 'blocked', 2, partialPart === 'cord' ? 'asbestos_cord' : 'sealant_tube', partialPart === 'cord' ? 'Асбестовая верёвка' : 'Герметик', {
      reason: 'partial_waiting_missing_part',
      installed: partialPart === 'cord' ? 'asbestos_cord' : 'sealant_tube',
      missing: partialPart === 'cord' ? 'sealant_tube' : 'asbestos_cord',
    });
    nextPressureUseAt = state.time + 1.5;
    return true;
  }

  const consumed = consumeFailedPart(player, hasCord, hasSealant);
  const item = eventItem(consumed, 'manometer');
  applyPressureFailure(world);
  damagePlayer(player, 16);
  state.msgs.push(msg('Вентиль сорвался паром. Нужны асбестовый шнур и герметик; манометр спасет кожу.', state.time, '#f84'));
  publishHeatlineEvent(world, player, state, room, 'vent_failure', 3, item.id, item.name, {
    consumed,
    missing: [
      ...(hasCord ? [] : ['asbestos_cord']),
      ...(hasSealant ? [] : ['sealant_tube']),
      ...(hasGauge ? [] : ['manometer']),
    ],
    damage: 16,
  });
  nextPressureUseAt = state.time + 5;
  return true;
}

export function summarizeHeatline(world: World, limit = 8): string[] {
  const rooms = heatlineRooms(world);
  if (rooms.length === 0) return ['[HEATLINE] узлы не найдены на этом этаже'];

  let hazard = 0;
  let safe = 0;
  let repair = 0;
  const zones = new Set<number>();
  for (const room of rooms) {
    const tag = heatTag(room);
    if (tag === 'hazard') hazard++;
    if (tag === 'safe') safe++;
    if (tag === 'repair') repair++;
    const ci = world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    zones.add(world.zoneMap[ci]);
  }

  const partialPart = heatlinePartialPart(world);
  const lines = [
    `[HEATLINE] rooms=${rooms.length} hazard=${hazard} safe=${safe} repair=${repair} resolved=${heatlineResolved(world) ? 1 : 0} partial=${partialPart ?? '-'} vented=${heatlineVented(world) ? 1 : 0} zones=${[...zones].map(z => z + 1).join(',')}`,
  ];
  for (const room of rooms.slice(0, limit)) {
    lines.push(`[HEATLINE] #${room.id} ${heatTag(room)} ${roomTypeName(room.type)} ${room.name}`);
  }
  return lines;
}
