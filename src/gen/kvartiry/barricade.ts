/* ── Баррикадированный лестничный пролёт — four-route POI ───── */

import {
  AIGoal, Cell, DoorState, EntityType, Feature, FloorLevel, Faction, MonsterKind, Occupation, QuestType, RoomType, Tex,
} from '../../core/types';
import { World } from '../../core/world';
import { type Entity } from '../../core/types';
import { type PlotNpcDef, registerSideQuest } from '../../data/plot';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerRouteCue } from '../../systems/route_cues';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { carveCorridor } from '../shared';
import {
  createSocialPoiRoom,
  placeDropNear,
  registerKvSocialMapCue,
  setFeatureIfFloor,
  spawnAmbientNpc,
  spawnSocialNpc,
  type SocialPoiRoom,
} from './social_helpers';

const ROOM_NAME = 'Баррикадированный пролёт';
const REPAIR_QUEST_ID = 'kv_barricade_tools';
const BRIBE_QUEST_ID = 'kv_barricade_bribe_pass';
const FIGHT_QUEST_ID = 'kv_barricade_fight_clear';
const RAYA_ID = 'kv_raya_prohodnaya';
const LYUBA_ID = 'kv_lyuba_taburet';
const ROUTE_CUE_ID = 'kv_barricade_four_routes';
const GATE_KEY_ID = 'key';

const KARPOV: PlotNpcDef = {
  name: 'Карпов Баррикадный',
  isFemale: false,
  faction: Faction.CITIZEN,
  occupation: Occupation.MECHANIC,
  sprite: Occupation.MECHANIC,
  hp: 120, maxHp: 120, money: 22, speed: 0.9,
  inventory: [{ defId: 'wrench', count: 1 }, { defId: 'pipe', count: 1 }, { defId: 'bread', count: 1 }],
  talkLines: [
    'Проход оставил. Узкий, злой, но проход. Баррикада без прохода — это могила.',
    'Дикие давят снизу, ликвидаторы сверху. Мы тут между приказом и голодом.',
    'Нужны трубы. Три трубы — и створка перестанет жрать плечи.',
    'Не ставь шкаф вплотную к двери. Когда туман придёт, шкаф первым попросит выйти.',
    'Если кто скажет, что это незаконно, пусть сам держит пролёт голыми руками.',
  ],
  talkLinesPost: [
    'Железо подошло. Теперь пролёт хотя бы скрипит уверенно.',
    'Проход не расширяй. Широкие проходы любят чужие сапоги.',
  ],
};

const RAYA: PlotNpcDef = {
  name: 'Рая Проходная',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.STOREKEEPER,
  sprite: Occupation.STOREKEEPER,
  hp: 85, maxHp: 85, money: 42, speed: 0.9,
  inventory: [{ defId: 'key', count: 1 }, { defId: 'cigs', count: 2 }, { defId: 'bread', count: 1 }],
  talkLines: [
    'Узкая створка не бесплатная. Бесплатно только нижний обход, а там арматура шевелится.',
    'Тридцать пять рублей — и я вспоминаю, что вы тут живёте давно.',
    'Карпов чинит честно. Я открываю быстро. Драка открывает громко.',
    'Если денег нет, идите низом. Только не наступайте на проволоку, она тут нервная.',
  ],
  talkLinesPost: [
    'Платный проход узкий. Не задерживайтесь в створке, пока Карпов смотрит.',
    'Если кто спросит, ключ вы нашли под ковриком. Коврика здесь никогда не было.',
  ],
};

const LYUBA: PlotNpcDef = {
  name: 'Люба с табуретом',
  isFemale: true,
  faction: Faction.CITIZEN,
  occupation: Occupation.HOUSEWIFE,
  sprite: Occupation.HOUSEWIFE,
  hp: 95, maxHp: 95, money: 12, speed: 0.9,
  inventory: [{ defId: 'knife', count: 1 }, { defId: 'bandage', count: 1 }],
  talkLines: [
    'Нижний проход есть, но железки там делают вид, что они мебель.',
    'Разобьёте две арматуры — люди снова пойдут не по одному.',
    'Взятка тише, ремонт честнее, драка быстрее. Обход длиннее всех.',
  ],
  talkLinesPost: [
    'Арматура больше не дёргается. Табурет снова табурет, почти.',
    'Теперь дети идут низом только когда сами виноваты.',
  ],
};

