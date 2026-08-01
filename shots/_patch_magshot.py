"""MAGSHOT: --action mag live harness + game_test unbuffered stderr QoL."""
from pathlib import Path
import re
import sys

root = Path(r"C:/hades/gigahrush2")
main_path = root / "src/app/main.cpp"
gt_path = root / "tests/game_test.cpp"
log = []

main = main_path.read_text(encoding="utf-8")
orig_main = main

# --- 1) Insert mag branch after rpgcmbt block (before attack) ---
# Anchor: the closing of rpgcmbt + "} else if (shotAction == \"attack\")"
anchor = '''                        // Hold attack every tick (same as wall/attack).
                        attackHeld = true;
                    } else if (shotAction == "attack") {
                        attackHeld = true;'''

mag_block = '''                        // Hold attack every tick (same as wall/attack).
                        attackHeld = true;
                    } else if (shotAction == "mag" && reg.valid(player)) {
                        // MAGSHOT: live proof that PlayerRanged.magCount survives
                        // elevator body-swap under --shot --ride. Unit pin owns the
                        // pure seam (test_elevator FOR1/MAG1); this stamps a
                        // distinctive partial mag + gun so the HUD gun line and
                        // stderr can show the same count after each hop.
                        static bool magForced = false;
                        static int magLastRideLog = -1;
                        static std::uint16_t magStamp = 7;
                        static game::ItemId magGun = game::kInvalidItem;
                        if (!magForced) {
                            game::ItemId gun = game::kInvalidItem;
                            for (game::ItemId i = 1; i <= game::kItemCount; ++i) {
                                if (const game::RangedDef* d =
                                        game::ranged_for_item(i)) {
                                    if (d->pellets == 1 && d->magazine >= 8 &&
                                        d->dmg >= 20) {
                                        gun = i;
                                        break;
                                    }
                                }
                            }
                            if (gun == game::kInvalidItem) {
                                std::fprintf(stderr, "[mag] FORCE FAIL no gun\\n");
                                magForced = true;
                            } else if (const game::NpcRef* nr =
                                           reg.try_get<game::NpcRef>(player)) {
                                if (pool.valid(nr->id)) {
                                    const game::RangedDef& def =
                                        *game::ranged_for_item(gun);
                                    game::Inventory& inv = pool.inventory(nr->id);
                                    inv.slots[0] = game::ItemSlot{gun, 1};
                                    inv.slots[1] = game::ItemSlot{def.ammo, 30};
                                    game::PlayerRanged pr{};
                                    pr.cooldownMs = 0;
                                    pr.reloadMs = 0;
                                    pr.magCount = magStamp;
                                    pr.weapon = gun;
                                    pr.shots = 42;
                                    pr.hits = 13;
                                    reg.emplace_or_replace<game::PlayerRanged>(
                                        player, pr);
                                    magGun = gun;
                                    magForced = true;
                                    std::fprintf(stderr,
                                                 "[mag] FORCE gun=%u name=%s "
                                                 "mag=%u/%u shots=%u hits=%u\\n",
                                                 static_cast<unsigned>(gun),
                                                 game::item_name(gun),
                                                 static_cast<unsigned>(pr.magCount),
                                                 static_cast<unsigned>(def.magazine),
                                                 pr.shots, pr.hits);
                                }
                            }
                        }
                        // Log once per completed ride (and once at force with done=0).
                        if (magForced && shotRideDone != magLastRideLog) {
                            magLastRideLog = shotRideDone;
                            const game::PlayerRanged* pr =
                                reg.try_get<game::PlayerRanged>(player);
                            const unsigned mag =
                                pr ? static_cast<unsigned>(pr->magCount) : 0u;
                            const unsigned wpn =
                                pr ? static_cast<unsigned>(pr->weapon) : 0u;
                            const unsigned sh = pr ? pr->shots : 0u;
                            const unsigned hi = pr ? pr->hits : 0u;
                            const int ok =
                                (pr && pr->magCount == magStamp &&
                                 pr->weapon == magGun && pr->shots == 42u &&
                                 pr->hits == 13u)
                                    ? 1
                                    : 0;
                            std::fprintf(stderr,
                                         "[mag] RIDE done=%d has=%d mag=%u "
                                         "weapon=%u shots=%u hits=%u ok=%d\\n",
                                         shotRideDone, pr ? 1 : 0, mag, wpn, sh,
                                         hi, ok);
                        }
                    } else if (shotAction == "attack") {
                        attackHeld = true;'''

if main.count(anchor) != 1:
    log.append("FAIL: rpgcmbt/attack anchor count=%d" % main.count(anchor))
    # try to show nearby
    idx = main.find('shotAction == "attack"')
    log.append("attack idx=%d" % idx)
else:
    main = main.replace(anchor, mag_block, 1)
    log.append("OK: inserted mag branch")

# --- 2) Final proof line on shot capture save ---
save_anchor = '''                    std::fprintf(stderr, "shot: %s -> %s (floor %d, %d frames)\\n",
                                 ok ? "saved" : "FAILED", shotPath, currentFloor,
                                 shotFramesSeen);'''

