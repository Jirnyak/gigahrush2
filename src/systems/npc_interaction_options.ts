import { openArena } from './arena';
import { EntityType, msg, type Entity, type GameState } from '../core/types';
import { craftRecipeSourcesForNpc, type CraftRecipeSourceDef } from '../data/craft_recipe_sources';
import {
  allDesignFloorProfiles,
  type DesignFloorNpcInteractionProfile,
  type DesignFloorNpcPredicateProfile,
} from '../data/design_floor_profiles';
import { craftRecipeLearnedMessage, isCraftRecipeKnown, learnCraftRecipe } from './crafting';
import { closeDiceGame, diceStakeFromNpc, startDiceGame } from './dice';
import { closeDominoGame, dominoStakeFromNpc, startDominoGame } from './domino';
import { closeCheckersGame, checkersStakeFromNpc, startCheckersGame } from './checkers';
import { closeDurakGame, durakStakeFromNpc, startDurakGame } from './durak';
import { canOpenDemosProfileForNpc, demosCursorForNpcProfile } from './demos_profiles';
import { portalAllowsCasinoLikeContent } from './platform_bridge';
import { currentFloorRunEntry } from './procedural_floors';
import { npcHasQuestMarker } from './quests';
import { controlBindingLabel } from './controls';

export const CARD_DECK_ITEM_ID = 'card_deck';
export const DICE_BONE_ITEM_ID = 'dice_bone';
export const DOMINO_BOX_ITEM_ID = 'domino_box';
export const CHECKERS_BOARD_ITEM_ID = 'checkers_board';
export const NPC_MENU_INTERFACE_TAB = 'interface';

export interface NpcInteractionContext {
  state: GameState;
  player: Entity;
  npc: Entity;
  entities?: readonly Entity[];
}

export interface NpcMenuOption {
  id: string;
  label: string;
  order: number;
  disabled?: boolean;
  disabledReason?: string;
}

export interface NpcInteractionInterfaceSnapshot {
  open: boolean;
  id: string;
  title: string;
  npcId: number;
  npcName: string;
  lines: readonly string[];
  priceRubles?: number;
  stakeRubles?: number;
  message: string;
}

export interface NpcInteractionInterfaceRequest {
  id: string;
  title: string;
  lines: readonly string[];
  priceRubles?: number;
  stakeRubles?: number;
  message?: string;
}

export interface NpcInteractionOptionDef {
  id: string;
  order: number;
  label: (ctx: NpcInteractionContext) => string;
  visible: (ctx: NpcInteractionContext) => boolean;
  disabledReason?: (ctx: NpcInteractionContext) => string | undefined;
  activate: (ctx: NpcInteractionContext) => void;
}

interface NpcRecipeLesson {
  source: CraftRecipeSourceDef;
  recipeId: string;
}

const customOptions: NpcInteractionOptionDef[] = [];
const BUILTIN_MENU_OPTIONS = [
  { id: 'talk', label: 'Говорить', order: 0 },
  { id: 'quest', label: 'Задание', questMarkerLabel: 'Задание !', order: 10 },
  { id: 'trade', label: 'Торг', order: 20 },
  { id: 'leave', label: 'Уйти', order: 9000 },
] as const;

const runtime: NpcInteractionInterfaceSnapshot = {
  open: false,
  id: '',
  title: '',
  npcId: -1,
  npcName: '',
  lines: [],
  message: '',
};

function cleanMoney(actor: Entity): number {
  const money = actor.money ?? 0;
  return Number.isFinite(money) ? Math.max(0, Math.floor(money)) : 0;
}

function countItem(actor: Entity, defId: string): number {
  let count = 0;
  for (const slot of actor.inventory ?? []) {
    if (slot.defId === defId && slot.count > 0) count += slot.count;
  }
  return count;
}

function hasCardDeck(ctx: NpcInteractionContext): boolean {
  return countItem(ctx.player, CARD_DECK_ITEM_ID) > 0 || countItem(ctx.npc, CARD_DECK_ITEM_ID) > 0;
}

function hasDice(ctx: NpcInteractionContext): boolean {
  return countItem(ctx.player, DICE_BONE_ITEM_ID) > 0 || countItem(ctx.npc, DICE_BONE_ITEM_ID) > 0;
}

