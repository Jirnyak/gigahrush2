import { Faction, RoomType } from '../core/types';

export type SlimeId =
  | 'slime_brown'
  | 'slime_green'
  | 'slime_white'
  | 'slime_red'
  | 'slime_black'
  | 'slime_blue'
  | 'slime_silver'
  | 'slime_seroburmaline';

export type SlimeRewardTier = 1 | 2 | 3 | 4 | 5;
export type SlimeRouteChoice = 'deliver' | 'sell' | 'burn' | 'hide' | 'report';

export interface SlimeDef {
  id: SlimeId;
  name: string;
  tags: readonly string[];
  danger: number;
  routeRole: string;
  cleanupHint: string;
  sealedRisk: string;
  unsealedRisk: string;
  sampleId: string;
  rewardTier: SlimeRewardTier;
  preferredFactions: readonly Faction[];
  routeChoices: readonly SlimeRouteChoice[];
  textHandles: readonly string[];
  roomTokens?: readonly string[];
}

export const SLIME_DEFS: readonly SlimeDef[] = [
  {
    id: 'slime_brown',
    name: 'Коричневая слизь',
    tags: ['slime', 'sample', 'residue', 'odor', 'cleanup', 'toxic', 'civilian'],
    danger: 1,
    routeRole: 'Дешёвый токсичный lead: вывести жильцов, оформить акт, затем выбрать журнал НИИ, прожиг, рынок, тайник или рапорт.',
    cleanupHint: 'Токсичный налёт: респиратор, акт зачистки, целая пломба, обход или прожиг до заселения комнаты.',
    sealedRisk: 'Целая коричневая пломба платит мало, но доказывает, где был источник запаха.',
    unsealedRisk: 'Сорванная коричневая пломба быстро становится не образцом, а санитарной претензией к носильщику.',
    sampleId: 'slime_sample_brown',
    rewardTier: 1,
    preferredFactions: [Faction.CITIZEN, Faction.LIQUIDATOR],
    routeChoices: ['deliver', 'sell', 'burn', 'hide', 'report'],
    textHandles: ['slime_brown_cleanup', 'nii_sample_choice_route', 'nii_sample_hide_or_report'],
  },
  {
    id: 'slime_green',
    name: 'Зелёная слизь',
    tags: ['slime', 'sample', 'residue', 'acid', 'organic_damage', 'ovs', 'science'],
    danger: 3,
    routeRole: 'Кислотный containment-check: фильтрующий слой, щипцы и отдельная тара важнее цены.',
    cleanupHint: 'Кислотная проба ОВС: держать дистанцию, брать щипцами, нейтрализовать щёлочью и не класть к ткани.',
    sealedRisk: 'Целая зелёная банка опасна для ткани и еды, зато НИИ принимает её как чистый ОВС-факт.',
    unsealedRisk: 'Вскрытая зелёная проба шипит без огня и портит вещи рядом быстрее любого спора.',
    sampleId: 'slime_sample_green',
    rewardTier: 3,
    preferredFactions: [Faction.SCIENTIST, Faction.LIQUIDATOR],
    routeChoices: ['deliver', 'burn', 'report'],
    textHandles: ['slime_green_acid_sample', 'nii_green_containment'],
    roomTokens: ['зел', 'кисл'],
  },
  {
    id: 'slime_white',
    name: 'Белая слизь',
    tags: ['slime', 'sample', 'residue', 'psi', 'mutagenic', 'no_look', 'compulsion', 'npc_risk'],
    danger: 4,
    routeRole: 'Мутагенный witness-route: доступ, живой свидетель, матовый бокс и выбор между НИИ, рынком, подделкой, тайником или рапортом.',
    cleanupHint: 'Мутагенная проба: не смотреть, не ставить под лампу, закрыть матовым боксом и вывести свидетелей.',
    sealedRisk: 'Целая белая проба ценна только пока её не разглядывают при людях.',
    unsealedRisk: 'Кривая белая пломба превращает награду в карантинный рапорт и чужие голоса в коридоре.',
    sampleId: 'slime_sample_white',
    rewardTier: 4,
    preferredFactions: [Faction.SCIENTIST, Faction.CULTIST],
    routeChoices: ['deliver', 'sell', 'hide', 'report'],
    textHandles: ['slime_white_look_away', 'lead_living_white_sample_shift', 'nii_white_unsealed_report'],
    roomTokens: ['бел'],
  },
  {
    id: 'slime_red',
    name: 'Красная слизь',
    tags: ['slime', 'sample', 'residue', 'sticky', 'slow', 'trap'],
    danger: 3,
    routeRole: 'Липкий route-control: красная зона замедляет, делает ловушку и покупается теми, кто готовит проход заранее.',
    cleanupHint: 'Обходить липкую зону по краю; огонь или растворитель держат проход, пробу брать только после зачистки клеток.',
    sealedRisk: 'Целая красная проба доказывает состав ловушки и годится для контрмер.',
    unsealedRisk: 'Открытая красная проба липнет к рюкзаку, двери и следу, по которому потом находят носильщика.',
    sampleId: 'slime_sample_red',
    rewardTier: 3,
    preferredFactions: [Faction.LIQUIDATOR, Faction.WILD],
    routeChoices: ['sell', 'burn', 'hide', 'report'],
    textHandles: ['slime_red_sticky_residue', 'nii_red_trap_residue'],
  },
  {
    id: 'slime_black',
    name: 'Чёрная слизь',
    tags: ['slime', 'sample', 'residue', 'mass', 'spawn_risk', 'cult', 'uv'],
    danger: 4,
    routeRole: 'Массовая spawn-risk проба: сначала УФ/герметик, потом банка, затем НИИ, прожиг, рынок или донос.',
    cleanupHint: 'Чёрная масса плодит угрозы: герметизировать, светить УФ или жечь; культ и курилку рядом не оставлять.',
    sealedRisk: 'Целая чёрная пломба удерживает массу до УФ-поста и повышает цену НИИ.',
    unsealedRisk: 'Тёплая чёрная банка уже не одиночная проба: рядом появляются глаза, культ и повод для прожига.',
    sampleId: 'slime_sample_black',
    rewardTier: 4,
    preferredFactions: [Faction.SCIENTIST, Faction.LIQUIDATOR, Faction.CULTIST],
    routeChoices: ['deliver', 'sell', 'burn', 'report'],
    textHandles: ['slime_black_uv_sample', 'lead_maint_black_slime_false_jar', 'betonov_black_burn_order'],
    roomTokens: ['черн'],
  },
  {
    id: 'slime_blue',
    name: 'Голубая слизь',
    tags: ['slime', 'sample', 'residue', 'glow', 'energy', 'radiation_fear'],
    danger: 3,
    routeRole: 'Световой energy-scare образец: гермобокс, экранирование, лампы и оплата за целую ампулу.',
    cleanupHint: 'Голубую пробу экранировать контейнером, не носить рядом с лампами и щитками.',
    sealedRisk: 'Целая голубая ампула светит через ткань, но остаётся результатом, а не ожогом.',
    unsealedRisk: 'Открытый голубой свет оформляют как повреждение тары и руки, а не как научную добычу.',
    sampleId: 'slime_sample_blue',
    rewardTier: 3,
    preferredFactions: [Faction.SCIENTIST, Faction.LIQUIDATOR],
    routeChoices: ['deliver', 'burn', 'report'],
    textHandles: ['slime_blue_glow_sample', 'lead_maint_blue_glow_hermobox'],
  },
  {
    id: 'slime_silver',
    name: 'Прозрачная слизь',
    tags: ['slime', 'sample', 'residue', 'transparent', 'deceptive_value', 'temptation', 'relief', 'contraband'],
    danger: 5,
    routeRole: 'Обманчиво ценная temptation-route: легальный НИИ беднее рынка, вскрытие портит цену и запускает слух.',
    cleanupHint: 'Обманчиво ценная прозрачная проба: не пробовать, не вскрывать, сдавать только запечатанной или держать как улику.',
    sealedRisk: 'Целая прозрачная пломба стоит дорого именно потому, что банка выглядит почти пустой.',
    unsealedRisk: 'Открытая прозрачная проба даёт эффект сейчас и подозрение потом: товар дешевеет, объяснение дорожает.',
    sampleId: 'slime_sample_silver',
    rewardTier: 5,
    preferredFactions: [Faction.WILD, Faction.CULTIST, Faction.SCIENTIST],
    routeChoices: ['deliver', 'sell', 'hide', 'report'],
    textHandles: ['slime_silver_sealed_trade', 'silver_slime_science_handoff', 'market88_nii_receipt_silver'],
  },
  {
    id: 'slime_seroburmaline',
    name: 'Серобурмалиновая слизь',
    tags: ['slime', 'sample', 'residue', 'visual_risk', 'cognitive_risk', 'void'],
    danger: 5,
    routeRole: 'No-look void route: проба берётся по памяти, маршрут важнее взгляда, награда платит за дисциплину.',
    cleanupHint: 'Не смотреть на перелив, закрыть метки, идти по заранее отмеченному маршруту и сдавать без демонстрации.',
    sealedRisk: 'Целая серобурмалиновая тара доказывает, что носильщик не проверял перелив глазами.',
    unsealedRisk: 'Сорванная пломба на серобурмалине означает спор с банкой, который уже проигран в протоколе.',
    sampleId: 'slime_sample_seroburmaline',
    rewardTier: 5,
    preferredFactions: [Faction.SCIENTIST, Faction.CULTIST],
    routeChoices: ['deliver', 'hide', 'report'],
    textHandles: ['slime_seroburmaline_no_look', 'lead_void_seroburmaline_blind_sample'],
  },
];

