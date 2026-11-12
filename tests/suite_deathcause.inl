// ПРИЧИНЫ СМЕРТИ — СУД НАД СЧЁТОМ ([game/combat.h] `DeathCauses`).
//
// ЗАЧЕМ. Лог приёмки владельца 2026-11-12: на геометрии хрущей живых жителей
// 353 -> 60 за двенадцать секунд после входа. Спад жил как минимум с 9 ноября
// и не был виден ни одному числу в дереве. Счёт причин поставлен на
// единственную дверь смерти, и первым же прогоном ответил: ВСЕ 340 смертей —
// «удар о мир» (падение или удар), ни одной от монстра, жителя или нужд.
// Прибор, по которому будут лечить, обязан быть судим — прибор зрения три дня
// мерил задний конус ровно потому, что тестов у него не было.
//
// ЧТО СУДИТСЯ: вывод причины из `Dead::killer` и `Dead::channel` по всем шести
// строкам, раздельный счёт по классу жертвы и ПРЕД-ПРОХОД — убийца, умерший
// в том же пакете, обязан сохранить свой класс.
#include <cstddef>
#include <cstdint>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/combat.h"
#include "game/embody.h"     // NpcRef
#include "game/event_bus.h"
#include "game/mob_spawn.h"  // MobRef
#include "game/mob_table.h"
#include "game/needs.h"      // kAttritionChannel — канал истощения
#include "game/npc_pool.h"

static void test_deathcause_all() {
    using namespace giga;
    using namespace giga::game;

    Registry reg;
    NpcPool pool;
    pool.init();
    EventBus bus;
    bus.init();

    const auto resident = [&](const vec3& at) {
        const NpcId id = pool.spawn();
        pool.hp(id) = 0;
        pool.max_hp(id) = 100;
        const Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{at, 0});
        reg.emplace<NpcRef>(e, NpcRef{id});
        return e;
    };
    const auto mob = [&](const vec3& at) {
        const Entity e = reg.create();
        reg.emplace<Transform>(e, Transform{at, 0});
        const std::int16_t hp =
            static_cast<std::int16_t>(mob_def(MobKind::Zombie).hp);
        reg.emplace<MobRef>(
            e, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, hp, hp});
        return e;
    };
    const std::uint8_t kinetic =
        static_cast<std::uint8_t>(DamageChannel::Kinetic);
    const std::uint8_t attrition = static_cast<std::uint8_t>(kAttritionChannel);

    // ---- 1. ВЫВОД ПРИЧИНЫ — шесть строк, по одной жертве на каждую -----------
    const Entity monster = mob(vec3{10, 10, 10});
    const Entity human = resident(vec3{12, 10, 10});
    reg.emplace<CameraTag>(human);
    const Entity brawler = resident(vec3{14, 10, 10});
    const Entity gone = reg.create();   // убийца, которого уже нет
    reg.destroy(gone);

    const Entity vNeeds = resident(vec3{20, 10, 10});
    const Entity vFall = resident(vec3{22, 10, 10});
    const Entity vMob = resident(vec3{24, 10, 10});
    const Entity vHuman = resident(vec3{26, 10, 10});
    const Entity vFeud = resident(vec3{28, 10, 10});
    const Entity vGone = resident(vec3{30, 10, 10});
    const Entity vNoKiller = resident(vec3{32, 10, 10});

    CHECK(death_cause(reg, vNeeds, Dead{entt::null, attrition}) ==
          DeathCause::Attrition);
    // Убийцы нет, а канал НЕ истощение — причины нет: «без убийцы» не значит
    // «нужды». Мутация: отвечать `Attrition` на любой пустой убийца.
    CHECK(death_cause(reg, vNoKiller, Dead{entt::null, kinetic}) ==
          DeathCause::Unknown);
    CHECK(death_cause(reg, vFall, Dead{vFall, kinetic}) == DeathCause::Impact);
    CHECK(death_cause(reg, vMob, Dead{monster, kinetic}) == DeathCause::Monster);
    CHECK(death_cause(reg, vHuman, Dead{human, kinetic}) == DeathCause::Human);
    CHECK(death_cause(reg, vFeud, Dead{brawler, kinetic}) ==
          DeathCause::Resident);
    CHECK(death_cause(reg, vGone, Dead{gone, kinetic}) == DeathCause::Unknown);
    // ЧЕЛОВЕК СТАРШЕ ЖИТЕЛЯ: носитель камеры тоже несёт тождество жителя, и
    // переставленные проверки записали бы каждое убийство игрока на вражду.
    CHECK(reg.all_of<NpcRef>(human));
    // Строки таблицы — на своих местах (имя ищется индексом причины).
    for (std::size_t i = 0; i < kDeathCauseCount; ++i) {
        CHECK(kDeathCauseRows[i].cause == static_cast<DeathCause>(i));
        CHECK(kDeathCauseRows[i].name != nullptr);
    }

    // ---- 2. СЧЁТ НА ДВЕРИ СМЕРТИ, раздельно по классу жертвы ------------------
    //
    // ПРЕД-ПРОХОД — несущий. Монстр убил жителя и сам убит человеком В ТОМ ЖЕ
    // пакете; цикл уничтожения снимает с убитого монстра `MobRef`, и, приди
    // очередь жителя после него, классификация ВНУТРИ цикла увидела бы убийцу
    // без класса. `Dead` на монстра вешается ПОСЛЕ жертвы: вид обходит пул с
    // хвоста, значит монстр финализируется ПЕРВЫМ — ровно худший порядок.
    // Мутация: перенести счёт внутрь цикла.
    reg.emplace<Dead>(vNeeds, Dead{entt::null, attrition});
    reg.emplace<Dead>(vFall, Dead{vFall, kinetic});
    reg.emplace<Dead>(vMob, Dead{monster, kinetic});
    reg.emplace<Dead>(vFeud, Dead{brawler, kinetic});
    reg.emplace<Dead>(monster, Dead{human, kinetic});

    DeathCauses causes{};
    const std::uint32_t finalized =
        finalize_deaths(reg, pool, bus, 7u, nullptr, &causes);
    CHECK(finalized == 5u);
    const auto at = [](DeathCause c) { return static_cast<std::size_t>(c); };
    CHECK(causes.resident[at(DeathCause::Attrition)] == 1u);
    CHECK(causes.resident[at(DeathCause::Impact)] == 1u);
    CHECK(causes.resident[at(DeathCause::Monster)] == 1u);   // пред-проход
    CHECK(causes.resident[at(DeathCause::Resident)] == 1u);
    CHECK(causes.resident[at(DeathCause::Human)] == 0u);
    CHECK(causes.resident[at(DeathCause::Unknown)] == 0u);
    CHECK(causes.mob[at(DeathCause::Human)] == 1u);          // монстр — свой счёт
    std::uint32_t mobTotal = 0, resTotal = 0;
    for (std::size_t i = 0; i < kDeathCauseCount; ++i) {
        mobTotal += causes.mob[i];
        resTotal += causes.resident[i];
    }
    CHECK(mobTotal == 1u);
    CHECK(resTotal == 4u);   // сумма счёта равна числу финализированных
    // Без счётчика дверь работает как прежде — параметр необязателен.
    CHECK(finalize_deaths(reg, pool, bus, 8u) == 0u);
}