function hasDominoBox(ctx: NpcInteractionContext): boolean {
  return countItem(ctx.player, DOMINO_BOX_ITEM_ID) > 0 || countItem(ctx.npc, DOMINO_BOX_ITEM_ID) > 0;
}

function hasCheckersBoard(ctx: NpcInteractionContext): boolean {
  return countItem(ctx.player, CHECKERS_BOARD_ITEM_ID) > 0 || countItem(ctx.npc, CHECKERS_BOARD_ITEM_ID) > 0;
}

function durakStake(ctx: NpcInteractionContext): number {
  return durakStakeFromNpc(ctx.npc);
}

function diceStake(ctx: NpcInteractionContext): number {
  return diceStakeFromNpc(ctx.npc);
}

function dominoStake(ctx: NpcInteractionContext): number {
  return dominoStakeFromNpc(ctx.npc);
}

function checkersStake(ctx: NpcInteractionContext): number {
  return checkersStakeFromNpc(ctx.npc);
}

function currentDesignRouteId(state: GameState): string {
  return currentFloorRunEntry(state).designFloorId ?? '';
}

function npcMatchesProfilePredicate(npc: Entity, predicate: DesignFloorNpcPredicateProfile): boolean {
  if (npc.type !== EntityType.NPC || !npc.alive) return false;
  const name = npc.name ?? '';
  if (npc.plotNpcId && predicate.plotNpcIds?.includes(npc.plotNpcId)) return true;
  if (predicate.exactNames?.includes(name)) return true;
  if (predicate.namePrefixes?.some(prefix => name.startsWith(prefix))) return true;
  if (npc.npcVisualId && predicate.npcVisualIds?.includes(npc.npcVisualId)) return true;
  return false;
}

function designFloorInteractionVisible(
  routeId: string,
  option: DesignFloorNpcInteractionProfile,
  ctx: NpcInteractionContext,
): boolean {
  if (option.requiresCasinoLikePortalAllowance && !portalAllowsCasinoLikeContent()) return false;
  return currentDesignRouteId(ctx.state) === routeId && npcMatchesProfilePredicate(ctx.npc, option.npcPredicate);
}

function designFloorInteractionLabel(option: DesignFloorNpcInteractionProfile): string {
  return option.priceRubles !== undefined ? `${option.label} (₽${option.priceRubles})` : option.label;
}

function designFloorInteractionDisabledReason(
  option: DesignFloorNpcInteractionProfile,
  ctx: NpcInteractionContext,
): string | undefined {
  const price = option.priceRubles ?? 0;
  if (price > 0 && cleanMoney(ctx.player) < price) return `Нужно ₽${price}.`;
  return undefined;
}

function formatDesignFloorInteractionLine(
  line: string,
  option: DesignFloorNpcInteractionProfile,
  ctx: NpcInteractionContext,
): string {
  return line
    .replace(/\{npc\}/g, ctx.npc.name ?? 'NPC')
    .replace(/\{price\}/g, String(option.priceRubles ?? 0));
}

function openDesignFloorInteraction(option: DesignFloorNpcInteractionProfile, ctx: NpcInteractionContext): void {
  openNpcInteractionInterface(ctx, {
    id: option.id,
    title: option.title,
    priceRubles: option.priceRubles,
    lines: option.lines.map(line => formatDesignFloorInteractionLine(line, option, ctx)),
    message: option.message,
  });
}

