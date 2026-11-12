// ПРИБОР ВОСПРИЯТИЯ — перепись «КТО кого ЗАМЕЧАЕТ сегодня, и сколько из этих
// контактов идёт СКВОЗЬ СТЕНУ».
//
// ЗАЧЕМ ОН ЕСТЬ, И ПОЧЕМУ СТОИТ ДО ЛЕЧЕНИЯ. Зрения как системы в дереве нет:
// тело «замечает» тело СФЕРОЙ без геометрии — `behaviour_aggro_radius` у моба
// (`wander.cpp`, `investigate.cpp`), `kHuntRadius` у добычи (`hunt.cpp`),
// `kFeudRadius` у вражды (`faction_relations.cpp`), и ни один из этих сканов не
// спрашивает ни угла, ни заслонения. Прежде чем строить конус и заслонение,
// надо ЗАМЕРИТЬ, что именно они изменят: шесть заходов подряд правдоподобная
// модель оказывалась неверной, и каждый раз её опровергал прогон.
//
// ЧТО ИМЕННО СПРАШИВАЕТ. На одно посещение, по каждой паре (наблюдатель, цель)
// в пределах СЕГОДНЯШНЕГО радиуса наблюдателя:
//   1. прошла ли пара слой и дистанцию — это и есть сегодняшнее «вижу»;
//   2. попала ли бы она в конус ±45° (`kGazeCosHalfAngle` — единственный конус
//      в дереве) от направления хода;
//   3. чист ли субвоксельный луч между глазами — и если НЕТ, то сегодня тело
//      замечено СКВОЗЬ СТЕНУ.
// Плюс слух: кого слышит `loudest_heard` и сколько клеток материи лежит на
// пути звука (`sub_thickness_cells`).
//
// ЧЕМУ ПРИБОР НЕ ВЕРИТ: счётчикам самих проходов (`chasing`, `soundSteers`,
// `feudHits`). Они считают СОБЫТИЯ после всех лицензий (охоты, вражды, доли
// драчунов) и по построению не умеют сказать, сколько контактов геометрия
// отдала бы системе восприятия. Поэтому прибор лицензий НЕ применяет и мерит
// ГЕОМЕТРИЮ — это названо, а не спрятано.
//
// ЧЕСТНОСТЬ ЗАМЕРА. Прибор НИЧЕГО НЕ ПИШЕТ: ни скорости, ни полей мозга, ни
// заявки. Он читает мир и считает. Цена мерится ДВУМЯ таймерами вокруг
// РАЗДЕЛЁННЫХ циклов (дешёвые отсечки отдельно от маршей), потому что часы на
// каждый марш стоят в разы дороже самого марша и смешанный замер ответил бы на
// не заданный вопрос (четвёртый класс лжи прибора, §87).
#pragma once

#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/table_guard.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/combat.h"            // Dead — труп не наблюдатель и не цель
#include "game/embody.h"            // NpcRef — тождество жителя
#include "game/faction_relations.h" // kFeudRadius — сегодняшний радиус вражды
#include "game/guide.h"             // kWalkSpeedMps, steer_tangent — плоскость ходьбы
#include "game/investigate.h"       // kInvestigateHearing/MinSeverity — сегодняшний слух
#include "game/light_vis_bake.h"    // kLightVisDim/kLightVisCellM — решётка полей
#include "game/mob_behaviour.h"     // behaviour_aggro_radius, kGazeCosHalfAngle
#include "game/mob_spawn.h"         // MobRef
#include "game/mob_table.h"         // kMobTable — поведение по киндy
#include "game/noise.h"             // NoiseField, loudest_heard
#include "game/wander.h"            // kAggroRadius — база сегодняшнего зрения
#include "game/witness.h"           // kWitnessSightM, kEyeLiftM — глаз и дальность
#include "sim/camera.h"             // camera_forward — взгляд носителя камеры
#include "world/gravity.h"          // GravityFrame — плоскость ходьбы
#include "world/level_stack.h"      // LayerId
#include "world/los.h"              // sub_march, sub_thickness_cells
#include "world/macro_grid.h"
#include "world/types.h"            // kWorldExtent