registerSideQuest('kv_karpov_barricade', KARPOV, [{
  id: REPAIR_QUEST_ID,
  giverNpcId: 'kv_karpov_barricade',
  type: QuestType.FETCH,
  desc: 'Карпов Баррикадный: «Три трубы на распорки. Починим среднюю створку, и пролёт перестанет быть горлом.»',
  targetItem: 'pipe', targetCount: 3,
  rewardItem: 'door_kit', rewardCount: 1,
  extraRewards: [{ defId: GATE_KEY_ID, count: 1 }, { defId: 'wrench', count: 1 }, { defId: 'bandage', count: 2 }],
  relationDelta: 16, xpReward: 50, moneyReward: 30,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.CORRIDOR,
  targetHint: 'трубы лежат прямо в баррикадированном пролёте; ключ открывает короткую ремонтную створку',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Баррикадную створку укрепили трубами; короткий проход можно открыть ключом.',
  eventTags: ['kvartiry', 'barricade', 'repair', 'route_choice'],
  eventData: { routeChoice: 'repair', unlocks: 'repair_gate', samosborAftermath: 'rebuild_relocks_but_key_persists' },
}]);

registerSideQuest(RAYA_ID, RAYA, [{
  id: BRIBE_QUEST_ID,
  giverNpcId: RAYA_ID,
  type: QuestType.FETCH,
  desc: 'Рая Проходная: «Тридцать пять рублей — и платная створка сделает вид, что вы свой.»',
  targetItem: 'money', targetCount: 35,
  rewardItem: GATE_KEY_ID, rewardCount: 1,
  extraRewards: [{ defId: 'cigs', count: 1 }],
  relationDelta: 4, xpReward: 25, moneyReward: 0,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.CORRIDOR,
  targetHint: 'платная створка отмечена на карте рядом с Раей; взятка дешевле драки, но это услышат соседи',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Платный проход через баррикаду выкуплен у Раи Проходной.',
  eventTags: ['kvartiry', 'barricade', 'bribe', 'route_choice', 'money'],
  eventData: { routeChoice: 'bribe', price: 35, unlocks: 'bribe_gate', rumorIds: ['lead_kvartiry_barricade_bribe'] },
}]);

registerSideQuest(LYUBA_ID, LYUBA, [{
  id: FIGHT_QUEST_ID,
  giverNpcId: LYUBA_ID,
  type: QuestType.KILL,
  desc: 'Люба с табуретом: «В нижней щели две арматуры шевелятся. Разбейте их или идите в обход по одному.»',
  targetMonsterKind: MonsterKind.REBAR,
  killNeeded: 2,
  rewardItem: 'ammo_9mm', rewardCount: 8,
  extraRewards: [{ defId: 'bandage', count: 1 }, { defId: 'bread', count: 1 }],
  relationDelta: 8, xpReward: 55, moneyReward: 12,
  targetFloor: FloorLevel.KVARTIRY,
  targetRoomType: RoomType.CORRIDOR,
  targetHint: 'две арматуры стоят у боевой щели баррикады; их видно красными ромбами активного KILL задания',
  eventSeverity: 4,
  eventPrivacy: 'witnessed',
  eventTargetName: 'Нижнюю боевую щель баррикады расчистили от живой арматуры.',
  eventTags: ['kvartiry', 'barricade', 'fight', 'route_choice', 'monster'],
  eventData: { routeChoice: 'fight', clears: 'rebar_gap', rumorIds: ['lead_kvartiry_barricade_fight'] },
}]);

function setRoomFloor(world: World, poi: SocialPoiRoom, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.roomMap[ci] = poi.room.id;
  world.floorTex[ci] = poi.room.floorTex;
}

function setRoomWall(world: World, x: number, y: number): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = Tex.METAL;
  world.roomMap[ci] = -1;
}

function setLockedGate(world: World, poi: SocialPoiRoom, x: number, y: number): number {
  const ci = world.idx(x, y);
  world.cells[ci] = Cell.DOOR;
  world.wallTex[ci] = Tex.DOOR_METAL;
  world.roomMap[ci] = poi.room.id;
  world.doors.set(ci, {
    idx: ci,
    state: DoorState.LOCKED,
    roomA: poi.room.id,
    roomB: poi.room.id,
    keyId: GATE_KEY_ID,
    timer: 0,
  });
  if (!poi.room.doors.includes(ci)) poi.room.doors.push(ci);
  return ci;
}

function setMazeFloor(world: World, x: number, y: number, roomId = -1): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.aptMask[ci] = 0;
  world.roomMap[ci] = roomId;
  world.floorTex[ci] = Tex.F_CONCRETE;
  world.features[ci] = Feature.NONE;
}

