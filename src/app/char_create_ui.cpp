// Character creation and Settings screen UI implementation for GigaHrush 2.
#include "app/char_create_ui.h"

#include <cstdio>
#include <algorithm>
#include "imgui.h"
#include "game/combat.h"
#include "game/embody.h"
#include "game/equip.h"
#include "game/item_table.h"

namespace giga {

void populate_archetype_inventory(game::Inventory& inv, game::RoleId role) {
    inv.clear();
    switch (role) {
        case game::RoleId::Resident:
            // Wrench (433), Yeast Bread (434) x2, Water (423) x2, Bandage (40) x2
            game::inventory_give(inv, 433, 1);
            game::inventory_give(inv, 434, 2);
            game::inventory_give(inv, 423, 2);
            game::inventory_give(inv, 40, 2);
            break;

        case game::RoleId::Duty:
            // TT Pistol (411), 7.62x25 Ammo (11) x30, Liquidator Axe (215), Bandage (40) x2, Liquidator Ration (220) x1
            game::inventory_give(inv, 411, 1);
            game::inventory_give(inv, 11, 30);
            game::inventory_give(inv, 215, 1);
            game::inventory_give(inv, 40, 2);
            game::inventory_give(inv, 220, 1);
            break;

        case game::RoleId::Medic:
            // Bandage (40) x5, Antibiotic (25) x2, Morphine Ampoule (239) x1, Alcohol (5) x2, Iodine (195) x2
            game::inventory_give(inv, 40, 5);
            game::inventory_give(inv, 25, 2);
            game::inventory_give(inv, 239, 1);
            game::inventory_give(inv, 5, 2);
            game::inventory_give(inv, 195, 2);
            break;

        case game::RoleId::Looter:
            // Knife (205), Wrench (433), Lighter (213), Kasha (201) x2, Water (423) x2
            game::inventory_give(inv, 205, 1);
            game::inventory_give(inv, 433, 1);
            game::inventory_give(inv, 213, 1);
            game::inventory_give(inv, 201, 2);
            game::inventory_give(inv, 423, 2);
            break;

        case game::RoleId::Cultist:
            // Knife (205), Meat Rune (230), Istotit Candle (197) x3, Water (423) x2, Antidepressant (26) x1
            game::inventory_give(inv, 205, 1);
            game::inventory_give(inv, 230, 1);
            game::inventory_give(inv, 197, 3);
            game::inventory_give(inv, 423, 2);
            game::inventory_give(inv, 26, 1);
            break;

        default:
            game::inventory_give(inv, 433, 1);
            game::inventory_give(inv, 40, 2);
            break;
    }
}

void draw_character_creation_ui(CharCreationState& state, bool& outBeginGame, bool& outBack) {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                           ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(760.0f, 620.0f), ImGuiCond_Appearing);

