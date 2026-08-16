#include "render/intro_ui.h"

#include <cmath>

#include "imgui.h"

namespace giga {

namespace {

// --- 5x7 глифы -------------------------------------------------------------
// Ровно те буквы, что нужны двум словам и титулу — это заставка, не шрифт.
// Строка = 35 символов, '1' — клетка. Кириллица адресуется идентификатором,
// не кодировкой: раскладка слова — список глифов, декодер UTF-8 не нужен.
enum Glyph : std::uint8_t {
    gT, gE, gN, gV, gI, gK, gG, gA, gM, gS,
    gGe, gII, gHa, gEr, gU, gShcha, g2, gSpace,
};

const char* glyph_rows(Glyph g) {
    switch (g) {
        case gT: return "11111""..1..""..1..""..1..""..1..""..1..""..1..";
        case gE: return "11111""1....""1....""1111.""1....""1....""11111";
        case gN: return "1...1""11..1""1.1.1""1..11""1...1""1...1""1...1";
        case gV: return "1...1""1...1""1...1""1...1""1...1"".1.1.""..1..";
        case gI: return "11111""..1..""..1..""..1..""..1..""..1..""11111";
        case gK: return "1...1""1..1.""1.1..""11...""1.1..""1..1.""1...1";
        case gG: return ".1111""1....""1....""1.111""1...1""1...1"".1111";
        case gA: return ".111.""1...1""1...1""11111""1...1""1...1""1...1";
        case gM: return "1...1""11.11""1.1.1""1.1.1""1...1""1...1""1...1";
        case gS: return ".1111""1....""1....""" ".111.""....1""....1""1111.";
        case gGe: return "11111""1....""1....""1....""1....""1....""1....";
        case gII: return "1...1""1...1""1..11""1.1.1""11..1""1...1""1...1";
        case gHa: return "1...1"".1.1.""..1..""..1..""..1.."".1.1.""1...1";
        case gEr: return "1111.""1...1""1...1""1111.""1....""1....""1....";
        case gU: return "1...1""1...1"".1.1.""..1..""..1..""..1.."".1...";
        case gShcha: return "1.1.1""1.1.1""1.1.1""1.1.1""1.1.1""11111""....1";
        case g2: return ".111.""1...1""....1""...1.""..1.."".1...""11111";
        default: return nullptr;  // gSpace
    }
}

constexpr Glyph kTenevik[] = {gT, gE, gN, gE, gV, gI, gK};
constexpr Glyph kGames[] = {gG, gA, gM, gE, gS};
constexpr Glyph kTitle[] = {gGe, gII, gGe, gA, gHa, gEr, gU, gShcha, gSpace, g2};

// Палитра студии для Гигахруща: красный / оранжевый / зелёный — панель
// индикаторов, не звёздная пыль первой игры. Зелёный чаще: он же фосфор
// остального интерфейса ([imgui_layer.cpp]), красный — акцент тревоги.
constexpr std::uint32_t kPalette[] = {
    IM_COL32(242, 89, 89, 255),   // красный
    IM_COL32(242, 166, 89, 255),  // оранжевый
    IM_COL32(89, 242, 102, 255),  // зелёный (фосфор)
    IM_COL32(89, 242, 102, 255),  // зелёный x2 — доминанта
};

std::uint32_t rnd(std::uint32_t& s) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return s;
}
float frand(std::uint32_t& s) {
    return static_cast<float>(rnd(s) & 0xFFFF) / 65535.0f;
}

// Слоты слова: центр строки в (cx, y), клетка px, зазор в 1 клетку.
void layout_word(const Glyph* word, int n, float cx, float y, float px,
                 std::vector<ImVec2>& out) {
    float w = 0;
    for (int i = 0; i < n; ++i) w += (word[i] == gSpace ? 3.0f : 6.0f) * px;
    float x = cx - w * 0.5f;
    for (int i = 0; i < n; ++i) {
        if (word[i] == gSpace) { x += 3.0f * px; continue; }
        const char* rows = glyph_rows(word[i]);
        for (int ry = 0; ry < 7; ++ry)
            for (int rx = 0; rx < 5; ++rx)
                if (rows[ry * 5 + rx] == '1')
                    out.push_back(ImVec2(x + rx * px, y + ry * px));
        x += 6.0f * px;
    }
}

} // namespace