function nearestMazeFloor(world: World, sx: number, sy: number, maxRadius: number): { x: number; y: number } | null {
  for (let r = 3; r <= maxRadius; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (const ox of [-r, r]) {
        const x = world.wrap(sx + ox);
        const y = world.wrap(sy + oy);
        const ci = world.idx(x, y);
        if (!world.aptMask[ci] && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR)) return { x, y };
      }
    }
    for (let ox = -r + 1; ox < r; ox++) {
      for (const oy of [-r, r]) {
        const x = world.wrap(sx + ox);
        const y = world.wrap(sy + oy);
        const ci = world.idx(x, y);
        if (!world.aptMask[ci] && (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.DOOR)) return { x, y };
      }
    }
  }
  return null;
}

function openSideConnector(world: World, poi: SocialPoiRoom, side: 'west' | 'east', y: number): { x: number; y: number } {
  const dir = side === 'west' ? -1 : 1;
  const edgeX = side === 'west' ? poi.x - 1 : poi.x + poi.w;
  const insideX = side === 'west' ? poi.x : poi.x + poi.w - 1;
  const outsideX = side === 'west' ? poi.x - 2 : poi.x + poi.w + 1;

  setRoomFloor(world, poi, insideX, y);
  setMazeFloor(world, edgeX, y, poi.room.id);
  setMazeFloor(world, outsideX, y);

  const path: { x: number; y: number }[] = [];
  for (let step = 1; step <= 44; step++) {
    const nextX = world.wrap(outsideX + dir * step);
    const ni = world.idx(nextX, y);
    if (!world.aptMask[ni] && (world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.DOOR)) {
      for (const p of path) setMazeFloor(world, p.x, p.y);
      setMazeFloor(world, nextX, y);
      return { x: insideX + 0.5, y: y + 0.5 };
    }
    path.push({ x: nextX, y });
  }

  const target = nearestMazeFloor(world, outsideX, y, 88);
  if (target) carveCorridor(world, outsideX, y, target.x, target.y);
  return { x: insideX + 0.5, y: y + 0.5 };
}

function zoneLevelAt(world: World, x: number, y: number): number {
  const zid = world.zoneMap[world.idx(x, y)];
  return (zid >= 0 && world.zones[zid]) ? (world.zones[zid].level ?? 2) : 2;
}

function spawnBarricadeMonster(
  world: World,
  entities: Entity[],
  nextId: { v: number },
  kind: MonsterKind,
  x: number,
  y: number,
  name: string,
): void {
  const def = MONSTERS[kind];
  const level = zoneLevelAt(world, x, y);
  const hp = Math.max(25, Math.round(scaleMonsterHp(def.hp, level) * 0.75));
  entities.push({
    id: nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.random() * Math.PI * 2,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level) * 0.85,
    sprite: monsterSpr(kind),
    name,
    hp,
    maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x + 0.5, ty: y + 0.5, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
  });
}

