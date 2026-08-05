import { safeParseJson } from '../core/json';
import {
  VISUAL_GEOMETRY_DEFAULT_MODE,
  normalizeVisualGeometryMode,
  type VisualGeometryMode,
} from '../data/visual_geometry_profiles';

export interface UiElementDef {
  id: string;
  group: string;
  label: string;
  defaultEnabled: boolean;
  locked?: boolean;
}

export const UI_ELEMENT_DEFS = [
  { id: 'bottom_tabs', group: 'Основа', label: 'Нижние табы', defaultEnabled: true, locked: false },
  { id: 'weapon_panel', group: 'Бой', label: 'Оружие и инструмент', defaultEnabled: true, locked: false },
  { id: 'crosshair', group: 'Бой', label: 'Прицел и цель', defaultEnabled: true, locked: false },
  { id: 'interaction_prompt', group: 'Бой', label: 'Подсказка действия', defaultEnabled: true, locked: false },
  { id: 'damage_feedback', group: 'Опасность', label: 'Урон и сон', defaultEnabled: true, locked: true },
  { id: 'hazard_warning', group: 'Опасность', label: 'Предупреждения угроз', defaultEnabled: true, locked: false },
  { id: 'messages', group: 'Инфо', label: 'Стенографическая сводка', defaultEnabled: false, locked: false },
  { id: 'location_panel', group: 'Инфо', label: 'Время, зона, комната', defaultEnabled: false, locked: false },
  { id: 'minimap', group: 'Карта', label: 'Миникарта', defaultEnabled: true, locked: false },
  { id: 'route_hints', group: 'Навигация', label: 'Маршрут и VOID', defaultEnabled: false, locked: false },
  { id: 'caravan_hints', group: 'Навигация', label: 'Караванные метки', defaultEnabled: false, locked: false },
  { id: 'status_hints', group: 'Состояние', label: 'Статусы и мутации', defaultEnabled: false, locked: false },
  { id: 'anomaly_hints', group: 'Аномалии', label: 'Смог и аномальные индикаторы', defaultEnabled: false, locked: false },
  { id: 'fps_counter', group: 'Отладка', label: 'FPS в левом углу', defaultEnabled: false, locked: false },
  { id: 'screen_fx', group: 'Экран', label: 'Нейрошум и помехи', defaultEnabled: true, locked: false },
  { id: 'npc_barks', group: 'Экран', label: 'Реплики NPC (баблы)', defaultEnabled: true, locked: false },
  { id: 'samosbor_text', group: 'Системное', label: 'Текст самосбора', defaultEnabled: true, locked: true },
  { id: 'credits', group: 'Системное', label: 'Титры и финальные экраны', defaultEnabled: true, locked: true },
] as const satisfies readonly UiElementDef[];

export type UiElementId = typeof UI_ELEMENT_DEFS[number]['id'];
export const MOUSE_LOOK_SENSITIVITY_DEFAULT = 1.3;
export const MOUSE_LOOK_SENSITIVITY_MIN = 0.5;
export const MOUSE_LOOK_SENSITIVITY_MAX = 2.5;
export const MOUSE_LOOK_SENSITIVITY_STEP = 0.1;
export const MOBILE_LOOK_SENSITIVITY_DEFAULT = 0.5;
export const MOBILE_LOOK_SENSITIVITY_MIN = 0.25;
export const MOBILE_LOOK_SENSITIVITY_MAX = 1.5;
export const MOBILE_LOOK_SENSITIVITY_STEP = 0.25;
export const CAMERA_FOV_DEFAULT_DEGREES = 90;
export const CAMERA_FOV_MIN_DEGREES = 60;
export const CAMERA_FOV_MAX_DEGREES = 110;
export const CAMERA_FOV_STEP_DEGREES = 5;
export const AUTO_PICKUP_DEFAULT = true;
export const MAP_HIGH_CONTRAST_DEFAULT = false;
export const SCREEN_INTERFERENCE_MODES = [
  { id: 'off', label: 'Выкл' },
  { id: 'critical', label: 'Слабо' },
  { id: 'full', label: 'Полно' },
] as const;
export type ScreenInterferenceMode = typeof SCREEN_INTERFERENCE_MODES[number]['id'];
export const SCREEN_INTERFERENCE_DEFAULT: ScreenInterferenceMode = 'critical';
export const HUD_MOTION_MODES = [
  { id: 'reduced', label: 'Меньше' },
  { id: 'normal', label: 'Норма' },
] as const;
export type HudMotionMode = typeof HUD_MOTION_MODES[number]['id'];
export const HUD_MOTION_DEFAULT: HudMotionMode = 'reduced';
export const VISUAL_GEOMETRY_MODE_LABELS: Readonly<Record<VisualGeometryMode, string>> = {
  off: 'Выкл',
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
};

