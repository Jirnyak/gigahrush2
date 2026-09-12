// Программа щитка (S15.4, посадка остатка time-watch 2026-09-05) — гейты:
//
//   1. shield_phase_level — чистая функция: жилой ритм 100→60→25→0 по
//      четырём фазам watch_light_phase, сдвиг фаз крутит КОЛЬЦО, «тьма» —
//      честный ноль (гасит свет без отдельной ветки: add_light отбрасывает
//      нулевую интенсивность).
//   2. stamp_shield_programs выводит программу из ДАННЫХ модуля: комната с
//      объявленным «спать» → жилой ритм; коридор → круглосуточно. Политика
//      — у генератора этажа (решение владельца 2026-09-05: «зависит от
//      дизайна этажа — могут быть щитки, которые светят круглосуточно»),
//      никаких битов-флажков (правило 2026-08-23).
//   3. assign_lamp_shields: лампа копирует программу БЛИЖАЙШЕГО щитка,
//      дистанция ТОРОИДАЛЬНАЯ (S1); не-mains лампа фаз не знает — ровно
//      как power cut (прибор со своим питанием).
//   4. Плафон гаснет вместе со светом (S15.4 шаг 4): сборщик инстансов
//      умножает emissive mains-лампы на уровень фазы.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "core/watch.h"
#include "game/flicker.h"
#include "game/prop_system.h"
#include "game/room.h"
#include "game/verb_table.h"

static void test_shield_phase_level_ring() {
    using namespace giga;
    using namespace giga::game;
    const std::uint8_t dwell[4] = {100, 60, 25, 0};
    for (int ph = 0; ph < kLightPhases; ++ph) {
        const std::uint64_t t =
            (static_cast<std::uint64_t>(ph) << kLightPhaseShift) + 1;
        CHECK(std::fabs(shield_phase_level(dwell, 0, t) -
                        static_cast<float>(dwell[ph]) * 0.01f) < 1e-6f);
    }
    const std::uint64_t tDark = (3ull << kLightPhaseShift) + 5;
    // «Тьма» — честный ноль, не эпсилон.
    CHECK(shield_phase_level(dwell, 0, tDark) == 0.0f);
    // Сдвиг фазы крутит кольцо: offset 1 на фазе 3 читает уровень фазы 0.
    CHECK(shield_phase_level(dwell, 1, tDark) > 0.99f);
    // Круглосуточный дефолт от тика не зависит.
    const std::uint8_t always[4] = {100, 100, 100, 100};
    CHECK(shield_phase_level(always, 0, tDark) > 0.99f);
}

static giga::Entity shield_test_spawn_shield(giga::Registry& reg,
                                             const giga::vec3& pos) {
    using namespace giga;
    using namespace giga::game;
    Entity e = reg.create();
    Transform tr{};
    tr.pos = pos;
    tr.layer = 0;
    reg.emplace<Transform>(e, tr);
    Interactable ia{};
    ia.kind = Interactable::Kind::ElectricalShield;
    reg.emplace<Interactable>(e, ia);
    return e;
}

static void test_shield_program_from_module_data() {
    using namespace giga;
    using namespace giga::game;
    FloorRooms fr;
    rooms_reset(fr);
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbSleep] = 30; // модуль объявил «спать» — жилая зона
    const RoomBox flat{10, 10, 10, 4, 4, 2};
    CHECK(room_declare(fr, &flat, 1, 0, 0, declared) != kNoRoom);

    Registry reg;
    const Entity inFlat = shield_test_spawn_shield(
        reg, vec3{11.0f * kCellSize + 1.0f, 11.0f * kCellSize + 1.0f,
                  10.0f * kCellSize + 1.0f});
    const Entity inHall = shield_test_spawn_shield(
        reg, vec3{60.0f * kCellSize, 60.0f * kCellSize, 10.0f * kCellSize});
    CHECK(stamp_shield_programs(reg, &fr, 0) == 2);

    const ShieldProgram& pf = reg.get<ShieldProgram>(inFlat);
    const ShieldProgram& ph = reg.get<ShieldProgram>(inHall);
    // Жилой ритм: полный → … → тьма.
    CHECK(pf.levels[0] == 100 && pf.levels[1] == 60 && pf.levels[2] == 25 &&
          pf.levels[3] == 0);
    // Коридорный — круглосуточный полный.
    CHECK(ph.levels[0] == 100 && ph.levels[3] == 100);
    // Перештамповка идемпотентна (S18: декларация — чистая функция).
    CHECK(stamp_shield_programs(reg, &fr, 0) == 2);
    CHECK(reg.get<ShieldProgram>(inFlat).levels[3] == 0);
}

