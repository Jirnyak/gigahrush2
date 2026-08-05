import {
  Cell,
  ContainerKind,
  Feature,
  Tex,
  type WorldEventSeverity,
  type WorldEventType,
} from '../core/types';

export type InteractiveSurfaceLayer = 'block' | 'feature' | 'container' | 'billboard';

export type InteractiveCraftMenuMode = 'craft' | 'disassemble';
export type InteractiveCraftStationKind = 'lathe' | 'workbench' | 'lab' | 'net_terminal';

export const INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE = 1 << 1;
export const INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH = 1 << 2;
export const INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH = 1 << 3;
export const INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD = 1 << 4;

export type InteractiveActionKind =
  | 'drink_water'
  | 'relieve'
  | 'repair_pending'
  | 'message'
  | 'open_container'
  | 'open_craft_menu'
  | 'open_disassembly_menu'
  | 'learn_recipe';

export type InteractiveVisualDef =
  | { kind: 'feature'; feature: Feature }
  | { kind: 'container'; containerKind?: ContainerKind }
  | { kind: 'cell'; cell: Cell; wallTex?: Tex; floorTex?: Tex }
  | { kind: 'billboard'; sprite: number; scale?: number; z?: number };

export interface InteractiveTargetDef {
  range: number;
  priority: number;
}

export interface InteractiveActionDef {
  id: string;
  label: string;
  kind: InteractiveActionKind;
  craftMode?: InteractiveCraftMenuMode;
  craftStation?: InteractiveCraftStationKind;
  recipeId?: string;
  recipeSourceId?: string;
  cooldownSeconds?: number;
  waterDelta?: number;
  peeDelta?: number;
  pooDelta?: number;
  message?: string;
  color?: string;
  eventType?: WorldEventType;
  eventSeverity?: WorldEventSeverity;
}

export interface InteractiveDef {
  id: string;
  layer: InteractiveSurfaceLayer;
  label: string;
  prompt: string;
  tags: readonly string[];
  visual: InteractiveVisualDef;
  surfaceFlag?: number;
  target: InteractiveTargetDef;
  actions: readonly InteractiveActionDef[];
}

const registry = new Map<string, InteractiveDef>();

export function registerInteractiveDef(def: InteractiveDef): void {
  registry.set(def.id, def);
}

export function getInteractiveDef(defId: string): InteractiveDef | undefined {
  return registry.get(defId);
}

export function allInteractiveDefs(): InteractiveDef[] {
  return [...registry.values()];
}

const surfaceFlagDefIds: readonly { flag: number; defId: string }[] = [
  { flag: INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE, defId: 'craft_lathe' },
  { flag: INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH, defId: 'disassembly_workbench' },
  { flag: INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH, defId: 'craft_lab_bench' },
  { flag: INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD, defId: 'recipe_billboard' },
];

export function interactiveDefIdForSurfaceFlags(flags: number): string | undefined {
  for (const entry of surfaceFlagDefIds) {
    if ((flags & entry.flag) !== 0) return entry.defId;
  }
  return undefined;
}

