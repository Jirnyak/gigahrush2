/* ── World log consumer: structured events → HUD/log strings ──── */

import {
  FloorLevel,
  type GameState,
  type LogEntry,
  type Msg,
  type MsgLocation,
  type WorldEvent,
  MonsterKind,
  type WorldEventType,
  msgAt,
} from "../core/types";

const LOG_MAX = 500;
const DEDUPE_SECONDS = 4;
const FACT_DEDUPE_SCAN = 96;
const TELEMETRY_ONLY = new Set<string>([
  "ammo_consumed",
  "container_opened",
  "rumor_observed",
]);

export interface WorldLogPoint {
  x: number;
  y: number;
}

export interface WorldLogSpatialContext {
  floor: FloorLevel;
  playerX: number;
  playerY: number;
  audibleRadiusMeters?: number;
  dist2: (ax: number, ay: number, bx: number, by: number) => number;
  entityPosition?: (entityId: number) => WorldLogPoint | undefined;
  roomCenter?: (roomId: number) => WorldLogPoint | undefined;
  zoneCenter?: (zoneId: number) => WorldLogPoint | undefined;
}

let spatialContextProvider: () => WorldLogSpatialContext | undefined = () =>
  undefined;

export function setWorldLogSpatialContext(
  context?: WorldLogSpatialContext,
): void {
  spatialContextProvider = () => context;
}

export function setWorldLogSpatialContextProvider(
  provider?: () => WorldLogSpatialContext | undefined,
): void {
  spatialContextProvider = provider ?? (() => undefined);
}

function currentSpatialContext(): WorldLogSpatialContext | undefined {
  try {
    return spatialContextProvider();
  } catch {
    return undefined;
  }
}

function finiteCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function locationPoint(
  location: MsgLocation,
  context: WorldLogSpatialContext,
): WorldLogPoint | undefined {
  if (finiteCoord(location.x) && finiteCoord(location.y))
    return { x: location.x, y: location.y };
  if (Number.isFinite(location.actorId)) {
    const point = context.entityPosition?.(Math.floor(location.actorId!));
    if (point && finiteCoord(point.x) && finiteCoord(point.y)) return point;
  }
  if (Number.isFinite(location.targetId)) {
    const point = context.entityPosition?.(Math.floor(location.targetId!));
    if (point && finiteCoord(point.x) && finiteCoord(point.y)) return point;
  }
  if (Number.isFinite(location.roomId)) {
    const point = context.roomCenter?.(Math.floor(location.roomId!));
    if (point && finiteCoord(point.x) && finiteCoord(point.y)) return point;
  }
  if (Number.isFinite(location.zoneId)) {
    const point = context.zoneCenter?.(Math.floor(location.zoneId!));
    if (point && finiteCoord(point.x) && finiteCoord(point.y)) return point;
  }
  return undefined;
}

function locationHasSource(location: MsgLocation): boolean {
  return (
    finiteCoord(location.x) ||
    finiteCoord(location.y) ||
    Number.isFinite(location.actorId) ||
    Number.isFinite(location.targetId) ||
    Number.isFinite(location.roomId) ||
    Number.isFinite(location.zoneId)
  );
}

export function worldLogDistanceForLocation(
  location: MsgLocation,
): number | undefined {
  const context = currentSpatialContext();
  if (!context) return undefined;
  const locationFloor = location.floor ?? context.floor;
  if (locationFloor !== context.floor) return undefined;
  const point = locationPoint(location, context);
  if (!point) return undefined;
  const d2 = context.dist2(context.playerX, context.playerY, point.x, point.y);
  return Number.isFinite(d2)
    ? Math.max(0, Math.round(Math.sqrt(Math.max(0, d2))))
    : undefined;
}

export function worldLogMessageDistance(location: MsgLocation): number {
  return worldLogDistanceForLocation(location) ?? 0;
}

export function worldLogLocationIsAudible(
  location: MsgLocation,
  distanceMeters = worldLogDistanceForLocation(location),
): boolean {
  if (!locationHasSource(location)) return true;
  if (distanceMeters === undefined) return true;
  const radius = currentSpatialContext()?.audibleRadiusMeters;
  if (!Number.isFinite(radius)) return true;
  return distanceMeters <= Math.max(0, radius!);
}

export function pushLocalizedMessage(
  msgs: Msg[],
  text: string,
  time: number,
  color: string,
  location: MsgLocation,
): boolean {
  const distanceMeters = worldLogDistanceForLocation(location);
  if (!worldLogLocationIsAudible(location, distanceMeters)) return false;
  msgs.push(msgAt(text, time, color, location, distanceMeters ?? 0));
  return true;
}

function eventKey(e: WorldEvent): string {
  return `${e.type}|${e.actorId ?? -1}|${e.targetId ?? -1}|${e.zoneId ?? -1}|${e.itemId ?? ""}`;
}

