import {
  Cell,
  ContainerKind,
  EntityType,
  Faction,
  FloorLevel,
  type GameState,
  type Entity,
  type Item,
  type LogEntry,
  type Msg,
  type Room,
  RoomType,
  Tex,
  type WorldContainer,
  ZoneFaction,
} from '../src/core/types';
import type { World } from '../src/core/world';
import { createCraftingState } from '../src/systems/crafting';

export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const clock = overrides.clock ?? { hour: 8, minute: 0, totalMinutes: 0 };
  return {
    tick: 0,
    time: 0,
    clock,
    samosborActive: false,
    samosborTimer: 120,
    samosborCount: 0,
    paused: false,
    gameOver: false,
    showInventory: false,
    mapMode: 0,
    fullMapRadius: 200,
    showQuests: false,
    invSel: 0,
    msgs: [] as Msg[],
    quests: [],
    activeQuestId: undefined,
    nextQuestId: 1,
    currentFloor: FloorLevel.LIVING,
    fogSpreadTimer: 0,
    showMenu: false,
    menuSel: 0,
    showNpcMenu: false,
    npcMenuSel: 0,
    npcMenuTarget: -1,
    npcMenuTab: 'main',
    npcTalkText: '',
    questPage: 0,
    tradeCursorX: 0,
    tradeCursorY: 0,
    tradeSide: 'npc',
    showContainerMenu: false,
    containerMenuTarget: -1,
    containerCursorX: 0,
    containerCursorY: 0,
    containerSide: 'container',
    showCraftMenu: false,
    craftMode: 'craft',
    craftCursor: 0,
    craftFilter: '',
    craftStationKind: 'lathe',
    showDebug: false,
    debugSel: 0,
    showFactions: false,
    factionRankScroll: 0,
    showDemos: false,
    demosCursor: 0,
    demosSearch: '',
    demosSearchActive: false,
    showLog: false,
    logScroll: 0,
    showHelp: false,
    showControls: false,
    controlView: 'keys',
    controlSel: 0,
    controlScroll: 0,
    showUiSettings: false,
    uiSettingsView: 'interface',
    uiSettingsSel: 0,
    uiSettingsScroll: 0,
    showMapLegend: false,
    mapLegendSel: 0,
    mapLegendScroll: 0,
    npcLogRadiusMeters: 100,
    msgLog: [] as LogEntry[],
    dmgFlash: 0,
    dmgSeed: 0,
    deathTimer: 0,
    sleeping: false,
    beamFx: 0,
    beamAngle: 0,
    beamLen: 0,
    uvBeamFx: 0,
    uvBeamLen: 0,
    gameWon: false,
    crafting: createCraftingState(),
    ...overrides,
  };
}

export function makeTestEntity(overrides: Partial<Entity> = {}): Entity {
  const type = overrides.type ?? EntityType.NPC;
  const faction = overrides.faction ?? Faction.PLAYER;
  const persistentNpcId = overrides.persistentNpcId
    ?? (type === EntityType.NPC && faction === Faction.PLAYER ? 'player' : undefined);
  return {
    id: 1,
    type,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    name: 'Вы',
    faction,
    inventory: [],
    ...overrides,
    persistentNpcId,
  };
}

export function makeTestPlayer(overrides: Partial<Entity> = {}): Entity {
  return makeTestEntity({
    ...overrides,
    type: EntityType.NPC,
    name: overrides.name ?? 'Вы',
    faction: overrides.faction ?? Faction.PLAYER,
    inventory: overrides.inventory ?? [],
    persistentNpcId: overrides.persistentNpcId ?? 'player',
  });
}

export function makeTestNpc(overrides: Partial<Entity> = {}): Entity {
  return makeTestEntity({
    ...overrides,
    type: EntityType.NPC,
    name: overrides.name ?? 'Тестовый NPC',
    faction: overrides.faction ?? Faction.CITIZEN,
    inventory: overrides.inventory ?? [],
    money: overrides.money ?? 100,
    persistentNpcId: overrides.persistentNpcId,
  });
}

export function countInventoryItem(actor: Pick<Entity, 'inventory'>, defId: string): number {
  return (actor.inventory ?? []).reduce((sum, item) => item.defId === defId ? sum + item.count : sum, 0);
}

export function cloneItems(items: readonly Item[]): Item[] {
  return items.map(item => ({ ...item }));
}

export function makeTestContainer(overrides: Partial<WorldContainer> = {}): WorldContainer {
  return {
    id: 1,
    x: 0,
    y: 0,
    floor: FloorLevel.LIVING,
    roomId: 1,
    zoneId: 1,
    kind: ContainerKind.EMERGENCY_BOX,
    name: 'Тестовый ящик',
    inventory: [],
    capacitySlots: 1,
    access: 'public',
    discovered: true,
    tags: [],
    ...overrides,
  };
}

interface TestRoomOptions extends Partial<Omit<Room, 'doors'>> {
  doors?: number[];
  zoneId?: number;
  zoneFaction?: ZoneFaction;
  zoneLevel?: number;
  hqRoomId?: number;
  carve?: boolean;
}

export function addTestRoom(world: World, options: TestRoomOptions = {}): Room {
  const room: Room = {
    id: options.id ?? 0,
    type: options.type ?? RoomType.COMMON,
    x: options.x ?? 10,
    y: options.y ?? 10,
    w: options.w ?? 6,
    h: options.h ?? 6,
    doors: options.doors ?? [],
    sealed: options.sealed ?? false,
    name: options.name ?? 'Тестовая комната',
    apartmentId: options.apartmentId ?? -1,
    wallTex: options.wallTex ?? Tex.CONCRETE,
    floorTex: options.floorTex ?? Tex.F_CONCRETE,
  };
  const zoneId = options.zoneId ?? 0;
  world.rooms[room.id] = room;
  world.zones[zoneId] = {
    id: zoneId,
    cx: (room.x + room.w / 2) | 0,
    cy: (room.y + room.h / 2) | 0,
    faction: options.zoneFaction ?? ZoneFaction.CITIZEN,
    hasLift: false,
    fogged: false,
    level: options.zoneLevel ?? 1,
    hqRoomId: options.hqRoomId ?? -1,
  };
  const faction = options.zoneFaction ?? ZoneFaction.CITIZEN;

  if (options.carve === false) return room;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const idx = world.idx(x, y);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = room.id;
      world.zoneMap[idx] = zoneId;
      world.factionControl[idx] = faction;
    }
  }
  return room;
}
