#include "game/witness.h"

#include <cmath>
#include <cstdio>

#include "core/tick.h"      // kSimHz — каданс выцветания репутации
#include "core/wrap.h"
#include "ecs/components.h" // Transform
#include "game/embody.h"    // NpcRef
#include "game/noise.h"     // kNoiseRadiusCap — кап радиуса слуха свидетеля
#include "world/los.h"      // sub_march — зрение свидетеля
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

// Цена убийства ВЫВЕДЕНА из прежней константы всевидящего потребителя —
// засвидетельствованное убийство гнёт матрицу ровно как раньше гнулось
// любое; разошлись — значит, кто-то поменял одно и забыл второе.
static_assert(kVerbRelDelta[kVerbKill] == kKillRelationDelta,
              "цена глагола «убить» (verbs.csv) обязана равняться прежней "
              "kKillRelationDelta — поведение матрицы сохранено по выводу");

namespace {

// Высота глаз над позицией тела для луча зрения, метры. Та же половина
// роста, что у камеры (embody: камера в верхней части бокса) — точный глаз
// не нужен: луч субвоксельный, полметра решают «из-за прилавка не видно».
constexpr float kEyeLiftM = 0.6f;

// Выцветание репутации комнаты: раз в секунду rep -= rep >> 8 (минимум 1 к
// нулю). Вывод: экспонента 255/256 в секунду = полураспад ~3 мин — место
// помнит стычку дольше, чем длится бой, но не вечно; линейный хвост >>8
// добивает остаток до нуля, а не зависает на ±255.
constexpr int kRepDecayShift = 8;

std::uint8_t verb_of(std::uint32_t c) {
    return static_cast<std::uint8_t>(c >> 24);
}
void cell_of(std::uint32_t c, int& x, int& y, int& z) {
    x = static_cast<int>(c & 0xFFu);
    y = static_cast<int>((c >> 8) & 0xFFu);
    z = static_cast<int>((c >> 16) & 0xFFu);
}

} // namespace

void deed_publish(EventBus& bus, VerbId verb, Entity actor, NpcId victim,
                  const vec3& pos, std::uint64_t tick) {
    const int cx = wrap_macro(static_cast<int>(pos.x / kCellSize));
    const int cy = wrap_macro(static_cast<int>(pos.y / kCellSize));
    const int cz = wrap_macro(static_cast<int>(pos.z / kCellSize));
    const std::uint32_t c = (static_cast<std::uint32_t>(verb) << 24) |
                            (static_cast<std::uint32_t>(cz) << 16) |
                            (static_cast<std::uint32_t>(cy) << 8) |
                            static_cast<std::uint32_t>(cx);
    // Сентинел «актора нет» — целочисленный entt::null (все единицы), НЕ 0:
    // первая созданная сущность целочисленно РАВНА нулю, и ноль-сентинел
    // молча съедал бы её деяния (та же ловушка, что у noise ignoreActor).
    bus.publish(EventType::Deed,
                static_cast<std::uint32_t>(entt::to_integral(actor)),
                victim, c, tick);
}