function colorFor(e: WorldEvent): string {
  if (e.severity >= 5) return "#f4a";
  if (e.severity >= 4) return "#fa0";
  if (e.severity >= 3) return "#4af";
  return "#aaa";
}

function monsterName(kind?: MonsterKind): string {
  switch (kind) {
    case MonsterKind.SBORKA:
      return "сборка";
    case MonsterKind.TVAR:
      return "тварь";
    case MonsterKind.POLZUN:
      return "ползун";
    case MonsterKind.BETONNIK:
      return "бетонник";
    case MonsterKind.BETONOED:
      return "бетоноед";
    case MonsterKind.ZOMBIE:
      return "мертвяк";
    case MonsterKind.DIKIY_MERTVYAK:
      return "дикий мертвяк";
    case MonsterKind.EYE:
      return "глаз";
    case MonsterKind.NIGHTMARE:
      return "кошмарище";
    case MonsterKind.SHADOW:
      return "теневик";
    case MonsterKind.TONKAYA_TEN:
      return "тонкая тень";
    case MonsterKind.LISHENNYY:
      return "лишенный";
    case MonsterKind.REBAR:
      return "арматура";
    case MonsterKind.MATKA:
      return "матка";
    case MonsterKind.KHOROVAYA_MATKA:
      return "хоровая матка";
    case MonsterKind.IDOL:
      return "идол";
    case MonsterKind.MANCOBUS:
      return "манкобус";
    case MonsterKind.HERALD:
      return "вестник";
    case MonsterKind.CREATOR:
      return "творец";
    case MonsterKind.SPIRIT:
      return "дух";
    case MonsterKind.LOZHNYY_DUKH:
      return "ложный дух";
    case MonsterKind.ROBOT:
      return "робот";
    case MonsterKind.TRUBNYY_AVTOMAT:
      return "трубный автомат";
    case MonsterKind.LAMPOGLAZ:
      return "лампоглаз";
    case MonsterKind.GREEN_DOG:
      return "зеленая собака";
    case MonsterKind.GNILUSHKA:
      return "гнилушка";
    case MonsterKind.KOSTOREZ:
      return "косторез";
    case MonsterKind.SAFEGUARD:
      return "сейфгард";
    case MonsterKind.SOBRANNYY:
      return "собранный человек";
    case MonsterKind.BLACK_LIQUIDATOR:
      return "черный ликвидатор";
    case MonsterKind.CHERVIE_AVATAR:
      return "Червие";
    default:
      return "монстр";
  }
}

function containerName(e: WorldEvent): string {
  const name = e.data?.containerName;
  return typeof name === "string" ? name : `контейнер #${e.containerId ?? "?"}`;
}

function samosborWarningText(e: WorldEvent): string {
  if (e.tags.includes("aftermath")) {
    const title =
      typeof e.data?.beatTitle === "string" ? e.data.beatTitle : "след";
    return `Последствие самосбора: ${title}${e.itemName ? `, ${e.itemName}` : ""}.`;
  }
  const warning = e.data?.warning;
  const signals = e.data?.signals;
  if (typeof warning === "string" && warning.length > 0) {
    if (signals && typeof signals === "object" && !Array.isArray(signals)) {
      const signalMap = signals as Record<string, unknown>;
      const audio = typeof signalMap.audio === "string" ? signalMap.audio : "";
      const map = typeof signalMap.map === "string" ? signalMap.map : "";
      const npc = typeof signalMap.npc === "string" ? signalMap.npc : "";
      const stack = [warning, audio, map, npc].filter(
        (line) => line.length > 0,
      );
      if (stack.length > 1) return stack.join(" / ");
    }
    return warning;
  }
  const floorName =
    typeof e.data?.floorName === "string" ? e.data.floorName : "";
  const variantName =
    typeof e.data?.variantName === "string" ? e.data.variantName : "";
  const zone =
    e.zoneId !== undefined ? `зона ${e.zoneId + 1}` : "локальная зона";
  const place = floorName ? `${floorName}, ${zone}` : zone;
  return variantName
    ? `Предвестник самосбора: ${variantName}, ${place}.`
    : `Предвестник самосбора: ${place}.`;
}

function wrongDoorText(e: WorldEvent): string {
  switch (e.data?.phase) {
    case "created":
      return "Маронарий: отмечена неправильная дверь.";
    case "used":
      return "Неправильная дверь сработала. Выход изменён.";
    case "expired":
      return "Неправильная дверь погасла.";
    default:
      return "Неправильная дверь активна на маршруте.";
  }
}