// Render-only lighting quality (browser-local, outside the game save). Higher
// modes enable smooth baked-light sampling, gradient bump and specular glints in
// the WebGL raycaster. Default is the maximum tier.
export const LIGHTING_QUALITY_MODES = ['off', 'low', 'medium', 'high', 'experimental'] as const;
export type LightingQualityMode = typeof LIGHTING_QUALITY_MODES[number];
export const LIGHTING_QUALITY_DEFAULT_MODE: LightingQualityMode = 'experimental';
export const CRITTERS_ENABLED_DEFAULT = true;
export const LIGHTING_QUALITY_MODE_LABELS: Readonly<Record<LightingQualityMode, string>> = {
  off: 'Выкл',
  low: 'Низкое',
  medium: 'Среднее',
  high: 'Высокое',
  experimental: 'Максимум',
};
export function normalizeLightingQualityMode(value: unknown): LightingQualityMode {
  return (LIGHTING_QUALITY_MODES as readonly string[]).includes(value as string)
    ? value as LightingQualityMode
    : LIGHTING_QUALITY_DEFAULT_MODE;
}

export type MapColorMode = 'rooms';

export interface MapLegendToggleDef {
  id: string;
  group: string;
  label: string;
  defaultEnabled: boolean;
}

export const MAP_LEGEND_TOGGLE_DEFS = [
  { id: 'map_npcs', group: 'Маркеры', label: 'NPC', defaultEnabled: true },
  { id: 'map_monsters', group: 'Маркеры', label: 'Монстры', defaultEnabled: true },
  { id: 'map_items', group: 'Маркеры', label: 'Предметы', defaultEnabled: true },
  { id: 'map_quests', group: 'Маркеры', label: 'Задания и цели', defaultEnabled: true },
  { id: 'map_lifts', group: 'Маркеры', label: 'Лифты', defaultEnabled: true },
  { id: 'map_surface_marks', group: 'Маркеры', label: 'Меловые пометки', defaultEnabled: true },
] as const satisfies readonly MapLegendToggleDef[];

export type MapLegendToggleId = typeof MAP_LEGEND_TOGGLE_DEFS[number]['id'];

type UiSettings = Record<UiElementId, boolean> & {
  mouseLookSensitivity: number;
  mobileLookSensitivity: number;
  cameraFovDegrees: number;
  autoPickupEnabled: boolean;
  mapColorMode: MapColorMode;
  mapHighContrast: boolean;
  screenInterferenceMode: ScreenInterferenceMode;
  hudMotionMode: HudMotionMode;
  visualGeometryMode: VisualGeometryMode;
  lightingQualityMode: LightingQualityMode;
  crittersEnabled: boolean;
} & Record<MapLegendToggleId, boolean>;

export type MapLegendRow =
  | { kind: 'reset_map_legend'; id: 'reset_map_legend'; group: 'Сервис'; label: 'Сбросить легенду' }
  | { kind: 'map_contrast'; id: 'map_contrast'; group: 'Цвет'; label: 'Контраст карты' }
  | { kind: 'map_toggle'; toggle: typeof MAP_LEGEND_TOGGLE_DEFS[number] };

const MAP_LEGEND_RESET_ROW: MapLegendRow = {
  kind: 'reset_map_legend',
  id: 'reset_map_legend',
  group: 'Сервис',
  label: 'Сбросить легенду',
};

export interface UiPresetDef {
  id: string;
  label: string;
  hint: string;
  enabled: readonly UiElementId[];
}