namespace giga::game {

// КЛАСС НАБЛЮДАТЕЛЯ — по решателю (S13.7a), а не по компоненту: вопрос
// «кто кого видит» одинаков для монстра, жителя и человека, и прибор обязан
// задать его всем трём, иначе он замерит то же исключение игрока, которое
// лечится этим заходом.
enum class SightWho : std::uint8_t {
    Monster = 0,  // MobRef: радиус из поведения
    Resident,     // NpcRef без камеры: радиус вражды
    Human,        // носитель камеры: радиус свидетеля
    Count
};
constexpr std::size_t kSightWhoCount = static_cast<std::size_t>(SightWho::Count);

struct SightWhoRow {
    SightWho who;
    const char* name;
};
inline constexpr SightWhoRow kSightWhoRows[] = {{SightWho::Monster, "монстр"},
                                                {SightWho::Resident, "житель"},
                                                {SightWho::Human, "человек"}};
GIGA_TABLE_BY_ENUM(kSightWhoRows, &SightWhoRow::who, kSightWhoCount);

// Порог «тело идёт, значит у него есть направление хода» — один процент пешей
// скорости (`kWalkSpeedMps`, единственный дом числа 1.35). Выведено, а не
// выбрано: ниже этого тело стоит, и взгляд из скорости для него НЕВЫРАЗИМ —
// ровно то число, которое решает, годится ли скорость в источник взгляда.
inline constexpr float kSightMovingMps = kWalkSpeedMps * 0.01f;

// Сегодняшний радиус обнаружения наблюдателя — ТРИ разных закона, по одному на
// класс, и это перепись дерева, а не выбор прибора.
inline float sight_radius_today(SightWho who, const MobRef* mr) {
    if (who == SightWho::Monster && mr != nullptr &&
        static_cast<std::size_t>(mr->kind) < kMobKindCount)
        return behaviour_aggro_radius(
            static_cast<MobBehaviour>(
                mob_def(static_cast<MobKind>(mr->kind)).behaviour),
            kAggroRadius);
    if (who == SightWho::Resident) return kFeudRadius;
    return kWitnessSightM;
}

// ЧИСЛО ВОЗДУШНЫХ КАРМАНОВ КЛЕТКИ — 6-связных компонент ПУСТОТЫ среди её
// 8³ субвокселей (связность считается ВНУТРИ клетки; сосед не спрашивается).
//
// ЗАЧЕМ. Принятая к посадке форма поля обзора — «id области на МАКРОКЛЕТКУ»
// (CANON S25.8). Один id не может назвать две стороны перегородки, если она
// стоит ВНУТРИ клетки: тело по одну сторону и тело по другую получают один
// ответ. Аудит 2026-11-12 вывел арифметикой из генератора, что на падике
// стены стоят по ЦЕНТРУ клетки (`padic_gen.cpp` `kWallX34/kWallY34`) и таких
// клеток ~30 % плана; это ВЫВОД, и прибор обязан превратить его в ЗАМЕР
// прежде, чем форму поля понесут владельцу.
//
// Ноль — клетка твёрдая целиком, один — обычная клетка, два и больше —
// клетка РАСЩЕПЛЕНА материей на карманы, и поклеточное поле их не различит.
//
// Заливка бит-параллельная: слово маски есть один слой z (8×8 бит), сдвиги
// на 1 и на 8 — шаги по x и y, соседние слова — шаг по z. Живёт в ПРИБОРЕ, а
// не в `world/`: прод-читателя у вопроса пока нет, а примитив без читателя не
// заводится.
inline int cell_air_pockets(const SubMask& m) {
    static_assert(kSubDim == 8 && kSubMaskWords == 8,
                  "заливка стоит на раскладке «слово = слой z, 8×8 бит»");
    constexpr std::uint64_t kNotCol0 = 0xFEFEFEFEFEFEFEFEull;  // sx != 0
    constexpr std::uint64_t kNotCol7 = 0x7F7F7F7F7F7F7F7Full;  // sx != 7
    std::uint64_t air[kSubMaskWords];
    for (std::size_t i = 0; i < kSubMaskWords; ++i) air[i] = ~m.words[i];
    int pockets = 0;
    for (;;) {
        int seedZ = -1;
        for (int z = 0; z < kSubDim; ++z)
            if (air[z] != 0) {
                seedZ = z;
                break;
            }
        if (seedZ < 0) break;
        ++pockets;
        std::uint64_t comp[kSubMaskWords] = {};
        comp[seedZ] = air[seedZ] & (~air[seedZ] + 1);  // младший бит пустоты
        for (bool grew = true; grew;) {
            grew = false;
            for (int z = 0; z < kSubDim; ++z) {
                const std::uint64_t c = comp[z];
                std::uint64_t n = c | ((c << 1) & kNotCol0) |
                                  ((c >> 1) & kNotCol7) | (c << 8) | (c >> 8);
                if (z > 0) n |= comp[z - 1];
                if (z + 1 < kSubDim) n |= comp[z + 1];
                n &= air[z];
                if (n != c) {
                    comp[z] = n;
                    grew = true;
                }
            }
        }
        for (int z = 0; z < kSubDim; ++z) air[z] &= ~comp[z];
    }
    return pockets;
}

struct SightProbe {
    struct Cand {           // пара, прошедшая слой и дистанцию
        vec3 eye{0, 0, 0};  // глаз наблюдателя
        vec3 at{0, 0, 0};   // глаз цели
        std::uint8_t who = 0;
        bool inCone = false;
        bool targetHuman = false;
        bool split = false;  // глаз хоть одного из пары — в расщеплённой клетке
    };
    struct Ear {            // наблюдатель, который кого-то слышит
        vec3 ear{0, 0, 0};
        vec3 src{0, 0, 0};
    };
    struct Seen {           // тело с тождеством на слое — строка переписи
        Entity e;
        vec3 pos{0, 0, 0};
        const MobRef* mr = nullptr;
        bool human = false;
        bool split = false;  // клетка ГЛАЗА расщеплена на 2+ кармана
    };
    std::vector<Seen> census;
    std::vector<Cand> cand;  // переживают проходы — векторы не переаллоцируются зря
    std::vector<Ear> ears;

