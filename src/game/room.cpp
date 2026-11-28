// Комната как объект — штамп зон в roomAt. Законы в room.h.

#include "game/room.h"

#include <cstring>

#include "world/types.h" // macro_index, kMacroCells, wrap_macro

namespace giga::game {

void rooms_reset(FloorRooms& fr) {
    fr.features.clear();
    fr.records.clear();
    fr.boxes.clear();
    fr.declaredArchetypes.clear();
    fr.declaredArchetypes.push_back({}); // слот 0: нулевой профиль декларации
    fr.supplies.clear();
    fr.supplies.push_back({});           // слот 0: нулевой запас комнаты
    fr.aliases.clear();
    fr.overlapCells = 0;
    fr.refused = 0;
    // 4 МиБ на резидентный этаж (решение владельца 2026-08-28) — против
    // 11 полей по 2 МиБ, которые этот индекс хоронит: баланс −18 МиБ.
    fr.roomAt.assign(
        static_cast<std::size_t>(kMacroDim) * kMacroDim * kMacroDim, kNoRoom);
    fr.bins.assign(kRoomBinCount, {});
    fr.binCeil.assign(kRoomBinCount * kVerbCount, 0);
    for (std::size_t v = 0; v < kVerbCount; ++v) fr.maxOffer[v] = 0;
}

void rooms_bin_ceil_raise(FloorRooms& fr, const RoomFeature& feat) {
    if (fr.binCeil.empty() || feat.boxCount == 0) return;
    const std::uint32_t end = feat.boxFirst + feat.boxCount;
    if (end > fr.boxes.size()) return;
    static constexpr std::array<std::int16_t, kVerbCount> kZeroDecl{};
    const auto& decl = feat.declaredArchetype < fr.declaredArchetypes.size()
                           ? fr.declaredArchetypes[feat.declaredArchetype]
                           : kZeroDecl;
    for (std::uint32_t b = feat.boxFirst; b < end; ++b) {
        const RoomBox& box = fr.boxes[b];
        const int bx0 = box.x >> kRoomBinShift;
        const int by0 = box.y >> kRoomBinShift;
        const int bz0 = box.z >> kRoomBinShift;
        const int bx1 = (box.x + box.sx - 1) >> kRoomBinShift;
        const int by1 = (box.y + box.sy - 1) >> kRoomBinShift;
        const int bz1 = (box.z + box.sz - 1) >> kRoomBinShift;
        for (int bz = bz0; bz <= bz1; ++bz)
            for (int by = by0; by <= by1; ++by)
                for (int bx = bx0; bx <= bx1; ++bx) {
                    std::int32_t* ceil =
                        &fr.binCeil[room_bin_index(bx, by, bz) * kVerbCount];
                    for (std::size_t v = 0; v < kVerbCount; ++v) {
                        const std::int32_t offer =
                            static_cast<std::int32_t>(decl[v]);
                        if (offer > ceil[v]) ceil[v] = offer;
                    }
                }
    }
}

void rooms_bin_ceil_raise(FloorRooms& fr, RoomId id) {
    if (fr.binCeil.empty() || id == kNoRoom || id > fr.features.size()) return;
    const auto& feat = fr.features[id - 1];
    const auto decl = fr.room_declared(id);
    const auto sup = fr.room_supply(id);
    const std::uint32_t end = feat.boxFirst + feat.boxCount;
    if (end > fr.boxes.size()) return;
    for (std::uint32_t b = feat.boxFirst; b < end; ++b) {
        const RoomBox& box = fr.boxes[b];
        const int bx0 = box.x >> kRoomBinShift;
        const int by0 = box.y >> kRoomBinShift;
        const int bz0 = box.z >> kRoomBinShift;
        const int bx1 = (box.x + box.sx - 1) >> kRoomBinShift;
        const int by1 = (box.y + box.sy - 1) >> kRoomBinShift;
        const int bz1 = (box.z + box.sz - 1) >> kRoomBinShift;
        for (int bz = bz0; bz <= bz1; ++bz)
            for (int by = by0; by <= by1; ++by)
                for (int bx = bx0; bx <= bx1; ++bx) {
                    std::int32_t* ceil =
                        &fr.binCeil[room_bin_index(bx, by, bz) * kVerbCount];
                    for (std::size_t v = 0; v < kVerbCount; ++v) {
                        const std::int32_t offer =
                            static_cast<std::int32_t>(decl[v]) + sup[v];
                        if (offer > ceil[v]) ceil[v] = offer;
                    }
                }
    }
}

void rooms_bin_ceil_raise(FloorRooms& fr, const Room& r) {
    if (fr.binCeil.empty() || r.boxCount == 0) return;
    const std::uint32_t end = r.boxFirst + r.boxCount;
    if (end > fr.boxes.size()) return;
    for (std::uint32_t b = r.boxFirst; b < end; ++b) {
        const RoomBox& box = fr.boxes[b];
        const int bx0 = box.x >> kRoomBinShift;
        const int by0 = box.y >> kRoomBinShift;
        const int bz0 = box.z >> kRoomBinShift;
        const int bx1 = (box.x + box.sx - 1) >> kRoomBinShift;
        const int by1 = (box.y + box.sy - 1) >> kRoomBinShift;
        const int bz1 = (box.z + box.sz - 1) >> kRoomBinShift;
        for (int bz = bz0; bz <= bz1; ++bz)
            for (int by = by0; by <= by1; ++by)
                for (int bx = bx0; bx <= bx1; ++bx) {
                    std::int32_t* ceil =
                        &fr.binCeil[room_bin_index(bx, by, bz) * kVerbCount];
                    for (std::size_t v = 0; v < kVerbCount; ++v) {
                        const std::int32_t offer =
                            static_cast<std::int32_t>(r.declared[v]) +
                            r.supply[v];
                        if (offer > ceil[v]) ceil[v] = offer;
                    }
                }
    }
}

Room FloorRooms::room(RoomId id) const noexcept {
    Room r{};
    if (id == kNoRoom || id > features.size()) return r;
    const auto& f = features[id - 1];
    r.tags = f.tags;
    r.boxFirst = f.boxFirst;
    r.boxCount = f.boxCount;
    r.cells = f.cells;
    if (id <= records.size()) {
        const auto& rec = records[id - 1];
        r.owner = rec.owner;
        r.rep = rec.rep;
        if (rec.supplyIdx < supplies.size())
            std::memcpy(r.supply, supplies[rec.supplyIdx].data(), sizeof(r.supply));
    } else {
        r.owner = f.baseOwner;
    }
    if (f.declaredArchetype < declaredArchetypes.size())
        std::memcpy(r.declared, declaredArchetypes[f.declaredArchetype].data(),
                    sizeof(r.declared));
    return r;
}

std::array<std::int32_t, kVerbCount>& room_ensure_supply(FloorRooms& fr,
                                                         RoomId id) {
    if (fr.supplies.empty()) fr.supplies.push_back({});
    if (id == kNoRoom || id > fr.records.size()) return fr.supplies[0];
    auto& rec = fr.records[id - 1];
    if (rec.supplyIdx == 0 || rec.supplyIdx >= fr.supplies.size()) {
        fr.supplies.push_back({});
        rec.supplyIdx = static_cast<std::uint16_t>(fr.supplies.size() - 1);
    }
    return fr.supplies[rec.supplyIdx];
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
    if (fr.features.size() >= 0xFFFEu) {
        ++fr.refused;
        return kNoRoom;
    }

    const RoomId id = static_cast<RoomId>(fr.features.size() + 1);
    if (fr.declaredArchetypes.empty()) fr.declaredArchetypes.push_back({});
    if (fr.supplies.empty()) fr.supplies.push_back({});

    RoomFeature feat{};
    feat.tags = tags;
    feat.baseOwner = owner;
    feat.boxFirst = static_cast<std::uint32_t>(fr.boxes.size());
    feat.boxCount = static_cast<std::uint16_t>(boxCount);

    std::array<std::int16_t, kVerbCount> targetDecl{};
    if (declared != nullptr)
        for (std::size_t v = 0; v < kVerbCount; ++v) targetDecl[v] = declared[v];
    std::uint8_t archIdx = 0;
    for (std::size_t i = 0; i < fr.declaredArchetypes.size(); ++i) {
        if (fr.declaredArchetypes[i] == targetDecl) {
            archIdx = static_cast<std::uint8_t>(i);
            break;
        }
    }
    if (archIdx == 0 && targetDecl != std::array<std::int16_t, kVerbCount>{}) {
        if (fr.declaredArchetypes.size() < 255) {
            fr.declaredArchetypes.push_back(targetDecl);
            archIdx = static_cast<std::uint8_t>(fr.declaredArchetypes.size() - 1);
        }
    }
    feat.declaredArchetype = archIdx;

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
    feat.cells = static_cast<std::uint16_t>(stamped > 0xFFFFu ? 0xFFFFu : stamped);

    // Бины: каждый бин, чей объём пересекает бокс, знает комнату. Пуши
    // одной комнаты идут подряд, поэтому дедуп боксов-соседей — проверкой
    // хвоста, без множеств.
    for (int b = 0; b < boxCount; ++b) {
        const RoomBox& box = boxes[b];
        const int bx0 = box.x >> kRoomBinShift;
        const int by0 = box.y >> kRoomBinShift;
        const int bz0 = box.z >> kRoomBinShift;
        const int bx1 = (box.x + box.sx - 1) >> kRoomBinShift; // без wrap:
        const int by1 = (box.y + box.sy - 1) >> kRoomBinShift; // завернёт
        const int bz1 = (box.z + box.sz - 1) >> kRoomBinShift; // room_bin_index
        for (int bz = bz0; bz <= bz1; ++bz)
            for (int by = by0; by <= by1; ++by)
                for (int bx = bx0; bx <= bx1; ++bx) {
                    auto& bin = fr.bins[room_bin_index(bx, by, bz)];
                    if (bin.empty() || bin.back() != id) bin.push_back(id);
                }
    }
    // Храповик верхней границы предложения (supply на объявлении нулевой).
    for (std::size_t v = 0; v < kVerbCount; ++v)
        if (static_cast<std::int32_t>(targetDecl[v]) > fr.maxOffer[v])
            fr.maxOffer[v] = targetDecl[v];

    fr.boxes.insert(fr.boxes.end(), boxes, boxes + boxCount);
    fr.features.push_back(feat);
    RoomRecord rec{};
    rec.owner = owner;
    rec.rep = 0;
    rec.supplyIdx = 0;
    rec.occupants = 0;
    fr.records.push_back(rec);
    rooms_bin_ceil_raise(fr, feat); // потолки — после посадки боксов
    return id;
}

RoomId room_at(const FloorRooms& fr, int x, int y, int z) {
    if (fr.roomAt.empty()) return kNoRoom;
    return fr.roomAt[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
}

std::uint16_t room_occupants(const FloorRooms& fr, RoomId id) {
    if (id == kNoRoom || id > fr.records.size()) return 0;
    return fr.records[id - 1].occupants;
}

void room_occupant_add(FloorRooms& fr, RoomId id, int delta) {
    if (id == kNoRoom || id > fr.records.size() || delta == 0) return;
    const std::int32_t next =
        static_cast<std::int32_t>(fr.records[id - 1].occupants) + delta;
    if (next <= 0)
        fr.records[id - 1].occupants = 0;
    else if (next >= 0xFFFF)
        fr.records[id - 1].occupants = 0xFFFFu;
    else
        fr.records[id - 1].occupants = static_cast<std::uint16_t>(next);
}

void rooms_occupants_clear(FloorRooms& fr) {
    for (auto& rec : fr.records) rec.occupants = 0;
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
