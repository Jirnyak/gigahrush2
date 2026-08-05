import { safeParseJson } from '../core/json';
import { type InputState } from '../core/types';

type BooleanInputKey = {
  [K in keyof InputState]: InputState[K] extends boolean ? K : never;
}[keyof InputState];

interface ControlActionDefBase {
  id: string;
  group: string;
  label: string;
  input?: BooleanInputKey;
  defaultKeys: readonly string[];
}

export const CONTROL_ACTIONS = [
  { id: 'moveForward', group: 'Движение', label: 'Вперёд', input: 'fwd', defaultKeys: ['KeyW', 'ArrowUp', 'KeyC', 'KeyY'] },
  { id: 'moveBackward', group: 'Движение', label: 'Назад', input: 'back', defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'turnLeft', group: 'Движение', label: 'Поворот влево', input: 'left', defaultKeys: ['ArrowLeft'] },
  { id: 'turnRight', group: 'Движение', label: 'Поворот вправо', input: 'right', defaultKeys: ['ArrowRight'] },
  { id: 'strafeLeft', group: 'Движение', label: 'Шаг влево', input: 'strafeL', defaultKeys: ['KeyA'] },
  { id: 'strafeRight', group: 'Движение', label: 'Шаг вправо', input: 'strafeR', defaultKeys: ['KeyD'] },
  { id: 'sprint', group: 'Движение', label: 'Спринт, удерживать', input: 'sprint', defaultKeys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'attack', group: 'Бой', label: 'Атака / выстрел', input: 'attack', defaultKeys: ['MouseLeft'] },
  { id: 'reload', group: 'Бой', label: 'Перезарядка', input: 'reload', defaultKeys: ['KeyR'] },
  { id: 'interact', group: 'Бой', label: 'Взаимодействовать в мире', input: 'interact', defaultKeys: ['KeyE'] },
  { id: 'useTool', group: 'Бой', label: 'Использовать инструмент', input: 'use', defaultKeys: ['MouseRight'] },
  { id: 'sleep', group: 'Состояние', label: 'Спать, удерживать', input: 'sleep', defaultKeys: ['KeyZ'] },
  { id: 'pee', group: 'Состояние', label: 'Пописать', input: 'pee', defaultKeys: ['KeyP'] },
  { id: 'gameMenu', group: 'Экраны', label: 'Меню / принять', input: 'escape', defaultKeys: ['Enter'] },
  { id: 'help', group: 'Экраны', label: 'HELP / туториал', input: 'help', defaultKeys: ['F1'] },
  { id: 'controlsMenu', group: 'Экраны', label: 'Все клавиши', input: 'controls', defaultKeys: ['Tab'] },
  { id: 'uiSettings', group: 'Экраны', label: 'Настройка UI', input: 'uiSettings', defaultKeys: ['KeyU'] },
  { id: 'fullscreen', group: 'Экраны', label: 'Полный экран', defaultKeys: ['F11'] },
  { id: 'inventory', group: 'Экраны', label: 'Инвентарь', input: 'inv', defaultKeys: ['KeyI'] },
  { id: 'map', group: 'Экраны', label: 'Большая карта', input: 'map', defaultKeys: ['KeyM'] },
  { id: 'mapLegend', group: 'Экраны', label: 'Легенда карты', input: 'mapLegend', defaultKeys: ['KeyG'] },
  { id: 'quests', group: 'Экраны', label: 'Задания', input: 'questLog', defaultKeys: ['KeyQ'] },
  { id: 'factions', group: 'Экраны', label: 'Фракции / A-Life', input: 'factionMenu', defaultKeys: ['KeyF'] },
  { id: 'log', group: 'Экраны', label: 'Журнал сообщений', input: 'logMenu', defaultKeys: ['KeyL'] },
  { id: 'netSphere', group: 'Экраны', label: 'НЕТ-СФЕРА', defaultKeys: ['KeyN'] },
  { id: 'debug', group: 'Экраны', label: 'Отладка', input: 'debugScreen', defaultKeys: ['Backquote'] },
  { id: 'menuClose', group: 'Меню', label: 'Закрыть / назад', input: 'controlClose', defaultKeys: [] },
  { id: 'controlClear', group: 'Меню', label: 'Очистить выбранную строку', input: 'controlReset', defaultKeys: ['Backspace'] },
  { id: 'netSubmit', group: 'НЕТ-СФЕРА', label: 'Отправить строку', defaultKeys: ['Enter'] },
  { id: 'netClose', group: 'НЕТ-СФЕРА', label: 'Закрыть окно', defaultKeys: ['Delete'] },
  { id: 'netErase', group: 'НЕТ-СФЕРА', label: 'Удалить символ', defaultKeys: ['Backspace'] },
  { id: 'menuUp', group: 'Меню', label: 'Выбор вверх', input: 'invUp', defaultKeys: ['KeyW', 'ArrowUp'] },
  { id: 'menuDown', group: 'Меню', label: 'Выбор вниз', input: 'invDn', defaultKeys: ['KeyS', 'ArrowDown'] },
  { id: 'menuLeft', group: 'Меню', label: 'Влево / предыдущая', input: 'invLeft', defaultKeys: ['KeyA', 'ArrowLeft'] },
  { id: 'menuRight', group: 'Меню', label: 'Вправо / следующая', input: 'invRight', defaultKeys: ['KeyD', 'ArrowRight'] },
  { id: 'drop', group: 'Инвентарь', label: 'Выбросить / перенести вправо', input: 'drop', defaultKeys: ['KeyX'] },
  { id: 'attrStr', group: 'Инвентарь', label: 'Очко в силу', input: 'attrStr', defaultKeys: ['Digit1'] },
  { id: 'attrAgi', group: 'Инвентарь', label: 'Очко в ловкость', input: 'attrAgi', defaultKeys: ['Digit2'] },
  { id: 'attrInt', group: 'Инвентарь', label: 'Очко в интеллект', input: 'attrInt', defaultKeys: ['Digit3'] },
] as const satisfies readonly ControlActionDefBase[];

