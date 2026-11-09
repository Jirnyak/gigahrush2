// ПРИБОР ВЕДЕНИЯ — перепись «КТО написал скорость ЭТОГО тела в ЭТОМ тике».
//
// ЗАЧЕМ ОН ЕСТЬ, И ПОЧЕМУ ПОСТАВЛЕН ДО ЛЕЧЕНИЯ. Шапка [game/ai.h] утверждает
// закон: «для данного тела в данном тике горизонтальную `Velocity` пишет ровно
// одна система», и держится он ТОКЕНОМ (`AiBrain::motion`), а не построением.
// Перепись 2026-11-09 нашла восемь писателей-рулевых, из которых токен читают
// ЧЕТЫРЕ (`wander_step`, `faction_feud_step`, `ai_patrol_step`,
// `place_errand_step`), причём четвёртый спрашивает ДРУГОЕ («ровно `Ai`»
// вместо списка владельцев), а `investigate_step` не читает его вовсе и стоит
// в кадре ПОСЛЕ прогулки с ТЕМ ЖЕ слотом стаггера. То есть «писатель один» —
// это МОДЕЛЬ, а четыре захода подряд правдоподобная модель оказывалась
// неверной, и каждый раз её опровергал прогон, а не чтение кода.
//
// ЧЕМУ ПРИБОР НЕ ВЕРИТ: счётчикам самих проходов (`walking`, `chasing`,
// `steered`). Они считают СОБЫТИЯ внутри прохода и по построению не умеют
// сказать, что то же тело в том же тике написал кто-то ещё. Два писателя,
// пишущих ОДИН И ТОТ ЖЕ НОЛЬ (`stop()` прогулки против обнуления вражды), не
// различимы вовсе ничем, кроме часового.
//
// КАК УСТРОЕН. До цепочки в обе ТАНГЕНЦИАЛЬНЫЕ оси каждого тела ставится
// часовой, уникальный на звено; после каждого звена прибор спрашивает, у кого
// часовой стёрт, — это и есть писатели, по одному вопросу на тело на звено.
// Ось гравитации не трогается ВООБЩЕ: её владелец `physics_step`, и часовой в
// ней был бы вторым писателем от самого прибора.
//
// ЧЕСТНОСТЬ ЗАМЕРА. `steer_probe_end` возвращает телу значение ПОСЛЕДНЕГО
// писателя (или прошлую скорость, если не писал никто), и стоит перед
// `slow_step`, поэтому мир за время замера идёт как шёл: последний писатель
// побеждает — ровно как без прибора. Единственное, что прибор меняет: между
// звеньями в скорости лежит часовой, и код, который её ЧИТАЕТ (прозрачность
// стелс-мобов в `main.cpp`), на этих тиках читает часового. Это видно и
// названо, а не спрятано.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/table_guard.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/ai.h"      // decider_of — ЧЬЁ это тело (S13.7a)
#include "game/embody.h"  // NpcRef — тождество жителя
#include "world/gravity.h"
#include "world/level_stack.h"  // LayerId

