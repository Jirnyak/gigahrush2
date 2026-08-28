// МАСКИ ЭТАЖА (S18) — одна система пометок объёма.
//
// Маска НЕ создаёт геометрию: она наделяет уже построенную свойством.
// Носитель один — MaskGroup: id-свойства-материал + клетки с субвоксельной
// формой «эти субвоксели мои». Живые свойства:
//
//   * SHIELD — «объём не меняет никакой писатель геометрии»: карв
//     (remove_key) и детач-конверсия (convert_nodes) спрашивают щит и
//     отказывают по атому. Назначение — ЧИСТО гермо и лифты (владелец
//     2026-08-28: гермостены/гермокомнаты/гермодвери, лифтовые столбы);
//     сегодня штампуют только столбы. Бывший ProtectMask
//     ([world/protect.h], вырезан) — клеточный частный случай;
//     субвоксельность — решение владельца 2026-08-28: гермостенка бывает
//     тоньше клетки, и щит обязан лечь по её атомам, не морозить клетку.
//   * DOOR — «эти субвоксели исчезают при открытии и возвращаются при
//     закрытии» ([game/door.h] — семантика тоггла там; здесь только запись).
//
// Общие законы (CANON.md S18): кладёт МОДУЛЬ этажа на генерации; НЕ в
// снимке ревизита — чистая функция модуля (kind, number, seed),
// перештамповывается обеими ветками, в сейв едет только материя (S17);
// потребители спрашивают маску сами, маска ничего не толкает.
//
// Горячий путь карва не дорожает: клеточный битсет-кэш «в клетке есть
// щит-биты» — O(1)-отсев (промах = обычный карв, подавляющее большинство);
// спуск в субвоксели — bsearch по слитым щит-битам только при попадании.
#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

#include "core/math.h"        // vec3
#include "world/macro_grid.h" // SubMask
#include "world/types.h"      // kMacroCells, CellType

namespace giga {

// Свойства группы — битовые флаги: одна группа вправе быть и дверью, и
// щитом (неразрушимая гермоворота) без второй записи.
inline constexpr std::uint8_t kMaskShield = 1u << 0;
inline constexpr std::uint8_t kMaskDoor = 1u << 1;

// «Эти субвоксели мои» — форма маски в клетке. Полная клетка = full-маска.
struct MaskCell {
    std::uint32_t ci = 0; // macro_index клетки
    SubMask allow;        // какие атомы клетки принадлежат группе
};

struct MaskGroup {
    std::uint8_t props = 0;     // kMaskShield | kMaskDoor
    CellType mat = 0;           // ЧЕМ (двери); 0 у чистого щита
    std::uint8_t mechanism = 0; // владелец-машина (лифт): актор не трогает
    // Представитель объёма для прицела и дистанций — ВЫВЕДЕН при
    // объявлении (wrap-осознанное среднее центров клеток), не назначен.
    vec3 centre{0.0f, 0.0f, 0.0f};
    std::vector<MaskCell> cells;
};

// Все маски этажа + кэши горячего пути. Слот перерабатывается вместе с
// этажом: clear_all при перештамповке.
struct FloorMasks {
    std::vector<MaskGroup> groups;

    void clear_all() {
        groups.clear();
        shieldCellBits_.assign(kMacroCells / 64, 0ull);
        shieldSub_.clear();
    }

    // Перестроить кэши щита по группам. Зовётся после объявления масок
    // этажа (штамп модуля); тоггл двери кэш не трогает — щит-биты двери
    // не зависят от того, стоит ли её материя.
    void rebuild_shield_cache() {
        shieldCellBits_.assign(kMacroCells / 64, 0ull);
        shieldSub_.clear();
        for (const MaskGroup& g : groups) {
            if (!(g.props & kMaskShield)) continue;
            for (const MaskCell& mc : g.cells) {
                shieldCellBits_[mc.ci >> 6] |= 1ull << (mc.ci & 63u);
                shieldSub_.push_back({mc.ci, mc.allow});
            }
        }
        std::sort(shieldSub_.begin(), shieldSub_.end(),
                  [](const MaskCell& a, const MaskCell& b) {
                      return a.ci < b.ci;
                  });
        // Слить дубли (две группы в одной клетке): один bsearch-хит на ci.
        std::size_t out = 0;
        for (std::size_t i = 0; i < shieldSub_.size(); ++i) {
            if (out > 0 && shieldSub_[out - 1].ci == shieldSub_[i].ci) {
                for (std::size_t wd = 0; wd < kSubMaskWords; ++wd)
                    shieldSub_[out - 1].allow.words[wd] |=
                        shieldSub_[i].allow.words[wd];
            } else {
                shieldSub_[out++] = shieldSub_[i];
            }
        }
        shieldSub_.resize(out);
    }

    // Есть ли в клетке хоть один щит-бит — O(1), горячий отсев карва.
    bool shielded_cell(std::size_t ci) const {
        return ((shieldCellBits_[ci >> 6] >> (ci & 63u)) & 1u) != 0u;
    }

    // Защищён ли АТОМ. Дешёвый промах по клеточному кэшу; bsearch — только
    // в клетках со щитом (лифтовые столбы и т.п., доли процента мира).
    bool shielded(std::size_t ci, int bit) const {
        if (!shielded_cell(ci)) return false;
        const auto it = std::lower_bound(
            shieldSub_.begin(), shieldSub_.end(), static_cast<std::uint32_t>(ci),
            [](const MaskCell& a, std::uint32_t key) { return a.ci < key; });
        return it != shieldSub_.end() &&
               it->ci == static_cast<std::uint32_t>(ci) && it->allow.test(bit);
    }

private:
    // Кэши предиката щита над группами — та же лестница, что CellType над
    // маской (S2): правда в группах, битсет производен.
    std::vector<std::uint64_t> shieldCellBits_ =
        std::vector<std::uint64_t>(kMacroCells / 64, 0ull);
    std::vector<MaskCell> shieldSub_; // слитые щит-биты, сортировка по ci
};

} // namespace giga