    ImGui::Begin("СОЗДАНИЕ ПЕРСОНАЖА / CHARACTER CREATION##cc_window", nullptr,
                 ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                 ImGuiWindowFlags_NoSavedSettings);

    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f),
                       "=== НАСТРОЙКА ЛИЧНОГО ДЕЛА ЭКСПЕДИЦИИ ===");
    ImGui::Separator();
    ImGui::Spacing();

    // 1. Role Archetype Selection
    ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "АРХЕТИП И СПЕЦИАЛИЗАЦИЯ (ROLE ARCHETYPE):");

    struct RoleInfo {
        game::RoleId id;
        const char* title;
        const char* factionTag;
        const char* desc;
    };

    static const RoleInfo kRoles[] = {
        { game::RoleId::Resident, "Житель (Resident)", "[ЖИЛЬЦЫ]",
          "Сбалансированный обитатель жилых блоков. Стандартные потребности, доступ к жилым зонам и общим кухням." },
        { game::RoleId::Duty, "Ликвидатор (Duty)", "[ЛИКВИДАТОРЫ]",
          "Боец службы подавления угроз. Патрульный режим, повышенный урон, военное снаряжение и связь со штабом." },
        { game::RoleId::Medic, "Медик (Medic)", "[УЧЁНЫЕ / МЕДСЛУЖБА]",
          "Полевой санитар. Увеличенный запас медикаментов, способность перевязывать раненых и восстанавливать здоровье." },
        { game::RoleId::Looter, "Мародёр (Looter)", "[ДИКИЕ]",
          "Опытный сталкер глубин. Максимальное чутье на ценности, скрытность, возможность отдыхать в любых отсеках." },
        { game::RoleId::Cultist, "Культист (Cultist)", "[КУЛЬТИСТЫ]",
          "Адепт бетона и таинств Мегаблока. Повышенная ПСИ-чувствительность, защита от аномалий и ритуальные предметы." }
    };

    if (ImGui::BeginTabBar("##role_tabs", ImGuiTabBarFlags_None)) {
        for (const auto& r : kRoles) {
            bool isSelected = (state.role == r.id);
            ImGuiTabItemFlags flags = isSelected ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
            if (ImGui::BeginTabItem(r.title, nullptr, flags)) {
                state.role = r.id;
                ImGui::EndTabItem();
            }
        }
        ImGui::EndTabBar();
    }

    const RoleInfo* curRole = &kRoles[0];
    for (const auto& r : kRoles) {
        if (r.id == state.role) { curRole = &r; break; }
    }

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.04f, 0.08f, 0.04f, 0.85f));
    ImGui::BeginChild("##role_desc_box", ImVec2(0.0f, 68.0f), true);
    ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "Фракционная принадлежность: %s", curRole->factionTag);
    ImGui::TextWrapped("%s", curRole->desc);
    ImGui::EndChild();
    ImGui::PopStyleColor();

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 2. Base Attributes Allocation & Live Derived Stats
    ImGui::Columns(2, "##cc_columns", false);
    ImGui::SetColumnWidth(0, 360.0f);

    ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ХАРАКТЕРИСТИКИ (ATTRIBUTES):");
    ImGui::Text("Свободных очков (Points pool): ");
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f), "[ %d ]", state.unallocated);

    auto draw_attr_row = [&](const char* name, int& val) {
        ImGui::Text("%-16s", name);
        ImGui::SameLine();
        char btnMinus[32], btnPlus[32];
        std::snprintf(btnMinus, sizeof(btnMinus), "-##%s", name);
        std::snprintf(btnPlus, sizeof(btnPlus), "+##%s", name);

        if (ImGui::Button(btnMinus, ImVec2(28.0f, 24.0f))) {
            if (val > 1) {
                --val;
                ++state.unallocated;
            }
        }
        ImGui::SameLine();
        ImGui::TextColored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "  %2d  ", val);
        ImGui::SameLine();
        if (ImGui::Button(btnPlus, ImVec2(28.0f, 24.0f))) {
            if (state.unallocated > 0 && val < 255) {
                ++val;
                --state.unallocated;
            }
        }
    };

    draw_attr_row("СИЛА (STR)", state.str);
    draw_attr_row("ЛОВКОСТЬ (AGI)", state.agi);
    draw_attr_row("ИНТЕЛЛЕКТ (INT)", state.intell);

    ImGui::NextColumn();

    // Derived Stats Preview
    game::RpgStats previewRpg = game::fresh_rpg(1);
    previewRpg.attr[static_cast<std::size_t>(game::Attr::Str)] = static_cast<std::uint8_t>(state.str);
    previewRpg.attr[static_cast<std::size_t>(game::Attr::Agi)] = static_cast<std::uint8_t>(state.agi);
    previewRpg.attr[static_cast<std::size_t>(game::Attr::Int)] = static_cast<std::uint8_t>(state.intell);

    const int previewHp = game::max_hp(previewRpg);
    const float previewCarryKg = static_cast<float>(game::carry_capacity_g(previewRpg)) / 1000.0f;
    const int previewPsi = game::max_psi(previewRpg);
    const float speedMult = static_cast<float>(game::agi_move_speed_mult_e3(previewRpg)) / 1000.0f;
    const float meleeMult = static_cast<float>(game::str_melee_dmg_mult_e3(previewRpg)) / 1000.0f;

    ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "РАСЧЁТНЫЕ ПАРАМЕТРЫ (DERIVED STATS):");
    ImGui::BulletText("Здоровье (Max HP): %d HP (+%d%%)", previewHp, state.str);
    ImGui::BulletText("Грузоподъёмность: %.1f кг (+%.1f кг)", previewCarryKg, static_cast<float>(state.str * 4));
    ImGui::BulletText("ПСИ-энергия (Max PSI): %d PSI (+%d%%)", previewPsi, state.intell);
    ImGui::BulletText("Скорость бега: x%.2f (+%.1f%%)", speedMult, static_cast<float>(state.agi));
    ImGui::BulletText("Множитель урона: x%.2f (+%.1f%%)", meleeMult, static_cast<float>(state.str));

    ImGui::Columns(1);
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 3. Starting Equipment Preview
    ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "СТАРТОВОЕ СНАРЯЖЕНИЕ (STARTING EQUIPMENT):");
    ImGui::BeginChild("##equip_preview", ImVec2(0.0f, 90.0f), true);

    game::Inventory tmpInv{};
    populate_archetype_inventory(tmpInv, state.role);
    int itemCount = 0;
    for (int i = 0; i < game::kInvSlots; ++i) {
        if (tmpInv.slots[i].count > 0 && game::item_valid(tmpInv.slots[i].item)) {
            const char* itemName = game::item_name(tmpInv.slots[i].item);
            const auto& def = game::item_def(tmpInv.slots[i].item);
            ImGui::BulletText("%s (x%d) — %.1f кг", itemName, tmpInv.slots[i].count,
                              static_cast<float>(def.massG * tmpInv.slots[i].count) / 1000.0f);
            ++itemCount;
        }
    }
    if (itemCount == 0) {
        ImGui::TextUnformatted("(снаряжение отсутствует)");
    }
    ImGui::EndChild();

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 4. Action Buttons
    const ImVec2 actionBtn(260.0f, 36.0f);
    if (ImGui::Button("НАЗАД / BACK", ImVec2(160.0f, 36.0f))) {
        outBack = true;
    }
    ImGui::SameLine(ImGui::GetWindowWidth() - actionBtn.x - 20.0f);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.12f, 0.38f, 0.16f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.20f, 0.55f, 0.25f, 1.0f));
    if (ImGui::Button("НАЧАТЬ ЭКСПЕДИЦИЮ / BEGIN", actionBtn)) {
        outBeginGame = true;
    }
    ImGui::PopStyleColor(2);

    ImGui::End();
}

