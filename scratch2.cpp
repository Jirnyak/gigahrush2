template <class Fn>
void for_each_padic_doorway(unsigned seed, int number, Fn&& fn) {
    std::uint32_t rng = seed ^ 0x7AD1C;
    for (int z = 0; z < 128; z += 3) {
        std::vector<Room> rooms;
        split_room(0, 0, 128, 60, rng, rooms);
        split_room(0, 68, 128, 128 - 68, rng, rooms);
        
        for (const auto& r : rooms) {
            fn(wrap_macro(r.x + r.w / 2), wrap_macro(r.y), z, 2, 1);
            fn(wrap_macro(r.x + r.w / 2), wrap_macro(r.y + r.h - 1), z, 2, 1);
            fn(wrap_macro(r.x), wrap_macro(r.y + r.h / 2), z, 2, 0);
            fn(wrap_macro(r.x + r.w - 1), wrap_macro(r.y + r.h / 2), z, 2, 0);
        }
    }
}