static giga::Entity shield_test_spawn_lamp(giga::Registry& reg,
                                           const giga::vec3& pos,
                                           giga::game::FlickerProfile prof) {
    using namespace giga;
    using namespace giga::game;
    Entity e = reg.create();
    Transform tr{};
    tr.pos = pos;
    tr.layer = 0;
    reg.emplace<Transform>(e, tr);
    PropLight pl{};
    pl.intensity = 1.0f;
    pl.flicker = static_cast<std::uint8_t>(prof);
    reg.emplace<PropLight>(e, pl);
    return e;
}

static void test_lamp_takes_nearest_shield_wrapped() {
    using namespace giga;
    using namespace giga::game;
    Registry reg;
    // Два щитка с разными программами — руками, без stamp: юнит на привязку.
    const Entity sA = shield_test_spawn_shield(reg, vec3{2.0f, 50.0f, 50.0f});
    const Entity sB = shield_test_spawn_shield(reg, vec3{100.0f, 50.0f, 50.0f});
    ShieldProgram dwell{};
    dwell.levels[1] = 60; dwell.levels[2] = 25; dwell.levels[3] = 0;
    reg.emplace<ShieldProgram>(sA, dwell);
    reg.emplace<ShieldProgram>(sB, ShieldProgram{}); // круглосуточный

    // Лампа у шва тора: до щитка A через wrap 4 м, до Б — 154 м напрямую.
    const Entity lampWrap = shield_test_spawn_lamp(
        reg, vec3{kWorldExtent - 2.0f, 50.0f, 50.0f}, FlickerProfile::Mains);
    // Лампа рядом с Б.
    const Entity lampNear = shield_test_spawn_lamp(
        reg, vec3{104.0f, 50.0f, 50.0f}, FlickerProfile::Mains);
    // Не-mains лампа фаз не знает, даже вплотную к жилому щитку.
    const Entity lampAuto = shield_test_spawn_lamp(
        reg, vec3{3.0f, 50.0f, 50.0f}, FlickerProfile::None);

    CHECK(assign_lamp_shields(reg, 0) == 2); // привязаны только mains
    CHECK(reg.get<PropLight>(lampWrap).phaseLevels[3] == 0);   // взяла A wrap'ом
    CHECK(reg.get<PropLight>(lampNear).phaseLevels[3] == 100); // взяла Б
    CHECK(reg.get<PropLight>(lampAuto).phaseLevels[3] == 100); // дефолт цел
}

static void test_shield_plafond_dims_with_phase() {
    using namespace giga;
    using namespace giga::game;
    Registry reg;
    auto mk = [&](FlickerProfile prof) {
        Entity e = reg.create();
        Transform tr{};
        tr.pos = vec3{10.0f, 10.0f, 10.0f};
        tr.layer = 0;
        reg.emplace<Transform>(e, tr);
        PropMesh mesh{};
        mesh.emissive = 200;
        reg.emplace<PropMesh>(e, mesh);
        reg.emplace<StaticPropTag>(e);
        PropLight pl{};
        pl.flicker = static_cast<std::uint8_t>(prof);
        pl.phaseLevels[1] = 60; pl.phaseLevels[2] = 25; pl.phaseLevels[3] = 0;
        reg.emplace<PropLight>(e, pl);
        return e;
    };
    mk(FlickerProfile::Mains);
    mk(FlickerProfile::None); // свой источник питания — плафон не гаснет

    const std::uint64_t tDark = 3ull << kLightPhaseShift;
    std::vector<PropMeshInstance> out;
    CHECK(collect_static_prop_mesh_instances(reg, 0, tDark, out) == 2);
    // Порядок обхода view не пиннится — судим по МНОЖЕСТВУ значений.
    const std::uint8_t a = out[0].emissive, b = out[1].emissive;
    CHECK((a == 0 && b == 200) || (a == 200 && b == 0));

    out.clear();
    CHECK(collect_static_prop_mesh_instances(reg, 0, /*фаза 0*/ 0, out) == 2);
    CHECK(out[0].emissive == 200 && out[1].emissive == 200);
}

static void test_shield_all() {
    test_shield_phase_level_ring();
    test_shield_program_from_module_data();
    test_lamp_takes_nearest_shield_wrapped();
    test_shield_plafond_dims_with_phase();
}
