#include "app/settings_ui.h"

#include <cstdio>

#include <SDL3/SDL_keyboard.h>
#include <imgui.h>

#include "app/hud_ui.h"          // hud_elements — тумблеры из той же таблицы
#include "audio/audio_types.h"   // AudioConfig — живые ручки микшера

namespace giga {

namespace {

constexpr ImVec4 kAmber{0.949f, 0.780f, 0.251f, 1.0f};
constexpr ImVec4 kDanger{0.902f, 0.310f, 0.361f, 1.0f};

// --- Управление -------------------------------------------------------------
// Бинд-эдитор, переехавший из страницы паузы один-в-один: таблица строк,
// Rebind ставит захват (клавишу ловит event-loop app'а), конфликт — красная
// пометка, не тихая перезапись ([menu.md] Settings → Controls).
void tab_controls(SettingsCtx& c, SettingsRequest& req) {
    if (!c.binds || !c.rebindCapture) {
        ImGui::TextUnformatted("(бинды не подключены)");
        return;
    }
    ImGui::BeginChild("##bind_rows", ImVec2(430.0f, 300.0f), true);
    if (ImGui::BeginTable("##binds", 3,
                          ImGuiTableFlags_RowBg |
                              ImGuiTableFlags_SizingStretchProp)) {
        ImGui::TableSetupColumn("Действие");
        ImGui::TableSetupColumn("Клавиша");
        ImGui::TableSetupColumn("##rebind", ImGuiTableColumnFlags_WidthFixed,
                                90.0f);
        for (std::size_t i = 0; i < c.binds->count(); ++i) {
            const game::KeyBind& b = c.binds->at(i);
            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::TextUnformatted(b.action);
            ImGui::TableSetColumnIndex(1);
            if (*c.rebindCapture == static_cast<int>(i)) {
                ImGui::TextColored(kAmber, "нажми клавишу...");
            } else {
                const char* keyName = SDL_GetScancodeName(
                    static_cast<SDL_Scancode>(b.scancode));
                ImGui::Text("%s", (keyName && *keyName) ? keyName : "—");
                if (c.binds->conflicts(b.action) > 0) {
                    ImGui::SameLine();
                    ImGui::TextColored(kDanger, "(конфликт)");
                }
            }
            ImGui::TableSetColumnIndex(2);
            char rebindId[48];
            std::snprintf(rebindId, sizeof rebindId, "Сменить##%zu", i);
            if (ImGui::Button(rebindId))
                *c.rebindCapture = static_cast<int>(i);
        }
        ImGui::EndTable();
    }
    ImGui::EndChild();
    if (ImGui::Button("Сбросить бинды", ImVec2(220.0f, 0.0f)))
        req.bindsReset = true;
}

// --- Интерфейс --------------------------------------------------------------
// По тумблеру НА СТРОКУ таблицы худа ([hud_ui.h] hud_elements) — вкладка не
// знает, какие элементы существуют, и не узнает: новый элемент худа приносит
// свой тумблер сюда сам.
void tab_interface(SettingsCtx&, SettingsRequest& req) {
    std::size_t n = 0;
    HudElement* els = hud_elements(n);
    ImGui::TextUnformatted("Элементы худа:");
    ImGui::Separator();
    for (std::size_t i = 0; i < n; ++i)
        if (ImGui::Checkbox(els[i].label, &els[i].on)) req.uiChanged = true;
}

// --- Графика ----------------------------------------------------------------
// Только то, что рендер честно умеет СЕГОДНЯ: трубка и фуллскрин. Vsync
// пришит к FIFO ([performance.md]) — фальшивой ручки не будет.
void tab_video(SettingsCtx& c, SettingsRequest& req) {
    if (c.crtEnabled &&
        ImGui::Checkbox("CRT-трубка (скан-линии, виньетка)", c.crtEnabled))
        req.uiChanged = true;
    if (c.fullscreen && ImGui::Checkbox("Во весь экран", c.fullscreen))
        req.uiChanged = true;
}

// --- Звук -------------------------------------------------------------------
// Живые ручки микшера ([audio_types.h] AudioConfig): слайдер пишет прямо в
// конфиг, микс слышит со следующего блока — двигаешь и слушаешь.
void tab_audio(SettingsCtx& c, SettingsRequest& req) {
    if (!c.audio) {
        ImGui::TextUnformatted("(звук не подключён)");
        return;
    }
    ImGui::PushItemWidth(260.0f);
    if (ImGui::SliderFloat("Общая", &c.audio->masterGain, 0.0f, 1.0f, "%.2f"))
        req.uiChanged = true;
    if (ImGui::SliderFloat("Эффекты", &c.audio->sfxGain, 0.0f, 1.0f, "%.2f"))
        req.uiChanged = true;
    if (ImGui::SliderFloat("Эмбиент", &c.audio->ambientGain, 0.0f, 1.0f,
                           "%.2f"))
        req.uiChanged = true;
    ImGui::PopItemWidth();
}

// --- таблица вкладок --------------------------------------------------------

struct SettingsTab {
    const char* id;
    const char* label;
    void (*draw)(SettingsCtx&, SettingsRequest&);
};

constexpr SettingsTab kTabs[] = {
    {"controls",  "Управление", tab_controls},
    {"interface", "Интерфейс",  tab_interface},
    {"video",     "Графика",    tab_video},
    {"audio",     "Звук",       tab_audio},
};

} // namespace

SettingsRequest settings_ui_draw(SettingsCtx& ctx) {
    SettingsRequest req;
    if (ImGui::BeginTabBar("##settings_tabs")) {
        for (const SettingsTab& t : kTabs) {
            if (!ImGui::BeginTabItem(t.label)) continue;
            ImGui::Spacing();
            t.draw(ctx, req);
            ImGui::Spacing();
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }
    return req;
}

} // namespace giga
