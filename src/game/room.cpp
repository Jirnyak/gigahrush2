// Комната как объект — штамп зон в roomAt. Законы в room.h.

#include "game/room.h"

#include "world/types.h" // macro_index

namespace giga::game {

void rooms_reset(FloorRooms& fr) {
    fr.list.clear();
    fr.boxes.clear();
    fr.aliases.clear();
    fr.overlapCells = 0;
    fr.refused = 0;
    // 4 МиБ на резидентный этаж (решение владельца 2026-08-28) — против
    // 11 полей по 2 МиБ, которые этот индекс хоронит: баланс −18 МиБ.
    fr.roomAt.assign(
        static_cast<std::size_t>(kMacroDim) * kMacroDim * kMacroDim, kNoRoom);
}

RoomId room_declare(FloorRooms& fr, const RoomBox* boxes, int boxCount,
                    std::uint16_t tags, std::uint16_t owner,
                    const std::int16_t* declared) {
    // Комната без клеток запрещена (гейт 2 плана): пустая композиция или
    // нулевая ось — отказ вслух, не молчаливый мусор в списке.
    if (boxes == nullptr || boxCount <= 0) {
        ++fr.refused;
        return kNoRoom;
    }
    for (int b = 0; b < boxCount; ++b)
        if (boxes[b].sx == 0 || boxes[b].sy == 0 || boxes[b].sz == 0) {
            ++fr.refused;
            return kNoRoom;
        }
    // u16-предел: 65534 комнаты на этаж (0 — kNoRoom). Достигнуть его можно
    // только зоной ~в клетку на весь тор; отказ громкий, не обрезание.
    if (fr.list.size() >= 0xFFFEu) {
        ++fr.refused;
        return kNoRoom;
    }

    const RoomId id = static_cast<RoomId>(fr.list.size() + 1);
    Room r;
    r.tags = tags;
    r.owner = owner;
    r.boxFirst = static_cast<std::uint32_t>(fr.boxes.size());
    r.boxCount = static_cast<std::uint16_t>(boxCount);
    if (declared != nullptr)
        for (std::size_t v = 0; v < kVerbCount; ++v) r.declared[v] = declared[v];

    // Штамп сразу: один проход по клеткам боксов, wrap по всем трём осям
    // (S1 — зона на шве тора так же законна, как блок падика на шве).
    // Первый объявивший владеет клеткой; повторная клетка — overlapCells.
    std::uint32_t stamped = 0;
    for (int b = 0; b < boxCount; ++b) {
        const RoomBox& box = boxes[b];
        for (int dz = 0; dz < box.sz; ++dz)
            for (int dy = 0; dy < box.sy; ++dy)
                for (int dx = 0; dx < box.sx; ++dx) {
                    const std::size_t ci = macro_index(wrap_macro(box.x + dx),
                                                       wrap_macro(box.y + dy),
                                                       wrap_macro(box.z + dz));
                    if (fr.roomAt[ci] == kNoRoom) {
                        fr.roomAt[ci] = id;
                        ++stamped;
                    } else {
                        ++fr.overlapCells;
                    }
                }
    }
    r.cells = static_cast<std::uint16_t>(stamped > 0xFFFFu ? 0xFFFFu : stamped);

    fr.boxes.insert(fr.boxes.end(), boxes, boxes + boxCount);
    fr.list.push_back(r);
    return id;
}

RoomId room_at(const FloorRooms& fr, int x, int y, int z) {
    if (fr.roomAt.empty()) return kNoRoom;
    return fr.roomAt[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
}

const Room* room_of(const FloorRooms& fr, RoomId id) {
    if (id == kNoRoom || id > fr.list.size()) return nullptr;
    return &fr.list[id - 1];
}

Room* room_of(FloorRooms& fr, RoomId id) {
    if (id == kNoRoom || id > fr.list.size()) return nullptr;
    return &fr.list[id - 1];
}

void room_alias(FloorRooms& fr, std::uint32_t aliasHash, RoomId id) {
    fr.aliases.emplace_back(aliasHash, id);
}

RoomId room_find_alias(const FloorRooms& fr, std::uint32_t aliasHash) {
    for (const auto& [h, id] : fr.aliases)
        if (h == aliasHash) return id;
    return kNoRoom;
}

} // namespace giga::game
