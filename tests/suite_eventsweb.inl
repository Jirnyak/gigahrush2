// Events that nobody read, and a projectile type that did nothing.
//
// Two dead mechanics, one suite, because they fail the same way: a field or an
// enumerator exists, the build is green, and no code path reaches it. Nothing here
// asserts that arithmetic still works — `test_event_bus_transient` already pins the
// ring, and `test_ranged_windup_and_deadzone` pins the telegraph. These assertions
// are "is the mechanic reachable from a game tick, and can you measure it".
//
// What was dead before 2026-07-29:
//   * `EventType::ItemTransferred` — three producers (loot.cpp x2, needs.cpp),
//     zero consumers. The only drain in the game filtered on `NpcDied`.
//   * `NpcSpawned` / `NpcMigrated` / `FloorEntered` — no producer at all.
//   * `EventBus::set_logging` / `log` / `clear_log` / `dropped` — zero call sites,
//     so the overflow counter the header calls a tuning signal was unreadable.
//
// ПОПРАВКА 2026-09-30. Половина этого сьюта лечила первые две строки ФИДОМ —
// и лечение оказалось той же болезнью этажом выше: `EventFeed` рендерил всё,
// а самого фида не звал никто, кроме этих тестов. Решением владельца читающий
// слой и слой «прибытие на этаж» снесены; блоки 1 и 2 ушли с ними, блок 4
// сокращён до «производитель -> шина -> СЧЁТЧИК». `NpcSpawned` / `NpcMigrated` /
// `FloorEntered` снова без производителя, и теперь это написано прямо
// ([event_bus.h], problems.md §83), а не закрыто текстом на экране, которого
// никто не показывает.
//   * `MobDef::projType` — the enum, the field and 69 generated rows, and no
//     reader anywhere in src/. 68 rows are blank (Bullet) and exactly one is WEB,
//     so the one authored web-spitter fired the same projectile as everything else.
//
// The web half also uncovered a second, worse defect: `mob_attack_step` skipped any
// kind with `dmg == 0`, and PAUPSINA is the ONLY zero-damage row in data/mobs.csv.
// So the web-spitter did not fire an identical projectile — it never fired at all,
// and its whole ranged kit was unreachable code.
//
// A .inl and not a .cpp for the reason suite_samosbor.inl states: game_test owns the
// CHECK macro, so the include has to land after it.

#include "core/tick.h"        // kSimDt / kSimStepMs — never a bare 1/120 in here
#include "game/combat.h"
#include "game/event_bus.h"
#include "game/hunt.h"        // kHuntRadius, for the dead-zone arithmetic below

namespace eventsweb {

// The one authored web row, and the row index the whole web half depends on.
constexpr std::size_t kWebRow = static_cast<std::size_t>(MobKind::Paupsina);

// Put a monster of `kind` `metres` down +x from `at`, with the component set
// `mob_attack_step` actually requires (MobRef + Transform + MobCombat). Not
// `emplace_mob`: that is private to mob_spawn.cpp and would drag a World in.
Entity place_mob(Registry& reg, LayerId layer, MobKind kind, const vec3& at,
                 float metres) {
    Entity e = reg.create();
    Transform t;
    t.pos = vec3{at.x + metres, at.y, at.z};
    t.layer = layer;
    reg.emplace<Transform>(e, t);
    reg.emplace<MobRef>(e, MobRef{static_cast<std::uint8_t>(kind), 1, 500, 500});
    reg.emplace<MobCombat>(e, MobCombat{0, 0});
    return e;
}

// Run attack passes until something is in flight, or give up. Returns the shot.
Entity fire_once(Registry& reg, const MacroGrid& grid, NpcPool& pool, EventBus& bus,
                 LayerId layer, int maxPasses) {
    for (int i = 0; i < maxPasses; ++i) {
        mob_attack_step(reg, grid, pool, bus, layer, kSimDt,
                        static_cast<std::uint64_t>(i));
        for (auto e : reg.view<const Projectile>()) return e;
    }
    return entt::null;
}

// Horizontal speed of an entity's Velocity, m/s. `Registry&` and `get<const T>`
// rather than `const Registry&`, to match the form already used throughout
// game_test.cpp.
float flat_speed(Registry& reg, Entity e) {
    const Velocity& v = reg.get<const Velocity>(e);
    return std::sqrt(v.v.x * v.v.x + v.v.y * v.v.y);
}

} // namespace eventsweb


