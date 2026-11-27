#include "render/inventory_ui.h"

#include <algorithm>
#include <cstdio>
#include <cstring>

#include "imgui.h"

#include "core/rng.h"           // hash_u32 — детерминированные акценты глифа
#include "game/item_table.h"    // item_def/name/desc — карточка и глиф
#include "game/equip.h"         // item_durability — полоска износа и кнопка починки
#include "game/ranged_table.h"  // ranged_for_item — строка урона в карточке
#include "game/serve.h"         // serve_item_verb — кнопка «Использовать» = вход в дверь утоления
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

// Палитра CRT-аппаратуры ([AGENTS.md], [conversation_ui.cpp], [hud_ui.cpp]):
// фосфор, янтарь, красный опасности, приглушённый фосфор.
constexpr ImVec4 kPhosphor{0.349f, 0.949f, 0.400f, 1.0f}; // #59F266
constexpr ImVec4 kAmber{0.949f, 0.780f, 0.251f, 1.0f};    // #F2C740
constexpr ImVec4 kDanger{0.902f, 0.310f, 0.361f, 1.0f};
constexpr ImVec4 kDim{0.349f, 0.949f, 0.400f, 0.55f};

// ImU32-производные для ImDrawList: те же тона кинескопа без скруглений.
constexpr ImU32 kPhosphorU32 = IM_COL32(89, 242, 102, 255);
constexpr ImU32 kPhosphorDimU32 = IM_COL32(60, 140, 66, 255);
constexpr ImU32 kCellBg = IM_COL32(8, 20, 10, 200);
constexpr ImU32 kCellEdge = IM_COL32(26, 72, 30, 255);
constexpr ImU32 kScanline = IM_COL32(0, 0, 0, 38);
constexpr ImU32 kDangerU32 = IM_COL32(230, 79, 92, 255);
constexpr ImU32 kAmberU32 = IM_COL32(242, 199, 64, 255);

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

