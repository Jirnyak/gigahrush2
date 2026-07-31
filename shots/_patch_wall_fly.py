# -*- coding: utf-8 -*-
"""Patch main.cpp wall harness: fly=false + simplify late block."""
from pathlib import Path

p = Path(r"C:\hades\gigahrush2\src\app\main.cpp")
t = p.read_text(encoding="utf-8")

old1 = """                        if (auto* ctl = reg.try_get<Controller>(player)) {
                            // Always walk forward while out of unarmed reach
                            // (~1.9 m). wishDir.x is camera-local forward.
                            if (bestD2 > 1.2f * 1.2f)
                                ctl->wishDir = {1.0f, 0.0f, 0.0f};
                        }"""

new1 = """                        if (auto* ctl = reg.try_get<Controller>(player)) {
                            // aim_player starts fly=true; wall walk needs ground
                            // locomotion so collision/wish actually close gap.
                            ctl->fly = false;
                            // Always walk forward while out of unarmed reach
                            // (~1.9 m). wishDir.x is camera-local forward.
                            if (bestD2 > 1.2f * 1.2f)
                                ctl->wishDir = {1.0f, 0.0f, 0.0f};
                        }"""

if old1 not in t:
    raise SystemExit("EARLY BLOCK NOT FOUND")
t = t.replace(old1, new1, 1)
print("early fly=false OK")

# Locate late wall block by markers and replace the whole else-if body.
start_mark = '} else if (shotAction == "wall" && reg.valid(player) &&'
end_mark = '} else if (!shotActionConsumed && shotAction == "carve" &&'

si = t.find(start_mark)
if si < 0:
    raise SystemExit("LATE START NOT FOUND")
# Prefer the late one (after early wall block). Early block uses different if form.
# Find second occurrence if first is the early one... Early is:
#   if (shotPath && shotAction == "wall"
# Late is:
#   } else if (shotAction == "wall"
ei = t.find(end_mark, si)
if ei < 0:
    raise SystemExit("LATE END NOT FOUND")

new_late = r'''} else if (shotAction == "wall" && reg.valid(player) &&
                               shotFramesSeen >= 30 && !doors.frozen) {
                        // Face+walk owned by early block (post-input.apply,
                        // pre-controller_step). Here: hold melee + log only.
                        attackHeld = true;
                        static int wallLog = 0;
                        if ((wallLog++ % 120) == 0) {
                            const Transform& ptr = reg.get<Transform>(player);
                            const MacroGrid& g =
                                stack.layer(activeLayer).grid();
                            const float cx = ptr.pos.x;
                            const float cy = ptr.pos.y;
                            const float cz = ptr.pos.z;
                            const float eyeZ = cz + 0.7f;
                            float bestD2 = 1.0e12f;
                            for (int pass = 0; pass < 2 && bestD2 >= 1.0e12f;
                                 ++pass) {
                                const float sampleZ =
                                    pass == 0 ? eyeZ : (eyeZ - kCellSize);
                                const int gz =
                                    static_cast<int>(sampleZ / kCellSize);
                                if (gz < 0 || gz >= kMacroDim) continue;
                                for (int ox = -8; ox <= 8; ++ox) {
                                    for (int oy = -8; oy <= 8; ++oy) {
                                        if (ox == 0 && oy == 0) continue;
                                        const float px =
                                            cx + static_cast<float>(ox) *
                                                     kCellSize;
                                        const float py =
                                            cy + static_cast<float>(oy) *
                                                     kCellSize;
                                        const int gx = wrap_macro(
                                            static_cast<int>(px / kCellSize));
                                        const int gy = wrap_macro(
                                            static_cast<int>(py / kCellSize));
                                        if (g.cell(gx, gy, wrap_macro(gz)) ==
                                            kCellAir)
                                            continue;
                                        const float dx = wrap_delta_f(
                                            cx, px, kWorldExtent);
                                        const float dy = wrap_delta_f(
                                            cy, py, kWorldExtent);
                                        const float d2 = dx * dx + dy * dy;
                                        if (d2 < bestD2) bestD2 = d2;
                                    }
                                }
                            }
                            const bool fly =
                                reg.all_of<Controller>(player)
                                    ? reg.get<Controller>(player).fly
                                    : false;
                            std::fprintf(
                                stderr,
                                "[wall] melee toward solid d=%.2f "
                                "floor=%d frozen=%d fly=%d\n",
                                bestD2 < 1.0e12f ? std::sqrt(bestD2)
                                                 : -1.0f,
                                currentFloor,
                                doors.frozen ? 1 : 0, fly ? 1 : 0);
                        }
                    '''

# Keep the '} else if (!shotActionConsumed...' — new_late ends before it.
# old region is from si to ei (exclusive of end_mark which stays)
t = t[:si] + new_late + t[ei:]
p.write_text(t, encoding="utf-8")
print("late simplify OK")
print("ctl->fly = false count:", t.count("ctl->fly = false"))
print("fly=%d in wall log:", 'fly=%d' in t and '[wall] melee toward solid' in t)