namespace giga::game {

// ЗВЕНЬЯ ЦЕПОЧКИ — в порядке кадра, а не важности. Имя звена называет то, что
// бежало МЕЖДУ прошлым вопросом и этим: если скорость тела изменил кто-то, кого
// в этом списке нет, его запись припишется следующему звену — и это находка, а
// не погрешность прибора.
enum class SteerLink : std::uint8_t {
    Flee = 0,  // ai_step
    Player,    // controller_step
    Patrol,    // ai_patrol_step
    Errand,    // place_errand_step (ход по делам + «держать на месте»)
    Walk,      // wander_step (прогулка + погоня + заморозка взглядом)
    Guide,     // guide_step — ОДИН проход ведения (единственный писатель)
    Noise,     // investigate_step
    Feud,      // faction_feud_step
    Count
};
constexpr std::size_t kSteerLinkCount = static_cast<std::size_t>(SteerLink::Count);

// Имя звена несёт СВОЙ ЭНУМ КОЛОНКОЙ ([core/table_guard.h]): таблица
// индексируется значением, и перестановка энума заставила бы её отвечать на
// чужой вопрос, пройдя и сборку, и ctest.
struct SteerLinkRow {
    SteerLink link;
    const char* name;
};
inline constexpr SteerLinkRow kSteerLinkRows[] = {
    {SteerLink::Flee, "бегство"},  {SteerLink::Player, "игрок"},
    {SteerLink::Patrol, "наряд"},  {SteerLink::Errand, "дело"},
    {SteerLink::Walk, "прогулка"}, {SteerLink::Guide, "ВЕДЕНИЕ"},
    {SteerLink::Noise, "слух"},    {SteerLink::Feud, "вражда"}};
GIGA_TABLE_BY_ENUM(kSteerLinkRows, &SteerLinkRow::link, kSteerLinkCount);

// Часовой — пара несовместимых со скоростью чисел, уникальная на звено.
// Сравнение ТОЧНОЕ: часовой либо стёрт записью, либо нет, и «почти равно» тут
// было бы вторым ответом (запись могла дать и ноль, и любое маленькое число).
constexpr float steer_sentinel_a(std::size_t link) {
    return -98765.0f - static_cast<float>(link);
}
constexpr float steer_sentinel_b(std::size_t link) {
    return -87654.0f - static_cast<float>(link);
}

// Ось числом — ветками, а не индексацией `&v.x`: арифметика указателя по полям
// структуры формально УБ, а вся плоскость ходьбы в этом дереве и так читается
// ветками по `gf.axis` ([world/gravity.h]).
inline float steer_axis(const vec3& v, int axis) {
    return axis == 0 ? v.x : (axis == 1 ? v.y : v.z);
}
inline void steer_axis_set(vec3& v, int axis, float value) {
    if (axis == 0) v.x = value;
    else if (axis == 1) v.y = value;
    else v.z = value;
}

struct SteerProbe {
    struct Row {
        Entity e = entt::null;
        vec3 before{0.0f, 0.0f, 0.0f};  // скорость ДО цепочки
        vec3 last{0.0f, 0.0f, 0.0f};    // что написал последний писатель
        std::uint8_t writers = 0;       // сколько звеньев написали это тело
        std::uint8_t dec = 0;           // Decider: чьё тело
        std::uint8_t firstLink = 0;     // кто написал ПЕРВЫМ
        bool agent = false;             // тело с тождеством, а не проп/обломок
    };
    std::vector<Row> rows;  // переживает тики — вектор не переаллоцируется зря
    GravityFrame gf{};

    // --- накопители за весь замер -------------------------------------------
    std::uint64_t ticks = 0;
    std::uint64_t bodies = 0;                      // Σ тел под часовым
    std::uint64_t agents = 0;                      // из них с тождеством
    std::uint64_t otherWritten = 0;                // НАХОДКА: рулевой написал проп
    std::uint64_t wrote[kSteerLinkCount] = {};     // Σ записей звена
    std::uint64_t stole[kSteerLinkCount] = {};     // из них — поверх чужой записи
    std::uint64_t firstBy[kSteerLinkCount] = {};   // Σ «написал первым»
    std::uint64_t writersHist[kSteerLinkCount + 1] = {};  // тел с 0,1,2... писателями
    std::uint64_t twice = 0;                       // Σ тел с ≥2 писателями
    std::uint64_t never = 0;                       // Σ тел без писателя (дрейф)
    std::uint64_t neverByDec[4] = {};              // дрейф по решателю
};

// Взвести часовых и запомнить, что было. Вид — все тела со скоростью на слое:
// отбор «кого ведут» прибору не положен, иначе он ответит на уже решённый
// вопрос. Труп и носитель камеры входят тоже, и это тот же вопрос в том же
// месте (S13.7a).
inline void steer_probe_begin(Registry& reg, LayerId layer,
                              const GravityFrame& gf, SteerProbe& p) {
    p.gf = gf;
    p.rows.clear();
    const float sa = steer_sentinel_a(0), sb = steer_sentinel_b(0);
    auto view = reg.view<const Transform, Velocity>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        Velocity& vel = view.get<Velocity>(e);
        SteerProbe::Row r;
        r.e = e;
        r.before = vel.v;
        r.dec = static_cast<std::uint8_t>(decider_of(reg, e));
        // ТОЖДЕСТВО СПРАШИВАЕТСЯ ОТДЕЛЬНО, и это лечение четвёртого класса лжи
        // прибора (§87): `decider_of` отдаёт `Resident` ВСЕМУ, у чего нет
        // `Corpse`/`CameraTag`/`MobRef`, то есть пропу, обломку и снаряду тоже.
        // Первая редакция этой переписи сложила их в «жителей» и честно
        // ответила на НЕ ЗАДАННЫЙ вопрос: 497 тел на тик при толпе 420.
        r.agent = reg.all_of<NpcRef>(e) || reg.all_of<MobRef>(e) ||
                  reg.all_of<CameraTag>(e);
        p.rows.push_back(r);
        steer_axis_set(vel.v, gf.tanA, sa);
        steer_axis_set(vel.v, gf.tanB, sb);
    }
    ++p.ticks;
}