    // --- накопители за весь замер -------------------------------------------
    std::uint64_t passes = 0;                      // посещений (проходов прибора)
    std::uint64_t observers[kSightWhoCount] = {};  // Σ наблюдателей по классу
    std::uint64_t standing[kSightWhoCount] = {};   // из них стоят: взгляда из скорости НЕТ
    std::uint64_t seen[kSightWhoCount] = {};       // Σ пар в сегодняшнем радиусе
    std::uint64_t inCone[kSightWhoCount] = {};     // из них попали бы в конус ±45°
    std::uint64_t clear[kSightWhoCount] = {};      // из них луч ЧИСТ
    std::uint64_t thruWall[kSightWhoCount] = {};   // из них луч ПЕРЕКРЫТ (видит сквозь стену)
    std::uint64_t coneClear[kSightWhoCount] = {};  // конус И луч — что отдал бы новый проход
    std::uint64_t humanSeen = 0;                   // пар «кто-то видит человека»
    std::uint64_t humanThruWall = 0;               // из них сквозь стену

    std::uint64_t distTests = 0;   // Σ тестов дистанции (цена сегодняшнего скана)
    std::uint64_t rays = 0;        // Σ маршей
    std::uint64_t cheapNanos = 0;  // нс на отсечки (слой + дистанция + конус)
    std::uint64_t rayNanos = 0;    // нс на марши — ГЛАВНОЕ ЧИСЛО замера

    // --- ОКНО ПОЛЯ ОБЗОРА: на какой дальности живут контакты ------------------
    // Бины по 4 м — шаг клетки светосетки (`kLightVisCellM`), потому что поле
    // обзора обязано лечь на ТУ ЖЕ решётку, что поле света: единообразие полей
    // — требование владельца, а не вкус.
    static constexpr std::size_t kSightBins = 10;  // 0-4, 4-8, ... 36+ метров
    std::uint64_t distHist[kSightBins] = {};
    std::uint64_t cellsTotal = 0;   // клеток светосетки на этаже (одна перепись)
    std::uint64_t cellsSolid = 0;   // из них полностью твёрдые — поле им не нужно
    std::uint64_t cellsAir = 0;     // полностью пустые
    std::uint64_t cellsMixed = 0;   // смешанные: там и стоят тела
    // ТЕЛОПРИГОДНЫЕ — клетки, которым поле обзора НУЖНО: есть пустота и есть
    // опора (твердь в самой клетке или в клетке под ней). Воздух над крышей
    // поля не требует: в нём никто не стоит, и это прямой делитель размера.
    std::uint64_t cellsStandable = 0;
    bool cellsCounted = false;