export const SLIME_IDS: readonly SlimeId[] = SLIME_DEFS.map(def => def.id);
export const SLIME_SAMPLE_IDS: readonly string[] = SLIME_DEFS.map(def => def.sampleId);
export const SLIME_DEF_BY_ID = Object.fromEntries(SLIME_DEFS.map(def => [def.id, def])) as Record<SlimeId, SlimeDef>;
export const SLIME_DEF_BY_SAMPLE_ID: Record<string, SlimeDef> = Object.fromEntries(SLIME_DEFS.map(def => [def.sampleId, def]));

const SLIME_ROOM_CORE_TOKENS = ['слиз', 'остат', 'проб'] as const;
const SLIME_ROOM_FEED_TOKENS = ['гриб', 'самосбор'] as const;

function hasAnyToken(text: string, tokens: readonly string[]): boolean {
  return tokens.some(token => text.includes(token));
}

export function slimeDefForRoomName(roomName: string): SlimeDef {
  const name = roomName.toLowerCase();
  let best: SlimeDef | undefined;
  let bestScore = 0;
  for (const def of SLIME_DEFS) {
    const tokens = def.roomTokens ?? [];
    let score = 0;
    for (const token of tokens) {
      if (name.includes(token)) score += 10 + def.rewardTier;
    }
    if (score > bestScore) {
      best = def;
      bestScore = score;
    }
  }
  return best ?? SLIME_DEF_BY_ID.slime_brown;
}

