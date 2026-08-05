import type { WorldEventType } from '../core/types';

export const DEMOS_POST_RING_CAP = 48;
export const DEMOS_POST_ARGS_CAP = 6;
export const DEMOS_POST_ARG_MAX_CHARS = 80;
export const DEMOS_POST_TAGS_CAP = 8;
export const DEMOS_POST_TAG_MAX_CHARS = 32;
export const DEMOS_POST_TEXT_MAX_CHARS = 180;
export const DEMOS_AUTHOR_FALLBACK_CAP = 8;
export const DEMOS_REACTIONS_PER_POST_CAP = 4;
export const DEMOS_PERSISTENT_POST_CAP = 512;
export const DEMOS_PERSISTENT_REACTION_CAP = 2048;
export const DEMOS_RELATION_OVERRIDE_CAP = 8192;
export const DEMOS_POST_MENTIONS_CAP = 4;
export const DEMOS_PERSISTENT_POST_ARG_MAX_CHARS = 48;

export const DEMOS_EDGE_FAMILY = 1 << 0;
export const DEMOS_EDGE_FRIEND = 1 << 1;
export const DEMOS_EDGE_ENEMY = 1 << 2;
export const DEMOS_EDGE_WORK = 1 << 3;
export const DEMOS_EDGE_FACTION = 1 << 4;
export const DEMOS_EDGE_DEBT = 1 << 5;
export const DEMOS_EDGE_QUEST = 1 << 6;
export const DEMOS_EDGE_HIDDEN = 1 << 7;

export type DemosPostDomain =
  | 'death'
  | 'theft'
  | 'shortage'
  | 'production'
  | 'samosbor'
  | 'migration'
  | 'quest'
  | 'faction'
  | 'generic';

export type DemosPostArgName = 'actor' | 'target' | 'item' | 'place' | 'event' | 'detail';
export type DemosPostPrivacy = 'public' | 'local' | 'friends' | 'faction' | 'private';

export interface DemosPostTemplateDef {
  id: string;
  domain: DemosPostDomain;
  eventTypes: readonly WorldEventType[];
  argNames: readonly DemosPostArgName[];
  tags: readonly string[];
  fallbacks: readonly string[];
}

export type DemosReactionKind =
  | 'like'
  | 'dislike'
  | 'fear'
  | 'anger'
  | 'grief'
  | 'joke'
  | 'help'
  | 'threat'
  | 'rumor';

export interface DemosReactionTemplateDef {
  id: string;
  kind: DemosReactionKind;
  tags: readonly string[];
  fallbacks: readonly string[];
}

