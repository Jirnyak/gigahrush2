/* ── Metro Error Line route definitions ──────────────────────── */

import { FloorLevel } from '../core/types';

export const METRO_STATION_ROOM_NAME = 'Станция ошибочной линии: платформа 19';
export const METRO_DEPOT_ROOM_NAME = 'Депо без рельсов: карман маршрута';
export const METRO_ERROR_ROOM_NAME = 'Слепая пересадка: чужой вестибюль';

export type MetroDestination =
  | { kind: 'floor'; floor: FloorLevel; label: string; returnRouteId?: string; returnHint?: string }
  | { kind: 'local'; roomName: string; label: string; returnRouteId?: string; returnHint?: string };

export interface MetroRouteDef {
  id: string;
  stationRoomName: string;
  panelSlot: number;
  label: string;
  clue: string;
  departLine?: string;
  wrongStopLine?: string;
  unavailableLine?: string;
  noTicketLine?: string;
  requiredItem?: string;
  wrongStopChance: number;
  cooldownSec: number;
  destination: MetroDestination;
  wrongStops: readonly MetroDestination[];
  safeReturn?: boolean;
  rumorIds: readonly string[];
  tags: readonly string[];
}

export const METRO_TRANSPORT_LINES: readonly string[] = [
  'Кнопка теплая. Кто-то уехал недавно или еще не доехал.',
  'Поезд пустой не потому, что безопасный. Просто он уже всех высадил.',
  'Билет прокомпостирован зубами. Такой иногда проходит, если не показывать свету.',
  'Если станция повторилась, сиди. При повторе часто сажает на чужую платформу.',
  'Двери закрываются. Руки убрать, рюкзак прижать к себе.',
  'Лифтер: кабина привезла запах нижнего этажа и отказалась ехать обратно.',
  'Дежурная платформы: белая лампа ведет только к обратному ходу.',
  'Машинист: красная линия экономит минуты, но часто высаживает ниже расписания.',
  'Пассажир в шарфе: билет держи в кулаке, контролеру раньше времени не показывай.',
  'Застрявший: я ждал не поезд, а правильный звук дверей.',
  'Дежурная: первый щелчок стрелки слушают, на втором уже отходят от края.',
  'Лифтер: холодная кнопка при теплой кабине значит, что лифт еще кого-то везет.',
  'Машинист: под табличкой ждать можно, на рельсы ждать нельзя.',
  'Дежурный пути: рельсы тут не дорожка. Стой за желтой линией.',
  'Пассажир: если станция объявила твоим голосом, не выходи первым.',
  'Застрявший: лифт ушел вниз, а мой билет остался недействительным.',
  'Дежурная депо: где нет рельсов, белая лампа важнее расписания.',
  'Машинист: двери закрылись, документы тоже держать внутри.',
  'Лифтер: если кабина не берет назад, ищи кнопку, которая не остыла.',
  'Пассажир: считай двери, не этажи. Таблички тут врут чаще.',
  'Дежурная: желтая стрелка без предохранителя заведет в депо без обратной кнопки.',
  'Застрявший: станция повторилась, я сел на пол и остался живым.',
  'Машинист: состав берет билет, но номер платформы перепроверь сам.',
  'Лифтер: теплая кнопка значит, что кто-то еще не закончил маршрут.',
  'Платформа: если пустой поезд шипит вентиляцией, спрячься за киоск и дай ему проехать.',
];

export const METRO_ROUTE_CUE_LINES: readonly string[] = [
  'Зеленое табло держится ровно, пока билет сухой; запах кухни ведет к жилой петле.',
  'Красное табло без названия станции везет вниз быстрее, чем назад; при втором щелчке стрелки лучше ждать.',
  'Желтая стрелка к депо просит предохранитель на обратный путь; сверяйся с белой лампой, не с объявлением.',
  'Черное табло открывает чужой вестибюль; белый экран слева ведет обратно, если не слушать объявление.',
  'Белые лампы выводят назад к четырем табло; считать надо лампы, не объявления.',
  'Если поезд пришел пустым и теплым, выйди за стойку киоска и дождись второго открытия дверей.',
  'Станция повторилась - не выходи. Подожди, пока табло назовет другой номер пути.',
  'Запах йода после Коллекторов значит: выйти можно, возвращаться только первой кнопкой.',
  'Теплая кнопка у лифта - чужой недавний маршрут. Перед посадкой проверь схему.',
  'Платформа без пассажиров безопаснее у стены; у края пути шаги слышно раньше, чем видно поезд.',
];