export type ControlActionId = typeof CONTROL_ACTIONS[number]['id'];
type ControlBindings = Record<ControlActionId, string[]>;

const CONTROL_STORAGE_KEY = 'gigahrush_control_bindings_v7';
const MAX_BINDINGS_PER_ACTION = 16;

const CODE_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '~',
  Backspace: 'Backspace',
  Delete: 'Del',
  Enter: 'Enter',
  Escape: 'Esc',
  MouseLeft: 'ЛКМ',
  MouseMiddle: 'СКМ',
  MouseRight: 'ПКМ',
  MouseBack: 'Mouse 4',
  MouseForward: 'Mouse 5',
  Space: 'Пробел',
  Tab: 'Tab',
};

export function mouseButtonCode(button: number): string {
  if (button === 0) return 'MouseLeft';
  if (button === 1) return 'MouseMiddle';
  if (button === 2) return 'MouseRight';
  if (button === 3) return 'MouseBack';
  if (button === 4) return 'MouseForward';
  return `Mouse${Math.max(0, Math.floor(button))}`;
}

export function isMenuCloseCode(code: string): boolean {
  return matchesControlAction('menuClose', code);
}

export function isControlResetCode(code: string): boolean {
  return matchesControlAction('controlClear', code);
}

export function menuCloseLabel(): string {
  return controlBindingLabel('menuClose');
}

export function menuCloseHint(): string {
  const label = menuCloseLabel();
  if (label === '—') return '[ПКМ]';
  return label.includes('ПКМ') ? `[${label}]` : `[${label} / ПКМ]`;
}

let bindings = loadControlBindings();
let captureAction: ControlActionId | null = null;

function actionInput(action: typeof CONTROL_ACTIONS[number]): BooleanInputKey | undefined {
  return 'input' in action ? action.input : undefined;
}

function defaultBindings(): ControlBindings {
  const out = {} as ControlBindings;
  for (const action of CONTROL_ACTIONS) out[action.id] = [...action.defaultKeys];
  return out;
}

function actionDef(actionId: ControlActionId): typeof CONTROL_ACTIONS[number] | undefined {
  return CONTROL_ACTIONS.find(def => def.id === actionId);
}

export function controlActionLocked(actionId: ControlActionId): boolean {
  void actionId;
  return false;
}

