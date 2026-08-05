/* ── NPC & monster name generation + freshNeeds ──────────────── */

import { Faction, type Needs } from '../core/types';

// ═══════════════════════════════════════════════════════════════
//  Name pools — single source of truth for randomName & A-Life
// ═══════════════════════════════════════════════════════════════

// ── Citizens / Scientists: normal Russian first + last names ──
export const CITIZEN_FIRST_M: readonly string[] = [
  'Иван','Пётр','Алексей','Дмитрий','Сергей','Андрей','Николай','Михаил',
  'Виктор','Олег','Григорий','Борис','Фёдор','Геннадий','Валерий','Юрий',
  'Анатолий','Владимир','Константин','Евгений','Александр','Василий',
  'Роман','Павел','Игорь','Степан','Артём','Максим','Тимофей','Леонид',
  'Вячеслав','Семён','Аркадий','Денис','Антон','Кирилл','Виталий','Руслан',
  'Илья','Глеб',
];
export const CITIZEN_FIRST_F: readonly string[] = [
  'Мария','Анна','Елена','Ольга','Наталья','Татьяна','Ирина','Светлана',
  'Людмила','Галина','Нина','Валентина','Екатерина','Лариса','Тамара',
  'Зинаида','Раиса','Вера','Надежда','Любовь','Алла','Юлия','Дарья',
  'Александра','Полина','Евгения','Клавдия','Антонина','Маргарита','Инна',
  'Оксана','Марина','Алёна','Кристина','Виктория','Софья','Лидия','Римма',
  'Жанна','Диана',
];
export const CITIZEN_LAST_M: readonly string[] = [
  'Иванов','Петров','Сидоров','Кузнецов','Попов','Васильев','Соколов',
  'Михайлов','Новиков','Фёдоров','Морозов','Волков','Алексеев','Лебедев',
  'Семёнов','Егоров','Павлов','Козлов','Степанов','Орлов','Макаров',
  'Андреев','Ковалёв','Ильин','Герасимов','Никитин','Тарасов','Комаров',
  'Осипов','Захаров','Зайцев','Борисов','Белов','Громов','Калинин',
  'Сорокин','Серов','Малышев','Денисов','Титов',
];
export const CITIZEN_LAST_F: readonly string[] = [
  'Иванова','Петрова','Сидорова','Кузнецова','Попова','Васильева','Соколова',
  'Михайлова','Новикова','Фёдорова','Морозова','Волкова','Алексеева','Лебедева',
  'Семёнова','Егорова','Павлова','Козлова','Степанова','Орлова','Макарова',
  'Андреева','Ковалёва','Ильина','Герасимова','Никитина','Тарасова','Комарова',
  'Осипова','Захарова','Зайцева','Борисова','Белова','Громова','Калинина',
  'Сорокина','Серова','Малышева','Денисова','Титова',
];

// ── Liquidators: military ranks + Ukrainian-style surnames ───
export const LIQ_RANKS: readonly string[] = [
  'Рядовой','Ефрейтор','Сержант','Ст. сержант','Лейтенант',
  'Ст. лейтенант','Капитан','Майор','Подполковник','Полковник',
];
export const LIQ_LAST: readonly string[] = [
  'Петренко','Бондаренко','Шевченко','Коваль','Мельник','Ткаченко',
  'Гриценко','Кравченко','Олейник','Литвин','Сидорук','Бойко','Марченко',
  'Поляков','Кравцов','Зайцев','Жук','Левченко','Руденко','Савченко',
];

// ── Wild: nicknames + callsigns ──────────────────────────────
export const WILD_FIRST_M: readonly string[] = [
  'Дима','Серый','Толик','Лёха','Колян','Жека','Саня','Вован','Макс',
  'Костыль','Шурик','Борян','Витёк','Михон','Стас',
];
export const WILD_FIRST_F: readonly string[] = [
  'Машка','Светка','Ленка','Танька','Наташка','Иришка','Зинка','Верка',
  'Нинка','Анька','Дашка','Юлька',
];
export const WILD_NICK: readonly string[] = [
  'Бетон','Шило','Гвоздь','Крыса','Дым','Штырь','Башка','Кирпич','Резак',
  'Гайка','Труба','Ржавый','Шакал','Метла','Кабан','Цемент','Молот',
  'Арматура','Пыль','Болт','Фитиль','Сварка','Клещ','Палёный','Хомут',
];