const TO_STATION: MetroDestination = {
  kind: 'local',
  roomName: METRO_STATION_ROOM_NAME,
  label: 'Платформа 19',
  returnHint: METRO_ROUTE_CUE_LINES[4],
};
const TO_LIVING: MetroDestination = {
  kind: 'floor',
  floor: FloorLevel.LIVING,
  label: 'Жилая зона',
  returnHint: 'Обычный лифт на соседнем этаже вернет к коллекторам; проверь, теплая ли кнопка.',
};
const TO_HELL: MetroDestination = {
  kind: 'floor',
  floor: FloorLevel.HELL,
  label: 'Красная нижняя',
  returnHint: 'Не уходи от лифта: обратный подъем возвращает к коллекторам, пока кнопка не остыла.',
};
const TO_DEPOT: MetroDestination = {
  kind: 'local',
  roomName: METRO_DEPOT_ROOM_NAME,
  label: 'Депо без рельсов',
  returnRouteId: 'metro_depot_return',
  returnHint: METRO_ROUTE_CUE_LINES[2],
};
const TO_ERROR: MetroDestination = {
  kind: 'local',
  roomName: METRO_ERROR_ROOM_NAME,
  label: 'Слепая пересадка',
  returnRouteId: 'metro_error_safe_return',
  returnHint: METRO_ROUTE_CUE_LINES[3],
};

