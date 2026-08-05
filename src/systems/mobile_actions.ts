import { type InputState } from '../core/types';

export type MobileMenuId = 'inventory' | 'map' | 'quests' | 'log' | 'factions' | 'net' | 'menu' | 'ui' | 'debug';

export interface MobileText {
  ru: string;
  en: string;
}

export interface MobileActionBase {
  label: MobileText;
  ariaLabel: MobileText;
}

export interface MobileMenuAction extends MobileActionBase {
  kind: 'menu';
  id: MobileMenuId;
}

export type BooleanInputKey = {
  [K in keyof InputState]: InputState[K] extends boolean ? K : never;
}[keyof InputState];

export interface MobileInputAction extends MobileActionBase {
  kind: 'input';
  input: BooleanInputKey;
  hold?: boolean;
}

export type MobileAction = MobileMenuAction | MobileInputAction;

export const MOBILE_ACTIONS: readonly MobileAction[] = [
  { kind: 'menu', id: 'inventory', label: { ru: 'ИНВ', en: 'INV' }, ariaLabel: { ru: 'Открыть инвентарь', en: 'Open inventory' } },
  { kind: 'menu', id: 'map', label: { ru: 'КАРТ', en: 'MAP' }, ariaLabel: { ru: 'Открыть карту', en: 'Open map' } },
  { kind: 'menu', id: 'quests', label: { ru: 'ЗАД', en: 'QUEST' }, ariaLabel: { ru: 'Открыть задания', en: 'Open quests' } },
  { kind: 'menu', id: 'log', label: { ru: 'ЛОГ', en: 'LOG' }, ariaLabel: { ru: 'Открыть журнал сообщений', en: 'Open message log' } },
  { kind: 'menu', id: 'factions', label: { ru: 'ФРАК', en: 'FACT' }, ariaLabel: { ru: 'Открыть фракции', en: 'Open factions' } },
  { kind: 'menu', id: 'net', label: { ru: 'НЕТ', en: 'NET' }, ariaLabel: { ru: 'Открыть НЕТ-СФЕРУ', en: 'Open Net Sphere' } },
  { kind: 'menu', id: 'menu', label: { ru: 'МЕНЮ', en: 'MENU' }, ariaLabel: { ru: 'Открыть меню сохранения', en: 'Open save menu' } },
  { kind: 'menu', id: 'ui', label: { ru: 'UI', en: 'UI' }, ariaLabel: { ru: 'Открыть настройку UI', en: 'Open UI settings' } },
  { kind: 'input', input: 'attack', hold: true, label: { ru: 'БОЙ', en: 'FIRE' }, ariaLabel: { ru: 'Атака', en: 'Attack' } },
  { kind: 'input', input: 'interact', hold: true, label: { ru: 'ДЕЙСТ', en: 'ACT' }, ariaLabel: { ru: 'Взаимодействие', en: 'Interact' } },
  { kind: 'input', input: 'use', hold: true, label: { ru: 'ИНСТР', en: 'TOOL' }, ariaLabel: { ru: 'Использовать инструмент', en: 'Use tool' } },
  { kind: 'input', input: 'sleep', hold: true, label: { ru: 'СОН', en: 'SLEEP' }, ariaLabel: { ru: 'Спать, удерживать', en: 'Sleep, hold' } },
  { kind: 'input', input: 'pee', hold: true, label: { ru: 'ПИС', en: 'PEE' }, ariaLabel: { ru: 'Пописать', en: 'Pee' } },
  { kind: 'input', input: 'controls', label: { ru: 'КЛАВ', en: 'KEYS' }, ariaLabel: { ru: 'Открыть экран клавиш', en: 'Open controls screen' } },
  { kind: 'input', input: 'drop', label: { ru: 'СБР', en: 'DROP' }, ariaLabel: { ru: 'Выбросить или перенести вправо', en: 'Drop or move right' } },
  { kind: 'input', input: 'attrStr', label: { ru: 'СИЛ', en: 'STR' }, ariaLabel: { ru: 'Очко в силу', en: 'Spend point on strength' } },
  { kind: 'input', input: 'attrAgi', label: { ru: 'ЛОВ', en: 'AGI' }, ariaLabel: { ru: 'Очко в ловкость', en: 'Spend point on agility' } },
  { kind: 'input', input: 'attrInt', label: { ru: 'ИНТ', en: 'INT' }, ariaLabel: { ru: 'Очко в интеллект', en: 'Spend point on intellect' } },
  { kind: 'menu', id: 'debug', label: { ru: 'ОТЛ', en: 'DBG' }, ariaLabel: { ru: 'Открыть отладочное меню', en: 'Open debug menu' } },
];

export interface MobileButtonControlRow {
  group: string;
  label: string;
  binding: string;
}

export const MOBILE_BUTTON_CONTROL_ROWS: readonly MobileButtonControlRow[] = [
  { group: 'Тач', label: 'Левый стик', binding: 'Ходьба' },
  { group: 'Тач', label: 'Правый стик', binding: 'Камера' },
  { group: 'Тач', label: 'ДЕЙСТ', binding: 'Взаимодействие в мире' },
  { group: 'Тач', label: 'Правая зона', binding: 'Атака / выстрел' },
  { group: 'Тач', label: 'FULL/PAGE', binding: 'Полный экран / отдельная страница' },
  { group: 'Рельса', label: 'Вверх / вниз', binding: 'Выбор действия или строки меню' },
  ...MOBILE_ACTIONS.map(action => ({
    group: action.kind === 'menu' ? 'Рельса: меню' : 'Рельса: действие',
    label: action.label.ru,
    binding: action.ariaLabel.ru,
  })),
];
