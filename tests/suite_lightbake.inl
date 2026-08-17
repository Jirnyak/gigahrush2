// suite_lightbake.inl — светоматериалы → статические эмиттеры
// ([game/light_bake.h], [ddalight.md]). Пины: пустой мир молчит; полоса неона
// = ОДИН кластер с центроидом в середине и радиусом «таблица + полудиагональ»;
// разрозненные пятна не сливаются; кластер ЧЕРЕЗ ШОВ ТОРА собирается в один и
// центроид НЕ разъезжается на полмира (класс бага половинного периода).

#include <cmath>

#include "game/light_bake.h"
#include "world/material_props.h"
#include "world/materials.h"
#include "world/world.h"

static void test_light_bake_clusters() {
    World w;
    CHECK(game::bake_material_lights(w).empty());

    // Полоса неона 5 ячеек вдоль x: (10..14, 20, 30).
    auto& g = w.grid();
    for (int i = 0; i < 5; ++i) g.set_cell(10 + i, 20, 30, kMatNeonTube);
    auto lights = game::bake_material_lights(w);
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
    CHECK(game::bake_material_lights(w).size() == 2);

    // Шов тора: полоса 126,127,0,1 по x — один кластер, центроид на шве
    // (x = 0 м), а не размазанный на полмира.
    World w2;
    auto& g2 = w2.grid();
    for (int i = -2; i < 2; ++i) g2.set_cell(i, 5, 5, kMatNeonTube);
    auto seam = game::bake_material_lights(w2);
    CHECK(seam.size() == 1);
    CHECK(std::fabs(seam[0].pos.x - 0.0f) < 1e-3f);
}
