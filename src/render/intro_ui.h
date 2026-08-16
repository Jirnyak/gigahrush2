// Студийная заставка — «TENEVIK GAMES» собирается из клеток-пикселей и
// физически перетекает в титул «ГИГАХРУЩ 2» над главным меню.
//
// Референс — shell.cpp первой игры студии (starcluster): у каждой клетки свой
// темп прилёта («иначе всё слово защёлкивается разом и читается как один
// механический кадр, а не как сборка»), при переходе к меню те же клетки
// получают новые слоты титула, лишние уходят в дрейф фона — ни одна клетка
// не исчезает даром. Здесь та же механика, но палитра НАША: красный /
// оранжевый / зелёный — советская панель индикаторов, не звёздная пыль.
//
// Самодостаточно: ноль игровых данных, рисует в ImDrawList, состояние своё.
// Хозяин фаз — UiShell ([ui_shell.h]): Intro рисует сборку логотипа,
// Menu — титул; переход intro->menu дёргает retarget_title().
#pragma once

#include <cstdint>
#include <vector>

struct ImDrawList;

namespace giga {

struct IntroFx {
    struct Cell {
        float x, y;    // текущее
        float hx, hy;  // дом (слот глифа или точка дрейфа)
        float vx, vy;
        float wob;     // фаза покачивания
        float rate;    // индивидуальный темп прилёта, 0.65..1.35
        std::uint32_t col;
        std::uint8_t drift;  // 1 = фоновая клетка без слота
    };

    std::vector<Cell> cells;
    float px = 8.0f;       // размер клетки логотипа
    float titlePx = 6.0f;  // размер клетки титула
    bool builtLogo = false;
    bool titleMode = false;
    std::uint32_t seed = 0x7E9E71Cu;

    // Разложить «TENEVIK / GAMES» по центру экрана, клетки разлетаются с
    // краёв. Зовётся лениво из draw() при первом кадре Intro.
    void build_logo(float w, float h);

    // Тем же клеткам — слоты титула «ГИГАХРУЩ 2» вверху экрана; лишние — в
    // дрейф. Зовётся один раз на переходе Intro -> Menu.
    void retarget_title(float w, float h);

    // Шаг физики + отрисовка. Возвращает true, когда логотип собрался
    // (все клетки почти дома) — Intro может показывать подпись и подсказку.
    bool step_draw(ImDrawList* dl, float w, float h, float dt);
};

} // namespace giga