export const DEMOS_POST_TEMPLATES: readonly DemosPostTemplateDef[] = [
  {
    id: 'demos_post_death_corridor',
    domain: 'death',
    eventTypes: ['npc_kill_npc', 'player_kill_npc', 'death_seen'],
    argNames: ['actor', 'target', 'place', 'detail'],
    tags: ['death', 'danger', 'witness'],
    fallbacks: [
      '{target} не дошел до {place}. Кто видел {actor}, пишите в Демос, а не орите у гермы.',
      'По {place} прошла смерть: {target}. Записал {actor}. {detail}',
      '{target} пропал после шума в {place}. {actor}, если это твоя смена, отметься.',
    ],
  },
  {
    id: 'demos_post_monster_kill',
    domain: 'death',
    eventTypes: ['npc_kill_monster', 'player_kill_monster', 'fog_boss_killed'],
    argNames: ['actor', 'target', 'place', 'detail'],
    tags: ['death', 'monster', 'lead'],
    fallbacks: [
      '{actor} завалил тварь у {place}. Не геройствуйте, сначала проверьте патроны и дверь.',
      'У {place} стало тише: {actor} снял {target}. {detail}',
      '{target} больше не ходит у {place}. Спасибо {actor}, но кровь с пола сами мойте.',
    ],
  },
  {
    id: 'demos_post_theft_item',
    domain: 'theft',
    eventTypes: ['item_stolen', 'container_looted', 'ration_coupon_stolen'],
    argNames: ['actor', 'item', 'place', 'detail'],
    tags: ['theft', 'item', 'debt'],
    fallbacks: [
      'У {place} пропало: {item}. {actor}, если это ты, верни до обхода.',
      'Опять крысятник: {item} ушло из {place}. {detail}',
      '{actor} светился рядом с {place}, потом исчез {item}. Демос все помнит по журналу.',
    ],
  },
  {
    id: 'demos_post_shortage',
    domain: 'shortage',
    eventTypes: ['room_lacked_resources', 'room_blocked_production'],
    argNames: ['item', 'place', 'detail'],
    tags: ['shortage', 'work', 'queue'],
    fallbacks: [
      'В {place} не хватает {item}. Очередь не ругайте, несите руками.',
      '{item} закончился у {place}. {detail}',
      'Кто держит {item}, занесите в {place}; смена стоит, люди злые.',
    ],
  },
  {
    id: 'demos_post_production',
    domain: 'production',
    eventTypes: ['room_produced_items', 'item_deposited'],
    argNames: ['item', 'place', 'detail'],
    tags: ['production', 'work', 'supply'],
    fallbacks: [
      'В {place} подвезли {item}. Берите по делу, не устраивайте базар.',
      '{place} выдал {item}. {detail}',
      'Смена закрыла заявку: {item} теперь есть в {place}.',
    ],
  },
  {
    id: 'demos_post_samosbor',
    domain: 'samosbor',
    eventTypes: ['samosbor_warning', 'samosbor_started', 'samosbor_zone_captured', 'samosbor_ended'],
    argNames: ['place', 'detail'],
    tags: ['samosbor', 'danger', 'shelter'],
    fallbacks: [
      'По {place} Самосбор. Без нужды из убежища не выходите. {detail}',
      'Сирена прошла по {place}. Проверьте воду, дверь и своих.',
      '{place} после Самосбора: отметьтесь, кто живой и кому нужен бинт.',
    ],
  },
  {
    id: 'demos_post_migration',
    domain: 'migration',
    eventTypes: ['alife_migration', 'floor_transition'],
    argNames: ['actor', 'place', 'detail'],
    tags: ['migration', 'route', 'arrival'],
    fallbacks: [
      '{actor} сменил маршрут через {place}. Не путайте с пропажей, запись в журнале есть.',
      'Переход отмечен: {actor}, {place}. {detail}',
      '{actor} ушел через {place}. Если должен чайник, напомните ему в личку потом.',
    ],
  },
  {
    id: 'demos_post_quest',
    domain: 'quest',
    eventTypes: ['quest_created', 'quest_completed', 'quest_failed', 'contract_created', 'contract_completed', 'contract_failed'],
    argNames: ['actor', 'target', 'place', 'detail'],
    tags: ['quest', 'work', 'lead'],
    fallbacks: [
      'По заявке у {place}: {target}. Ответственный {actor}. {detail}',
      '{actor} отметил дело в Демосе: {target}, место {place}.',
      'Заявка двинулась: {target}. Кто рядом с {place}, проверьте доску.',
    ],
  },
  {
    id: 'demos_post_faction',
    domain: 'faction',
    eventTypes: ['faction_event', 'faction_patrol_clash', 'faction_relation_changed'],
    argNames: ['actor', 'target', 'place', 'detail'],
    tags: ['faction', 'territory', 'warning'],
    fallbacks: [
      'У {place} снова фракционная возня: {actor} и {target}. Без пропуска не лезьте.',
      '{place}: смена отношений, {actor} -> {target}. {detail}',
      'Патрули у {place} нервные. {detail}',
    ],
  },
] as const;

export const DEMOS_REACTION_TEMPLATES: readonly DemosReactionTemplateDef[] = [
  {
    id: 'demos_reaction_like',
    kind: 'like',
    tags: ['reaction', 'warm'],
    fallbacks: [
      'Видел. Нормально сделали.',
      'Записал, это полезно.',
    ],
  },
  {
    id: 'demos_reaction_dislike',
    kind: 'dislike',
    tags: ['reaction', 'cold'],
    fallbacks: [
      'Не нравится мне этот журнал.',
      'Слишком гладко написано. Кто проверял?',
    ],
  },
  {
    id: 'demos_reaction_fear',
    kind: 'fear',
    tags: ['reaction', 'fear'],
    fallbacks: [
      'После такого я дверь на цепочку закрою.',
      'Не ходите туда по одному.',
    ],
  },
  {
    id: 'demos_reaction_grief',
    kind: 'grief',
    tags: ['reaction', 'death', 'warm'],
    fallbacks: [
      'Не трогайте его вещи до родни.',
      'Плохо. Я его со смены знал.',
    ],
  },
  {
    id: 'demos_reaction_anger',
    kind: 'anger',
    tags: ['reaction', 'hostile'],
    fallbacks: [
      'Еще раз так сделаете - разговор будет у гермы.',
      'Запомнил. Долг не водой смоешь.',
    ],
  },
  {
    id: 'demos_reaction_threat',
    kind: 'threat',
    tags: ['reaction', 'hostile', 'threat'],
    fallbacks: [
      'Встретимся в коридоре без свидетелей.',
      'Не радуйся. Двери тут тонкие.',
    ],
  },
  {
    id: 'demos_reaction_help',
    kind: 'help',
    tags: ['reaction', 'help'],
    fallbacks: [
      'Если надо донести воду или бинт, напиши.',
      'Могу подойти после смены.',
    ],
  },
  {
    id: 'demos_reaction_rumor',
    kind: 'rumor',
    tags: ['reaction', 'rumor'],
    fallbacks: [
      'Слышал похожее у лифта, там тоже журнал дергался.',
      'Это не первый случай, спросите кладовщика.',
    ],
  },
  {
    id: 'demos_reaction_joke',
    kind: 'joke',
    tags: ['reaction', 'joke'],
    fallbacks: [
      'Главное, чайник не потеряйте. Чайник дороже нервов.',
      'Очередь теперь будет спорить, кто это предсказывал.',
    ],
  },
] as const;