export const UI_PRESETS = [
  {
    id: 'off',
    label: 'Выкл всё',
    hint: 'Только обязательные системные сигналы.',
    enabled: [],
  },
  {
    id: 'novice',
    label: 'Новичок',
    hint: 'Первый запуск: бой, угрозы, миникарта и слабый нейрошум.',
    enabled: [
      'bottom_tabs',
      'weapon_panel',
      'crosshair',
      'interaction_prompt',
      'damage_feedback',
      'hazard_warning',
      'minimap',
      'screen_fx',
      'npc_barks',
    ],
  },
  {
    id: 'minimal',
    label: 'Минимум',
    hint: 'Нижние показатели, действие и базовая опасность.',
    enabled: [
      'bottom_tabs',
      'interaction_prompt',
      'damage_feedback',
      'hazard_warning',
      'minimap',
      'screen_fx',
      'npc_barks',
    ],
  },
  {
    id: 'combat',
    label: 'Бой',
    hint: 'Оружие, прицел, урон и ближайшие угрозы.',
    enabled: [
      'bottom_tabs',
      'weapon_panel',
      'crosshair',
      'interaction_prompt',
      'damage_feedback',
      'hazard_warning',
      'messages',
      'minimap',
      'screen_fx',
      'npc_barks',
    ],
  },
  {
    id: 'route',
    label: 'Маршрут',
    hint: 'Лифты, маршрутные подсказки и базовая карта.',
    enabled: [
      'bottom_tabs',
      'interaction_prompt',
      'damage_feedback',
      'hazard_warning',
      'messages',
      'minimap',
      'route_hints',
      'screen_fx',
      'npc_barks',
    ],
  },
  {
    id: 'full',
    label: 'Полный',
    hint: 'Все игровые поверхности кроме отладки.',
    enabled: [
      'bottom_tabs',
      'weapon_panel',
      'crosshair',
      'interaction_prompt',
      'damage_feedback',
      'hazard_warning',
      'messages',
      'location_panel',
      'minimap',
      'route_hints',
      'caravan_hints',
      'status_hints',
      'anomaly_hints',
      'screen_fx',
      'npc_barks',
    ],
  },
] as const satisfies readonly UiPresetDef[];

export type UiPresetId = typeof UI_PRESETS[number]['id'];
export const DEFAULT_UI_PRESET_ID: UiPresetId = 'novice';
export type UiSettingsView = 'interface' | 'graphics';

const MOBILE_SETTINGS_ROWS = [
  { kind: 'mobile_sensitivity', id: 'mobile_look_sensitivity', group: 'Мобилка', label: 'Чувствительность обзора' },
] as const;

const GAMEPLAY_SETTINGS_ROWS = [
  { kind: 'auto_pickup', id: 'auto_pickup', group: 'Предметы', label: 'Автоподбор предметов' },
] as const;

const GRAPHICS_SETTINGS_ROWS = [
  { kind: 'screen_interference', id: 'screen_interference', group: 'Экран', label: 'Помехи экрана' },
  { kind: 'hud_motion', id: 'hud_motion', group: 'HUD', label: 'Движение HUD' },
  { kind: 'visual_geometry', id: 'visual_geometry', group: 'Графика', label: '3D детализация' },
  { kind: 'lighting_quality', id: 'lighting_quality', group: 'Графика', label: 'Качество света' },
  { kind: 'camera_fov', id: 'camera_fov', group: 'Графика', label: 'FOV / угол обзора' },
  { kind: 'map_contrast', id: 'map_contrast', group: 'Карта', label: 'Контраст карты' },
  { kind: 'critters', id: 'critters', group: 'Графика', label: 'Живность (мухи)' },
] as const;

const UI_RESET_ROWS = {
  interface: { kind: 'reset_interface', id: 'reset_interface', group: 'Сервис', label: 'Сбросить интерфейс' },
  graphics: { kind: 'reset_graphics', id: 'reset_graphics', group: 'Сервис', label: 'Сбросить графику' },
} as const;

export type UiSettingsRow =
  | typeof UI_RESET_ROWS[keyof typeof UI_RESET_ROWS]
  | { kind: 'preset'; preset: typeof UI_PRESETS[number] }
  | { kind: 'element'; element: typeof UI_ELEMENT_DEFS[number] }
  | typeof GRAPHICS_SETTINGS_ROWS[number]
  | typeof GAMEPLAY_SETTINGS_ROWS[number]
  | typeof MOBILE_SETTINGS_ROWS[number];

const UI_STORAGE_KEY = 'gigahrush_ui_orchestrator_v6';

const defsById = new Map<UiElementId, typeof UI_ELEMENT_DEFS[number]>(
  UI_ELEMENT_DEFS.map(def => [def.id, def]),
);
const presetsById = new Map<UiPresetId, typeof UI_PRESETS[number]>(
  UI_PRESETS.map(preset => [preset.id, preset]),
);

