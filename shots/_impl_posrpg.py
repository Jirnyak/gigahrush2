# -*- coding: utf-8 -*-
"""POSRPG: voluntary possess carries RpgStats + kills + cumulative shots/hits."""
from pathlib import Path
import sys

ROOT = Path(r"C:\hades\gigahrush2")

def must_replace(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        print(f"FAIL {label}: search block not found in {path}")
        # show nearby hint
        key = old.splitlines()[0][:60] if old.strip() else "?"
        for i, ln in enumerate(text.splitlines(), 1):
            if key[:30] in ln:
                print(f"  near {i}: {ln[:100]}")
        sys.exit(1)
    n = text.count(old)
    if n != 1:
        print(f"FAIL {label}: expected 1 match, got {n} in {path}")
        sys.exit(1)
    path.write_text(text.replace(old, new), encoding="utf-8")
    print(f"OK {label}: {path.relative_to(ROOT)}")

# ---------------------------------------------------------------------------
# 1) combat.h — include rpg.h + declare transfer_player_progression
# ---------------------------------------------------------------------------
ch = ROOT / "src/game/combat.h"
must_replace(
    ch,
    '#include "game/npc_pool.h"\n',
    '#include "game/npc_pool.h"\n'
    '#include "game/rpg.h"      // RpgStats (POSRPG transfer)\n',
    "combat.h include rpg",
)

must_replace(
    ch,
    """struct PlayerMelee {
    std::uint16_t cooldownMs = 0;
    std::uint32_t kills = 0;       // cumulative, survives possession
};
""",
    """struct PlayerMelee {
    std::uint16_t cooldownMs = 0;
    std::uint32_t kills = 0;       // cumulative, survives possession
};

// POSRPG — move person-progression across a live-to-live camera hop.
//
// Death possession (main.cpp) and the elevator ride already capture/restore
// their own way (old body is destroyed). Voluntary possess only swaps
// CameraTag/Controller, so without this stamp the new body has no RpgStats
// (ordinary embody never attaches one), lazy PlayerMelee starts kills at 0,
// and cumulative shots/hits on PlayerRanged are wiped on first fire.
//
// Rules:
//   * RpgStats: copy from -> to (person sheet follows the mind).
//   * PlayerMelee::kills: MOVE (zero on from, stamp on to).
//   * PlayerRanged shots/hits: MOVE into a lazy component on to; mag/weapon/
//     cooldowns stay on from (physical chamber belongs to the abandoned body).
//   * Does nothing when from==to or either handle is invalid.
void transfer_player_progression(Registry& reg, Entity from, Entity to);
""",
    "combat.h transfer decl",
)

# ---------------------------------------------------------------------------
# 2) combat.cpp — implement
# ---------------------------------------------------------------------------
cc = ROOT / "src/game/combat.cpp"
# Append before closing namespace — find entity_health definition end or namespace close
text = cc.read_text(encoding="utf-8")
impl = r'''
// POSRPG: see combat.h. Live-to-live hop — old body stays in the world.
void transfer_player_progression(Registry& reg, Entity from, Entity to) {
    if (from == to) return;
    if (!reg.valid(from) || !reg.valid(to)) return;

    if (const RpgStats* rs = reg.try_get<RpgStats>(from)) {
        reg.emplace_or_replace<RpgStats>(to, *rs);
    }

    std::uint32_t kills = 0;
    if (PlayerMelee* pm = reg.try_get<PlayerMelee>(from)) {
        kills = pm->kills;
        pm->kills = 0;
    }
    // Always stamp melee when there was a tally OR the source carried the
    // component (so a zero-kill fighter still gets a clean PlayerMelee on the
    // new body rather than waiting for the first swing to lazy-attach).
    if (kills != 0 || reg.all_of<PlayerMelee>(from)) {
        reg.emplace_or_replace<PlayerMelee>(to, PlayerMelee{/*cooldownMs=*/0, kills});
    }

    if (PlayerRanged* pr = reg.try_get<PlayerRanged>(from)) {
        const std::uint32_t shots = pr->shots;
        const std::uint32_t hits = pr->hits;
        pr->shots = 0;
        pr->hits = 0;
        // Mag/weapon/cooldowns remain on `from`. New body only needs the
        // cumulative counters so the next lazy attach does not invent zeros.
        if (shots != 0 || hits != 0 || reg.all_of<PlayerRanged>(to)) {
            PlayerRanged dst{};
            if (PlayerRanged* existing = reg.try_get<PlayerRanged>(to)) {
                dst = *existing;
            }
            dst.shots = shots;
            dst.hits = hits;
            // Do not overwrite a chamber the destination already holds.
            reg.emplace_or_replace<PlayerRanged>(to, dst);
        } else {
            PlayerRanged dst{};
            dst.shots = shots;
            dst.hits = hits;
            reg.emplace_or_replace<PlayerRanged>(to, dst);
        }
    }
}

'''
# Insert before final `} // namespace giga::game`
marker = "} // namespace giga::game"
if text.rstrip().endswith(marker) or marker in text:
    # only replace the LAST occurrence
    idx = text.rfind(marker)
    if idx < 0:
        print("FAIL combat.cpp: namespace close not found")
        sys.exit(1)
    if "transfer_player_progression" in text:
        print("SKIP combat.cpp: already has transfer")
    else:
        text = text[:idx] + impl + text[idx:]
        cc.write_text(text, encoding="utf-8")
        print("OK combat.cpp impl")
else:
    print("FAIL combat.cpp marker")
    sys.exit(1)

# ---------------------------------------------------------------------------
# 3) main.cpp — possess_nearest_survivor stamps progression
# ---------------------------------------------------------------------------
main = ROOT / "src/app/main.cpp"
must_replace(
    main,
    """    if (chosen == entt::null) return entt::null;

    // Detach camera & controller from current player body
    for (auto e : reg.view<CameraTag, const game::NpcRef>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const game::NpcId oldId = reg.get<const game::NpcRef>(e).id;
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        pool.set_player(oldId, false);
        break;
    }

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    std::fprintf(stderr, "[gameplay] Voluntarily possessed resident #%u\\n", chosenId);
    return chosen;
}
""",
    """    if (chosen == entt::null) return entt::null;

    // Detach camera & controller from current player body. Keep the old entity
    // handle so POSRPG can move person-progression onto the new body — the old
    // body stays alive in the world (unlike death / elevator fold_back).
    Entity oldPlayer = entt::null;
    for (auto e : reg.view<CameraTag, const game::NpcRef>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const game::NpcId oldId = reg.get<const game::NpcRef>(e).id;
        oldPlayer = e;
        reg.remove<CameraTag>(e);
        reg.remove<Controller>(e);
        pool.set_player(oldId, false);
        break;
    }

    CameraTag cam;
    cam.eyeOffset =
        vec3{0.0f, 0.0f, game::body_eye_height(pool.height_mm(chosenId))};
    reg.emplace<CameraTag>(chosen, cam);
    reg.emplace<Controller>(chosen, Controller{7.0f, {0, 0, 0}, false});
    pool.set_player(chosenId, true);
    // POSRPG: RpgStats + kill tally + cumulative shots/hits follow the mind.
    // Chambered mag stays on oldPlayer (physical). [combat.h]
    if (oldPlayer != entt::null)
        game::transfer_player_progression(reg, oldPlayer, chosen);
    std::fprintf(stderr, "[gameplay] Voluntarily possessed resident #%u\\n", chosenId);
    return chosen;
}
""",
    "main possess_nearest transfer",
)

# Call site: refresh local kills + carriedRpg after voluntary possess
must_replace(
    main,
    """                if (possessWanted) {
                    possessWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        Entity newPlayer = possess_nearest_survivor(reg, pool, activeLayer, ppos, 8.0f);
                        if (newPlayer != entt::null) {
                            player = newPlayer;
                            const vec3 newPos = reg.get<Transform>(player).pos;
                            const auto* nr = reg.try_get<game::NpcRef>(player);
                            const game::NpcId newId = nr ? nr->id : 0;
                            std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                          "MIND PROJECTION: POSSESSED RESIDENT BODY #%u AT (%.1f, %.1f)",
                                          newId, newPos.x, newPos.z);
                            elevDiagAt = simTick;
                            if (particlePass.ready()) {
                                particlePass.emit_burst(newPos + vec3{0.0f, 1.0f, 0.0f},
                                                        vec3{0.0f, 1.0f, 0.0f},
                                                        vec3{0.30f, 0.95f, 0.85f},
                                                        gpu::GpuParticleKind::BioSpore,
                                                        48, 4.0f, 1.0f, 0.20f, 200.0f);
                            }
                            game::NoiseProfile np{15.0f, 1500, 3, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, newPos, np, 0);
                        }
                    }
                }
""",
    """                if (possessWanted) {
                    possessWanted = false;
                    if (reg.valid(player)) {
                        const vec3 ppos = reg.get<Transform>(player).pos;
                        Entity newPlayer = possess_nearest_survivor(reg, pool, activeLayer, ppos, 8.0f);
                        if (newPlayer != entt::null) {
                            player = newPlayer;
                            // POSRPG: keep the run-local snapshots honest so a later
                            // death path / F5 save does not restore the pre-hop sheet
                            // or a stale kill tally. transfer_player_progression
                            // already stamped the components on the new body.
                            if (const auto* pm =
                                    reg.try_get<game::PlayerMelee>(player))
                                kills = pm->kills;
                            if (const auto* rs =
                                    reg.try_get<game::RpgStats>(player))
                                carriedRpg = *rs;
                            const vec3 newPos = reg.get<Transform>(player).pos;
                            const auto* nr = reg.try_get<game::NpcRef>(player);
                            const game::NpcId newId = nr ? nr->id : 0;
                            std::snprintf(elevDiagLine, sizeof(elevDiagLine),
                                          "MIND PROJECTION: POSSESSED RESIDENT BODY #%u AT (%.1f, %.1f)",
                                          newId, newPos.x, newPos.z);
                            elevDiagAt = simTick;
                            if (particlePass.ready()) {
                                particlePass.emit_burst(newPos + vec3{0.0f, 1.0f, 0.0f},
                                                        vec3{0.0f, 1.0f, 0.0f},
                                                        vec3{0.30f, 0.95f, 0.85f},
                                                        gpu::GpuParticleKind::BioSpore,
                                                        48, 4.0f, 1.0f, 0.20f, 200.0f);
                            }
                            game::NoiseProfile np{15.0f, 1500, 3, game::NoiseSource::Door};
                            game::noise_publish(noiseField, activeLayer, newPos, np, 0);
                        }
                    }
                }
""",
    "main call site carriedRpg/kills",
)

# Soften death-path comment that claimed fresh sheet is "right for possession"
must_replace(
    main,
    """                    // The PlayerMelee component dies with the body; the tally of
                    // what that person killed does not.
                    //
                    // Neither does the character sheet. `embody_as_player` rolls a
                    // fresh RpgStats from the new record, which is right for a
                    // possession but wrong across a DEATH — losing every level to a
                    // bad corridor is not the reference's rule, and the kill tally
                    // beside it already survives for the same reason. Captured
                    // before the possess (the old body is already gone by then, so
                    // this reads the value saved off at the top of the death path).
""",
    """                    // The PlayerMelee component dies with the body; the tally of
                    // what that person killed does not.
                    //
                    // Neither does the character sheet. `embody_as_player` rolls a
                    // fresh RpgStats from the new record — wrong across a DEATH
                    // (losing every level to a bad corridor is not the reference's
                    // rule) and wrong across voluntary possession too (POSRPG
                    // stamps via transfer_player_progression). Death cannot call
                    // that helper: the old body is already gone, so this reads the
                    // value saved off at the top of the death path (carriedRpg).
""",
    "main death comment POSRPG",
)

# ---------------------------------------------------------------------------
# 4) unit pin in suite_rpg.inl
# ---------------------------------------------------------------------------
sr = ROOT / "tests/suite_rpg.inl"
must_replace(
    sr,
    """static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
    test_rpg_kill_awards_xp();
    test_rpg_combat_wire();
}
""",
    """// POSRPG: voluntary camera-hop must carry person-progression the way death
// and the elevator already do. transfer_player_progression is the shared stamp
// (main.cpp possess_nearest_survivor calls it after the CameraTag swap).
static void test_rpg_possess_transfer() {
    Registry reg;
    NpcPool pool;
    pool.init();
    const LayerId layer = 0;

    const NpcId idA = pool.spawn();
    const NpcId idB = pool.spawn();
    CHECK(idA != kInvalidNpc);
    CHECK(idB != kInvalidNpc);
    pool.cx(idA) = 10; pool.cy(idA) = 10; pool.cz(idA) = 1;
    pool.height_mm(idA) = 1750;
    pool.cx(idB) = 12; pool.cy(idB) = 10; pool.cz(idB) = 1;
    pool.height_mm(idB) = 1700;

    // Player body (has RpgStats via embody_as_player) + ordinary resident
    // (no RpgStats — ordinary embody never attaches one).
    Entity from = embody_as_player(reg, pool, idA, layer);
    Entity to = embody(reg, pool, idB, layer);
    CHECK(from != entt::null);
    CHECK(to != entt::null);
    CHECK(reg.all_of<RpgStats>(from));
    CHECK(!reg.all_of<RpgStats>(to));
    CHECK(!reg.all_of<PlayerMelee>(from));
    CHECK(!reg.all_of<PlayerRanged>(from));

    {
        RpgStats& rs = reg.get<RpgStats>(from);
        rs.xp = 777u;
        rs.psi = 42;
        rs.level = 5;
        rs.attrPoints = 3;
        rs.attr[static_cast<std::size_t>(Attr::Str)] = 11;
        rs.attr[static_cast<std::size_t>(Attr::Agi)] = 9;
        rs.attr[static_cast<std::size_t>(Attr::Int)] = 7;
    }
    reg.emplace<PlayerMelee>(from, PlayerMelee{/*cooldownMs=*/0, /*kills=*/99});
    {
        PlayerRanged pr{};
        pr.magCount = 12;
        pr.weapon = static_cast<ItemId>(7);
        pr.shots = 7;
        pr.hits = 3;
        reg.emplace<PlayerRanged>(from, pr);
    }

    transfer_player_progression(reg, from, to);

    // Sheet landed on the destination (NPC body never had one before).
    CHECK(reg.all_of<RpgStats>(to));
    CHECK(reg.get<RpgStats>(to).xp == 777u);
    CHECK(reg.get<RpgStats>(to).psi == 42);
    CHECK(reg.get<RpgStats>(to).level == 5);
    CHECK(reg.get<RpgStats>(to).attrPoints == 3);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Str)] == 11);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Agi)] == 9);
    CHECK(reg.get<RpgStats>(to).attr[static_cast<std::size_t>(Attr::Int)] == 7);

    // Kills MOVED.
    CHECK(reg.all_of<PlayerMelee>(to));
    CHECK(reg.get<PlayerMelee>(to).kills == 99);
    CHECK(reg.get<PlayerMelee>(from).kills == 0);

    // Cumulative shots/hits MOVED; chambered mag STAYS on the abandoned body.
    CHECK(reg.all_of<PlayerRanged>(to));
    CHECK(reg.get<PlayerRanged>(to).shots == 7);
    CHECK(reg.get<PlayerRanged>(to).hits == 3);
    CHECK(reg.get<PlayerRanged>(to).magCount == 0);
    CHECK(reg.get<PlayerRanged>(to).weapon == static_cast<ItemId>(0));
    CHECK(reg.get<PlayerRanged>(from).magCount == 12);
    CHECK(reg.get<PlayerRanged>(from).weapon == static_cast<ItemId>(7));
    CHECK(reg.get<PlayerRanged>(from).shots == 0);
    CHECK(reg.get<PlayerRanged>(from).hits == 0);

    // Idempotent no-op on same entity; invalid handles do not crash.
    transfer_player_progression(reg, to, to);
    CHECK(reg.get<PlayerMelee>(to).kills == 99);
    transfer_player_progression(reg, entt::null, to);
    transfer_player_progression(reg, to, entt::null);
}

static void test_rpg_all() {
    test_rpg_curve();
    test_rpg_derived();
    test_rpg_melee_and_psi();
    test_rpg_xp_sources();
    test_rpg_award_and_spend();
    test_rpg_random_build();
    test_rpg_kill_awards_xp();
    test_rpg_combat_wire();
    test_rpg_possess_transfer();
}
""",
    "suite_rpg POSRPG pin",
)

print("ALL PATCHES APPLIED")