void draw_settings_menu_ui(bool& outBack) {
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                           ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(680.0f, 540.0f), ImGuiCond_Appearing);

    ImGui::Begin("НАСТРОЙКИ СИСТЕМЫ / SETTINGS##settings_window", nullptr,
                 ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                 ImGuiWindowFlags_NoSavedSettings);

    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f),
                       "=== КОНФИГУРАЦИЯ ТЕРМИНАЛА И ПЕРИФЕРИИ ===");
    ImGui::Separator();
    ImGui::Spacing();

    if (ImGui::BeginTabBar("##settings_tabs", ImGuiTabBarFlags_None)) {
        // Tab 1: Video & CRT Display
        if (ImGui::BeginTabItem("Видео / CRT")) {
            ImGui::Spacing();
            static bool crtShaderEnabled = true;
            static bool darkAdaptation = true;
            static float crtCurvature = 0.08f;
            static float scanlineStrength = 0.35f;
            static float vignetteStrength = 0.45f;

            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ЭЛТ-МОНИТОР / GPU POST-PROCESSING:");
            ImGui::Checkbox("Включить GPU CRT пост-процесс (Curvature/Phosphor)", &crtShaderEnabled);
            ImGui::Checkbox("Асимметричная темновая адаптация зрения", &darkAdaptation);
            ImGui::SliderFloat("Кривизна кинескопа (Curvature)", &crtCurvature, 0.0f, 0.25f, "%.2f");
            ImGui::SliderFloat("Интенсивность строк (Scanlines)", &scanlineStrength, 0.0f, 1.0f, "%.2f");
            ImGui::SliderFloat("Виньетирование (Vignette)", &vignetteStrength, 0.0f, 1.0f, "%.2f");
            ImGui::Spacing();
            ImGui::TextColored(ImVec4(0.60f, 0.85f, 0.60f, 1.0f), "Vulkan Post-Pass: 2-Pass HDR R16G16B16A16_SFLOAT active.");
            ImGui::EndTabItem();
        }

        // Tab 2: Audio
        if (ImGui::BeginTabItem("Аудио / Звук")) {
            ImGui::Spacing();
            static float masterVol = 80.0f;
            static float sfxVol = 90.0f;
            static float musicVol = 70.0f;
            static bool muteAll = false;

            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ГРОМКОСТЬ И АКУСТИКА:");
            ImGui::Checkbox("Отключить звук (Mute)", &muteAll);
            ImGui::SliderFloat("Общая громкость (Master Volume)", &masterVol, 0.0f, 100.0f, "%.0f %%");
            ImGui::SliderFloat("Эффекты и сирены (SFX / Siren)", &sfxVol, 0.0f, 100.0f, "%.0f %%");
            ImGui::SliderFloat("Фоновый гул (Atmosphere)", &musicVol, 0.0f, 100.0f, "%.0f %%");
            ImGui::EndTabItem();
        }

        // Tab 3: Controls & Keybinds Overview
        if (ImGui::BeginTabItem("Управление / Клавиши")) {
            ImGui::Spacing();
            static float mouseSens = 1.0f;
            static bool invertY = false;

            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "МЫШЬ И КАМЕРА:");
            ImGui::SliderFloat("Чувствительность обзора", &mouseSens, 0.1f, 3.0f, "%.2f");
            ImGui::Checkbox("Инвертировать вертикальную ось (Invert Y)", &invertY);

            ImGui::Spacing();
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ОСНОВНЫЕ КЛАВИШИ (DEFAULT BINDS):");
            ImGui::BulletText("WASD — Перемещение / Шаг");
            ImGui::BulletText("E — Взаимодействие / Диалог / Взять задание / Лут");
            ImGui::BulletText("J / Tab — Журнал заданий и контрактов (Quest Log)");
            ImGui::BulletText("P — Вселение в тело выжившего (Mind Projection)");
            ImGui::BulletText("Q — Открыть/закрыть гермодверь");
            ImGui::BulletText("H / G / T — Использовать медицину / еду / воду");
            ImGui::BulletText("C / V / B — Верстак / Торговля / Сдать хабар");
            ImGui::BulletText("Esc — Меню паузы и тонкая перепривязка клавиш");
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    if (ImGui::Button("НАЗАД В МЕНЮ / BACK", ImVec2(220.0f, 32.0f))) {
        outBack = true;
    }

    ImGui::End();
}