let settings = loadUiSettings();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function settingsFromEnabledIds(enabledIds: readonly UiElementId[]): UiSettings {
  const enabled = new Set<UiElementId>(enabledIds);
  const out = {} as UiSettings;
  for (const def of UI_ELEMENT_DEFS) out[def.id] = def.locked || enabled.has(def.id);
  out.mouseLookSensitivity = MOUSE_LOOK_SENSITIVITY_DEFAULT;
  out.mobileLookSensitivity = MOBILE_LOOK_SENSITIVITY_DEFAULT;
  out.cameraFovDegrees = CAMERA_FOV_DEFAULT_DEGREES;
  out.autoPickupEnabled = AUTO_PICKUP_DEFAULT;
  out.mapColorMode = 'rooms';
  out.mapHighContrast = MAP_HIGH_CONTRAST_DEFAULT;
  out.screenInterferenceMode = SCREEN_INTERFERENCE_DEFAULT;
  out.hudMotionMode = HUD_MOTION_DEFAULT;
  out.visualGeometryMode = VISUAL_GEOMETRY_DEFAULT_MODE;
  out.lightingQualityMode = LIGHTING_QUALITY_DEFAULT_MODE;
  out.crittersEnabled = CRITTERS_ENABLED_DEFAULT;
  for (const def of MAP_LEGEND_TOGGLE_DEFS) out[def.id] = def.defaultEnabled;
  return out;
}

function defaultUiSettings(): UiSettings {
  return settingsFromEnabledIds(presetsById.get(DEFAULT_UI_PRESET_ID)?.enabled ?? []);
}

function normalizeUiSettings(raw: unknown): UiSettings {
  const out = defaultUiSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const def of UI_ELEMENT_DEFS) {
    if (def.locked) {
      out[def.id] = true;
      continue;
    }
    const value = src[def.id];
    if (typeof value === 'boolean') out[def.id] = value;
  }
  out.mouseLookSensitivity = normalizeMouseLookSensitivity(src.mouseLookSensitivity);
  out.mobileLookSensitivity = normalizeMobileLookSensitivity(src.mobileLookSensitivity);
  out.cameraFovDegrees = normalizeCameraFovDegrees(src.cameraFovDegrees);
  out.autoPickupEnabled = typeof src.autoPickupEnabled === 'boolean' ? src.autoPickupEnabled : AUTO_PICKUP_DEFAULT;
  out.mapColorMode = normalizeMapColorMode(src.mapColorMode);
  out.mapHighContrast = typeof src.mapHighContrast === 'boolean' ? src.mapHighContrast : MAP_HIGH_CONTRAST_DEFAULT;
  out.screenInterferenceMode = normalizeScreenInterferenceMode(src.screenInterferenceMode);
  out.hudMotionMode = normalizeHudMotionMode(src.hudMotionMode);
  out.visualGeometryMode = normalizeVisualGeometryMode(src.visualGeometryMode);
  out.lightingQualityMode = normalizeLightingQualityMode(src.lightingQualityMode);
  out.crittersEnabled = typeof src.crittersEnabled === 'boolean' ? src.crittersEnabled : CRITTERS_ENABLED_DEFAULT;
  for (const def of MAP_LEGEND_TOGGLE_DEFS) {
    const value = src[def.id];
    if (typeof value === 'boolean') out[def.id] = value;
  }
  return out;
}

function normalizeMapColorMode(_value: unknown): MapColorMode {
  return 'rooms';
}

function normalizeScreenInterferenceMode(value: unknown): ScreenInterferenceMode {
  return SCREEN_INTERFERENCE_MODES.some(mode => mode.id === value)
    ? value as ScreenInterferenceMode
    : SCREEN_INTERFERENCE_DEFAULT;
}

function normalizeHudMotionMode(value: unknown): HudMotionMode {
  return HUD_MOTION_MODES.some(mode => mode.id === value)
    ? value as HudMotionMode
    : HUD_MOTION_DEFAULT;
}

function normalizeMouseLookSensitivity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MOUSE_LOOK_SENSITIVITY_DEFAULT;
  const clamped = Math.max(MOUSE_LOOK_SENSITIVITY_MIN, Math.min(MOUSE_LOOK_SENSITIVITY_MAX, value));
  const stepped = Math.round(clamped / MOUSE_LOOK_SENSITIVITY_STEP) * MOUSE_LOOK_SENSITIVITY_STEP;
  return Math.round(stepped * 100) / 100;
}