// [jirnyak.md] section 18 — PropDetached обязан быть ВИДЕН шине.
// Producer: detach_single_prop (a/b/c = packed world pos). Проверка рендера в
// строку ушла 2026-09-30 вместе с `event_line`/`EventFeed`; осталось то, что
// по-прежнему истинно и по-прежнему живое — тип публикуется и попадает в тэлли.
static void test_prop_detached_event() {
    EventBus bus;
    bus.init();

    CHECK(bus.publish(EventType::PropDetached, 10u, 20u, 30u, /*tick=*/42u));
    CHECK(bus.cycle_count(EventType::PropDetached) == 1u);
    CHECK(bus.events()[0].a == 10u && bus.events()[0].b == 20u &&
          bus.events()[0].c == 30u);
    CHECK(bus.events()[0].tick == 42u);
}

static void test_eventsweb_all() {
    test_prop_detached_event();
    using namespace eventsweb;

    // ---- 1 и 2: СНЕСЕНЫ 2026-09-30 вместе с предметом ------------------------
    // Блок 1 гонял `publish_floor_arrival` и читал результат фидом; блок 2
    // проверял, что каждый тип события рендерится в строку. Оба предмета
    // удалены (ноль вызывающих в `src/`), поэтому удалены и блоки: тест,
    // переживший свой предмет, — будущая вторая реализация.

    // ---- 3. The optional log, which also had zero call sites ------------------
    {
        EventBus bus;
        bus.init();
        CHECK(!bus.logging());
        bus.set_logging(true);
        bus.publish(EventType::ItemTransferred, 1u, 2u, 3u, 1u);
        bus.clear();
        bus.publish(EventType::ItemTransferred, 4u, 5u, 6u, 2u);
        CHECK(bus.size() == 1);          // the ring lost the first
        CHECK(bus.log().size() == 2);    // the log did not
        bus.clear_log();
        CHECK(bus.log().empty());
    }

    // ---- 4. A REAL producer reaching the bus ----------------------------------
    //
    // Убивает монстра через `finalize_deaths` — единственную точку смерти в тике —
    // и читает результат ИЗ ШИНЫ: путь producer -> bus без синтетики. Раньше
    // читалось фидом; фид снесён, а утверждение «настоящий производитель дошёл»
    // от этого не изменилось.
    {
        NpcPool pool;
        pool.init();
        Registry reg;
        EventBus bus;
        bus.init();

        Entity mob = reg.create();
        reg.emplace<Transform>(mob, Transform{vec3{4.0f, 4.0f, 4.0f}, LayerId{0}});
        reg.emplace<MobRef>(
            mob, MobRef{static_cast<std::uint8_t>(MobKind::Zombie), 1, 5, 5});
        const DamageResult r =
            apply_damage(reg, pool, mob, 99, DamageChannel::Kinetic, entt::null);
        CHECK(r.lethal);
        CHECK(finalize_deaths(reg, pool, bus, 77u) == 1u);
        CHECK(bus.cycle_count(EventType::NpcDied) == 1);
        CHECK(bus.events()[0].b == static_cast<std::uint32_t>(MobKind::Zombie));
        CHECK(bus.events()[0].tick == 77u);
    }

    // ---- 5. projType: exactly one WEB row, and it is the zero-damage one ------
    //
    // These pin the two facts every line of the web half rests on. A CSV edit that
    // authors a SECOND zero-damage row with a blank proj_type would be silently
    // skipped by `mob_attack_step`'s damage gate, exactly as PAUPSINA was.
    {
        std::size_t webRows = 0, zeroDmg = 0;
        std::size_t webIx = kMobKindCount;
        for (std::size_t i = 0; i < kMobKindCount; ++i) {
            if (static_cast<ProjType>(kMobTable[i].projType) == ProjType::Web) {
                ++webRows;
                webIx = i;
            }
            if (kMobTable[i].dmg == 0) ++zeroDmg;
        }
        CHECK(webRows == 1);
        CHECK(zeroDmg == 1);
        CHECK(webIx == kWebRow);
        CHECK(kMobTable[kWebRow].dmg == 0);
        CHECK(kMobTable[kWebRow].shotRangeMm > 0);
        CHECK(has_flag(kMobTable[kWebRow].aiFlags, AiFlag::Ranged));

        // Why `apply_slow` may refuse a body with no Controller and no MobRef and
        // still be complete: the web's dead zone starts OUTSIDE the radius crowd
        // prey is ever chosen inside, so a resident is unreachable by arithmetic.
        const float minR =
            static_cast<float>(kMobTable[kWebRow].minRangeMm) * 0.001f * kCellSize;
        CHECK(minR > kHuntRadius);
    }

    // ---- 6. The web-spitter fires at all, and what it fires is a web ----------
    {
        NpcPool pool;
        pool.init();
        Registry reg;
        EventBus bus;
        bus.init();
        LevelStack stack;
        LayerId layer = stack.push_layer();

        NpcId pid = pool.spawn();
        pool.hp(pid) = 30000;
        pool.max_hp(pid) = 30000;
        Entity player = embody_as_player(reg, pool, pid, layer);
        const vec3 ppos = reg.get<Transform>(player).pos;
        const float base = reg.get<Controller>(player).moveSpeed;
        const float cap = base * kWebSlowScale;

        // 10 m: inside the 23 m shot range and outside the 6.8 m dead zone.
        place_mob(reg, layer, MobKind::Paupsina, ppos, 10.0f);
        Entity shot = fire_once(reg, stack.layer(layer).grid(), pool, bus, layer, 400);
        // Before the damage gate was fixed this was entt::null forever: dmg == 0
        // meant `mob_attack_step` never even looked at the kind.
        CHECK(shot != entt::null);
        if (shot != entt::null) {
            const Projectile& p = reg.get<const Projectile>(shot);
            CHECK(p.proj == static_cast<std::uint8_t>(ProjType::Web));
            CHECK(p.dmg == 0);        // control, not damage
            // A control shot must not look like a lethal one. Render-only, so this
            // changes pixels and nothing else — but a web painted like a bullet
            // teaches the player the wrong thing about what just hit them.
            const Renderable& rr = reg.get<const Renderable>(shot);
            CHECK(!(rr.color.x == 1.00f && rr.color.y == 0.95f));
        }

        // Fly it into the player. HP must NOT move (dmg 0) and the slow must land.
        const std::int16_t hp0 = pool.hp(pid);
        bool webbed = false;
        for (int i = 0; i < 400 && !webbed; ++i) {
            projectile_step(reg, pool, bus, stack, layer, kSimDt,
                            600u + static_cast<std::uint64_t>(i));
            webbed = slow_scale(reg, player) < 1.0f;
        }
        CHECK(webbed);
        CHECK(pool.hp(pid) == hp0);           // a web does not chew health
        CHECK(std::fabs(slow_scale(reg, player) - kWebSlowScale) < 0.001f);
        CHECK(reg.get<const Slowed>(player).ttlMs == kWebSlowMs);
        CHECK(std::fabs(reg.get<const Slowed>(player).maxSpeed - cap) < 0.001f);

        // MEASURED: the same input velocity comes out at the cap.
        reg.get<Velocity>(player).v = vec3{base, 0.0f, 0.0f};
        CHECK(std::fabs(flat_speed(reg, player) - base) < 0.001f);
        CHECK(slow_step(reg, layer, kSimDt) == 1u);
        CHECK(std::fabs(flat_speed(reg, player) - cap) < 0.01f);
        // Below the spitter's own 4.5 m/s, which is the entire mechanic: unwebbed
        // you outrun it, webbed you cannot.
        const float spitter =
            static_cast<float>(kMobTable[kWebRow].speedMmps) * 0.001f * kCellSize;
        CHECK(base > spitter);
        CHECK(flat_speed(reg, player) < spitter);

        // A CLAMP and not a per-tick multiply. `wander_step` rewrites a crowd body's
        // velocity only on its own stagger slot — once every kWanderPeriod ticks —
        // so a multiply would compound to 0.45^8 = 0.0017 of the speed within one
        // period. Written ONCE, enforced eight times, still exactly the cap.
        reg.get<Velocity>(player).v = vec3{base, 0.0f, 0.0f};
        for (int i = 0; i < 8; ++i) slow_step(reg, layer, kSimDt);
        CHECK(std::fabs(flat_speed(reg, player) - cap) < 0.01f);
        CHECK(flat_speed(reg, player) > base * 0.1f);   // a multiply would fail here

        // Vertical is untouched: a slow is not reduced gravity.
        reg.get<Velocity>(player).v = vec3{base, 0.0f, -9.0f};
        slow_step(reg, layer, kSimDt);
        CHECK(reg.get<const Velocity>(player).v.z == -9.0f);

        // A body already under the cap is left alone rather than dragged down.
        reg.get<Velocity>(player).v = vec3{cap * 0.5f, 0.0f, 0.0f};
        slow_step(reg, layer, kSimDt);
        CHECK(std::fabs(flat_speed(reg, player) - cap * 0.5f) < 0.001f);

        // Another layer enforces nothing — but the clock still runs, so two seconds
        // of web is two seconds of wall clock even if you ride an elevator.
        const std::uint16_t before = reg.get<const Slowed>(player).ttlMs;
        CHECK(slow_step(reg, static_cast<LayerId>(99), kSimDt) == 0u);
        CHECK(reg.get<const Slowed>(player).ttlMs < before);

        // And it ENDS. 2500 ms at the exact 8 ms step is 313 ticks; 400 is slack.
        for (int i = 0; i < 400; ++i) slow_step(reg, layer, kSimDt);
        CHECK(slow_scale(reg, player) == 1.0f);
        CHECK(slow_step(reg, layer, kSimDt) == 0u);
        // Expired means inert, not removed ([combat.h] Slowed): the component stays
        // attached because erasing it from inside the view that found it is the
        // reallocate-the-storage crash mob_attack_step was split in two to avoid.
        CHECK(reg.all_of<Slowed>(player));
        reg.get<Velocity>(player).v = vec3{base, 0.0f, 0.0f};
        slow_step(reg, layer, kSimDt);
        CHECK(std::fabs(flat_speed(reg, player) - base) < 0.001f);   // free again
    }

    // ---- 7. A BULLET does not slow, and does damage ---------------------------
    //
    // The control case. Without it, "a web slows" is not evidence that projType is
    // read — a bug that slowed on EVERY hit would pass section 6 unchanged.
    {
        NpcPool pool;
        pool.init();
        Registry reg;
        EventBus bus;
        bus.init();
        LevelStack stack;
        LayerId layer = stack.push_layer();

        NpcId pid = pool.spawn();
        pool.hp(pid) = 30000;
        pool.max_hp(pid) = 30000;
        Entity player = embody_as_player(reg, pool, pid, layer);
        const vec3 ppos = reg.get<Transform>(player).pos;
        const float base = reg.get<Controller>(player).moveSpeed;

        // An Eye: ranged, Bullet, 12 m is inside its band — the same geometry
        // test_ranged_windup_and_deadzone already proves connects.
        CHECK(static_cast<ProjType>(
                  kMobTable[static_cast<std::size_t>(MobKind::Eye)].projType) ==
              ProjType::Bullet);
        place_mob(reg, layer, MobKind::Eye, ppos, 12.0f);
        Entity shot = fire_once(reg, stack.layer(layer).grid(), pool, bus, layer, 400);
        CHECK(shot != entt::null);
        if (shot != entt::null)
            CHECK(reg.get<const Projectile>(shot).proj ==
                  static_cast<std::uint8_t>(ProjType::Bullet));

        const std::int16_t hp0 = pool.hp(pid);
        for (int i = 0; i < 400 && pool.hp(pid) == hp0; ++i)
            projectile_step(reg, pool, bus, stack, layer, kSimDt,
                            600u + static_cast<std::uint64_t>(i));
        CHECK(pool.hp(pid) < hp0);                  // it connected, and it hurt
        CHECK(!reg.all_of<Slowed>(player));         // and it did NOT slow
        CHECK(slow_scale(reg, player) == 1.0f);
        reg.get<Velocity>(player).v = vec3{base, 0.0f, 0.0f};
        CHECK(slow_step(reg, layer, kSimDt) == 0u);
        CHECK(std::fabs(flat_speed(reg, player) - base) < 0.001f);
    }

    // ---- 8. apply_slow's contract ---------------------------------------------
    {
        NpcPool pool;
        pool.init();
        Registry reg;
        LevelStack stack;
        LayerId layer = stack.push_layer();

        NpcId pid = pool.spawn();
        pool.hp(pid) = 100;
        pool.max_hp(pid) = 100;
        Entity me = embody_as_player(reg, pool, pid, layer);
        const float base = reg.get<Controller>(me).moveSpeed;

        // Not a slow.
        CHECK(!apply_slow(reg, me, 1.0f, kWebSlowMs));
        CHECK(!apply_slow(reg, me, 1.5f, kWebSlowMs));
        CHECK(!apply_slow(reg, me, kWebSlowScale, 0));
        CHECK(!apply_slow(reg, entt::null, kWebSlowScale, kWebSlowMs));
        CHECK(!reg.all_of<Slowed>(me));

        // REFRESH, never compound. Two webs must not multiply to 0.2025 of base and
        // pin a player in place — the drop below the spitter's speed is the whole
        // effect and anything past it only removes the player's options.
        CHECK(apply_slow(reg, me, kWebSlowScale, kWebSlowMs));
        const float once = reg.get<const Slowed>(me).maxSpeed;
        CHECK(std::fabs(once - base * kWebSlowScale) < 0.001f);
        CHECK(apply_slow(reg, me, kWebSlowScale, kWebSlowMs));
        CHECK(reg.get<const Slowed>(me).maxSpeed == once);

        // A stronger cap wins; a shorter duration does not shorten the effect.
        CHECK(apply_slow(reg, me, 0.20f, 500));
        CHECK(reg.get<const Slowed>(me).maxSpeed < once);
        CHECK(reg.get<const Slowed>(me).ttlMs == kWebSlowMs);
        // And a weaker one does not undo it.
        CHECK(apply_slow(reg, me, 0.90f, 500));
        CHECK(std::fabs(reg.get<const Slowed>(me).maxSpeed - base * 0.20f) < 0.001f);

        // A monster's cap comes off its table row, not off a Controller it lacks.
        Entity mob = place_mob(reg, layer, MobKind::Paupsina, vec3{0, 0, 0}, 4.0f);
        reg.emplace<Velocity>(mob);
        CHECK(apply_slow(reg, mob, kWebSlowScale, kWebSlowMs));
        const float mobBase =
            static_cast<float>(kMobTable[kWebRow].speedMmps) * 0.001f * kCellSize;
        CHECK(std::fabs(reg.get<const Slowed>(mob).maxSpeed -
                        mobBase * kWebSlowScale) < 0.001f);
        CHECK(std::fabs(slow_scale(reg, mob) - kWebSlowScale) < 0.001f);

        // An IMMOBILE monster has no speed to take away, and is refused rather than
        // given a zero cap that would read as "slowed" forever on a HUD.
        Entity plant = place_mob(reg, layer, MobKind::Borshchevik, vec3{0, 0, 0}, 6.0f);
        reg.emplace<Velocity>(plant);
        CHECK(kMobTable[static_cast<std::size_t>(MobKind::Borshchevik)].speedMmps == 0);
        CHECK(!apply_slow(reg, plant, kWebSlowScale, kWebSlowMs));

        // A plain embodied resident carries neither, and is REFUSED rather than
        // handed a guessed walk speed. Unreachable today — section 5 pins the
        // arithmetic — and a false return is better than a second definition of a
        // constant that lives in wander.cpp.
        NpcId rid = pool.spawn();
        pool.hp(rid) = 100;
        pool.max_hp(rid) = 100;
        Entity res = embody(reg, pool, rid, layer);
        CHECK(!reg.all_of<Controller>(res));
        CHECK(!reg.all_of<MobRef>(res));
        CHECK(!apply_slow(reg, res, kWebSlowScale, kWebSlowMs));
        CHECK(slow_scale(reg, res) == 1.0f);
    }
}
