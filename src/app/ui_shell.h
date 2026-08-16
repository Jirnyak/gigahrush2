// UI Shell — ЕДИНЫЙ источник истины про то, «где» находится приложение.
//
// До этого файла правда была размазана: AppScreen{Menu,Playing} + bool paused +
// int menuScreenPage + showVendorWindow + showCraftingWindow + invUi.open —
// шесть независимых флагов, чьи комбинации никто не перечислял. Гейт ввода
// собирал их по одному и однажды пропустил бы новый ([inventory.md] — сетка
// глушит бинды «как typing», торговое окно так не делало).
//
// Теперь состояние — ДВА перечисления и точка:
//   * AppScreen — ВЗАИМОИСКЛЮЧАЮЩИЕ экраны приложения. Pause — экран, а не
//     флажок поверх Playing: «сим стоит, ввод у меню» — это место, где ты
//     находишься, а не свойство места.
//   * UiWindow — окно ПОВЕРХ Playing, и оно ОДНО за раз. Это CRT-мандат, а не
//     упрощение: служебная аппаратура показывает один экранчик, стопка
//     перетаскиваемых окон — метафора десктопа, которой в этой игре нет.
//     (Референс starcluster держит вектор окон — там это торговый симулятор
//     с мышиным UI; наш выбор противоположен и записан.)
//
// Консоль (~) НЕ здесь: она отладочный инструмент с собственным вводом и
// живёт поверх ЛЮБОГО экрана — инструмент разработчика не часть игры.
//
// Диалоги/VN ([starcluster] VisualNovelState — типовой референс): окно Dialog
// зарезервировано; интро нового рана и реплики NPC придут его потребителями.
#pragma once

#include <cstdint>

namespace giga {

enum class AppScreen : std::uint8_t {
    Intro,    // титульная заставка; любая клавиша -> Menu
    Menu,     // стартовый экран (страницы в UiShell::menuPage)
    Playing,  // сим тикает, ввод у тела (если окно не открыто)
    Pause,    // Esc из игры: сим заморожен, поверх — страницы меню
};

enum class UiWindow : std::uint8_t {
    None = 0,
    Inventory,  // клеточная сетка ([inventory.md])
    Vendor,     // торговец — станет политикой сетки, пока своё окно
    Craft,      // верстак — то же
    Elevator,   // шахтное меню
    Dialog,     // VN-оверлей: интро рана, реплики NPC (зарезервировано)
};

struct UiShell {
    AppScreen screen = AppScreen::Intro;
    UiWindow window = UiWindow::None;  // осмысленно только в Playing
    int menuPage = 0;  // 0 root, 1 load, 2 new-game, 3 settings (Menu и Pause)

    bool playing() const { return screen == AppScreen::Playing; }
    bool sim_frozen() const { return screen != AppScreen::Playing; }

    // Гейт ввода в ОДНОМ месте: пока правда была россыпью флагов, каждый
    // новый флаг должен был не забыть вписаться сюда сам.
    bool ui_owns_input() const {
        return screen != AppScreen::Playing || window != UiWindow::None;
    }

    // Одно окно за раз ПО ПОСТРОЕНИЮ: открытие нового закрывает старое,
    // повторное открытие того же — закрывает его (клавиша-тумблер).
    void toggle(UiWindow w) { window = (window == w) ? UiWindow::None : w; }
    void close_window() { window = UiWindow::None; }
};

} // namespace giga