export const METRO_ROUTES: readonly MetroRouteDef[] = [
  {
    id: 'metro_living_loop',
    stationRoomName: METRO_STATION_ROOM_NAME,
    panelSlot: 0,
    label: 'Жилая петля',
    clue: METRO_ROUTE_CUE_LINES[0],
    departLine: 'Дежурная платформы: зеленое табло ровное, садись у двери и не выпускай билет.',
    wrongStopLine: 'Жилая петля пахнула чужой кухней и высадила не там, где обещала.',
    unavailableLine: 'Табло показывает жилую петлю, но эта платформа сегодня не принимает посадку.',
    noTicketLine: 'Турникет к жилой петле просит билет. Без билета зеленая лампа только греет пальцы.',
    requiredItem: 'metro_ticket',
    wrongStopChance: 0.18,
    cooldownSec: 18,
    destination: TO_LIVING,
    wrongStops: [TO_ERROR, TO_DEPOT],
    rumorIds: ['floor_metro_error_line', 'floor_metro_wrong_voice'],
    tags: ['living_loop', 'ticket', 'return_hint'],
  },
  {
    id: 'metro_red_lower',
    stationRoomName: METRO_STATION_ROOM_NAME,
    panelSlot: 1,
    label: 'Красная нижняя',
    clue: METRO_ROUTE_CUE_LINES[1],
    departLine: 'Машинист говорит устало: красная нижняя, кто передумал - ждите следующего щелчка.',
    wrongStopLine: 'Красная нижняя назвала станцию слишком рано и высадила у не того лифта.',
    unavailableLine: 'Красное табло горит, но состав отсюда не берет. Двери даже не делают вид.',
    noTicketLine: 'Красная нижняя требует билет метро. Без него турникет держит дверь и зовет дежурную.',
    requiredItem: 'metro_ticket',
    wrongStopChance: 0.34,
    cooldownSec: 24,
    destination: TO_HELL,
    wrongStops: [TO_ERROR, TO_DEPOT],
    rumorIds: ['floor_metro_red_line', 'floor_metro_wrong_voice'],
    tags: ['red_lower', 'ticket', 'high_risk'],
  },
  {
    id: 'metro_railess_depot',
    stationRoomName: METRO_STATION_ROOM_NAME,
    panelSlot: 2,
    label: 'Депо без рельсов',
    clue: METRO_ROUTE_CUE_LINES[2],
    departLine: 'Дежурная депо: желтая стрелка открыта, держись стены, белая лампа вернет.',
    wrongStopLine: 'Желтая стрелка щелкнула без рельсов и отдала маршрут чужому вестибюлю.',
    unavailableLine: 'Желтая стрелка показывает депо, но шахта закрыта и обратной кнопки нет.',
    noTicketLine: 'Депо без рельсов берет билет как расписку, что ты сам нажал кнопку.',
    requiredItem: 'metro_ticket',
    wrongStopChance: 0.12,
    cooldownSec: 16,
    destination: TO_DEPOT,
    wrongStops: [TO_ERROR],
    rumorIds: ['floor_metro_depot'],
    tags: ['depot', 'ticket', 'transfer'],
  },
  {
    id: 'metro_blind_transfer',
    stationRoomName: METRO_STATION_ROOM_NAME,
    panelSlot: 3,
    label: 'Слепая пересадка',
    clue: METRO_ROUTE_CUE_LINES[3],
    departLine: 'Черное табло приняло посадку. Дежурная отвернулась: кто смотрит на табло, чаще выходит не туда.',
    wrongStopLine: 'Слепая пересадка открыла двери до объявления. Не выходите первым.',
    unavailableLine: 'Черное табло щелкает, но посадки нет. Ждите белый экран.',
    noTicketLine: 'Слепая пересадка просит билет. Монета не проходит, зубной след иногда да.',
    requiredItem: 'metro_ticket',
    wrongStopChance: 0.42,
    cooldownSec: 28,
    destination: TO_ERROR,
    wrongStops: [TO_DEPOT],
    rumorIds: ['floor_metro_wrong_voice'],
    tags: ['blind_transfer', 'ticket', 'wrong_stop'],
  },
  {
    id: 'metro_depot_return',
    stationRoomName: METRO_DEPOT_ROOM_NAME,
    panelSlot: 0,
    label: 'Белая служебная петля',
    clue: METRO_ROUTE_CUE_LINES[4],
    departLine: 'Белая служебная петля взяла вас без билета. Идите по белым лампам обратно к платформе 19.',
    unavailableLine: 'Белая лампа горит, но проход закрыт. Ищите лампу у машины.',
    wrongStopChance: 0,
    cooldownSec: 8,
    destination: TO_STATION,
    wrongStops: [],
    safeReturn: true,
    rumorIds: ['floor_metro_depot'],
    tags: ['depot', 'safe_return', 'transfer'],
  },
  {
    id: 'metro_error_safe_return',
    stationRoomName: METRO_ERROR_ROOM_NAME,
    panelSlot: 0,
    label: 'Белый экран обратной станции',
    clue: 'Не слушай объявление: смотри на белый экран и возвращайся на платформу.',
    departLine: 'Белый экран принял выход. Двери закрываются, возвращайтесь к четырем табло.',
    unavailableLine: 'Белый экран моргает издалека, но обратный ход не работает. Подойдите ближе к экрану.',
    wrongStopChance: 0,
    cooldownSec: 10,
    destination: TO_STATION,
    wrongStops: [],
    safeReturn: true,
    rumorIds: ['floor_metro_wrong_voice'],
    tags: ['blind_transfer', 'safe_return', 'wrong_stop'],
  },
];

export function metroRouteForPanel(stationRoomName: string, panelSlot: number): MetroRouteDef | undefined {
  return METRO_ROUTES.find(r => r.stationRoomName === stationRoomName && r.panelSlot === panelSlot);
}

export function metroRoutesForRoom(stationRoomName: string): readonly MetroRouteDef[] {
  return METRO_ROUTES.filter(r => r.stationRoomName === stationRoomName);
}
