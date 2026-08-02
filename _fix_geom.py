from pathlib import Path

p = Path(r"C:\hades\gigahrush2\tests\suite_props_game.inl")
t = p.read_text(encoding="utf-8")
logp = Path(r"C:\hades\gigahrush2\_fix_geom_log.txt")
lines = []

def rep(name, old, new):
    global t
    if old not in t:
        lines.append(f"MISS {name}")
        # show nearby markers for debug
        key = name
        idx = t.find("test_sim_owned_terminals" if "sim" in name else "test_collect_static_prop_mesh")
        lines.append(f"  idx={idx}")
        if idx >= 0:
            lines.append(repr(t[idx:idx+400]))
        return False
    t = t.replace(old, new, 1)
    lines.append(f"OK {name}")
    return True

old1 = """static void test_collect_static_prop_mesh_instances_shapes() {
    Registry reg;
    World world;
    const LayerId layer = 3;
    const std::uint32_t seed = 0xC0FFEEu;

    // Room: floor y=2, ceiling y=5, west wall at x=10 for wall devices.
    for (int y = 10; y < 18; ++y) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, y, 2, kMatConcrete);
            world.grid().fill_cell(x, y, 5, kMatConcrete);
        }
    }
    for (int y = 10; y < 18; ++y)
        for (int z = 3; z < 5; ++z)
            world.grid().fill_cell(10, y, z, kMatConcrete);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    const std::uint32_t nLamp = game::seed_ceiling_lights(reg, world, layer, seed);
    CHECK(nWall + nLamp > 0u);"""

new1 = """static void test_collect_static_prop_mesh_instances_shapes() {
    Registry reg;
    World world;
    const LayerId layer = 3;
    const std::uint32_t seed = 0xC0FFEEu;

    // Z-up: floor slab + alternating wall columns + ceiling (same contract as
    // seed_wall_interactables / seed_ceiling_lights). Tiny 8x8 west-wall room
    // under-seeds wall devices for seed 0xC0FFEE.
    paint_floor_band(world, /*x0*/2, /*x1*/70, /*zFloor*/5, /*y0*/2, /*y1*/70);
    paint_ceiling_band(world, /*x0*/2, /*x1*/70, /*zAir*/6, /*y0*/2, /*y1*/70);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    const std::uint32_t nLamp = game::seed_ceiling_lights(reg, world, layer, seed);
    CHECK(nWall + nLamp > 0u);"""

old2 = """static void test_sim_owned_terminals_seed_and_interact() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 21;
    const std::uint32_t seed = 0xC0FFEEu;

    // Floor y=2, ceiling y=5, west wall x=10 so seed_wall can place devices.
    for (int y = 10; y < 18; ++y) {
        for (int x = 10; x < 18; ++x) {
            world.grid().fill_cell(x, y, 2, kMatConcrete);
            world.grid().fill_cell(x, y, 5, kMatConcrete);
        }
    }
    for (int y = 10; y < 18; ++y)
        for (int z = 3; z < 5; ++z)
            world.grid().fill_cell(10, y, z, kMatConcrete);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    CHECK(nWall > 0u);"""

new2 = """static void test_sim_owned_terminals_seed_and_interact() {
    Registry reg;
    World world;
    EventBus bus;
    bus.init();
    const LayerId layer = 21;
    const std::uint32_t seed = 0xC0FFEEu;

    // Z-up floor band with wall columns -- seed_wall_interactables needs air
    // above solid floor + solid W/E/N/S. Tiny rooms under-seed for this salt.
    paint_floor_band(world, /*x0*/2, /*x1*/70, /*zFloor*/5, /*y0*/2, /*y1*/70);

    const std::uint32_t nWall = game::seed_wall_interactables(reg, world, layer, seed);
    CHECK(nWall > 0u);"""

ok = rep("collect", old1, new1)
ok = rep("sim_owned", old2, new2) and ok
if ok:
    p.write_text(t, encoding="utf-8", newline="\n")
    lines.append("WROTE")
else:
    lines.append("NO WRITE")
logp.write_text("\n".join(lines) + "\n", encoding="utf-8")
print("\n".join(lines))
