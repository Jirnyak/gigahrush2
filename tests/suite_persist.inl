// Персистентность этажа (CANON S20.6, инкремент F) — floor file v3.
//
// Четыре закона, каждый гейтится обеими полярностями:
//   1. Стабильный ID: записи самодостаточны, entt-хэндл и позиционный ключ в
//      провод не едут — гейт здесь round-trip'ом бит-в-бит (мультимножество
//      записей после восстановления кодируется в ТЕ ЖЕ байты).
//   2. Restore не сеет — ветка живёт в main; здесь её фундамент:
//      gather → spawn → gather идемпотентен (ничего не досеялось и не
//      потерялось).
//   3. Якорная проба restore: мёртвый якорь = честный детач, живой = статика.
//   4. Версия генерации модуля: несовпадение ключа = ModuleChanged, мир не
//      тронут; совпадение = принят.
//
// Included into game_test.cpp (its CHECK macro, `using namespace giga::game`).
#include "game/save.h"
#include "game/loot.h"
#include "game/door.h"
#include "game/event_bus.h"
#include "game/prop_system.h"
#include "game/floor_gen.h"
#include "sim/rigid.h"
#include "world/materials.h"

namespace persist_test {

// Мини-этаж: одна плита-опора, чтобы якоря было к чему жить. Не generate_floor
// — законы v3-файла проверяются на голом гриде быстрее и точнее.
void build_slab(World& w) {
    for (int x = 8; x < 16; ++x)
        for (int y = 8; y < 16; ++y)
            w.grid().fill_cell(x, y, 10, kMatConcrete);
}

SubVoxelAnchor top_anchor(int cx, int cy, int cz) {
    // Вещь СТОИТ на опоре: грань Z+, точка — центр.
    return anchor_centre(cx, cy, cz, anchor_face_pack(2, 1));
}

// Кодировка мультимножества записей: файл целиком (геометрия одинакова по
// построению), порядок записей нормализуется сортировкой секций по ПОЛЯМ
// (позиция точна — float копируется как есть). Не memcmp структур: там
// padding. Так «бит-в-бит» не зависит от порядка обхода view EnTT.
std::vector<std::uint8_t> canonical_file(const World& w, int floor,
                                         FloorEntityState ents,
                                         const FloorModuleKey& key) {
    auto posLess = [](const vec3& a, const vec3& b) {
        if (a.x != b.x) return a.x < b.x;
        if (a.y != b.y) return a.y < b.y;
        return a.z < b.z;
    };
    std::sort(ents.props.begin(), ents.props.end(),
              [&](const PropRecord& a, const PropRecord& b) {
                  if (a.propId != b.propId) return a.propId < b.propId;
                  return posLess(a.pos, b.pos);
              });
    std::sort(ents.corpses.begin(), ents.corpses.end(),
              [&](const CorpseRecord& a, const CorpseRecord& b) {
                  return posLess(a.pos, b.pos);
              });
    std::sort(ents.pickups.begin(), ents.pickups.end(),
              [&](const PickupRecord& a, const PickupRecord& b) {
                  if (a.item != b.item) return a.item < b.item;
                  return posLess(a.pos, b.pos);
              });
    std::sort(ents.debris.begin(), ents.debris.end(),
              [&](const DebrisRecord& a, const DebrisRecord& b) {
                  return posLess(a.pos, b.pos);
              });
    std::sort(ents.powerKeys.begin(), ents.powerKeys.end());
    std::vector<std::uint8_t> out;
    floor_file_write(w, floor, out, &ents, &key);
    return out;
}

// Закон 1 + фундамент закона 2: полный round-trip. Каждое поле каждой записи
// отлично от нуля (round-trip над нулями прошёл бы и при потере полей).
void full_round_trip() {
    World w;
    build_slab(w);
    Registry reg;
    EventBus bus;
    bus.init();
    const LayerId layer = 3;

    // Статичный проп с якорем (лампа — светящаяся строка).
    Entity lamp = spawn_prop_from_id(
        reg, w, vec3{9.5f * kCellSize, 9.5f * kCellSize, 11.2f * kCellSize},
        top_anchor(9, 9, 10), PropId::BareBulb, layer, 1.5707964f,
        /*anim*/ 42, /*flags*/ 0);
    CHECK(lamp != entt::null);
    // Выключенный интерактор (kPropRecInactive).
    if (Interactable* ia = reg.try_get<Interactable>(lamp)) ia->active = false;

    // Ящик-проп с НЕтривиальным инвентарём (бит-в-бит — главный гейт).
    Entity crate = spawn_prop_from_id(
        reg, w, vec3{10.5f * kCellSize, 9.5f * kCellSize, 11.0f * kCellSize},
        top_anchor(10, 9, 10), PropId::SupplyCrate, layer);
    CHECK(crate != entt::null);
    {
        Container box{};
        box.kind = 2;
        box.opened = true;
        box.inv.slots[0] = ItemSlot{static_cast<ItemId>(7), 650, 13};
        box.inv.slots[5] = ItemSlot{static_cast<ItemId>(31), 2, 255};
        box.inv.slots[63] = ItemSlot{static_cast<ItemId>(101), 1, 90};
        reg.emplace_or_replace<Container>(crate, box);
    }

    // Кнопка с DoorRef (индекс закона — валиден под той же генерацией).
    Entity btn = spawn_prop_from_id(
        reg, w, vec3{11.5f * kCellSize, 9.5f * kCellSize, 11.0f * kCellSize},
        top_anchor(11, 9, 10), PropId::LiftButton, layer);
    CHECK(btn != entt::null);
    reg.emplace_or_replace<DoorRef>(btn, DoorRef{5});

    // Сорванный проп: детач тем же глаголом — теряет якорь, статику, обретает
    // тело ядра; запись обязана вернуть его ПРОПОМ (не серым обломком).
    // Terminal — SimpleFall: GpuHandoff-лампа при детаче честно УМИРАЕТ
    // частицами и в снимок не попадает (то же, что в живой игре).
    Entity torn = spawn_prop_from_id(
        reg, w, vec3{12.5f * kCellSize, 9.5f * kCellSize, 11.0f * kCellSize},
        top_anchor(12, 9, 10), PropId::Terminal, layer);
    CHECK(torn != entt::null);
    prop_detach(reg, torn, bus);
    CHECK(!reg.all_of<StaticPropTag>(torn));
    // Лежащая ПОЗА (v4): тело перевёрнуто — 120° вокруг (1,1,1). Сейв обязан
    // вернуть её бит-в-бит; до v4 restore ставил упавший проп «стоймя»
    // позой yaw (баг владельца 2026-08-31, «в сейв пишем всё честно»).
    reg.get<RigidBody>(torn).q = quat{0.5f, 0.5f, 0.5f, 0.5f};

    // Лут на полу — единственным писателем.
    Entity pk = spawn_pickup(reg, layer,
                             vec3{13.1f * kCellSize, 9.2f * kCellSize,
                                  11.05f * kCellSize},
                             static_cast<ItemId>(17), 33, 200);
    CHECK(pk != entt::null);

    // Труп (прежняя запись, теперь в floor-файле).
    {
        Entity c = reg.create();
        reg.emplace<Transform>(c, Transform{vec3{14.0f * kCellSize,
                                                 9.0f * kCellSize,
                                                 11.0f * kCellSize},
                                            layer});
        reg.emplace<AABB>(c, AABB{vec3{0.4f, 0.3f, 0.2f}});
        reg.emplace<Renderable>(c, Renderable{vec3{0.31f, 0.22f, 0.13f}});
        Corpse corpse;
        corpse.mobKind = 4;
        corpse.searched = true;
        reg.emplace<Corpse>(c, corpse);
        Container box{};
        box.inv.slots[2] = ItemSlot{static_cast<ItemId>(9), 3, 77};
        reg.emplace<Container>(c, box);
    }

    // Обломок БЕЗ строки (мяч) — прежняя v18-секция.
    {
        Entity b = reg.create();
        reg.emplace<Transform>(b, Transform{vec3{15.0f * kCellSize,
                                                 9.0f * kCellSize,
                                                 11.3f * kCellSize},
                                            layer});
        reg.emplace<Velocity>(b);
        reg.emplace<Renderable>(b, Renderable{vec3{0.9f, 0.1f, 0.2f}});
        reg.emplace<DynamicBodyTag>(b);
        rigid_attach_sphere(reg, b, 0.35f, 12.0f, 0.6f, 0.4f);
        reg.emplace<AABB>(b, AABB{vec3{0.35f, 0.35f, 0.35f}});
    }

    // Обесточка: два ключа.
    PowerGridState power{};
    power.destroy_shield(9, 9, 11);
    power.destroy_shield(11, 9, 11);

    const int floorNo = -7;
    FloorEntityState ents1;
    gather_floor_entities(reg, layer, floorNo, ents1, &power);
    CHECK(ents1.props.size() == 4);
    CHECK(ents1.corpses.size() == 1);
    CHECK(ents1.pickups.size() == 1);
    CHECK(ents1.debris.size() == 1);
    CHECK(ents1.powerKeys.size() == 2);
    // Сорванный проп — именно ПРОП с флагом, а не обломок.
    int detachedRecs = 0;
    for (const PropRecord& r : ents1.props)
        if (r.flags & kPropRecDetached) ++detachedRecs;
    CHECK(detachedRecs == 1);

    const FloorModuleKey key{static_cast<std::uint8_t>(FloorKind::Padic),
                             0xC0FFEE42u, module_gen_version(FloorKind::Padic)};
    std::vector<std::uint8_t> fileA = canonical_file(w, floorNo, ents1, key);

    // Восстановление в СВЕЖИЕ мир и реестр.
    World w2;
    Registry reg2;
    FloorEntityState ents2;
    std::int32_t floorOut = 0;
    SaveError err = SaveError::None;
    CHECK(floor_file_read(fileA.data(), fileA.size(), w2, &floorOut, &err,
                          &key, &ents2));
    CHECK(err == SaveError::None);
    CHECK(floorOut == floorNo);
    // Геометрия бит-в-бит.
    CHECK(std::memcmp(w.grid().types().data(), w2.grid().types().data(),
                      w.grid().types().size() * sizeof(CellType)) == 0);
    CHECK(std::memcmp(w.grid().masks().data(), w2.grid().masks().data(),
                      w.grid().masks().size() * sizeof(SubMask)) == 0);

    EventBus bus2;
    bus2.init();
    spawn_prop_records(reg2, w2, layer, ents2.props.data(), ents2.props.size(),
                       bus2);
    spawn_corpse_records(reg2, layer, floorNo, ents2.corpses.data(),
                         ents2.corpses.size());
    spawn_pickup_records(reg2, layer, ents2.pickups.data(),
                         ents2.pickups.size());
    spawn_debris_records(reg2, layer, floorNo, ents2.debris.data(),
                         ents2.debris.size());
    PowerGridState power2{};
    restore_power_keys(power2, ents2.powerKeys.data(), ents2.powerKeys.size());
    CHECK(power2.count == 2);
    CHECK(power2.is_shield_destroyed(9, 9, 11));
    CHECK(power2.is_shield_destroyed(11, 9, 11));

    // Идемпотентность: gather после восстановления = ТЕ ЖЕ байты файла.
    FloorEntityState ents3;
    gather_floor_entities(reg2, layer, floorNo, ents3, &power2);
    std::vector<std::uint8_t> fileB = canonical_file(w2, floorNo, ents3, key);
    CHECK(fileA.size() == fileB.size());
    CHECK(fileA == fileB);

    // Точечные проверки восстановленного состояния (не только байты):
    // ящик бит-в-бит, лампа неактивна, кнопка несёт ссылку, сорванный —
    // динамика с телом ядра.
    int crates = 0, inactive = 0, doorRefs = 0, dynamicProps = 0;
    for (auto e : reg2.view<const PropOf, const Transform>()) {
        if (reg2.get<const Transform>(e).layer != layer) continue;
        if (const Container* box = reg2.try_get<Container>(e)) {
            if (reg2.all_of<Corpse>(e)) continue;
            ++crates;
            CHECK(box->kind == 2);
            CHECK(box->opened);
            CHECK(box->inv.slots[0].item == static_cast<ItemId>(7));
            CHECK(box->inv.slots[0].count == 650);
            CHECK(box->inv.slots[0].condition == 13);
            CHECK(box->inv.slots[63].condition == 90);
        }
        if (const Interactable* ia = reg2.try_get<Interactable>(e))
            if (!ia->active) ++inactive;
        if (const DoorRef* dr = reg2.try_get<DoorRef>(e)) {
            ++doorRefs;
            CHECK(dr->group == 5u);
        }
        if (!reg2.all_of<StaticPropTag>(e)) {
            ++dynamicProps;
            CHECK(reg2.all_of<RigidBody>(e));
            // Лежащая поза вернулась бит-в-бит (v4), не «стоймя» из yaw.
            const RigidBody& rb = reg2.get<RigidBody>(e);
            CHECK(rb.q.x == 0.5f && rb.q.y == 0.5f && rb.q.z == 0.5f &&
                  rb.q.w == 0.5f);
        }
    }
    CHECK(crates == 1);
    CHECK(inactive >= 1); // лампа; сорванная тоже может быть неактивной
    CHECK(doorRefs == 1);
    CHECK(dynamicProps == 1);
}

// Закон 4 — все ворота ключа, обе полярности; отказ не трогает мир.
void module_key_gates() {
    World w;
    build_slab(w);
    const FloorModuleKey key{static_cast<std::uint8_t>(FloorKind::Khrushi),
                             1337u, module_gen_version(FloorKind::Khrushi)};
    std::vector<std::uint8_t> file;
    floor_file_write(w, 3, file, nullptr, &key);

    auto refuse = [&](const FloorModuleKey& expect, SaveError want) {
        World fresh;
        fresh.grid().fill_cell(1, 1, 1, kMatConcrete); // сторожевой узор
        SaveError err = SaveError::None;
        CHECK(!floor_file_read(file.data(), file.size(), fresh, nullptr, &err,
                               &expect, nullptr));
        CHECK(err == want);
        // Мир не тронут: полуслияние запрещено (S20.6 закон 4).
        CHECK(fresh.grid().cell(1, 1, 1) == kMatConcrete);
        CHECK(fresh.grid().cell(9, 9, 10) == kCellAir);
    };
    FloorModuleKey badGen = key;
    badGen.genVersion += 1;
    refuse(badGen, SaveError::ModuleChanged);
    FloorModuleKey badKind = key;
    badKind.kind = static_cast<std::uint8_t>(FloorKind::Blame);
    refuse(badKind, SaveError::ModuleChanged);
    FloorModuleKey badSeed = key;
    badSeed.seed ^= 1u;
    refuse(badSeed, SaveError::ModuleChanged);

    // Обратная полярность: точный ключ принят, материя легла.
    {
        World fresh;
        SaveError err = SaveError::None;
        CHECK(floor_file_read(file.data(), file.size(), fresh, nullptr, &err,
                              &key, nullptr));
        CHECK(err == SaveError::None);
        CHECK(fresh.grid().cell(9, 9, 10) == kMatConcrete);
    }

    // Прежняя версия файла (v2) отклоняется целиком — честная инвалидация.
    {
        std::vector<std::uint8_t> old = file;
        old[4] = 2; // version, LE-байт 0
        World fresh;
        SaveError err = SaveError::None;
        CHECK(!floor_file_read(old.data(), old.size(), fresh, nullptr, &err,
                               &key, nullptr));
        CHECK(err == SaveError::BadVersion);
    }
    // Порченый CRC.
    {
        std::vector<std::uint8_t> bad = file;
        bad[bad.size() - 1] ^= 0xFFu;
        World fresh;
        SaveError err = SaveError::None;
        CHECK(!floor_file_read(bad.data(), bad.size(), fresh, nullptr, &err,
                               &key, nullptr));
        CHECK(err == SaveError::BadChecksum);
    }
    // Обрубленный файл.
    {
        World fresh;
        SaveError err = SaveError::None;
        CHECK(!floor_file_read(file.data(), file.size() / 2, fresh, nullptr,
                               &err, &key, nullptr));
        CHECK(err == SaveError::SizeMismatch || err == SaveError::TooShort);
    }
}

// Закон 3 — якорная проба restore, обе полярности: живой якорь = статика,
// мёртвый (опора выкарвлена в снимке) = честный детач, вещь не теряется.
void restore_anchor_probe() {
    World w;
    build_slab(w);
    const LayerId layer = 2;

    // Terminal (SimpleFall): детач мёртвого якоря обязан ОСТАВИТЬ тело.
    // (GpuHandoff-строка при детаче честно умирает — это не потеря записи,
    // это её судьба, та же, что у живого детача.)
    PropRecord alive{};
    alive.propId = static_cast<std::uint16_t>(PropId::Terminal);
    alive.pos = vec3{9.5f * kCellSize, 9.5f * kCellSize, 11.2f * kCellSize};
    alive.anchor = top_anchor(9, 9, 10); // бетон — живой
    PropRecord dead = alive;
    dead.pos.x += kCellSize;
    dead.anchor = top_anchor(40, 40, 40); // воздух — опоры нет
    PropRecord recs[2] = {alive, dead};

    Registry reg;
    EventBus bus;
    bus.init();
    CHECK(spawn_prop_records(reg, w, layer, recs, 2, bus) == 2);

    int statics = 0, dynamics = 0;
    for (auto e : reg.view<const PropOf>()) {
        if (reg.all_of<StaticPropTag>(e)) {
            ++statics;
            CHECK(reg.all_of<SubVoxelAnchor>(e)); // живой якорь остался
        } else {
            ++dynamics;
            CHECK(!reg.all_of<SubVoxelAnchor>(e)); // детач снял запись
            CHECK(reg.all_of<RigidBody>(e));       // тело ядра — ляжет физикой
        }
    }
    CHECK(statics == 1);
    CHECK(dynamics == 1);
}

// Версии генерации объявлены для каждого kind и не нулевые (0 = «до-F»).
void gen_versions_declared() {
    for (int k = 0; k < static_cast<int>(FloorKind::Count); ++k)
        CHECK(module_gen_version(static_cast<FloorKind>(k)) >= 1u);
}

} // namespace persist_test

void test_persist_all() {
    persist_test::full_round_trip();
    persist_test::module_key_gates();
    persist_test::restore_anchor_probe();
    persist_test::gen_versions_declared();
    std::printf("[persist] floor file v3: round-trip, module key gates, "
                "restore anchor probe\n");
}