void apply_character_creation(Registry& reg, Entity player, game::NpcPool& pool,
                              game::RpgStats& carriedRpg, const CharCreationState& cc) {
    // 1. Initialize RpgStats sheet with allocated attributes
    game::RpgStats customRpg = game::fresh_rpg(1);
    customRpg.attr[static_cast<std::size_t>(game::Attr::Str)] = static_cast<std::uint8_t>(std::clamp(cc.str, 1, 255));
    customRpg.attr[static_cast<std::size_t>(game::Attr::Agi)] = static_cast<std::uint8_t>(std::clamp(cc.agi, 1, 255));
    customRpg.attr[static_cast<std::size_t>(game::Attr::Int)] = static_cast<std::uint8_t>(std::clamp(cc.intell, 1, 255));
    customRpg.psi = game::max_psi(customRpg);
    customRpg.attrPoints = static_cast<std::uint8_t>(std::max(0, cc.unallocated));
    carriedRpg = customRpg;

    // 2. Wire into player entity and NpcPool
    if (reg.valid(player)) {
        reg.emplace_or_replace<game::RpgStats>(player, customRpg);

        if (const auto* ref = reg.try_get<game::NpcRef>(player)) {
            const game::NpcId pid = ref->id;
            if (pool.valid(pid)) {
                pool.role(pid) = static_cast<std::uint8_t>(cc.role);
                pool.attrs(pid)[0] = customRpg.attr[0];
                pool.attrs(pid)[1] = customRpg.attr[1];
                pool.attrs(pid)[2] = customRpg.attr[2];

                const std::int16_t mhp = static_cast<std::int16_t>(game::max_hp(customRpg));
                pool.max_hp(pid) = mhp;
                pool.hp(pid) = mhp;

                // Faction affinity based on archetype
                switch (cc.role) {
                    case game::RoleId::Resident:
                        pool.faction(pid) = static_cast<std::uint8_t>(game::Faction::Citizens);
                        break;
                    case game::RoleId::Duty:
                        pool.faction(pid) = static_cast<std::uint8_t>(game::Faction::Liquidators);
                        break;
                    case game::RoleId::Medic:
                        pool.faction(pid) = static_cast<std::uint8_t>(game::Faction::Scientists);
                        break;
                    case game::RoleId::Looter:
                        pool.faction(pid) = static_cast<std::uint8_t>(game::Faction::Wild);
                        break;
                    case game::RoleId::Cultist:
                        pool.faction(pid) = static_cast<std::uint8_t>(game::Faction::Cultists);
                        break;
                    default:
                        break;
                }

                // Populate and auto-equip starting inventory
                game::Inventory& inv = pool.inventory(pid);
                populate_archetype_inventory(inv, cc.role);

                game::Equipped eq{};
                game::auto_equip_best(inv, eq);
                reg.emplace_or_replace<game::Equipped>(player, eq);
                game::sync_armour(reg, pool, player);
            }
        }
    }
}

} // namespace giga
