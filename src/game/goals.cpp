#include "game/goals.h"

#include <cmath>

#include "game/needs.h"  // kNeedMax — одна шкала дефицита у всех нужд
#include "world/types.h" // kCellSize, kMacroDim — позиция → клетки, wrap маской

namespace giga::game {

void goals_demand_from_needs(const Needs& n, float demand[kVerbCount]) {
    for (std::size_t v = 0; v < kVerbCount; ++v) demand[v] = 0.0f;
    // Дефицит бара 0..1 — та же шкала у всех нужд (kNeedMax один на клок).
    const auto deficit = [](float bar) {
        const float d = 1.0f - bar / kNeedMax;
        return d < 0.0f ? 0.0f : (d > 1.0f ? 1.0f : d);
    };
    demand[kVerbEat] = deficit(n.food);
    demand[kVerbDrink] = deficit(n.water);
    demand[kVerbSleep] = deficit(n.sleep);
    // Давления растут К капу — спрос прямой, не дефицит.
    const float pressure = (n.pee > n.poo ? n.pee : n.poo) / kNeedMax;
    demand[kVerbToilet] = pressure < 0.0f ? 0.0f : (pressure > 1.0f ? 1.0f : pressure);
    demand[kVerbWander] = kWanderDemandFloor; // никогда не ноль (S13.2)
}

// Тороидальная дистанция точки до бокса по одной оси, в клетках: сдвигаем
// точку в кадр бокса wrap-маской — внутри интервала ноль, иначе ближний
// край с учётом заворота (S1: бокс на шве законен).
static float axis_dist_cells(float p, std::uint8_t origin, std::uint8_t size) {
    const float dim = static_cast<float>(kMacroDim);
    float dp = p - static_cast<float>(origin);
    dp -= dim * std::floor(dp / dim); // [0, dim)
    const float s = static_cast<float>(size);
    if (dp < s) return 0.0f;
    const float past = dp - s;
    const float wrapBack = dim - dp;
    return past < wrapBack ? past : wrapBack;
}

// Судить одну комнату той же суммой, что и раньше, — вынесено из обхода,
// чтобы бины меняли только ПОРЯДОК посещения, а не математику (гейт-оракул
// в suite_goals пиннит тождество с полным перебором).
static void judge_room(const float demand[kVerbCount], const FloorRooms& rooms,
                       std::size_t i, float px, float py, float pz,
                       GoalPick& best) {
    const Room& r = rooms.list[i];
    ++best.scored;
    // Предложение = ОБЪЯВЛЕНО + ОСНАЩЕНИЕ/ЗАПАС (S12.4). Скалярное
    // произведение — единственная операция; глагол, давший наибольший
    // вклад, запоминается для отладки.
    float offerSum = 0.0f;
    VerbId top = kVerbWander;
    float topContrib = 0.0f;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        const float offer = static_cast<float>(r.declared[v]) +
                            static_cast<float>(r.supply[v]);
        const float c = demand[v] * offer;
        offerSum += c;
        if (c > topContrib) {
            topContrib = c;
            top = static_cast<VerbId>(v);
        }
    }
    // Строгое `<`: комната, чей потолок РАВЕН текущему лидеру, обязана
    // дойти до честного сравнения дистанций — иначе порядок хранения
    // решил бы ничью (S13.9 «фиксированный префикс»).
    if (offerSum < best.score) return; // даже даром не догонит

    // Честная дистанция до КОМПОЗИЦИИ боксов (мин по боксам), тором.
    float d2min = -1.0f;
    for (std::uint32_t b = 0; b < r.boxCount; ++b) {
        const RoomBox& bx = rooms.boxes[r.boxFirst + b];
        const float dx = axis_dist_cells(px, bx.x, bx.sx);
        const float dy = axis_dist_cells(py, bx.y, bx.sy);
        const float dz = axis_dist_cells(pz, bx.z, bx.sz);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2min < 0.0f || d2 < d2min) d2min = d2;
    }
    const float dist = d2min > 0.0f ? std::sqrt(d2min) : 0.0f;
    const float score = offerSum - dist * kGoalCostPerCell;

    const RoomId id = static_cast<RoomId>(i + 1); // RoomId = индекс + 1
    // Ничью решает физика: интерес → расстояние (S13.2); двойную ничью —
    // меньший RoomId, чтобы победитель не зависел от порядка ОБХОДА бинов
    // (S13.9; джиттер личности заменит это в E). `>` строгий.
    if (score > best.score ||
        (score == best.score &&
         (dist < best.distCells ||
          (dist == best.distCells &&
           (best.room == kNoRoom || id < best.room))))) {
        best.room = id;
        best.score = score;
        best.distCells = dist;
        best.topVerb = top;
    }
}