export function generateBarricade(
  world: World, nextRoomId: number, entities: Entity[], nextId: { v: number }, spawnX: number, spawnY: number,
): number {
  const poi = createSocialPoiRoom(world, nextRoomId, spawnX, spawnY, ROOM_NAME, RoomType.CORRIDOR, 25, 15, Tex.METAL, Tex.F_CONCRETE, 55, 180, 1.9);
  if (!poi) return nextRoomId;

  const midY = poi.y + Math.floor(poi.h / 2);
  const westEntry = openSideConnector(world, poi, 'west', midY);
  const eastExit = openSideConnector(world, poi, 'east', midY);
  const gateX = poi.x + Math.floor(poi.w / 2);
  const repairY = poi.y + 2;
  const bribeY = poi.y + 5;
  const fightY = poi.y + 8;
  const detourY = poi.y + poi.h - 2;

  for (let y = poi.y + 1; y < poi.y + poi.h - 1; y++) {
    if (y === repairY || y === bribeY || y === fightY || y === detourY) continue;
    setRoomWall(world, gateX, y);
  }
  const repairDoor = setLockedGate(world, poi, gateX, repairY);
  const bribeDoor = setLockedGate(world, poi, gateX, bribeY);
  setRoomFloor(world, poi, gateX, fightY);
  setRoomFloor(world, poi, gateX, detourY);

  for (let x = poi.x + 2; x < gateX - 1; x++) {
    if (x !== poi.x + 3) setRoomWall(world, x, detourY - 2);
  }
  for (let x = gateX + 2; x < poi.x + poi.w - 2; x++) {
    if (x !== poi.x + poi.w - 4) setRoomWall(world, x, detourY - 1);
  }

  setFeatureIfFloor(world, gateX - 2, repairY, Feature.MACHINE);
  setFeatureIfFloor(world, gateX - 2, bribeY, Feature.DESK);
  setFeatureIfFloor(world, gateX - 2, fightY, Feature.LAMP);
  setFeatureIfFloor(world, gateX - 2, detourY, Feature.SCREEN);
  setFeatureIfFloor(world, gateX + 2, detourY, Feature.CHAIR);
  setFeatureIfFloor(world, gateX + 4, fightY, Feature.TABLE);
  setFeatureIfFloor(world, poi.x + 1, poi.y + 1, Feature.LAMP);

  spawnSocialNpc(entities, nextId, KARPOV, 'kv_karpov_barricade', poi.x + 3, poi.y + 2, { weapon: 'wrench' });
  spawnSocialNpc(entities, nextId, RAYA, RAYA_ID, gateX - 4, bribeY, { weapon: 'knife' });
  spawnSocialNpc(entities, nextId, LYUBA, LYUBA_ID, poi.x + 5, detourY - 1, { weapon: 'knife' });
  spawnAmbientNpc(entities, nextId, 'Пацан на стрёме', Faction.WILD, Occupation.TRAVELER, gateX + 5, fightY, [{ defId: 'pipe', count: 1 }], 'pipe');
  spawnBarricadeMonster(world, entities, nextId, MonsterKind.REBAR, gateX + 2, fightY, 'Арматура баррикады');
  spawnBarricadeMonster(world, entities, nextId, MonsterKind.REBAR, gateX + 4, fightY + 1, 'Арматура нижней щели');
  spawnBarricadeMonster(world, entities, nextId, MonsterKind.SBORKA, gateX + 3, detourY - 2, 'Сборка у нижнего обхода');

  for (const defId of ['pipe', 'pipe', 'pipe', 'wrench', 'bandage', 'bread', 'note', 'cigs']) {
    placeDropNear(world, entities, nextId, poi, defId, 1);
  }

  const targetX = eastExit.x;
  const targetY = eastExit.y;
  registerKvSocialMapCue(world, {
    id: 'kv_barricade_repair_gate',
    kind: 'repair',
    x: gateX + 0.5,
    y: repairY + 0.5,
    targetX,
    targetY,
    label: 'ремонтная створка',
    shortLabel: 'РЕМ',
    color: '#6cf',
    doorIdx: repairDoor,
  });
  registerKvSocialMapCue(world, {
    id: 'kv_barricade_bribe_gate',
    kind: 'bribe',
    x: gateX + 0.5,
    y: bribeY + 0.5,
    targetX,
    targetY,
    label: 'платная створка',
    shortLabel: '₽',
    color: '#fc6',
    doorIdx: bribeDoor,
  });
  registerKvSocialMapCue(world, {
    id: 'kv_barricade_fight_gap',
    kind: 'fight',
    x: gateX + 0.5,
    y: fightY + 0.5,
    targetX,
    targetY,
    label: 'боевая щель',
    shortLabel: 'БОЙ',
    color: '#f66',
  });
  registerKvSocialMapCue(world, {
    id: 'kv_barricade_detour_gap',
    kind: 'detour',
    x: gateX + 0.5,
    y: detourY + 0.5,
    targetX,
    targetY,
    label: 'нижний обход',
    shortLabel: 'ОБХ',
    color: '#9cf',
  });

  const markerCell = world.idx(Math.floor(westEntry.x), Math.floor(westEntry.y));
  registerRouteCue(world, {
    id: ROUTE_CUE_ID,
    x: westEntry.x,
    y: westEntry.y,
    targetX,
    targetY,
    floor: FloorLevel.KVARTIRY,
    roomId: poi.room.id,
    targetRoomId: poi.room.id,
    zoneId: world.zoneMap[markerCell],
    label: 'баррикадный пролёт',
    hint: 'ремонт, взятка, бой или нижний обход',
    targetName: 'дальний край баррикады',
    color: '#fc6',
    tags: ['kvartiry', 'barricade', 'route_choice', 'detour'],
    toneSeed: poi.room.id * 991 + 7070,
    radius: 11,
    targetRadius: 2.8,
    cooldownSec: 30,
    heardText: 'Баррикада режет пролёт на четыре хода: чинить, платить, драться или идти низом.',
    followedText: 'Вы прошли баррикаду. За спиной остался выбор, который соседи запомнят.',
    ignoredText: 'Баррикада осталась в стороне. Нижний скрип затихает за стеной.',
  });

  return poi.room.id + 1;
}
