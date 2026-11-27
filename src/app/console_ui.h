// Окно консоли разработчика (~) ([console.h]).
//
// Тонкая ImGui-оболочка над game::Console.
// Вынесено из main.cpp в изолированный модуль UI.
#pragma once

#include "game/console.h"
#include <string>
#include <vector>

namespace giga {

void draw_console_ui(bool* p_open,
                     bool* p_focus,
                     char* inputBuf,
                     std::size_t inputCap,
                     game::Console& con,
                     game::ConsoleContext& ctx,
                     std::vector<std::string>& log,
                     std::vector<std::string>& history,
                     int& histPos);

} // namespace giga