GoalPick goals_pick_room(const float demand[kVerbCount],
                         const FloorRooms& rooms, const vec3& fromPos,
                         GoalsScratch& scratch) {
    const float px = fromPos.x / kCellSize;
    const float py = fromPos.y / kCellSize;
    const float pz = fromPos.z / kCellSize;

    // ТОЧКА ПОД НОГАМИ — кандидат всегда, поэтому пустого списка не бывает
    // и ветка «ничего не нашлось» не существует (S13.9). Пол предлагает
    // базовый минимум ФОРМЫ: спать плохо, укрыться плохо.
    GoalPick best;
    best.room = kNoRoom;
    best.distCells = 0.0f;
    best.score = kFloorPointOffer *
                 (demand[kVerbSleep] + demand[kVerbShelter] +
                  demand[kVerbWander]);
    best.topVerb = kVerbSleep;
    if (rooms.list.empty()) return best;

    // Этаж без бинов (тесты, собравшие FloorRooms руками до rooms_reset,
    // не существуют: room_declare требует reset) — но пустые бины при
    // непустом списке означали бы дыру штампа; полный перебор честнее
    // молчаливого нуля кандидатов.
    if (rooms.bins.size() != kRoomBinCount) {
        for (std::size_t i = 0; i < rooms.list.size(); ++i)
            judge_room(demand, rooms, i, px, py, pz, best);
        return best;
    }

    // ВЫВЕДЕННЫЙ ПОТОЛОК ИНТЕРЕСА (S13.2): больше, чем Σ спрос·maxOffer,
    // не предлагает ни одна комната этажа — храповик maxOffer верхний по
    // построению (room.h). Отсюда радиус: шелл s бинов лежит не ближе
    // (s−1)·ребро клеток, и когда потолок минус путь шелла не догоняет
    // лидера — дальше можно не ходить. Это та же отсечка
    // «offerSum < best.score», поднятая с комнаты на объём. Активные
    // глаголы (спрос > 0) собраны заранее: у нужд их единицы из kVerbCount,
    // и проверка потолка бина обязана стоить единицы умножений.
    float offerCeil = 0.0f;
    std::uint8_t activeVerb[kVerbCount];
    std::size_t activeCount = 0;
    for (std::size_t v = 0; v < kVerbCount; ++v) {
        if (demand[v] <= 0.0f) continue;
        activeVerb[activeCount++] = static_cast<std::uint8_t>(v);
        if (rooms.maxOffer[v] > 0)
            offerCeil += demand[v] * static_cast<float>(rooms.maxOffer[v]);
    }

    // Штамп эпохи: комната лежит в нескольких бинах — судится один раз.
    if (scratch.stamp.size() < rooms.list.size())
        scratch.stamp.assign(rooms.list.size(), 0);
    if (++scratch.epoch == 0) { // перенос u16 — обнулить и начать с 1
        scratch.stamp.assign(scratch.stamp.size(), 0);
        scratch.epoch = 1;
    }

    const int binEdge = 1 << kRoomBinShift;
    const int bx0 = static_cast<int>(std::floor(px)) >> kRoomBinShift;
    const int by0 = static_cast<int>(std::floor(py)) >> kRoomBinShift;
    const int bz0 = static_cast<int>(std::floor(pz)) >> kRoomBinShift;

    // Потолок БИНА решает, судить ли его комнаты: Σ спрос·binCeil минус
    // нижняя грань пути шелла — верхняя грань score любой комнаты бина.
    // Сравнение СТРОГОЕ: бин, чей потолок точно равен лидеру, обязан быть
    // сужен — ничья решается дистанцией и RoomId, а не пропуском (S13.9).
    const auto visit_bin = [&](int bx, int by, int bz, float minDist) {
        const std::size_t bi = room_bin_index(bx, by, bz);
        if (rooms.bins[bi].empty()) return; // толща/коридорный объём
        const std::int32_t* ceil = &rooms.binCeil[bi * kVerbCount];
        float binCap = 0.0f;
        for (std::size_t a = 0; a < activeCount; ++a) {
            const std::size_t v = activeVerb[a];
            if (ceil[v] > 0) binCap += demand[v] * static_cast<float>(ceil[v]);
        }
        if (binCap - minDist * kGoalCostPerCell < best.score) return;
        for (const RoomId id : rooms.bins[bi]) {
            const std::size_t i = static_cast<std::size_t>(id) - 1;
            if (scratch.stamp[i] == scratch.epoch) continue;
            scratch.stamp[i] = scratch.epoch;
            judge_room(demand, rooms, i, px, py, pz, best);
        }
    };

    // Шеллы Чебышёва в бин-координатах; тор заворачивает maxShell на
    // полуразмере решётки (дальше объёмы уже посещены с другой стороны).
    // Нижняя грань дистанции шелла s: агент где-то в своём бине, между ним
    // и шеллом лежит s−1 полных бинов ⇒ ≥ (s−1)·ребро (для s ≤ 1 — ноль).
    const int maxShell = kRoomBinDim / 2;
    for (int s = 0; s <= maxShell; ++s) {
        const float shellMin =
            s <= 1 ? 0.0f : static_cast<float>((s - 1) * binEdge);
        if (s == 0) {
            visit_bin(bx0, by0, bz0, 0.0f);
        } else {
            // Шесть граней куба радиуса s — ровно поверхность, без
            // повторного скана внутренности (иначе обход квадратичен).
            for (int dy = -s; dy <= s; ++dy)
                for (int dx = -s; dx <= s; ++dx) {
                    visit_bin(bx0 + dx, by0 + dy, bz0 - s, shellMin);
                    visit_bin(bx0 + dx, by0 + dy, bz0 + s, shellMin);
                }
            for (int dz = -s + 1; dz <= s - 1; ++dz)
                for (int dx = -s; dx <= s; ++dx) {
                    visit_bin(bx0 + dx, by0 - s, bz0 + dz, shellMin);
                    visit_bin(bx0 + dx, by0 + s, bz0 + dz, shellMin);
                }
            for (int dz = -s + 1; dz <= s - 1; ++dz)
                for (int dy = -s + 1; dy <= s - 1; ++dy) {
                    visit_bin(bx0 - s, by0 + dy, bz0 + dz, shellMin);
                    visit_bin(bx0 + s, by0 + dy, bz0 + dz, shellMin);
                }
        }
        // Стоп СТРОГИЙ: шелл s+1 (грань ≥ s·ребро) пропускается, только
        // когда даже ничья по очкам там невозможна — ничья с меньшей
        // дистанцией легально бьёт лидера (S13.2), пропускать её нельзя.
        const float nextMinDist = static_cast<float>(s * binEdge);
        if (offerCeil - nextMinDist * kGoalCostPerCell < best.score) break;
    }
    return best;
}

} // namespace giga::game