namespace {

// Одна сетка клеток: рисует span слотов, двигает свой курсор мышью, вешает
// глиф/стек/износ; скобки решения — только там, где дали Equipped (своя
// сторона). Обе стороны экрана — ЭТОТ код: чужая витрина не «другой виджет»,
// а те же клетки с другим span'ом ([inventory.md] закон зеркала).
void draw_cells(ImDrawList* dl, ImVec2 g0, float cell, const ItemSlot* slots,
                int count, int* sel, bool focused, bool* clickedFocus,
                const game::Equipped* eq, const char* idPrefix,
                std::uint64_t marks = 0, int* rmbCell = nullptr) {
    for (int i = 0; i < count; ++i) {
        const int col = i % kInvCols, row = i / kInvCols;
        const ImVec2 a(g0.x + col * cell, g0.y + row * cell);
        const ImVec2 b(a.x + cell - 3.0f, a.y + cell - 3.0f);
        const ItemSlot& s = slots[i];
        const bool filled =
            s.item != kInvalidItem && s.count > 0 && game::item_valid(s.item);
        const bool selected = focused && (i == *sel);

        dl->AddRectFilled(a, b, kCellBg);
        // VHS-сканлайны клетки, как в референсе.
        for (float y = a.y + 3.0f; y < b.y; y += 4.0f)
            dl->AddRectFilled(ImVec2(a.x, y), ImVec2(b.x, y + 1.0f), kScanline);
        dl->AddRect(a, b, selected ? kPhosphorU32 : kCellEdge, 0.0f, 0,
                    selected ? 2.0f : 1.0f);
        // Метка оффера (deal-режим): амбер-рамка — «это уходит в сделку».
        // Поверх рамки выбора, чтобы читались обе: снаружи метка, внутри курсор.
        if (i < 64 && ((marks >> i) & 1u))
            dl->AddRect(ImVec2(a.x - 1, a.y - 1), ImVec2(b.x + 1, b.y + 1),
                        kAmberU32, 0.0f, 0, 2.0f);

        // Мышь: клик выбирает клетку И перетягивает фокус на её сторону.
        ImGui::SetCursorScreenPos(a);
        char bid[24];
        std::snprintf(bid, sizeof bid, "##%s%d", idPrefix, i);
        if (ImGui::InvisibleButton(bid, ImVec2(cell - 3.0f, cell - 3.0f))) {
            *sel = i;
            *clickedFocus = true;
        }
        // ЗЕРКАЛО РУК (two-hands.md, «да» владельца на зеркальность):
        // ПКМ-клик по клетке = решение ПКМ-руки (кладёт/снимает), E — ЛКМ.
        if (rmbCell && ImGui::IsItemClicked(ImGuiMouseButton_Right)) {
            *sel = i;
            *clickedFocus = true;
            *rmbCell = i;
        }

        if (!filled) continue;
        const game::ItemDef& d = game::item_def(s.item);
        draw_item_glyph(dl, ImVec2(a.x + 4, a.y + 4), ImVec2(b.x - 4, b.y - 8),
                        s.item, d.category, selected ? kPhosphorU32 : kPhosphorDimU32);
        if (s.count > 1) {
            char cnt[12];
            std::snprintf(cnt, sizeof cnt, "x%u", s.count);
            const ImVec2 sz = ImGui::CalcTextSize(cnt);
            const float tx = std::max(a.x + 2.0f, b.x - sz.x - 2.0f);
            const float ty = b.y - sz.y - 3.0f;
            dl->AddText(ImVec2(tx, ty), kPhosphorU32, cnt);
        }
        // Полоска износа — только когда предмету есть что терять: у вечных
        // строк (durability 0) её нет вовсе, минт не рисуем тоже — полоска
        // это ТРЕВОГА, а не украшение.
        if (game::item_durability(s.item) > 0 && s.condition < 255) {
            const float fx = static_cast<float>(s.condition) / 255.0f;
            const ImU32 wc = s.condition < 64 ? kDangerU32 : kPhosphorDimU32;
            dl->AddRectFilled(ImVec2(a.x + 2, b.y - 4.0f),
                              ImVec2(a.x + 2 + (cell - 8.0f) * fx, b.y - 2.0f), wc);
        }
        // Метка РЕШЕНИЯ ([equip.h]): скобки-уголки на экипированной клетке.
        const bool decided =
            eq && (eq->handL == i || eq->armor == i || eq->handR == i);
        if (decided) {
            dl->AddLine(ImVec2(a.x + 1, a.y + 7), ImVec2(a.x + 1, a.y + 1), kPhosphorU32, 2.0f);
            dl->AddLine(ImVec2(a.x + 1, a.y + 1), ImVec2(a.x + 7, a.y + 1), kPhosphorU32, 2.0f);
            dl->AddLine(ImVec2(b.x - 7, b.y - 1), ImVec2(b.x - 1, b.y - 1), kPhosphorU32, 2.0f);
            dl->AddLine(ImVec2(b.x - 1, b.y - 1), ImVec2(b.x - 1, b.y - 7), kPhosphorU32, 2.0f);
        }
    }
}

// Крестовина по сетке `count` клеток шириной kInvCols. Край — край: у сетки
// нет топологии мира, торусом не заворачиваем.
void move_cursor(int* sel, int count) {
    if (ImGui::IsKeyPressed(ImGuiKey_LeftArrow) && *sel % kInvCols > 0) --*sel;
    if (ImGui::IsKeyPressed(ImGuiKey_RightArrow) &&
        *sel % kInvCols < kInvCols - 1 && *sel + 1 < count)
        ++*sel;
    if (ImGui::IsKeyPressed(ImGuiKey_UpArrow) && *sel >= kInvCols)
        *sel -= kInvCols;
    if (ImGui::IsKeyPressed(ImGuiKey_DownArrow) && *sel + kInvCols < count)
        *sel += kInvCols;
}

} // namespace

