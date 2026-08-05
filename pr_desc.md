💡 **What:** The optimization implemented
Replaced the `hqRooms.push(...stampSpectralHqCompound(world, spec).filter(room => room.type === RoomType.HQ))` pattern inside `expandSpectralRouteGeometry` with a standard `for` loop that iterates over the generated compound rooms and pushes matching ones directly.

🎯 **Why:** The performance problem it solves
The previous pattern creates an unnecessary intermediate array allocation and uses spread syntax on it `push(...arr)` inside a loop over `SPECTRAL_HQ_SPECS`. This causes unnecessary garbage collection pressure and can be slow/problematic if the array is large (though in this specific case, spreading large arrays can also hit stack size limits).

📊 **Measured Improvement:**
Using a local ad-hoc benchmark script scaling `SPECTRAL_HQ_SPECS` to 100 entries and running it 100,000 times, the execution time was improved from roughly **1277ms** to **689ms** (approximately an 85% speedup relative to the baseline time for that inner-loop operation).