function codeAssignableTo(actionId: ControlActionId, code: string): boolean {
  if (!actionDef(actionId)) return false;
  if (typeof code !== 'string' || code.length < 2 || code.length > 32) return false;
  if (code === '__proto__' || code === 'constructor' || code === 'prototype') return false;
  return true;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function uniqueCodes(codes: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of codes) {
    if (typeof raw !== 'string' || raw.length < 2 || raw.length > 32) continue;
    if (!out.includes(raw)) out.push(raw);
    if (out.length >= MAX_BINDINGS_PER_ACTION) break;
  }
  return out;
}

function sanitizeCodesForAction(actionId: ControlActionId, codes: readonly unknown[]): string[] {
  const action = actionDef(actionId);
  if (!action) return [];
  return uniqueCodes(codes).filter(code => codeAssignableTo(action.id, code));
}

function normalizeBindings(raw: unknown): ControlBindings {
  const out = defaultBindings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const action of CONTROL_ACTIONS) {
    if (Object.prototype.hasOwnProperty.call(src, action.id)) {
      const codes = src[action.id];
      if (Array.isArray(codes)) out[action.id] = sanitizeCodesForAction(action.id, codes);
    }
  }
  return out;
}

function loadControlBindings(): ControlBindings {
  const s = storage();
  if (!s) return defaultBindings();
  try {
    return normalizeBindings(safeParseJson(s.getItem(CONTROL_STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultBindings();
  }
}

function saveControlBindings(): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(CONTROL_STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Local storage can be blocked. The current in-memory bindings still work.
  }
}

export function keyCodeLabel(code: string): string {
  if (Object.prototype.hasOwnProperty.call(CODE_LABELS, code)) return CODE_LABELS[code];
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

export function controlBindings(actionId: ControlActionId): readonly string[] {
  return bindings[actionId] ?? [];
}

export function controlBindingLabel(actionId: ControlActionId): string {
  const codes = controlBindings(actionId);
  return codes.length > 0 ? codes.map(keyCodeLabel).join(' / ') : '—';
}

export function controlHint(actionId: ControlActionId): string {
  return `[${controlBindingLabel(actionId)}]`;
}

export function matchesControlAction(actionId: ControlActionId, code: string): boolean {
  return controlBindings(actionId).includes(code);
}

export function applyControlCode(input: InputState, code: string, pressed: boolean): boolean {
  let matched = false;
  for (const action of CONTROL_ACTIONS) {
    const key = actionInput(action);
    if (!key || !matchesControlAction(action.id, code)) continue;
    if (action.id === 'interact') {
      input.interact = pressed ? !input.interactHeld : false;
      input.interactHeld = pressed;
      matched = true;
      continue;
    }
    input[key] = pressed;
    matched = true;
  }
  return matched;
}

export function clearControlInputs(input: InputState): void {
  const cleared: Partial<Record<BooleanInputKey, true>> = {};
  for (const action of CONTROL_ACTIONS) {
    const key = actionInput(action);
    if (!key || cleared[key]) continue;
    input[key] = false;
    cleared[key] = true;
  }
  input.interactHeld = false;
  input.controlEdit = false;
  input.controlReset = false;
  input.controlClose = false;
  input.menuAccept = false;
  input.menuClose = false;
  input.menuWheel = 0;
}

export function setControlPrimaryBinding(actionId: ControlActionId, code: string): boolean {
  if (!codeAssignableTo(actionId, code)) return false;
  const next = bindings[actionId] ?? [];
  if (!next.includes(code)) {
    if (next.length >= MAX_BINDINGS_PER_ACTION) next.shift();
    next.push(code);
  }
  bindings[actionId] = next;
  saveControlBindings();
  return true;
}

export function clearControlBinding(actionId: ControlActionId): boolean {
  if (!actionDef(actionId)) return false;
  bindings[actionId] = [];
  saveControlBindings();
  return true;
}

export function resetAllControlBindings(): void {
  bindings = defaultBindings();
  saveControlBindings();
}

export function beginControlCapture(actionId: ControlActionId): void {
  captureAction = actionId;
}

export function cancelControlCapture(): void {
  captureAction = null;
}

export function getControlCaptureAction(): ControlActionId | null {
  return captureAction;
}

export function consumeControlCaptureCode(code: string): boolean {
  if (!captureAction) return false;
  const actionId = captureAction;
  captureAction = null;
  if (!codeAssignableTo(actionId, code)) return true;
  setControlPrimaryBinding(actionId, code);
  return true;
}
