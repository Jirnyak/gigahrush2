// suite_lightbake.inl — светоматериалы → статические эмиттеры
// ([game/light_bake.h], [ddalight.md]). Пины: пустой мир молчит; полоса неона
// = ОДИН кластер с центроидом в середине и радиусом «таблица + полудиагональ»;
// разрозненные пятна не сливаются; кластер ЧЕРЕЗ ШОВ ТОРА собирается в один и
// центроид НЕ разъезжается на полмира (класс бага половинного периода);
// инкрементальный патч поля даёт РОВНО то же поле, что полный скан
// ([markoaudit/plans/neon-topology.md] §4 — фриз убит без смены ответа).

#include <cmath>

#include "game/light_bake.h"
#include "world/destruct.h"
#include "world/material_props.h"
#include "world/materials.h"
#include "world/world.h"

static void test_light_bake_clusters() {
    World w;
    game::EmitterField field;
    game::rebuild_emitter_field(w, field);
    CHECK(field.cells.empty());
    CHECK(game::bake_material_lights(field).empty());

    // Полоса неона 5 ячеек вдоль x: (10..14, 20, 30).
    auto& g = w.grid();
    for (int i = 0; i < 5; ++i) g.set_cell(10 + i, 20, 30, kMatNeonTube);
    game::rebuild_emitter_field(w, field);
    auto lights = game::bake_material_lights(field);
    CHECK(lights.size() == 1);
    // Центроид середины полосы: ((10+14)/2 + 0.5) * 2 м = 25.
    CHECK(std::fabs(lights[0].pos.x - 25.0f) < 1e-3f);
    CHECK(std::fabs(lights[0].pos.y - 41.0f) < 1e-3f);
    CHECK(std::fabs(lights[0].pos.z - 61.0f) < 1e-3f);
    // Радиус = табличный + полудиагональ экстента (5 x 1 x 1 ячеек = 5,1,1 м
    // полуразмеры): выведено, не подобрано.
    const float tableR =
        static_cast<float>(kMatLightRadiusMm[kMatNeonTube]) * 0.001f;
    CHECK(std::fabs(lights[0].radiusM - (tableR + std::sqrt(27.0f))) < 1e-3f);
    CHECK(std::fabs(lights[0].intensity -
                    static_cast<float>(kMatLightIntensityE3[kMatNeonTube]) *
                        0.001f) < 1e-4f);
    // Цвет источника = альбедо материала.
    CHECK(std::fabs(lights[0].color.y - kMatAlbedoG[kMatNeonTube]) < 1e-4f);

    // Отдельное пятно в другом углу — второй кластер, не слившийся.
    g.set_cell(60, 60, 60, kMatNeonTube);
    game::rebuild_emitter_field(w, field);
    CHECK(game::bake_material_lights(field).size() == 2);

    // ПАТЧ = ПОЛНЫЙ СКАН. Мутируем мир (снесли хвост полосы, поставили новую
    // ячейку, задели непричастную) и латаем поле только по этим индексам —
    // поле и кластеры обязаны совпасть со свежим сканом.
    g.set_cell(14, 20, 30, 0);          // хвост полосы умер
    g.set_cell(61, 60, 60, kMatNeonTube); // пятно подросло
    const std::uint32_t dirty[] = {
        static_cast<std::uint32_t>(macro_index(14, 20, 30)),
        static_cast<std::uint32_t>(macro_index(61, 60, 60)),
        static_cast<std::uint32_t>(macro_index(5, 5, 5)), // непричастная
    };
    CHECK(game::patch_emitter_field(w, field, dirty, 3));
    game::EmitterField fresh;
    game::rebuild_emitter_field(w, fresh);
    CHECK(field.mat == fresh.mat);
    CHECK(field.cells == fresh.cells);
    CHECK(game::bake_material_lights(field).size() == 2);
    // Повторный патч тех же ячеек — мир не менялся, поле молчит.
    CHECK(!game::patch_emitter_field(w, field, dirty, 3));

    // Субвоксельная честность патча: неон, нарисованный ОДНИМ атомом в чужой
    // ячейке, патч обязан увидеть (прежняя проверка по типу ячейки — слепа).
    set_sub_material(w, 80, 80, 80, 1, 1, 1, kMatNeonTube);
    const std::uint32_t dirtySub[] = {
        static_cast<std::uint32_t>(macro_index(80, 80, 80))};
    CHECK(game::patch_emitter_field(w, field, dirtySub, 1));
    CHECK(game::bake_material_lights(field).size() == 3);

    // Шов тора: полоса 126,127,0,1 по x — один кластер, центроид на шве
    // (x = 0 м), а не размазанный на полмира.
    World w2;
    auto& g2 = w2.grid();
    for (int i = -2; i < 2; ++i) g2.set_cell(i, 5, 5, kMatNeonTube);
    game::EmitterField f2;
    game::rebuild_emitter_field(w2, f2);
    auto seam = game::bake_material_lights(f2);
    CHECK(seam.size() == 1);
    CHECK(std::fabs(seam[0].pos.x - 0.0f) < 1e-3f);
}