// ── Cultists: eldritch adjective + noun ──────────────────────
export const CULT_ADJ_M: readonly string[] = [
  'Чёрный','Кровавый','Безглазый','Гнилой','Тёмный','Слепой','Пепельный',
  'Утопший','Безмолвный','Ползый','Бетонный','Серебряный','Пустотный',
  'Могильный','Хтоничный',
];
export const CULT_ADJ_F: readonly string[] = [
  'Чёрная','Кровавая','Безглазая','Гнилая','Тёмная','Слепая','Пепельная',
  'Утопшая','Безмолвная','Ползая','Бетонная','Серебряная','Пустотная',
  'Могильная','Хтоничная',
];
export const CULT_NOUN_M: readonly string[] = [
  'Идол','Коготь','Скрежет','Червь','Столп','Глаз','Рот','Клык','Зов',
  'Дым','Прах','Камень','Шёпот','Голод',
];
export const CULT_NOUN_F: readonly string[] = [
  'Гниль','Тень','Плоть','Яма','Пасть','Бездна','Жила','Завеса','Мгла',
  'Тишь','Язва','Пелена','Дыра',
];

// ── Scientists: academic title + first name ──────────────────
export const SCIENTIST_TITLE: readonly string[] = [
  'Профессор','Доктор','Лаборант','Научный сотрудник','Аспирант',
  'Доцент','Инженер','Академик','Стажёр','Завлаб',
];

// ═══════════════════════════════════════════════════════════════
//  Name generation
// ═══════════════════════════════════════════════════════════════

function _pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export interface NameResult {
  name: string;        // full display name (backward compat)
  firstName: string;   // first part (name / rank / adjective / nickname)
  lastName: string;    // second part (surname / callsign / noun)
  female: boolean;
}

export function randomName(faction?: Faction): NameResult {
  switch (faction) {
    case Faction.LIQUIDATOR: {
      const rank = _pick(LIQ_RANKS);
      const last = _pick(LIQ_LAST);
      return { name: `${rank} ${last}`, firstName: rank, lastName: last, female: false };
    }
    case Faction.WILD: {
      const female = Math.random() < 0.33;
      const first = female ? _pick(WILD_FIRST_F) : _pick(WILD_FIRST_M);
      const nick = _pick(WILD_NICK);
      return { name: `${first} «${nick}»`, firstName: first, lastName: nick, female };
    }
    case Faction.CULTIST: {
      const female = Math.random() < 0.5;
      const adj = _pick(female ? CULT_ADJ_F : CULT_ADJ_M);
      const noun = female ? _pick(CULT_NOUN_F) : _pick(CULT_NOUN_M);
      return { name: `${adj} ${noun}`, firstName: adj, lastName: noun, female };
    }
    case Faction.SCIENTIST: {
      const female = Math.random() < 0.4;
      const title = _pick(SCIENTIST_TITLE);
      const last = female ? _pick(CITIZEN_LAST_F) : _pick(CITIZEN_LAST_M);
      return { name: `${title} ${last}`, firstName: title, lastName: last, female };
    }
    default: {
      const female = Math.random() < 0.5;
      const first = female ? _pick(CITIZEN_FIRST_F) : _pick(CITIZEN_FIRST_M);
      const last = _pick(female ? CITIZEN_LAST_F : CITIZEN_LAST_M);
      return { name: `${first} ${last}`, firstName: first, lastName: last, female };
    }
  }
}

// ── Helper: свежие потребности для NPC ───────────────────────────
export function freshNeeds(): Needs {
  return { food: 70 + Math.random() * 30, water: 70 + Math.random() * 30, sleep: 60 + Math.random() * 40, pee: Math.random() * 30, poo: Math.random() * 20 };
}