WitnessTick witness_step(Registry& reg, NpcPool& pool, FactionRelations& rel,
                         EventBus& bus, FloorRooms& rooms, const World& world,
                         LayerId layer, std::uint64_t tick) {
    WitnessTick out;

    // Выцветание — секундный каданс, независимо от деяний.
    if (tick % static_cast<std::uint64_t>(kSimHz) == 0) {
        for (Room& r : rooms.list) {
            if (r.rep == 0) continue;
            int step = r.rep >> kRepDecayShift;
            if (step == 0) step = r.rep > 0 ? 1 : -1;
            r.rep = static_cast<std::int16_t>(r.rep - step);
        }
    }

    // Снапшот пачки ДО цикла: RelationChanged падают в то же кольцо
    // (образец relations_drain_deaths — иначе цикл ел бы собственный выход).
    const std::size_t n = bus.size();
    const Event* batch = bus.events();

    for (std::size_t i = 0; i < n; ++i) {
        const Event& ev = batch[i];
        if (ev.type != EventType::Deed) continue;
        ++out.deeds;

        const std::uint8_t verb = verb_of(ev.c);
        if (verb >= kVerbCount) continue;
        // Деяние без цены — не деяние для этой системы (publish легален,
        // цена нулевая: новая цена = правка CSV, не правка здесь).
        if (kVerbRelDelta[verb] == 0 && kVerbRepDelta[verb] == 0) continue;

        int dx = 0, dy = 0, dz = 0;
        cell_of(ev.c, dx, dy, dz);
        const vec3 deedPos{(static_cast<float>(dx) + 0.5f) * kCellSize,
                           (static_cast<float>(dy) + 0.5f) * kCellSize,
                           (static_cast<float>(dz) + 0.5f) * kCellSize};

        // Актор: только человек с записью двигает дипломатию (как в прежнем
        // потребителе смертей — деяние монстра не дипломатия). Сентинел —
        // entt::null (см. deed_publish), 0 — ЗАКОННЫЙ первый хэндл.
        const Entity actor = static_cast<Entity>(ev.a);
        if (actor == entt::null || !reg.valid(actor)) continue;
        if (!reg.all_of<NpcRef>(actor)) continue;
        const NpcId actorId = reg.get<const NpcRef>(actor).id;
        if (!pool.valid(actorId)) continue;
        const std::uint8_t rowA = rel_row(pool, actorId);

        // Жертва (опционально) — её строка нужна и гейту «враг свидетеля»,
        // и множителю «своя жертва».
        const NpcId victim = ev.b;
        const bool hasVictim = pool.valid(victim);
        const std::uint8_t rowV = hasVictim ? rel_row(pool, victim) : 0;

        // УМЕСТНОСТЬ (S19.1.3): комната сама предлагает глагол — цена ноль
        // целиком, тем же предложением, которым живёт выбор цели (S12.4).
        // Индекс напрямую (RoomId = индекс+1): репутация пишется в НАШ
        // список, const-ручка room_of тут была бы враньём.
        const RoomId rid = room_at(rooms, dx, dy, dz);
        Room* room = (rid != 0 && rid <= rooms.list.size())
                         ? &rooms.list[rid - 1]
                         : nullptr;
        if (room != nullptr && (room->declared[verb] > 0 ||
                                room->supply[verb] > 0)) {
            ++out.free;
            continue;
        }

        // СВИДЕТЕЛИ: воплощённые записи слоя, кроме актора. Дедуп по строке
        // матрицы — толпа одной фракции гнёт пару один раз за деяние.
        bool rowSeen[kRelFactionCount] = {};
        bool anyWitness = false;
        const float hearM = static_cast<float>(kVerbHearM[verb]);
        auto view = reg.view<const NpcRef, const Transform>();
        for (auto w : view) {
            if (w == actor) continue;
            const Transform& tr = view.get<const Transform>(w);
            if (tr.layer != layer) continue;
            const NpcId wid = view.get<const NpcRef>(w).id;
            if (!pool.valid(wid)) continue;

            // Исходо-эквивалентная отсечка ДО дистанции и луча (§66, дешёвая
            // половина — sound-field.md инкремент C): строка матрицы решается
            // ЛЮБЫМ воспринявшим её членом (все множители ниже построчные),
            // поэтому когда строка уже отреагировала — или свидетель свой,
            // чей вклад только anyWitness, — восприятие не добавит ничего,
            // ЕСЛИ замеченность уже установлена. Без anyWitness резать нельзя:
            // деяние при одних своих всё ещё ЗАМЕЧЕНО (репутация места).
            const std::uint8_t rowW = rel_row(pool, wid);
            if (anyWitness && (rowW == rowA || rowSeen[rowW])) continue;

            const float dist = std::sqrt(wrap_dist2(tr.pos, deedPos,
                                                    kWorldExtent));
            // Слух — прямолинейная тороидальная дистанция с капом радиуса:
            // ОДИН закон слышимости с журналом шумов (решение владельца
            // 2026-09-06, вырез акустики — problems.md §65). Проверяется
            // ПЕРВЫМ: услышанному деянию луч не нужен, а sub_march — вся цена
            // этой системы (§66); исход тот же, восприятие = слух ИЛИ зрение.
            bool perceived = hearM > 0.0f &&
                             dist <= (hearM < kNoiseRadiusCap ? hearM
                                                              : kNoiseRadiusCap);
            if (!perceived && dist <= kWitnessSightM) {
                const vec3 eye{tr.pos.x, tr.pos.y, tr.pos.z + kEyeLiftM};
                SubRayHit hit;
                perceived = !sub_march(world.grid(), eye, deedPos, hit);
            }
            if (!perceived) continue;
            anyWitness = true;

            if (rowW == rowA) continue;      // свои — преступление, не дипломатия
            if (rowSeen[rowW]) continue;     // эта фракция уже отреагировала
            rowSeen[rowW] = true;

            // Жертва, ВРАЖДЕБНАЯ свидетелю, зануляет цену для него:
            // лечишь врага — не заслуга, бьёшь врага — не преступление.
            if (hasVictim && rel.at(rowW, rowV) < 0) continue;

            int delta = kVerbRelDelta[verb];
            // Своя территория: свидетель из фракции собственника комнаты.
            if (room != nullptr && room->owner >= 1 &&
                room->owner <= kFactionCount &&
                static_cast<std::uint8_t>(room->owner - 1) == rowW)
                delta = delta * kVerbTurfMultE3[verb] / 1000;
            // Своя жертва: жертва из фракции свидетеля.
            if (hasVictim && rowV == rowW)
                delta = delta * kVerbVictimMultE3[verb] / 1000;
            if (delta == 0) continue;

            const std::int8_t nv = rel.add_mutual(rowA, rowW, delta);
            ++out.changes;
            bus.publish(EventType::RelationChanged, rowA, rowW,
                        pack_relation(nv), tick);
        }

        if (anyWitness) {
            ++out.witnessed;
            // Репутация места — одна запись на комнату (S13.6), раз за
            // деяние, только ЗАМЕЧЕННОЕ: незамеченное не имеет цены нигде.
            if (room != nullptr) {
                const int nr = room->rep + kVerbRepDelta[verb];
                room->rep = static_cast<std::int16_t>(
                    nr < -32000 ? -32000 : (nr > 32000 ? 32000 : nr));
            }
        }
    }
    return out;
}

} // namespace giga::game