function hashString32(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

function npcRecipeLessonKey(npc: Entity): string {
  return [
    npc.persistentNpcId ?? '',
    npc.plotNpcId ?? '',
    Number.isFinite(npc.alifeId) ? String(npc.alifeId) : '',
    String(npc.id),
    npc.name ?? '',
    npc.occupation ?? '',
    npc.faction ?? '',
  ].join('|');
}

function npcRecipeLesson(ctx: NpcInteractionContext): NpcRecipeLesson | undefined {
  const choices: NpcRecipeLesson[] = [];
  for (const source of craftRecipeSourcesForNpc(ctx.npc)) {
    for (const recipeId of source.recipeIds) choices.push({ source, recipeId });
  }
  if (choices.length === 0) return undefined;
  const lesson = choices[hashString32(npcRecipeLessonKey(ctx.npc)) % choices.length];
  return lesson && !isCraftRecipeKnown(ctx.state, lesson.recipeId) ? lesson : undefined;
}

export function registerNpcInteractionOption(def: NpcInteractionOptionDef): void {
  if (customOptions.some(existing => existing.id === def.id)) return;
  customOptions.push(def);
  customOptions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function menuOptionOrderCompare(aOrder: number, aId: string, bOrder: number, bId: string): number {
  return aOrder - bOrder || aId.localeCompare(bId);
}

function pushBuiltinMenuOption(options: NpcMenuOption[], ctx: NpcInteractionContext, index: number): void {
  const def = BUILTIN_MENU_OPTIONS[index];
  if (!def) return;
  const label = def.id === 'quest' && npcHasQuestMarker(ctx.npc, ctx.state) ? def.questMarkerLabel : def.label;
  options.push({ id: def.id, label, order: def.order });
}

export function getNpcMenuOptions(ctx: NpcInteractionContext): NpcMenuOption[] {
  const options: NpcMenuOption[] = [];
  let builtinIndex = 0;
  for (const def of customOptions) {
    if (!def.visible(ctx)) continue;
    while (builtinIndex < BUILTIN_MENU_OPTIONS.length) {
      const builtin = BUILTIN_MENU_OPTIONS[builtinIndex];
      if (menuOptionOrderCompare(builtin.order, builtin.id, def.order, def.id) > 0) break;
      pushBuiltinMenuOption(options, ctx, builtinIndex);
      builtinIndex++;
    }
    const disabledReason = def.disabledReason?.(ctx);
    options.push({
      id: def.id,
      label: def.label(ctx),
      order: def.order,
      disabled: !!disabledReason,
      disabledReason,
    });
  }
  while (builtinIndex < BUILTIN_MENU_OPTIONS.length) {
    pushBuiltinMenuOption(options, ctx, builtinIndex);
    builtinIndex++;
  }
  return options;
}

export function clampNpcMenuSelection(state: GameState, options: readonly NpcMenuOption[]): void {
  state.npcMenuSel = Math.max(0, Math.min(Math.max(0, options.length - 1), state.npcMenuSel));
}

export function npcMenuOptionAt(ctx: NpcInteractionContext, index: number): NpcMenuOption | undefined {
  const options = getNpcMenuOptions(ctx);
  clampNpcMenuSelection(ctx.state, options);
  return options[Math.max(0, Math.min(options.length - 1, index))];
}

export function npcMenuSelectionFor(ctx: NpcInteractionContext, preferredId: string): number {
  const options = getNpcMenuOptions(ctx);
  const index = options.findIndex(option => option.id === preferredId);
  return index >= 0 ? index : 0;
}

export function openNpcInteractionInterface(ctx: NpcInteractionContext, request: NpcInteractionInterfaceRequest): void {
  runtime.open = true;
  runtime.id = request.id;
  runtime.title = request.title;
  runtime.npcId = ctx.npc.id;
  runtime.npcName = ctx.npc.name ?? 'NPC';
  runtime.lines = request.lines.slice(0, 8);
  runtime.priceRubles = request.priceRubles;
  runtime.stakeRubles = request.stakeRubles;
  runtime.message = request.message ?? '';
  ctx.state.showNpcMenu = true;
  ctx.state.npcMenuTab = NPC_MENU_INTERFACE_TAB;
  ctx.state.paused = true;
}

export function closeNpcInteractionInterface(state?: GameState): void {
  closeDurakGame();
  closeDiceGame();
  closeDominoGame();
  closeCheckersGame();
  runtime.open = false;
  runtime.id = '';
  runtime.title = '';
  runtime.npcId = -1;
  runtime.npcName = '';
  runtime.lines = [];
  runtime.priceRubles = undefined;
  runtime.stakeRubles = undefined;
  runtime.message = '';
  if (state?.npcMenuTab === NPC_MENU_INTERFACE_TAB) state.npcMenuTab = 'main';
}

export function isNpcInteractionInterfaceOpen(): boolean {
  return runtime.open;
}

export function getNpcInteractionInterfaceSnapshot(): NpcInteractionInterfaceSnapshot {
  return { ...runtime, lines: [...runtime.lines] };
}

export function activateNpcCustomMenuOption(ctx: NpcInteractionContext, optionId: string): boolean {
  const def = customOptions.find(option => option.id === optionId);
  if (!def || !def.visible(ctx)) return false;
  const disabledReason = def.disabledReason?.(ctx);
  if (disabledReason) {
    ctx.state.msgs.push(msg(disabledReason, ctx.state.time, '#f84'));
    return true;
  }
  def.activate(ctx);
  return true;
}

registerNpcInteractionOption({
  id: 'demos_profile',
  order: 5,
  label: () => 'Профиль Демоса',
  visible: ctx => canOpenDemosProfileForNpc(ctx.npc),
  activate: ctx => {
    const cursor = demosCursorForNpcProfile(ctx.state, ctx.npc);
    if (cursor === undefined) {
      ctx.state.msgs.push(msg('Профиль Демоса не найден.', ctx.state.time, '#888'));
      return;
    }
    closeNpcInteractionInterface(ctx.state);
    ctx.state.showNpcMenu = false;
    ctx.state.showDemos = true;
    ctx.state.demosCursor = cursor;
    ctx.state.demosSearch = '';
    ctx.state.demosSearchActive = false;
    ctx.state.demosTab = 'profile';
    ctx.state.demosFeedScroll = 0;
    ctx.state.demosPostCursor = 0;
  },
});

registerNpcInteractionOption({
  id: 'craft_recipe_lesson',
  order: 25,
  label: () => 'Спросить схему',
  visible: ctx => npcRecipeLesson(ctx) !== undefined,
  activate: ctx => {
    const lesson = npcRecipeLesson(ctx);
    if (!lesson) {
      ctx.state.msgs.push(msg('Рецепт уже известен', ctx.state.time, '#888'));
      return;
    }
    const learned = learnCraftRecipe(ctx.state, lesson.recipeId, lesson.source.id);
    const learnedLines = learned ? [craftRecipeLearnedMessage(lesson.recipeId)] : [];
    for (const line of learnedLines) ctx.state.msgs.push(msg(line, ctx.state.time, '#8cf'));
    openNpcInteractionInterface(ctx, {
      id: 'craft_recipe_lesson',
      title: 'СХЕМА',
      lines: [
        `${ctx.npc.name ?? 'NPC'}: «${lesson.source.text}»`,
        ...learnedLines.slice(0, 4),
      ],
      message: learnedLines.length > 0 ? 'Рецепт записан в журнал крафта.' : 'Рецепт уже известен.',
    });
  },
});

registerNpcInteractionOption({
  id: 'durak',
  order: 30,
  label: ctx => `Играть в дурака (₽${durakStake(ctx)})`,
  visible: ctx => portalAllowsCasinoLikeContent() && hasCardDeck(ctx),
  disabledReason: ctx => {
    const stake = durakStake(ctx);
    if (stake <= 0) return 'У NPC нет денег для ставки.';
    if (cleanMoney(ctx.player) < stake) return `Нужно ₽${stake} для ставки в дурака.`;
    return undefined;
  },
  activate: ctx => {
    const stake = durakStake(ctx);
    if (!startDurakGame(ctx)) {
      ctx.state.msgs.push(msg('Партию в дурака не удалось разложить.', ctx.state.time, '#f84'));
      return;
    }
    openNpcInteractionInterface(ctx, {
      id: 'durak',
      title: 'ДУРАК',
      stakeRubles: stake,
      lines: [
        `${ctx.npc.name ?? 'NPC'} кладет колоду на край стола. Козырь открыт.`,
        `Ставка зафиксирована: 10% от денег NPC, сейчас ₽${stake}.`,
        'Подкидной дурак на двоих, без перевода.',
      ],
      message: 'Деньги переходят только после победы или сдачи.',
    });
  },
});

registerNpcInteractionOption({
  id: 'dice',
  order: 31,
  label: ctx => `Играть в кости (₽${diceStake(ctx)})`,
  visible: ctx => portalAllowsCasinoLikeContent() && hasDice(ctx),
  disabledReason: ctx => {
    const stake = diceStake(ctx);
    if (stake <= 0) return 'У NPC нет денег для ставки.';
    if (cleanMoney(ctx.player) < stake) return `Нужно ₽${stake} для ставки в кости.`;
    return undefined;
  },
  activate: ctx => {
    const stake = diceStake(ctx);
    if (!startDiceGame(ctx)) {
      ctx.state.msgs.push(msg('Кости не легли на стол.', ctx.state.time, '#f84'));
      return;
    }
    openNpcInteractionInterface(ctx, {
      id: 'dice',
      title: 'КОСТИ',
      stakeRubles: stake,
      lines: [
        `${ctx.npc.name ?? 'NPC'} ставит пару костей на бетон.`,
        `Ставка зафиксирована: 10% от денег NPC, сейчас ₽${stake}.`,
        'Бросайте до 21. Перебор проигрывает; равный счет оставляет деньги при себе.',
      ],
      message: `${controlBindingLabel('gameMenu')} бросить, ${controlBindingLabel('drop')} стоп: передать ход NPC.`,
    });
  },
});

registerNpcInteractionOption({
  id: 'domino',
  order: 32,
  label: ctx => `Играть в домино (₽${dominoStake(ctx)})`,
  visible: ctx => portalAllowsCasinoLikeContent() && hasDominoBox(ctx),
  disabledReason: ctx => {
    const stake = dominoStake(ctx);
    if (stake <= 0) return 'У NPC нет денег для ставки.';
    if (cleanMoney(ctx.player) < stake) return `Нужно ₽${stake} для ставки в домино.`;
    return undefined;
  },
  activate: ctx => {
    const stake = dominoStake(ctx);
    if (!startDominoGame(ctx)) {
      ctx.state.msgs.push(msg('Домино не разложилось на столе.', ctx.state.time, '#f84'));
      return;
    }
    openNpcInteractionInterface(ctx, {
      id: 'domino',
      title: 'ДОМИНО',
      stakeRubles: stake,
      lines: [
        `${ctx.npc.name ?? 'NPC'} высыпает костяшки из коробки.`,
        `Ставка зафиксирована: 10% от денег NPC, сейчас ₽${stake}.`,
        'По 7 костяшек. Кладите к совпадающему краю; если хода нет, добирайте из коробки.',
      ],
      message: `${controlBindingLabel('gameMenu')} сыграть/добрать, ${controlBindingLabel('drop')} меняет левый/правый край.`,
    });
  },
});

registerNpcInteractionOption({
  id: 'checkers',
  order: 33,
  label: ctx => `Играть в шашки (₽${checkersStake(ctx)})`,
  visible: ctx => portalAllowsCasinoLikeContent() && hasCheckersBoard(ctx),
  disabledReason: ctx => {
    const stake = checkersStake(ctx);
    if (stake <= 0) return 'У NPC нет денег для ставки.';
    if (cleanMoney(ctx.player) < stake) return `Нужно ₽${stake} для ставки в шашки.`;
    return undefined;
  },
  activate: ctx => {
    const stake = checkersStake(ctx);
    if (!startCheckersGame(ctx)) {
      ctx.state.msgs.push(msg('Шашки не удалось разложить.', ctx.state.time, '#f84'));
      return;
    }
    openNpcInteractionInterface(ctx, {
      id: 'checkers',
      title: 'ШАШКИ',
      stakeRubles: stake,
      lines: [
        `${ctx.npc.name ?? 'NPC'} достает стертую доску и деревянные шашки.`,
        `Ставка зафиксирована: 10% от денег NPC, сейчас ₽${stake}.`,
        'Ходят по диагонали вперед, дамка ходит назад. Взятие обязательно.',
      ],
      message: `${controlBindingLabel('gameMenu')} выбрать/ходить, ${controlBindingLabel('drop')} отмена.`,
    });
  },
});

for (const profile of allDesignFloorProfiles()) {
  for (const option of profile.npcInteractions ?? []) {
    registerNpcInteractionOption({
      id: option.id,
      order: option.order,
      label: () => designFloorInteractionLabel(option),
      visible: ctx => designFloorInteractionVisible(profile.routeId, option, ctx),
      disabledReason: ctx => designFloorInteractionDisabledReason(option, ctx),
      activate: ctx => openDesignFloorInteraction(option, ctx),
    });
  }
}



registerNpcInteractionOption({
  id: 'arena',
  order: 5,
  label: () => 'Арена',
  visible: ctx => ctx.npc.name === 'Мастер Арены' || ctx.npc.name === 'Марко Лоло',
  activate: ctx => {
    openArena(ctx);
  },
});