function factionRelationText(e: WorldEvent): string {
  const factionEventId =
    typeof e.data?.factionEventId === "string" ? e.data.factionEventId : "";
  const action =
    typeof e.data?.processionAction === "string" ? e.data.processionAction : "";
  const outcome =
    typeof e.data?.processionOutcome === "string"
      ? e.data.processionOutcome
      : "";
  if (factionEventId === "cult_procession") {
    if (action === "avoid")
      return `Процессия Чернобога обойдена${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}.`;
    if (action === "follow")
      return "Вы прошли в хвосте процессии. Маршрут отмечен, ПСИ просело.";
    if (action === "report")
      return "Маршрут культовой процессии передан ликвидаторам по рации.";
    if (action === "disguise" || action === "cover")
      return "Мясная метка сработала. Вас пропустили в хвост.";
    if (action === "disrupt")
      return `Культовая процессия сорвана${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
    if (action === "aftermath" && outcome.includes("самосбор"))
      return `Самосбор прервал культовую процессию${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}. Давление спало.`;
    if (action === "aftermath" && outcome === "сорвана")
      return `Давление сорванной процессии спало${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}.`;
    if (action === "aftermath")
      return `Культовая процессия ${outcome || "затихла"}${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}. Давление спало.`;
    return `Культовая процессия идёт${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}. Уступите коридор.`;
  }
  if (factionEventId) {
    const name =
      typeof e.data?.name === "string" ? e.data.name : factionEventId;
    return `${name}${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}.`;
  }
  return `Фракционный сдвиг${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}.`;
}

function pneumomailText(e: WorldEvent): string {
  if (!e.tags.includes("pneumomail")) return "";
  const action =
    typeof e.data?.capsuleEvent === "string" ? e.data.capsuleEvent : "";
  if (action === "capsule_received")
    return `Пневмопочта: получена капсула${e.itemName ? `, ${e.itemName}` : ""}.`;
  if (action === "capsule_sent")
    return `Пневмопочта: отправлена улика ${e.itemName ?? e.itemId ?? ""}.`;
  if (action === "capsule_jammed")
    return `Пневмопочта: труба заклинена${e.itemName ? ` через ${e.itemName}` : ""}.`;
  if (action === "capsule_intercepted")
    return `Пневмопочта: перехвачена ${e.itemName ?? "капсула"}.`;
  if (action === "capsule_reported")
    return "Пневмопочта: вскрытие сдано в контроль.";
  return "Пневмопочта: событие в журнале.";
}

function shelterTallyText(e: WorldEvent): string {
  const target = e.targetName ? ` -> ${e.targetName}` : "";
  const consequence =
    typeof e.data?.consequence === "string" ? e.data.consequence : "";
  if (e.tags.includes("forgery"))
    return `Ведомость укрытых подделана${target}. ${consequence}`;
  if (e.tags.includes("submit"))
    return `Ведомость укрытых сдана${target}. ${consequence}`;
  if (e.tags.includes("handoff"))
    return `Ведомость укрытых передана${target}. ${consequence}`;
  if (e.tags.includes("trade"))
    return `Ведомость укрытых продана${target}. ${consequence}`;
  if (e.tags.includes("hide"))
    return `Ведомость укрытых спрятана${target}. ${consequence}`;
  if (e.tags.includes("theft") || e.tags.includes("stolen"))
    return `Ведомость укрытых украдена${target}. ${consequence}`;
  if (e.tags.includes("admit"))
    return `Истотит: лишняя строка у гермы вписана${target}. ${consequence}`;
  if (e.tags.includes("refuse"))
    return `Истотит: строка у гермы осталась пустой${target}. ${consequence}`;
  return `Ведомость укрытых обработана${target}. ${consequence}`;
}

const EVENT_TEXT_HANDLERS: Partial<
  Record<WorldEventType, (e: WorldEvent) => string>
> = {
  samosbor_warning: (e) => {
    return samosborWarningText(e);
  },
  samosbor_started: (e) => {
    if (e.data?.variantId === "maronary")
      return `Маронарий начался${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}. Сверяйте номер двери по карте; не идите на зелёное свечение.`;
    return `Самосбор начался${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}. Ищите гермодверь.`;
  },
  samosbor_zone_captured: (e) => {
    return `Зона ${e.zoneId !== undefined ? e.zoneId + 1 : "?"} под самосбором. Карта устарела.`;
  },
  samosbor_ended: (_e) => {
    return "Отбой самосбора. Проверьте карту и двери.";
  },
  shelter_tally_handled: (e) => {
    return shelterTallyText(e);
  },
  hermodoor_borer_detected: (e) => {
    return `Гермоточильщик у двери: ${String(e.data?.roomName ?? "укрытие")}. Есть время среагировать.`;
  },
  hermodoor_borer_damage: (e) => {
    return `Гермодверь повреждена: ${String(e.data?.roomName ?? "укрытие")}.`;
  },
  hermodoor_borer_repaired: (e) => {
    return `Гермодверь отремонтирована: ${String(e.data?.roomName ?? "укрытие")}.`;
  },
  hermodoor_borer_compromised: (e) => {
    return `Укрытие скомпрометировано: ${String(e.data?.roomName ?? "укрытие")}.`;
  },
  fog_boss_spawned: (e) => {
    return `Босс тумана появился${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
  },
  fog_boss_killed: (e) => {
    return `Босс тумана уничтожен${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
  },
  smog_entered: (e) => {
    return `Смог${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}. Нужен фильтр, ткань или обход.`;
  },
  smog_source_found: (e) => {
    return `Источник смога найден${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}. Его можно перекрыть.`;
  },
  smog_source_handled: (e) => {
    return `Источник смога перекрыт${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
  },
  monster_sighted: (e) => {
    return `${e.actorName ?? "Косторез"} заметил цель. Замах будет виден.`;
  },
  monster_windup_interrupted: (e) => {
    return `${e.actorName ?? "Косторез"} сбит во время замаха.`;
  },
  monster_armor_cut: (e) => {
    if (e.tags.includes("armor_strip"))
      return `${e.targetName ?? "Броня монстра"} потерял бронеплиту.`;
    return e.tags.includes("armor_cut")
      ? `${e.actorName ?? "Косторез"} срезал бронелист.`
      : `${e.actorName ?? "Косторез"} провел режущий удар.`;
  },
  monster_escaped: (e) => {
    return `${e.targetName ?? "Цель"} ушла из-под замаха ${monsterName(e.monsterKind)}.`;
  },
  false_liquidator_knock: (_e) => {
    return "Черная зачистка стучит в дверь. Сверьте номер маски и не показывайте пробу.";
  },
  false_liquidator_revealed: (e) => {
    return `Черный ликвидатор раскрыт: ${String(e.data?.reason ?? "ложный обход")}.`;
  },
  green_dog_howl: (_e) => {
    return "Зеленая собака завыла у прохода. Стая делит цель: металл, банка или дробь разорвут заход.";
  },
  green_dog_scared: (_e) => {
    return "Зеленая собака сорвалась от громкого металла. Несколько секунд стая не держит цель.";
  },
  fog_shark_pack_sighted: (_e) => {
    return "Туманные акулы взяли стаю. Выйдите из тумана, закройте дверь или держите угол.";
  },
  fog_shark_ignited: (e) => {
    return `Газовый пузырь туманной акулы взорвался: ${String(e.data?.hitCount ?? 0)} целей. Огонь держите на дистанции.`;
  },
  head_slug_detached: (_e) => {
    return "Головной слизень сорвался с носителя и ищет новое тело.";
  },
  head_slug_rehosted: (e) => {
    return `Головной слизень занял носителя: ${e.targetName ?? "тело"}.`;
  },
  head_slug_quarantined: (_e) => {
    return "Головной слизень заперт в карантинном контуре.";
  },
  gnilushka_spared: (e) => {
    return e.tags.includes("helped")
      ? "Гнилушка получила помощь и не стала боем. Слух запомнит сдержанность."
      : "С Гнилушкой поговорили без выстрела. Она осталась опасной только в углу.";
  },
  gnilushka_hurt: (_e) => {
    return "Гнилушку ранили. Теперь она бежит от людей и режет только если её прижали.";
  },
  gnilushka_delivered: (_e) => {
    return "Гнилушка ушла по маршруту НИИ. На полу остался добровольный соскоб.";
  },
  composite_woke: (e) => {
    return `${e.actorName ?? "Собранный человек"} проснулся: ${String(e.data?.reason ?? "шум")}.`;
  },
  composite_growth: (e) => {
    return `${e.actorName ?? "Собранный человек"} набрал массу: ${String(e.data?.stacks ?? "?")}.`;
  },
  composite_isolated: (e) => {
    return `${e.actorName ?? "Собранный человек"} изолирован: ${String(e.data?.reason ?? "порог")}.`;
  },
  obzhivalshchik_scratched: (e) => {
    return e.tags.includes("growth")
      ? `Комнатный обживальщик нарастил стену: ${String(e.data?.growthCount ?? "?")}/${String(e.data?.growthCap ?? "?")}.`
      : "Комнатный обживальщик скребет квартиру. Шум и кража поднимут злость.";
  },
  obzhivalshchik_calmed: (_e) => {
    return "Комнатный обживальщик стих после доклада или помощи соседям.";
  },
  obzhivalshchik_breached: (_e) => {
    return "Комнатный обживальщик вышел из комнаты: коридор стал частью квартиры.";
  },
  net_terminal_hack_failed: (e) => {
    return e.tags.includes("safeguard_spawned")
      ? "НЕТ-терминал отклонил взлом. Сейфгард вышел на отказ."
      : "НЕТ-терминал отклонил взлом. Белый след уже отмечен.";
  },
  chervie_signal: (e) => {
    return e.tags.includes("mind_pulse")
      ? "Червие дало локальный НЕТ-импульс. Люди рядом слышат чужой приказ."
      : "Червие снова держится за экран или серверный аппарат.";
  },
  chervie_server_cut: (_e) => {
    return "Источник Червие отключен. Аватар потерял зеленую защиту и скорость.";
  },
  chervie_false_order: (_e) => {
    return "Червие напечатало ложный приказ. Не выполняйте команду с экрана.";
  },
  metro_route_taken: (e) => {
    return `Метро: ${String(e.data?.routeLabel ?? "маршрут")} -> ${String(e.data?.destinationLabel ?? "остановка")}.`;
  },
  metro_wrong_stop: (e) => {
    return `Метро ошиблось: ${String(e.data?.routeLabel ?? "маршрут")} -> ${String(e.data?.destinationLabel ?? "чужая остановка")}.`;
  },
  rail_train_boarded: (e) => {
    return `Поезд: посадка в ${String(e.data?.trainLabel ?? "состав")}.`;
  },
  rail_train_exited: (e) => {
    return `Поезд: выход из ${String(e.data?.trainLabel ?? "состава")}.`;
  },
  rail_train_crush: (e) => {
    return `Поезд задавил: ${e.actorName ?? "цель"}.`;
  },
  emergency_panel_used: (e) => {
    return `Аварийный щиток: ${String(e.data?.action ?? "контур")} в зоне ${e.zoneId !== undefined ? e.zoneId + 1 : "?"}.`;
  },
  rumor_observed: (e) => {
    if (e.tags.includes("false_safe_block"))
      return "Тихий блок раскрыт: нет сирены, есть культовая метка.";
    return `${e.actorName ?? "Кто-то"} заметил слух.`;
  },
  player_pick_item: (e) => {
    return `Подобрано: ${e.itemName ?? e.itemId ?? "предмет"}${e.itemCount && e.itemCount > 1 ? ` x${e.itemCount}` : ""}.`;
  },
  player_drop_item: (e) => {
    return `Выброшено: ${e.itemName ?? e.itemId ?? "предмет"}${e.itemCount && e.itemCount > 1 ? ` x${e.itemCount}` : ""}.`;
  },
  player_use_item: (e) => {
    if (
      e.tags.includes("false_safe_block") &&
      e.tags.includes("marker_resolved")
    )
      return "Черная ладонь снята. Тихий блок снова обычный.";
    return `Использовано: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
  player_destroy_item: (e) => {
    return `Уничтожено: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
  player_sell_item: (e) => {
    if (e.tags.includes("govnyak"))
      return `Говняк продан${e.targetName ? ` -> ${e.targetName}` : ""}. Долг перенесён.`;
    return `Продано: ${e.itemName ?? e.itemId ?? "предмет"}${e.targetName ? ` -> ${e.targetName}` : ""}.`;
  },
  player_handoff_item: (e) => {
    if (e.tags.includes("govnyak") && e.tags.includes("confiscation"))
      return `Говняк сдан ликвидатору${e.targetName ? ` -> ${e.targetName}` : ""}.`;
    if (e.tags.includes("govnyak"))
      return `Говняк куплен${e.targetName ? ` у ${e.targetName}` : ""}. Проверьте долг.`;
    return `Передано: ${e.itemName ?? e.itemId ?? "предмет"}${e.targetName ? ` -> ${e.targetName}` : ""}.`;
  },
  player_status_applied: (e) => {
    if (e.data?.statusId === "zhelemish_skin")
      return "Желемышная кожа включена: защита, расход воды и ПСИ.";
    if (String(e.data?.statusId ?? "").startsWith("govnyak_"))
      return "Говняк подействовал. Долг растёт.";
    return "Временное состояние получено.";
  },
  player_status_bad_reaction: (e) => {
    if (e.data?.statusId === "zhelemish_skin")
      return "Желемыш дал плохую реакцию: вода и ПСИ просели.";
    if (String(e.data?.statusId ?? "").startsWith("govnyak_"))
      return "Гремучий говняк сорвался: кашель, шум и долг.";
    return "Плохая реакция на временное состояние.";
  },
  player_status_cured: (e) => {
    if (e.data?.statusId === "zhelemish_skin")
      return "Желемышная кожа снята лекарством.";
    if (e.data?.statusId === "govnyak_debt")
      return "Говнячный долг снят. Прицел стабилен.";
    return "Временное состояние снято.";
  },
  player_status_expired: (e) => {
    if (e.data?.statusId === "zhelemish_skin")
      return "Желемышная кожа высохла и отвалилась.";
    if (String(e.data?.statusId ?? "").startsWith("govnyak_"))
      return "Говнячный кашель отпустил.";
    return "Временное состояние прошло.";
  },
  tool_broke: (e) => {
    return `Сломано: ${e.itemName ?? e.itemId ?? "инструмент"}.`;
  },
  player_kill_monster: (e) => {
    if (e.monsterKind === MonsterKind.BETONOED)
      return "Бетоноед добит. Слабая стена в безопасности.";
    if (e.monsterKind === MonsterKind.GNILUSHKA)
      return "Гнилушка убита. Это был не обычный бой с тварью.";
    return `Убит ${e.targetName ?? monsterName(e.monsterKind)}.`;
  },
  player_kill_npc: (e) => {
    return `Убит жилец: ${e.targetName ?? "без имени"}. Репутация снижена.`;
  },
  npc_kill_monster: (e) => {
    return `${e.actorName ?? "NPC"} убил ${e.targetName ?? monsterName(e.monsterKind)}.`;
  },
  npc_kill_npc: (e) => {
    return `${e.actorName ?? "NPC"} убил ${e.targetName ?? "NPC"}.`;
  },
  quest_created: (e) => {
    return `Принято задание: ${e.targetName ?? e.data?.desc ?? "без описания"}.`;
  },
  quest_completed: (e) => {
    return `Задание выполнено: ${e.targetName ?? e.data?.desc ?? "без описания"}.`;
  },
  quest_failed: (e) => {
    return `Задание провалено: ${e.targetName ?? e.data?.reason ?? "срок вышел"}.`;
  },
  contract_created: (e) => {
    return `Системное задание принято: ${e.targetName ?? e.data?.contractId ?? "без номера"}.`;
  },
  contract_completed: (e) => {
    if (e.tags.includes("cleanup_completed"))
      return `Зачистка завершена: ${e.targetName ?? e.data?.contractId ?? "без номера"}.`;
    return `Системное задание закрыто: ${e.targetName ?? e.data?.contractId ?? "без номера"}.`;
  },
  contract_failed: (e) => {
    return `Системное задание сорвалось: ${e.data?.reason ?? "отказ окна"}.`;
  },
  ration_coupon_spent: (e) => {
    return `Талон погашен: ${e.itemName ?? e.itemId ?? "пайковый документ"}. Паёк выдан.`;
  },
  ration_coupon_stolen: (e) => {
    return `Украдены талоны: ${e.itemName ?? e.itemId ?? "пайковая бумага"}. Запущен пайковый аудит.`;
  },
  ration_coupon_forged: (e) => {
    return `Подделан пайковый документ: ${e.itemName ?? e.itemId ?? "карточка"}. Риск ревизии.`;
  },
  ration_coupon_reported: (e) => {
    return `Пайковая махинация сдана: ${e.itemName ?? e.itemId ?? "улика"}. Очередь пересчитает пайки.`;
  },
  ration_audit_resolved: (e) => {
    if (e.data?.outcome === "black_market_sale")
      return "Пайковая карточка продана на рынок.";
    return "Пайковая ревизия закрыта. Министерство и очередь сверили списки.";
  },
  container_opened: (e) => {
    if (e.tags.includes("false_safe_block"))
      return `Открыт запас тихого блока: ${containerName(e)}.`;
    if (e.tags.includes("quarantine"))
      return `Карантин открыт: ${containerName(e)}.`;
    return `Открыт контейнер: ${containerName(e)}.`;
  },
  item_stolen: (e) => {
    if (e.tags.includes("false_safe_block"))
      return `Чужой запас тихого блока взят: ${e.itemName ?? e.itemId ?? "предмет"}. Метка активна.`;
    if (e.tags.includes("quarantine"))
      return `Карантин нарушен: ${e.itemName ?? e.itemId ?? "предмет"} вынесли из ${containerName(e)}.`;
    if (e.tags.includes("witnessed"))
      return `Кражу заметили: ${e.itemName ?? e.itemId ?? "предмет"} из ${containerName(e)}.`;
    if (e.tags.includes("audit") && e.data?.auditOnly)
      return `Ревизия выявила кражу: ${e.itemName ?? e.itemId ?? "предмет"} из ${containerName(e)}.`;
    if (e.tags.includes("audit"))
      return `Кража попадёт в ревизию: ${e.itemName ?? e.itemId ?? "предмет"} из ${containerName(e)}.`;
    return `Кража: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
  item_deposited: (e) => {
    if (e.tags.includes("resident_relief"))
      return `Запас возвращён жильцам: ${e.itemName ?? e.itemId ?? "предмет"} в ${containerName(e)}.`;
    if (e.tags.includes("evidence"))
      return `Доказательство подброшено: ${e.itemName ?? e.itemId ?? "предмет"} в ${containerName(e)}.`;
    if (e.tags.includes("sabotage"))
      return `Запас испорчен: ${e.itemName ?? e.itemId ?? "предмет"} в ${containerName(e)}.`;
    return `Положено в контейнер: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
  room_produced_items: (e) => {
    return `Цех выдал: ${e.itemName ?? e.itemId ?? "партия"}${e.itemCount && e.itemCount > 1 ? ` x${e.itemCount}` : ""}.`;
  },
  room_lacked_resources: (e) => {
    return `Цех встал: не хватает сырья${e.roomId !== undefined ? ` в комнате #${e.roomId}` : ""}.`;
  },
  room_blocked_production: (e) => {
    return `Цех заблокирован: ${String(e.data?.blockedReason ?? "нет места")}.`;
  },
  hazard_trapped: (e) => {
    return `${e.actorName ?? "Кто-то"} застрял в ${String(e.data?.hazardName ?? "опасность")}.`;
  },
  hazard_escaped: (e) => {
    return `${e.actorName ?? "Кто-то"} вышел из ${String(e.data?.hazardName ?? "липкой зоны")}${e.data?.noisy ? ", шумно" : ""}.`;
  },
  hazard_cleaned: (e) => {
    return `${String(e.data?.hazardName ?? "Опасность")} очищена: ${String(e.data?.cleanedCells ?? "?")} клет.`;
  },
  burn_cleanup: (e) => {
    return `Огонь зачистил остаток: ${String(e.data?.cleanedHazardCells ?? "?")} клет.`;
  },
  fuel_empty: (_e) => {
    return "Огнемёт сухой: бензин кончился.";
  },
  collateral_damage: (e) => {
    return `Огонь испортил: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
  rumor_spread: (e) => {
    return `${e.actorName ?? "Кто-то"} передал слух.`;
  },
  faction_event: (e) => {
    return factionRelationText(e);
  },
  faction_patrol_clash: (e) => {
    return `Патрули столкнулись${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
  },
  faction_relation_changed: (e) => {
    return factionRelationText(e);
  },
  floor_transition: (e) => {
    if (e.tags.includes("false_safe_block"))
      return "Переход: тихий блок. Сирены нет.";
    return `Переход: ${e.targetName ?? "другой этаж"}.`;
  },
  door_opened: (e) => {
    if (e.tags.includes("betonoed") && e.tags.includes("wall_breached"))
      return "Бетоноед вскрыл слабую стену. Короткий ход открыт.";
    if (e.tags.includes("betonoed") && e.tags.includes("shortcut_used"))
      return "Ход Бетоноеда использован как короткий маршрут.";
    if (e.tags.includes("wrong_door")) return wrongDoorText(e);
    return `Дверь открылась${e.zoneId !== undefined ? ` в зоне ${e.zoneId + 1}` : ""}.`;
  },
  door_sealed: (e) => {
    if (e.tags.includes("betonoed")) return "Проход Бетоноеда запечатан.";
    return "Проход запечатан.";
  },
  death_seen: (e) => {
    if (e.tags.includes("betonoed") && e.tags.includes("driven_off"))
      return "Бетоноед отогнан от слабой стены.";
    return `${e.targetName ?? "Смерть"} замечена.`;
  },
  paritel_valve_changed: (e) => {
    return `Паровой мост: давление ${String(e.data?.pressure ?? "?")}/3.`;
  },
  paritel_bridge_crossed: (_e) => {
    return "Паровой мост пройден.";
  },
  paritel_threat_neutralized: (_e) => {
    return "Паритель нейтрализован.";
  },
  paritel_steam_injury: (_e) => {
    return "Паровой мост обжёг вас.";
  },
  paritel_steam_avoided: (_e) => {
    return "Паровой мост обойден без прямого ожога.";
  },
  lift_arachna_warned: (_e) => {
    return "Лифт: над шахтой скребет лифтовая арахна. Смотрите вверх или отходите.";
  },
  lift_arachna_sprung: (e) => {
    return e.tags.includes("baited_drop")
      ? "Лифтовая арахна сорвалась на шум и промахнулась."
      : "Лифтовая арахна упала из шахты.";
  },
  lift_arachna_avoided: (_e) => {
    return "Лифтовая арахна не упала. Шахта тиха.";
  },
  lift_arachna_cleared: (_e) => {
    return "Лифтовая арахна очищена. У лифта стало тише.";
  },
  pseudolift_suspected: (e) => {
    return `Лифт не сходится: табло ${String(e.data?.fakeFloorLabel ?? "?")}, порог влажный.`;
  },
  pseudolift_revealed: (e) => {
    return e.tags.includes("cleared")
      ? "Псевдолифт осел в шахту. Кабина снова проходима."
      : "Псевдолифт раскрыл кабину пастью.";
  },
  pseudolift_fed: (e) => {
    return `Псевдолифт ушел на приманку: ${e.itemName ?? e.itemId ?? "предмет"}.`;
  },
};

function eventText(e: WorldEvent): string {
  const pneumomail = pneumomailText(e);
  if (pneumomail) return pneumomail;

  const handler = EVENT_TEXT_HANDLERS[e.type];
  if (handler) {
    return handler(e);
  }

  return `${e.type}${e.zoneId !== undefined ? `: зона ${e.zoneId + 1}` : ""}.`;
}
function shouldLog(e: WorldEvent): boolean {
  if (e.tags.includes("territory_capture") || e.tags.includes("cell_territory"))
    return false;
  if (e.tags.includes("pneumomail")) return e.severity >= 2;
  if (e.tags.includes("false_safe_block")) return e.severity >= 3;
  if (
    TELEMETRY_ONLY.has(e.type) &&
    !(e.type === "container_opened" && e.tags.includes("quarantine"))
  )
    return false;
  if (e.privacy === "secret" || e.privacy === "private") {
    return e.severity >= 2 && (e.actorName === "Вы" || e.actorId === 0);
  }
  return (
    e.severity >= 3 ||
    e.type.startsWith("quest_") ||
    e.type.startsWith("contract_") ||
    e.type.startsWith("samosbor_") ||
    e.type.startsWith("fog_boss_") ||
    e.type.startsWith("smog_") ||
    e.type.startsWith("monster_") ||
    e.type.startsWith("gnilushka_") ||
    e.type.startsWith("metro_") ||
    e.type.startsWith("rail_train_") ||
    e.type.startsWith("hazard_") ||
    e.type.startsWith("paritel_")
  );
}

function shouldHud(e: WorldEvent): boolean {
  if (!shouldLog(e)) return false;
  if (e.type === "ammo_consumed") return false;
  return (
    e.severity >= 3 ||
    e.tags.includes("pneumomail") ||
    e.type.startsWith("quest_") ||
    e.type.startsWith("samosbor_") ||
    e.type.startsWith("fog_boss_") ||
    e.type.startsWith("smog_") ||
    e.type.startsWith("monster_") ||
    e.type.startsWith("gnilushka_") ||
    e.type.startsWith("metro_") ||
    e.type.startsWith("rail_train_") ||
    e.type.startsWith("hazard_") ||
    e.type.startsWith("paritel_")
  );
}

function pushLog(state: GameState, entry: LogEntry): void {
  state.msgLog.push(entry);
  if (state.msgLog.length > LOG_MAX)
    state.msgLog.splice(0, state.msgLog.length - LOG_MAX);
}

function isDeathFact(e: WorldEvent): boolean {
  return (
    e.type === "player_kill_monster" ||
    e.type === "player_kill_npc" ||
    e.type === "npc_kill_monster" ||
    e.type === "npc_kill_npc" ||
    e.type === "death_seen" ||
    e.type === "fog_boss_killed" ||
    e.tags.includes("kill") ||
    e.tags.includes("death")
  );
}

function deathFactAlreadyLogged(
  state: GameState,
  event: WorldEvent,
  text: string,
  color: string,
): boolean {
  if (!isDeathFact(event) || event.targetId === undefined) return false;
  const start = Math.max(0, state.msgLog.length - FACT_DEDUPE_SCAN);
  for (let i = state.msgLog.length - 1; i >= start; i--) {
    const entry = state.msgLog[i];
    if (entry.text !== text || entry.color !== color) continue;
    if (entry.targetId !== event.targetId) continue;
    if (entry.floor !== undefined && entry.floor !== event.floor) continue;
    return true;
  }
  return false;
}

export function recordWorldLogEvent(state: GameState, event: WorldEvent): void {
  if (state.tutorialMode && event.type !== 'player_pick_item') return;
  if (!state.worldEvents || !shouldLog(event)) return;
  const key = eventKey(event);
  if (
    state.worldEvents.lastLogKey === key &&
    event.time - state.worldEvents.lastLogTime < DEDUPE_SECONDS &&
    event.severity < 5
  ) {
    return;
  }

  const text = eventText(event);
  const color = colorFor(event);
  const location: MsgLocation = {
    floor: event.floor,
    x: event.x,
    y: event.y,
    actorId: event.actorId,
    targetId: event.targetId,
    roomId: event.roomId,
    zoneId: event.zoneId,
  };
  const distanceMeters = worldLogDistanceForLocation(location);
  if (!worldLogLocationIsAudible(location, distanceMeters)) return;
  if (deathFactAlreadyLogged(state, event, text, color)) return;
  state.worldEvents.lastLogKey = key;
  state.worldEvents.lastLogTime = event.time;
  const stampedDistanceMeters = distanceMeters ?? 0;
  const entry: LogEntry = {
    text,
    color,
    day: event.day,
    hour: event.hour,
    minute: event.minute,
    ...location,
    distanceMeters: stampedDistanceMeters,
  };
  pushLog(state, entry);

  if (shouldHud(event)) {
    const hud: Msg = {
      text,
      color,
      time: event.time,
      day: event.day,
      hour: event.hour,
      minute: event.minute,
      ...location,
      distanceMeters: stampedDistanceMeters,
    };
    state.msgs.push(hud);
  }
}