function mouseLookSensitivityStepIndex(value: number): number {
  const steps = Math.round((MOUSE_LOOK_SENSITIVITY_MAX - MOUSE_LOOK_SENSITIVITY_MIN) / MOUSE_LOOK_SENSITIVITY_STEP) + 1;
  const normalized = normalizeMouseLookSensitivity(value);
  return Math.max(0, Math.min(steps - 1, Math.round((normalized - MOUSE_LOOK_SENSITIVITY_MIN) / MOUSE_LOOK_SENSITIVITY_STEP)));
}

function normalizeMobileLookSensitivity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MOBILE_LOOK_SENSITIVITY_DEFAULT;
  const clamped = Math.max(MOBILE_LOOK_SENSITIVITY_MIN, Math.min(MOBILE_LOOK_SENSITIVITY_MAX, value));
  const stepped = Math.round(clamped / MOBILE_LOOK_SENSITIVITY_STEP) * MOBILE_LOOK_SENSITIVITY_STEP;
  return Math.round(stepped * 100) / 100;
}

function mobileLookSensitivityStepIndex(value: number): number {
  const steps = Math.round((MOBILE_LOOK_SENSITIVITY_MAX - MOBILE_LOOK_SENSITIVITY_MIN) / MOBILE_LOOK_SENSITIVITY_STEP) + 1;
  const normalized = normalizeMobileLookSensitivity(value);
  return Math.max(0, Math.min(steps - 1, Math.round((normalized - MOBILE_LOOK_SENSITIVITY_MIN) / MOBILE_LOOK_SENSITIVITY_STEP)));
}

function normalizeCameraFovDegrees(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CAMERA_FOV_DEFAULT_DEGREES;
  const clamped = Math.max(CAMERA_FOV_MIN_DEGREES, Math.min(CAMERA_FOV_MAX_DEGREES, value));
  const stepped = Math.round(clamped / CAMERA_FOV_STEP_DEGREES) * CAMERA_FOV_STEP_DEGREES;
  return Math.round(stepped);
}

function cameraFovStepIndex(value: number): number {
  const steps = Math.round((CAMERA_FOV_MAX_DEGREES - CAMERA_FOV_MIN_DEGREES) / CAMERA_FOV_STEP_DEGREES) + 1;
  const normalized = normalizeCameraFovDegrees(value);
  return Math.max(0, Math.min(steps - 1, Math.round((normalized - CAMERA_FOV_MIN_DEGREES) / CAMERA_FOV_STEP_DEGREES)));
}

