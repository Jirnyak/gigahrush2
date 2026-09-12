// Худ игрока — стекло, и только стекло ([hud.md]).
//
// Каждый элемент — СТРОКА ТАБЛИЦЫ {id, слот, вкл, отрисовка}, не ветка в общем
// if: новый элемент = новая строка, тумблер в Settings → Interface получается
// из той же строки бесплатно (hud_elements() отдаёт таблицу настройкам).
// Раскладка — тоже данные: слот в строке, а не координата в коде; переезд
// элемента в другой угол — правка одного поля.
//
// Закон 1 hud.md соблюдён конструкцией: контекст несёт entity игрока, найденный
// app'ом по CameraTag+Controller, — синглтона нет, пересадка тела мгновенно
// переключает числа. Закон 2 — типами: контекст собран из const-указателей,
// элементу физически нечем писать в сим.
//
// Живёт в src/app (не src/game): рисует ImGui, а giga_game не знает про ImGui
// так же, как не знает про SDL ([AGENTS.md] layering). Дебаг-портянка — НЕ
// здесь: она дев-инструмент на F1 и осталась в main.cpp.
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/registry.h"

namespace giga {

namespace game {
class NpcPool;
struct StatusSet;
struct SamosborState;
struct NeedsTick;
}

// Среда клетки под телом — АГРЕГАТ мира-автомата ([world/medium.h], S16.4):
// кванты жидкости и газа клетки (0..512). App снимает и передаёт числами;
// тот же агрегат читают плавучесть и дыхание — один путь, спецсистем нет.
struct HudGas {
    std::uint16_t water = 0, gas = 0;
    bool valid = false;
};

// Всё, что элементы читают. Указатели — на живые объекты кадра; nullptr
// законен (элемент молчит), чтобы харнессы без части систем не падали.
struct HudContext {
    Registry* reg = nullptr;
    game::NpcPool* pool = nullptr;
    Entity player = entt::null;
    const game::StatusSet* status = nullptr;
    const game::SamosborState* samosbor = nullptr;
    const game::NeedsTick* needsTick = nullptr;
    HudGas gas;
    // Сим-тик — единственный вход часов дома в худ ([core/watch.h], S15).
    // Не секунды и не кадры: календарь читается СДВИГАМИ, и делить тут нечего.
    std::uint64_t tick = 0;
    // Готовая строка таблички интеракции («[F]  OPEN DOOR») или nullptr.
    // Собирает приложение (у него фокус кадра и бинды); худ только рисует.
    // Живёт кадр — указатель на буфер вызывающего.
    const char* interactPrompt = nullptr;
};

// Углы стекла. Center — прицел и алерты; остальное прижато к краям.
enum class HudSlot : std::uint8_t { TopLeft, BottomLeft, BottomRight, Center };

struct HudElement {
    const char* id;    // стабильный ключ: файл настроек и тумблер
    const char* label; // подпись тумблера в Settings → Interface
    HudSlot slot;
    bool on;           // состояние тумблера; настройки приложения, не сейв
    void (*draw)(const HudContext&);
    // «Есть что сказать?» — для ТИХИХ элементов (статусы, алерты): пустой
    // угол и есть «всё ок», а окно слота без единой строки рисует голый
    // квадратик рамки (пойман скриншотом). nullptr = всегда есть.
    bool (*live)(const HudContext&) = nullptr;
};

// Таблица элементов — для отрисовки И для страницы настроек (она рисует по
// строке-тумблеру на элемент, не зная, что элементы вообще существуют).
HudElement* hud_elements(std::size_t& count);

// Нарисовать включённые элементы, сгруппированные по слотам. Зовётся только
// в AppScreen::Playing — пауза показывает меню, заставка ничего.
void hud_ui_draw(const HudContext& ctx);

} // namespace giga
