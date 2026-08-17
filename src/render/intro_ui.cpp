#include "render/intro_ui.h"

#include <algorithm>
#include <cmath>

#include "imgui.h"

namespace giga {

namespace {

// --- 5x7 глифы -------------------------------------------------------------
// Ровно те буквы, что нужны двум словам и титулу — это заставка, не шрифт.
// Кириллица адресуется идентификатором, не кодировкой: раскладка слова —
// список глифов, декодер UTF-8 не нужен.
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

// --- Константы рефа (shell.cpp), под теми же именами -----------------------
constexpr float kStep = 1.0f / 60.0f;  // фиксированный шаг: лента индексируется им
constexpr int kScatterSteps = 165;     // длина ленты разбегания
constexpr int kSuper = 2;              // клеток на один пиксель шрифта 5x7
constexpr float kRewindLead = 0.45f;   // пауза: успеть увидеть хаос как хаос
constexpr float kRewindRate = 0.85f;   // кадров ленты за шаг отмотки
constexpr float kFriction = 0.988f;    // множитель скорости за кадр (60 Гц)
constexpr float kFlySpeed = 850.0f;    // выше — тяга домой выключена (снаряд)
constexpr float kSpringK = 26.0f;
constexpr float kSpringDamp = 9.0f;    // ~критическое демпфирование
constexpr float kEdgeBounce = 0.78f;
constexpr float kCellBounce = 0.55f;
constexpr float kCellMaxSpeed = 3200.0f;
constexpr float kHotMargin = 1.25f;    // «летит быстрее собственной тяги»
constexpr float kHotFloor = 140.0f;
constexpr float kPushRadius = 110.0f;  // курсор: радиус влияния
constexpr float kPushRadial = 900.0f;  // расталкивание из-под курсора
constexpr float kPushDrag = 4.5f;      // доля скорости курсора клетке
constexpr float kPushHeldGain = 2.1f;  // с зажатой ЛКМ давит сильнее
constexpr float kPunchRadius = 240.0f; // щелчок — «разбить», не «смести»
constexpr float kPunchImpulse = 1900.0f;

// Палитра студии, красная доминанта (решение владельца после плейтеста).
// Цвет держит СЛОВО: верхнее/титул — красный, нижнее — оранжевый, дрейф —
// глухой кирпичный. Зелёный фосфор остаётся интерфейсу ([imgui_layer.cpp]).
constexpr ImU32 kColTop = IM_COL32(242, 70, 56, 255);     // красный
constexpr ImU32 kColBottom = IM_COL32(242, 166, 89, 255); // оранжевый
constexpr ImU32 kColDrift = IM_COL32(140, 62, 48, 255);   // кирпичный дрейф

std::uint32_t rnd(std::uint32_t& s) {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return s;
}
float frand(std::uint32_t& s) {
    return static_cast<float>(rnd(s) & 0xFFFF) / 65535.0f;
}
float srand2(std::uint32_t& s) { return frand(s) * 2.0f - 1.0f; }

void clamp_speed(IntroFx::Cell& c) {
    const float v2 = c.vx * c.vx + c.vy * c.vy;
    if (v2 > kCellMaxSpeed * kCellMaxSpeed) {
        const float k = kCellMaxSpeed / std::sqrt(v2);
        c.vx *= k; c.vy *= k;
    }
}

// Ширина слова в КЛЕТКАХ: len глифов по 6 колонок SUPER-блоков минус хвост.
int word_cell_width(int len) { return len > 0 ? len * 6 * kSuper - kSuper : 0; }

// Каждый зажжённый пиксель глифа разворачивается в блок SUPER×SUPER клеток —
// надпись читается крупным клеточным полем, а не текстом (урок рефа №1).
void layout_word(const Glyph* word, int n, float cellPx, float originX,
                 float originY, std::vector<ImVec2>& out) {
    for (int i = 0; i < n; ++i) {
        const char* rows = glyph_rows(word[i]);
        if (!rows) continue;  // gSpace
        for (int row = 0; row < 7; ++row)
            for (int col = 0; col < 5; ++col) {
                if (rows[row * 5 + col] != '1') continue;
                for (int sy = 0; sy < kSuper; ++sy)
                    for (int sx = 0; sx < kSuper; ++sx)
                        out.push_back(ImVec2(
                            originX + ((i * 6 + col) * kSuper + sx) * cellPx,
                            originY + (row * kSuper + sy) * cellPx));
            }
    }
}

} // namespace

// Коллизии клетка-об-клетку — только между физическими: едущая по ленте
// телепортируется по кадрам, толкать её бессмысленно. Соседи — по равномерной
// сетке (попарный перебор ~3.4k клеток стоил бы миллионы пар за шаг).
static void collide(IntroFx& s, float w, float h) {
    std::size_t physical = 0;
    for (const IntroFx::Cell& c : s.cells) physical += c.freed ? 1u : 0u;
    if (physical < 2) return;

    // Диаметр — от ЦЕЛЕВОГО шага решётки: на слотах соседи стоят ровно в
    // targetPx, больший диаметр расталкивал бы собранную надпись вечно.
    const float D = std::max(3.0f, s.targetPx * 0.92f);
    const float inv = 1.0f / D;
    const float off = 32.0f;
    const int gw = static_cast<int>((w + off * 2.0f) * inv) + 2;
    const int gh = static_cast<int>((h + off * 2.0f) * inv) + 2;
    if (gw < 1 || gh < 1) return;
    s.gridHead.assign(static_cast<std::size_t>(gw) * gh, -1);
    s.gridNext.assign(s.cells.size(), -1);
    s.hot.assign(s.cells.size(), 0);

    for (std::size_t i = 0; i < s.cells.size(); ++i) {
        const IntroFx::Cell& c = s.cells[i];
        if (!c.freed) continue;
        // «Горячая» = летит заметно быстрее скорости собственной тяги домой.
        // Две спокойно едущие домой клетки проходят друг сквозь друга —
        // сталкивается только то, что реально летит (урок рефа).
        const float dx = c.hx - c.x, dy = c.hy - c.y;
        const float own =
            std::sqrt(dx * dx + dy * dy) * (kSpringK / kSpringDamp);
        const float sp2 = c.vx * c.vx + c.vy * c.vy;
        const float bar = own * kHotMargin + kHotFloor;
        s.hot[i] = sp2 > bar * bar ? 1 : 0;
    }

    for (std::size_t i = 0; i < s.cells.size(); ++i) {
        if (!s.cells[i].freed) continue;
        const int gx = std::clamp(
            static_cast<int>((s.cells[i].x + off) * inv), 0, gw - 1);
        const int gy = std::clamp(
            static_cast<int>((s.cells[i].y + off) * inv), 0, gh - 1);
        const std::size_t b = static_cast<std::size_t>(gy) * gw + gx;
        s.gridNext[i] = s.gridHead[b];
        s.gridHead[b] = static_cast<int>(i);
    }

    for (std::size_t i = 0; i < s.cells.size(); ++i) {
        IntroFx::Cell& a = s.cells[i];
        if (!a.freed) continue;
        const int gx =
            std::clamp(static_cast<int>((a.x + off) * inv), 0, gw - 1);
        const int gy =
            std::clamp(static_cast<int>((a.y + off) * inv), 0, gh - 1);
        for (int oy = -1; oy <= 1; ++oy) {
            const int ny = gy + oy;
            if (ny < 0 || ny >= gh) continue;
            for (int ox = -1; ox <= 1; ++ox) {
                const int nx = gx + ox;
                if (nx < 0 || nx >= gw) continue;
                for (int j = s.gridHead[static_cast<std::size_t>(ny) * gw + nx];
                     j >= 0; j = s.gridNext[static_cast<std::size_t>(j)]) {
                    if (j <= static_cast<int>(i)) continue;  // пара один раз
                    if (!s.hot[i] && !s.hot[static_cast<std::size_t>(j)])
                        continue;
                    IntroFx::Cell& b = s.cells[static_cast<std::size_t>(j)];
                    const float dx = a.x - b.x, dy = a.y - b.y;
                    const float d2 = dx * dx + dy * dy;
                    if (d2 >= D * D || d2 < 1.0e-4f) continue;
                    const float d = std::sqrt(d2);
                    const float nX = dx / d, nY = dy / d;
                    const float push = (D - d) * 0.5f;
                    a.x += nX * push; a.y += nY * push;
                    b.x -= nX * push; b.y -= nY * push;
                    const float vn =
                        (a.vx - b.vx) * nX + (a.vy - b.vy) * nY;
                    if (vn >= 0.0f) continue;  // уже разлетаются
                    const float imp = -(1.0f + kCellBounce) * vn * 0.5f;
                    a.vx += nX * imp; a.vy += nY * imp;
                    b.vx -= nX * imp; b.vy -= nY * imp;
                    clamp_speed(a); clamp_speed(b);
                }
            }
        }
    }
}

static void integrate(IntroFx& s, float w, float h, float dt, bool homing) {
    const float k = kSpringK * (1.0f + 2.2f * s.stubborn);
    // Порог «снаряда» падает с упрямством: мешать можно долго, но не вечно.
    const float flyGate =
        kFlySpeed * (1.0f + s.stubborn * 1.5f) / (1.0f + s.stubborn * 4.0f);
    const float damp = std::pow(kFriction, dt * 60.0f);
    for (IntroFx::Cell& c : s.cells) {
        // Клетка НА ЛЕНТЕ физике не подчиняется: её положение диктует запись.
        // Без этого тяга домой в паузе REWIND_LEAD наполовину собирала поле,
        // а первый кадр отмотки скачком откатывал его (замер в рефе).
        if (homing && !c.freed) continue;
        if (homing) {
            const float dx = c.hx - c.x, dy = c.hy - c.y;
            if (c.word == 2) {
                // Дрейф фона: медленное кружение у своей точки, без фиксации.
                c.wob += dt * 0.7f;
                c.vx += (dx * 0.9f + std::cos(c.wob) * 6.0f) * dt;
                c.vy += (dy * 0.9f + std::sin(c.wob * 1.3f) * 6.0f) * dt;
            } else {
                const float dist = std::sqrt(dx * dx + dy * dy);
                const float sp = std::sqrt(c.vx * c.vx + c.vy * c.vy);
                // Сбитая клетка сначала снаряд: тяга домой включается лишь
                // когда трение съело импульс.
                const float pull = 1.0f - std::min(1.0f, sp / flyGate);
                if (pull > 0.0f) {
                    const float noise =
                        std::min(1.0f, dist / 220.0f) * 260.0f;
                    c.vx += ((dx * k - c.vx * kSpringDamp) +
                             srand2(s.seed) * noise) * pull * dt;
                    c.vy += ((dy * k - c.vy * kSpringDamp) +
                             srand2(s.seed) * noise) * pull * dt;
                }
                if (dist < 1.2f && sp < 40.0f) {
                    c.x = c.hx; c.y = c.hy;
                    c.vx *= 0.25f; c.vy *= 0.25f;
                }
            }
        }
        c.vx *= damp;
        c.vy *= damp;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const float m = 4.0f;
        if (c.x < -m) { c.x = -m; c.vx = -c.vx * kEdgeBounce; }
        if (c.y < -m) { c.y = -m; c.vy = -c.vy * kEdgeBounce; }
        if (c.x > w + m) { c.x = w + m; c.vx = -c.vx * kEdgeBounce; }
        if (c.y > h + m) { c.y = h + m; c.vy = -c.vy * kEdgeBounce; }
    }
    collide(s, w, h);
}

// Разбегание: случайное блуждание + слабый исход из центра. Каждый шаг пишется
// в ленту — потом она отматывается. По вертикали трясём сильнее: надпись шире,
// чем выше, иначе два слова так и лежат двумя цветными полосами.
static void step_scatter(IntroFx& s, float w, float h) {
    const float cx = w * 0.5f, cy = h * 0.5f;
    for (IntroFx::Cell& c : s.cells) {
        const float dx = c.x - cx, dy = c.y - cy;
        const float d = std::sqrt(dx * dx + dy * dy) + 1.0f;
        c.vx += (srand2(s.seed) * 900.0f + dx / d * 150.0f) * kStep;
        c.vy += (srand2(s.seed) * 1500.0f + dy / d * 150.0f) * kStep;
    }
    integrate(s, w, h, kStep, false);

    s.tape.resize(static_cast<std::size_t>(s.tapeSteps + 1) *
                  s.cells.size() * 2);
    short* row = &s.tape[static_cast<std::size_t>(s.tapeSteps) *
                         s.cells.size() * 2];
    for (std::size_t i = 0; i < s.cells.size(); ++i) {
        row[i * 2 + 0] = static_cast<short>(
            std::clamp(s.cells[i].x, -3000.0f, 3000.0f));
        row[i * 2 + 1] = static_cast<short>(
            std::clamp(s.cells[i].y, -3000.0f, 3000.0f));
    }
    ++s.tapeSteps;
}

// Строит слово, МГНОВЕННО прокручивает разбегание в ленту (165 шагов, доли
// миллисекунды, ни одного кадра на экране) и ставит поле в последний кадр.
// Игрок с первого мгновения видит хаос и может мешать сборке — сам разбег
// ему смотреть незачем (урок рефа №2).
void IntroFx::build_logo(float w, float h) {
    cells.clear();
    tape.clear();
    tapeSteps = 0;

    const int topCells = word_cell_width(7);   // TENEVIK
    const int botCells = word_cell_width(5);   // GAMES
    float cellPx = w * 0.62f / static_cast<float>(topCells);
    cellPx = std::clamp(cellPx, 3.0f, 16.0f);
    drawPx = targetPx = cellPx;

    const float rowH = 7.0f * kSuper * cellPx;
    const float topY = h * 0.5f - rowH - cellPx * 2.0f;
    const float botY = topY + rowH + cellPx * 3.0f;

    std::vector<ImVec2> slots;
    layout_word(kTenevik, 7, cellPx, w * 0.5f - topCells * cellPx * 0.5f,
                topY, slots);
    const std::size_t topCount = slots.size();
    layout_word(kGames, 5, cellPx, w * 0.5f - botCells * cellPx * 0.5f,
                botY, slots);

    cells.reserve(slots.size());
    for (std::size_t i = 0; i < slots.size(); ++i) {
        Cell c;
        c.x = c.hx = slots[i].x;
        c.y = c.hy = slots[i].y;
        c.vx = c.vy = 0.0f;
        c.wob = frand(seed) * 6.28f;
        // Свой темп отмотки у каждой клетки: иначе слово защёлкивается одним
        // механическим кадром, а не собирается.
        c.rate = 0.65f + frand(seed) * 0.70f;
        c.cur = 0.0f;
        c.word = static_cast<std::uint8_t>(i < topCount ? 0 : 1);
        c.freed = 0;
        cells.push_back(c);
    }

    for (int i = 0; i < kScatterSteps; ++i) step_scatter(*this, w, h);
    const short* row = &tape[static_cast<std::size_t>(tapeSteps - 1) *
                             cells.size() * 2];
    for (std::size_t i = 0; i < cells.size(); ++i) {
        cells[i].x = static_cast<float>(row[i * 2 + 0]);
        cells[i].y = static_cast<float>(row[i * 2 + 1]);
        cells[i].vx = cells[i].vy = 0.0f;
        cells[i].freed = 0;
        cells[i].cur = static_cast<float>(tapeSteps - 1);
    }
    stubborn = 0.0f;
    phaseTime = 0.0f;
    builtLogo = true;
    titleMode = false;
}

// Пересборка: те же клетки получают слоты титула, лишние — звёзды фона,
// недостающие досыпаются с краёв. Ни одна клетка не исчезает даром.
void IntroFx::retarget_title(float w, float h) {
    const int titleCells = word_cell_width(10);  // ГИГАХРУЩ 2
    float cellPx = w * 0.66f / static_cast<float>(titleCells);
    cellPx = std::clamp(cellPx, 2.0f, 12.0f);
    targetPx = cellPx;

    std::vector<ImVec2> slots;
    layout_word(kTitle, 10, cellPx, w * 0.5f - titleCells * cellPx * 0.5f,
                h * 0.13f, slots);

    const std::size_t n = slots.size();
    for (std::size_t i = 0; i < cells.size(); ++i) {
        Cell& c = cells[i];
        c.freed = 1;  // все — в физику: пересборка едет пружинами, не лентой
        if (i < n) {
            c.hx = slots[i].x; c.hy = slots[i].y;
            c.word = 0;
        } else {
            c.hx = frand(seed) * w; c.hy = frand(seed) * h;
            c.word = 2;
        }
    }
    for (std::size_t i = cells.size(); i < n; ++i) {
        Cell c;
        c.hx = slots[i].x; c.hy = slots[i].y;
        c.x = frand(seed) < 0.5f ? -20.0f : w + 20.0f;
        c.y = frand(seed) * h;
        c.vx = c.vy = 0.0f;
        c.wob = frand(seed) * 6.28f;
        c.rate = 1.0f;
        c.cur = 0.0f;
        c.word = 0;
        c.freed = 1;
        cells.push_back(c);
    }
    stubborn = 0.0f;
    titleMode = true;
}

bool IntroFx::step_draw(ImDrawList* dl, float w, float h, float dt) {
    if (!builtLogo) build_logo(w, h);
    // Ресайз окна (фуллскрин): слоты разложены под старый центр — без
    // пере-раскладки слово уезжает из центра (плейтест владельца). Титул
    // перетаргетируется на лету (retarget_title идемпотентен: те же клетки,
    // новые дома — красиво доезжают пружинами); сборка логотипа строится
    // заново — её лента записана в старых координатах.
    if (lastW > 0.0f && (std::abs(w - lastW) > 0.5f ||
                         std::abs(h - lastH) > 0.5f)) {
        if (titleMode) retarget_title(w, h);
        else build_logo(w, h);
    }
    lastW = w; lastH = h;
    if (dt > 0.05f) dt = 0.05f;
    phaseTime += dt;
    drawPx += (targetPx - drawPx) * std::min(1.0f, dt * 4.0f);

    // --- Курсор: ведение, толчок, щелчок-взрыв ------------------------------
    const ImGuiIO& io = ImGui::GetIO();
    const float mx = io.MousePos.x, my = io.MousePos.y;
    const bool mouseOn = mx > -500.0f && my > -500.0f;
    float mvx = 0.0f, mvy = 0.0f;
    if (mouseOn && pmx > -500.0f && dt > 1e-4f) {
        mvx = (mx - pmx) / dt;
        mvy = (my - pmy) / dt;
    }
    pmx = mx; pmy = my;
    if (mouseOn) {
        const float speed = std::sqrt(mvx * mvx + mvy * mvy);
        const float held =
            ImGui::IsMouseDown(ImGuiMouseButton_Left) ? kPushHeldGain : 1.0f;
        for (Cell& c : cells) {
            const float dx = c.x - mx, dy = c.y - my;
            const float d2 = dx * dx + dy * dy;
            if (d2 > kPushRadius * kPushRadius) continue;
            const float d = std::sqrt(d2) + 0.001f;
            const float kk = 1.0f - d / kPushRadius;
            c.vx += (dx / d * kPushRadial * kk + mvx * kPushDrag * kk) *
                    held * dt;
            c.vy += (dy / d * kPushRadial * kk + mvy * kPushDrag * kk) *
                    held * dt;
            clamp_speed(c);
            if (!c.freed && (speed > 40.0f || kk > 0.5f)) c.freed = 1;
        }
        // Щелчок — разовый взрыв: широкий радиус, мгновенный импульс, без dt.
        // Это другой жест: не «смести», а «разбить».
        if (ImGui::IsMouseClicked(ImGuiMouseButton_Left)) {
            for (Cell& c : cells) {
                const float dx = c.x - mx, dy = c.y - my;
                const float d2 = dx * dx + dy * dy;
                if (d2 > kPunchRadius * kPunchRadius || d2 < 1e-4f) continue;
                const float d = std::sqrt(d2);
                const float kk = 1.0f - d / kPunchRadius;
                c.vx += dx / d * kPunchImpulse * kk;
                c.vy += dy / d * kPunchImpulse * kk;
                clamp_speed(c);
                if (!c.freed) c.freed = 1;
            }
        }
    }

    // --- Отмотка ленты (только фаза логотипа) -------------------------------
    bool onTape = false;
    if (!titleMode) {
        if (phaseTime <= kRewindLead) {
            onTape = true;  // пауза: глаз должен прочитать хаос как хаос
        } else {
            const std::size_t n = cells.size();
            for (std::size_t i = 0; i < n; ++i) {
                Cell& c = cells[i];
                if (c.freed) continue;
                c.cur -= kRewindRate * c.rate;
                if (c.cur <= 0.0f) {
                    c.cur = 0.0f;
                    c.x = c.hx; c.y = c.hy;
                    c.vx = c.vy = 0.0f;
                    c.freed = 1;  // доехала: дальше физика, её можно сбить
                    continue;
                }
                onTape = true;
                // Позиция ИНТЕРПОЛИРУЕТСЯ между кадрами ленты: целочисленный
                // индекс при дробной скорости отмотки давал рывки.
                const int f0 = static_cast<int>(c.cur);
                const int f1 = std::min(tapeSteps - 1, f0 + 1);
                const float t = c.cur - static_cast<float>(f0);
                const short* a = &tape[static_cast<std::size_t>(f0) * n * 2];
                const short* b = &tape[static_cast<std::size_t>(f1) * n * 2];
                c.x = a[i * 2 + 0] * (1.0f - t) + b[i * 2 + 0] * t;
                c.y = a[i * 2 + 1] * (1.0f - t) + b[i * 2 + 1] * t;
                c.vx = c.vy = 0.0f;
            }
        }
        if (!onTape) stubborn += dt * 0.55f;  // мешать можно, победить — нет
    }

    integrate(*this, w, h, dt, true);

    // --- Отрисовка ----------------------------------------------------------
    const float size =
        std::max(2.0f, drawPx - (drawPx > 5.0f ? 1.0f : 0.0f));
    int settled = 0;
    for (const Cell& c : cells) {
        const float dx = c.hx - c.x, dy = c.hy - c.y;
        const float dist2 = dx * dx + dy * dy;
        // Яркость — функция расстояния до слота: поле само «конденсируется».
        float lit = 1.0f - std::min(1.0f, std::sqrt(dist2) / 190.0f);
        ImU32 base = c.word == 1 ? kColBottom : kColTop;
        if (c.word == 2) { base = kColDrift; lit = 0.22f; }
        const int br = (base >> IM_COL32_R_SHIFT) & 0xFF;
        const int bg = (base >> IM_COL32_G_SHIFT) & 0xFF;
        const int bb = (base >> IM_COL32_B_SHIFT) & 0xFF;
        const int rr = 52 + static_cast<int>((br - 52) * lit);
        const int gg = 40 + static_cast<int>((bg - 40) * lit);
        const int bl = 36 + static_cast<int>((bb - 36) * lit);
        const int aa = 46 + static_cast<int>(209 * lit);
        const float sz = c.word == 2 ? std::max(2.0f, size * 0.5f) : size;
        dl->AddRectFilled(ImVec2(c.x, c.y), ImVec2(c.x + sz, c.y + sz),
                          IM_COL32(rr, gg, bl, aa));
        if (dist2 < drawPx * drawPx) ++settled;
    }
    return !onTape &&
           settled >= static_cast<int>(cells.size() * 9 / 10);
}

} // namespace giga