void IntroFx::build_logo(float w, float h) {
    cells.clear();
    px = w * 0.55f / (7.0f * 6.0f);
    if (px < 4.0f) px = 4.0f;
    if (px > 14.0f) px = 14.0f;
    std::vector<ImVec2> slots;
    const float rowH = 7.0f * px;
    layout_word(kTenevik, 7, w * 0.5f, h * 0.5f - rowH - px * 1.5f, px, slots);
    layout_word(kGames, 5, w * 0.5f, h * 0.5f + px * 1.5f, px, slots);
    cells.reserve(slots.size());
    for (const ImVec2& s : slots) {
        Cell c;
        // Разлёт с краёв: клетка прилетает снаружи, как деталь на конвейер.
        const int side = static_cast<int>(rnd(seed) & 3u);
        c.x = side == 0 ? -30.0f : side == 1 ? w + 30.0f : frand(seed) * w;
        c.y = side == 2 ? -30.0f : side == 3 ? h + 30.0f : frand(seed) * h;
        c.hx = s.x; c.hy = s.y;
        c.vx = c.vy = 0.0f;
        c.wob = frand(seed) * 6.28f;
        // Свой темп у каждой клетки — иначе слово защёлкивается одним
        // механическим кадром (урок shell.cpp первой игры).
        c.rate = 0.65f + frand(seed) * 0.70f;
        c.col = kPalette[rnd(seed) & 3u];
        c.drift = 0;
        cells.push_back(c);
    }
    builtLogo = true;
    titleMode = false;
}

void IntroFx::retarget_title(float w, float h) {
    titlePx = w * 0.5f / (10.0f * 6.0f);
    if (titlePx < 3.0f) titlePx = 3.0f;
    if (titlePx > 10.0f) titlePx = 10.0f;
    std::vector<ImVec2> slots;
    layout_word(kTitle, 10, w * 0.5f, h * 0.10f, titlePx, slots);
    // Те же клетки — новые слоты; лишние уходят в дрейф фона, недостающие
    // досыпаются с краёв. Ни одна клетка не исчезает даром.
    const std::size_t n = slots.size();
    for (std::size_t i = 0; i < cells.size(); ++i) {
        Cell& c = cells[i];
        if (i < n) {
            c.hx = slots[i].x; c.hy = slots[i].y; c.drift = 0;
        } else {
            c.hx = frand(seed) * w; c.hy = frand(seed) * h; c.drift = 1;
        }
    }
    for (std::size_t i = cells.size(); i < n; ++i) {
        Cell c;
        c.x = frand(seed) < 0.5f ? -20.0f : w + 20.0f;
        c.y = frand(seed) * h;
        c.hx = slots[i].x; c.hy = slots[i].y;
        c.vx = c.vy = 0.0f;
        c.wob = frand(seed) * 6.28f;
        c.rate = 0.8f + frand(seed) * 0.6f;
        c.col = kPalette[rnd(seed) & 3u];
        c.drift = 0;
        cells.push_back(c);
    }
    titleMode = true;
}

bool IntroFx::step_draw(ImDrawList* dl, float w, float h, float dt) {
    if (!builtLogo) build_logo(w, h);
    if (dt > 0.05f) dt = 0.05f;
    const float cellPx = titleMode ? titlePx : px;
    int settled = 0;
    for (Cell& c : cells) {
        c.wob += dt * 2.0f;
        // Экспоненциальное схождение с индивидуальным темпом: быстрый вылет,
        // мягкая посадка, никаких осцилляций — пружина здесь недодемпфируется
        // и роится (проверено пробой кадра 140).
        const float ease = 1.0f - std::exp(-2.4f * c.rate * dt);
        const float dx = c.hx - c.x, dy = c.hy - c.y;
        c.x += dx * ease;
        c.y += dy * ease;
        const float d2 = dx * dx + dy * dy;
        if (d2 < cellPx * cellPx) ++settled;
        const float wobble = c.drift ? 2.0f : 0.22f;
        const float ox = std::sin(c.wob) * wobble;
        const float oy = std::cos(c.wob * 0.8f) * wobble;
        const float a = c.drift ? 90.0f : 255.0f;
        const std::uint32_t col = (c.col & 0x00FFFFFFu) |
                                  (static_cast<std::uint32_t>(a) << 24);
        dl->AddRectFilled(ImVec2(c.x + ox, c.y + oy),
                          ImVec2(c.x + ox + cellPx - 1.0f,
                                 c.y + oy + cellPx - 1.0f),
                          col);
    }
    return settled >= static_cast<int>(cells.size() * 9 / 10);
}

} // namespace giga
