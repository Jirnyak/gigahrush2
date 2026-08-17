#include "app/hud_ui.h"

#include <imgui.h>

#include "game/combat.h"      // PlayerRanged — магазин/перезарядка
#include "game/embody.h"      // NpcRef — тело с флажком, не синглтон
#include "game/equip.h"       // equipped_melee/ranged — РЕШЕНИЯ, не скан
#include "game/inventory.h"
#include "game/item_table.h"  // item_name — русские имена из items.csv
#include "game/needs.h"       // NeedsTick — отчёт последнего шага нужд
#include "game/npc_pool.h"
#include "game/ranged_table.h"
#include "game/rpg.h"         // max_psi
#include "game/samosbor.h"
#include "game/status.h"

namespace giga {

namespace {

// Палитра CRT-мандата ([AGENTS.md] UI): фосфор, янтарь тревоги, красный
// опасности ([faction.h] — красный только там, где угроза).
constexpr ImVec4 kPhosphor{0.349f, 0.949f, 0.400f, 1.0f};
constexpr ImVec4 kAmber{0.949f, 0.780f, 0.251f, 1.0f};
constexpr ImVec4 kDanger{0.902f, 0.310f, 0.361f, 1.0f};
constexpr ImVec4 kDim{0.349f, 0.949f, 0.400f, 0.55f};

// Тело с флажком: NpcRef игрока, валидный в пуле, или nullptr — худ молчит.
// Каждый элемент зовёт это сам, потому что пересадка тела может случиться
// между кадрами, а таблица не имеет права закешировать чужой id.
const game::NpcRef* live_ref(const HudContext& c) {
    if (!c.reg || !c.pool || c.player == entt::null || !c.reg->valid(c.player))
        return nullptr;
    const auto* nr = c.reg->try_get<game::NpcRef>(c.player);
    return (nr && c.pool->valid(nr->id)) ? nr : nullptr;
}

// --- элементы ---------------------------------------------------------------

// Прицел: крест из четырёх штрихов с зазором, прямо в foreground-список —
// прицелу не нужно окно, он живёт на самом стекле.
void draw_crosshair(const HudContext&) {
    ImDrawList* dl = ImGui::GetForegroundDrawList();
    const ImVec2 c{ImGui::GetIO().DisplaySize.x * 0.5f,
                   ImGui::GetIO().DisplaySize.y * 0.5f};
    const ImU32 col = ImGui::GetColorU32(ImVec4(0.349f, 0.949f, 0.400f, 0.85f));
    constexpr float kGap = 3.0f, kLen = 7.0f;
    dl->AddLine({c.x - kGap - kLen, c.y}, {c.x - kGap, c.y}, col, 1.0f);
    dl->AddLine({c.x + kGap, c.y}, {c.x + kGap + kLen, c.y}, col, 1.0f);
    dl->AddLine({c.x, c.y - kGap - kLen}, {c.x, c.y - kGap}, col, 1.0f);
    dl->AddLine({c.x, c.y + kGap}, {c.x, c.y + kGap + kLen}, col, 1.0f);
}

void draw_health(const HudContext& c) {
    const game::NpcRef* nr = live_ref(c);
    if (!nr) return;
    const std::int16_t hp = c.pool->hp(nr->id);
    const std::int16_t mx = c.pool->max_hp(nr->id);
    const float frac = mx > 0 ? static_cast<float>(hp > 0 ? hp : 0) /
                                    static_cast<float>(mx)
                              : 0.0f;
    // Те же пороги, что у дебаг-панели: мёртвый тёмно-красный, четверть —
    // янтарь, иначе фосфор. Один язык тревоги на всё стекло.
    ImVec4 barCol = hp <= 0 ? ImVec4{0.30f, 0.05f, 0.05f, 1.0f}
                  : frac <= 0.25f ? kAmber
                                  : kPhosphor;
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, barCol);
    ImGui::ProgressBar(frac, ImVec2(160.0f, 12.0f), "");
    ImGui::PopStyleColor();
    ImGui::SameLine();
    if (hp <= 0)
        ImGui::TextColored(kDanger, "МЁРТВ");
    else
        ImGui::Text("HP %d/%d", hp, mx);
}

void draw_needs(const HudContext& c) {
    const game::NpcRef* nr = live_ref(c);
    if (!nr) return;
    const game::Needs& nd = c.pool->needs(nr->id);
    const bool failed = c.needsTick && c.needsTick->failed != 0;
    const bool warned = c.needsTick && c.needsTick->warned != 0;
    const ImVec4 col = failed ? kDanger : warned ? kAmber : kDim;
    ImGui::TextColored(col, "ЕДА %.0f  ВОДА %.0f  СОН %.0f",
                       static_cast<double>(nd.food),
                       static_cast<double>(nd.water),
                       static_cast<double>(nd.sleep));
}

void draw_psi(const HudContext& c) {
    if (!c.reg || c.player == entt::null || !c.reg->valid(c.player)) return;
    const auto* rs = c.reg->try_get<game::RpgStats>(c.player);
    if (!rs) return;
    ImGui::TextColored(kDim, "PSI %u/%u", rs->psi, game::max_psi(*rs));
}

// Рука: огнестрел с магазином, когда он ВЫБРАН решением экипировки; иначе
// милишка (кулаки — честное имя пустой руки). Показывается решение
// ([equip.h]), не содержимое сумки — худ отражает то, чем ударит ЛКМ.
void draw_hands(const HudContext& c) {
    const game::NpcRef* nr = live_ref(c);
    if (!nr) return;
    const game::Inventory& inv = c.pool->inventory(nr->id);
    const auto* eq = c.reg->try_get<game::Equipped>(c.player);
    const auto* pr = c.reg->try_get<game::PlayerRanged>(c.player);

    if (const game::ItemId gun = game::equipped_ranged(inv, eq)) {
        if (const game::RangedDef* rd = game::ranged_for_item(gun)) {
            if (pr && pr->reloadMs > 0)
                ImGui::TextColored(kAmber, "%s  ПЕРЕЗАРЯДКА %.1fс",
                                   game::item_name(gun),
                                   pr->reloadMs * 0.001);
            else
                ImGui::Text("%s  %u/%u", game::item_name(gun),
                            pr ? pr->magCount : 0, rd->magazine);
        }
    }
    const game::ItemId wpn = game::equipped_melee(inv, eq);
    ImGui::TextColored(kDim, "%s", wpn == game::kInvalidItem
                                       ? "кулаки"
                                       : game::item_name(wpn));
}

// Статусы + атмосфера клетки: всё, что прямо сейчас искажает тело или воздух.
// Тихий элемент: в норме не рисует НИ строки — пустой угол и есть «всё ок».
bool status_live(const HudContext& c) {
    if (c.status)
        for (std::size_t i = 0; i < game::kStatusCount; ++i)
            if (c.status->remainMs[i] > 0) return true;
    return c.gas.valid && (c.gas.tox > 0 || c.gas.smoke > 64 ||
                           c.gas.oxy < 192 || c.gas.heat > 0);
}

void draw_status(const HudContext& c) {
    if (c.status) {
        for (std::size_t i = 0; i < game::kStatusCount; ++i) {
            if (c.status->remainMs[i] == 0) continue;
            ImGui::TextColored(kAmber, "%s %us",
                               game::kStatusNames[i],
                               c.status->remainMs[i] / 1000u);
        }
    }
    if (c.gas.valid) {
        if (c.gas.tox > 0) ImGui::TextColored(kDanger, "ГАЗ %u", c.gas.tox);
        if (c.gas.smoke > 64) ImGui::TextColored(kAmber, "ДЫМ %u", c.gas.smoke);
        if (c.gas.oxy < 192) ImGui::TextColored(kAmber, "О2 %u", c.gas.oxy);
        if (c.gas.heat > 0) ImGui::TextColored(kDanger, "ЖАР %u", c.gas.heat);
    }
}

// Алерты: то, что требует реакции СЕЙЧАС. Пока два источника — самосбор
// (сирена этажа) и кровотечение нужд; лента одноразовых событий («поднял:
// бинт») придёт строкой сюда же, когда у неё будет шов-источник.
bool alerts_live(const HudContext& c) {
    if (c.samosbor) {
        const auto ph = static_cast<game::SamosborPhase>(c.samosbor->phase);
        if (ph == game::SamosborPhase::Warning ||
            ph == game::SamosborPhase::Active)
            return true;
    }
    return c.needsTick && c.needsTick->failed != 0;
}

void draw_alerts(const HudContext& c) {
    if (c.samosbor) {
        const auto ph = static_cast<game::SamosborPhase>(c.samosbor->phase);
        if (ph == game::SamosborPhase::Warning)
            ImGui::TextColored(kDanger, "САМОСБОР ЧЕРЕЗ %.0f с",
                               c.samosbor->phaseMs * 0.001);
        else if (ph == game::SamosborPhase::Active)
            ImGui::TextColored(kDanger, "САМОСБОР  %s  %.0f с",
                               game::samosbor_variant_name_ru(
                                   static_cast<game::SamosborVariant>(
                                       c.samosbor->variant)),
                               c.samosbor->phaseMs * 0.001);
    }
    if (c.needsTick && c.needsTick->failed != 0)
        ImGui::TextColored(kDanger, "ИСТОЩЕНИЕ: ТЕЛО ТЕРЯЕТ HP");
}

// --- таблица ----------------------------------------------------------------

HudElement g_elements[] = {
    {"crosshair", "Прицел",      HudSlot::Center,      true, draw_crosshair},
    {"health",    "Здоровье",    HudSlot::BottomLeft,  true, draw_health},
    {"needs",     "Потребности", HudSlot::BottomLeft,  true, draw_needs},
    {"psi",       "PSI",         HudSlot::BottomLeft,  true, draw_psi},
    {"hands",     "Рука",        HudSlot::BottomRight, true, draw_hands},
    {"status",    "Статусы",     HudSlot::TopLeft,     true, draw_status, status_live},
    {"alerts",    "Алерты",      HudSlot::Center,      true, draw_alerts, alerts_live},
};

// Одно угловое окно слота: прижато к своему углу, без ввода и декора, фон —
// едва заметная подложка (0.35), чтобы фосфор читался поверх яркого дерева,
// а мир просвечивал ([hud.md] Стиль).
void begin_slot_window(HudSlot slot) {
    const ImVec2 ds = ImGui::GetIO().DisplaySize;
    constexpr float kPad = 12.0f;
    ImVec2 pos, pivot;
    const char* id = "";
    switch (slot) {
    case HudSlot::TopLeft:
        pos = {kPad, kPad}; pivot = {0, 0}; id = "##hud_tl"; break;
    case HudSlot::BottomLeft:
        pos = {kPad, ds.y - kPad}; pivot = {0, 1}; id = "##hud_bl"; break;
    case HudSlot::BottomRight:
        pos = {ds.x - kPad, ds.y - kPad}; pivot = {1, 1}; id = "##hud_br"; break;
    case HudSlot::Center:
        // Ниже прицела, чтобы алерт не закрывал то, во что целишься.
        pos = {ds.x * 0.5f, ds.y * 0.5f + 48.0f}; pivot = {0.5f, 0}; id = "##hud_c";
        break;
    }
    ImGui::SetNextWindowPos(pos, ImGuiCond_Always, pivot);
    ImGui::SetNextWindowBgAlpha(0.35f);
    ImGui::Begin(id, nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs |
                     ImGuiWindowFlags_AlwaysAutoResize |
                     ImGuiWindowFlags_NoSavedSettings |
                     ImGuiWindowFlags_NoFocusOnAppearing |
                     ImGuiWindowFlags_NoNav);
}

} // namespace

HudElement* hud_elements(std::size_t& count) {
    count = sizeof(g_elements) / sizeof(g_elements[0]);
    return g_elements;
}

void hud_ui_draw(const HudContext& ctx) {
    // Прицел — вне окон вовсе (foreground-список), поэтому Center-окно
    // открывается только под алерты и будущую ленту.
    constexpr HudSlot kSlots[] = {HudSlot::TopLeft, HudSlot::BottomLeft,
                                  HudSlot::BottomRight, HudSlot::Center};
    for (HudSlot slot : kSlots) {
        bool opened = false;
        for (const HudElement& el : g_elements) {
            if (el.slot != slot || !el.on) continue;
            if (el.live && !el.live(ctx)) continue;
            if (el.draw == draw_crosshair) { el.draw(ctx); continue; }
            if (!opened) { begin_slot_window(slot); opened = true; }
            el.draw(ctx);
        }
        if (opened) ImGui::End();
    }
}

} // namespace giga