    // --- КАРМАНЫ: чего стоит форма «id области на макроклетку» ----------------
    // Перепись ВСЕХ 128³ клеток этажа по числу воздушных карманов (0, 1, 2, 3,
    // 4+) — одна на замер; и то же про ГЛАЗА: сколько наблюдателей стоит в
    // расщеплённой клетке и сколько пар это задевает. Последнее и есть размер
    // ошибки поклеточного поля: для такой пары оно не различает стороны стены.
    static constexpr std::size_t kPocketBins = 5;
    std::uint64_t pocketHist[kPocketBins] = {};
    std::uint64_t eyesSplit[kSightWhoCount] = {};  // Σ наблюдателей в расщеплённой клетке
    std::uint64_t pairsSplit = 0;         // пар, где расщеплена клетка хоть одного глаза
    std::uint64_t pairsSplitBlocked = 0;  // из них луч ПЕРЕКРЫТ
    std::uint64_t pairsBlocked = 0;       // всего пар с перекрытым лучом

    // --- слух ----------------------------------------------------------------
    std::uint64_t earsTotal = 0;      // Σ мобов, спросивших поле шума
    std::uint64_t heard = 0;          // из них услышали хоть что-то
    std::uint64_t heardThruWall = 0;  // из них звук шёл через материю
    std::uint64_t blockersSum = 0;    // Σ клеток материи на путях звука
    std::uint64_t thickNanos = 0;     // нс на толщину
};

// ОДНО ПОСЕЩЕНИЕ. Зовётся раз в `kWanderPeriod` тиков (тем же стаггером, каким
// ходят заявители) — иначе прибор платил бы O(n²) каждый тик за вопрос, ответ
// на который между тиками почти не меняется.
inline void sight_probe_pass(Registry& reg, const MacroGrid& grid,
                             const NoiseField& noise, LayerId layer,
                             const GravityFrame& gf, SightProbe& p) {
    ++p.passes;
    p.cand.clear();
    p.ears.clear();

    // ПЕРЕПИСЬ РЕШЁТКИ — один раз за замер: сколько клеток светосетки 4 м
    // вообще нуждаются в поле обзора. Полностью твёрдой клетке поле не нужно
    // (в ней не стоят), и это прямой множитель размера структуры.
    if (!p.cellsCounted) {
        p.cellsCounted = true;
        for (const SubMask& m : grid.masks()) {
            // Пустая и полная клетки — без заливки: их на этаже большинство.
            const int n = m.empty() ? 1 : (m.full() ? 0 : cell_air_pockets(m));
            ++p.pocketHist[static_cast<std::size_t>(n) < SightProbe::kPocketBins
                               ? static_cast<std::size_t>(n)
                               : SightProbe::kPocketBins - 1];
        }
        for (int cz = 0; cz < kLightVisDim; ++cz)
            for (int cy = 0; cy < kLightVisDim; ++cy)
                for (int cx = 0; cx < kLightVisDim; ++cx) {
                    ++p.cellsTotal;
                    int solid = 0, empty = 0;
                    for (int oz = 0; oz < 2; ++oz)
                        for (int oy = 0; oy < 2; ++oy)
                            for (int ox = 0; ox < 2; ++ox) {
                                const SubMask& m = grid.mask(cx * 2 + ox,
                                                             cy * 2 + oy,
                                                             cz * 2 + oz);
                                if (m.full()) ++solid;
                                else if (m.empty()) ++empty;
                            }
                    if (solid == 8) ++p.cellsSolid;
                    else if (empty == 8) ++p.cellsAir;
                    else ++p.cellsMixed;
                    if (solid == 8) continue;  // в тверди не стоят
                    bool support = solid != 0 || empty != 8;
                    if (!support)  // пустая клетка: опора — в клетке под ней
                        for (int oy = 0; oy < 2 && !support; ++oy)
                            for (int ox = 0; ox < 2 && !support; ++ox) {
                                const SubMask& m =
                                    grid.mask(cx * 2 + ox, cy * 2 + oy,
                                              cz * 2 - 1);
                                support = !m.empty();
                            }
                    if (support) ++p.cellsStandable;
                }
    }

    // ПЕРЕПИСЬ ТЕЛ — по видам ТОЖДЕСТВА, а не по всем `Transform`. Первая
    // редакция обходила `view<const Transform>` дважды вложенно и платила
    // 22-83 мс на проход (216-246 тысяч пар, по три поиска в пулах на пару):
    // прибор замедлял кадр, который мерил. Тот же дефект и то же лечение, что
    // у самого прохода восприятия ([game/perceive.cpp] `census_bodies`).
    p.census.clear();
    {
        auto add = [&](Entity e, const Transform& tr) {
            if (tr.layer != layer) return;
            if (reg.all_of<Dead>(e)) return;
            // Клетка ГЛАЗА, а не центра тела: поле обзора спрашивают глазом.
            const SubMask& eyeCell =
                grid.mask(cell_of_metres(tr.pos.x), cell_of_metres(tr.pos.y),
                          cell_of_metres(tr.pos.z + kEyeLiftM));
            const bool split = !eyeCell.empty() && !eyeCell.full() &&
                               cell_air_pockets(eyeCell) >= 2;
            p.census.push_back(SightProbe::Seen{e, tr.pos,
                                                reg.try_get<MobRef>(e),
                                                reg.all_of<CameraTag>(e),
                                                split});
        };
        auto mobs = reg.view<const Transform, const MobRef>();
        for (auto e : mobs) add(e, mobs.get<const Transform>(e));
        auto npcs = reg.view<const Transform, const NpcRef>();
        for (auto e : npcs)
            if (!reg.all_of<MobRef>(e)) add(e, npcs.get<const Transform>(e));
        auto cams = reg.view<const Transform, const CameraTag>();
        for (auto e : cams)
            if (!reg.any_of<MobRef, NpcRef>(e))
                add(e, cams.get<const Transform>(e));
    }

    const auto t0 = std::chrono::steady_clock::now();
    for (const SightProbe::Seen& self : p.census) {
        const Entity e = self.e;
        const vec3& pos = self.pos;
        const MobRef* mr = self.mr;
        const bool human = self.human;
        const SightWho who = human      ? SightWho::Human
                             : mr != nullptr ? SightWho::Monster
                                             : SightWho::Resident;
        const std::size_t wi = static_cast<std::size_t>(who);
        ++p.observers[wi];
        if (self.split) ++p.eyesSplit[wi];

        // НАПРАВЛЕНИЕ ВЗГЛЯДА. У носителя камеры он есть полем
        // (`CameraTag::yaw/pitch` — единственное поле ориентации в движке), у
        // прочего тела его НЕТ НИГДЕ, и единственный выводимый кандидат —
        // скорость. Прибор мерит, сколько тел этот вывод НЕ ПОКРЫВАЕТ.
        vec3 fwd{0, 0, 0};
        bool haveDir = false;
        if (human) {
            const CameraTag& cam = reg.get<const CameraTag>(e);
            fwd = camera_forward(cam.yaw, cam.pitch);
            haveDir = true;
        } else if (const Velocity* vel = reg.try_get<Velocity>(e)) {
            const vec3 tan = steer_tangent(gf, vel->v.x, vel->v.y, vel->v.z);
            const float len = std::sqrt(tan.x * tan.x + tan.y * tan.y +
                                        tan.z * tan.z);
            if (len >= kSightMovingMps) {
                fwd = vec3{tan.x / len, tan.y / len, tan.z / len};
                haveDir = true;
            }
        }
        if (!haveDir) ++p.standing[wi];

        const float radius = sight_radius_today(who, mr);
        const float r2 = radius * radius;
        const vec3 eye{pos.x, pos.y, pos.z + kEyeLiftM};

        for (const SightProbe::Seen& other : p.census) {
            if (other.e == e) continue;
            const bool tHuman = other.human;
            ++p.distTests;
            const float d2 = wrap_dist2(pos, other.pos, kWorldExtent);
            if (d2 > r2) continue;
            ++p.seen[wi];
            if (tHuman) ++p.humanSeen;

            // ПЕЛЕНГ «ОТ СЕБЯ К ЦЕЛИ»: `wrap_delta_f(a,b)` есть `b − a`. Первая
            // редакция прибора держала аргументы НАОБОРОТ и мерила ЗАДНИЙ конус
            // (найдено аудитом 2026-11-12) — тот же дефект, что был пойман
            // гейтом в самом проходе восприятия, а в приборе пережил его.
            const float bx = wrap_delta_f(pos.x, other.pos.x, kWorldExtent);
            const float by = wrap_delta_f(pos.y, other.pos.y, kWorldExtent);
            const float bz = wrap_delta_f(pos.z, other.pos.z, kWorldExtent);
            bool cone = false;
            if (haveDir && d2 > 1e-6f) {
                const float bl = std::sqrt(d2);
                cone = (bx * fwd.x + by * fwd.y + bz * fwd.z) / bl >=
                       kGazeCosHalfAngle;
            } else if (haveDir) {
                cone = true;  // стою внутри цели — тот же закон, что у заморозки
            }
            if (cone) ++p.inCone[wi];
            {   // ОКНО: на какой дальности живёт этот контакт
                const std::size_t bin = static_cast<std::size_t>(
                    std::sqrt(d2) / kLightVisCellM);
                ++p.distHist[bin < SightProbe::kSightBins
                                 ? bin
                                 : SightProbe::kSightBins - 1];
            }
            // БЛИЖАЙШИЙ ОБРАЗ ЦЕЛИ, а не сырая координата: `sub_march` берёт
            // конец «как дан», и пара на шве тора маршировалась бы через
            // ПОЛМИРА — заслонена всегда. Тот же ответ, что у прохода
            // восприятия: конец строится от глаза по свёрнутому пеленгу.
            p.cand.push_back(SightProbe::Cand{
                eye, vec3{eye.x + bx, eye.y + by, eye.z + bz},
                static_cast<std::uint8_t>(wi), cone, tHuman,
                self.split || other.split});
        }
    }
    const auto t1 = std::chrono::steady_clock::now();
    p.cheapNanos += static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count());