export function slimeSampleIdForRoomName(roomName: string): string {
  return slimeDefForRoomName(roomName).sampleId;
}

export function slimeRoomAttractionWeight(roomName: string, roomType: RoomType): number {
  const name = roomName.toLowerCase();
  let weight = 0;
  if (hasAnyToken(name, SLIME_ROOM_CORE_TOKENS)) weight += 8;
  if (hasAnyToken(name, SLIME_ROOM_FEED_TOKENS)) weight += 4;
  const colored = slimeDefForRoomName(name);
  if (colored.id !== 'slime_brown') weight += Math.min(4, colored.danger);
  if (roomType === RoomType.PRODUCTION || roomType === RoomType.BATHROOM) weight += 1;
  return weight;
}

function duplicateStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates].sort();
}

export function getSlimeDef(id: string): SlimeDef | undefined {
  return SLIME_DEF_BY_ID[id as SlimeId];
}

export function getSlimeDefBySampleId(sampleId: string): SlimeDef | undefined {
  return SLIME_DEF_BY_SAMPLE_ID[sampleId];
}

export function validateSlimeDefs(): string[] {
  const problems: string[] = [];
  for (const id of duplicateStrings(SLIME_IDS)) problems.push(`duplicate slime id:${id}`);
  for (const id of duplicateStrings(SLIME_SAMPLE_IDS)) problems.push(`duplicate slime sample id:${id}`);

  for (const def of SLIME_DEFS) {
    if (!def.tags.includes('slime')) problems.push(`${def.id}:missing slime tag`);
    if (!def.tags.includes('sample')) problems.push(`${def.id}:missing sample tag`);
    if (!Number.isInteger(def.danger) || def.danger < 1 || def.danger > 5) problems.push(`${def.id}:danger:${def.danger}`);
    if (!Number.isInteger(def.rewardTier) || def.rewardTier < 1 || def.rewardTier > 5) problems.push(`${def.id}:rewardTier:${def.rewardTier}`);
    if (def.cleanupHint.trim().length < 12) problems.push(`${def.id}:cleanupHint`);
    if (def.routeRole.trim().length < 12) problems.push(`${def.id}:routeRole`);
    if (def.sealedRisk.trim().length < 12) problems.push(`${def.id}:sealedRisk`);
    if (def.unsealedRisk.trim().length < 12) problems.push(`${def.id}:unsealedRisk`);
    if (def.sampleId.trim().length === 0) problems.push(`${def.id}:sampleId`);
    if (def.preferredFactions.length === 0) problems.push(`${def.id}:preferredFactions`);
    if (def.routeChoices.length === 0) problems.push(`${def.id}:routeChoices`);
    if (def.textHandles.length === 0) problems.push(`${def.id}:textHandles`);
    for (const token of def.roomTokens ?? []) {
      if (token.trim().length === 0) problems.push(`${def.id}:roomTokens`);
    }
  }

  return problems;
}