// Спросить, кто стёр часового этого звена, и взвести часового следующего.
// Взводится ВСЕМ, включая уже написанных: иначе звено, пишущее то же значение,
// что предыдущее (два нуля), осталось бы невидимым — ровно тот случай, ради
// которого прибор и существует.
inline void steer_probe_after(Registry& reg, SteerLink link, SteerProbe& p) {
    const std::size_t k = static_cast<std::size_t>(link);
    const float sa = steer_sentinel_a(k), sb = steer_sentinel_b(k);
    const bool more = (k + 1) < kSteerLinkCount;
    const float na = steer_sentinel_a(k + 1), nb = steer_sentinel_b(k + 1);
    const int a = p.gf.tanA, b = p.gf.tanB;
    for (SteerProbe::Row& r : p.rows) {
        Velocity* vel = reg.try_get<Velocity>(r.e);
        if (vel == nullptr) continue;  // тело умерло внутри цепочки
        if (steer_axis(vel->v, a) != sa || steer_axis(vel->v, b) != sb) {
            if (r.writers == 0) {
                r.firstLink = static_cast<std::uint8_t>(k);
                ++p.firstBy[k];
            } else {
                ++p.stole[k];
            }
            ++r.writers;
            ++p.wrote[k];
            r.last = vel->v;
        }
        if (more) {
            steer_axis_set(vel->v, a, na);
            steer_axis_set(vel->v, b, nb);
        }
    }
}

// Снять часовых: тело получает значение последнего писателя, а не писанное
// никем — свою прошлую скорость. Здесь же копятся итоги тика.
inline void steer_probe_end(Registry& reg, SteerProbe& p) {
    const int a = p.gf.tanA, b = p.gf.tanB;
    for (const SteerProbe::Row& r : p.rows) {
        Velocity* vel = reg.try_get<Velocity>(r.e);
        if (vel != nullptr) {
            const vec3& src = r.writers != 0 ? r.last : r.before;
            steer_axis_set(vel->v, a, steer_axis(src, a));
            steer_axis_set(vel->v, b, steer_axis(src, b));
        }
        ++p.bodies;
        if (!r.agent) {
            // Рулевой, написавший проп, — находка, а не строка переписи.
            if (r.writers != 0) ++p.otherWritten;
            continue;
        }
        ++p.agents;
        const std::size_t w = r.writers < kSteerLinkCount ? r.writers
                                                          : kSteerLinkCount;
        ++p.writersHist[w];
        if (r.writers >= 2) ++p.twice;
        if (r.writers == 0) {
            ++p.never;
            ++p.neverByDec[r.dec < 4 ? r.dec : 3];
        }
    }
}

} // namespace giga::game
