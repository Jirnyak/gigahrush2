// РЕПРО бага плейтеста 2026-08-19: направленная асимметрия разрушения.
//
// На падике стрельба ВНИЗ честно карвит пол, стрельба ВВЕРХ в ту же плиту не
// оставляет и царапины. Геометрия падика — сэндвич ([floors/padic/padic_gen.cpp]):
// верхняя клетка яруса несёт материю ТОЛЬКО в верхней четверти (подслои sz=6
// потолок + sz=7 пол), нижние 6 подслоёв — воздух, но макро-тип клетки ≠ kCellAir.
//
// А фаза 1 projectile_step детектит стену по МАКРО-клетке (combat.cpp:
// `grid.cell(...) != kCellAir`) и ставит impactPos = tr.pos — первую позицию
// шага, оказавшуюся внутри клетки. Сверху эта позиция лежит в пределах v*dt
// (0.22..0.7 м при 14..44 cells/s) от ВЕРХНЕЙ грани — то есть в самой плите:
// carve_sphere радиусом kBulletCarveRadius=0.35 катает по материи, removed > 0.
// Снизу та же арифметика даёт точку у НИЖНЕЙ грани — в 1.5..2.0 м от материи:
// карв катает по пустым субвокселям, removed == 0, пуля при этом гибнет.
// Отсюда же «лампочка на потолке не разбивается»: пуля вверх умирает у нижней
// грани сэндвич-клетки, на 1.5 м ниже лампы, и до проп-чека не доживает.
//
// Тест строит сэндвич-клетку руками (макро-тип бетон, маска только sz=6..7 —
// байт в байт то, что put_bits падика делает с плитой), стреляет в неё сверху
// и снизу, дренирует CarveProposalQueue через carve_sphere — тем же путём, что
// src/app/main.cpp:4411 — и сравнивает removed. На дереве до фикса тест
// КРАСНЫЙ: down > 0, up == 0.
static void test_shot_carves_updown() {
    LevelStack stack;
    LayerId layer = stack.push_layer();   // свежий слой — весь воздух
    World& w = stack.layer(layer);
    MacroGrid& g = w.grid();

    // Сэндвич-клетка (20,20,10): мир z в [20,22), материя в [21.5,22).
    const int CX = 20, CY = 20, CZ = 10;
    auto build_sandwich = [&] {
        g.fill_cell(CX, CY, CZ, kMatConcrete);
        SubMask& m = g.mask(CX, CY, CZ);
        for (int wz = 0; wz < 6; ++wz) m.words[wz] = 0;   // sz=0..5 — воздух
    };

    NpcPool pool;
    pool.init();
    EventBus bus;

    // Выстрел + дренаж предложений тем же carve_sphere-путём, что и приложение.
    // gravityPct 0: тест про геометрию попадания, не про баллистику; скорость
    // 40 м/с — середина диапазона таблицы стволов.
    struct ShotOut {
        std::int32_t removed; // суммарный removed по всем предложениям
        bool alive;           // пережила ли пуля все тики
        float endZ;           // финальная z — «долетела насквозь» меряется ею
    };
    auto fire_and_carve = [&](const vec3& at, const vec3& vel) -> ShotOut {
        Registry reg;
        Entity b = reg.create();
        Transform t;
        t.pos = at;
        t.layer = layer;
        reg.emplace<Transform>(b, t);
        reg.emplace<Velocity>(b, Velocity{vel});
        reg.emplace<AABB>(b, AABB{vec3{0.05f, 0.05f, 0.05f}});
        reg.emplace<Projectile>(
            b, Projectile{entt::null, 100, 5000, 0,
                          static_cast<std::uint8_t>(ProjType::Bullet), 0, 0});

        CarveProposalQueue carves;
        CarveScratch scratch;
        CarveResult res;
        std::int32_t removed = 0;
        float endZ = at.z;
        for (std::uint64_t tick = 1; tick <= 64 && reg.valid(b); ++tick) {
            projectile_step(reg, pool, bus, stack, layer, kSimDt, tick,
                            nullptr, entt::null, &carves);
            for (std::uint8_t i = 0; i < carves.count; ++i) {
                const CarveProposal& pr = carves.items[i];
                CarveOp op;
                op.x = pr.x;
                op.y = pr.y;
                op.z = pr.z;
                op.radius = pr.radius;
                op.power = pr.power;
                op.seed = pr.seed;
                removed += carve_sphere(w, op, scratch, res);
            }
            carves.clear();
            if (reg.valid(b)) endZ = reg.get<Transform>(b).pos.z;
        }
        return ShotOut{removed, reg.valid(b), endZ};
    };

    // Вверх — СНАЧАЛА: мир ещё нетронут, removed меряет только этот выстрел.
    build_sandwich();
    const ShotOut up =
        fire_and_carve(vec3{41.0f, 41.0f, 17.0f}, vec3{0.0f, 0.0f, 40.0f});

    // Пересобрать плиту, затем вниз — выстрелы независимы.
    build_sandwich();
    const ShotOut down =
        fire_and_carve(vec3{41.0f, 41.0f, 25.0f}, vec3{0.0f, 0.0f, -40.0f});

    std::fprintf(stderr,
                 "[shotsub] один и тот же сэндвич: removed вниз=%d, вверх=%d "
                 "(асимметрия = баг плейтеста 2026-08-19)\n",
                 down.removed, up.removed);
    // Плита обязана остановить пулю в обе стороны — сквозняк был бы
    // отдельным дефектом, не этим.
    CHECK(!up.alive);
    CHECK(!down.alive);
    CHECK(down.removed > 0);   // сверху плита в пределах шага от грани — скол есть
    CHECK(up.removed > 0);     // КРАСНЫЙ до фикса: карв у нижней грани, материя в 1.5 м

    // ПРОСТРЕЛИЛ ДЫРУ НАСКВОЗЬ — ловушка аудита §1.1, которую закрывает тот же
    // корень: макро-тест объявлял прокарвленную насквозь клетку «стеной», и
    // пуля вязла в воздухе собственной дыры. Дыра 0.75×0.75 м в плите (столбец
    // субвокселей sx,sy=3..5 обнулён в обоих словах сэндвича), выстрел снизу
    // сквозь неё: пуля обязана выжить, пролететь клетку и ничего не сколоть.
    build_sandwich();
    {
        SubMask& m = g.mask(CX, CY, CZ);
        std::uint64_t hole = 0;
        for (int sy = 3; sy <= 5; ++sy)
            for (int sx = 3; sx <= 5; ++sx)
                hole |= std::uint64_t{1} << (sx + sy * kSubDim);
        m.words[6] &= ~hole;
        m.words[7] &= ~hole;
    }
    const ShotOut through =
        fire_and_carve(vec3{41.0f, 41.0f, 17.0f}, vec3{0.0f, 0.0f, 40.0f});
    std::fprintf(stderr,
                 "[shotsub] сквозь дыру: alive=%d endZ=%.2f removed=%d "
                 "(аудит §1.1: раньше вязла в воздухе своей же дыры)\n",
                 through.alive ? 1 : 0, through.endZ, through.removed);
    CHECK(through.alive);          // пуля пережила «твёрдую» по макро-типу клетку
    CHECK(through.endZ > 22.5f);   // и честно вышла с той стороны плиты
    CHECK(through.removed == 0);   // не задев краёв дыры
}
