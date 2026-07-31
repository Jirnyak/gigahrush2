# -*- coding: utf-8 -*-
"""AIMEM wiring: AiMemory in main -> ai_step; ai_release on floor unload/leave."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(r"C:\hades\gigahrush2")


def must_replace(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"FAIL {label}: search block not found")
    if text.count(old) != 1:
        raise SystemExit(f"FAIL {label}: expected 1 occurrence, got {text.count(old)}")
    return text.replace(old, new, 1)


def patch_floor_stream() -> None:
    p = ROOT / "src/game/floor_stream.cpp"
    t = p.read_text(encoding="utf-8")
    t = must_replace(
        t,
        '#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef\n'
        '#include "game/floor_gen.h"   // generate_floor\n',
        '#include "game/ai.h"          // ai_release on unload (MotionOwner token)\n'
        '#include "game/embody.h"      // embody, embody_as_player, fold_back, NpcRef\n'
        '#include "game/floor_gen.h"   // generate_floor\n',
        "floor_stream include ai.h",
    )
    old = (
        "    LayerId layer = reg.layer_of(m);\n"
        "    if (layer == kInvalidLayer) return; // already cold\n"
        "\n"
        "    // Fold every live body back into its cold record (position persists in the\n"
        "    // row). A handle may already be invalid — e.g. the player's old body, which a\n"
        "    // ride destroyed when it moved the player to another floor — and fold_back is\n"
        "    // a clean no-op on an invalid handle.\n"
        "    for (Entity e : fm.bodies) {\n"
    )
    new = (
        "    LayerId layer = reg.layer_of(m);\n"
        "    if (layer == kInvalidLayer) return; // already cold\n"
        "\n"
        "    // Hand MotionOwner::Ai tokens back BEFORE fold_back destroys the bodies.\n"
        "    // fold_back destroys the entity (AiBrain dies with it), but ai_release is the\n"
        "    // documented unload contract ([ai.h]): if a body were kept alive across a\n"
        "    // layer recycle without destroy, wander_step would skip it forever. Cheap,\n"
        "    // idempotent, and the stderr line is the gameplay proof AIMEM needs.\n"
        "    {\n"
        "        const std::uint32_t released = ai_release(ecs, layer);\n"
        "        std::fprintf(stderr,\n"
        "                     \"[aimem] RELEASE floor=%d layer=%u bodies=%u released=%u\\n\",\n"
        "                     number, static_cast<unsigned>(layer),\n"
        "                     static_cast<unsigned>(fm.bodies.size()), released);\n"
        "    }\n"
        "\n"
        "    // Fold every live body back into its cold record (position persists in the\n"
        "    // row). A handle may already be invalid — e.g. the player's old body, which a\n"
        "    // ride destroyed when it moved the player to another floor — and fold_back is\n"
        "    // a clean no-op on an invalid handle.\n"
        "    for (Entity e : fm.bodies) {\n"
    )
    t = must_replace(t, old, new, "floor_stream unload ai_release")
    # need cstdio if not present
    if "#include <cstdio>" not in t and "std::fprintf" in t:
        # floor_stream.h or cpp may pull it transitively; add explicit for portability
        t = must_replace(
            t,
            '#include "game/floor_stream.h"\n\n',
            '#include "game/floor_stream.h"\n\n#include <cstdio>\n\n',
            "floor_stream cstdio",
        )
    p.write_text(t, encoding="utf-8")
    print("OK floor_stream.cpp")


def patch_main() -> None:
    p = ROOT / "src/app/main.cpp"
    t = p.read_text(encoding="utf-8")

    # 1) Own AiMemory next to AiConfig
    old = (
        "    game::AiConfig aiCfg;\n"
        "    aiCfg.enabled = true;\n"
        "    game::AiTick aiTick{};\n"
    )
    new = (
        "    game::AiConfig aiCfg;\n"
        "    aiCfg.enabled = true;   // utility AI live; brains attached in finish_floor_nav\n"
        "    aiCfg.memory = true;    // second axis: needs a real AiMemory* at ai_step\n"
        "    // Demand column owned HERE ([ai.h] \"No global state\"). Id-indexed so an\n"
        "    // elevator fold keeps the row: the cold NpcId is the key, not the body.\n"
        "    // Passed to every ai_step; null would be bit-for-bit the pre-memory pass.\n"
        "    game::AiMemory aiMem;\n"
        "    game::AiTick aiTick{};\n"
        "    std::uint64_t lastAimemLogTick = ~0ull;\n"
    )
    t = must_replace(t, old, new, "main AiMemory own")

    # 2) Pass &aiMem to ai_step + periodic proof log
    old = (
        "                aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,\n"
        "                                       kSimDt, aiCfg);\n"
        "                controller_step(reg, kSimDt);\n"
    )
    new = (
        "                aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,\n"
        "                                       kSimDt, aiCfg, &aiMem);\n"
        "                // AIMEM proof trail: once nav has brains and AI is on, emit a\n"
        "                // compact stderr pulse so a --shot harness can assert the store\n"
        "                // is live (rows/writes/recalled) without parsing the HUD.\n"
        "                if (aiCfg.enabled && (lastAimemLogTick == ~0ull ||\n"
        "                                     simTick - lastAimemLogTick >= 60ull)) {\n"
        "                    lastAimemLogTick = simTick;\n"
        "                    std::fprintf(stderr,\n"
        "                                 \"[aimem] STEP tick=%llu layer=%u seen=%u replan=%u \"\n"
        "                                 \"own_ai=%u own_wander=%u recall=%u filed=%u fled=%u \"\n"
        "                                 \"rows=%u writes=%u coal=%u evict=%u bytes=%zu\\n\",\n"
        "                                 static_cast<unsigned long long>(simTick),\n"
        "                                 static_cast<unsigned>(activeLayer),\n"
        "                                 aiTick.considered, aiTick.replanned,\n"
        "                                 aiTick.aiOwned, aiTick.wanderOwned,\n"
        "                                 aiTick.recalled, aiTick.remembered,\n"
        "                                 aiTick.memoryFled, aiMem.rows(),\n"
        "                                 aiMem.writes(), aiMem.coalesced(),\n"
        "                                 aiMem.evictions(), aiMem.resident_bytes());\n"
        "                }\n"
        "                controller_step(reg, kSimDt);\n"
    )
    t = must_replace(t, old, new, "main ai_step + log")

    # 3) do_ride: release on leave layer BEFORE travel (token hygiene + log even if
    #    unload is deferred a few frames by keep_only cadence)
    old = (
        "        {\n"
        "            const LayerId leaveLayer = reg.valid(player)\n"
        "                                           ? reg.get<Transform>(player).layer\n"
        "                                           : static_cast<LayerId>(0);\n"
        "            game::refresh_opened_containers(reg, leaveLayer, currentFloor,\n"
        "                                            runState.opened);\n"
        "            // The departing floor's exact grid goes to its own file — this is\n"
        "            // THE geometry persistence: the next visit (or the next run)\n"
        "            // stamps it back. A transition is a load screen; I/O is\n"
        "            // sanctioned here. [save.h]\n"
        "            write_floor_file(stack.layer(leaveLayer), currentFloor);\n"
        "        }\n"
        "        game::RideResult ride =\n"
    )
    new = (
        "        {\n"
        "            const LayerId leaveLayer = reg.valid(player)\n"
        "                                           ? reg.get<Transform>(player).layer\n"
        "                                           : static_cast<LayerId>(0);\n"
        "            game::refresh_opened_containers(reg, leaveLayer, currentFloor,\n"
        "                                            runState.opened);\n"
        "            // The departing floor's exact grid goes to its own file — this is\n"
        "            // THE geometry persistence: the next visit (or the next run)\n"
        "            // stamps it back. A transition is a load screen; I/O is\n"
        "            // sanctioned here. [save.h]\n"
        "            write_floor_file(stack.layer(leaveLayer), currentFloor);\n"
        "            // AIMEM: clear MotionOwner::Ai on the leaving floor before the\n"
        "            // streamer recycles the layer. unload() also releases; this is the\n"
        "            // keyboard/--shot leave seam so a ride without an immediate unload\n"
        "            // still cannot strand tokens. Idempotent. [ai.h]\n"
        "            {\n"
        "                const std::uint32_t released =\n"
        "                    game::ai_release(reg, leaveLayer);\n"
        "                std::fprintf(stderr,\n"
        "                             \"[aimem] LEAVE floor=%d layer=%u released=%u \"\n"
        "                             \"mem_rows=%u\\n\",\n"
        "                             currentFloor, static_cast<unsigned>(leaveLayer),\n"
        "                             released, aiMem.rows());\n"
        "            }\n"
        "        }\n"
        "        game::RideResult ride =\n"
    )
    t = must_replace(t, old, new, "main do_ride leave release")

    # 4) --shot travel path (second site): same leave release
    old = (
        "                    {\n"
        "                        const LayerId leaveLayer =\n"
        "                            reg.valid(player) ? reg.get<Transform>(player).layer\n"
        "                                              : static_cast<LayerId>(0);\n"
        "                        game::refresh_opened_containers(reg, leaveLayer, currentFloor,\n"
        "                                                        runState.opened);\n"
        "                        // Same departure floor-file write as the keyboard\n"
        "                        // path — two travel sites, one law. [save.h]\n"
        "                        write_floor_file(stack.layer(leaveLayer), currentFloor);\n"
        "                    }\n"
        "                    game::RideResult r = streamer.travel(\n"
    )
    new = (
        "                    {\n"
        "                        const LayerId leaveLayer =\n"
        "                            reg.valid(player) ? reg.get<Transform>(player).layer\n"
        "                                              : static_cast<LayerId>(0);\n"
        "                        game::refresh_opened_containers(reg, leaveLayer, currentFloor,\n"
        "                                                        runState.opened);\n"
        "                        // Same departure floor-file write as the keyboard\n"
        "                        // path — two travel sites, one law. [save.h]\n"
        "                        write_floor_file(stack.layer(leaveLayer), currentFloor);\n"
        "                        // Same AIMEM leave release as do_ride. Two travel\n"
        "                        // sites; a fix that touches only one proves nothing\n"
        "                        // under --shot --ride. [ai.h]\n"
        "                        {\n"
        "                            const std::uint32_t released =\n"
        "                                game::ai_release(reg, leaveLayer);\n"
        "                            std::fprintf(stderr,\n"
        "                                         \"[aimem] LEAVE floor=%d layer=%u \"\n"
        "                                         \"released=%u mem_rows=%u\\n\",\n"
        "                                         currentFloor,\n"
        "                                         static_cast<unsigned>(leaveLayer),\n"
        "                                         released, aiMem.rows());\n"
        "                        }\n"
        "                    }\n"
        "                    game::RideResult r = streamer.travel(\n"
    )
    t = must_replace(t, old, new, "main shot travel leave release")

    # 5) F9 full restore unload path already calls streamer.unload which now releases.
    #    Also release on the pre-unload current floor in case bodies hold tokens:
    #    unload handles it — no extra main edit needed.

    # 6) Stale comments that still say enabled is FALSE / no mem
    # Soft: update the big comment block near ai_step so it matches reality.
    old = (
        "                // `aiCfg.enabled` is FALSE, so this is one branch per tick — ai.cpp returns\n"
        "                // before it even takes the view. The call is live anyway, deliberately: it\n"
        "                // makes the wiring real instead of a comment, it consumes `danger` and\n"
        "                // `activeGrid` (which were live C4189 warnings for exactly as long as this\n"
        "                // stayed parked), and it reduces switching the AI on to editing ONE bool\n"
        "                // rather than re-deriving a call signature months from now.\n"
        "                //\n"
        "                // Before flipping it: `ai_init` must attach AiBrain to the floor's bodies\n"
        "                // (see the load path), and `ai_release` must run when clearing the flag on a\n"
        "                // live floor — the token is persistent state, so a body left holding\n"
        "                // MotionOwner::Ai would be skipped by wander_step forever and stand still.\n"
    )
    new = (
        "                // `aiCfg.enabled` is TRUE and `aiMem` is passed every tick. Memory is the\n"
        "                // demand column owned above; null would disable recall/record bit-for-bit.\n"
        "                // `ai_init` attaches brains in finish_floor_nav; `ai_release` runs on floor\n"
        "                // leave (do_ride + --shot travel) and again inside FloorStreamer::unload.\n"
        "                // Clearing enabled mid-run without release would strand MotionOwner::Ai\n"
        "                // and freeze bodies under wander_step — that trap is what AIMEM closes.\n"
    )
    if old in t:
        t = must_replace(t, old, new, "main ai_step comment refresh")
    else:
        print("WARN: ai_step comment block drift — skipped refresh")

    p.write_text(t, encoding="utf-8")
    print("OK main.cpp")


def main() -> None:
    patch_floor_stream()
    patch_main()
    print("AIMEM patch applied")


if __name__ == "__main__":
    main()