function loadUiSettings(): UiSettings {
  const s = storage();
  if (!s) return defaultUiSettings();
  try {
    return normalizeUiSettings(safeParseJson(s.getItem(UI_STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultUiSettings();
  }
}

function saveUiSettings(): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(UI_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The in-memory settings still apply if browser storage is blocked.
  }
}

export function uiElementEnabled(id: UiElementId): boolean {
  const def = defsById.get(id);
  if (def?.locked) return true;
  return settings[id] ?? def?.defaultEnabled ?? false;
}

export function setUiElementEnabled(id: UiElementId, enabled: boolean): boolean {
  const def = defsById.get(id);
  if (!def) return false;
  if (def.locked) {
    settings[id] = true;
    saveUiSettings();
    return true;
  }
  settings[id] = enabled;
  saveUiSettings();
  return settings[id];
}

export function toggleUiElement(id: UiElementId): boolean {
  return setUiElementEnabled(id, !uiElementEnabled(id));
}

export function resetUiElement(id: UiElementId): boolean {
  const def = defsById.get(id);
  if (!def) return false;
  settings[id] = def.locked ? true : def.defaultEnabled;
  saveUiSettings();
  return settings[id];
}

export function resetUiSettings(): void {
  settings = defaultUiSettings();
  saveUiSettings();
}

export function applyUiPreset(id: UiPresetId): boolean {
  const preset = presetsById.get(id);
  if (!preset) return false;
  const mouseSensitivity = mouseLookSensitivity();
  const sensitivity = mobileLookSensitivity();
  const fov = cameraFovDegrees();
  const autoPickup = autoPickupEnabled();
  const highContrast = mapHighContrastEnabled();
  const interference = screenInterferenceMode();
  const hudMotion = hudMotionMode();
  const geometryMode = visualGeometryMode();
  const lightingMode = lightingQualityMode();
  const critters = crittersEnabled();
  const mapToggles = MAP_LEGEND_TOGGLE_DEFS.map(def => [def.id, mapLegendToggleEnabled(def.id)] as const);
  settings = settingsFromEnabledIds(preset.enabled);
  settings.mouseLookSensitivity = mouseSensitivity;
  settings.mobileLookSensitivity = sensitivity;
  settings.cameraFovDegrees = fov;
  settings.autoPickupEnabled = autoPickup;
  settings.mapColorMode = 'rooms';
  settings.mapHighContrast = highContrast;
  settings.screenInterferenceMode = interference;
  settings.hudMotionMode = hudMotion;
  settings.visualGeometryMode = geometryMode;
  settings.lightingQualityMode = lightingMode;
  settings.crittersEnabled = critters;
  for (const [id, enabled] of mapToggles) settings[id] = enabled;
  saveUiSettings();
  return true;
}

export function mouseLookSensitivity(): number {
  settings.mouseLookSensitivity = normalizeMouseLookSensitivity(settings.mouseLookSensitivity);
  return settings.mouseLookSensitivity;
}

export function adjustMouseLookSensitivity(deltaSteps: number): number {
  const steps = Math.round((MOUSE_LOOK_SENSITIVITY_MAX - MOUSE_LOOK_SENSITIVITY_MIN) / MOUSE_LOOK_SENSITIVITY_STEP) + 1;
  const current = mouseLookSensitivityStepIndex(mouseLookSensitivity());
  const next = Math.max(0, Math.min(steps - 1, current + Math.trunc(deltaSteps)));
  settings.mouseLookSensitivity = Math.round((MOUSE_LOOK_SENSITIVITY_MIN + next * MOUSE_LOOK_SENSITIVITY_STEP) * 100) / 100;
  saveUiSettings();
  return settings.mouseLookSensitivity;
}

export function resetMouseLookSensitivity(): number {
  settings.mouseLookSensitivity = MOUSE_LOOK_SENSITIVITY_DEFAULT;
  saveUiSettings();
  return settings.mouseLookSensitivity;
}

export function mobileLookSensitivity(): number {
  settings.mobileLookSensitivity = normalizeMobileLookSensitivity(settings.mobileLookSensitivity);
  return settings.mobileLookSensitivity;
}

export function adjustMobileLookSensitivity(deltaSteps: number): number {
  const steps = Math.round((MOBILE_LOOK_SENSITIVITY_MAX - MOBILE_LOOK_SENSITIVITY_MIN) / MOBILE_LOOK_SENSITIVITY_STEP) + 1;
  const current = mobileLookSensitivityStepIndex(mobileLookSensitivity());
  const next = (current + Math.trunc(deltaSteps) + steps) % steps;
  settings.mobileLookSensitivity = Math.round((MOBILE_LOOK_SENSITIVITY_MIN + next * MOBILE_LOOK_SENSITIVITY_STEP) * 100) / 100;
  saveUiSettings();
  return settings.mobileLookSensitivity;
}

export function resetMobileLookSensitivity(): number {
  settings.mobileLookSensitivity = MOBILE_LOOK_SENSITIVITY_DEFAULT;
  saveUiSettings();
  return settings.mobileLookSensitivity;
}

export function cameraFovDegrees(): number {
  settings.cameraFovDegrees = normalizeCameraFovDegrees(settings.cameraFovDegrees);
  return settings.cameraFovDegrees;
}

export function cameraFovRadians(): number {
  return cameraFovDegrees() * Math.PI / 180;
}

export function cameraPlaneLen(): number {
  return Math.tan(cameraFovRadians() * 0.5);
}

export function adjustCameraFov(deltaSteps: number): number {
  const steps = Math.round((CAMERA_FOV_MAX_DEGREES - CAMERA_FOV_MIN_DEGREES) / CAMERA_FOV_STEP_DEGREES) + 1;
  const current = cameraFovStepIndex(cameraFovDegrees());
  const next = (current + Math.trunc(deltaSteps) + steps) % steps;
  settings.cameraFovDegrees = CAMERA_FOV_MIN_DEGREES + next * CAMERA_FOV_STEP_DEGREES;
  saveUiSettings();
  return settings.cameraFovDegrees;
}

export function resetCameraFov(): number {
  settings.cameraFovDegrees = CAMERA_FOV_DEFAULT_DEGREES;
  saveUiSettings();
  return settings.cameraFovDegrees;
}

export function screenInterferenceMode(): ScreenInterferenceMode {
  settings.screenInterferenceMode = normalizeScreenInterferenceMode(settings.screenInterferenceMode);
  return settings.screenInterferenceMode;
}

export function cycleScreenInterferenceMode(deltaSteps: number): ScreenInterferenceMode {
  const current = SCREEN_INTERFERENCE_MODES.findIndex(mode => mode.id === screenInterferenceMode());
  const steps = SCREEN_INTERFERENCE_MODES.length;
  const next = (Math.max(0, current) + Math.trunc(deltaSteps) + steps) % steps;
  settings.screenInterferenceMode = SCREEN_INTERFERENCE_MODES[next].id;
  saveUiSettings();
  return settings.screenInterferenceMode;
}

export function hudMotionMode(): HudMotionMode {
  settings.hudMotionMode = normalizeHudMotionMode(settings.hudMotionMode);
  return settings.hudMotionMode;
}

export function cycleHudMotionMode(): HudMotionMode {
  settings.hudMotionMode = hudMotionMode() === 'reduced' ? 'normal' : 'reduced';
  saveUiSettings();
  return settings.hudMotionMode;
}

export function visualGeometryMode(): VisualGeometryMode {
  settings.visualGeometryMode = normalizeVisualGeometryMode(settings.visualGeometryMode);
  return settings.visualGeometryMode;
}

export function visualGeometryModeLabel(mode = visualGeometryMode()): string {
  return VISUAL_GEOMETRY_MODE_LABELS[mode];
}

export function cycleVisualGeometryMode(deltaSteps: number): VisualGeometryMode {
  const order: readonly VisualGeometryMode[] = ['off', 'low', 'medium', 'high'];
  const current = order.findIndex(mode => mode === visualGeometryMode());
  const steps = order.length;
  const next = (Math.max(0, current) + Math.trunc(deltaSteps) + steps) % steps;
  settings.visualGeometryMode = order[next];
  saveUiSettings();
  return settings.visualGeometryMode;
}

export function lightingQualityMode(): LightingQualityMode {
  settings.lightingQualityMode = normalizeLightingQualityMode(settings.lightingQualityMode);
  return settings.lightingQualityMode;
}

export function lightingQualityModeLabel(mode = lightingQualityMode()): string {
  return LIGHTING_QUALITY_MODE_LABELS[mode];
}

export function lightingQualityIndex(mode = lightingQualityMode()): number {
  return Math.max(0, LIGHTING_QUALITY_MODES.indexOf(mode));
}

export function cycleLightingQualityMode(deltaSteps: number): LightingQualityMode {
  const current = LIGHTING_QUALITY_MODES.indexOf(lightingQualityMode());
  const steps = LIGHTING_QUALITY_MODES.length;
  const next = (Math.max(0, current) + Math.trunc(deltaSteps) + steps) % steps;
  settings.lightingQualityMode = LIGHTING_QUALITY_MODES[next];
  saveUiSettings();
  return settings.lightingQualityMode;
}

export function resetGraphicsSettings(): void {
  settings.cameraFovDegrees = CAMERA_FOV_DEFAULT_DEGREES;
  settings.screenInterferenceMode = SCREEN_INTERFERENCE_DEFAULT;
  settings.hudMotionMode = HUD_MOTION_DEFAULT;
  settings.visualGeometryMode = VISUAL_GEOMETRY_DEFAULT_MODE;
  settings.lightingQualityMode = LIGHTING_QUALITY_DEFAULT_MODE;
  saveUiSettings();
}


export function crittersEnabled(): boolean {
  if (typeof settings.crittersEnabled !== 'boolean') settings.crittersEnabled = CRITTERS_ENABLED_DEFAULT;
  return settings.crittersEnabled;
}

export function setCrittersEnabled(enabled: boolean): boolean {
  settings.crittersEnabled = enabled;
  saveUiSettings();
  return settings.crittersEnabled;
}

export function toggleCrittersEnabled(): boolean {
  return setCrittersEnabled(!crittersEnabled());
}

export function autoPickupEnabled(): boolean {
  if (typeof settings.autoPickupEnabled !== 'boolean') settings.autoPickupEnabled = AUTO_PICKUP_DEFAULT;
  return settings.autoPickupEnabled;
}

export function setAutoPickupEnabled(enabled: boolean): boolean {
  settings.autoPickupEnabled = enabled;
  saveUiSettings();
  return settings.autoPickupEnabled;
}

export function toggleAutoPickup(): boolean {
  return setAutoPickupEnabled(!autoPickupEnabled());
}

export function resetAutoPickup(): boolean {
  return setAutoPickupEnabled(AUTO_PICKUP_DEFAULT);
}

export function mapColorMode(): MapColorMode {
  settings.mapColorMode = normalizeMapColorMode(settings.mapColorMode);
  return settings.mapColorMode;
}

export function setMapColorMode(mode: MapColorMode): MapColorMode {
  settings.mapColorMode = normalizeMapColorMode(mode);
  saveUiSettings();
  return settings.mapColorMode;
}

export function mapHighContrastEnabled(): boolean {
  if (typeof settings.mapHighContrast !== 'boolean') settings.mapHighContrast = MAP_HIGH_CONTRAST_DEFAULT;
  return settings.mapHighContrast;
}

export function setMapHighContrastEnabled(enabled: boolean): boolean {
  settings.mapHighContrast = enabled;
  saveUiSettings();
  return settings.mapHighContrast;
}

export function toggleMapHighContrast(): boolean {
  return setMapHighContrastEnabled(!mapHighContrastEnabled());
}

export function mapLegendToggleEnabled(id: MapLegendToggleId): boolean {
  const def = MAP_LEGEND_TOGGLE_DEFS.find(entry => entry.id === id);
  if (!def) return false;
  if (typeof settings[id] !== 'boolean') settings[id] = def.defaultEnabled;
  return settings[id];
}

export function setMapLegendToggleEnabled(id: MapLegendToggleId, enabled: boolean): boolean {
  const def = MAP_LEGEND_TOGGLE_DEFS.find(entry => entry.id === id);
  if (!def) return false;
  settings[id] = enabled;
  saveUiSettings();
  return settings[id];
}

export function toggleMapLegendToggle(id: MapLegendToggleId): boolean {
  return setMapLegendToggleEnabled(id, !mapLegendToggleEnabled(id));
}

export function resetMapLegendSettings(): void {
  settings.mapColorMode = 'rooms';
  settings.mapHighContrast = MAP_HIGH_CONTRAST_DEFAULT;
  for (const def of MAP_LEGEND_TOGGLE_DEFS) settings[def.id] = def.defaultEnabled;
  saveUiSettings();
}

export function mapLegendRowCount(): number {
  return 2 + MAP_LEGEND_TOGGLE_DEFS.length;
}

export function mapLegendRowAt(index: number): MapLegendRow | undefined {
  if (index < 0) return undefined;
  if (index === 0) return MAP_LEGEND_RESET_ROW;
  if (index === 1) return { kind: 'map_contrast', id: 'map_contrast', group: 'Цвет', label: 'Контраст карты' };
  const toggle = MAP_LEGEND_TOGGLE_DEFS[index - 2];
  return toggle ? { kind: 'map_toggle', toggle } : undefined;
}

export function activeUiPresetId(): UiPresetId | undefined {
  for (const preset of UI_PRESETS) {
    const enabled = new Set<UiElementId>(preset.enabled);
    let matches = true;
    for (const def of UI_ELEMENT_DEFS) {
      if (def.locked) continue;
      if (uiElementEnabled(def.id) !== enabled.has(def.id)) {
        matches = false;
        break;
      }
    }
    if (matches) return preset.id;
  }
  return undefined;
}

export function uiSettingsRowCount(view: UiSettingsView = 'interface'): number {
  if (view === 'graphics') return 1 + GRAPHICS_SETTINGS_ROWS.length;
  return 1 + UI_PRESETS.length + UI_ELEMENT_DEFS.length + GAMEPLAY_SETTINGS_ROWS.length + MOBILE_SETTINGS_ROWS.length;
}

export function uiSettingsRowAt(index: number, view: UiSettingsView = 'interface'): UiSettingsRow | undefined {
  if (index < 0) return undefined;
  if (index === 0) return UI_RESET_ROWS[view];
  const localIndex = index - 1;
  if (view === 'graphics') return GRAPHICS_SETTINGS_ROWS[localIndex];
  if (localIndex < UI_PRESETS.length) return { kind: 'preset', preset: UI_PRESETS[localIndex] };
  const element = UI_ELEMENT_DEFS[localIndex - UI_PRESETS.length];
  if (element) return { kind: 'element', element };
  const gameplay = GAMEPLAY_SETTINGS_ROWS[localIndex - UI_PRESETS.length - UI_ELEMENT_DEFS.length];
  if (gameplay) return gameplay;
  return MOBILE_SETTINGS_ROWS[localIndex - UI_PRESETS.length - UI_ELEMENT_DEFS.length - GAMEPLAY_SETTINGS_ROWS.length];
}
