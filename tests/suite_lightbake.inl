// suite_lightbake.inl — светоматериалы → статические эмиттеры
// ([game/light_bake.h], [ddalight.md]). Пины: пустой мир молчит; полоса неона
// = ОДИН кластер с центроидом в середине и радиусом «таблица + полудиагональ»;
// разрозненные пятна не сливаются; кластер ЧЕРЕЗ ШОВ ТОРА собирается в один и
// центроид НЕ разъезжается на полмира (класс бага половинного периода);
// инкрементальный патч поля даёт РОВНО то же поле, что полный скан (§4 плана
// neon-topology — фриз убит без смены ответа); светит только СУЩЕСТВУЮЩИЙ атом
// (карв чистит маску, не материал — бейк без маски видел выбитые атомы
// светящимися); ИДЕНТИЧНОСТЬ ИЗ СВЯЗНОСТИ: похудение хранит id, разделение
// наследует части с младшим выжившим атомом, слияние берёт младший id.

#include <cmath>
#include <cstring>

#include "game/light_bake.h"
#include "world/destruct.h"
#include "world/material_props.h"
#include "world/materials.h"
#include "world/world.h"

static void test_light_bake_clusters() {
    World w;
    game::EmitterField field;
    game::EmitterClusters clusters;
    game::rebuild_emitter_field(w, field);
    CHECK(field.cells.empty());
    CHECK(game::bake_material_lights(w, field, clusters).empty());

    // Полоса неона 5 ячеек вдоль x: (10..14, 20, 30). fill_cell, не set_cell:
    // светят АТОМЫ, атом обязан существовать в маске присутствия.
    auto& g = w.grid();
    for (int i = 0; i < 5; ++i) g.fill_cell(10 + i, 20, 30, kMatNeonTube);
    game::rebuild_emitter_field(w, field);
    auto lights = game::bake_material_lights(w, field, clusters);
    CHECK(lights.size() == 1);
    const std::uint32_t stripId = lights[0].id;
    // Центроид середины полосы: атомы x 80..119, ((80+119)/2 + 0.5) * 0.25 = 25.
    CHECK(std::fabs(lights[0].pos.x - 25.0f) < 1e-3f);
    CHECK(std::fabs(lights[0].pos.y - 41.0f) < 1e-3f);
    CHECK(std::fabs(lights[0].pos.z - 61.0f) < 1e-3f);
    // Радиус = табличный + полудиагональ экстента (40 x 8 x 8 атомов = 5,1,1 м
    // полуразмеры): выведено, не подобрано.
    const float tableR =
        static_cast<float>(kMatLightRadiusMm[kMatNeonTube]) * 0.001f;
    CHECK(std::fabs(lights[0].radiusM - (tableR + std::sqrt(27.0f))) < 1e-3f);
    CHECK(std::fabs(lights[0].intensity -
                    static_cast<float>(kMatLightIntensityE3[kMatNeonTube]) *
                        0.001f) < 1e-4f);
    // Цвет источника = альбедо материала.
    CHECK(std::fabs(lights[0].color.y - kMatAlbedoG[kMatNeonTube]) < 1e-4f);

    // Отдельное пятно в другом углу — второй кластер, не слившийся, с НОВЫМ id.
    g.fill_cell(60, 60, 60, kMatNeonTube);
    game::rebuild_emitter_field(w, field);
    lights = game::bake_material_lights(w, field, clusters);
    CHECK(lights.size() == 2);
    CHECK(lights[0].id == stripId);
    const std::uint32_t spotId = lights[1].id;
    CHECK(spotId != stripId);

    // ПАТЧ = ПОЛНЫЙ СКАН. Мутируем мир (снесли хвост полосы, подрастили пятно,
    // задели непричастную ячейку) и латаем поле только по этим индексам —
    // поле обязано совпасть со свежим сканом, id — пережить мутацию.
    g.clear_cell(14, 20, 30);              // хвост полосы умер
    g.fill_cell(61, 60, 60, kMatNeonTube); // пятно подросло
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
    CHECK(field.emitMask.size() == fresh.emitMask.size());
    for (std::size_t i = 0; i < field.emitMask.size(); ++i)
        CHECK(std::memcmp(field.emitMask[i].words, fresh.emitMask[i].words,
                          sizeof(field.emitMask[i].words)) == 0);
    lights = game::bake_material_lights(w, field, clusters);
    CHECK(lights.size() == 2);
    // ИДЕНТИЧНОСТЬ: полоса похудела — id тот же; пятно выросло — id тот же.
    CHECK(lights[0].id == stripId);
    CHECK(lights[1].id == spotId);
    // Повторный патч тех же ячеек — мир не менялся, поле молчит.
    CHECK(!game::patch_emitter_field(w, field, dirty, 3));

    // РАЗДЕЛЕНИЕ: вынесли середину полосы (12) — две части; часть с младшим
    // выжившим атомом (левая, ячейки 10-11) наследует stripId, правая (13)
    // получает новый id.
    g.clear_cell(12, 20, 30);
    {
        const std::uint32_t d[] = {
            static_cast<std::uint32_t>(macro_index(12, 20, 30))};
        CHECK(game::patch_emitter_field(w, field, d, 1));
    }
    lights = game::bake_material_lights(w, field, clusters);
    CHECK(lights.size() == 3);
    std::uint32_t leftId = 0, rightId = 0;
    for (const auto& l : lights) {
        if (std::fabs(l.pos.x - 22.0f) < 0.3f) leftId = l.id;  // ячейки 10-11
        if (std::fabs(l.pos.x - 27.0f) < 0.3f) rightId = l.id; // ячейка 13
    }
    CHECK(leftId == stripId);
    CHECK(rightId != stripId && rightId != spotId);

    // СЛИЯНИЕ: вернули середину — части срослись, выжил младший id (stripId).
    g.fill_cell(12, 20, 30, kMatNeonTube);
    {
        const std::uint32_t d[] = {
            static_cast<std::uint32_t>(macro_index(12, 20, 30))};
        CHECK(game::patch_emitter_field(w, field, d, 1));
    }
    lights = game::bake_material_lights(w, field, clusters);
    CHECK(lights.size() == 2);
    bool sawStrip = false, sawDead = false;
    for (const auto& l : lights) {
        sawStrip = sawStrip || l.id == stripId;
        sawDead = sawDead || l.id == rightId;
    }
    CHECK(sawStrip);
    CHECK(!sawDead); // id правой части умер в слиянии — надгробие за таблицей

    // МАСКА, НЕ МАТЕРИАЛ: карв выбивает атомы из маски присутствия, материал
    // клетки стоит. Одиночная неоновая ячейка, выбили всё, кроме углового
    // атома — патч видит перемену, светит ровно выживший атом (центроид — его
    // центр), id пережил похудение до одного атома.
    {
        g.fill_cell(70, 70, 70, kMatNeonTube);
        const std::uint32_t d[] = {
            static_cast<std::uint32_t>(macro_index(70, 70, 70))};
        CHECK(game::patch_emitter_field(w, field, d, 1));
        lights = game::bake_material_lights(w, field, clusters);
        CHECK(lights.size() == 3);
        std::uint32_t soloId = 0;
        for (const auto& l : lights)
            if (l.id != stripId && l.id != spotId) soloId = l.id;
        SubMask& m = g.mask(70, 70, 70);
        m.clear_all();
        m.set(sub_bit(0, 0, 0));
        CHECK(game::patch_emitter_field(w, field, d, 1));
        lights = game::bake_material_lights(w, field, clusters);
        CHECK(lights.size() == 3);
        bool found = false;
        for (const auto& l : lights)
            if (l.id == soloId) {
                found = true;
                // Атом (0,0,0) ячейки 70: (70*8 + 0.5) * 0.25 = 140.125.
                CHECK(std::fabs(l.pos.x - 140.125f) < 1e-3f);
            }
        CHECK(found);
    }

    // СВЯЗНОСТЬ АТОМОВ, НЕ КЛЕТОК: два одиночных атома в СОСЕДНИХ ячейках,
    // между ними зазор в один воксель — ДВА кластера (клеточная связность
    // склеила бы их в один).
    {
        g.mask(90, 90, 90).set(sub_bit(7, 0, 0));
        set_sub_material(w, 90, 90, 90, 7, 0, 0, kMatNeonTube);
        g.mask(91, 90, 90).set(sub_bit(1, 0, 0));
        set_sub_material(w, 91, 90, 90, 1, 0, 0, kMatNeonTube);
        const std::uint32_t d[] = {
            static_cast<std::uint32_t>(macro_index(90, 90, 90)),
            static_cast<std::uint32_t>(macro_index(91, 90, 90))};
        CHECK(game::patch_emitter_field(w, field, d, 2));
        lights = game::bake_material_lights(w, field, clusters);
        CHECK(lights.size() == 5);
    }

    // Шов тора: полоса 126,127,0,1 по x — один кластер, центроид на шве
    // (x = 0 м), а не размазанный на полмира.
    World w2;
    auto& g2 = w2.grid();
    for (int i = -2; i < 2; ++i) g2.fill_cell(i, 5, 5, kMatNeonTube);
    game::EmitterField f2;
    game::EmitterClusters c2;
    game::rebuild_emitter_field(w2, f2);
    auto seam = game::bake_material_lights(w2, f2, c2);
    CHECK(seam.size() == 1);
    CHECK(std::fabs(seam[0].pos.x - 0.0f) < 1e-3f);
}
