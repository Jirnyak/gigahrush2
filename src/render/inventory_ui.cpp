#include "render/inventory_ui.h"

#include <cstdio>

#include "imgui.h"

#include "core/rng.h"           // hash_u32 — детерминированные акценты глифа
#include "game/item_table.h"    // item_def/name/desc — карточка и глиф
#include "game/ranged_table.h"  // ranged_for_item — строка урона в карточке
#include "game/weapon_table.h"  // melee_for_item — строка урона в карточке
#include "world/types.h"        // kCellSize — reach в метрах для карточки

namespace giga {

namespace {

using game::EquipSlot;
using game::ItemId;
using game::ItemSlot;
using game::kInvalidItem;
using game::kInvCols;
using game::kInvSlots;

// CRT-фосфор [imgui_layer.cpp:60] и его затемнения. Локальные копии констант,
// не общий хедер: стиль объявлен ОДИН раз в imgui_layer, а это его читатели.
constexpr ImU32 kPhosphor = IM_COL32(89, 242, 102, 255);
constexpr ImU32 kPhosphorDim = IM_COL32(60, 140, 66, 255);
constexpr ImU32 kCellBg = IM_COL32(8, 20, 10, 200);
constexpr ImU32 kCellEdge = IM_COL32(26, 72, 30, 255);
constexpr ImU32 kScanline = IM_COL32(0, 0, 0, 38);
constexpr ImU32 kRuinRed = IM_COL32(242, 110, 89, 255);

// --- Процедурный глиф предмета ----------------------------------------------
// Референс — item_sprites GigaHrush 1: иконка ВЫВОДИТСЯ из данных, не лежит в
// ассетах. Здесь тот же принцип на ImDrawList: силуэт по категории, два
// hash-акцента по id, и этого достаточно, чтобы 442 предмета различались
// глазом. Детерминировано: один id — один глиф навсегда.
void draw_item_glyph(ImDrawList* dl, ImVec2 a, ImVec2 b, ItemId id,
                     std::uint8_t category, ImU32 col) {
    const float w = b.x - a.x, h = b.y - a.y;
    auto px = [&](float fx, float fy) { return ImVec2(a.x + fx * w, a.y + fy * h); };
    const std::uint32_t hsh = hash_u32(static_cast<std::uint32_t>(id) * 2654435761u);
    const float t = 1.0f + w * 0.02f;  // толщина штриха растёт с клеткой

    switch (static_cast<game::ItemCategory>(category)) {
        case game::ItemCategory::Weapon:
            // Диагональ со «стволом» и гардой.
            dl->AddLine(px(0.2f, 0.8f), px(0.8f, 0.2f), col, t * 2.0f);
            dl->AddLine(px(0.35f, 0.5f), px(0.5f, 0.65f), col, t);
            break;
        case game::ItemCategory::Food:
            dl->AddCircle(px(0.5f, 0.5f), w * 0.24f, col, 8, t);
            dl->AddLine(px(0.5f, 0.26f), px(0.62f, 0.14f), col, t);
            break;
        case game::ItemCategory::Drink:
            dl->AddRect(px(0.38f, 0.3f), px(0.62f, 0.85f), col, 0.0f, 0, t);
            dl->AddRect(px(0.44f, 0.15f), px(0.56f, 0.3f), col, 0.0f, 0, t);
            break;
        case game::ItemCategory::Medicine:
            dl->AddLine(px(0.5f, 0.25f), px(0.5f, 0.75f), col, t * 2.0f);
            dl->AddLine(px(0.25f, 0.5f), px(0.75f, 0.5f), col, t * 2.0f);
            break;
        case game::ItemCategory::Ammo:
            for (int i = 0; i < 3; ++i)
                dl->AddRectFilled(px(0.3f + 0.15f * i, 0.35f),
                                  px(0.38f + 0.15f * i, 0.75f), col);
            break;
        case game::ItemCategory::Tool:
            dl->AddLine(px(0.3f, 0.7f), px(0.7f, 0.3f), col, t * 2.0f);
            dl->AddCircle(px(0.72f, 0.28f), w * 0.12f, col, 6, t);
            break;
        case game::ItemCategory::Key:
            dl->AddCircle(px(0.38f, 0.38f), w * 0.13f, col, 8, t);
            dl->AddLine(px(0.47f, 0.47f), px(0.72f, 0.72f), col, t);
            dl->AddLine(px(0.64f, 0.64f), px(0.72f, 0.56f), col, t);
            break;
        case game::ItemCategory::Note:
            dl->AddRect(px(0.3f, 0.2f), px(0.7f, 0.8f), col, 0.0f, 0, t);
            for (int i = 0; i < 3; ++i)
                dl->AddLine(px(0.36f, 0.35f + 0.14f * i),
                            px(0.64f, 0.35f + 0.14f * i), col, t * 0.7f);
            break;
        default: {  // Misc — коробка с hash-акцентом, чтобы хлам различался
            dl->AddRect(px(0.28f, 0.32f), px(0.72f, 0.76f), col, 0.0f, 0, t);
            const float ax = 0.34f + 0.06f * static_cast<float>(hsh % 5u);
            dl->AddLine(px(ax, 0.32f), px(ax, 0.76f), col, t * 0.7f);
            break;
        }
    }
    // Два детерминированных акцента — «серийные риски» на корпусе.
    const float m1 = 0.2f + 0.6f * static_cast<float>((hsh >> 8) & 0xFF) / 255.0f;
    dl->AddLine(px(m1, 0.88f), px(m1 + 0.08f, 0.88f), col, t * 0.7f);
}

// Строка «что это бьёт/держит» карточки — из таблиц, ничего в UI не хранится.
void card_combat_line(ItemId id, char* out, std::size_t cap) {
    if (const game::MeleeDef* m = game::melee_for_item(id)) {
        // reachMm — cells x 1000 ([weapon_table.h]), а клетка 2 м ([voxels.md]).
        std::snprintf(out, cap, "урон %u | замах %u мс | достаёт %.1f м",
                      m->dmg, m->cooldownMs,
                      static_cast<double>(m->reachMm) / 1000.0 *
                          static_cast<double>(kCellSize));
        return;
    }
    if (const game::RangedDef* r = game::ranged_for_item(id)) {
        std::snprintf(out, cap, "урон %u x%u | темп %u мс | магазин %u",
                      r->dmg, r->pellets, r->cooldownMs, r->magazine);
        return;
    }
    const game::ItemDef& d = game::item_def(id);
    int rsum = 0;
    for (std::size_t c = 0; c < game::kItemResistChannels; ++c)
        rsum += d.resist[c];
    if (rsum > 0) {
        std::snprintf(out, cap, "резисты %d/%d/%d/%d/%d", d.resist[0],
                      d.resist[1], d.resist[2], d.resist[3], d.resist[4]);
        return;
    }
    out[0] = 0;
}

} // namespace

InvUiRequest inventory_ui_draw(InvUiState& st, const InvUiPolicy& policy,
                               const game::Inventory& inv,
                               const game::Equipped* eq,
                               std::uint32_t carriedG) {
    InvUiRequest req;
    if (!st.open) return req;

    // Курсор — крестовиной, по торусу клеток НЕ заворачиваем: край сетки это
    // край, у 8x8 нет топологии мира.
    if (ImGui::IsKeyPressed(ImGuiKey_LeftArrow) && st.sel % kInvCols > 0) --st.sel;
    if (ImGui::IsKeyPressed(ImGuiKey_RightArrow) && st.sel % kInvCols < kInvCols - 1) ++st.sel;
    if (ImGui::IsKeyPressed(ImGuiKey_UpArrow) && st.sel >= kInvCols) st.sel -= kInvCols;
    if (ImGui::IsKeyPressed(ImGuiKey_DownArrow) && st.sel < kInvSlots - kInvCols) st.sel += kInvCols;

    const ImGuiViewport* vp = ImGui::GetMainViewport();
    const float cell = 44.0f;
    const float gridW = cell * kInvCols;
    const float cardW = 340.0f;
    const float pad = 14.0f;
    const float winW = gridW + cardW + pad * 3;
    const float winH = cell * kInvCols / 1.0f + 96.0f;
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + (vp->WorkSize.x - winW) * 0.5f,
                                   vp->WorkPos.y + (vp->WorkSize.y - winH) * 0.5f),
                            ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(winW, winH), ImGuiCond_Always);
    ImGui::Begin(policy.title, nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoTitleBar);

    ImGui::Text("%s", policy.title);
    ImGui::SameLine(winW - 180.0f);
    ImGui::TextDisabled("%.1f кг | I/Esc закрыть",
                        static_cast<double>(carriedG) / 1000.0);
    ImGui::Separator();

    // --- Сетка 8x8: клетка k — слот k, зеркало POD без пере-сортировки -------
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImVec2 g0 = ImGui::GetCursorScreenPos();
    for (int i = 0; i < kInvSlots; ++i) {
        const int col = i % kInvCols, row = i / kInvCols;
        const ImVec2 a(g0.x + col * cell, g0.y + row * cell);
        const ImVec2 b(a.x + cell - 3.0f, a.y + cell - 3.0f);
        const ItemSlot& s = inv.slots[i];
        const bool filled =
            s.item != kInvalidItem && s.count > 0 && game::item_valid(s.item);
        const bool selected = (i == st.sel);

        dl->AddRectFilled(a, b, kCellBg);
        // VHS-сканлайны клетки, как в референсе.
        for (float y = a.y + 3.0f; y < b.y; y += 4.0f)
            dl->AddRectFilled(ImVec2(a.x, y), ImVec2(b.x, y + 1.0f), kScanline);
        dl->AddRect(a, b, selected ? kPhosphor : kCellEdge, 0.0f, 0,
                    selected ? 2.0f : 1.0f);

        // Мышь: клик выбирает. Клетка — и кнопка, и пиксели; InvisibleButton
        // держит id-скоуп ImGui честным.
        ImGui::SetCursorScreenPos(a);
        char bid[16];
        std::snprintf(bid, sizeof bid, "##cell%d", i);
        if (ImGui::InvisibleButton(bid, ImVec2(cell - 3.0f, cell - 3.0f)))
            st.sel = i;

        if (!filled) continue;
        const game::ItemDef& d = game::item_def(s.item);
        draw_item_glyph(dl, ImVec2(a.x + 4, a.y + 4), ImVec2(b.x - 4, b.y - 8),
                        s.item, d.category, selected ? kPhosphor : kPhosphorDim);
        if (s.count > 1) {
            char cnt[8];
            std::snprintf(cnt, sizeof cnt, "x%u", s.count);
            dl->AddText(ImVec2(b.x - 22.0f, b.y - 14.0f), kPhosphor, cnt);
        }
        // Полоска износа — только когда предмету есть что терять: у вечных
        // строк (durability 0) её нет вовсе, минт не рисуем тоже — полоска
        // это ТРЕВОГА, а не украшение.
        if (game::item_durability(s.item) > 0 && s.condition < 255) {
            const float fx = static_cast<float>(s.condition) / 255.0f;
            const ImU32 wc = s.condition < 64 ? kRuinRed : kPhosphorDim;
            dl->AddRectFilled(ImVec2(a.x + 2, b.y - 4.0f),
                              ImVec2(a.x + 2 + (cell - 8.0f) * fx, b.y - 2.0f), wc);
        }
        // Метка РЕШЕНИЯ ([equip.h]): скобки-уголки на экипированной клетке.
        const bool decided =
            eq && (eq->weapon == i || eq->armor == i || eq->tool == i);
        if (decided) {
            dl->AddLine(ImVec2(a.x + 1, a.y + 7), ImVec2(a.x + 1, a.y + 1), kPhosphor, 2.0f);
            dl->AddLine(ImVec2(a.x + 1, a.y + 1), ImVec2(a.x + 7, a.y + 1), kPhosphor, 2.0f);
            dl->AddLine(ImVec2(b.x - 7, b.y - 1), ImVec2(b.x - 1, b.y - 1), kPhosphor, 2.0f);
            dl->AddLine(ImVec2(b.x - 1, b.y - 1), ImVec2(b.x - 1, b.y - 7), kPhosphor, 2.0f);
        }
    }
    // --- Карточка выбранного: всё из таблиц, UI ничего не хранит -------------
    // Прижата к ВЕРХУ, рядом с сеткой — курсор ImGui после сетки стоит внизу,
    // и без явной постановки карточка липла к полу окна.
    ImGui::SetCursorScreenPos(ImVec2(g0.x + gridW + pad, g0.y));
    ImGui::BeginGroup();
    const ItemSlot& sel = inv.slots[st.sel];
    if (sel.item != kInvalidItem && sel.count > 0 && game::item_valid(sel.item)) {
        const game::ItemDef& d = game::item_def(sel.item);
        ImGui::TextUnformatted(game::item_name(sel.item));
        ImGui::TextDisabled("%u г | %d руб.%s", d.massG, d.value,
                            d.stackMax > 1 ? " | стек" : "");
        char combat[96];
        card_combat_line(sel.item, combat, sizeof combat);
        if (combat[0]) ImGui::TextUnformatted(combat);
        if (game::item_durability(sel.item) > 0)
            ImGui::Text("состояние %u/255", sel.condition);
        ImGui::Spacing();
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + cardW - pad);
        ImGui::TextUnformatted(game::item_desc(sel.item));
        ImGui::PopTextWrapPos();
        ImGui::Spacing();

        // Действия — ЗАЯВКИ ([inventory.md]): кнопка и её горячая клавиша
        // пишут одинаковый req, применяет app на сим-клоке.
        const std::uint8_t slot8 = static_cast<std::uint8_t>(st.sel);
        const EquipSlot es = static_cast<EquipSlot>(d.equipSlot);
        const bool wearable = es != EquipSlot::None;
        const bool decidedHere =
            eq && ((es == EquipSlot::Weapon && eq->weapon == st.sel) ||
                   (es == EquipSlot::Armor && eq->armor == st.sel) ||
                   (es == EquipSlot::Tool && eq->tool == st.sel));
        if (policy.allowEquip && wearable) {
            if (decidedHere) {
                if (ImGui::Button("Снять [E]") ||
                    ImGui::IsKeyPressed(ImGuiKey_E, false))
                    req = {InvUiRequest::Kind::Unequip, slot8, es};
            } else {
                if (ImGui::Button("Экипировать [E]") ||
                    ImGui::IsKeyPressed(ImGuiKey_E, false))
                    req = {InvUiRequest::Kind::Equip, slot8, es};
            }
            ImGui::SameLine();
        }
        if (policy.allowUse && d.useEffect != 0) {
            if (ImGui::Button("Использовать [U]") ||
                ImGui::IsKeyPressed(ImGuiKey_U, false))
                req = {InvUiRequest::Kind::Use, slot8, EquipSlot::None};
            ImGui::SameLine();
        }
        if (policy.allowDrop) {
            if (ImGui::Button("Бросить [G]") ||
                ImGui::IsKeyPressed(ImGuiKey_G, false))
                req = {InvUiRequest::Kind::Drop, slot8, EquipSlot::None};
        }
        ImGui::NewLine();
    } else {
        ImGui::TextDisabled("пустая ячейка");
    }
    ImGui::EndGroup();
    ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + cell * kInvCols + 6.0f));

    ImGui::End();
    return req;
}

} // namespace giga
