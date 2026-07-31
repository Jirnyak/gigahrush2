template <class Fn>
void for_each_padic_doorway(unsigned seed, int number, Fn&& fn) {
    std::uint32_t rng = seed ^ 0x7AD1C; // Must match generate_padic_floor
    // We only care about doorways, not materials
    for (int z = 0; z < 128; z += 3) {
        std::vector<Room> rooms;
        split_room(0, 0, 128, 60, rng, rooms);
        split_room(0, 68, 128, 128 - 68, rng, rooms);
        
        for (const auto& r : rooms) {
            // draw_thin_wall_x (length = r.w) -> wall along X. Door at x = mx + length/2, y = my.
            // X wall implies axis = 1.
            fn(r.x + r.w / 2, r.y, z, 2, 1);
            fn(r.x + r.w / 2, r.y + r.h - 1, z, 2, 1);
            
            // draw_thin_wall_y (length = r.h) -> wall along Y. Door at x = mx, y = my + length/2.
            // Y wall implies axis = 0.
            fn(r.x, r.y + r.h / 2, z, 2, 0);
            fn(r.x + r.w - 1, r.y + r.h / 2, z, 2, 0);
        }
    }
}