InvUiRequest inventory_ui_draw(InvUiState& st, const InvUiPolicy& policy,
                               const game::Inventory& inv,
                               const game::Equipped* eq,
                               std::uint32_t carriedG,
                               std::uint32_t capacityG,
                               const InvUiSide* other) {
    InvUiRequest req;

    const bool twoSided = other && other->slots && other->count > 0;
    if (!twoSided) st.focusOther = false;
    if (twoSided && ImGui::IsKeyPressed(ImGuiKey_Tab, false))
        st.focusOther = !st.focusOther;
    if (st.focusOther) {
        move_cursor(&st.selOther, other->count);
        if (st.selOther >= other->count) st.selOther = other->count - 1;
    } else {
        move_cursor(&st.sel, kInvSlots);
    }

    const ImGuiViewport* vp = ImGui::GetMainViewport();
    const float cell = 44.0f;
    const float gridW = cell * kInvCols;
    const float cardW = 396.0f;
    const float pad = 14.0f;
    const float otherW = twoSided ? gridW + pad : 0.0f;
    const float winW = otherW + gridW + cardW + pad * 3;
    const float winH = cell * kInvCols + 116.0f;
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ScrollbarRounding, 0.0f);
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + (vp->WorkSize.x - winW) * 0.5f,
                                   vp->WorkPos.y + (vp->WorkSize.y - winH) * 0.5f),
                            ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(winW, winH), ImGuiCond_Always);
    ImGui::Begin(policy.title, nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoTitleBar);

    ImGui::TextColored(kPhosphor, "%s", policy.title);
    // Вес-бар с бюджетом тела (идея из окна форка, наши пороги тревоги):
    // перегруз — красный, подступ к нему — янтарь, иначе тихий фосфор.
    if (capacityG > 0) {
        const float frac =
            static_cast<float>(carriedG) / static_cast<float>(capacityG);
        ImGui::SameLine(winW * 0.5f - 100.0f);
        char wbuf[48];
        std::snprintf(wbuf, sizeof wbuf, "%.1f / %.1f кг",
                      static_cast<double>(carriedG) / 1000.0,
                      static_cast<double>(capacityG) / 1000.0);
        ImGui::PushStyleColor(
            ImGuiCol_PlotHistogram,
            frac > 1.0f   ? kDanger
            : frac > 0.8f ? kAmber
                          : kDim);
        ImGui::ProgressBar(frac > 1.0f ? 1.0f : frac, ImVec2(200.0f, 14.0f),
                           wbuf);
        ImGui::PopStyleColor();
    } else {
        ImGui::SameLine(winW - 180.0f);
        ImGui::TextColored(kDim, "%.1f кг", static_cast<double>(carriedG) / 1000.0);
    }
    ImGui::Separator();

    // --- Сетки: чужая витрина слева, своя справа; клетка k — слот k ----------
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const ImVec2 top = ImGui::GetCursorScreenPos();
    bool clickOther = false, clickOwn = false;
    if (twoSided) {
        dl->AddText(ImVec2(top.x, top.y), st.focusOther ? kPhosphorU32 : kPhosphorDimU32,
                    other->title);
        draw_cells(dl, ImVec2(top.x, top.y + 18.0f), cell, other->slots,
                   other->count, &st.selOther, st.focusOther, &clickOther,
                   nullptr, "oc", policy.otherMarks);
    }
    const ImVec2 g0(top.x + otherW, top.y + (twoSided ? 18.0f : 0.0f));
    if (twoSided)
        dl->AddText(ImVec2(g0.x, top.y), st.focusOther ? kPhosphorDimU32 : kPhosphorU32,
                    "СВОЁ");
    // ПКМ-клик по своей клетке = решение ПКМ-руки (зеркало рук, ниже).
    int rmbCell = -1;
    draw_cells(dl, g0, cell, inv.slots, kInvSlots, &st.sel, !st.focusOther,
               &clickOwn, eq, "cell", policy.ownMarks,
               policy.allowEquip ? &rmbCell : nullptr);
    if (clickOther) st.focusOther = true;
    if (clickOwn) st.focusOther = false;
    if (rmbCell >= 0) {
        const ItemSlot& rs = inv.slots[rmbCell];
        if (rs.item != kInvalidItem && rs.count > 0 &&
            game::item_valid(rs.item) &&
            game::hand_accepts(static_cast<game::EquipSlot>(
                game::item_def(rs.item).equipSlot))) {
            const bool inR =
                eq && eq->handR == static_cast<std::uint8_t>(rmbCell);
            req = {inR ? InvUiRequest::Kind::Unequip
                       : InvUiRequest::Kind::Equip,
                   static_cast<std::uint8_t>(rmbCell), EquipSlot::Tool};
        }
    }

    // Перенос — клавишами, симметрично: Enter несёт выбранное С АКТИВНОЙ
    // стороны на другую, T — забрать всё (хоткей форка). Заявки, не мутации.
    // Deal-режим ([conversation.md]): Enter — МЕТКА в оффер вместо переноса,
    // T — просьба подписать; сами метки держит и толкует app.
    if (twoSided) {
        if (ImGui::IsKeyPressed(ImGuiKey_Enter, false)) {
            if (policy.deal)
                req = {st.focusOther ? InvUiRequest::Kind::MarkOther
                                     : InvUiRequest::Kind::MarkOwn,
                       static_cast<std::uint8_t>(st.focusOther ? st.selOther
                                                               : st.sel),
                       EquipSlot::None};
            else if (st.focusOther)
                req = {InvUiRequest::Kind::Take,
                       static_cast<std::uint8_t>(st.selOther),
                       EquipSlot::None};
            else
                req = {InvUiRequest::Kind::Give,
                       static_cast<std::uint8_t>(st.sel), EquipSlot::None};
        }
        if (ImGui::IsKeyPressed(ImGuiKey_T, false))
            req = {policy.deal ? InvUiRequest::Kind::Commit
                               : InvUiRequest::Kind::TakeAll,
                   0, EquipSlot::None};
    }

    // --- Карточка выбранного АКТИВНОЙ стороны: всё из таблиц ----------------
    // Прижата к ВЕРХУ, рядом с сеткой — курсор ImGui после сетки стоит внизу,
    // и без явной постановки карточка липла к полу окна.
    const float cardInnerW = cardW - pad;
    ImGui::SetCursorScreenPos(ImVec2(g0.x + gridW + pad, top.y));
    ImGui::BeginGroup();
    const ItemSlot& sel = st.focusOther ? other->slots[st.selOther]
                                        : inv.slots[st.sel];
    if (sel.item != kInvalidItem && sel.count > 0 && game::item_valid(sel.item)) {
        const game::ItemDef& d = game::item_def(sel.item);
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + cardInnerW);
        ImGui::TextColored(kPhosphor, "%s", game::item_name(sel.item));
        ImGui::TextColored(kDim, "%u г | %d руб.%s", d.massG, d.value,
                           d.stackMax > 1 ? " | стек" : "");
        char combat[96];
        card_combat_line(sel.item, combat, sizeof combat);
        if (combat[0]) ImGui::TextUnformatted(combat);
        if (game::item_durability(sel.item) > 0)
            ImGui::TextColored(sel.condition < 64 ? kDanger : kDim,
                               "состояние %u/255", sel.condition);
        ImGui::PopTextWrapPos();
        ImGui::Spacing();
        const char* desc = game::item_desc(sel.item);
        const bool isNote =
            d.category == static_cast<std::uint8_t>(game::ItemCategory::Note);
        const bool isDoc = isNote || (desc && std::strchr(desc, '\n') != nullptr);
        if (isDoc) {
            ImGui::TextColored(kAmber, "%s",
                               isNote ? "[АРХИВ // ЗАПИСКА]"
                                      : "[АРХИВ // ПРОТОКОЛ]");
        }
        ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, isDoc ? 2.0f : 1.0f);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f, 8.0f));
        if (isDoc) {
            ImGui::PushStyleColor(ImGuiCol_Border, kAmber);
            ImGui::PushStyleColor(ImGuiCol_ChildBg,
                                  ImVec4(0.02f, 0.05f, 0.02f, 0.94f));
        }
        ImGui::BeginChild("##itemdoc",
                          ImVec2(cardInnerW, isDoc ? 168.0f : 178.0f), true);
        // 0.0f оборачивает ровно по внутреннему краю окна-ребёнка (с учётом
        // отступов и полосы прокрутки, не сдвигаясь на WindowPadding.x).
        ImGui::PushTextWrapPos(0.0f);
        if (desc && desc[0]) {
            const char* nl = isDoc ? std::strchr(desc, '\n') : nullptr;
            if (nl) {
                ImGui::PushStyleColor(ImGuiCol_Text, kPhosphor);
                ImGui::TextUnformatted(desc, nl);
                ImGui::PopStyleColor();
                ImGui::Separator();
                const char* body = nl + 1;
                while (*body == '\n' || *body == '\r') ++body;
                if (*body) ImGui::TextUnformatted(body);
            } else {
                if (isDoc) ImGui::PushStyleColor(ImGuiCol_Text, kPhosphor);
                ImGui::TextUnformatted(desc);
                if (isDoc) ImGui::PopStyleColor();
            }
        }
        ImGui::PopTextWrapPos();
        ImGui::EndChild();
        if (isDoc) ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(2);
        ImGui::Spacing();

        // Действия — ЗАЯВКИ ([inventory.md]): кнопка и её горячая клавиша
        // пишут одинаковый req, применяет app на сим-клоке. У чужой стороны
        // действие одно — взять; свои действия живут только на своей сетке.
        const float rowLeftX = ImGui::GetCursorScreenPos().x;
        const float rowRightX = rowLeftX + cardInnerW;
        bool rowHasBtn = false;
        auto place_btn = [&](const char* label) -> bool {
            const float btnW = ImGui::CalcTextSize(label, nullptr, true).x +
                               ImGui::GetStyle().FramePadding.x * 2.0f;
            if (rowHasBtn) {
                const float nextX =
                    ImGui::GetItemRectMax().x + ImGui::GetStyle().ItemSpacing.x;
                if (nextX + btnW <= rowRightX) ImGui::SameLine();
            }
            rowHasBtn = true;
            return ImGui::Button(label);
        };

        if (policy.deal) {
            // Одна кнопка на обе стороны: слот либо в оффере, либо нет.
            const bool marked = st.focusOther
                                    ? ((policy.otherMarks >> st.selOther) & 1u)
                                    : ((policy.ownMarks >> st.sel) & 1u);
            if (place_btn(marked ? "Снять метку [Enter]" : "В сделку [Enter]"))
                req = {st.focusOther ? InvUiRequest::Kind::MarkOther
                                     : InvUiRequest::Kind::MarkOwn,
                       static_cast<std::uint8_t>(st.focusOther ? st.selOther
                                                               : st.sel),
                       EquipSlot::None};
        } else if (st.focusOther) {
            if (place_btn("Взять [Enter]"))
                req = {InvUiRequest::Kind::Take,
                       static_cast<std::uint8_t>(st.selOther), EquipSlot::None};
        } else {
            const std::uint8_t slot8 = static_cast<std::uint8_t>(st.sel);
            const EquipSlot es = static_cast<EquipSlot>(d.equipSlot);
            const bool wearable = es != EquipSlot::None;
            if (policy.allowEquip && wearable) {
                if (game::hand_accepts(es)) {
                    // ДВЕ РУКИ (two-hands.md): E — решение ЛКМ-руки; Q ИЛИ
                    // ПКМ-клик по клетке — решение ПКМ-руки (симметрия E/Q —
                    // владелец 2026-08-31).
                    const bool inL = eq && eq->handL == st.sel;
                    const bool inR = eq && eq->handR == st.sel;
                    if (inL) {
                        if (place_btn("Снять ЛКМ [E]") ||
                            ImGui::IsKeyPressed(ImGuiKey_E, false))
                            req = {InvUiRequest::Kind::Unequip, slot8,
                                   EquipSlot::Weapon};
                    } else {
                        if (place_btn("В ЛКМ-руку [E]") ||
                            ImGui::IsKeyPressed(ImGuiKey_E, false))
                            req = {InvUiRequest::Kind::Equip, slot8,
                                   EquipSlot::Weapon};
                    }
                    if (inR) {
                        if (place_btn("Снять ПКМ [Q]") ||
                            ImGui::IsKeyPressed(ImGuiKey_Q, false))
                            req = {InvUiRequest::Kind::Unequip, slot8,
                                   EquipSlot::Tool};
                    } else {
                        if (place_btn("В ПКМ-руку [Q]") ||
                            ImGui::IsKeyPressed(ImGuiKey_Q, false))
                            req = {InvUiRequest::Kind::Equip, slot8,
                                   EquipSlot::Tool};
                    }
                } else {
                    const bool decidedHere = eq && eq->armor == st.sel;
                    if (decidedHere) {
                        if (place_btn("Снять [E]") ||
                            ImGui::IsKeyPressed(ImGuiKey_E, false))
                            req = {InvUiRequest::Kind::Unequip, slot8, es};
                    } else {
                        if (place_btn("Экипировать [E]") ||
                            ImGui::IsKeyPressed(ImGuiKey_E, false))
                            req = {InvUiRequest::Kind::Equip, slot8, es};
                    }
                }
            }
            // Кнопка доступна для предметов с глаголом утоления ИЛИ медицины Heal.
            const bool canUseItem =
                game::serve_item_verb(sel.item) < game::kVerbCount ||
                game::item_def(sel.item).useEffect ==
                    static_cast<std::uint8_t>(game::UseEffect::Heal);
            if (policy.allowUse && canUseItem) {
                if (place_btn("Использовать [U]") ||
                    ImGui::IsKeyPressed(ImGuiKey_U, false))
                    req = {InvUiRequest::Kind::Use, slot8, EquipSlot::None};
            }
            if (policy.allowDrop) {
                if (place_btn("Бросить [G]") ||
                    ImGui::IsKeyPressed(ImGuiKey_G, false))
                    req = {InvUiRequest::Kind::Drop, slot8, EquipSlot::None};
            }
            if (policy.allowRepair && game::item_durability(sel.item) > 0 &&
                sel.condition < 255) {
                // Цену и станцию судит примитив ([craft.h] craft_repair_item) —
                // кнопка лишь заявка, отказ придёт словами craft_fail_text.
                if (place_btn("Починить [R]") ||
                    ImGui::IsKeyPressed(ImGuiKey_R, false))
                    req = {InvUiRequest::Kind::Repair, slot8, EquipSlot::None};
            }
            // Двухсторонний экран: своё можно ПОЛОЖИТЬ на ту сторону.
            if (twoSided) {
                if (place_btn("Положить [Enter]"))
                    req = {InvUiRequest::Kind::Give, slot8, EquipSlot::None};
            }
        }
    } else {
        ImGui::TextColored(kDim, "пустая ячейка");
    }
    ImGui::EndGroup();
    ImGui::SetCursorScreenPos(ImVec2(g0.x, g0.y + cell * kInvCols + 6.0f));
    if (policy.deal) {
        // Баланс сделки — строку даёт app (цены считает game-слой, [barter.h]);
        // амбер = подписуемо, тускло = чего-то не хватает (строка говорит чего).
        if (policy.dealLine) {
            ImGui::TextColored(policy.dealOk ? kAmber : kDim, "%s",
                               policy.dealLine);
        }
        ImGui::TextColored(
            kDim, "Enter метка | Tab сторона | T СДЕЛКА | Esc закрыть");
    } else if (twoSided)
        ImGui::TextColored(
            kDim, "Enter взять/положить | Tab сторона | T всё | I/Esc закрыть");
    else
        ImGui::TextColored(kDim, "I/Esc закрыть");

    ImGui::End();
    ImGui::PopStyleVar(4);
    return req;
}

} // namespace giga
