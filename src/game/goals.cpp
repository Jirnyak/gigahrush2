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

GoalPick goals_pick_room(const float demand[kVerbCount],
                         const FloorRooms& rooms, const vec3& fromPos) {
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

    for (std::size_t i = 0; i < rooms.list.size(); ++i) {
        const Room& r = rooms.list[i];
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
        if (offerSum < best.score) continue; // даже даром не догонит

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

        // Ничью решает физика: интерес → расстояние (S13.2). Джиттер
        // личности — инкремент E. `>` строгий + сравнение дистанций, чтобы
        // порядок хранения не превращался в правило мира (S13.9).
        if (score > best.score ||
            (score == best.score && dist < best.distCells)) {
            best.room = static_cast<RoomId>(i + 1); // RoomId = индекс + 1
            best.score = score;
            best.distCells = dist;
            best.topVerb = top;
        }
    }
    return best;
}

} // namespace giga::game
