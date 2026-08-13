#include <iostream>
#include <vector>
#include "src/game/save.h"

using namespace giga;
using namespace giga::game;

int main() {
    std::cout << "kSaveFixedWire: " << kSaveFixedWire << "\n";
    std::cout << "save_bytes_for(0): " << save_bytes_for(0) << "\n";

    std::vector<std::uint8_t> bytes;
    SaveState empty;
    save_write(empty, bytes);

    std::cout << "bytes.size(): " << bytes.size() << "\n";
    return 0;
}