export const INTERACTIVE_DEFS = [
  {
    id: 'sink_drink',
    layer: 'feature',
    label: 'Раковина',
    prompt: ' пить',
    tags: ['water', 'needs', 'sink', 'kitchen', 'bathroom'],
    visual: { kind: 'feature', feature: Feature.SINK },
    target: { range: 2.25, priority: 66 },
    actions: [
      {
        id: 'drink',
        label: 'Пить',
        kind: 'drink_water',
        cooldownSeconds: 6,
        waterDelta: 28,
        peeDelta: 8,
        message: 'Вы пьете из раковины. Вода холодная, с привкусом трубы.',
        color: '#6cf',
        eventType: 'interactive_used',
        eventSeverity: 1,
      },
    ],
  },
  {
    id: 'sink_broken',
    layer: 'feature',
    label: 'Сломанная раковина',
    prompt: ' сломанная раковина',
    tags: ['water', 'needs', 'sink', 'kitchen', 'bathroom', 'broken', 'repair'],
    visual: { kind: 'feature', feature: Feature.SINK },
    target: { range: 2.25, priority: 78 },
    actions: [
      {
        id: 'inspect_broken',
        label: 'Осмотреть',
        kind: 'repair_pending',
        cooldownSeconds: 2,
        message: 'Раковина сломана. Нужен ремонт: кран держится на честном слове.',
        color: '#9ab',
        eventType: 'interactive_used',
        eventSeverity: 0,
      },
    ],
  },
  {
    id: 'toilet_relief',
    layer: 'feature',
    label: 'Туалет',
    prompt: ' туалет',
    tags: ['needs', 'toilet', 'bathroom'],
    visual: { kind: 'feature', feature: Feature.TOILET },
    target: { range: 2.25, priority: 64 },
    actions: [
      {
        id: 'relieve',
        label: 'Воспользоваться',
        kind: 'relieve',
        cooldownSeconds: 10,
        peeDelta: -70,
        pooDelta: -65,
        message: 'Вы закрываете за собой дверь на одну честную минуту.',
        color: '#bbb',
        eventType: 'interactive_used',
        eventSeverity: 0,
      },
    ],
  },
  {
    id: 'toilet_broken',
    layer: 'feature',
    label: 'Сломанный унитаз',
    prompt: ' сломанный унитаз',
    tags: ['needs', 'toilet', 'bathroom', 'broken', 'repair'],
    visual: { kind: 'feature', feature: Feature.TOILET },
    target: { range: 2.25, priority: 77 },
    actions: [
      {
        id: 'inspect_broken',
        label: 'Осмотреть',
        kind: 'repair_pending',
        cooldownSeconds: 2,
        message: 'Унитаз сломан. Нужен ремонт: бачок молчит, вода стоит.',
        color: '#aaa',
        eventType: 'interactive_used',
        eventSeverity: 0,
      },
    ],
  },
  {
    id: 'workbench_basic',
    layer: 'feature',
    label: 'Верстак',
    prompt: ' верстак',
    tags: ['workbench', 'crafting', 'repair', 'machine'],
    visual: { kind: 'feature', feature: Feature.MACHINE },
    target: { range: 2.25, priority: 63 },
    actions: [
      {
        id: 'inspect',
        label: 'Осмотреть',
        kind: 'message',
        cooldownSeconds: 2,
        message: 'Верстак принимает инструменты, детали и рецепты. Пока доступен только осмотр.',
        color: '#9cf',
        eventType: 'interactive_used',
        eventSeverity: 0,
      },
    ],
  },
  {
    id: 'craft_lathe',
    layer: 'feature',
    label: 'Токарный станок',
    prompt: ' станок',
    tags: ['crafting', 'station', 'lathe', 'machine', 'repair'],
    visual: { kind: 'feature', feature: Feature.MACHINE },
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE,
    target: { range: 2.25, priority: 76 },
    actions: [
      {
        id: 'open_craft',
        label: 'Собрать',
        kind: 'open_craft_menu',
        craftMode: 'craft',
        craftStation: 'lathe',
        cooldownSeconds: 0.5,
        message: 'Станок готов принять детали.',
        color: '#9cf',
        eventType: 'interactive_used',
        eventSeverity: 1,
      },
    ],
  },
  {
    id: 'disassembly_workbench',
    layer: 'feature',
    label: 'Разборочный верстак',
    prompt: ' разобрать',
    tags: ['crafting', 'station', 'workbench', 'disassembly', 'repair'],
    visual: { kind: 'feature', feature: Feature.TABLE },
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH,
    target: { range: 2.25, priority: 75 },
    actions: [
      {
        id: 'open_disassembly',
        label: 'Разобрать',
        kind: 'open_disassembly_menu',
        craftMode: 'disassemble',
        craftStation: 'workbench',
        cooldownSeconds: 0.5,
        message: 'Верстак готов принять предмет на разбор.',
        color: '#fc9',
        eventType: 'interactive_used',
        eventSeverity: 1,
      },
    ],
  },
  {
    id: 'craft_lab_bench',
    layer: 'feature',
    label: 'Лабораторный стол',
    prompt: ' лабораторный стол',
    tags: ['crafting', 'station', 'lab', 'recipe', 'apparatus'],
    visual: { kind: 'feature', feature: Feature.APPARATUS },
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH,
    target: { range: 2.25, priority: 73 },
    actions: [
      {
        id: 'open_lab_craft',
        label: 'Собрать',
        kind: 'open_craft_menu',
        craftMode: 'craft',
        craftStation: 'lab',
        cooldownSeconds: 0.5,
        message: 'Лабораторный стол ждет аккуратной схемы.',
        color: '#9fc',
        eventType: 'interactive_used',
        eventSeverity: 1,
      },
    ],
  },
  {
    id: 'recipe_billboard',
    layer: 'feature',
    label: 'Доска рецептов',
    prompt: ' доска рецептов',
    tags: ['crafting', 'recipe', 'billboard', 'knowledge'],
    visual: { kind: 'feature', feature: Feature.SCREEN },
    surfaceFlag: INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD,
    target: { range: 2.25, priority: 68 },
    actions: [
      {
        id: 'read_recipe',
        label: 'Читать',
        kind: 'learn_recipe',
        recipeSourceId: 'floor_recipe_billboard_basics',
        cooldownSeconds: 2,
        message: 'На доске висят схемы, нормы допуска и чужие пометки карандашом.',
        color: '#ccf',
        eventType: 'interactive_used',
        eventSeverity: 0,
      },
    ],
  },
  {
    id: 'container_adapter',
    layer: 'container',
    label: 'Контейнер',
    prompt: ' контейнер',
    tags: ['container', 'inventory'],
    visual: { kind: 'container', containerKind: ContainerKind.WOODEN_CHEST },
    target: { range: 2.25, priority: 62 },
    actions: [
      {
        id: 'open',
        label: 'Открыть',
        kind: 'open_container',
        eventType: 'interactive_used',
        eventSeverity: 1,
      },
    ],
  },
] as const satisfies readonly InteractiveDef[];

for (const def of INTERACTIVE_DEFS) registerInteractiveDef(def);
