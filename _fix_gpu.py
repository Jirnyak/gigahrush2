# Fix GpuHandoff: call spawn_debris_pieces (not bus.publish DebrisSpawnEvent),
# and correct suite expectation chips==3 (default count).
from pathlib import Path

root = Path(r"C:\hades\gigahrush2")

# --- prop_system.cpp ---
ps = root / "src" / "game" / "prop_system.cpp"
t = ps.read_text(encoding="utf-8")
old = """    if (mode == PropFallMode::GpuHandoff) {
        // GPU particle handoff then destroy parent entity.
        DebrisSpawnEvent ev{};
        ev.pos = pos;
        ev.impulse = impulse;
        ev.color = col;
        ev.meshKind = mk;
        bus.publish(ev);
        reg.destroy(prop);
        return;
    }"""
new = """    if (mode == PropFallMode::GpuHandoff) {
        // Shatter parent into CPU debris chips then destroy it
        // ([jirnyak.md] §18/19 — sim debris on BodyPass, not void / bus POD).
        DebrisSpawnEvent ev{};
        ev.pos = pos;
        ev.impulse = impulse;
        ev.color = col;
        ev.meshKind = mk;
        LayerId layer = 0;
        if (reg.all_of<Transform>(prop))
            layer = reg.get<Transform>(prop).layer;
        spawn_debris_pieces(reg, ev, layer, /*count=*/3);
        reg.destroy(prop);
        return;
    }"""
if old not in t:
    raise SystemExit("prop_system GpuHandoff block not found")
ps.write_text(t.replace(old, new, 1), encoding="utf-8")
print("OK prop_system GpuHandoff -> spawn_debris_pieces")

# --- suite_props_game.inl ---
sp = root / "tests" / "suite_props_game.inl"
t = sp.read_text(encoding="utf-8")
# Fix the wrong CHECK(chips == 0u) that greenwashed the void shatter.
old_chk = """    // Three debris chips (default count) with full BodyPass payload.
    std::uint32_t chips = 0;
    auto view = reg.view<const game::DynamicBodyTag, const AngularVelocity,
                         const Velocity, const Rotation, const AABB>();
    for (auto d : view) {
        CHECK(reg.get<Transform>(d).layer == layer);
        const vec3& w = reg.get<AngularVelocity>(d).w;
        CHECK(w.x * w.x + w.y * w.y + w.z * w.z > 1e-6f);
        ++chips;
    }
    CHECK(chips == 0u);
    printf("[props] GpuHandoff detach -> %u debris with AngularVelocity\\n", chips);"""
new_chk = """    // Three debris chips (default count) with full BodyPass payload.
    std::uint32_t chips = 0;
    auto view = reg.view<const game::DynamicBodyTag, const AngularVelocity,
                         const Velocity, const Rotation, const AABB>();
    for (auto d : view) {
        CHECK(reg.get<Transform>(d).layer == layer);
        const vec3& w = reg.get<AngularVelocity>(d).w;
        CHECK(w.x * w.x + w.y * w.y + w.z * w.z > 1e-6f);
        ++chips;
    }
    CHECK(chips == 3u);
    printf("[props] GpuHandoff detach -> %u debris with AngularVelocity\\n", chips);"""
if old_chk not in t:
    # try without the comment block - just the CHECK line in context
    if "CHECK(chips == 0u);" not in t:
        raise SystemExit("suite chips==0 not found")
    t2 = t.replace("CHECK(chips == 0u);", "CHECK(chips == 3u);", 1)
    if t2 == t:
        raise SystemExit("suite replace failed")
    sp.write_text(t2, encoding="utf-8")
    print("OK suite chips==3 (simple replace)")
else:
    sp.write_text(t.replace(old_chk, new_chk, 1), encoding="utf-8")
    print("OK suite chips==3 (block replace)")

print("ALL OK")