# Note: actual file may use different whitespace - read exact
m = re.search(
    r'std::fprintf\(stderr,\s*"shot: %s -> %s \(floor %d, %d frames\)\\n",\s*'
    r'ok \? "saved" : "FAILED", shotPath, currentFloor,\s*shotFramesSeen\);',
    main,
)
if not m:
    # looser
    m = re.search(r'std::fprintf\(stderr, "shot: %s -> %s \(floor %d, %d frames\)\\n"', main)
    if m:
        log.append("FOUND loose shot fprintf at %d" % m.start())
        # get full statement
        end = main.find(";", m.start()) + 1
        stmt = main[m.start():end]
        log.append("STMT:" + repr(stmt[:200]))
    else:
        log.append("FAIL: no shot fprintf")
else:
    insert_after = m.group(0)
    proof = insert_after + '''
                    if (shotAction == "mag" && reg.valid(player)) {
                        const game::PlayerRanged* pr =
                            reg.try_get<game::PlayerRanged>(player);
                        std::fprintf(stderr,
                                     "[mag] FINAL has=%d mag=%u weapon=%u "
                                     "shots=%u hits=%u rideDone=%d\\n",
                                     pr ? 1 : 0,
                                     pr ? static_cast<unsigned>(pr->magCount) : 0u,
                                     pr ? static_cast<unsigned>(pr->weapon) : 0u,
                                     pr ? pr->shots : 0u, pr ? pr->hits : 0u,
                                     shotRideDone);
                        if (pr && pr->magCount == 7u && pr->shots == 42u &&
                            pr->hits == 13u)
                            std::fprintf(stderr, "[mag] PROOF=GREEN\\n");
                        else
                            std::fprintf(stderr, "[mag] PROOF=RED\\n");
                    }'''
    main = main[: m.start()] + proof + main[m.end() :]
    log.append("OK: inserted FINAL proof after shot fprintf")

# Verify includes already pull ranged/inventory/item
for needle in ["ranged_table", "inventory.h", "item_table", "combat.h"]:
    log.append("include %s: %s" % (needle, needle in main[:5000] or needle in main))

# Check kItemCount / ItemSlot usage possible
log.append("kItemCount in main already: %s" % ("kItemCount" in main))
log.append("ItemSlot in main already: %s" % ("ItemSlot" in main))
log.append("item_name in main: %s" % ("item_name" in main))

if main == orig_main:
    log.append("FAIL: main unchanged")
else:
    main_path.write_text(main, encoding="utf-8")
    log.append("WROTE main.cpp bytes=%d (was %d)" % (len(main), len(orig_main)))

# --- 3) setvbuf unbuffered in game_test main ---
gt = gt_path.read_text(encoding="utf-8")
orig_gt = gt
gt_anchor = "int main() {\n    test_inventory();"
gt_new = (
    "int main() {\n"
    "    // Unbuffered stdio so redirected CI/agent runs show suite progress live\n"
    "    // instead of looking hung at the first long suite (npcpool/samosbor2).\n"
    "    setvbuf(stdout, nullptr, _IONBF, 0);\n"
    "    setvbuf(stderr, nullptr, _IONBF, 0);\n"
    "    test_inventory();"
)
if gt_anchor not in gt:
    # try CRLF
    gt_anchor2 = "int main() {\r\n    test_inventory();"
    if gt_anchor2 in gt:
        gt = gt.replace(
            gt_anchor2,
            "int main() {\r\n"
            "    // Unbuffered stdio so redirected CI/agent runs show suite progress live\r\n"
            "    // instead of looking hung at the first long suite (npcpool/samosbor2).\r\n"
            "    setvbuf(stdout, nullptr, _IONBF, 0);\r\n"
            "    setvbuf(stderr, nullptr, _IONBF, 0);\r\n"
            "    test_inventory();",
            1,
        )
        log.append("OK: setvbuf CRLF")
    else:
        # find main
        m2 = re.search(r"int main\(\)\s*\{", gt)
        log.append("FAIL gt anchor; main at %s" % (m2.start() if m2 else None))
        if m2:
            log.append(repr(gt[m2.start() : m2.start() + 80]))
else:
    gt = gt.replace(gt_anchor, gt_new, 1)
    log.append("OK: setvbuf LF")

# ensure cstdio present
if "#include <cstdio>" not in gt and "#include <stdio.h>" not in gt:
    log.append("WARN: no cstdio — setvbuf may need header")
else:
    log.append("OK: cstdio present")

if gt != orig_gt:
    gt_path.write_text(gt, encoding="utf-8")
    log.append("WROTE game_test.cpp")
else:
    log.append("game_test unchanged")

out = root / "shots/_patch_magshot_out.txt"
out.write_text("\n".join(log), encoding="utf-8")
print("\n".join(log))
sys.exit(0 if any(x.startswith("OK: inserted mag") for x in log) else 1)