    const auto t2 = std::chrono::steady_clock::now();
    for (const SightProbe::Cand& c : p.cand) {
        SubRayHit hit;
        const bool blocked = sub_march(grid, c.eye, c.at, hit);
        const std::size_t wi = c.who;
        if (blocked) ++p.pairsBlocked;
        if (c.split) {
            ++p.pairsSplit;
            if (blocked) ++p.pairsSplitBlocked;
        }
        if (blocked) {
            ++p.thruWall[wi];
            if (c.targetHuman) ++p.humanThruWall;
        } else {
            ++p.clear[wi];
            if (c.inCone) ++p.coneClear[wi];
        }
    }
    const auto t3 = std::chrono::steady_clock::now();
    p.rays += p.cand.size();
    p.rayNanos += static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(t3 - t2).count());

    // СЛУХ — тот же вопрос поля шума, что задаёт `investigate_step`, плюс
    // толщина материи на пути звука. Сегодня слух стен не знает вовсе, и это
    // число говорит, сколько он слышит через кладку.
    for (auto e : reg.view<const MobRef, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        ++p.earsTotal;
        float dist = 0.0f;
        const Noise* n = loudest_heard(noise, layer, tr.pos, kInvestigateHearing,
                                       kInvestigateMinSeverity,
                                       static_cast<std::uint32_t>(
                                           entt::to_integral(e)),
                                       &dist);
        if (n == nullptr) continue;
        ++p.heard;
        p.ears.push_back(SightProbe::Ear{
            vec3{tr.pos.x, tr.pos.y, tr.pos.z + kEyeLiftM},
            vec3{n->x, n->y, n->z}});
    }
    const auto t4 = std::chrono::steady_clock::now();
    for (const SightProbe::Ear& ea : p.ears) {
        const int blockers = sub_thickness_cells(grid, ea.ear, ea.src);
        if (blockers > 0) {
            ++p.heardThruWall;
            p.blockersSum += static_cast<std::uint64_t>(blockers);
        }
    }
    const auto t5 = std::chrono::steady_clock::now();
    p.thickNanos += static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(t5 - t4).count());
}

} // namespace giga::game
